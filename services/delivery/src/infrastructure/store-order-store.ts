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
 */

import type { Pool, PoolClient } from "pg";

import { DeliveryError } from "../domain/errors.js";
import type { DeliveryDomainEvent } from "../domain/events.js";
import type { DeliveryTask, StoreOrder, StoreOrderItem } from "../domain/model.js";
import type {
  CancellationWrite,
  PlacementWrite,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";
import type { WaslaPublicId } from "@wasla/contracts-delivery";

const ORDER_COLUMNS = `
  order_id, public_id, customer_ref, store_id, store_public_id,
  fulfillment_state, payment_state, payment_ref, currency_code,
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

export class StoreOrderStore implements StoreOrderReadPort, StoreOrderWritePort {
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

  /* ── writes ───────────────────────────────────────────────────────── */

  async nextOrderPublicId(): Promise<WaslaPublicId> {
    const { rows } = await this.pool.query(
      `SELECT 'WS-' || lpad(nextval('store_order_public_id_seq')::text, 10, '0') AS public_id`,
    );
    return rows[0].public_id as WaslaPublicId;
  }

  async placeOrder(write: PlacementWrite): Promise<void> {
    const { order, task } = write;
    await this.inTransaction(async (client) => {
      await client.query(
        `INSERT INTO store_orders (
           order_id, public_id, customer_ref, store_id, store_public_id,
           fulfillment_state, payment_state, payment_ref, currency_code,
           items_total_minor_units, delivery_fee_minor_units, total_minor_units,
           placed_at, version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SAR',$9,$10,$11, now(), 1)`,
        [
          order.orderId,
          order.publicId,
          order.customerRef,
          order.storeId,
          order.storePublicId,
          order.fulfillmentState,
          order.paymentState,
          order.paymentRef,
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
    });
  }

  async cancelOrder(write: CancellationWrite): Promise<StoreOrder> {
    return this.inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT ${ORDER_COLUMNS} FROM store_orders WHERE order_id = $1 FOR UPDATE`,
        [write.orderId],
      );
      if (locked.rows.length === 0) {
        throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المعرّفِ", {
          details: { field: "order_id", actual: write.orderId },
        });
      }
      const current = locked.rows[0];
      if (Number(current.version) !== write.expectedVersion) {
        throw new DeliveryError(
          "DELIVERY_CONCURRENT_UPDATE",
          "تغيَّرَ الطلبُ بينَ القراءةِ والكتابةِ — أعِد المحاولةَ",
          {
            details: { expected: String(write.expectedVersion), actual: String(current.version) },
          },
        );
      }

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

      const after = await client.query(
        `SELECT ${ORDER_COLUMNS} FROM store_orders WHERE order_id = $1`,
        [write.orderId],
      );
      const items = await client.query(
        `SELECT line_no, product_id, sku, quantity, unit_price_minor_units,
                line_total_minor_units, substituted_product_id, substitution_reason,
                substitution_price_delta_minor_units, order_item_id
           FROM store_order_items WHERE order_id = $1 ORDER BY line_no`,
        [write.orderId],
      );
      return toOrder(after.rows[0], items.rows);
    });
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
  store_public_id: string;
  fulfillment_state: string;
  payment_state: string;
  payment_ref: string | null;
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
    storePublicId: row.store_public_id as WaslaPublicId,
    fulfillmentState: row.fulfillment_state as StoreOrder["fulfillmentState"],
    paymentState: row.payment_state as StoreOrder["paymentState"],
    paymentRef: row.payment_ref,
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
