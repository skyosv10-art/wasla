/**
 * الموضع الوحيد الذي يصير فيه النموذج الداخلي (`camelCase`) شكلَ السلك (`snake_case`)
 * المنشور في `contracts/api.openapi.yml` (Phase 08 · MR 4/6).
 *
 * ## لماذا موضعٌ واحد
 *
 * البديل أن يظهر مفتاح `snake_case` في كل مكان تُبنى فيه استجابة، فيصير يومُ إعادة
 * تسمية حقلٍ يوماً تكتمل فيه التسمية في أربعة ملفات من خمسة. المحوّل الذي يعيش وحده
 * يمكن مقارنته بقوائم `required` في العقد — وهو ما يفعله `__tests__/http-contract.test.ts`،
 * فيفشل البناءُ عند تغيير عقدٍ بلا تغيير محوّل، لا يفشل العميل.
 *
 * والاتجاه مهمّ أيضاً: طبقة HTTP تُحلّل **إلى** الحمولات التي تُعلنها حالات الاستخدام
 * أصلاً (`open_thread` تقبل `snake_case` لأن عقدها هكذا)، فلا شيء أسفل هذا الملف يرى
 * مفتاحاً لا يعرفه.
 *
 * ## ما لا يخرج من هنا
 *
 * لا `body` رسالةٍ في أي حدث، ولا مبلغٌ في أي خطأ، ولا صفّ `negotiation_price_handoffs`
 * كامل في استجابة عامّة: حالة التسليم تُقرأ من `Agreement.handoff_state` و`handoff_attempts`
 * و`last_error_code` وهي الحقول التي أعلنها العقد. سجلّ المحاولات نفسه أثرٌ تشغيليّ
 * (`NEGOTIATION_PERSISTENCE.md` §2) ولا مسارَ في العقد يُصدره، ولذلك **لا محوّل له هنا**:
 * محوّلٌ بلا مسارٍ يستعمله يدعو أوّل من يقرأه أن يجد له استعمالاً.
 */

import type {
  NegotiationAgreement,
  NegotiationMessage,
  NegotiationRound,
  NegotiationThread,
  NegotiationTickResult,
} from "./domain/model.js";

// ---------------------------------------------------------------------------
// الخيط
// ---------------------------------------------------------------------------

