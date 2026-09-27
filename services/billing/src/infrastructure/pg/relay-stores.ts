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
 *  - `PostgresOrderEventSource` — قراءةٌ فقط من `order_outbox` بترتيبِ
 *    `(occurred_at, event_id)`؛ المُرحِّلُ لا يكتبُ `order_outbox` أبداً.
 *
 * الطوابعُ تُقرأُ نصّاً بدقّةِ الميكروثانية (`to_char ... US`) لا عبرَ `Date` في JS:
 * `Date` تقطعُ إلى الملّي ثانية فتصيرُ نقطةُ التفتيشِ أقدمَ من الصفِّ الذي مثّلتْهُ،
 * ويُعادُ قراءتُهُ في كلِّ دفعة. والصيغةُ واحدةٌ في المصدرِ ونقطةِ التفتيش لأنَّ
 * المُحرِّكَ يقارنُها معجميّاً (`isBefore`).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";

import type { OrderOutboxRow, RelayCheckpoint } from "../../domain/consumed-events.js";
import type {
  ConsumedEventLedger,
  LedgerEntry,
  OrderEventSource,
  RelayCheckpointStore,
  RelayConsumerLock,
  RelayTransactionRunner,
  RelayTxPorts,
} from "../../ports.js";
import { PostgresInvoiceStore } from "../drizzle/repository.js";
import * as schema from "../drizzle/schema.js";
import { PostgresOutboxPublisher } from "./outbox-publisher.js";
import type { Queryable } from "./queryable.js";
import { PostgresSettlement } from "./settlement-store.js";

/** ISO-8601 UTC بدقّةِ الميكروثانية — الصيغةُ الوحيدةُ لطوابعِ المُرحِّل. */
const ISO_US = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const ZERO_EVENT_ID = "00000000-0000-0000-0000-000000000000";

export class PostgresRelayCheckpointStore implements RelayCheckpointStore {
  constructor(private readonly db: Queryable) {}

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    const result = await this.db.query<{ last_occurred_at: string; last_event_id: string }>(
      `SELECT to_char(last_occurred_at AT TIME ZONE 'UTC', ${ISO_US}) AS last_occurred_at,
              last_event_id::text AS last_event_id
         FROM billing_relay_checkpoint
        WHERE consumer_id = $1`,
      [consumerId],
    );
    return result.rows[0] ?? null;
  }

  async writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void> {
    await this.db.query(
      `INSERT INTO billing_relay_checkpoint (consumer_id, last_occurred_at, last_event_id, updated_at)
       VALUES ($1, $2::timestamptz, $3::uuid, now())
       ON CONFLICT (consumer_id) DO UPDATE
         SET last_occurred_at = EXCLUDED.last_occurred_at,
             last_event_id    = EXCLUDED.last_event_id,
             updated_at       = now()`,
      [consumerId, checkpoint.last_occurred_at, checkpoint.last_event_id],
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

export class PostgresOrderEventSource implements OrderEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly OrderOutboxRow[]> {
    const cpAt = checkpoint?.last_occurred_at ?? new Date(0).toISOString();
    const cpId = checkpoint?.last_event_id ?? ZERO_EVENT_ID;
    const result = await this.pool.query<{
      event_id: string;
      event_type: string;
      event_version: string;
      aggregate_type: string;
      aggregate_id: string;
      occurred_at: string;
      trace_id: string | null;
      payload: unknown;
    }>(
      `SELECT event_id::text AS event_id, event_type, event_version, aggregate_type, aggregate_id,
              to_char(occurred_at AT TIME ZONE 'UTC', ${ISO_US}) AS occurred_at, trace_id, payload
         FROM order_outbox
        WHERE (occurred_at, event_id) > ($1::timestamptz, $2::uuid)
        ORDER BY occurred_at ASC, event_id ASC
        LIMIT $3`,
      [cpAt, cpId, limit],
    );
    return result.rows.map((r) => ({
      event_id: r.event_id,
      event_type: r.event_type,
      event_version: r.event_version,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      occurred_at: r.occurred_at,
      trace_id: r.trace_id,
      data: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
