/**
 * In-memory fakes for the store-order ports (review 6/N).
 *
 * Fakes, not mocks: they behave. `FakeStoreOrderStore.cancelOrder` really
 * checks the version and really refuses on mismatch, so an app-level test can
 * assert a 409 without a database. A mock that merely recorded the call would
 * let the route return 200 for a refused cancellation and still pass.
 *
 * Every id and timestamp is injected or derived, so the same test run twice
 * produces byte-identical events — flaky ordering hides real bugs.
 *
 * The idempotency behaviour is modelled the same way (review 7/N): the fake
 * really stores keys with their fingerprint and response, really replays, and
 * really refuses a reused key. A fake that ignored the key would let a route
 * bug — forgetting to pass the intent inward — pass every unit test, and only
 * the integration suite would notice.
 */

import { DeliveryError } from "../domain/errors.js";
import type { DeliveryDomainEvent } from "../domain/events.js";
import type { DeliveryTask, StoreOrder } from "../domain/model.js";
import { toStoreOrderResponse } from "../http/mappers.js";
import type {
  CancelOrderOutcome,
  CancellationWrite,
  ConfirmOrderOutcome,
  ConfirmationWrite,
  FulfillmentTransitionOutcome,
  FulfillmentTransitionWrite,
  InventoryMirrorWrite,
  InventoryReservationPort,
  InventoryReservationStore,
  MirrorInventoryOutcome,
  MirrorPaymentOutcome,
  PaymentMirrorWrite,
  CatalogProductSnapshot,
  IdempotencyIntent,
  PlaceOrderOutcome,
  PlacementWrite,
  ReadinessCheckResult,
  ReadinessProbePort,
  StoreOrderCatalogPort,
  StoreOrderReadPort,
  StoreOrderWritePort,
  StoredIdempotentResponse,
} from "../ports.js";
import type { StoreSlug, WaslaPublicId } from "@wasla/contracts-delivery";

export const CUSTOMER_REF = "WS-0000000009" as WaslaPublicId;
export const STORE_SLUG = "matjar-alfawakih" as StoreSlug;
export const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
export const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

export class FakeStoreOrderStore implements StoreOrderReadPort, StoreOrderWritePort {
  readonly orders = new Map<string, StoreOrder>();
  readonly tasks = new Map<string, DeliveryTask>();
  readonly outbox: DeliveryDomainEvent[] = [];
  readonly idempotencyKeys = new Map<string, StoredIdempotentResponse>();
  private sequence = 5_000_000_001;

  seed(order: StoreOrder, task?: DeliveryTask): void {
    this.orders.set(order.publicId, order);
    if (task) this.tasks.set(order.publicId, task);
  }

  async getOrderByPublicId(publicId: WaslaPublicId): Promise<StoreOrder | null> {
    return this.orders.get(publicId) ?? null;
  }

  async getTaskByOrderPublicId(publicId: WaslaPublicId): Promise<DeliveryTask | null> {
    return this.tasks.get(publicId) ?? null;
  }

  async findIdempotentResponse(key: string): Promise<StoredIdempotentResponse | null> {
    return this.idempotencyKeys.get(key) ?? null;
  }

  async nextOrderPublicId(): Promise<WaslaPublicId> {
    return `WS-${String(this.sequence++).padStart(10, "0")}` as WaslaPublicId;
  }

  async placeOrder(write: PlacementWrite): Promise<PlaceOrderOutcome> {
    const replay = this.resolveKey(write.idempotency);
    if (replay !== null) return replay;
    this.orders.set(write.order.publicId, write.order);
    this.tasks.set(write.order.publicId, write.task);
    this.outbox.push(...write.events);
    this.rememberKey(write.idempotency, write.order);
    return { kind: "applied" };
  }

