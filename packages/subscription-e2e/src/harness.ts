/**
 * مِشْكاةُ بوابةِ خروج Phase 10 — خدمةُ اشتراكٍ على **قاعدةٍ حقيقيّة** وخدمةُ سمعةٍ حقيقيّة.
 *
 * # ما تُثبته هذه الحزمةُ ولا يُثبته غيرُها
 *
 * اختباراتُ خدمةِ الاشتراك (205 سريعة و62 على القاعدة) تُثبت أنّ كلَّ قطعةٍ صحيحةٌ وحدَها:
 * الاشتقاقُ من الدفتر، والانتقالاتُ السبعةُ المُعلَنة، والنبضةُ، ومستهلكُ الوقائع. ولا تُثبت
 * ثلاثةَ أشياءَ لا تظهر إلّا مُجتمِعةً:
 *
 *  1. **أنّ الحالاتَ الأربعَ تُبلَغ بالزمنِ لا بالنداء**: سائقٌ يمرّ `trial → expired →
 *     community → active` بنبضاتٍ حقيقيّةٍ على قاعدةٍ حقيقيّة، لا بدالّةٍ تُنادى في اختبار.
 *  2. **أنّ الوقائعَ التي تعبر الحدَّ هي التي يُصدرها محرّكُ السمعةِ فعلاً**: البوابةُ لا
 *     تكتب حمولةَ حدثٍ بيدها؛ تُسجّل وقائعَ عبر `POST /reputation/facts` في خدمةِ السمعةِ
 *     الحقيقيّة، ثمّ تأخذ ما وضعه هو في صندوقِ صادرِه وتُمرّره كما هو. فاسمُ حقلٍ يختلف
 *     بين الخدمتَين يُسقط البوابةَ قبل الدمج لا في الإنتاج.
 *  3. **أنّ مفتاحاً مُعاداً يُعيد نفسَ البايتات**: وهذا ما وصلته المراجعة 6/6، ويُثبته
 *     `services/subscriptions/src/__tests__/idempotency-replay.integration.test.ts` على
 *     مِقبضٍ داخليّ — وهنا على **مُستمعٍ حقيقيٍّ** بجسمٍ يُقرأ من الشبكة.
 *
 * # النسخةُ الخاطئةُ الأرخص
 *
 * كان الأرخصُ أن تُنادى `SubscriptionService.tick()` مباشرةً بدلَ رفعِ مُستمع، وأن تُبنى
 * حمولةُ الواقعةِ في ثابتٍ في الملف. والنتيجةُ اختبارٌ يُثبت أنّ الخدمةَ متّسقةٌ مع فهمِنا
 * نحن للعقد — وهو مُثبَتٌ أصلاً في 267 اختباراً — ولا يُثبت أنّ الطبقةَ التي ستُنادى في
 * الإنتاج تُعيد ما يتوقّعه المُتكامِل. ولذلك كلُّ قراءةٍ هنا من `fetch` على منفذ.
 *
 * # ساعةٌ تتحرّك، لا ساعةُ نظام
 *
 * الحالاتُ الأربعُ تُبلَغ بمضيِّ الزمن: التجربةُ 14 يوماً ومهلةُ المجتمع 7 أيام. وساعةُ نظامٍ
 * كانت ستجعل البوابةَ تنتظر 22 يوماً، فالساعةُ **محقونةٌ ومُتحرّكة**: تُقدَّم بأيامٍ مُعلَنةٍ
 * ثمّ تُنادى النبضةُ فتُثبّت ما صار حقّاً. والقاعدةُ لا تعرف ساعتَنا، وكلُّ لحظةٍ تُكتب في
 * صفٍّ هي التي أعلنّاها — فالفشلُ يبقى مقروءاً بعد سنةٍ من كتابةِ الملفّ.
 *
 * Scope: Phase 10 · MR 6/6 — بوابة الخروج فقط.
 * Related Code: services/subscriptions, services/reputation
 * Related Docs: docs/12-testing/PHASE10_EXIT_GATE_E2E.md
 */
import type { AddressInfo } from "node:net";

import {
  createInMemoryReputationDependencies,
  type InMemoryReputationDependencies,
} from "@wasla/reputation-service";
import { createReputationApp } from "@wasla/reputation-service/http";
import { createDirectReputationRunner } from "@wasla/reputation-service/runner";
import { addDays, type Clock } from "@wasla/subscriptions-service";
import {
  ReferralService,
  ReputationFactConsumer,
  SubscriptionService,
  sequentialUuidGenerator,
} from "@wasla/subscriptions-service/app";
import {
  SubscriptionUnitOfWork,
  createSubscriptionDb,
  migrateSubscriptions,
} from "@wasla/subscriptions-service/db";
import { createSubscriptionApp } from "@wasla/subscriptions-service/http";
import type { Pool } from "pg";

