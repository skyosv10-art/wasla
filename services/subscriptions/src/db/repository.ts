/**
 * مخزنُ الدفتر على PostgreSQL — **إضافةٌ فقط**، ولا اشتقاقَ حالةٍ فيه.
 *
 * ## أربعُ قواعدَ يوجد هذا الملفّ لحمايتها
 *
 * **1) لا `UPDATE` على الحالة أبداً** (ADR-015 القرار 2). لا يملك هذا الملفُّ دالّةَ تعديلٍ
 * ولا حذفٍ: `insertPeriod` و`insertTransition` تُضيفان صفّاً، و`listPeriods` تقرأ.
 * والاشتقاقُ يبقى في `domain/state.ts` ويُنادى **بعد** القراءة — فحذفُ جدولِ الحالة
 * المُتحقِّقة يبقى عملاً بلا خسارة. وحارسٌ نصّيٌّ في `purity.test.ts` يُثبت غيابَ
 * `.update(`/`.delete(` من كلّ `src/`: عمودُ `state` يُحدَّث بلا دفترٍ تحته هو النسخةُ
 * الخاطئةُ الأرخص، وهي التي تجعل سؤالَ «لماذا هذا السائق `active`؟» بلا جواب.
 *
 * **2) التجديدُ ليس انتقالاً** (القرار 3). تمديدُ الاشتراك صفٌّ في `subscription_periods`
 * ولا صفَّ في `subscription_transitions`؛ والقاعدةُ نفسُها ترفض `active → active`
 * (`ck_subscription_transitions_state_changes`)، ويُترجَم رفضُها إلى
 * `SUBSCRIPTION_TRANSITION_NOT_ALLOWED` بنفس الرمز الذي يرميه `assertTransition` في المجال.
 * فمن حاول أن يكتب تجديداً انتقالاً وجد نفسَ الخطأ من الطبقتين.
 *
 * **3) المُعرّفُ من المحرّك لا من الكود.** `gen_random_uuid()` داخل نفس عبارةِ الإدخال
 * و`RETURNING` يُعيد ما كُتب فعلاً. ولمَ لا `randomUUID()` في العملية؟ لأنّ المسوّدةَ في هذا
 * المجال **بلا مُعرّفٍ بقصد** (`PeriodDraft`)، ولأنّ العشوائيةَ في `src/` تُبطل «نفسُ
 * المُدخل ⇒ نفسُ المُخرج» ويحرسها `purity.test.ts`. والمُعرّفُ الذي يُعيده المحرّك هو
 * المُعرّفُ الذي في الصفّ، لا واحدٌ نأمل أن يكون قد وصل.
 *
 * **4) الترجمةُ حقلاً حقلاً بأسماءٍ صريحة.** `toPeriod` تُسمّي كلَّ حقلٍ من عمودِه، ولا
 * `...row` ولا نسخَ تلقائيّ: النسخُ التلقائيُّ يمرّ على اختلافِ الأنواع (لحظةُ Postgres
 * كائنُ `Date` لا نصُّ ISO) فيُسلّم إلى المجال قيمةً يقبلها TypeScript ويرفضها
 * `assertTimestamp` في أوّل حسابٍ حقيقيّ — وذاك عطبٌ يظهر بعيداً عن سببه
 * (HANDOFF §16-ز · سابقةُ Phase 09 · المراجعة 3/6).
 *
 * وليس في هذا الملفّ سطرُ SQL نصّيّ: مُنشئُ استعلامات Drizzle وحده، فيبقى اسمُ كلّ عمودٍ
 * مقروناً بالمرآة المحروسةِ بحارس الانحراف.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { transitionNotAllowed, validationFailed } from "../domain/errors.js";
import type {
  Period,
  PeriodDraft,
  PlanVersion,
  TransitionDraft,
} from "../domain/model.js";
import type {
  SubscriptionPeriodSource,
  SubscriptionState,
  SubscriptionTransitionReason,
} from "../domain/contract-sets.js";
import type { DbOrTx } from "./client.js";
import {
  subscriptionPeriods,
  subscriptionPlanEntitlements,
  subscriptionPlans,
  subscriptionTransitions,
} from "./schema.js";

// ---------------------------------------------------------------------------
// تحويلُ اللحظات وترجمةُ القيود
// ---------------------------------------------------------------------------

/** لحظةٌ إلزاميّة إلى نصّ ISO — تحويلُ صيغةٍ نقيٌّ لا قراءةُ ساعة. */
function iso(value: Date): string {
  return value.toISOString();
}

