/**
 * محوِّلاتُ Postgres لمُرحِّلِ الفوترة (M5-17P · CLM-0375):
 *
 *  - `PostgresRelayCheckpointStore` — نقطةُ التفتيشِ في `billing_relay_checkpoint`.
 *  - `PostgresConsumedEventLedger` — دفترُ الاستهلاكِ في `billing_relay_consumed_events`:
 *    ضمانُ «مرّةً واحدة» الذي لا يعتمدُ على نقطةِ التفتيش. `ON CONFLICT DO NOTHING`
 *    يجعلُ الإدراجَ الثانيَ لنفسِ `(consumer_id, event_id)` يعودُ بـ`false` فيرتدُّ
 *    المُرحِّلُ بالمعاملةِ كلِّها (لا فاتورةَ ولا تسويةَ ثانية).
 *  - `PostgresRelayTransactionRunner` — معاملةٌ واحدةٌ على عميلٍ واحد: الفاتورةُ
 *    والتسويةُ وصفُّ الصادرِ وصفُّ الدفترِ تُلتزَمُ معاً أو ترتدُّ معاً.
 *  - `PostgresRelayConsumerLock` — قفلٌ استشاريٌّ على مستوى الجلسةِ طوالَ الدفعة
 *    (النمطُ نفسُهُ في `services/delivery/src/infrastructure/relay-advisory-lock.ts`).
 *  - `PostgresDeliveryEventSource` (M5-17Q · CLM-0376) — قراءةٌ فقط من
 *    `delivery_outbox` بترتيبِ `(occurred_at, event_id)`؛ المُرحِّلُ لا يكتبُ
 *    صندوقَ التوصيلِ أبداً (حدُّ التوصيلِ: هوَ المنتِجُ الوحيدُ لـ`store_order.*`).
 *  - `PostgresStoreOrderSnapshotStore` (M5-17Q) — إسقاطُ لقطةِ مالِ الطلبِ في
 *    `billing_store_order_snapshots`، مملوكٌ للفوترةِ وحدَها.
 *
 * الطوابعُ تُقرأُ نصّاً بدقّةِ الميكروثانية (`to_char ... US`) لا عبرَ `Date` في JS:
 * `Date` تقطعُ إلى الملّي ثانية فتصيرُ نقطةُ التفتيشِ أقدمَ من الصفِّ الذي مثّلتْهُ،
 * ويُعادُ قراءتُهُ في كلِّ دفعة. أمّا الترتيبُ والمقارنةُ (`isBefore`) فعلى
 * `commit_sequence` وحدَهُ منذُ RISK-0012 (ADR-057)؛ والطوابعُ للتشخيصِ.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";

import type { DeliveryOutboxRow, RelayCheckpoint, StoreOrderSnapshot } from "../../domain/consumed-events.js";
import type {
  ConsumedEventLedger,
  LedgerEntry,
  DeliveryEventSource,
  RelayCheckpointStore,
  RelayConsumerLock,
  RelayTransactionRunner,
  RelayTxPorts,
  StoredOrderSnapshot,
  StoreOrderSnapshotStore,
} from "../../ports.js";
import { PostgresInvoiceStore } from "../drizzle/repository.js";
import * as schema from "../drizzle/schema.js";
import { PostgresOutboxPublisher } from "./outbox-publisher.js";
import type { Queryable } from "./queryable.js";
import { PostgresSettlement } from "./settlement-store.js";

/** ISO-8601 UTC بدقّةِ الميكروثانية — الصيغةُ الوحيدةُ لطوابعِ المُرحِّل. */
const ISO_US = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

export class PostgresRelayCheckpointStore implements RelayCheckpointStore {
  constructor(private readonly db: Queryable) {}

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    const result = await this.db.query<{ last_commit_sequence: string; last_occurred_at: string; last_event_id: string }>(
      `SELECT last_commit_sequence::text AS last_commit_sequence,
              to_char(last_occurred_at AT TIME ZONE 'UTC', ${ISO_US}) AS last_occurred_at,
              last_event_id::text AS last_event_id
         FROM billing_relay_checkpoint
        WHERE consumer_id = $1`,
      [consumerId],
    );
    return result.rows[0] ?? null;
  }

  async writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void> {
    await this.db.query(
      `INSERT INTO billing_relay_checkpoint (consumer_id, last_commit_sequence, last_occurred_at, last_event_id, updated_at)
       VALUES ($1, $2::bigint, $3::timestamptz, $4::uuid, now())
       ON CONFLICT (consumer_id) DO UPDATE
         SET last_commit_sequence = EXCLUDED.last_commit_sequence,
             last_occurred_at = EXCLUDED.last_occurred_at,
             last_event_id    = EXCLUDED.last_event_id,
             updated_at       = now()`,
      [consumerId, checkpoint.last_commit_sequence, checkpoint.last_occurred_at, checkpoint.last_event_id],
    );
  }
}

export class PostgresConsumedEventLedger implements ConsumedEventLedger {
  constructor(private readonly db: Queryable) {}

  async has(consumerId: string, eventId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM billing_relay_consumed_events WHERE consumer_id = $1 AND event_id = $2::uuid`,
      [consumerId, eventId],
    );
    return result.rows.length > 0;
  }

  async record(entry: LedgerEntry): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO billing_relay_consumed_events (consumer_id, event_id, status, reason, settlement_id)
       VALUES ($1, $2::uuid, $3, $4, $5::uuid)
       ON CONFLICT (consumer_id, event_id) DO NOTHING`,
      [entry.consumerId, entry.eventId, entry.status, entry.reason ?? null, entry.settlementId ?? null],
    );
    return (result.rowCount ?? 0) === 1;
  }
}

