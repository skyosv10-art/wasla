/**
 * Relay infrastructure ports (ADR-026 §2.4 — the coarse mirror's consumer).
 * The relay depends on these abstractions, not on dispatch internals or a
 * specific DB driver — the same boundary decision as ADR-025 §2.3:
 *
 *  - `DispatchEventSource`: reads `dispatch_outbox` rows AFTER a checkpoint
 *    (occurred_at, event_id). Read-only: the relay NEVER writes to
 *    `dispatch_outbox` (no `published_at`) — progress is delivery-owned.
 *  - `TaskMirrorStore`: the delivery-owned state the mirror writes — task
 *    state + transition ledger + `delivery_outbox` event + consumed ledger +
 *    checkpoint, ALL in one atomic `applyMirrorTransition`. Tested with an
 *    in-memory fake; a Postgres adapter arrives with the integration review
 *    (ADR-026 §4.2/§4.3 — declared deferral).
 *
 * Referential rule (review 2/N finding): dispatch jobs are keyed by ORD- ids
 * owned by services/orders. The ONLY link to a delivery task is
 * `dispatch_job_ref`, bound by the (deferred) delegation wire — which MUST
 * bind before any projectable outcome is emitted, or the relay terminally
 * consumes that outcome as `ignored_foreign`.
 */

import type { DispatchOutboxRow, RelayCheckpoint, ConsumedStatus } from "./domain/consumed-events.js";
import type { MirrorTransition } from "./domain/dispatch-mirror.js";
import type { DelegatableTask } from "./domain/delegation.js";

export interface DispatchEventSource {
  /** Read up to `limit` dispatch outbox rows strictly after the checkpoint (or from zero). */
  readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly DispatchOutboxRow[]>;
}

/** Context of the dispatch row that caused a mirror transition. */
export interface MirrorContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

export interface TaskMirrorStore {
  /* ── checkpoint (delivery-owned) ── */
  getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null>;
  writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void>;

  /* ── the coarse mirror ── */
  /** The task bound to a dispatch job, if any — the only legal join. */
  getTaskByJobRef(jobId: string): Promise<readonly { taskId: string; state: string; lastDispatchEvent: RelayCheckpoint | null }[]>;
  /**
   * Atomically: advance task state (+courier/assignedAt), append the
   * `delivery_task_transitions` row (actor dispatch), append the mirror's
   * `delivery.*` event to `delivery_outbox`, advance the task's dispatch
   * watermark. Must be idempotent per (task, eventId).
   */
  applyMirrorTransition(taskId: string, transition: MirrorTransition, context: MirrorContext): Promise<void>;
  /**
   * Record a terminally-consumed non-transition (ignored/stale/foreign) so
   * the task's dispatch watermark advances without a state change.
   */
  recordConsumedNoOp(taskId: string, context: MirrorContext): Promise<void>;

