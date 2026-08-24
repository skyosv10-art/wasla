/**
 * الحدُّ بين أسماءِ المجال (`camelCase`) وأسماءِ السلك (`snake_case`) — **حقلاً حقلاً**.
 *
 * ## لماذا يدويّاً ولا محوّلَ عامّ
 *
 * كلُّ مخطّطٍ في `api.openapi.yml` يُعلن `additionalProperties: false` وقائمةَ حقولٍ
 * إلزاميّةٍ معدودةً. فمحوّلٌ عامٌّ من camel إلى snake يُمرّر تلقائيّاً كلَّ حقلٍ يُضاف إلى
 * نوعٍ داخليٍّ غداً، فيصير جوابُنا مرفوضاً عند مستهلكٍ صارمٍ (والبوّابةُ صارمة) بينما
 * سجلّاتُنا تقول `200`. والأخطرُ عكسُه: حقلٌ داخليٌّ حسّاسٌ يُسرَّب بلا قرار.
 *
 * وهذه الخدمةُ فيها ثلاثةُ أمثلةٍ حقيقيةٍ لحقولٍ **لا تخرج**:
 *
 * - `PlanVersion.referralRewardDays` و`referralQualifyingFacts` و`referralWindowDays`:
 *   أرقامُ سياسةِ إحالةٍ داخليةٍ لا يُعلنها `SubscriptionPlan`، ونشرُها يجعل عميلاً يحسب
 *   المكافأةَ عنده ويُظهر للسائق يوماً لن يُمنح.
 * - `ProjectionRecord.currentPeriodId` و`stateChangedAt`: `SubscriptionState` لا يُعلنهما،
 *   ومُعرّفُ مدّةٍ داخليٌّ في جوابٍ عامٍّ يصير مفتاحاً يبني عليه عميلٌ نداءً لا وجودَ له.
 * - `ReferralRecord.planCode` و`planVersion` و`claimedAt`: `Referral` يُعلن `created_at`
 *   و`state_changed_at` ولا يُعلن لقطةَ الخطّة؛ وهي محفوظةٌ في الصفّ للتدقيق لا للعرض.
 *
 * ## والمفاتيحُ تُكتب صريحةً حتى تفشل الترجمةُ لا العميل
 *
 * يومَ يُحذف حقلٌ من نوعٍ داخليٍّ يسقط هذا الملفُّ في `tsc`، ويومَ يُضاف يبقى الجوابُ
 * مطابقاً للعقد حتى يُقرَّر إعلانُه. وهذا نصُّ ما يحرسه `__tests__/http-drift.test.ts`:
 * مجموعةُ مفاتيحِ كلّ محوّلٍ تساوي قائمةَ `required` في المخطّط المقابل بالضبط.
 */

import type { PeriodRecord } from "../db/repository.js";
import type { ReferralCodeRecord, ReferralRecord } from "../db/referrals.js";
import type { StateView, TickOutcome } from "../app/subscriptions.js";
import type { Entitlement, PlanVersion } from "../domain/model.js";

export interface EntitlementWire {
  readonly entitlement_code: string;
  readonly limit_value: number;
}

export interface PlanWire {
  readonly plan_code: string;
  readonly plan_version: number;
  readonly label: string;
  readonly trial_days: number;
  readonly duration_days: number;
  readonly community_grace_days: number;
  readonly community_daily_order_cap: number;
  readonly is_frozen: boolean;
  readonly entitlements: readonly EntitlementWire[];
}

export interface StateWire {
  readonly driver_public_id: string;
  readonly subscription_id: string;
  readonly state: string;
  readonly plan_code: string;
  readonly plan_version: number;
  readonly started_at: string;
  readonly expires_at: string | null;
  readonly state_sequence: number;
  readonly is_stale: boolean;
  readonly entitlements: readonly EntitlementWire[];
  readonly computed_at: string;
}

export interface PeriodWire {
  readonly period_id: string;
  readonly driver_public_id: string;
  readonly plan_code: string;
  readonly plan_version: number;
  readonly source: string;
  readonly payment_reference: string | null;
  readonly granted_days: number;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly created_at: string;
}

export interface ReferralWire {
  readonly referral_id: string;
  readonly referral_code: string;
  readonly referrer_public_id: string;
  readonly referee_public_id: string;
  readonly state: string;
  readonly reason_code: string | null;
  readonly qualifying_fact_count: number;
  readonly window_ends_at: string;
  readonly created_at: string;
  readonly state_changed_at: string;
  readonly reward: null;
}

export interface ReferralCodeWire {
  readonly referral_code: string;
  readonly owner_public_id: string;
  readonly is_active: boolean;
  readonly created_at: string;
}

