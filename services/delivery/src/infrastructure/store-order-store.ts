/**
 * PostgreSQL adapter for the store-order aggregate (ADR-026 §2.1 · §2.3 ·
 * §3.1 · §3.3 · contracts/schema.sql).
 *
 * Implements `StoreOrderReadPort` and `StoreOrderWritePort`. The read side is
 * two queries by PUBLIC id; the write side is two transactions, each of which
 * writes EVERYTHING its command implies or nothing at all.
 *
 * ## Placement is one transaction, including the outbox
 *
 * `store_orders` + `store_order_items` + `store_order_transitions` (draft→
 * placed, reason `CART_CONFIRMED`, actor customer) + `delivery_tasks`
 * (`pending_eligibility`) + two `delivery_outbox` rows, in ONE `BEGIN`. If the
 * outbox append were a second transaction, a crash between them would leave a
 * real order that no consumer ever hears about — the exact failure the outbox
 * pattern exists to prevent. "No state changes silently" has to be
 * transactional to be true.
 *
 * ## Cancellation locks, then checks the version
 *
 * `SELECT ... FOR UPDATE` on the order, compare `version` with the version the
 * decision was made against, and answer `DELIVERY_CONCURRENT_UPDATE` (409) on
 * mismatch. Without the lock, two concurrent cancellations would both read
 * `placed`, both pass the domain check, and both append a transition — two
 * ledger rows for one real event.
 *
 * ## The public id comes from a sequence, not from the application
 *
 * `nextOrderPublicId` reads `store_order_public_id_seq` and formats
 * `'WS-' || lpad(...)`. Generating it in Node would need a uniqueness query
 * and a retry loop that is wrong under concurrency; the database already has
 * a correct answer to "give me a number nobody else got".
 *
 * ## Privacy (§2.6)
 *
 * Every SELECT lists its columns explicitly. `SELECT *` would ship whatever
 * column the schema gains next straight into a response mapper — and the
 * columns most likely to be added to a delivery table are exactly the ones
 * ADR-001 forbids from leaving it.
 *
 * ## Idempotency lives INSIDE the same transaction (review 7/N, §4.10)
 *
 * Both writes take an optional `idempotency` intent and handle it in two
 * steps within the ONE transaction they already open:
 *
 *  1. Before any effect: look the key up. A stored row with the SAME request
 *     fingerprint is a replay — return the stored status and body, write
 *     nothing. A stored row with a DIFFERENT fingerprint is a reuse — refuse
 *     with 409, because answering the first request's body to a second,
 *     different request loses an order silently.
 *  2. After the effect, still inside the transaction: insert the key with the
 *     response the caller is about to receive. Same transaction is the whole
 *     point — a key committed without its order would replay a response for
 *     an order that never existed, and an order committed without its key
 *     would let the retry create a duplicate.
 *
 * There is deliberately NO intermediate `in_progress` key state. A concurrent
 * request with the same key loses the race on the primary key (`23505`) and
 * is refused with `DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT`, rolling back with
 * nothing written; its retry a moment later reads the committed key and
 * replays. That is one wasted round trip in a rare race, in exchange for
 * never needing a sweeper to clean up abandoned in-progress rows — an
 * abandoned row is exactly how a key-based scheme starts refusing honest
 * retries forever.
 */

import type { Pool, PoolClient } from "pg";

import { DeliveryError } from "../domain/errors.js";
import type { DeliveryDomainEvent } from "../domain/events.js";
import type { DeliveryTask, StoreOrder, StoreOrderItem } from "../domain/model.js";
import { toStoreOrderResponse } from "../http/mappers.js";
import type {
  CancelOrderOutcome,
  CancellationWrite,
  ConfirmOrderOutcome,
  ConfirmationWrite,
  FulfillmentTransitionOutcome,
  FulfillmentTransitionWrite,
  InventoryMirrorWrite,
  InventoryReservationStore,
  MirrorInventoryOutcome,
  MirrorPaymentOutcome,
  PaymentMirrorWrite,
  IdempotencyIntent,
  IdempotentReplay,
  PlaceOrderOutcome,
  PlacementWrite,
  ReservationRecord,
  StoreOrderReadPort,
  StoreOrderWritePort,
  StoredIdempotentResponse,
} from "../ports.js";
import type { StoreSlug, WaslaPublicId } from "@wasla/contracts-delivery";