/**
 * بدايةُ خطِّ الزمن، ولحظةُ تثبيتِ الكتالوج.
 *
 * `FROZEN_AT` قبل `T0`: صفوفُ الكتالوجِ تُبذَر بلحظةٍ ثابتةٍ (نفسُ قيمةِ مُهاجرةِ الخدمة)
 * كي تكون `created_at` قيمةً يمكن توكيدُها، ونسخةُ خطّةٍ «أُنشئت» بعد أوّلِ اشتراكٍ عليها
 * كانت ستقرأ في أيّ تقريرٍ كخللٍ في الترتيب.
 */
export const FROZEN_AT = "2026-02-01T00:00:00.000Z";
export const T0 = "2026-03-01T00:00:00.000Z";

/** ساعةُ السمعةِ متأخّرةٌ عن كلّ واقعةٍ تُسجّلها البوابةُ: الوقائعُ تحدث ثمّ تُقرأ. */
export const REPUTATION_NOW = "2026-04-01T00:00:00.000Z";

/** جداولُ البياناتِ — تُفرَّغ قبل البوابة. والكتالوجُ ليس منها: تبذره المُهاجرة. */
const DATA_TABLES = [
  "subscription_outbox",
  "subscription_idempotency",
  "referral_rewards",
  "referrals",
  "referral_codes",
  "subscription_transitions",
  "subscription_periods",
  "subscriptions",
] as const;

/** البوابةُ تحتاج قاعدةً: نمطُ الذاكرةِ في هذه الخدمةِ يردّ `503` عن قصد. */
export const PG_ENABLED = (process.env.DATABASE_URL ?? "").trim() !== "";

/**
 * ساعةٌ تُقدَّم بأيامٍ مُعلَنة — الأداةُ التي تجعل 22 يوماً تمرّ في ميلي‌ثانية.
 *
 * ولا `advanceMillis` ولا `setNow(anything)`: الوحدةُ الوحيدةُ في هذا المجالِ هي اليوم
 * (`trialDays` و`communityGraceDays` و`referralWindowDays`)، وواجهةٌ تسمح بأيّ لحظةٍ كانت
 * ستُغري اختباراً بأن يقف على ثانيةٍ قبل الحدِّ أو بعده فيصير هشّاً بلا سبب.
 */
export class MovableClock implements Clock {
  private instant: string;

  constructor(startAt: string) {
    this.instant = startAt;
  }

  now(): string {
    return this.instant;
  }

  advanceDays(days: number): string {
    this.instant = addDays(this.instant, days);
    return this.instant;
  }
}

