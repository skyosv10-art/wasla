/**
 * مهيئ PostgreSQL لاختبارات التكامل لخدمة التفاوض.
 *
 * ثلاث قواعد تجعل هذه الاختبارات دليلاً على العقد لا على نفسها:
 *
 *  1. يطبق `applyCanonicalSchema` ملف `contracts/schema.sql` ولا يولد DDL من Drizzle؛
 *     المرآة قد تتأخر، أما العقد فهو المصدر الرسمي للحقيقة.
 *  2. لا تمس `resetData` بذرة `negotiation_policies`. النسخة 1 جزء من العقد وتحتاجها كل
 *     عملية تفاوض؛ حذفها يصنع اختبارات حمراء لسبب لا علاقة له بالسلوك المختبر.
 *  3. لا توجد مشاركة بين ملفات الاختبار. جميعها تملك قاعدة واحدة، ولذلك يضبط إعداد Vitest
 *     `fileParallelism: false` قبل أن يعيد كل ملف تطبيق المخطط.
 *
 * تتخطى suites التكامل نفسها عند غياب `DATABASE_URL`، فيبقى تشغيل الاختبارات المحلية العادية
 * قابلاً للاستخدام بلا PostgreSQL. عند وجوده نعيد المخطط عمداً، لا نستخدم أي ترحيل سابق.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

import { createNegotiationDb, type Db } from '../infrastructure/drizzle/db.js';
import {
  PostgresAgreementRepository,
  PostgresMessageRepository,
  PostgresNegotiationIdempotencyStore,
  PostgresNegotiationOutbox,
  PostgresNegotiationPolicyRepository,
  PostgresPriceHandoffRepository,
  PostgresRoundRepository,
  PostgresThreadRepository,
} from '../infrastructure/drizzle/repository.js';
import {
  PostgresNegotiationUnitOfWork,
  type NegotiationSharedDeps,
} from '../infrastructure/drizzle/transaction.js';
import {
  MutableClock,
  SequentialIdGenerator,
  StubAgreedPricePort,
  StubDispatchOfferPort,
} from '../infrastructure/in-memory.js';
import type { NegotiationDependencies } from '../ports.js';
import { DRIVER_ID, OFFER_ID, ORDER_ID, START } from './helpers.js';

/** يحل من مكان الملف حتى لو شغل Vitest من جذر مساحة العمل. */
const SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** وجود العنوان فقط هو مفتاح تشغيل التكامل، ولا نفترض قاعدة على حاسوب المطور. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/**
 * ترتيب الاعتماد العكسي للجداول.
 *
 * `DROP ... CASCADE` يجعل الإزالة متسامحة، لكن `TRUNCATE` يحتاج الترتيب نفسه. وجود قائمة
 * واحدة للإجراءين يمنع إضافة جدول جديد إلى واحد ونسيانه في الآخر.
 */
const TABLES = [
  'negotiation_outbox',
  'negotiation_idempotency',
  'negotiation_price_handoffs',
  'negotiation_agreements',
  'negotiation_messages',
  'negotiation_rounds',
  'negotiation_threads',
  'negotiation_policies',
] as const;

/** كل البيانات المؤقتة، مع استثناء بذرة السياسة العقدية. */
const TRUNCATED_TABLES = TABLES.filter(
  (table) => table !== 'negotiation_policies',
);

/**
 * يسقط جداول خدمة التفاوض فقط ثم يعيد نص العقد الرسمي كاملاً.
 *
 * لا نستدعي مولد Drizzle هنا: الاختبار الذي يولد القاعدة من المرآة ثم يستخدم المرآة يثبت أن
 * الملف يتفق مع نفسه، لا أنه يتفق مع PostgreSQL المتعاقد عليه.
 */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
  const ddl = await readFile(
    path.join(SERVICE_ROOT, 'contracts', 'schema.sql'),
    'utf8',
  );
  await pool.query(ddl);
}