const ORDER_COLUMNS = `
  order_id, public_id, customer_ref, store_id, store_slug,
  fulfillment_state, payment_state, payment_ref, inventory_state, inventory_ref,
  currency_code,
  items_total_minor_units, delivery_fee_minor_units, total_minor_units, version
`;

const TASK_COLUMNS = `
  task_id, order_id, state, ineligibility_reason, dispatch_job_ref,
  courier_ref, proof_type, proof_ref, version
`;

/**
 * The same list, qualified with the task alias. Needed because
 * `getTaskByOrderPublicId` joins `store_orders`, and both tables carry
 * `order_id` — an unqualified list makes PostgreSQL refuse the query with
 * «column reference "order_id" is ambiguous». The integration suite caught
 * exactly this; a fake never would.
 */
const TASK_COLUMNS_QUALIFIED = TASK_COLUMNS.split(",")
  .map((column) => `t.${column.trim()}`)
  .join(", ");

export class StoreOrderStore implements StoreOrderReadPort, StoreOrderWritePort, InventoryReservationStore {
  constructor(private readonly pool: Pool) {}

  /* ── reads ────────────────────────────────────────────────────────── */

  async getOrderByPublicId(publicId: WaslaPublicId): Promise<StoreOrder | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ORDER_COLUMNS} FROM store_orders WHERE public_id = $1`,
      [publicId],
    );
    if (rows.length === 0) return null;
    const items = await this.pool.query(
      `SELECT line_no, product_id, sku, quantity, unit_price_minor_units,
              line_total_minor_units, substituted_product_id, substitution_reason,
              substitution_price_delta_minor_units, order_item_id
         FROM store_order_items
        WHERE order_id = $1
        ORDER BY line_no`,
      [rows[0].order_id],
    );
    return toOrder(rows[0], items.rows);
  }

  async getTaskByOrderPublicId(publicId: WaslaPublicId): Promise<DeliveryTask | null> {
    const { rows } = await this.pool.query(
      `SELECT ${TASK_COLUMNS_QUALIFIED}
         FROM delivery_tasks t
         JOIN store_orders o ON o.order_id = t.order_id
        WHERE o.public_id = $1`,
      [publicId],
    );
    if (rows.length === 0) return null;
    return toTask(rows[0]);
  }

  async findIdempotentResponse(key: string): Promise<StoredIdempotentResponse | null> {
    const { rows } = await this.pool.query(
      `SELECT request_fingerprint, response_status, response_body
         FROM delivery_idempotency_keys
        WHERE idempotency_key = $1`,
      [key],
    );
    if (rows.length === 0) return null;
    return {
      fingerprint: rows[0].request_fingerprint as string,
      status: Number(rows[0].response_status),
      body: rows[0].response_body,
    };
  }

  /* ── writes ───────────────────────────────────────────────────────── */

  async nextOrderPublicId(): Promise<WaslaPublicId> {
    const { rows } = await this.pool.query(
      `SELECT 'WS-' || lpad(nextval('store_order_public_id_seq')::text, 10, '0') AS public_id`,
    );
    return rows[0].public_id as WaslaPublicId;
  }

  async placeOrder(write: PlacementWrite): Promise<PlaceOrderOutcome> {
    const { order, task } = write;
    return this.inTransaction<PlaceOrderOutcome>(async (client) => {
      const replay = await lookupIdempotencyKey(client, write.idempotency);
      if (replay !== null) return replay;

      await client.query(
        `INSERT INTO store_orders (
           order_id, public_id, customer_ref, store_id, store_slug,
           fulfillment_state, payment_state, payment_ref, inventory_state, inventory_ref,
           currency_code,
           items_total_minor_units, delivery_fee_minor_units, total_minor_units,
           placed_at, version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SAR',$11,$12,$13, now(), 1)`,
        [
          order.orderId,
          order.publicId,
          order.customerRef,
          order.storeId,
          order.storeSlug,
          order.fulfillmentState,
          order.paymentState,
          order.paymentRef,
          order.inventoryState,
          order.inventoryRef,
          order.itemsTotalMinorUnits,
          order.deliveryFeeMinorUnits,
          order.totalMinorUnits,
        ],
      );

      for (const item of order.items) {
        await client.query(
          `INSERT INTO store_order_items (
             order_item_id, order_id, line_no, product_id, sku, quantity,
             unit_price_minor_units, line_total_minor_units
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            item.orderItemId,
            order.orderId,
            item.lineNo,
            item.productId,
            item.sku,
            item.quantity,
            item.unitPriceMinorUnits,
            item.lineTotalMinorUnits,
          ],
        );
      }

      // The edge draft→placed is RECORDED even though no row ever held
      // `draft`: the ledger answers "how did this order come to be placed?",
      // and an empty answer would make the first state look uncaused.
      await client.query(
        `INSERT INTO store_order_transitions (
           order_id, state_kind, from_state, to_state, reason_code,
           actor_type, actor_ref, trace_id
         ) VALUES ($1,'fulfillment','draft',$2,'CART_CONFIRMED','customer',$3,$4)`,
        [order.orderId, order.fulfillmentState, order.customerRef, write.traceId],
      );

      await client.query(
        `INSERT INTO delivery_tasks (task_id, order_id, state, version)
         VALUES ($1,$2,$3,1)`,
        [task.taskId, task.orderId, task.state],
      );

      await appendOutbox(client, write.events, write.traceId);
      await storeIdempotencyKey(client, write.idempotency, order, write.traceId);
      return { kind: "applied" };
    });
  }

  /**
   * مرآةُ الدفعِ (المراجعةُ 9/N · §2.2 · §3.2): قُفلٌ فنسخةٌ فتحديثٌ فدفترٌ
   * (`state_kind = 'payment'`) فصندوقٌ — وكلُّهُ في `BEGIN` واحدٍ.
   *
   * وحرسٌ ثانٍ تحتَ القُفلِ: إن كانت الحالةُ المحفوظةُ غيرَ التي قُرِئَ عليها
   * القرارُ، يُرفَضُ `DELIVERY_CONCURRENT_UPDATE` حتّى لو وافقَتِ النسخةُ. والنسخةُ
   * تكفي اليومَ لأنَّ كلَّ انتقالٍ يرفعُها؛ والفحصُ المُزدَوَجُ يبقى لأنَّ أوّلَ من
   * يكتبُ تحديثاً ينسى `version + 1` سيجدُ هنا سُدّاً لا ثغرةً.
   */
  async mirrorPayment(write: PaymentMirrorWrite): Promise<MirrorPaymentOutcome> {
    return this.inTransaction<MirrorPaymentOutcome>(async (client) => {
      const replay = await lookupIdempotencyKey(client, write.idempotency);
      if (replay !== null) return replay;

      const current = await lockOrder(client, write.orderId, write.expectedVersion);
      if (current.payment_state !== write.fromPaymentState) {
        throw new DeliveryError(
          "DELIVERY_CONCURRENT_UPDATE",
          "تغيَّرَت مرآةُ الدفعِ بينَ القرارِ والكتابةِ — أعِد المحاولةَ",
          { details: { expected: write.fromPaymentState, actual: String(current.payment_state) } },
        );
      }

      await client.query(
        `UPDATE store_orders
            SET payment_state = $2,
                payment_ref = $3,
                version = version + 1,
                updated_at = now()
          WHERE order_id = $1`,
        [write.orderId, write.toPaymentState, write.paymentRef],
      );
      // فاعلٌ `system` ومرجعٌ فارغٌ: المرآةُ تعكسُ قرارَ مُزوِّدٍ، وإسنادُها للعميلِ
      // في الدفترِ كانَ سيجعلُ تدقيقَ استردادٍ يتّهمُ من لم يفعل.
      await client.query(
        `INSERT INTO store_order_transitions (
           order_id, state_kind, from_state, to_state, reason_code,
           actor_type, actor_ref, trace_id
         ) VALUES ($1,'payment',$2,$3,$4,'system',NULL,$5)`,
        [write.orderId, write.fromPaymentState, write.toPaymentState, write.reasonCode, write.traceId],
      );

      await appendOutbox(client, write.events, write.traceId);
      const order = await readOrderAfterWrite(client, write.orderId);
      await storeIdempotencyKey(client, write.idempotency, order, write.traceId);
      return { kind: "applied", order };
    });
  }

  /**
   * التأكيدُ (§2.2): والبوّابةُ المركَّبةُ تُقرَأُ **تحتَ القُفلِ** لا في القرارِ وحدَهُ.
   *
   * مرآةٌ كانت `authorized` لحظةَ القرارِ وانقلبَت إلى `failed` قبلَ الكتابةِ تمنعُ
   * التأكيدَ: وإلّا لكانَ الطلبُ مُؤكَّداً بدفعٍ فاشلٍ — وهو أسوأُ ما يمكنُ أن تُنتجَهُ
   * بوّابةٌ تقرأُ حالتَينِ متعامدتَينِ في لحظتَينِ مختلفتَينِ.
   */
  async confirmOrder(write: ConfirmationWrite): Promise<ConfirmOrderOutcome> {
    return this.inTransaction<ConfirmOrderOutcome>(async (client) => {
      const replay = await lookupIdempotencyKey(client, write.idempotency);
      if (replay !== null) return replay;

      const current = await lockOrder(client, write.orderId, write.expectedVersion);
      if (current.fulfillment_state !== write.fromFulfillmentState) {
        throw new DeliveryError(
          "DELIVERY_CONCURRENT_UPDATE",
          "تغيَّرَ الطلبُ بينَ القرارِ والكتابةِ — أعِد المحاولةَ",
          { details: { expected: write.fromFulfillmentState, actual: String(current.fulfillment_state) } },
        );
      }
      if (current.payment_state !== "authorized") {
        throw new DeliveryError(
          "DELIVERY_PAYMENT_NOT_AUTHORIZED",
          `لا تأكيدَ لطلبٍ ومرآةُ الدفعِ في ${String(current.payment_state)} — البوّابةُ تطلبُ authorized`,
          { details: { expected: "authorized", actual: String(current.payment_state) } },
        );
      }
      if (current.inventory_state !== "reserved") {
        throw new DeliveryError(
          "DELIVERY_INVENTORY_NOT_RESERVED",
          `لا تأكيدَ لطلبٍ وحالةُ المخزونِ ${String(current.inventory_state)} — البوّابةُ تطلبُ reserved`,
          { details: { expected: "reserved", actual: String(current.inventory_state) } },
        );
      }

      await client.query(
        `UPDATE store_orders
            SET fulfillment_state = 'confirmed',
                version = version + 1,
                updated_at = now()
          WHERE order_id = $1`,
        [write.orderId],
      );
      await client.query(
        `INSERT INTO store_order_transitions (
           order_id, state_kind, from_state, to_state, reason_code,
           actor_type, actor_ref, trace_id
         ) VALUES ($1,'fulfillment',$2,'confirmed','PAYMENT_AUTHORIZED','system',NULL,$3)`,
        [write.orderId, write.fromFulfillmentState, write.traceId],
      );

      await appendOutbox(client, write.events, write.traceId);
      const order = await readOrderAfterWrite(client, write.orderId);
      await storeIdempotencyKey(client, write.idempotency, order, write.traceId);
      return { kind: "applied", order };
    });
  }

  async cancelOrder(write: CancellationWrite): Promise<CancelOrderOutcome> {
    return this.inTransaction<CancelOrderOutcome>(async (client) => {
      const replay = await lookupIdempotencyKey(client, write.idempotency);
      if (replay !== null) return replay;

      const current = await lockOrder(client, write.orderId, write.expectedVersion);

      await client.query(
        `UPDATE store_orders
            SET fulfillment_state = 'cancelled',
                cancelled_at = now(),
                version = version + 1,
                updated_at = now()
          WHERE order_id = $1`,
        [write.orderId],
      );
      await client.query(
        `INSERT INTO store_order_transitions (
           order_id, state_kind, from_state, to_state, reason_code,
           actor_type, actor_ref, trace_id
         ) VALUES ($1,'fulfillment',$2,'cancelled',$3,'customer',$4,$5)`,
        [
          write.orderId,
          write.fromFulfillmentState,
          write.reasonCode,
          current.customer_ref,
          write.traceId,
        ],
      );

      if (write.taskCancellation !== null) {
        await client.query(
          `UPDATE delivery_tasks
              SET state = 'cancelled', version = version + 1, updated_at = now()
            WHERE task_id = $1`,
          [write.taskCancellation.taskId],
        );
        await client.query(
          `INSERT INTO delivery_task_transitions (
             task_id, from_state, to_state, reason_code, actor_type, actor_ref, trace_id
           ) VALUES ($1,$2,'cancelled',$3,'customer',$4,$5)`,
          [
            write.taskCancellation.taskId,
            write.taskCancellation.fromState,
            write.reasonCode,
            current.customer_ref,
            write.traceId,
          ],
        );
      }

      await appendOutbox(client, write.events, write.traceId);

      const order = await readOrderAfterWrite(client, write.orderId);
      await storeIdempotencyKey(client, write.idempotency, order, write.traceId);
      return { kind: "applied", order };
    });
  }

  /**
   * مرآةُ المخزونِ (المراجعةُ 10/N · §2.3): تحديثُ `inventory_state` و`inventory_ref`
   * تحتَ القُفلِ، ثمّ دفترُ انتقالٍ (`state_kind = 'inventory'`) ثمّ صندوقٌ.
   */
  async mirrorInventoryState(write: InventoryMirrorWrite): Promise<MirrorInventoryOutcome> {
    return this.inTransaction(async (client) => {
      const current = await lockOrder(client, write.orderId, write.expectedVersion);
      if (current.inventory_state !== write.fromInventoryState) {
        throw new DeliveryError(
          "DELIVERY_CONCURRENT_UPDATE",
          "تغيَّرَت حالةُ المخزونِ بينَ القرارِ والكتابةِ — أعِد المحاولةَ",
          { details: { expected: write.fromInventoryState, actual: String(current.inventory_state) } },
        );
      }
      await client.query(
        `UPDATE store_orders
            SET inventory_state = $2,
                inventory_ref = $3,
                version = version + 1,
                updated_at = now()
          WHERE order_id = $1`,
        [write.orderId, write.toInventoryState, write.inventoryRef],
      );
      await client.query(
        `INSERT INTO store_order_transitions (
           order_id, state_kind, from_state, to_state, reason_code,
           actor_type, actor_ref, trace_id
         ) VALUES ($1,'inventory',$2,$3,$4,'system',NULL,$5)`,
        [write.orderId, write.fromInventoryState, write.toInventoryState, write.reasonCode, write.traceId ?? null],
      );
      await appendOutbox(client, write.events, write.traceId ?? null);
      const order = await readOrderAfterWrite(client, write.orderId);
      // Update any stored placement idempotency response so a retry replays
      // the post-reservation order, not the pre-reservation snapshot (the
      // mirror bumped the version; a replay returning the old version would
      // falsely report a stale order).
      await client.query(
        `UPDATE delivery_idempotency_keys
            SET response_body = $2
          WHERE response_body->>'order_id' = $1`,
        [write.orderId, JSON.stringify(toStoreOrderResponse(order))],
      );
      return { kind: "applied", order };
    });
  }

  /**
   * انتقالُ التنفيذِ (المراجعةُ 11/N · §4.13): تحديثُ `fulfillment_state` تحتَ القُفلِ،
   * ثمّ دفترُ انتقالٍ، ثمّ صندوقٌ — وعندَ `delivered` يُكتبُ الخصمُ النهائيُّ في نفسِ المعاملةِ.
   */
  async fulfillmentTransition(write: FulfillmentTransitionWrite): Promise<FulfillmentTransitionOutcome> {
    return this.inTransaction<FulfillmentTransitionOutcome>(async (client) => {
      const replay = await lookupIdempotencyKey(client, write.idempotency);
      if (replay !== null) return replay;

      const current = await lockOrder(client, write.orderId, write.expectedVersion);
      if (current.fulfillment_state !== write.fromFulfillmentState) {
        throw new DeliveryError(
          "DELIVERY_CONCURRENT_UPDATE",
          "تغيَّرَ الطلبُ بينَ القرارِ والكتابةِ — أعِد المحاولةَ",
          { details: { expected: write.fromFulfillmentState, actual: String(current.fulfillment_state) } },
        );
      }

      await client.query(
        `UPDATE store_orders
            SET fulfillment_state = $2,
                version = version + 1,
                updated_at = now()
          WHERE order_id = $1`,
        [write.orderId, write.toFulfillmentState],
      );
      await client.query(
        `INSERT INTO store_order_transitions (
           order_id, state_kind, from_state, to_state, reason_code,
           actor_type, actor_ref, trace_id
         ) VALUES ($1,'fulfillment',$2,$3,$4,$5,$6,$7)`,
        [
          write.orderId, write.fromFulfillmentState, write.toFulfillmentState,
          write.reasonCode, write.actor.actor_type, write.actor.actor_ref,
          write.traceId,
        ],
      );

      // When delivered: consume inventory in the SAME transaction (§4.13)
      if (write.inventoryConsume !== null && write.inventoryConsume !== undefined) {
        const ic = write.inventoryConsume;
        if (current.inventory_state !== ic.fromInventoryState) {
          throw new DeliveryError(
            "DELIVERY_CONCURRENT_UPDATE",
            "تغيَّرَت حالةُ المخزونِ بينَ القرارِ والكتابةِ — أعِد المحاولةَ",
            { details: { expected: ic.fromInventoryState, actual: String(current.inventory_state) } },
          );
        }
        await client.query(
          `UPDATE store_orders
              SET inventory_state = $2,
                  version = version + 1,
                  updated_at = now()
            WHERE order_id = $1`,
          [write.orderId, ic.toInventoryState],
        );
        await client.query(
          `INSERT INTO store_order_transitions (
             order_id, state_kind, from_state, to_state, reason_code,
             actor_type, actor_ref, trace_id
           ) VALUES ($1,'inventory',$2,$3,$4,'system',NULL,$5)`,
          [write.orderId, ic.fromInventoryState, ic.toInventoryState, ic.reasonCode, write.traceId],
        );
        await appendOutbox(client, ic.events, write.traceId);
      }

      await appendOutbox(client, write.events, write.traceId);
      const order = await readOrderAfterWrite(client, write.orderId);
      await storeIdempotencyKey(client, write.idempotency, order, write.traceId);
      return { kind: "applied", order };
    });
  }

  /* ── inventory reservations (review 10/N) ─────────────────────────── */

  async saveReservations(_orderId: string, reservations: readonly ReservationRecord[]): Promise<void> {
    await this.inTransaction(async (client) => {
      for (const r of reservations) {
        await client.query(
          `INSERT INTO delivery_inventory_reservations (
             reservation_id, order_id, store_slug, product_id, sku,
             quantity_reserved, unit_price_minor_units,
             marketplace_reservation_ref, status, reserved_at, trace_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',now(),$9)`,
          [
            r.reservationId, r.orderId, r.storeSlug, r.productId, r.sku,
            r.quantityReserved, r.unitPriceMinorUnits,
            r.marketplaceReservationRef, r.traceId,
          ],
        );
      }
    });
  }

  async loadActiveReservations(orderId: string): Promise<readonly ReservationRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT reservation_id, order_id, store_slug, product_id, sku,
              quantity_reserved, unit_price_minor_units,
              marketplace_reservation_ref, status, reserved_at, trace_id
         FROM delivery_inventory_reservations
        WHERE order_id = $1 AND status = 'active'
        ORDER BY reserved_at`,
      [orderId],
    );
    return rows.map((r) => ({
      reservationId: r.reservation_id,
      orderId: r.order_id,
      storeSlug: r.store_slug,
      productId: r.product_id,
      sku: r.sku,
      quantityReserved: Number(r.quantity_reserved),
      unitPriceMinorUnits: Number(r.unit_price_minor_units),
      marketplaceReservationRef: r.marketplace_reservation_ref,
      status: r.status as "active" | "released" | "consumed",
      reservedAt: r.reserved_at,
      traceId: r.trace_id,
    }));
  }

  async releaseReservations(orderId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE delivery_inventory_reservations
          SET status = 'released', released_at = now()
        WHERE order_id = $1 AND status = 'active'`,
      [orderId],
    );
    return rowCount ?? 0;
  }

  async consumeReservations(orderId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE delivery_inventory_reservations
          SET status = 'consumed'
        WHERE order_id = $1 AND status = 'active'`,
      [orderId],
    );
    return rowCount ?? 0;
  }

  /**
   * One place that owns BEGIN/COMMIT/ROLLBACK and the client release. A
   * per-method `try/finally` would eventually be written without the
   * `finally`, and a leaked client is an outage that looks like slowness.
   */
  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * القُفلُ وفحصُ النسخةِ في مكانٍ واحدٍ — تستعملُهُ الكتاباتُ الثلاثُ (إلغاءٌ · مرآةُ
 * دفعٍ · تأكيدٌ).
 *
 * وثلاثُ نسخٍ من `SELECT ... FOR UPDATE` ومقارنةِ نسخةٍ كانت ستعني أنَّ أوّلَ من
 * ينسى `FOR UPDATE` في الرابعةِ يُنشئُ صفَّي دفترٍ لحدثٍ واحدٍ — وهو عطبٌ لا يظهرُ
 * إلاّ تحتَ تزامُنٍ حقيقيٍّ، أي في الإنتاجِ.
 */
async function lockOrder(
  client: PoolClient,
  orderId: string,
  expectedVersion: number,
): Promise<OrderRow> {
  const locked = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM store_orders WHERE order_id = $1 FOR UPDATE`,
    [orderId],
  );
  if (locked.rows.length === 0) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المعرّفِ", {
      details: { field: "order_id", actual: orderId },
    });
  }
  const current = locked.rows[0] as OrderRow;
  if (Number(current.version) !== expectedVersion) {
    throw new DeliveryError(
      "DELIVERY_CONCURRENT_UPDATE",
      "تغيَّرَ الطلبُ بينَ القراءةِ والكتابةِ — أعِد المحاولةَ",
      { details: { expected: String(expectedVersion), actual: String(current.version) } },
    );
  }
  return current;
}

