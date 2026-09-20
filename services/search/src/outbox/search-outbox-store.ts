/**
 * محوّلُ صندوقِ صادرِ البحث — يربطُ `search_outbox` بالعقد المشترك (ADR-042 · موجة 3).
 *
 * مثلُ `geo_outbox`: بلا `aggregate_type`. المحوّلُ يُرجعُ `"search"` كقيمةٍ ثابتة.
 * معَ `trace_id` (G4 مُغلقٌ) · ومعَ `attempts`/`last_error` (G3 مُغلقٌ — CLM-0246).
 *
 * Scope: خدمة البحث · محوّلُ صندوقِ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: @wasla/outbox · ADR-042 · CLM-0243 · CLM-0246 (G3 موجةُ 2)
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

export class SearchOutboxDrainStore implements OutboxDrainStore {
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
             occurred_at,
             attempts,
             trace_id
        FROM search_outbox
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
      aggregateType: "search",
      aggregateId: String(row["aggregate_id"]),
      payload: row["payload"],
      occurredAt: String(row["occurred_at"]),
      traceId: row["trace_id"] ? String(row["trace_id"]) : null,
      attempts: Number(row["attempts"]) || 0,
    }));
  }

  async markPublished(id: string, publishedAt: string): Promise<boolean> {
    const updated = await this.tx.execute(sql`
      UPDATE search_outbox
         SET published_at = ${publishedAt},
             attempts = attempts + 1,
             last_error = NULL
       WHERE id = ${id}
         AND published_at IS NULL
      RETURNING id
    `);
    return rowsOf(updated).length === 1;
  }

  /**
   * G3 مُغلقٌ لهذا الجدول (موجةُ 2 · `CLM-0246`): الفشلُ يُكتبُ في الصفِّ نفسِه،
   * فلا يعودُ الحدثُ المسمومُ يبدو كحدثٍ طازجٍ في كلِّ مرورٍ.
   */
  async recordDeliveryFailure(id: string, error: string): Promise<void> {
    await this.tx.execute(sql`
      UPDATE search_outbox
         SET attempts = attempts + 1,
             last_error = ${error}
       WHERE id = ${id}
         AND published_at IS NULL
    `);
  }
}
