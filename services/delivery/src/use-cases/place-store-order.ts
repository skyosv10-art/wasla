/**
 * Place a store order (ADR-026 §2.1 · §2.3 · §3.1 · §3.3).
 *
 * The orchestration, and only the orchestration: resolve the store through
 * the marketplace boundary, take price snapshots, reserve the public id,
 * ask the DOMAIN to build the aggregate and its events, hand the whole
 * thing to the store as ONE write.
 *
 * ## Events are built in the domain, never here and never in HTTP
 *
 * `domain/events.ts` owns every envelope. If this file assembled payloads,
 * a second entry point (a relay, a CLI, a test harness) would assemble them
 * differently and the outbox would carry two dialects of the same event.
 * The rule from review 1/N holds: state changes through ANY path emit their
 * event, from one builder.
 *
 * ## Why the id is reserved BEFORE the aggregate is built
 *
 * `store_order.created` carries `public_id`. An adapter that generated the
 * id during the insert would force the event to be patched after the fact —
 * so the sequence is read first, and the domain builds rows and events that
 * agree by construction.
 *
 * ## What this use case deliberately does NOT do
 *
 * It does not decide eligibility (the task starts `pending_eligibility`), it
 * does not touch payment (that mirror is external, §2.2), and it does not
 * retry the catalog: a dependency failure surfaces as
 * `DELIVERY_MARKETPLACE_UNAVAILABLE` and the caller decides. Even now that an
 * `Idempotency-Key` makes the CALLER's retry safe (review 7/N, §4.10), an
 * internal retry loop here would still be wrong: it would reuse the same key
 * and turn a transient dependency failure into a 409 instead of the honest
 * dependency error the caller must see.
 *
 * ## Where the idempotency key is checked — and why placement differs from cancel
 *
 * Placement passes the intent THROUGH to the write port, which resolves it
 * inside the one transaction that also writes the order
 * (`store-order-store.ts`). A replayed placement therefore still resolves the
 * store, still takes price snapshots, and still burns a sequence value before
 * the replay is detected — wasted work on a rare retry, and nothing worse: the
 * transaction rolls back and the stored first response is returned.
 *
 * Cancellation cannot rely on that alone and adds a read-side pre-check
 * (`idempotency-guard.ts`), because its retry hits a domain refusal first: the
 * order is already `cancelled` and `cancelled → cancelled` is not an edge. The
 * asymmetry is deliberate and it is the smaller evil — the alternative is a
 * pre-check on this path too, i.e. an extra round trip on every placement to
 * save work on retries that should be rare. Both paths keep the transactional
 * check, so the GUARANTEE is identical either way; only the wasted effort on a
 * retry differs.
 */

import type { StoreSlug } from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import { storeOrderCreatedEvent, deliveryTaskCreatedEvent, type EventContext } from "../domain/events.js";
import { buildStoreOrderPlacement } from "../domain/store-order-placement.js";
import type { PlaceOrderInput } from "../domain/validation.js";
import type { StoreOrder } from "../domain/model.js";
import type {
  IdempotencyIntent,
  IdempotentReplay,
  PlacementWrite,
  StoreOrderCatalogPort,
  StoreOrderWritePort,
} from "../ports.js";

/**
 * Either the placement happened (and `order` is what was written) or the key
 * had already been used for this exact request and the stored first response
 * must be replayed verbatim.
 */
export type PlaceStoreOrderResult =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;

export interface PlaceStoreOrderDeps {
  readonly catalogPort: StoreOrderCatalogPort;
  readonly writePort: StoreOrderWritePort;
  /** Injected so tests are deterministic — no hidden clock, no hidden uuid. */
  readonly newUuid: () => string;
  readonly now: () => string;
}

export async function placeStoreOrder(
  deps: PlaceStoreOrderDeps,
  input: PlaceOrderInput,
  traceId: string | null,
  idempotency?: IdempotencyIntent,
): Promise<PlaceStoreOrderResult> {
  const store = await deps.catalogPort.getStoreBySlug(input.store_slug as StoreSlug);
  if (store === null) {
    // The catalog ANSWERED and the answer was "no such store": a client
    // mistake (400), not an outage (503). The error catalog has no
    // `DELIVERY_STORE_NOT_FOUND`, and `DELIVERY_ORDER_NOT_FOUND` would name
    // the wrong subject — declared in ADR-026 §4.9-2.
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "مرجعُ المتجرِ غيرُ معروفٍ في السوقِ", {
      traceId: traceId ?? undefined,
      details: { field: "store_slug", actual: input.store_slug },
    });
  }
  if (!store.orderable) {
    throw new DeliveryError("DELIVERY_INELIGIBLE", "المتجرُ لا يستقبلُ طلباتٍ الآنَ", {
      traceId: traceId ?? undefined,
      details: { field: "store_slug", actual: "store_not_orderable" },
    });
  }

  const productIds = input.items.map((line) => line.product_id);
  const snapshots = await deps.catalogPort.getProductSnapshots(store.storeId, productIds);

  const publicId = await deps.writePort.nextOrderPublicId();
  const { order, task } = buildStoreOrderPlacement(input, snapshots, {
    orderId: deps.newUuid(),
    taskId: deps.newUuid(),
    publicId,
    storeId: store.storeId,
  });

  const occurredAt = deps.now();
  const orderContext: EventContext = { eventId: deps.newUuid(), occurredAt, traceId };
  const taskContext: EventContext = { eventId: deps.newUuid(), occurredAt, traceId };

  const write: PlacementWrite = {
    order,
    task,
    events: [
      storeOrderCreatedEvent(order, orderContext, {
        actor_type: "customer",
        actor_ref: order.customerRef,
      }),
      deliveryTaskCreatedEvent(task, order.publicId, taskContext),
    ],
    traceId,
    idempotency,
  };

  const outcome = await deps.writePort.placeOrder(write);
  if (outcome.kind === "replayed") return outcome;
  return { kind: "applied", order };
}