/** أسماءُ القيودِ التي يعرفها هذا المخزنُ ويُترجمها — ما عداها يصعد كما هو. */
export const TRANSLATED_CONSTRAINTS: ReadonlyArray<string> = Object.freeze([
  "ck_subscription_periods_payment_reference",
  "ck_subscription_periods_window",
  "ck_subscription_transitions_genesis",
  "ck_subscription_transitions_state_changes",
  "fk_subscription_periods_plan",
  "ux_subscription_transitions_sequence",
]);

/**
 * يقرأ اسمَ القيد من خطأ Postgres عبر سلسلةِ `cause`.
 *
 * Drizzle يُغلّف خطأَ العميل، فقراءةُ `error.constraint` على السطح وحدها كانت ستُخطئ الاسمَ
 * وتُصعّد خطأً خاماً بلا معنى للمُنادي.
 */
function constraintOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object"; depth += 1) {
    const named = current as { readonly constraint?: unknown; readonly cause?: unknown };
    if (typeof named.constraint === "string" && named.constraint.length > 0) {
      return named.constraint;
    }
    current = named.cause;
  }
  return undefined;
}

/**
 * يُحوّل قيداً مُسمّىً إلى خطأِ مجالٍ **بنفس الرمز** الذي يرميه المجال، وما لا يعرفه يُعيده.
 *
 * خطأٌ غيرُ متوقَّعٍ (انقطاعُ اتصالٍ · ترحيلٌ ناقص) يجب أن يصعد بصورته الأولى: تحويلُه إلى
 * `SUBSCRIPTION_VALIDATION_FAILED` كان سيُخفي عطبَ بيئةٍ تحت رمزٍ يوحي بأنّ المُرسل أخطأ.
 */
function translate(error: unknown, context: TransitionContext | null): never {
  const constraint = constraintOf(error);
  if (constraint === "ck_subscription_transitions_state_changes" && context) {
    throw transitionNotAllowed(context.fromState, context.toState);
  }
  if (constraint === "ck_subscription_transitions_genesis" && context) {
    throw transitionNotAllowed(context.fromState, context.toState);
  }
  if (constraint === "ck_subscription_periods_payment_reference") {
    throw validationFailed("payment_reference", "present if and only if source is payment");
  }
  if (constraint === "ck_subscription_periods_window") {
    throw validationFailed("ends_at", "instant after starts_at");
  }
  throw error;
}

interface TransitionContext {
  readonly fromState: SubscriptionState | null;
  readonly toState: SubscriptionState;
}

// ---------------------------------------------------------------------------
// صفوفٌ ونماذج — الترجمةُ في موضعٍ واحد
// ---------------------------------------------------------------------------

interface PeriodRow {
  readonly periodId: string;
  readonly driverPublicId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly source: string;
  readonly paymentReference: string | null;
  readonly grantedDays: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** صفٌّ إلى `Period` — حقلاً حقلاً بالاسم، ولحظاتٌ نصّاً ISO. */
export function toPeriod(row: PeriodRow): Period {
  return {
    periodId: row.periodId,
    driverPublicId: row.driverPublicId,
    planCode: row.planCode,
    planVersion: row.planVersion,
    source: row.source as SubscriptionPeriodSource,
    paymentReference: row.paymentReference,
    grantedDays: row.grantedDays,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
  };
}

/** انتقالٌ كما استقرّ في الدفتر: بمُعرّفٍ وتسلسلٍ لا يملكهما المجال. */
export interface TransitionRecord {
  readonly transitionId: string;
  readonly driverPublicId: string;
  readonly fromState: SubscriptionState | null;
  readonly toState: SubscriptionState;
  readonly reasonCode: SubscriptionTransitionReason;
  readonly periodId: string | null;
  readonly sequence: number;
  readonly occurredAt: string;
}

interface TransitionRow {
  readonly transitionId: string;
  readonly driverPublicId: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reasonCode: string;
  readonly periodId: string | null;
  readonly sequence: number;
  readonly occurredAt: Date;
}

function toTransition(row: TransitionRow): TransitionRecord {
  return {
    transitionId: row.transitionId,
    driverPublicId: row.driverPublicId,
    fromState: row.fromState as SubscriptionState | null,
    toState: row.toState as SubscriptionState,
    reasonCode: row.reasonCode as SubscriptionTransitionReason,
    periodId: row.periodId,
    sequence: row.sequence,
    occurredAt: iso(row.occurredAt),
  };
}

// ---------------------------------------------------------------------------
// المخزن
// ---------------------------------------------------------------------------

/** أثرٌ اختياريٌّ يُلحق بالصفّ: مُعرّفُ الحدثِ المُسبِّب ورقمُ التتبّع، ولا نصَّ حرًّا. */
export interface LedgerTrace {
  readonly sourceEventId?: string | null;
  readonly traceId?: string | null;
}

export class PostgresSubscriptionLedger {
  constructor(private readonly db: DbOrTx) {}