/**
 * الطلبُ كما صارَ بعدَ الكتابةِ، من داخلِ المعاملةِ نفسِها.
 *
 * ولا يُبنى الجوابُ من المجموعةِ التي حسبَها النطاقُ: العمودُ المحسوبُ في القاعدةِ
 * (`total_minor_units`) و`version` بعدَ `+ 1` حقيقتانِ تملكُهُما القاعدةُ، ومن يُجيبُ
 * بتقديرِهِ لهما يُجيبُ بما لم يُحفَظ.
 */
async function readOrderAfterWrite(client: PoolClient, orderId: string): Promise<StoreOrder> {
  const after = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM store_orders WHERE order_id = $1`,
    [orderId],
  );
  const items = await client.query(
    `SELECT line_no, product_id, sku, quantity, unit_price_minor_units,
            line_total_minor_units, substituted_product_id, substitution_reason,
            substitution_price_delta_minor_units, order_item_id
       FROM store_order_items WHERE order_id = $1 ORDER BY line_no`,
    [orderId],
  );
  return toOrder(after.rows[0], items.rows);
}

/**
 * Step 1 of the idempotency handshake: has this key been used?
 *
 * Returns a replay when the key exists with the SAME fingerprint, `null` when
 * the key is new (or no intent was supplied), and throws `409` when the key
 * exists with a DIFFERENT fingerprint. The throw aborts the caller's
 * transaction before any effect — a reused key must change nothing.
 */
async function lookupIdempotencyKey(
  client: PoolClient,
  intent: IdempotencyIntent | undefined,
): Promise<IdempotentReplay | null> {
  if (intent === undefined) return null;
  const { rows } = await client.query(
    `SELECT request_fingerprint, response_status, response_body
       FROM delivery_idempotency_keys
      WHERE idempotency_key = $1`,
    [intent.key],
  );
  if (rows.length === 0) return null;
  const stored = rows[0];
  if (stored.request_fingerprint !== intent.fingerprint) {
    throw new DeliveryError(
      "DELIVERY_IDEMPOTENCY_KEY_REUSED",
      "المفتاحُ نفسُهُ مُستعمَلٌ لطلبٍ مختلفٍ — ولِّد مفتاحاً جديداً",
      // The two fingerprints are NOT reported: they hash the request body, and
      // a diff of hashes tells the caller nothing it does not already know.
      { details: { field: "Idempotency-Key" } },
    );
  }
  return {
    kind: "replayed",
    status: Number(stored.response_status),
    // `jsonb` comes back already parsed — the stored body is returned as it
    // was stored, not re-serialized from a freshly read order (which could
    // differ if the order changed after the first response).
    body: stored.response_body,
  };
}

/**
 * Step 2: persist the key WITH the response, inside the caller's transaction.
 *
 * A `23505` here means another transaction committed the same key while this
 * one was working. Refusing (and rolling back) is the only safe answer: this
 * transaction's effect would be the duplicate the key exists to prevent.
 */
async function storeIdempotencyKey(
  client: PoolClient,
  intent: IdempotencyIntent | undefined,
  order: StoreOrder,
  traceId: string | null,
): Promise<void> {
  if (intent === undefined) return;
  try {
    await client.query(
      `INSERT INTO delivery_idempotency_keys (
         idempotency_key, route, request_fingerprint, response_status,
         response_body, order_id, trace_id
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        intent.key,
        intent.route,
        intent.fingerprint,
        intent.responseStatus,
        JSON.stringify(intent.buildResponseBody(order)),
        order.orderId,
        traceId,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new DeliveryError(
        "DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT",
        "طلبٌ بالمفتاحِ نفسِهِ يُعالَجُ الآنَ — أعِد بالمفتاحِ نفسِهِ بعدَ لحظةٍ",
        { details: { field: "Idempotency-Key" } },
      );
    }
    throw error;
  }
}