export class PostgresRelayTransactionRunner implements RelayTransactionRunner {
  constructor(private readonly pool: Pool) {}

  async run<T>(fn: (tx: RelayTxPorts) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ports: RelayTxPorts = {
        invoices: new PostgresInvoiceStore(drizzle(client, { schema })),
        settlements: new PostgresSettlement(client),
        publisher: new PostgresOutboxPublisher(client),
        ledger: new PostgresConsumedEventLedger(client),
        snapshots: new PostgresStoreOrderSnapshotStore(client),
      };
      const value = await fn(ports);
      await client.query("COMMIT");
      return value;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

/** نطاقُ أقفالِ مُرحِّلِ الفوترة — بعيدٌ عن نطاقِ التوصيلِ (42626). */
export const BILLING_RELAY_ADVISORY_LOCK_NAMESPACE = 50050;

export class PostgresRelayConsumerLock implements RelayConsumerLock {
  constructor(private readonly pool: Pool) {}

  async withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock($1::int, hashtext($2))`, [
        BILLING_RELAY_ADVISORY_LOCK_NAMESPACE,
        consumerId,
      ]);
      try {
        return await fn();
      } finally {
        await client.query(`SELECT pg_advisory_unlock($1::int, hashtext($2))`, [
          BILLING_RELAY_ADVISORY_LOCK_NAMESPACE,
          consumerId,
        ]);
      }
    } finally {
      client.release();
    }
  }
}

export class PostgresStoreOrderSnapshotStore implements StoreOrderSnapshotStore {
  constructor(private readonly db: Queryable) {}

  async find(orderId: string): Promise<StoredOrderSnapshot | null> {
    const result = await this.db.query<{
      order_id: string;
      order_public_id: string;
      store_id: string;
      store_slug: string;
      currency_code: "SAR";
      items_total_minor_units: string;
      delivery_fee_minor_units: string;
      source_event_id: string;
      settlement_id: string | null;
    }>(
      `SELECT order_id::text AS order_id, order_public_id, store_id::text AS store_id, store_slug,
              currency_code, items_total_minor_units::text AS items_total_minor_units,
              delivery_fee_minor_units::text AS delivery_fee_minor_units,
              source_event_id::text AS source_event_id, settlement_id::text AS settlement_id
         FROM billing_store_order_snapshots
        WHERE order_id = $1::uuid
        FOR UPDATE`,
      [orderId],
    );
    const r = result.rows[0];
    if (!r) return null;
    return {
      ...r,
      items_total_minor_units: Number(r.items_total_minor_units),
      delivery_fee_minor_units: Number(r.delivery_fee_minor_units),
    };
  }

  async insert(snapshot: StoreOrderSnapshot, sourceEventId: string): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO billing_store_order_snapshots (
         order_id, order_public_id, store_id, store_slug, currency_code,
         items_total_minor_units, delivery_fee_minor_units, source_event_id
       ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::uuid)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        snapshot.order_id,
        snapshot.order_public_id,
        snapshot.store_id,
        snapshot.store_slug,
        snapshot.currency_code,
        snapshot.items_total_minor_units,
        snapshot.delivery_fee_minor_units,
        sourceEventId,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setItemsTotal(orderId: string, itemsTotalMinorUnits: number): Promise<void> {
    const result = await this.db.query(
      `UPDATE billing_store_order_snapshots
          SET items_total_minor_units = $2, updated_at = now()
        WHERE order_id = $1::uuid AND settlement_id IS NULL`,
      [orderId, itemsTotalMinorUnits],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error(`snapshot not adjustable for order ${orderId}`);
  }

  async markSettled(orderId: string, settlementId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE billing_store_order_snapshots
          SET settlement_id = $2::uuid, updated_at = now()
        WHERE order_id = $1::uuid AND settlement_id IS NULL`,
      [orderId, settlementId],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error(`snapshot already settled for order ${orderId}`);
  }
}

/**
 * قراءةٌ فقط من `delivery_outbox` (عقدُ التوصيلِ: `services/delivery/contracts/schema.sql`).
 * الأعمدةُ المقروءةُ هيَ ما يكتبُهُ `appendOutbox` في مخزنِ طلباتِ التوصيلِ حرفيّاً.
 */
export class PostgresDeliveryEventSource implements DeliveryEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly DeliveryOutboxRow[]> {
    // RISK-0012 (CLM-0416, ADR-057): the cursor is `commit_sequence` alone.
    const cpSeq = checkpoint?.last_commit_sequence ?? "0";
    // ORDER BY is table-qualified on purpose: the bare name would bind to the
    // `::text` output alias and sort lexicographically ('10' < '2') — measured
    // in the search leg before this fix (RISK-0012 · CLM-0416).
    const result = await this.pool.query<{
      event_id: string;
      event_type: string;
      event_version: string;
      aggregate_type: string;
      aggregate_id: string;
      occurred_at: string;
      commit_sequence: string;
      trace_id: string | null;
      payload: unknown;
    }>(
      `SELECT event_id::text AS event_id, event_type, event_version, aggregate_type, aggregate_id,
              to_char(occurred_at AT TIME ZONE 'UTC', ${ISO_US}) AS occurred_at,
              commit_sequence::text AS commit_sequence, trace_id, payload
         FROM delivery_outbox
        WHERE commit_sequence > $1::bigint
        ORDER BY delivery_outbox.commit_sequence ASC
        LIMIT $2`,
      [cpSeq, limit],
    );
    return result.rows.map((r) => ({
      event_id: r.event_id,
      event_type: r.event_type,
      event_version: r.event_version,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      occurred_at: r.occurred_at,
      commit_sequence: r.commit_sequence,
      trace_id: r.trace_id,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
