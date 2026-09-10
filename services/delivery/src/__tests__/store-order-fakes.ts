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
import type {
  CancelOrderOutcome,
  CancellationWrite,
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
import type { WaslaPublicId } from "@wasla/contracts-delivery";

export const CUSTOMER_REF = "WS-0000000009" as WaslaPublicId;
export const STORE_REF = "WS-0000000002" as WaslaPublicId;
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

  async getStoreByPublicId(): Promise<{ storeId: string; orderable: boolean } | null> {
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

export function fixedOrder(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    orderId: "bbbbbbbb-0000-4000-8000-000000000002",
    publicId: "WS-0000000001" as WaslaPublicId,
    customerRef: CUSTOMER_REF,
    storeId: "cccccccc-0000-4000-8000-000000000003",
    storePublicId: STORE_REF,
    fulfillmentState: "placed",
    paymentState: "pending",
    paymentRef: null,
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
