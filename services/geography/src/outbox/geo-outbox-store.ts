/**
 * محوّلُ صندوقِ صادرِ الجغرافيا — يربطُ `geo_outbox` بالعقد المشترك (ADR-042 · موجة 2).
 *
 * الاختلافُ عن `customer_outbox` و`driver_outbox`: `geo_outbox` بلا `aggregate_type`.
 * المحوّلُ يُرجعُ `aggregateType` كقيمةٍ ثابتةٍ `"geography"` لتعبئةِ العقد.
 *
 * ## ما لا يملكه هذا الجدول
 *
 * `geo_outbox` بلا `aggregate_type` · بلا `sequence_number` (G2) ·
 * بلا `attempts`/`last_error` (G3) · بلا `trace_id` (G4).
 *
 * Scope: خدمة الجغرافيا · محوّلُ صندوقِ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: @wasla/outbox · ADR-042 · CLM-0242
 */

import { sql } from "drizzle-orm";
import type {
  OutboxDrainStore,
  OutboxRecord,
} from "@wasla/outbox";

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as readonly Record<string, unknown>[];
  const rows = (result as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as readonly Record<string, unknown>[];
  return [];
}

export class GeographyOutboxDrainStore implements OutboxDrainStore {
  constructor(
    private readonly tx: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  ) {}

  async claimUnpublished(limit: number): Promise<readonly OutboxRecord[]> {
    const claimed = await this.tx.execute(sql`
      SELECT id,
             event_id,
             event_type,
             event_version,
             aggregate_id,
             payload,
             occurred_at
        FROM geo_outbox
       WHERE published_at IS NULL
       ORDER BY id ASC
       LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
    `);
    return rowsOf(claimed).map((row) => ({
      id: String(row["id"]),
      eventId: String(row["event_id"]),
      eventType: String(row["event_type"]),
      eventVersion: String(row["event_version"]),
      aggregateType: "geography",
      aggregateId: String(row["aggregate_id"]),
      payload: row["payload"],
      occurredAt: String(row["occurred_at"]),
      traceId: null,
      attempts: 0,
    }));
  }

  async markPublished(id: string, publishedAt: string): Promise<boolean> {
    const updated = await this.tx.execute(sql`
      UPDATE geo_outbox
         SET published_at = ${publishedAt}
       WHERE id = ${id}
         AND published_at IS NULL
      RETURNING id
    `);
    return rowsOf(updated).length === 1;
  }
}
