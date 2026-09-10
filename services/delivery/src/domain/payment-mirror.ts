/**
 * قرارُ مرآةِ الدفعِ (ADR-026 §2.2 · §3.2 · المراجعةُ 9/N).
 *
 * هذه الخدمةُ **لا تُعالجُ مالاً**: الحالةُ الماليّةُ تُقرَّرُ عندَ مُزوِّدِ الدفعِ،
 * وما هنا مرآةٌ لمرجعٍ خارجيٍّ. ولذلكَ الدالّةُ لا تسألُ «هل ينبغي التخويلُ؟» بل
 * «هل هذا الانتقالُ ممكنٌ في جدولِ §3.2؟» — والفرقُ بينَهُما هو الفرقُ بينَ مرآةٍ
 * وبينَ خدمةٍ ماليّةٍ ثانيةٍ بلا قرارٍ يُجيزُها.
 *
 * # ثلاثةُ أجوبةٍ لا اثنانِ: apply · noop · رفضٌ
 *
 * `PUT` على مرآةٍ يعني «هذه الحالةُ التي أراها». فإعلانُ الحالةِ **نفسِها**
 * بالمرجعِ **نفسِهِ** ليسَ انتقالاً ثانياً ولا خطأً: هو webhook مُعادٌ، وأجوبةُ
 * المُزوِّدينَ تُعادُ بطبيعتِها. ولو رُفِضَ ذلكَ `409` لكانَ كلُّ مُزوِّدٍ يُعيدُ
 * المحاولةَ يرى فشلاً وهمّياً فيُعيدُ أبداً — وهذا هو عينُ العُطلِ الذي يُنتِجُهُ
 * جدولُ انتقالاتٍ يمنعُ `x → x` بلا استثناءٍ مُعلَنٍ للمرايا.
 *
 * وإعلانُ الحالةِ نفسِها بمرجعٍ **مختلفٍ** ليسَ تكراراً بل تعارضٌ: نيّتانِ ماليّتانِ
 * لطلبٍ واحدٍ، ومن يقبلُهُ صامتاً يُبدّلُ مرجعَ استردادٍ يوماً ما. فيُرفَضُ
 * `409 DELIVERY_TRANSITION_NOT_ALLOWED` بـ`from = to` — والتفصيلُ في `details`.
 *
 * # ولا تُسقِطُ المرآةُ مرجعاً كانَ موجوداً
 *
 * `payment_ref` غيرُ مُرسَلٍ يعني «لا جديدَ عندي»، لا «امسحِ المرجعَ». محوُ مرجعٍ
 * بحذفِ حقلٍ من جسمٍ هو كيفَ يفقدُ طلبٌ خطَّ تدقيقِهِ الماليَّ في أوّلِ webhook
 * مُختصرٍ.
 */

import type { PaymentReasonCode, PaymentState } from "@wasla/contracts-delivery";

import { DeliveryError, illegalTransition } from "./errors.js";
import type { StoreOrder } from "./model.js";
import { PAYMENT_TRANSITIONS, isPaymentTransitionAllowed } from "./state-machine.js";

/** ما يُعلنُهُ المُرسِلُ عن المرآةِ — حالةٌ وسببٌ ومرجعٌ اختياريٌّ. */
export interface PaymentMirrorInput {
  readonly paymentState: PaymentState;
  readonly reasonCode: PaymentReasonCode;
  /** `undefined` = لا جديدَ (يبقى المرجعُ المحفوظُ)، `null` = لا مرجعَ عندَ المُرسِلِ. */
  readonly paymentRef?: string | null;
}

/**
 * القرارُ: تطبيقٌ بانتقالٍ مشروعٍ، أو لا أثرَ لأنَّ المُعلَنَ هو المحفوظُ.
 *
 * `nextPaymentRef` مُحسوبٌ في القرارِ لا في المخزنِ: قاعدةُ «لا تُسقِطُ المرآةُ
 * مرجعاً» قاعدةُ نطاقٍ، ومكانُها الوحيدُ هنا وإلاّ تكرَّرَت في كلِّ محوّلٍ.
 */
export type PaymentMirrorDecision =
  | {
      readonly kind: "apply";
      readonly fromState: PaymentState;
      readonly toState: PaymentState;
      readonly reasonCode: PaymentReasonCode;
      readonly nextPaymentRef: string | null;
    }
  | { readonly kind: "noop"; readonly state: PaymentState };

export function decidePaymentMirror(
  order: StoreOrder,
  input: PaymentMirrorInput,
  traceId?: string,
): PaymentMirrorDecision {
  const from = order.paymentState;
  const to = input.paymentState;
  // المرجعُ المطلوبُ بعدَ هذا الإعلانِ: المُرسَلُ إن أُرسِلَ، وإلاّ المحفوظُ.
  const nextRef = input.paymentRef === undefined ? order.paymentRef : input.paymentRef;

  if (from === to) {
    // إعلانٌ مُعادٌ: نفسُ الحالةِ ونفسُ المرجعِ ⇒ لا أثرَ.
    if (nextRef === order.paymentRef) return { kind: "noop", state: from };
    // نفسُ الحالةِ بمرجعٍ آخرَ ⇒ نيّتانِ لطلبٍ واحدٍ.
    throw new DeliveryError(
      "DELIVERY_TRANSITION_NOT_ALLOWED",
      `مرآةُ الدفعِ في ${from} بمرجعٍ مختلفٍ — نيّتانِ ماليّتانِ لطلبٍ واحدٍ لا تُدمجانِ`,
      { traceId, details: { from, to, field: "payment_ref" } },
    );
  }

  if (!isPaymentTransitionAllowed(from, to)) throw illegalTransition(from, to, traceId);

  // السببُ مربوطٌ بالحافّةِ لا حرّاً: لكلِّ حافّةٍ في §3.2 سببٌ واحدٌ يصفُها، ودفترُ
  // الانتقالاتِ append-only يُقرأُ سنينَ بعدَ كتابتِهِ. فسببٌ لا يصفُ حافّتَهُ
  // (`authorized` بسببِ `REFUND_COMPLETED`) صفٌّ يكذبُ ولا يُصحَّحُ لاحقاً.
  const rule = PAYMENT_TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (rule !== undefined && rule.typicalReason !== input.reasonCode) {
    throw new DeliveryError(
      "DELIVERY_VALIDATION_FAILED",
      `سببُ المرآةِ لا يصفُ الحافّةَ ${from} → ${to}`,
      {
        traceId,
        details: { from, to, field: "reason_code", expected: rule.typicalReason, actual: input.reasonCode },
      },
    );
  }

  return { kind: "apply", fromState: from, toState: to, reasonCode: input.reasonCode, nextPaymentRef: nextRef };
}