  /**
   * تُضيف مُدّةً إلى الدفتر وتُعيدها بمُعرّفِ المحرّك.
   *
   * لا تحسب هذه الدالّةُ يوماً ولا نهايةً: `PeriodDraft` تأتي محسوبةً من
   * `domain/periods.ts` (بـ`laterOf` كي لا تُضيَّع بقيّةُ مُدّةٍ سارية)، والمخزنُ يكتب ما
   * أُعطي. مخزنٌ يحسب `endsAt` بنفسه كان سيصير مصدرَ حقيقةٍ ثانياً لمدّةِ الدورة.
   */
  async insertPeriod(draft: PeriodDraft, trace: LedgerTrace = {}): Promise<Period> {
    try {
      const rows = await this.db
        .insert(subscriptionPeriods)
        .values({
          periodId: sql`gen_random_uuid()`,
          driverPublicId: draft.driverPublicId,
          planCode: draft.planCode,
          planVersion: draft.planVersion,
          source: draft.source,
          paymentReference: draft.paymentReference,
          grantedDays: draft.grantedDays,
          startsAt: new Date(draft.startsAt),
          endsAt: new Date(draft.endsAt),
          sourceEventId: trace.sourceEventId ?? null,
          traceId: trace.traceId ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("period", "one inserted row");
      return toPeriod(row);
    } catch (error) {
      translate(error, null);
    }
  }

  /**
   * تقرأ دفترَ سائقٍ مرتّباً بالبداية ثمّ بالإنشاء.
   *
   * الترتيبُ ليس تجميلاً: `coverageRuns` تبني سلاسلَ التغطية على ترتيبِ البداية، ودفترٌ
   * يعود بترتيبٍ غيرِ محدَّدٍ كان سينتج حالةً تختلف بين استدعاءين على نفس البيانات —
   * وأسوأُ من الخطأ خطأٌ لا يتكرّر. و`created_at` فاصلٌ ثانٍ لمدّتَين تبدآن في نفس اللحظة.
   */
  async listPeriods(driverPublicId: string): Promise<ReadonlyArray<Period>> {
    const rows = await this.db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.driverPublicId, driverPublicId))
      .orderBy(asc(subscriptionPeriods.startsAt), asc(subscriptionPeriods.createdAt));
    return rows.map(toPeriod);
  }

