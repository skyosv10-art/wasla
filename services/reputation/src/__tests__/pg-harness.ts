/**
 * مُهيئُ PostgreSQL لاختبارات تكامل خدمة السمعة.
 *
 * أربعُ قواعدَ تجعل هذه الاختبارات دليلاً على العقد لا على نفسها:
 *
 *  1. يُطبّق `applyCanonicalSchema` ملفَّ `contracts/schema.sql` **نصّاً** ولا يُولّد DDL
 *     من مرآة Drizzle. اختبارٌ يُولّد القاعدةَ من المرآة ثمّ يستعمل المرآةَ يُثبت أنّ
 *     الملفَّ يتّفق مع نفسه، لا أنّه يتّفق مع القاعدة المتعاقد عليها.
 *  2. لا تمسّ `resetData` بذرةَ نسخةِ القواعد. النسخةُ 1 جزءٌ من العقد وتقرؤها كلُّ عملية
 *     عبر `findActive()`؛ حذفُها يصنع اختباراتٍ حمراءَ لسببٍ لا علاقةَ له بالسلوك
 *     المفحوص. وهذا بعينه ما يُلزمه المعيارُ (HANDOFF §16-و البند 3): البذرةُ من
 *     الترحيل لا من الكود.
 *  3. لا مشاركةَ بين ملفات الاختبار: كلُّها تملك قاعدةً واحدة، ولذلك يضبط إعدادُ
 *     التكامل `fileParallelism: false`.
 *  4. لا `sleep` ولا `new Date()`: الساعةُ `ManualClock` **نفسها** التي تستعملها
 *     اختباراتُ الذاكرة، والمُعرّفاتُ متتاليةٌ بنفس المُولّد. فأيُّ فرقٍ يظهر في حزمة
 *     المطابقة يكون فرقَ استمراريّةٍ لا فرقَ بيئة.
 *
 * وتتخطّى حزمُ التكامل نفسَها عند غياب `DATABASE_URL`، فيبقى التشغيلُ العاديّ على جهازٍ
 * بلا PostgreSQL ممكناً. الطريقةُ في `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import type { ReputationFactDraft } from "../domain/model.js";
import { createReputationDb, type Db } from "../infrastructure/drizzle/db.js";
import {
  PostgresFactRepository,
  PostgresFraudSignalRepository,
  PostgresIdempotencyRepository,
  PostgresRatingRepository,
  PostgresReputationOutbox,
  PostgresRulesetRepository,
  PostgresScoreRepository,
} from "../infrastructure/drizzle/repository.js";
import {
  PostgresReputationUnitOfWork,
  type ReputationSharedDeps,
} from "../infrastructure/drizzle/transaction.js";
import { ManualClock, SequentialIdGenerator } from "../infrastructure/in-memory.js";
import type { ReputationDependencies } from "../ports.js";
import {
  PostgresReputationRunner,
  createDirectReputationRunner,
  type ReputationRunner,
} from "../runner.js";
import { recordFact } from "../use-cases/record-fact.js";
import { CUSTOMER, DRIVER, T0 } from "./helpers.js";

/** يُحلّ من موضع الملف حتى لو شُغّل Vitest من جذر مساحة العمل. */
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** وجودُ العنوان وحده هو مفتاحُ تشغيل التكامل؛ لا نفترض قاعدةً على جهاز المطوّر. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/**
 * ترتيبُ الاعتماد العكسيّ للجداول التسعة.
 *
 * `DROP ... CASCADE` متسامحٌ مع الترتيب، لكن `TRUNCATE` يحتاجه. وقائمةٌ واحدةٌ
 * للإجراءين تمنع إضافةَ جدولٍ إلى أحدهما ونسيانَه في الآخر.
 */
const TABLES = [
  "reputation_outbox",
  "reputation_idempotency",
  "fraud_signals",
  "reputation_ratings",
  "reputation_scores",
  "reputation_facts",
  "reputation_fraud_thresholds",
  "reputation_rule_weights",
  "reputation_rulesets",
] as const;