/**
 * ينظف صفوف كل اختبار مع الإبقاء على النسخة 1 من سياسة التفاوض.
 *
 * البذرة ليست fixture اختيارية؛ استعمالات الحالة تقرأها عبر `findActive()` لتثبت الحدود
 * والمهل. لذلك يمسح هذا الإجراء أثر الاختبار السابق فقط، لا بيانات العقد التي يبدأ بها كل
 * اختبار صحيح.
 */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE ${TRUNCATED_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** المحولات المباشرة المتاحة لاختبارات المستودعات وحدها. */
export interface PgFixture {
  readonly pool: Pool;
  readonly db: Db;
  readonly threads: PostgresThreadRepository;
  readonly rounds: PostgresRoundRepository;
  readonly messages: PostgresMessageRepository;
  readonly agreements: PostgresAgreementRepository;
  readonly handoffs: PostgresPriceHandoffRepository;
  readonly policies: PostgresNegotiationPolicyRepository;
  readonly outbox: PostgresNegotiationOutbox;
  readonly idempotency: PostgresNegotiationIdempotencyStore;
  readonly unitOfWork: PostgresNegotiationUnitOfWork;
  readonly close: () => Promise<void>;
}

/** يفتح قاعدة مستقلة للمستودع ويعيد تطبيق العقد قبل بدء الملف. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createNegotiationDb({
    connectionString: DATABASE_URL!,
    max: 4,
  });

  await applyCanonicalSchema(pool);

  return {
    pool,
    db,
    threads: new PostgresThreadRepository(db),
    rounds: new PostgresRoundRepository(db),
    messages: new PostgresMessageRepository(db),
    agreements: new PostgresAgreementRepository(db),
    handoffs: new PostgresPriceHandoffRepository(db),
    policies: new PostgresNegotiationPolicyRepository(db),
    outbox: new PostgresNegotiationOutbox(db),
    idempotency: new PostgresNegotiationIdempotencyStore(db),
    unitOfWork: new PostgresNegotiationUnitOfWork(db),
    close: () => pool.end(),
  };
}

/**
 * بيئة استعمالات الحالة فوق PostgreSQL.
 *
 * نستعمل الساعة والمعرفات ومنافذ العرض/تسليم السعر المزيفة نفسها الموجودة في الذاكرة. ذلك
 * يجعل اختبار المطابقة مقارنة في الاستمرارية وحدها: بيئة غير مبذورة ستثبت فشل العرض بدلاً
 * من أن تثبت تكافؤ محولي التخزين.
 */
export interface PgHarness {
  readonly deps: NegotiationDependencies;
  readonly shared: NegotiationSharedDeps;
  readonly clock: MutableClock;
  readonly offers: StubDispatchOfferPort;
  readonly agreedPrice: StubAgreedPricePort;
}

/** ينشئ بيئة مبذورة بعرض توزيع واحد قابل للتفاوض، مطابقة لـ`helpers.makeDeps()`. */
export function createPgHarness(fixture: PgFixture, now = START): PgHarness {
  const clock = new MutableClock(now);
  const offers = new StubDispatchOfferPort();
  const agreedPrice = new StubAgreedPricePort();
  const ids = new SequentialIdGenerator();

  offers.put({
    dispatchOfferId: OFFER_ID,
    orderPublicId: ORDER_ID,
    driverPublicId: DRIVER_ID,
    serviceKind: 'ride',
    active: true,
    negotiable: true,
  });

  const shared: NegotiationSharedDeps = {
    clock,
    ids,
    offers,
    agreedPrice,
  };

  const deps: NegotiationDependencies = {
    threads: fixture.threads,
    rounds: fixture.rounds,
    messages: fixture.messages,
    agreements: fixture.agreements,
    handoffs: fixture.handoffs,
    policies: fixture.policies,
    outbox: fixture.outbox,
    idempotency: fixture.idempotency,
    ...shared,
  };

  return {
    deps,
    shared,
    clock,
    offers,
    agreedPrice,
  };
}