export interface TickWire {
  readonly ran_at: string;
  readonly periods_ended: number;
  readonly subscriptions_expired: number;
  readonly subscriptions_moved_to_community: number;
  readonly referrals_qualified: number;
  readonly rewards_applied: number;
  readonly failures: number;
}

export interface HealthWire {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly mode: "postgres" | "memory";
  readonly last_tick_at: string | null;
}

function toEntitlements(grants: ReadonlyArray<Entitlement>): readonly EntitlementWire[] {
  return grants.map((grant) => ({
    entitlement_code: grant.entitlementCode,
    limit_value: grant.limitValue,
  }));
}

export function toPlanWire(plan: PlanVersion): PlanWire {
  return {
    plan_code: plan.planCode,
    plan_version: plan.planVersion,
    label: plan.label,
    trial_days: plan.trialDays,
    duration_days: plan.durationDays,
    community_grace_days: plan.communityGraceDays,
    community_daily_order_cap: plan.communityDailyOrderCap,
    is_frozen: plan.isFrozen,
    entitlements: toEntitlements(plan.entitlements),
  };
}

/**
 * الحالةُ على السلك: من الصفِّ المُتحقِّق ومن استحقاقاتِ خطّتِه.
 *
 * `computed_at` هي لحظةُ آخرِ إعادةِ بناءٍ للصفّ لا لحظةُ هذه القراءة: القراءةُ لا تشتقّ ولا
 * تكتب (القرار 2)، وختمُها بلحظةِ الآن كان سيقول للمستهلك «هذا حُسب الآن» وهو غيرُ صحيح —
 * وذاك بالضبط ما يجعل `is_stale` بلا معنى.
 */
export function toStateWire(view: StateView): StateWire {
  return {
    driver_public_id: view.projection.driverPublicId,
    subscription_id: view.projection.subscriptionId,
    state: view.projection.state,
    plan_code: view.projection.planCode,
    plan_version: view.projection.planVersion,
    started_at: view.projection.startedAt,
    expires_at: view.projection.expiresAt,
    state_sequence: view.projection.stateSequence,
    is_stale: view.isStale,
    entitlements: toEntitlements(view.entitlements),
    computed_at: view.projection.computedAt,
  };
}

export function toPeriodWire(period: PeriodRecord): PeriodWire {
  return {
    period_id: period.periodId,
    driver_public_id: period.driverPublicId,
    plan_code: period.planCode,
    plan_version: period.planVersion,
    source: period.source,
    payment_reference: period.paymentReference,
    granted_days: period.grantedDays,
    starts_at: period.startsAt,
    ends_at: period.endsAt,
    created_at: period.createdAt,
  };
}

/**
 * الإحالةُ على السلك — و`reward` تُعلَن `null` صراحةً في هذه المراجعة.
 *
 * العقدُ يُلزم الحقلَ (`required`) ويُبيح `null`. والمكافأةُ جدولٌ لا يُكتب قبل المراجعة
 * 5/6، فإسقاطُ الحقلِ كان سيُنتج جواباً غيرَ مطابقٍ للمخطّط، وتلفيقُ كائنِ مكافأةٍ فارغٍ
 * كان أسوأَ: مستهلكٌ يقرأ `reward.reward_days` صفراً ويظنّ أنّ منحةً بلا أيّامٍ مُنحت.
 * والنوعُ هنا `null` حرفيّاً لا `ReferralRewardWire | null` كي يسقط هذا الملفُّ في `tsc`
 * يومَ تصير المكافأةُ موجودةً ولا تُقرأ — فلا يبقى `null` صامتاً بعد أن يصير خطأً.
 */
export function toReferralWire(referral: ReferralRecord): ReferralWire {
  return {
    referral_id: referral.referralId,
    referral_code: referral.referralCode,
    referrer_public_id: referral.referrerPublicId,
    referee_public_id: referral.refereePublicId,
    state: referral.state,
    reason_code: referral.reasonCode,
    qualifying_fact_count: referral.qualifyingFactCount,
    window_ends_at: referral.windowEndsAt,
    created_at: referral.createdAt,
    state_changed_at: referral.stateChangedAt,
    reward: null,
  };
}

export function toReferralCodeWire(code: ReferralCodeRecord): ReferralCodeWire {
  return {
    referral_code: code.referralCode,
    owner_public_id: code.ownerPublicId,
    is_active: code.isActive,
    created_at: code.createdAt,
  };
}

export function toTickWire(outcome: TickOutcome): TickWire {
  return {
    ran_at: outcome.ranAt,
    periods_ended: outcome.periodsEnded,
    subscriptions_expired: outcome.subscriptionsExpired,
    subscriptions_moved_to_community: outcome.subscriptionsMovedToCommunity,
    referrals_qualified: outcome.referralsQualified,
    rewards_applied: outcome.rewardsApplied,
    failures: outcome.failures,
  };
}
