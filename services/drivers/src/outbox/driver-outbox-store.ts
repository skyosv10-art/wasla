/**
 * محوّلُ صندوقِ صادرِ السائقين — يربطُ `driver_outbox` بالعقد المشترك (ADR-042 · موجة 2).
 *
 * مثلُ `customer_outbox` في موجة 1: نفسُ الأعمدة، نفسُ القيود.
 *
 * ## ما لا يملكه هذا الجدول
 *
 * `driver_outbox` بلا `sequence_number` (G2 أُغلق بـ`id`) ·
 * بـ`attempts`/`last_error` (G3 مُغلقٌ — CLM-0245) · بلا `trace_id` (G4). المحوّلُ يعزلُ
 * هذه الفروقَ: `traceId` يُرجعُ `null` · `attempts` يُرجعُ `0` ·
 * `recordDeliveryFailure` لا يُنفَّذ (اختياريّ في العقد).
 *
 * Scope: خدمة السائقين · محوّلُ صندوقِ الصادر
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

export class DriverOutboxDrainStore implements OutboxDrainStore {
  constructor(
    private readonly tx: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  ) {}

  async claimUnpublished(limit: number): Promise<readonly OutboxRecord[]> {
    const claimed = await this.tx.execute(sql`
      SELECT id,
             event_id,
             event_type,
             event_version,
             aggregate_type,
             aggregate_id,
             payload,
             occurred_at,
             attempts
        FROM driver_outbox
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
      aggregateType: String(row["aggregate_type"]),
      aggregateId: String(row["aggregate_id"]),
      payload: row["payload"],
      occurredAt: String(row["occurred_at"]),
      traceId: null,
      attempts: Number(row["attempts"]) || 0,
    }));
  }

  async markPublished(id: string, publishedAt: string): Promise<boolean> {
    const updated = await this.tx.execute(sql`
      UPDATE driver_outbox
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
   * G3 مُغلقٌ لهذا الجدول: الفشلُ يُكتبُ في الصفِّ نفسِه، فلا يعودُ الحدثُ
   * المسمومُ يبدو كحدثٍ طازجٍ في كلِّ مرورٍ.
   */
  async recordDeliveryFailure(id: string, error: string): Promise<void> {
    await this.tx.execute(sql`
      UPDATE driver_outbox
         SET attempts = attempts + 1,
             last_error = ${error}
       WHERE id = ${id}
         AND published_at IS NULL
    `);
  }

}