  /* ── consumed-event ledger (idempotency) ── */
  getConsumed(eventId: string): Promise<{ status: ConsumedStatus; attempt_count: number } | null>;
  markConsumed(
    eventId: string,
    row: Pick<DispatchOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: ConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void>;

  /* ── replay / rebuild ── */
  /** Clear mirror state + consumed ledger + checkpoint (NOT delivery_outbox). */
  clearMirrorState(): Promise<void>;
}

/* ════════════════════════════════════════════════════════════════════════
 * Dispatch delegation — the COMMAND side of ADR-026 §2.4 (review 4/N).
 * Deliberately NOT part of TaskMirrorStore: that port is relay consumption
 * (dispatch_outbox → mirror); this is the sending direction (task → dispatch
 * job). Separate seams, separate fakes, same Postgres class may implement
 * both — the responsibilities stay distinguishable at the type level.
 * ════════════════════════════════════════════════════════════════════════ */

/** Context of a delegation write — same shape as MirrorContext, own name. */
export interface DelegationContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

/**
 * The outbound command port — delivery asks dispatch to own the matching.
 *
 * Delivery-owned fields ONLY: the command must not smuggle ORD- assumptions
 * (ADR-026 §4.6-1 — dispatch is ORD-keyed, store orders are WS-). The real
 * adapter (HTTP, composition root — deferred §4.2) bridges to dispatch's
 * create-job contract behind the pending architectural decision recorded in
 * the risk register; until then the port is tested with a fake.
 */
export interface DispatchJobRequester {
  /**
   * Request a dispatch job for an eligible task. MUST be idempotent per
   * `idempotencyKey` (the key is deterministic per task — domain/delegation.ts).
   * Throws on transport/dependency failure — the caller maps nothing, keeps
   * zero local state, and retries.
   */
  requestJob(command: DispatchDelegationCommand): Promise<DispatchJobRequestOutcome>;
}

export interface DispatchDelegationCommand {
  readonly taskId: string;
  /** The store order this task delivers — a delivery-owned opaque ref. */
  readonly orderId: string;
  /** Deterministic (domain/delegation.ts) — crash-heal depends on it. */
  readonly idempotencyKey: string;
  readonly traceId: string | null;
}

export interface DispatchJobRequestOutcome {
  /** The dispatch job's opaque ref — the ONLY legal join (§4.6-1), 1..128 chars. */
  readonly jobRef: string;
  /** True when dispatch remembered the key and returned the original job. */
  readonly replayed: boolean;
}

/**
 * The delivery-owned side of the bind — ONE transaction (ADR-026 §4.6-2):
 * `dispatch_job_ref` + eligible→dispatch_requested + transition ledger row
 * (actor `system`) + the `delivery.dispatch_requested` outbox event.
 *
 * Contract errors (DeliveryError):
 *  - DELIVERY_TRANSITION_NOT_ALLOWED — the task is not `eligible` anymore,
 *  - DELIVERY_CONCURRENT_UPDATE — a DIFFERENT jobRef is already bound,
 *  and a raw throw means rollback — nothing survives a mid-bind crash.
 */
export interface TaskDelegationStore {
  /** The task as the wire sees it — null when unknown. */
  getTaskForDelegation(taskId: string): Promise<DelegatableTask | null>;
  /**
   * Atomically bind the job and move eligible→dispatch_requested.
   * `already_bound` (same ref, idempotent) is NOT an error — the deterministic
   * idempotency key makes a racing or retried caller ask for the same job.
   */
  bindDispatchJob(taskId: string, jobRef: string, context: DelegationContext): Promise<"bound" | "already_bound">;
}

/* ════════════════════════════════════════════════════════════════════════
 * Marketplace inventory consumer (ADR-026 §2.3 — "inventory is read via the
 * agreed boundary, no writing to marketplace tables, delivery stores
 * snapshots not balances"). The relay reads `marketplace_outbox` rows of type
 * `marketplace.inventory_adjusted` and projects them into
 * `delivery_inventory_observations` — a snapshot, never a balance.
 * ════════════════════════════════════════════════════════════════════════ */

import type {
  InventoryAdjustedData,
  InventoryConsumedStatus,
  InventoryRelayCheckpoint,
  MarketplaceOutboxRow,
} from "./domain/marketplace-inventory-events.js";
import type { InventoryConflictAssessment, InventoryConflictRow } from "./domain/inventory-conflict.js";

/**
 * نتيجةُ رصدِ فرقِ مخزونٍ واحدٍ — نوعٌ مُفرَّقٌ لا سلسلةٌ (المراجعةُ 16/N · ADR-026 §4.18).
 *
 * ولمَ نوعٌ مُفرَّقٌ؟ لأنَّ الحكمَ على التضاربِ **لا معنى لهُ** حينَ يُتخطّى الفرقُ
 * لقِدَمِهِ: لا سطرَ رُصِدَ فلا سؤالَ يُسألُ. وحقلٌ اختياريٌّ (`conflict?: … | null`)
 * كانَ سيُتيحُ للقارئِ أن يقرأَ «لا تضاربَ» من تخطٍّ ويُسجّلَهُ نظافةً — وهو كذبٌ
 * صامتٌ. فالنوعُ يجعلَ التمييزَ إلزاماً في وقتِ الترجمةِ لا اجتهاداً.
 */
export type InventoryObservationOutcome =
  | { readonly observation: "skipped_stale" }
  | { readonly observation: "applied"; readonly conflict: InventoryConflictAssessment };

/** Reads `marketplace_outbox` rows of type `marketplace.inventory_adjusted` AFTER a checkpoint. */
export interface MarketplaceInventoryEventSource {
  /** Read up to `limit` marketplace outbox rows strictly after the checkpoint (or from zero). */
  readAfter(checkpoint: InventoryRelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]>;
}

/**
 * The delivery-owned state the inventory relay writes — observation snapshots
 * + consumed ledger + checkpoint, ALL atomic where the relay needs them.
 *
 * `observeInventoryAdjustment` is guarded by `adjustment_sequence`: an older
 * adjustment is `skipped_stale` (the snapshot never regresses); a newer one
 * upserts the observation. This is the inventory equivalent of the dispatch
 * relay's per-task watermark — but per (store_id, product_id).
 *
 * ومنذُ المراجعةِ 16/N يحملُ الرصدُ حكماً ثانياً في **المعاملةِ نفسِها**: هل يُشكِّكُ
 * هذا الفرقُ في حجوزٍ نشطةٍ (ADR-026 §4.18)؟ ومعاملةٌ واحدةٌ لا اثنتانِ لأنَّ رصداً
 * مُثبَتاً برايةٍ مفقودةٍ يعني حادثةً بلا أثرٍ، ورايةً بلا رصدٍ يعني تقريراً عن لقطةٍ
 * لا وجودَ لها.
 */
/**
 * قراءةُ راياتِ التضاربِ (المراجعةُ 16/N · ADR-026 §4.18).
 *
 * منفذٌ منفردٌ بحركةٍ واحدةٍ لا لأنَّ التقسيمَ جميلٌ، بل لأنَّ حدَّ HTTP يحتاجُ
 * هذهِ الحركةَ وحدَها: حقنُ `InventoryObservationStore` كاملاً في التطبيقِ يُعطي
 * مسارَ قراءةٍ مفاتيحَ `clearInventoryObservations()` ومراقبَ متتالٍ، وأوّلُ خطأٍ
 * في مُعالِجٍ يصيرُ محذاً لا يُرَدُّ. والمخزنُ الفعليُّ يُحقّقُ الاثنينِ، فلا
 * مُحوِّلَ في الوسطِ.
 */
export interface InventoryConflictReadPort {
  /**
   * الأحدثُ أوّلاً، وغيرُ المُقَرِّ وحدَهُ حينَ `unacknowledgedOnly` — ومحدودةٌ
   * بسقفٍ مُمَرَّرٍ: مسارُ قراءةٍ بلا سقفٍ يصيرُ مُفرِغَ جدولٍ أوّلَ مرّةٍ يكثُرُ
   * فيهِ الصفُّ.
   */
  listInventoryConflicts(query: {
    readonly unacknowledgedOnly: boolean;
    readonly limit: number;
  }): Promise<readonly InventoryConflictRow[]>;
}

/**
 * نتيجةُ إقرارِ رايةٍ واحدةٍ — نوعٌ مُفرَّقٌ ثلاثيٌّ (المراجعةُ 18/N · ADR-026 §4.20).
 *
 * ثلاثةُ فروعٍ لا اثنانِ، لأنَّ ثلاثةَ أشياءَ **مختلفةٍ** قد تقعُ: أقررتُها أنا الآنَ،
 * أو أقرَّها غيري قبلي، أو لا رايةَ بهذا المفتاحِ. وحقلٌ منطقيٌّ واحدٌ
 * (`acknowledged: boolean`) كانَ سيخلطُ الأخيرَينِ في «لم يقع» — فيقرأُ المُشغِّلُ
 * «أُقِرَّت سابقاً» على مُعرِّفٍ أخطأَ نسخَهُ، ويُغلِقُ حادثةً ما زالت مفتوحةً.
 *
 * والصفُّ يُرَدُّ في الفرعَينِ الأوّلَينِ لأنَّ الجوابَ يجبُ أن يُسمِّيَ **المُقِرَّ
 * الفعليَّ**: مُشغِّلٌ ثانٍ نادى المسارَ يحتاجُ أن يرى اسمَ الأوّلِ لا تأكيداً
 * صامتاً يجعلُهُ يظنُّ الواقعةَ لهُ.
 */
export type InventoryConflictAcknowledgementOutcome =
  | { readonly acknowledgement: "recorded"; readonly row: InventoryConflictRow }
  | { readonly acknowledgement: "already_recorded"; readonly row: InventoryConflictRow }
  | { readonly acknowledgement: "unknown_conflict" };

/**
 * كتابةُ إقرارِ رايةٍ (المراجعةُ 18/N · ADR-026 §4.20 — رفعُ دَينِ §4.18).
 *
 * **منفذٌ ثانٍ لا حركةٌ في `InventoryConflictReadPort`**: مسارُ القراءةِ يُحقَنُ في
 * تطبيقٍ قد لا يملكُ سلطةَ الكتابةِ، وضمُّ الكتابةِ إلى منفذِ القراءةِ يعني أنَّ
 * كلَّ قارئٍ صارَ كاتباً بالبناءِ. وهذا هوَ نفسُ التعليلِ الذي فصلَ منفذَ القراءةِ
 * عن `InventoryObservationStore` كاملاً في §4.18.
 *
 * **ولا إفراجَ عن الإقرارِ (`un-acknowledge`) في هذا المنفذِ.** ومحلُّهُ من العقدِ
 * مُعلَنٌ لا مُغفَلٌ: تراجعٌ عن إقرارٍ قرارُ سياسةٍ (مَن يملكُ نقضَ حكمِ مُشغِّلٍ
 * آخرَ؟) لا تفصيلُ تنفيذٍ، وهوَ دَينٌ مذكورٌ في §4.20 لا حركةٌ نُسِيَت.
 */
export interface InventoryConflictAcknowledgementPort {
  /**
   * **الأوّلُ يفوزُ ولا يُكتَبُ فوقَهُ أبداً.** وهذا ليسَ تفضيلاً: §4.18-6 قرَّرَ أنَّ
   * إعادةَ تسليمِ حدثٍ لا تمحو إقرارَ مُشغِّلٍ (`ON CONFLICT DO NOTHING`)، ومسارُ
   * كتابةٍ يمحوهُ يكونُ قد نقضَ القرارَ نفسَهُ من البابِ الآخرِ.
   *
   * ويجبُ أن يكونَ **عمليّةً واحدةً ذرّيّةً**: قراءةٌ ثمَّ كتابةٌ في نداءَينِ تُتيحُ
   * لمُشغِّلَينِ أن يقرآ «غيرُ مُقَرَّةٍ» ثمَّ يكتبَ الثاني فوقَ الأوّلِ.
   */
  acknowledgeInventoryConflict(input: {
    readonly adjustmentId: string;
    readonly acknowledgedBy: string;
    readonly acknowledgedAt: string;
  }): Promise<InventoryConflictAcknowledgementOutcome>;
}

export interface InventoryObservationStore
  extends InventoryConflictReadPort,
    InventoryConflictAcknowledgementPort {
  /* ── checkpoint (delivery-owned) ── */
  getInventoryCheckpoint(consumerId: string): Promise<InventoryRelayCheckpoint | null>;
  writeInventoryCheckpoint(consumerId: string, checkpoint: InventoryRelayCheckpoint): Promise<void>;

  /* ── consumed-event ledger (idempotency) ── */
  getInventoryConsumed(eventId: string): Promise<{ status: InventoryConsumedStatus; attempt_count: number } | null>;
  markInventoryConsumed(
    eventId: string,
    row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: InventoryConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void>;

  /* ── the inventory snapshot ── */
  /**
   * Upsert the observation for (store_id, product_id), guarded by sequence.
   * Returns `"applied"` when the observation was updated, or `"skipped_stale"`
   * when the incoming adjustment_sequence is older than the current one.
   *
   * وحينَ `"applied"` يحملُ الجوابُ حكمَ التضاربِ معَهُ — وقد أُثبِتَتِ الرايةُ (إن رُفِعَت)
   * في المعاملةِ نفسِها. وإثباتُ الرايةِ مُتماثِلٌ بمفتاحِ الفرقِ (`adjustment_id`)،
   * فإعادةُ تسليمِ الحدثِ لا تُضاعِفُ صفّاً — ومعَ ذلكَ يبقى حارسُ المتتالِ هوَ الحاجزَ
   * الأوّلَ: تخطٍّ لقِدَمٍ لا يكتبُ رايةً أصلاً.
   */
  observeInventoryAdjustment(
    data: InventoryAdjustedData,
    context: MirrorContext,
  ): Promise<InventoryObservationOutcome>;

  /* ── replay / rebuild ── */
  /** Clear observations + consumed ledger + checkpoint (NOT delivery_outbox). */
  clearInventoryObservations(): Promise<void>;
}

/* ════════════════════════════════════════════════════════════════════════
 * Store-order aggregate ports — the HTTP boundary's seams (review 6/N,
 * ADR-026 §4.2 deferral lifted for the network edge).
 *
 * Three ports, not one, because they answer three different questions and
 * fail for three different reasons:
 *
 *  - `StoreOrderReadPort`  — the read side of `GET /store-orders/{id}` and
 *    `GET .../delivery-task`. Pure lookups by PUBLIC id: the wire never
 *    learns internal UUIDs as addresses (§2.6).
 *  - `StoreOrderWritePort` — the two commands (place, cancel). Each one is
 *    ONE database transaction; a use case that writes half a placement is a
 *    corrupted ledger, not a partial success.
 *  - `StoreOrderCatalogPort` — the marketplace boundary (§2.3): the ONLY
 *    price source. Never a JOIN into marketplace tables; a caller-supplied
 *    price would let the caller mint money (validation.ts header).
 *
 * The catalog port has NO Postgres adapter in this review and that is a
 * DECLARED limit, not an oversight: `PlaceStoreOrderRequest.store_slug`
 * is a `WS-##########` store ref, while services/marketplace identifies a
 * store by `store_slug`/`store_id` and publishes no public store ref
 * (`StoreResource.owner_public_id` is the OWNER, a different subject). Until
 * that mapping is decided, `POST /store-orders` answers
 * `503 DELIVERY_MARKETPLACE_UNAVAILABLE` — the same honest gap as the
 * ORD-/WS- bridge in RISK-0034, refused rather than faked.
 * ════════════════════════════════════════════════════════════════════════ */

import type { StoreOrderCancelReasonCode, FulfillmentReasonCode, StoreSlug, WaslaPublicId } from "@wasla/contracts-delivery";
import type { DeliveryTask, StoreOrder } from "./domain/model.js";
import type { DeliveryDomainEvent } from "./domain/events.js";
import type { IdempotentRoute } from "./domain/idempotency.js";

/**
 * One request's idempotency contract, carried INTO the write so the key and
 * the effect land in the SAME transaction (review 7/N, ADR-026 §4.10).
 *
 * The key is deliberately not a separate port with its own `begin`/`finish`
 * calls: two transactions mean a window where the key is committed and the
 * order is not (a retry then replays a response for an order that was rolled
 * back), or the reverse (a duplicate order). Passing the intent inward keeps
 * atomicity a property of the adapter's single transaction.
 *
 * `buildResponseBody` receives the order the transaction actually wrote, so
 * the stored body is the same body the caller receives — not a re-serialized
 * guess assembled by a different code path later.
 */
export interface IdempotencyIntent {
  readonly key: string;
  readonly route: IdempotentRoute;
  /** sha256 of the canonical request — a mismatch is a reuse, not a replay. */
  readonly fingerprint: string;
  /** The status to store and to replay verbatim (201 place · 200 cancel). */
  readonly responseStatus: 200 | 201;
  readonly buildResponseBody: (order: StoreOrder) => unknown;
}

/** A stored first response, replayed byte-for-byte on a retry. */
export interface IdempotentReplay {
  readonly kind: "replayed";
  readonly status: number;
  readonly body: unknown;
}

/** A stored key as the read side sees it — fingerprint included, so the
 *  caller can tell a replay from a reuse before doing any work. */
export interface StoredIdempotentResponse {
  readonly fingerprint: string;
  readonly status: number;
  readonly body: unknown;
}

export type PlaceOrderOutcome = { readonly kind: "applied" } | IdempotentReplay;
export type MirrorPaymentOutcome =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;
export type ConfirmOrderOutcome =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;
export type CancelOrderOutcome =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;
export type FulfillmentTransitionOutcome =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;

/** The write for an inventory state mirror (review 10/N, ADR-026 §2.3). */
export interface InventoryMirrorWrite {
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly fromInventoryState: string;
  readonly toInventoryState: string;
  readonly inventoryRef: string | null;
  readonly reasonCode: string;
  readonly events: readonly DeliveryDomainEvent[];
  readonly traceId?: string | null;
}

export interface MirrorInventoryOutcome {
  readonly kind: "applied";
  readonly order: StoreOrder;
}

export interface StoreOrderReadPort {
  /** The order as the wire sees it — null when the public id is unknown. */
  getOrderByPublicId(publicId: WaslaPublicId): Promise<StoreOrder | null>;
  /** The delivery task of an order — null when the ORDER or the task is unknown. */
  getTaskByOrderPublicId(publicId: WaslaPublicId): Promise<DeliveryTask | null>;
  /**
   * A previously stored response for an idempotency key — null when unused.
   *
   * On the read port, and consulted BEFORE the domain runs, because the retry
   * of a successful cancellation would otherwise die in the domain: the order
   * is already `cancelled`, and `cancelled → cancelled` is not an edge (§3.1),
   * so the caller would get `409 DELIVERY_INVALID_TRANSITION` instead of the
   * response it is retrying for. The transactional check inside the write port
   * stays — this one is for a correct answer, that one is for atomicity.
   */
  findIdempotentResponse(key: string): Promise<StoredIdempotentResponse | null>;
}

/** What one placement writes, built entirely in the domain before the write. */
export interface PlacementWrite {
  readonly order: StoreOrder;
  readonly task: DeliveryTask;
  /** Built by `domain/events.ts` — the store only appends them (§2.4). */
  readonly events: readonly DeliveryDomainEvent[];
  readonly traceId: string | null;
  /** Optional so fakes and internal callers may write without a wire key. */
  readonly idempotency?: IdempotencyIntent;
}

/** What one cancellation writes — the order after, plus its ledger rows. */
export interface CancellationWrite {
  readonly orderId: string;
  /** Guard: the version the decision was made against (optimistic concurrency). */
  readonly expectedVersion: number;
  readonly fromFulfillmentState: string;
  readonly reasonCode: StoreOrderCancelReasonCode;
  /** The task's cancellation, when §3.3 has an edge from its current state. */
  readonly taskCancellation: { readonly taskId: string; readonly fromState: string } | null;
  readonly events: readonly DeliveryDomainEvent[];
  readonly traceId: string | null;
  readonly idempotency?: IdempotencyIntent;
}

/**
 * ما تكتبُهُ مرآةُ دفعٍ واحدةٌ (المراجعةُ 9/N · §2.2 · §3.2).
 *
 * `paymentRef` مُحسوبٌ في النطاقِ (`decidePaymentMirror`) لا في المحوّلِ: قاعدةُ «لا
 * تُسقِطُ المرآةُ مرجعاً كانَ موجوداً» قرارٌ، ومحوّلٌ يُعيدُ حسابَها يُخطئُ وحدَهُ.
 */
export interface PaymentMirrorWrite {
  readonly orderId: string;
  /** Guard: the version the decision was made against (optimistic concurrency). */
  readonly expectedVersion: number;
  readonly fromPaymentState: string;
  readonly toPaymentState: string;
  readonly reasonCode: string;
  /** The reference AFTER this mirror update — never re-derived downstream. */
  readonly paymentRef: string | null;
  readonly events: readonly DeliveryDomainEvent[];
  readonly traceId: string | null;
  readonly idempotency?: IdempotencyIntent;
}

/** ما يكتبُهُ تأكيدٌ واحدٌ: `placed → confirmed` وصفُّ دفترٍ وحدثٌ (§2.2). */
export interface ConfirmationWrite {
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly fromFulfillmentState: string;
  readonly events: readonly DeliveryDomainEvent[];
  readonly traceId: string | null;
  readonly idempotency?: IdempotencyIntent;
}

/** ما يكتبُهُ انتقالُ تنفيذٍ واحدٌ: `fulfillment_state` وصفُّ دفترٍ وحدثٌ (§4.13). */
export interface FulfillmentTransitionWrite {
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly fromFulfillmentState: string;
  readonly toFulfillmentState: string;
  readonly reasonCode: FulfillmentReasonCode;
  readonly actor: { readonly actor_type: string; readonly actor_ref: string | null };
  readonly events: readonly DeliveryDomainEvent[];
  readonly traceId: string | null;
  readonly idempotency?: IdempotencyIntent;
  /**
   * When the transition is `handed_to_courier → delivered`, the inventory
   * consume is written in the SAME transaction: `reserved → consumed` + the
   * `store_order.inventory_consumed` outbox event + the reservations ledger
   * update. Null for all other transitions (no inventory side-effect).
   */
  readonly inventoryConsume?: {
    readonly fromInventoryState: string;
    readonly toInventoryState: string;
    readonly inventoryRef: string;
    readonly reasonCode: string;
    readonly events: readonly DeliveryDomainEvent[];
  } | null;
}

export interface StoreOrderWritePort {
  /**
   * Reserve the next public id (`WS-##########`). Separate from `placeOrder`
   * so the DOMAIN can build the order — and its events — with its final
   * identity, instead of the adapter inventing ids the events never saw.
   */
  nextOrderPublicId(): Promise<WaslaPublicId>;
  /**
   * ONE transaction: order + items + transition + task + outbox rows — and,
   * when `write.idempotency` is present, the key row too. `replayed` means
   * nothing was written and the stored first response must be returned.
   */
  placeOrder(write: PlacementWrite): Promise<PlaceOrderOutcome>;
  /**
   * ONE transaction: `SELECT ... FOR UPDATE`, version check
   * (`DELIVERY_CONCURRENT_UPDATE` on mismatch), state update, ledger rows,
   * outbox events. Returns the order as it stands after the write, or the
   * stored first response when the idempotency key has already been used for
   * this exact request.
   */
  cancelOrder(write: CancellationWrite): Promise<CancelOrderOutcome>;
  /**
   * ONE transaction: lock, version check, `payment_state`/`payment_ref` update,
   * a `state_kind = 'payment'` ledger row, and the outbox event.
   *
   * The ledger row is what makes the mirror auditable: `payment_state` alone
   * answers "where are we?" and never "how did we get here?", and a refund
   * dispute is always the second question.
   */
  mirrorPayment(write: PaymentMirrorWrite): Promise<MirrorPaymentOutcome>;
  /**
   * ONE transaction: lock, version check, `fulfillment_state = 'confirmed'`,
   * a `state_kind = 'fulfillment'` ledger row (`PAYMENT_AUTHORIZED`), and the
   * outbox event. The payment gate is re-read under the lock inside the
   * adapter too — a mirror that flipped to `failed` between the decision and
   * the write must not be confirmed.
   */
  confirmOrder(write: ConfirmationWrite): Promise<ConfirmOrderOutcome>;
  /**
   * ONE transaction: lock, version check, `inventory_state`/`inventory_ref` update,
   * a `state_kind = 'inventory'` ledger row, and the outbox event (review 10/N).
   */
  mirrorInventoryState(write: InventoryMirrorWrite): Promise<MirrorInventoryOutcome>;
  /**
   * ONE transaction: lock, version check, `fulfillment_state` update, a
   * `state_kind = 'fulfillment'` ledger row, the outbox event — and, when
   * `write.inventoryConsume` is present (the `delivered` edge), the inventory
   * `reserved → consumed` transition and its outbox event in the same atomic
   * write (review 11/N, ADR-026 §4.13).
   */
  fulfillmentTransition(write: FulfillmentTransitionWrite): Promise<FulfillmentTransitionOutcome>;
}

/** A price snapshot line as the catalog boundary returns it (§2.3). */
export interface CatalogProductSnapshot {
  readonly productId: string;
  readonly sku: string;
  readonly unitPriceMinorUnits: number;
}

/**
 * A readiness probe (review 7/N, ADR-026 §4.10-2 — §4.9-4 lifted).
 *
 * A port, not a direct pool call in the route, for the same reason every other
 * dependency here is a port: the route must be testable without a database,
 * and the probe must be replaceable without touching the HTTP layer. Only
 * checks this port actually performs may appear in the response — an
 * unwired dependency is reported as `not_claimed`, never as a passing check.
 */
export interface ReadinessCheckResult {
  readonly name: "database";
  readonly ok: boolean;
  readonly detail?: string;
}

export interface ReadinessProbePort {
  /** Never throws: an unreachable dependency IS the answer, not an error. */
  probe(): Promise<readonly ReadinessCheckResult[]>;
}

export interface StoreOrderCatalogPort {
  /**
   * Resolve the store behind its published slug. Returns null when unknown;
   * throws a `DELIVERY_MARKETPLACE_UNAVAILABLE` DeliveryError when the
   * boundary cannot be reached — the difference between "no such store"
   * (404-class) and "we don't know" (503-class) must survive the port.
   *
   * Review 8/N: the parameter is a `StoreSlug`, not a `WaslaPublicId`. The old
   * signature asked marketplace for an identity marketplace never published,
   * which is why no adapter could exist (ADR-026 §4.9-2 → §4.11).
   */
  getStoreBySlug(storeSlug: StoreSlug): Promise<{ storeId: string; orderable: boolean } | null>;
  /**
   * Price snapshots for the requested products, in the requested store.
   *
   * A product the store does not sell, or one not orderable right now, is
   * ABSENT from the result rather than reported with a price: the domain then
   * refuses the line by its own rule (`validateCatalogSnapshot`) instead of
   * this port inventing a refusal reason it has no vocabulary for.
   */
  getProductSnapshots(
    storeId: string,
    productIds: readonly string[],
  ): Promise<readonly CatalogProductSnapshot[]>;
}

/**
 * Inventory reservation port — the marketplace boundary for reserving and
 * releasing stock on order placement / cancellation (ADR-026 §2.3, review 10/N).
 *
 * The delivery service sends a reservation request to the marketplace, which
 * owns the inventory data (quantity_on_hand). The marketplace applies a
 * negative delta with reason "reservation" and publishes
 * `marketplace.inventory_adjusted`. On cancellation, the delivery service
 * requests a release — a positive delta with reason "reservation_release".
 *
 * The idempotency key is derived deterministically from the order's public id,
 * so a retry after a network failure completes the same reservation rather
 * than creating a duplicate.
 */
export interface ReservationLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface ReservationRequest {
  readonly orderPublicId: string;
  readonly storeSlug: StoreSlug;
  readonly items: readonly ReservationLine[];
}

export interface ReservationResult {
  readonly reserved: boolean;
  readonly reservationRef: string;
  readonly insufficientProductId?: string;
  readonly availableQuantity?: number;
}

export interface ReleaseRequest {
  readonly orderPublicId: string;
  readonly storeSlug: StoreSlug;
  readonly reservationRef: string;
  readonly items: readonly ReservationLine[];
}

export interface InventoryReservationPort {
  /**
   * Reserve inventory for an order. Returns `reserved: true` on success, or
   * `reserved: false` with the insufficient product when stock is short.
   * Throws `DELIVERY_MARKETPLACE_UNAVAILABLE` when the boundary is unreachable.
   */
  reserve(req: ReservationRequest): Promise<ReservationResult>;
  /**
   * Release a previously made reservation. Idempotent: a second call for the
   * same reservation is a no-op that returns success.
   */
  release(req: ReleaseRequest): Promise<{ released: boolean }>;
}

/**
 * Reservation store — the delivery-side record of reservations made (review 10/N).
 *
 * Each row is one reserved line item for one order. The store is queried by the
 * confirmation gate to verify `inventory_state=reserved` before allowing
 * `placed → confirmed`.
 */
export interface InventoryReservationStore {
  /** Persist reservations for an order. */
  saveReservations(orderId: string, reservations: readonly ReservationRecord[]): Promise<void>;
  /** Load all active reservations for an order. */
  loadActiveReservations(orderId: string): Promise<readonly ReservationRecord[]>;
  /** Mark reservations as released (on cancellation). */
  releaseReservations(orderId: string): Promise<number>;
  /** Mark reservations as consumed (on fulfillment). */
  consumeReservations(orderId: string): Promise<number>;
}

export interface ReservationRecord {
  readonly reservationId: string;
  readonly orderId: string;
  readonly storeSlug: StoreSlug;
  readonly productId: string;
  readonly sku: string;
  readonly quantityReserved: number;
  readonly unitPriceMinorUnits: number;
  readonly marketplaceReservationRef: string;
  readonly status: "active" | "released" | "consumed";
  readonly reservedAt: string;
  readonly traceId: string | null;
}

/* ── حياةُ مفاتيحِ التماثُلِ ومُكنستُها (المراجعةُ 13/N · ADR-026 §4.15) ── */

/** حصيلةُ دفعةِ مسحٍ واحدةٍ — مُقاسةٌ لا مُقدَّرةٌ. */
export interface IdempotencyKeySweepBatch {
  /** عددُ المفاتيحِ المحذوفةِ في هذهِ الدفعةِ (≤ الحدِّ المطلوبِ). */
  readonly deleted: number;
  /**
   * عددُ المفاتيحِ التي بقيَت منتهيةً بعدَ الدفعةِ.
   *
   * يُقاسُ بعدَ الحذفِ لا قبلَهُ ليكونَ شرطَ توقُّفٍ صادقاً: حلقةٌ تعتمدُ على
   * «دفعةٌ ناقصةٌ ⇒ انتهى» تكذبُ حينَ يتخطّى الاستعلامُ صفوفاً مقفولةً
   * (`SKIP LOCKED`)، فتظنُّ الجدولَ نظيفاً وفيهِ بقيّةٌ.
   */
  readonly remaining: number;
}

/**
 * منفذُ مسحِ المفاتيحِ المنتهيةِ.
 *
 * مفصولٌ عن `StoreOrderWritePort` بقصدٍ: ذاكَ يخدمُ مساراتِ الطلبِ التي يُنتظرُ
 * جوابُها، وهذا صيانةٌ في الخلفيّةِ لا يراها منادٍ. وفصلُهُما يجعلُ حالةَ
 * الاختبارِ «مُكنسةٌ بلا خدمةٍ» و«خدمةٌ بلا مُكنسةٍ» ممكنتَينِ، وكلتاهما
 * تركيبٌ مشروعٌ في التشغيلِ.
 */
export interface IdempotencyKeySweepPort {
  /**
   * حذفُ دفعةٍ من المفاتيحِ المنتهيةِ بحدٍّ أعلى.
   *
   * @param limit أقصى عددٍ يُحذَفُ في هذهِ الدفعةِ (يجبُ أن يكونَ ≥ 1).
   */
  deleteExpiredIdempotencyKeys(limit: number): Promise<IdempotencyKeySweepBatch>;
}