/**
 * جداولُ نسخةِ القواعد — تُطبَّق مرّةً من العقد ولا تُمسح بين الاختبارات.
 *
 * الأوزانُ والعتباتُ والحدودُ بياناتُ عقدٍ لا أثرَ اختبار (ADR-014 القرار 4)، ومسحُها
 * كان سيجعل كلَّ اختبارٍ يبذر نسخته بيده — فتصير الاختباراتُ تفحص بذرةً كتبها المُختبِر
 * لا النسخةَ التي ستعمل في الإنتاج.
 */
const CONTRACT_SEEDED = new Set<string>([
  "reputation_rulesets",
  "reputation_rule_weights",
  "reputation_fraud_thresholds",
]);

const TRUNCATED_TABLES = TABLES.filter((table) => !CONTRACT_SEEDED.has(table));

/** يُسقط جداولَ خدمة السمعة وحدها ثمّ يُعيد نصَّ العقد كاملاً ببذرته. */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  const ddl = await readFile(path.join(SERVICE_ROOT, "contracts", "schema.sql"), "utf8");
  await pool.query(ddl);
}

/** يُنظّف أثرَ الاختبار السابق مع الإبقاء على بذرة النسخة 1. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TRUNCATED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** يعدّ صفوفَ جدولٍ بعينه — للتأكّد من التراجع الكامل في اختبار الذرّية. */
export async function countRows(pool: Pool, table: (typeof TABLES)[number]): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

// ---------------------------------------------------------------------------
// مُعرّفاتٌ حتميّةٌ صالحةُ الشكل
// ---------------------------------------------------------------------------

/**
 * مُعرّفُ حدثِ مصدرٍ حتميٌّ **بصيغة UUID فعليّة**.
 *
 * `source_event_id` عمودُ `UUID` في العقد، والمجالُ لا يُعيد تحليلَ شكله
 * (`domain/validation.ts`: «شكلُ UUID يحرسه العقد»). فمُعرّفٌ مثل `c-ORD-0000000001`
 * يمرّ في الذاكرة ويرفضه Postgres بـ`22P02`. وهذا فرقٌ حقيقيٌّ **مُعلَنٌ ومُختبَر** في
 * `repository.integration.test.ts`، ولذلك تستعمل حزمةُ المطابقة مُعرّفاتٍ صالحةَ الشكل
 * كما يفعل النظامُ الحقيقيّ — لا لتُخفي الفرقَ بل لأنّ الفرقَ مفحوصٌ في موضعه.
 */
export function sourceEventUuid(lane: number, index: number): string {
  const tail = `${String(lane).padStart(4, "0")}${String(index).padStart(8, "0")}`;
  return `22222222-2222-4222-8222-${tail}`;
}

/** مسوّدةُ واقعةٍ بحقولٍ افتراضيةٍ مُعلَنة ومُعرّفِ حدثٍ صالحِ الشكل. */
export function pgFactDraft(overrides: Partial<ReputationFactDraft> = {}): ReputationFactDraft {
  return {
    subjectType: "customer",
    subjectPublicId: CUSTOMER,
    factKind: "order_completed",
    orderPublicId: "ORD-0000000001",
    sourceEventType: "order.completed",
    sourceEventId: sourceEventUuid(0, 1),
    sourceSequence: 1,
    actorType: "system",
    reasonCode: null,
    occurredAt: T0,
    ...overrides,
  };
}

/**
 * طلبٌ مكتملٌ بطرفين على أيِّ مُهيئ — الشرطُ المُسبق لأيّ تقييم.
 *
 * توأمُ `helpers.completeOrder` لكنّه يقبل `ReputationDependencies` لا مخازنَ الذاكرة،
 * فيصلح للمُهيئين معاً. وذاك شرطُ أن تكون حزمةُ المطابقة **نفسَ** السيناريو لا نسختين
 * متشابهتين تتباعدان بأوّل تعديل.
 */