  async cancelOrder(write: CancellationWrite): Promise<CancelOrderOutcome> {
    const replay = this.resolveKey(write.idempotency);
    if (replay !== null) return replay;
    const entry = [...this.orders.values()].find((o) => o.orderId === write.orderId);
    if (entry === undefined) {
      throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المعرّفِ");
    }
    if (entry.version !== write.expectedVersion) {
      throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَ الطلبُ بينَ القراءةِ والكتابةِ");
    }
    const cancelled: StoreOrder = {
      ...entry,
      fulfillmentState: "cancelled",
      version: entry.version + 1,
    };
    this.orders.set(cancelled.publicId, cancelled);
    if (write.taskCancellation !== null) {
      const task = this.tasks.get(cancelled.publicId);
      if (task) {
        this.tasks.set(cancelled.publicId, { ...task, state: "cancelled", version: task.version + 1 });
      }
    }
    this.outbox.push(...write.events);
    this.rememberKey(write.idempotency, cancelled);
    return { kind: "applied", order: cancelled };
  }

  /**
   * مرآةُ الدفعِ في الذاكرةِ (المراجعةُ 9/N) — بنفسِ الحرسَينِ: النسخةُ **و**الحالةُ
   * السابقةُ. فحصُ النسخةِ وحدَهُ كانَ سيجعلُ الزائفَ يقبلُ ما يرفضُهُ المحوّلُ، وأوّلُ
   * فرقٍ بينَهُما يجعلُ اختباراتَ الوحدةِ تشهدُ لسلوكٍ لا وجودَ لهُ في الإنتاجِ.
   */
  async mirrorPayment(write: PaymentMirrorWrite): Promise<MirrorPaymentOutcome> {
    const replay = this.resolveKey(write.idempotency);
    if (replay !== null) return replay;
    const entry = this.requireOrder(write.orderId, write.expectedVersion);
    if (entry.paymentState !== write.fromPaymentState) {
      throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَت مرآةُ الدفعِ بينَ القراءةِ والكتابةِ");
    }
    const mirrored: StoreOrder = {
      ...entry,
      paymentState: write.toPaymentState as StoreOrder["paymentState"],
      paymentRef: write.paymentRef,
      version: entry.version + 1,
    };
    this.orders.set(mirrored.publicId, mirrored);
    this.outbox.push(...write.events);
    this.rememberKey(write.idempotency, mirrored);
    return { kind: "applied", order: mirrored };
  }

  /**
   * مرآةُ المخزونِ في الذاكرةِ — نفسُ الحرسَينِ: النسخةُ **و**الحالةُ السابقةُ
   * (المراجعةُ 10/N). فحصُ النسخةِ وحدَهُ كانَ سيجعلُ الزائفَ يقبلُ ما يرفضُهُ المحوّلُ.
   */
  async mirrorInventoryState(write: InventoryMirrorWrite): Promise<MirrorInventoryOutcome> {
    const entry = this.requireOrder(write.orderId, write.expectedVersion);
    if (entry.inventoryState !== write.fromInventoryState) {
      throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَت حالةُ المخزونِ بينَ القرارِ والكتابةِ");
    }
    const mirrored: StoreOrder = {
      ...entry,
      inventoryState: write.toInventoryState as StoreOrder["inventoryState"],
      inventoryRef: write.inventoryRef,
      version: entry.version + 1,
    };
    this.orders.set(mirrored.publicId, mirrored);
    this.outbox.push(...write.events);
    // Update any existing placement idempotency response so a replay returns
    // the post-reservation order, not the pre-reservation snapshot.
    this.updateIdempotencyResponseBody(mirrored);
    return { kind: "applied", order: mirrored };
  }

  /** التأكيدُ في الذاكرةِ — والبوّابةُ تُقرَأُ هنا ثانيةً كما تُقرَأُ تحتَ القُفلِ. */
  async confirmOrder(write: ConfirmationWrite): Promise<ConfirmOrderOutcome> {
    const replay = this.resolveKey(write.idempotency);
    if (replay !== null) return replay;
    const entry = this.requireOrder(write.orderId, write.expectedVersion);
    if (entry.fulfillmentState !== write.fromFulfillmentState) {
      throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَ الطلبُ بينَ القراءةِ والكتابةِ");
    }
    if (entry.paymentState !== "authorized") {
      throw new DeliveryError("DELIVERY_PAYMENT_NOT_AUTHORIZED", "الدفعُ غيرُ مُخوَّلٍ");
    }
    const confirmed: StoreOrder = {
      ...entry,
      fulfillmentState: "confirmed",
      version: entry.version + 1,
    };
    this.orders.set(confirmed.publicId, confirmed);
    this.outbox.push(...write.events);
    this.rememberKey(write.idempotency, confirmed);
    return { kind: "applied", order: confirmed };
  }

