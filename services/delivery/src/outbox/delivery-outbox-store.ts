/**
 * محوّلُ صندوقِ صادرِ التوصيل — يربطُ `delivery_outbox` بالعقد المشترك (ADR-042 · موجة 3).
 *
 * الاختلافُ الأبرز: المفتاحُ الأساسيُّ هو `outbox_id` لا `id`. هذا الجدولُ يملكُ
 * `trace_id` (G4 مُغلقٌ هنا) لكن بلا `attempts`/`last_error` (G3).
 *
 * Scope: خدمة التوصيل · محوّلُ صندوقِ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: @wasla/outbox · ADR-042 · CLM-0243
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

export class DeliveryOutboxDrainStore implements OutboxDrainStore {
  constructor(
    private readonly tx: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  ) {}

  async claimUnpublished(limit: number): Promise<readonly OutboxRecord[]> {
    const claimed = await this.tx.execute(sql`
      SELECT outbox_id,
             event_id,
             event_type,
             event_version,
             aggregate_type,
             aggregate_id,
             payload,
             occurred_at,
             trace_id
        FROM delivery_outbox
       WHERE published_at IS NULL
       ORDER BY outbox_id ASC
       LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
    `);
    return rowsOf(claimed).map((row) => ({
      id: String(row["outbox_id"]),
      eventId: String(row["event_id"]),
      eventType: String(row["event_type"]),
      eventVersion: String(row["event_version"]),
      aggregateType: String(row["aggregate_type"]),
      aggregateId: String(row["aggregate_id"]),
      payload: row["payload"],
      occurredAt: String(row["occurred_at"]),
      traceId: row["trace_id"] ? String(row["trace_id"]) : null,
      attempts: 0,
    }));
  }

  async markPublished(id: string, publishedAt: string): Promise<boolean> {
    const updated = await this.tx.execute(sql`
      UPDATE delivery_outbox
         SET published_at = ${publishedAt}
       WHERE outbox_id = ${id}
         AND published_at IS NULL
      RETURNING outbox_id
    `);
    return rowsOf(updated).length === 1;
  }
}
