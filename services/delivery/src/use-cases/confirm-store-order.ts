/**
 * تأكيدُ طلبِ متجرٍ — البوّابةُ المركَّبةُ (ADR-026 §2.2 · §3.1 · المراجعةُ 9/N).
 *
 * اقرأِ الطلبَ، اسألِ النطاقَ (`decideConfirmation`) هل الطريقُ موجودٌ وهل الشرطُ
 * متحقِّقٌ، ثمّ اكتُب في معاملةٍ واحدةٍ محروسةٍ بالنسخةِ. والشرطُ يُعادُ فحصُهُ داخلَ
 * المعاملةِ تحتَ القُفلِ: مرآةٌ انقلبَت إلى `failed` بينَ القراءةِ والكتابةِ يجبُ أن
 * تمنعَ التأكيدَ، ولا يكفي أنّها كانت `authorized` لحظةَ القراءةِ.
 *
 * # لا يُنشئُ التأكيدُ أهليّةً ولا يطلبُ dispatch
 *
 * حافّةُ المهمّةِ `pending_eligibility → eligible` قرارُ أهليّةٍ يُقرأُ من حدِّ
 * السوقِ والتغطيةِ (§2.3)، لا نتيجةَ تخويلٍ ماليٍّ. فالتأكيدُ هنا يُحرّكُ حالةَ
 * التنفيذِ وحدَها، والمهمّةُ تبقى حيثُ هيَ. وتحريكُها هنا كانَ سيعني أنّ طلباً
 * مدفوعاً خارجَ التغطيةِ صارَ «مؤهَّلاً» لأنّهُ دُفِعَ — وهذا عكسُ معنى الأهليّةِ.
 */

import type { WaslaPublicId } from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import {
  storeOrderFulfillmentStateChangedEvent,
  type DeliveryDomainEvent,
  type EventContext,
} from "../domain/events.js";
import type { StoreOrder } from "../domain/model.js";
import { decideConfirmation } from "../domain/store-order-confirmation.js";
import { resolveIdempotentReplay } from "./idempotency-guard.js";
import type {
  ConfirmationWrite,
  IdempotencyIntent,
  IdempotentReplay,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";

export type ConfirmStoreOrderResult =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;

export interface ConfirmStoreOrderDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  readonly newUuid: () => string;
  readonly now: () => string;
}

export async function confirmStoreOrder(
  deps: ConfirmStoreOrderDeps,
  publicId: WaslaPublicId,
  traceId: string | null,
  idempotency?: IdempotencyIntent,
): Promise<ConfirmStoreOrderResult> {
  // قبلَ النطاقِ: إعادةُ تأكيدٍ ناجحٍ بالمفتاحِ نفسِهِ تُعيدُ جوابَ الأوّلِ، ولا
  // تموتُ في آلةِ الحالاتِ لأنَّ `confirmed → confirmed` ليسَ حافّةً.
  const replay = await resolveIdempotentReplay(deps.readPort, idempotency, traceId);
  if (replay !== null) return replay;

  const order = await deps.readPort.getOrderByPublicId(publicId);
  if (order === null) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
      traceId: traceId ?? undefined,
      details: { field: "orderPublicId", actual: publicId },
    });
  }

  const decision = decideConfirmation(order, traceId ?? undefined);

  const confirmed: StoreOrder = {
    ...order,
    fulfillmentState: "confirmed",
    version: order.version + 1,
  };

  const events: DeliveryDomainEvent[] = [
    storeOrderFulfillmentStateChangedEvent(
      confirmed,
      decision.fromFulfillmentState,
      "PAYMENT_AUTHORIZED",
      { eventId: deps.newUuid(), occurredAt: deps.now(), traceId } satisfies EventContext,
      // النظامُ هوَ الفاعلُ: الشرطُ الذي أجازَ الحافّةَ مرآةُ دفعٍ لا نيّةُ شخصٍ.
      { actor_type: "system", actor_ref: null },
    ),
  ];

  const write: ConfirmationWrite = {
    orderId: order.orderId,
    expectedVersion: order.version,
    fromFulfillmentState: decision.fromFulfillmentState,
    events,
    traceId,
    idempotency,
  };

  return deps.writePort.confirmOrder(write);
}