  /** انتقالُ التنفيذِ في الذاكرةِ (المراجعةُ 11/N · §4.13). */
  async fulfillmentTransition(write: FulfillmentTransitionWrite): Promise<FulfillmentTransitionOutcome> {
    const replay = this.resolveKey(write.idempotency);
    if (replay !== null) return replay;
    const entry = this.requireOrder(write.orderId, write.expectedVersion);
    if (entry.fulfillmentState !== write.fromFulfillmentState) {
      throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَ الطلبُ بينَ القراءةِ والكتابةِ");
    }

    let updated: StoreOrder = {
      ...entry,
      fulfillmentState: write.toFulfillmentState as StoreOrder["fulfillmentState"],
      version: entry.version + 1,
    };

    // When delivered: consume inventory in the same transaction
    if (write.inventoryConsume !== null && write.inventoryConsume !== undefined) {
      const ic = write.inventoryConsume;
      if (entry.inventoryState !== ic.fromInventoryState) {
        throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَت حالةُ المخزونِ بينَ القرارِ والكتابةِ");
      }
      updated = {
        ...updated,
        inventoryState: ic.toInventoryState as StoreOrder["inventoryState"],
        inventoryRef: ic.inventoryRef,
        version: updated.version + 1,
      };
      this.outbox.push(...ic.events);
    }

    this.orders.set(updated.publicId, updated);
    this.outbox.push(...write.events);
    this.rememberKey(write.idempotency, updated);
    return { kind: "applied", order: updated };
  }

  private requireOrder(orderId: string, expectedVersion: number): StoreOrder {
    const entry = [...this.orders.values()].find((o) => o.orderId === orderId);
    if (entry === undefined) {
      throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المعرّفِ");
    }
    if (entry.version !== expectedVersion) {
      throw new DeliveryError("DELIVERY_CONCURRENT_UPDATE", "تغيَّرَ الطلبُ بينَ القراءةِ والكتابةِ");
    }
    return entry;
  }

  /** Same two-step handshake as the Postgres adapter, in memory. */
  private resolveKey(
    intent: IdempotencyIntent | undefined,
  ): { readonly kind: "replayed"; readonly status: number; readonly body: unknown } | null {
    if (intent === undefined) return null;
    const stored = this.idempotencyKeys.get(intent.key);
    if (stored === undefined) return null;
    if (stored.fingerprint !== intent.fingerprint) {
      throw new DeliveryError(
        "DELIVERY_IDEMPOTENCY_KEY_REUSED",
        "المفتاحُ نفسُهُ مُستعمَلٌ لطلبٍ مختلفٍ",
      );
    }
    return { kind: "replayed", status: stored.status, body: stored.body };
  }

  private rememberKey(intent: IdempotencyIntent | undefined, order: StoreOrder): void {
    if (intent === undefined) return;
    this.idempotencyKeys.set(intent.key, {
      fingerprint: intent.fingerprint,
      status: intent.responseStatus,
      // Serialized and re-parsed exactly like `jsonb` would, so a test cannot
      // pass by mutating the object the route also holds a reference to.
      body: JSON.parse(JSON.stringify(intent.buildResponseBody(order))),
    });
  }

  /** Update the body of any stored idempotency response for this order, so a
   *  replay returns the post-mirror state rather than the pre-mirror snapshot. */
  private updateIdempotencyResponseBody(order: StoreOrder): void {
    for (const [key, stored] of this.idempotencyKeys) {
      const body = stored.body as Record<string, unknown> | null;
      if (body !== null && typeof body === "object" && body.order_id === order.orderId) {
        this.idempotencyKeys.set(key, { ...stored, body: JSON.parse(JSON.stringify(toStoreOrderResponse(order))) });
      }
    }
  }
}