  /**
   * تُضيف انتقالاً بتسلسلٍ يليه آخرَ ما في الدفتر.
   *
   * والتسلسلُ يُقرأ ثمّ يُكتب، وذاك ليس سباقاً مسكوتاً عنه: `ux_subscription_transitions_sequence`
   * قيدٌ في القاعدة، فمُحاولتان متزامنتان تنجح إحداهما وتفشل الأخرى **فشلاً مُسمّىً** يُعاد
   * تشغيلُ العملية بعده — بينما اختراعُ التسلسل في الذاكرة بلا قيدٍ كان سيُنتج انتقالين
   * برقمٍ واحدٍ يعيشان في الدفتر إلى الأبد. والقفلُ على مستوى السائق يأتي مع وحدةِ العمل
   * في المراجعة 4/6.
   */
  async insertTransition(
    input: {
      readonly driverPublicId: string;
      readonly draft: TransitionDraft;
      readonly periodId?: string | null;
    },
    trace: LedgerTrace = {},
  ): Promise<TransitionRecord> {
    const context: TransitionContext = {
      fromState: input.draft.fromState,
      toState: input.draft.toState,
    };
    const previous = await this.db
      .select({ sequence: subscriptionTransitions.sequence })
      .from(subscriptionTransitions)
      .where(eq(subscriptionTransitions.driverPublicId, input.driverPublicId))
      .orderBy(desc(subscriptionTransitions.sequence))
      .limit(1);
    const nextSequence = (previous[0]?.sequence ?? 0) + 1;

    try {
      const rows = await this.db
        .insert(subscriptionTransitions)
        .values({
          transitionId: sql`gen_random_uuid()`,
          driverPublicId: input.driverPublicId,
          fromState: input.draft.fromState,
          toState: input.draft.toState,
          reasonCode: input.draft.reasonCode,
          periodId: input.periodId ?? null,
          sequence: nextSequence,
          occurredAt: new Date(input.draft.occurredAt),
          traceId: trace.traceId ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("transition", "one inserted row");
      return toTransition(row);
    } catch (error) {
      translate(error, context);
    }
  }

  /** تقرأ دفترَ الانتقالات بترتيب التسلسل — للحالةِ المُتحقِّقة في 4/6 وللاختبار. */
  async listTransitions(driverPublicId: string): Promise<ReadonlyArray<TransitionRecord>> {
    const rows = await this.db
      .select()
      .from(subscriptionTransitions)
      .where(eq(subscriptionTransitions.driverPublicId, driverPublicId))
      .orderBy(asc(subscriptionTransitions.sequence));
    return rows.map(toTransition);
  }

  /**
   * تقرأ نسخةَ خطّةٍ من القاعدة كما بذرتها المُهاجرة — حقلاً حقلاً باستحقاقاتها.
   *
   * وجودُها هو ما يجعل بوّابةَ هذه المراجعة قابلةً للفحص: الاختبارُ يقرأ الطرفين
   * (`LAUNCH_PLAN` من الكتالوج، وهذه من القاعدة) ويقارنهما بـ`toEqual`، فلا تمرّ بذرةٌ
   * ناقصةُ حقلٍ ولا مُعادُ كتابتِه برقمٍ آخر.
   */
  async readPlanVersion(planCode: string, planVersion: number): Promise<PlanVersion | null> {
    const plans = await this.db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.planCode, planCode),
          eq(subscriptionPlans.planVersion, planVersion),
        ),
      )
      .limit(1);
    const plan = plans[0];
    if (!plan) return null;

    const entitlementRows = await this.db
      .select()
      .from(subscriptionPlanEntitlements)
      .where(
        and(
          eq(subscriptionPlanEntitlements.planCode, planCode),
          eq(subscriptionPlanEntitlements.planVersion, planVersion),
        ),
      )
      .orderBy(asc(subscriptionPlanEntitlements.entitlementCode));

    return {
      planCode: plan.planCode,
      planVersion: plan.planVersion,
      label: plan.label,
      trialDays: plan.trialDays,
      durationDays: plan.durationDays,
      communityGraceDays: plan.communityGraceDays,
      communityDailyOrderCap: plan.communityDailyOrderCap,
      referralRewardDays: plan.referralRewardDays,
      referralQualifyingFacts: plan.referralQualifyingFacts,
      referralWindowDays: plan.referralWindowDays,
      isFrozen: plan.isFrozen,
      entitlements: entitlementRows.map((row) => ({
        entitlementCode: row.entitlementCode as PlanVersion["entitlements"][number]["entitlementCode"],
        limitValue: row.limitValue,
      })),
    };
  }

  /** لحظةُ تجميدِ نسخةٍ كما استقرّت في القاعدة — واقعةُ تشغيلٍ لا حقلٌ في الوعد. */
  async readPlanFrozenAt(planCode: string, planVersion: number): Promise<string | null> {
    const rows = await this.db
      .select({ frozenAt: subscriptionPlans.frozenAt })
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.planCode, planCode),
          eq(subscriptionPlans.planVersion, planVersion),
        ),
      )
      .limit(1);
    const frozenAt = rows[0]?.frozenAt ?? null;
    return frozenAt === null ? null : iso(frozenAt);
  }
}