export interface NegotiationThreadWire {
  readonly id: string;
  readonly order_public_id: string;
  readonly customer_public_id: string;
  readonly driver_public_id: string;
  readonly dispatch_offer_id: string;
  readonly service_kind: string;
  readonly state: string;
  readonly close_reason_code: string | null;
  readonly policy_version: number;
  readonly currency: string;
  readonly opening_amount_minor: number;
  readonly opened_by: string;
  readonly round_count: number;
  readonly current_round_no: number;
  readonly agreed_round_no: number | null;
  readonly expires_at: string;
  readonly next_tick_at: string | null;
  readonly closed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

/**
 * الخيط كما يُنشَر، و`version` معه.
 *
 * الرقم يُعاد ولا يُحجب، لأنّ المستهلك يحتاج أن يكشف تغيّراً بين قراءته وفعله؛ وهو
 * الحقل الوحيد في هذا الجسم الذي لا يعني شيئاً للمستخدم ويعني كل شيء للعميل البرمجي.
 */
export function threadToWire(thread: NegotiationThread): NegotiationThreadWire {
  return {
    id: thread.id,
    order_public_id: thread.orderPublicId,
    customer_public_id: thread.customerPublicId,
    driver_public_id: thread.driverPublicId,
    dispatch_offer_id: thread.dispatchOfferId,
    service_kind: thread.serviceKind,
    state: thread.state,
    close_reason_code: thread.closeReasonCode,
    policy_version: thread.policyVersion,
    currency: thread.currency,
    opening_amount_minor: thread.openingAmountMinor,
    opened_by: thread.openedBy,
    round_count: thread.roundCount,
    current_round_no: thread.currentRoundNo,
    agreed_round_no: thread.agreedRoundNo,
    expires_at: thread.expiresAt,
    next_tick_at: thread.nextTickAt,
    closed_at: thread.closedAt,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    version: thread.version,
  };
}

// ---------------------------------------------------------------------------
// الدور
// ---------------------------------------------------------------------------

export interface NegotiationRoundWire {
  readonly id: string;
  readonly thread_id: string;
  readonly round_no: number;
  readonly proposed_by: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly state: string;
  readonly resolved_by: string | null;
  readonly expires_at: string;
  readonly responded_at: string | null;
  readonly created_at: string;
}

export function roundToWire(round: NegotiationRound): NegotiationRoundWire {
  return {
    id: round.id,
    thread_id: round.threadId,
    round_no: round.roundNo,
    proposed_by: round.proposedBy,
    amount_minor: round.amountMinor,
    currency: round.currency,
    state: round.state,
    resolved_by: round.resolvedBy,
    expires_at: round.expiresAt,
    responded_at: round.respondedAt,
    created_at: round.createdAt,
  };
}

// ---------------------------------------------------------------------------
// الرسالة
// ---------------------------------------------------------------------------

export interface NegotiationMessageWire {
  readonly id: string;
  readonly thread_id: string;
  readonly sequence_no: number;
  readonly author_role: string;
  readonly body: string | null;
  readonly system_code: string | null;
  readonly round_no: number | null;
  readonly source_locale: string;
  readonly redacted_at: string | null;
  readonly redaction_reason_code: string | null;
  readonly created_at: string;
}

/**
 * الرسالة كما تُنشَر، والمحجوبةُ منها تُعاد بلا نصّ ومعها سببُ حجبها.
 *
 * حذفُها من القائمة كان البديل الأسهل، وهو الذي يُنتج ثغرةً في `sequence_no` يفسّرها
 * القارئ التالي خطأً بأنّها خطأ نظام.
 *
 * و`body` يُمرَّر كما هو ولا يُفرَّغ هنا مرّةً ثانية: الحجب يُفرّغ النصّ في المخزن نفسه،
 * ويحرسه القيد `ck_negotiation_messages_redaction` في `schema.sql`. تفريغٌ إضافي في هذه
 * الطبقة يبدو حرصاً وهو في الحقيقة جوابٌ ثانٍ عن السؤال نفسه: لو تسرّب نصٌّ محجوب إلى
 * صفٍّ يوماً، لأخفاه هذا السطر عن الاختبار الذي كان سيكشفه.
 */
export function messageToWire(message: NegotiationMessage): NegotiationMessageWire {
  return {
    id: message.id,
    thread_id: message.threadId,
    sequence_no: message.sequenceNo,
    author_role: message.authorRole,
    body: message.body,
    system_code: message.systemCode,
    round_no: message.roundNo,
    source_locale: message.sourceLocale,
    redacted_at: message.redactedAt,
    redaction_reason_code: message.redactionReasonCode,
    created_at: message.createdAt,
  };
}

// ---------------------------------------------------------------------------
// الاتفاق
// ---------------------------------------------------------------------------

export interface NegotiationAgreementWire {
  readonly thread_id: string;
  readonly order_public_id: string;
  readonly driver_public_id: string;
  readonly round_no: number;
  readonly amount_minor: number;
  readonly currency: string;
  readonly accepted_by: string;
  readonly policy_version: number;
  readonly agreed_at: string;
  readonly handoff_state: string;
  readonly handoff_attempts: number;
  readonly handed_off_at: string | null;
  readonly next_handoff_at: string | null;
  readonly last_error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * الاتفاق، ومعه حالةُ تسليمه إلى محرّك الطلب.
 *
 * `handoff_state` و`handoff_attempts` و`last_error_code` على جسم **ناجح** لا على خطأ،
 * وهو جوهر القرار 2 في ADR-013: فشلُ التسليم لا يُبطل الاتفاق، فيرى المستهلك «اتُّفق ولم
 * يُسجَّل بعد» بدل أن يظنّ أنّ القبول لم يقع.
 */
export function agreementToWire(agreement: NegotiationAgreement): NegotiationAgreementWire {
  return {
    thread_id: agreement.threadId,
    order_public_id: agreement.orderPublicId,
    driver_public_id: agreement.driverPublicId,
    round_no: agreement.roundNo,
    amount_minor: agreement.amountMinor,
    currency: agreement.currency,
    accepted_by: agreement.acceptedBy,
    policy_version: agreement.policyVersion,
    agreed_at: agreement.agreedAt,
    handoff_state: agreement.handoffState,
    handoff_attempts: agreement.handoffAttempts,
    handed_off_at: agreement.handedOffAt,
    next_handoff_at: agreement.nextHandoffAt,
    last_error_code: agreement.lastErrorCode,
    created_at: agreement.createdAt,
    updated_at: agreement.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// النبضة والصحّة
// ---------------------------------------------------------------------------

export interface NegotiationTickResultWire {
  readonly ticked_at: string;
  readonly rounds_expired: number;
  readonly threads_expired: number;
  readonly threads_closed_max_rounds: number;
  readonly handoffs_attempted: number;
  readonly handoffs_succeeded: number;
  readonly handoff_failures: number;
}

/**
 * عدّادات النبضة، وهي كلّ جواب `POST /negotiations/tick`.
 *
 * `handoff_failures` يُعاد على `200` ولا يُحوَّل إلى خطأ: النبضة عمليّة جماعية، ورفعُ
 * خطأٍ لأجل اتفاقٍ واحد يُوقف بقيّة العمل ويُخفي الفشل عن العدّاد الذي يُراقَب
 * (`contracts/errors.md` §ما لا يُنتجه أي رمز).
 */
export function tickResultToWire(result: NegotiationTickResult): NegotiationTickResultWire {
  return {
    ticked_at: result.tickedAt,
    rounds_expired: result.roundsExpired,
    threads_expired: result.threadsExpired,
    threads_closed_max_rounds: result.threadsClosedMaxRounds,
    handoffs_attempted: result.handoffsAttempted,
    handoffs_succeeded: result.handoffsSucceeded,
    handoff_failures: result.handoffFailures,
  };
}

export interface HealthStatusWire {
  readonly status: "ok" | "degraded";
  readonly persistence: "postgres" | "memory";
  readonly last_tick_at: string | null;
}

export function healthToWire(input: {
  readonly status: "ok" | "degraded";
  readonly persistence: "postgres" | "memory";
  readonly lastTickAt: string | null;
}): HealthStatusWire {
  return {
    status: input.status,
    persistence: input.persistence,
    last_tick_at: input.lastTickAt,
  };
}