/** A readiness probe whose answer the test dictates — no database, no timing. */
export class FakeReadinessProbe implements ReadinessProbePort {
  constructor(private readonly checks: readonly ReadinessCheckResult[]) {}

  async probe(): Promise<readonly ReadinessCheckResult[]> {
    return this.checks;
  }
}

export class FakeCatalog implements StoreOrderCatalogPort {
  constructor(
    private readonly store: { storeId: string; orderable: boolean } | null = {
      storeId: "cccccccc-0000-4000-8000-000000000003",
      orderable: true,
    },
    private readonly prices: Record<string, number> = { [PRODUCT_A]: 1000, [PRODUCT_B]: 250 },
  ) {}

  async getStoreBySlug(): Promise<{ storeId: string; orderable: boolean } | null> {
    return this.store;
  }

  async getProductSnapshots(
    _storeId: string,
    productIds: readonly string[],
  ): Promise<readonly CatalogProductSnapshot[]> {
    return productIds
      .filter((id) => id in this.prices)
      .map((id) => ({ productId: id, sku: `SKU-${id.slice(0, 4)}`, unitPriceMinorUnits: this.prices[id] }));
  }
}

/** A deterministic uuid generator: uuid-shaped, counted, never random. */
export function uuidSequence(prefix = "dddddddd"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

/**
 * A fake `InventoryReservationPort` (review 10/N) — always succeeds.
 *
 * `reserve()` returns `reserved: true` with a deterministic ref; `release()`
 * returns `released: true`. Tests that need to exercise the insufficient-stock
 * path can override the result via the constructor.
 */
export class FakeReservationPort implements InventoryReservationPort {
  constructor(
    private readonly reserveResult: { reserved: boolean; reservationRef: string; insufficientProductId?: string; availableQuantity?: number } = {
      reserved: true,
      reservationRef: "fake-ref",
    },
  ) {}

  async reserve(): Promise<{ reserved: boolean; reservationRef: string; insufficientProductId?: string; availableQuantity?: number }> {
    return this.reserveResult;
  }

  async release(): Promise<{ released: boolean }> {
    return { released: true };
  }
}

/**
 * A fake `InventoryReservationStore` (review 10/N) — a no-op store.
 *
 * `saveReservations()` stores nothing, `loadActiveReservations()` returns `[]`,
 * `releaseReservations()` and `consumeReservations()` return `0`.
 */
export class FakeReservationStore implements InventoryReservationStore {
  async saveReservations(): Promise<void> {}
  async loadActiveReservations(): Promise<readonly never[]> {
    return [];
  }
  async releaseReservations(): Promise<number> {
    return 0;
  }
  async consumeReservations(): Promise<number> {
    return 0;
  }
}

export function fixedOrder(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    orderId: "bbbbbbbb-0000-4000-8000-000000000002",
    publicId: "WS-0000000001" as WaslaPublicId,
    customerRef: CUSTOMER_REF,
    storeId: "cccccccc-0000-4000-8000-000000000003",
    storeSlug: STORE_SLUG,
    fulfillmentState: "placed",
    paymentState: "pending",
    paymentRef: null,
    inventoryState: "reserved",
    inventoryRef: "fake-reservation-ref",
    currencyCode: "SAR",
    itemsTotalMinorUnits: 1000,
    deliveryFeeMinorUnits: 500,
    totalMinorUnits: 1500,
    items: [
      {
        orderItemId: "bbbbbbbb-0000-4000-8000-000000000001",
        lineNo: 1,
        productId: PRODUCT_A,
        sku: "SKU-1111",
        quantity: 1,
        unitPriceMinorUnits: 1000,
        lineTotalMinorUnits: 1000,
      },
    ],
    version: 1,
    ...overrides,
  };
}

export function fixedTask(overrides: Partial<DeliveryTask> = {}): DeliveryTask {
  return {
    taskId: "aaaaaaaa-0000-4000-8000-000000000001",
    orderId: "bbbbbbbb-0000-4000-8000-000000000002",
    state: "pending_eligibility",
    ineligibilityReason: null,
    dispatchJobRef: null,
    courierRef: null,
    proof: null,
    version: 1,
    ...overrides,
  };
}
