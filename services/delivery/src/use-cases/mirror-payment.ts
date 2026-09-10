/**
 * تحديثُ مرآةِ الدفعِ (ADR-026 §2.2 · §3.2 · المراجعةُ 9/N).
 *
 * اقرأِ الطلبَ، اسألِ النطاقَ هل الانتقالُ ممكنٌ، ثمّ اكتُبِ القرارَ كلَّهُ في
 * معاملةٍ واحدةٍ محروسةٍ بالنسخةِ التي قُرِئت عليها. نفسُ هيكلِ الإلغاءِ، ولذلكَ
 * نفسُ الحرسِ: `expectedVersion` يسافرُ مع الكتابةِ.
 *
 * # الإعلانُ الذي لا أثرَ لهُ لا يكتبُ مفتاحاً
 *
 * مرآةٌ تُعلنُ ما هيَ عليهِ أصلاً تُجابُ `200` بالطلبِ كما هوَ، ولا صفَّ دفترٍ ولا
 * حدثَ ولا صفَّ مفتاحِ تماثُلٍ. ومفتاحُ التماثُلِ يوجدُ ليمنعَ **أثراً** مضاعفاً،
 * وحيثُ لا أثرَ لا شيءَ يُمنَعُ؛ وحفظُ مفتاحٍ لعمليّةٍ لم تكتُب شيئاً كانَ سيجعلُ
 * دفترَ المفاتيحِ ينمو بصفوفٍ لا تحرسُ شيئاً — وهيَ نفسُها الصفوفُ التي يُطالِبُ
 * §4.10 بمكنسةٍ لها.
 *
 * # ولا حدثَ لمرآةٍ لم تتحرَّك
 *
 * حدثُ `store_order.payment_state_changed` عن انتقالٍ لم يحدُث يجعلُ كلَّ مُستهلِكٍ
 * يرى تخويلَينِ لطلبٍ واحدٍ — وأوّلُ من يحسبُ التخويلاتِ يحسبُ خطأً.
 */

import type { WaslaPublicId } from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import {
  storeOrderPaymentStateChangedEvent,
  type DeliveryDomainEvent,
  type EventContext,
} from "../domain/events.js";
import type { StoreOrder } from "../domain/model.js";
import { decidePaymentMirror, type PaymentMirrorInput } from "../domain/payment-mirror.js";
import { resolveIdempotentReplay } from "./idempotency-guard.js";
import type {
  IdempotencyIntent,
  IdempotentReplay,
  PaymentMirrorWrite,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";

/**
 * `applied` كتبَ انتقالاً؛ `unchanged` أعلنَ ما هوَ قائمٌ فلم يكتُب شيئاً.
 *
 * الحالتانِ تُجابانِ `200` بالجسمِ نفسِهِ، والتمييزُ هنا لا في الجوابِ: الحدُّ
 * الشبكيُّ لا يملكُ ما يقولُهُ للمُزوِّدِ عن الفرقِ، والاختبارُ يملكُ.
 */
export type MirrorPaymentResult =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | { readonly kind: "unchanged"; readonly order: StoreOrder }
  | IdempotentReplay;

export interface MirrorPaymentDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  readonly newUuid: () => string;
  readonly now: () => string;
}

export async function mirrorPayment(
  deps: MirrorPaymentDeps,
  publicId: WaslaPublicId,
  input: PaymentMirrorInput,
  traceId: string | null,
  idempotency?: IdempotencyIntent,
): Promise<MirrorPaymentResult> {
  const replay = await resolveIdempotentReplay(deps.readPort, idempotency, traceId);
  if (replay !== null) return replay;

  const order = await deps.readPort.getOrderByPublicId(publicId);
  if (order === null) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
      traceId: traceId ?? undefined,
      details: { field: "orderPublicId", actual: publicId },
    });
  }

  const decision = decidePaymentMirror(order, input, traceId ?? undefined);
  if (decision.kind === "noop") return { kind: "unchanged", order };

  // الطلبُ بعدَ القرارِ — بانيُ الحدثِ يقرأُ `to_state` و`payment_ref` من المجموعةِ.
  const mirrored: StoreOrder = {
    ...order,
    paymentState: decision.toState,
    paymentRef: decision.nextPaymentRef,
    version: order.version + 1,
  };

  const events: DeliveryDomainEvent[] = [
    storeOrderPaymentStateChangedEvent(
      mirrored,
      decision.fromState,
      decision.reasonCode,
      { eventId: deps.newUuid(), occurredAt: deps.now(), traceId } satisfies EventContext,
      // فاعلٌ `system`: المرآةُ تعكسُ قرارَ مُزوِّدٍ، ولا عميلَ ولا متجرَ قرَّرَها.
      { actor_type: "system", actor_ref: null },
    ),
  ];

  const write: PaymentMirrorWrite = {
    orderId: order.orderId,
    expectedVersion: order.version,
    fromPaymentState: decision.fromState,
    toPaymentState: decision.toState,
    reasonCode: decision.reasonCode,
    paymentRef: decision.nextPaymentRef,
    events,
    traceId,
    idempotency,
  };

  return deps.writePort.mirrorPayment(write);
}
