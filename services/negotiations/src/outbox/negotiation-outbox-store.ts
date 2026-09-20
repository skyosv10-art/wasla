/**
 * محوّلُ صندوقِ صادرِ المفاوضات — يربطُ `negotiation_outbox` بالعقد المشترك (ADR-042 · موجة 3).
 *
 * هذا أغنى جدولِ صادرٍ في النظام: يملكُ `attempts`/`last_error` (G3 مُغلقٌ هنا)
 * و`trace_id` (G4) و`sequence_number`. لذا يُنفِّذُ `recordDeliveryFailure` فعليًّا.
 *
 * Scope: خدمة المفاوضات · محوّلُ صندوقِ الصادر
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

export class NegotiationOutboxDrainStore implements OutboxDrainStore {
  constructor(
    private readonly tx: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  ) {}

  async claimUnpublished(limit: number): Promise<readonly OutboxRecord[]> {
    const claimed = await this.tx.execute(sql`
      SELECT id,
             event_type,
             event_version,
             aggregate_type,
             aggregate_id,
             payload,
             occurred_at,
             trace_id,
             attempts
        FROM negotiation_outbox
       WHERE published_at IS NULL
       ORDER BY sequence_number ASC
       LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
    `);
    return rowsOf(claimed).map((row) => ({
      id: String(row["id"]),
      eventId: String(row["id"]),
      eventType: String(row["event_type"]),
      eventVersion: String(row["event_version"]),
      aggregateType: String(row["aggregate_type"]),
      aggregateId: String(row["aggregate_id"]),
      payload: row["payload"],
      occurredAt: String(row["occurred_at"]),
      traceId: row["trace_id"] ? String(row["trace_id"]) : null,
      attempts: Number(row["attempts"]) || 0,
    }));
  }

  async markPublished(id: string, publishedAt: string): Promise<boolean> {
    const updated = await this.tx.execute(sql`
      UPDATE negotiation_outbox
         SET published_at = ${publishedAt},
             attempts = attempts + 1,
             last_error = NULL
       WHERE id = ${id}::uuid
         AND published_at IS NULL
      RETURNING id
    `);
    return rowsOf(updated).length === 1;
  }

  async recordDeliveryFailure(id: string, error: string): Promise<void> {
    await this.tx.execute(sql`
      UPDATE negotiation_outbox
         SET attempts = attempts + 1,
             last_error = ${error}
       WHERE id = ${id}::uuid
         AND published_at IS NULL
    `);
  }
}