/** Append domain events to the outbox — envelope fields, never re-derived. */
async function appendOutbox(
  client: PoolClient,
  events: readonly DeliveryDomainEvent[],
  traceId: string | null,
): Promise<void> {
  for (const event of events) {
    await client.query(
      `INSERT INTO delivery_outbox (
         event_id, event_type, event_version, aggregate_type, aggregate_id,
         payload, trace_id, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.event_id,
        event.event_type,
        event.event_version,
        event.aggregate.type,
        event.aggregate.id,
        JSON.stringify(event.payload),
        event.trace_id ?? traceId,
        event.occurred_at,
      ],
    );
  }
}

/* ── row → domain ─────────────────────────────────────────────────────── */

interface OrderRow {
  order_id: string;
  public_id: string;
  customer_ref: string;
  store_id: string;
  store_slug: string;
  fulfillment_state: string;
  payment_state: string;
  payment_ref: string | null;
  inventory_state: string;
  inventory_ref: string | null;
  items_total_minor_units: string | number;
  delivery_fee_minor_units: string | number;
  total_minor_units: string | number;
  version: string | number;
}

interface ItemRow {
  order_item_id: string;
  line_no: string | number;
  product_id: string;
  sku: string;
  quantity: string | number;
  unit_price_minor_units: string | number;
  line_total_minor_units: string | number;
  substituted_product_id: string | null;
  substitution_reason: string | null;
  substitution_price_delta_minor_units: string | number | null;
}

function toOrder(row: OrderRow, itemRows: readonly ItemRow[]): StoreOrder {
  const items: StoreOrderItem[] = itemRows.map((item) => ({
    orderItemId: item.order_item_id,
    lineNo: Number(item.line_no),
    productId: item.product_id,
    sku: item.sku,
    quantity: Number(item.quantity),
    unitPriceMinorUnits: Number(item.unit_price_minor_units),
    lineTotalMinorUnits: Number(item.line_total_minor_units),
    ...(item.substituted_product_id === null
      ? {}
      : {
          substitutedProductId: item.substituted_product_id,
          substitutionReason: item.substitution_reason as StoreOrderItem["substitutionReason"],
          substitutionPriceDeltaMinorUnits:
            item.substitution_price_delta_minor_units === null
              ? 0
              : Number(item.substitution_price_delta_minor_units),
        }),
  }));

  return {
    orderId: row.order_id,
    publicId: row.public_id as WaslaPublicId,
    customerRef: row.customer_ref as WaslaPublicId,
    storeId: row.store_id,
    storeSlug: row.store_slug as StoreSlug,
    fulfillmentState: row.fulfillment_state as StoreOrder["fulfillmentState"],
    paymentState: row.payment_state as StoreOrder["paymentState"],
    paymentRef: row.payment_ref,
    inventoryState: row.inventory_state as StoreOrder["inventoryState"],
    inventoryRef: row.inventory_ref,
    currencyCode: "SAR",
    itemsTotalMinorUnits: Number(row.items_total_minor_units),
    deliveryFeeMinorUnits: Number(row.delivery_fee_minor_units),
    totalMinorUnits: Number(row.total_minor_units),
    items,
    version: Number(row.version),
  };
}

interface TaskRow {
  task_id: string;
  order_id: string;
  state: string;
  ineligibility_reason: string | null;
  dispatch_job_ref: string | null;
  courier_ref: string | null;
  proof_type: string | null;
  proof_ref: string | null;
  version: string | number;
}

function toTask(row: TaskRow): DeliveryTask {
  return {
    taskId: row.task_id,
    orderId: row.order_id,
    state: row.state as DeliveryTask["state"],
    ineligibilityReason: row.ineligibility_reason as DeliveryTask["ineligibilityReason"],
    dispatchJobRef: row.dispatch_job_ref,
    courierRef: row.courier_ref as WaslaPublicId | null,
    proof:
      row.proof_type === null || row.proof_ref === null
        ? null
        : { proofType: row.proof_type as "otp" | "photo" | "signature" | "pin_code", proofRef: row.proof_ref },
    version: Number(row.version),
  };
}