export interface GateContext {
  /** أصلُ خدمةِ الاشتراك — مُستمعٌ حقيقيٌّ على منفذٍ يمنحه النظام. */
  readonly subscriptionsUrl: string;
  /** أصلُ خدمةِ السمعة — مُستمعٌ حقيقيٌّ آخر. */
  readonly reputationUrl: string;
  /** ساعةُ خدمةِ الاشتراك: تُقدَّم ثمّ تُنادى النبضة. */
  readonly clock: MovableClock;
  /** تبعيّاتُ السمعة، لِتُقرأ منها الحمولاتُ التي أصدرها هو فعلاً. */
  readonly reputation: InMemoryReputationDependencies;
  /** مستهلكُ الوقائعِ في خدمةِ الاشتراك — يُغذَّى بحمولةِ السمعةِ كما هي. */
  readonly facts: ReputationFactConsumer;
  /** حوضُ القاعدةِ للتوكيداتِ التي تُقرأ صفوفاً لا أجساماً. */
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

/**
 * يرفع الخدمتَين بتركيبِهما الإنتاجيِّ: الاشتراكُ على `pg`، والسمعةُ على مُهيئي الذاكرة.
 *
 * ولمَ السمعةُ في الذاكرةِ والاشتراكُ على القاعدة؟ لأنّ البوابةَ تُقيس **مسارَ الاشتراك**:
 * قاعدةُ السمعةِ كانت ستُضيف مُهاجرةً ثانيةً ومصدرَ فشلٍ ثانياً لا يُثبت شيئاً هنا. والذي
 * يجب أن يكون حقيقيّاً في السمعةِ هو **ما تُصدره**، وهو حقيقيٌّ: نفسُ الحدِّ ونفسُ المجالِ
 * ونفسُ مصنعِ الأحداث.
 */
export async function startGate(): Promise<GateContext> {
  const connectionString = process.env.DATABASE_URL!;
  const { pool, db } = createSubscriptionDb({ connectionString });
  await migrateSubscriptions(pool, db, FROZEN_AT);
  await pool.query(`TRUNCATE ${DATA_TABLES.join(", ")} CASCADE`);

  const clock = new MovableClock(T0);
  const uow = new SubscriptionUnitOfWork(db);
  // مُولّدٌ متسلسلٌ لا عشوائيّ: مُعرّفُ الحدثِ قيمةٌ تُقرأ في رسالةِ فشلٍ هنا.
  const ids = sequentialUuidGenerator(1);
  const subscriptionsApp = createSubscriptionApp({
    mode: "postgres",
    services: {
      subscriptions: new SubscriptionService(uow, clock, ids),
      referrals: new ReferralService(uow, clock),
    },
    logger: false,
  });
  await subscriptionsApp.listen({ port: 0, host: "127.0.0.1" });
  const subscriptionsPort = (subscriptionsApp.server.address() as AddressInfo).port;

  const reputation = createInMemoryReputationDependencies({ startAt: REPUTATION_NOW });
  const reputationApp = createReputationApp({
    runner: createDirectReputationRunner(reputation),
    health: { persistence: "memory" },
    logger: false,
  });
  await reputationApp.listen({ port: 0, host: "127.0.0.1" });
  const reputationPort = (reputationApp.server.address() as AddressInfo).port;

  return {
    subscriptionsUrl: `http://127.0.0.1:${subscriptionsPort}`,
    reputationUrl: `http://127.0.0.1:${reputationPort}`,
    clock,
    reputation,
    // نفسُ الساعةِ ونفسُ وحدةِ العمل: المستهلكُ يقيس النافذةَ بالحاضرِ الذي يراه الحدُّ.
    facts: new ReputationFactConsumer(uow, clock, ids),
    pool,
    close: async () => {
      await reputationApp.close();
      await subscriptionsApp.close();
      await pool.end();
    },
  };
}

export interface HttpResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  baseUrl: string,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${init.path}`, {
    method: init.method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/** نداءُ خدمةِ الاشتراك بترويساتِها المُعلَنة (`idempotency-key` · `x-request-id`). */
export async function callSubscriptions(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  return call(gate.subscriptionsUrl, {
    method: init.method,
    path: init.path,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
  });
}

/** نداءُ خدمةِ السمعةِ على مسارها المُعلَن. */
export async function callReputation(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
  },
): Promise<HttpResult> {
  return call(gate.reputationUrl, {
    method: init.method,
    path: init.path,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
    },
  });
}

let counter = 0;

/** مفتاحُ تكرارٍ جديد. كلُّ كتابةٍ هنا تحمل مفتاحَها، والمُعادُ يُطلب صراحةً. */
export function nextKey(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(6, "0")}`;
}

/** مُعرّفٌ عامٌّ بصيغةِ القاعدة: `WS-` وعشرةُ أرقام. */
export function waslaId(seed: number): string {
  return `WS-${String(seed).padStart(10, "0")}`;
}

/** مُعرّفُ UUID ثابتٌ مُشتقٌّ من عدّاد — لا `randomUUID` كي يبقى الفشلُ مقروءاً. */
export function seededUuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, "0");
  return `22222222-2222-4222-8222-${hex}`;
}

/** عددُ صفوفِ جدولٍ — للتوكيداتِ التي تسأل «هل كُتب صفٌّ ثانٍ؟». */
export async function countRows(pool: Pool, table: (typeof DATA_TABLES)[number]): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

/**
 * ## النطاق
 *
 * رفعُ خدمةِ الاشتراكِ على Postgres وخدمةِ السمعةِ في الذاكرةِ على مِقبضَينِ حقيقيَّين،
 * وساعةٌ مُتحرّكةٌ محقونةٌ في الأولى، ومُساعداتُ نداءٍ وعدِّ صفوف.
 *
 * ## آخر تحديث
 *
 * المراجعة 6/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * يحتاج `DATABASE_URL`؛ ويتخطّى نفسَه بلا قاعدةٍ عبر `PG_ENABLED`.
 *
 * ## كودٌ ذو صلة
 *
 * `services/subscriptions/src/http/server.ts` (نفسُ التركيب) ·
 * `services/reputation/src/http/server.ts` · `packages/reputation-e2e/src/harness.ts`.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