export async function completeOrderWith(
  deps: ReputationDependencies,
  input: {
    readonly orderPublicId: string;
    readonly orderIndex: number;
    readonly customerPublicId?: string;
    readonly driverPublicId?: string;
    readonly occurredAt?: string;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? deps.clock.now();
  await recordFact(deps, {
    draft: pgFactDraft({
      subjectType: "customer",
      subjectPublicId: input.customerPublicId ?? CUSTOMER,
      orderPublicId: input.orderPublicId,
      sourceEventId: sourceEventUuid(1, input.orderIndex),
      occurredAt,
    }),
  });
  await recordFact(deps, {
    draft: pgFactDraft({
      subjectType: "driver",
      subjectPublicId: input.driverPublicId ?? DRIVER,
      orderPublicId: input.orderPublicId,
      sourceEventId: sourceEventUuid(2, input.orderIndex),
      occurredAt,
    }),
  });
}

// ---------------------------------------------------------------------------
// التركيب
// ---------------------------------------------------------------------------

/** المُهيئاتُ المباشرة، متاحةٌ لاختبارات المستودعات وحدها. */
export interface PgFixture {
  readonly pool: Pool;
  readonly db: Db;
  readonly rulesets: PostgresRulesetRepository;
  readonly facts: PostgresFactRepository;
  readonly scores: PostgresScoreRepository;
  readonly ratings: PostgresRatingRepository;
  readonly fraudSignals: PostgresFraudSignalRepository;
  readonly idempotency: PostgresIdempotencyRepository;
  readonly outbox: PostgresReputationOutbox;
  readonly unitOfWork: PostgresReputationUnitOfWork;
  readonly close: () => Promise<void>;
}

/** يفتح مسبحاً للاختبار ويُعيد تطبيق العقد قبل بدء الملف. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createReputationDb({ connectionString: DATABASE_URL!, max: 4 });

  await applyCanonicalSchema(pool);

  return {
    pool,
    db,
    rulesets: new PostgresRulesetRepository(db),
    facts: new PostgresFactRepository(db),
    scores: new PostgresScoreRepository(db),
    ratings: new PostgresRatingRepository(db),
    fraudSignals: new PostgresFraudSignalRepository(db),
    idempotency: new PostgresIdempotencyRepository(db),
    outbox: new PostgresReputationOutbox(db),
    unitOfWork: new PostgresReputationUnitOfWork(db),
    close: () => pool.end(),
  };
}

/**
 * بيئةُ حالاتِ الاستخدام فوق PostgreSQL.
 *
 * الساعةُ والمُعرّفاتُ هي نفسُها في الذاكرة، فتبقى المقارنةُ في الاستمرارية وحدها.
 */
export interface PgHarness {
  readonly deps: ReputationDependencies;
  readonly shared: ReputationSharedDeps;
  readonly clock: ManualClock;
  readonly ids: SequentialIdGenerator;
  readonly runner: ReputationRunner;
}

export function createPgHarness(fixture: PgFixture, now: string = T0): PgHarness {
  const clock = new ManualClock(now);
  const ids = new SequentialIdGenerator();
  const shared: ReputationSharedDeps = { clock, ids };

  const deps: ReputationDependencies = {
    rulesets: fixture.rulesets,
    facts: fixture.facts,
    scores: fixture.scores,
    ratings: fixture.ratings,
    fraudSignals: fixture.fraudSignals,
    idempotency: fixture.idempotency,
    outbox: fixture.outbox,
    ...shared,
  };

  return {
    deps,
    shared,
    clock,
    ids,
    runner: new PostgresReputationRunner(fixture.db, shared),
  };
}

/**
 * مُشغّلٌ ذاكريٌّ بنفس الواجهة — الطرفُ الثاني في حزمة المطابقة.
 *
 * `createDirectReputationRunner` لا يفتح معاملة، وهو صدقٌ لا تهاون: مخازنُ الذاكرة لا
 * معاملةَ لها، والتظاهرُ بغيرها كان يُخفي الفرقَ الذي وُجدت الحزمةُ لقياسه.
 */
export function memoryRunner(deps: ReputationDependencies): ReputationRunner {
  return createDirectReputationRunner(deps);
}
