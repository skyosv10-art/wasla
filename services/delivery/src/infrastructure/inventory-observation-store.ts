/**
 * PostgresInventoryObservationStore — the delivery-owned state the inventory
 * relay writes (ADR-026 §2.3). Everything an observation touches happens in
 * ONE transaction:
 *
 *   delivery_inventory_observations (upsert, guarded by sequence)
 *   delivery_inventory_conflicts    (رايةٌ تُرفَعُ إن شكَّ الفرقُ في حجزٍ نشطٍ)
 *
 * …so a crash mid-observe leaves NOTHING behind — proven on real Postgres in
 * `marketplace-inventory.integration.test.ts` (rollback test).
 *
 * Idempotency, two layers (port contract: "idempotent per event_id"):
 *   1. the consumed ledger (`delivery_inventory_relay_consumed_events`) —
 *      a terminally-consumed event is never re-processed;
 *   2. the sequence guard — an older redelivered adjustment is
 *      `skipped_stale` before it can regress the snapshot.
 *
 * Read-only towards marketplace: this store NEVER writes to
 * `marketplace_outbox` (no `published_at`) — same boundary rule as ADR-025
 * §2.3.
 */

import type { Pool, PoolClient } from "pg";
import type {
  InventoryAdjustedData,
  InventoryConsumedStatus,
  MarketplaceOutboxRow,
  InventoryRelayCheckpoint,
} from "../domain/marketplace-inventory-events.js";
import type {
  InventoryConflictAcknowledgementOutcome,
  InventoryObservationOutcome,
  InventoryObservationStore,
  MirrorContext,
} from "../ports.js";
import {
  assessInventoryConflict,
  type ActiveReservationLine,
  type InventoryConflictKind,
  type InventoryConflictRow,
} from "../domain/inventory-conflict.js";

/* ════════════════════════════════════════════════════════════════════════
 * أعمدةُ دفترِ الرياتِ ومُحوِّلُها — **موضعٌ واحدٌ لمسارَينِ** (المراجعةُ 18/N)
 *
 * القراءةُ والإقرارُ كلاهما يُعيدُ الصفَّ نفسَهُ إلى نفسِ الحدِّ، ونسخُ القائمةِ
 * والمُحوِّلِ مرّتَينِ يعني أنَّ عموداً يُضافُ لاحقاً يظهرُ في مسارٍ ويغيبُ عن
 * الآخرِ — وهوَ انحرافٌ لا يُسقِطُ اختباراً بل يُنتِجُ جوابَينِ مختلفَينِ لسؤالٍ
 * واحدٍ. والقائمةُ نصٌّ ثابتٌ لا مُركَّبٌ من مُدخَلٍ: لا سطحَ حَقنٍ هنا.
 * ════════════════════════════════════════════════════════════════════════ */

const CONFLICT_COLUMNS = `adjustment_id::text, marketplace_event_id::text, store_id::text, product_id::text,
              conflict_kind, reason_code, quantity_delta, observed_quantity_after,
              adjustment_sequence, affected_order_count, affected_units_total,
              affected_order_public_ids, occurred_for, detected_at,
              acknowledged_at, acknowledged_by, trace_id`;

interface ConflictColumnRow {
  adjustment_id: string;
  marketplace_event_id: string;
  store_id: string;
  product_id: string;
  conflict_kind: InventoryConflictKind;
  reason_code: string;
  quantity_delta: number;
  observed_quantity_after: number;
  adjustment_sequence: number;
  affected_order_count: number;
  affected_units_total: number;
  affected_order_public_ids: string[];
  occurred_for: Date;
  detected_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  trace_id: string | null;
}

function mapConflictRow(row: ConflictColumnRow): InventoryConflictRow {
  return {
    kind: row.conflict_kind,
    storeId: row.store_id,
    productId: row.product_id,
    adjustmentId: row.adjustment_id,
    adjustmentSequence: row.adjustment_sequence,
    quantityDelta: row.quantity_delta,
    observedQuantityAfter: row.observed_quantity_after,
    reasonCode: row.reason_code,
    affectedOrderCount: row.affected_order_count,
    affectedUnitsTotal: row.affected_units_total,
    affectedOrderPublicIds: row.affected_order_public_ids,
    detectedAt: row.detected_at.toISOString(),
    // ثابتٌ لا مقروءٌ: العمودُ عليهِ `CHECK (= FALSE)` في القاعدةِ (§4.18-5)،
    // فقراءتُهُ تُوحي أنَّهُ قد يكونُ `true` يوماً — والقاعدةُ ترفضُ ذلكَ.
    changesOrderState: false as const,
    marketplaceEventId: row.marketplace_event_id,
    occurredFor: row.occurred_for.toISOString(),
    acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
    acknowledgedBy: row.acknowledged_by,
    traceId: row.trace_id,
  };
}

export class PostgresInventoryObservationStore implements InventoryObservationStore {
  constructor(private readonly pool: Pool) {}

  /* ── checkpoint (delivery-owned) ── */

  async getInventoryCheckpoint(consumerId: string): Promise<InventoryRelayCheckpoint | null> {
    const r = await this.pool.query<{ last_occurred_at: Date; last_event_id: string }>(
      `SELECT last_occurred_at, last_event_id::text
         FROM delivery_inventory_relay_checkpoint WHERE consumer_id = $1`,
      [consumerId],
    );
    // ISO دائماً — المحرّكُ يقارنُ معجميّاً (relay.isAfter) وصيغةُ `::text` تنكسر أمامَها.
    return r.rows.length
      ? { last_occurred_at: r.rows[0].last_occurred_at.toISOString(), last_event_id: r.rows[0].last_event_id }
      : null;
  }

  async writeInventoryCheckpoint(consumerId: string, checkpoint: InventoryRelayCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO delivery_inventory_relay_checkpoint (consumer_id, last_occurred_at, last_event_id)
       VALUES ($1, $2::timestamptz, $3::uuid)
       ON CONFLICT (consumer_id)
       DO UPDATE SET last_occurred_at = EXCLUDED.last_occurred_at,
                     last_event_id = EXCLUDED.last_event_id,
                     updated_at = now()`,
      [consumerId, checkpoint.last_occurred_at, checkpoint.last_event_id],
    );
  }

  /* ── consumed-event ledger (idempotency) ── */

  async getInventoryConsumed(eventId: string): Promise<{ status: InventoryConsumedStatus; attempt_count: number } | null> {
    const r = await this.pool.query<{ consumed_status: InventoryConsumedStatus; attempt_count: number }>(
      `SELECT consumed_status, attempt_count FROM delivery_inventory_relay_consumed_events WHERE event_id = $1::uuid`,
      [eventId],
    );
    return r.rows.length ? { status: r.rows[0].consumed_status, attempt_count: r.rows[0].attempt_count } : null;
  }

  async markInventoryConsumed(
    eventId: string,
    row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: InventoryConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO delivery_inventory_relay_consumed_events
         (event_id, event_type, aggregate_type, aggregate_id, consumed_status, attempt_count, last_error)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id)
       DO UPDATE SET consumed_status = EXCLUDED.consumed_status,
                     attempt_count = EXCLUDED.attempt_count,
                     last_error = EXCLUDED.last_error,
                     updated_at = now()`,
      [eventId, row.event_type, row.aggregate_type, row.aggregate_id, status, attemptCount, lastError ?? null],
    );
  }

  /* ── the inventory snapshot ── */

  async observeInventoryAdjustment(
    data: InventoryAdjustedData,
    context: MirrorContext,
  ): Promise<InventoryObservationOutcome> {
    return this.withTransaction<InventoryObservationOutcome>(async (tx) => {
      // Lock the existing observation row (if any) — FOR UPDATE prevents a
      // concurrent observer from racing the sequence check.
      const existing = await tx.query<{ last_adjustment_sequence: number }>(
        `SELECT last_adjustment_sequence
           FROM delivery_inventory_observations
          WHERE store_id = $1::uuid AND product_id = $2::uuid
          FOR UPDATE`,
        [data.store_id, data.product_id],
      );

      // Sequence guard: an older adjustment never regresses the snapshot.
      if (existing.rows.length > 0) {
        const currentSeq = existing.rows[0].last_adjustment_sequence;
        if (data.adjustment_sequence <= currentSeq) {
          return { observation: "skipped_stale" };
        }
      }

      // Upsert the observation — the snapshot is the LATEST adjustment seen.
      await tx.query(
        `INSERT INTO delivery_inventory_observations
           (store_id, product_id, last_adjustment_id, last_marketplace_event_id,
            last_adjustment_sequence, observed_quantity_after, last_quantity_delta,
            last_reason_code, occurred_for, observed_at, trace_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::timestamptz, now(), $10)
         ON CONFLICT (store_id, product_id)
         DO UPDATE SET last_adjustment_id = EXCLUDED.last_adjustment_id,
                       last_marketplace_event_id = EXCLUDED.last_marketplace_event_id,
                       last_adjustment_sequence = EXCLUDED.last_adjustment_sequence,
                       observed_quantity_after = EXCLUDED.observed_quantity_after,
                       last_quantity_delta = EXCLUDED.last_quantity_delta,
                       last_reason_code = EXCLUDED.last_reason_code,
                       occurred_for = EXCLUDED.occurred_for,
                       observed_at = now(),
                       trace_id = EXCLUDED.trace_id`,
        [
          data.store_id,
          data.product_id,
          data.adjustment_id,
          context.eventId,
          data.adjustment_sequence,
          data.quantity_after,
          data.quantity_delta,
          data.reason_code,
          data.occurred_for,
          context.traceId,
        ],
      );

      /* ── حكمُ التضاربِ — في المعاملةِ نفسِها (ADR-026 §4.18) ── */

      // مسارُ الربطِ ليسَ مباشراً ولا يمكنُ أن يكونَ: الرصدُ يأتي بـ`store_id`
      // (uuid ينشرُهُ حدثُ السوقِ)، والحجزُ يُخزَّنُ بـ`store_slug` (المرجعُ العامُّ
      // الوحيدُ للمتجرِ · §4.9-2). و`store_orders` هوَ الصفُّ الوحيدُ الذي يحملُ
      // الاثنينِ، فالطريقُ عبرَهُ لا عبرَ معجمِ تحويلٍ (§4.11 يرفضُ المعجمَ).
      // والترتيبُ حتميٌّ لأنَّ المصفوفةَ المُخزَّنةَ تُقارَنُ في الاختبارِ.
      const reservations = await tx.query<{
        order_id: string;
        public_id: string;
        quantity_reserved: number;
      }>(
        `SELECT r.order_id::text, o.public_id, r.quantity_reserved
           FROM delivery_inventory_reservations r
           JOIN store_orders o ON o.order_id = r.order_id
          WHERE o.store_id = $1::uuid
            AND r.product_id = $2::uuid
            AND r.status = 'active'
          ORDER BY o.public_id`,
        [data.store_id, data.product_id],
      );

      const activeReservations: readonly ActiveReservationLine[] = reservations.rows.map((row) => ({
        orderId: row.order_id,
        orderPublicId: row.public_id,
        quantityReserved: row.quantity_reserved,
      }));

      const assessment = assessInventoryConflict({
        adjustment: data,
        activeReservations,
        detectedAt: new Date().toISOString(),
      });

      if (assessment.conflict) {
        const report = assessment.report;
        // `ON CONFLICT DO NOTHING` لا `DO UPDATE`: الفرقُ حدثٌ ماضٍ لا يتغيّرُ،
        // وتحديثُ رايةٍ أُقِرَّت إلى غيرِ مُقَرّةٍ عندَ إعادةِ تسليمٍ يُلغي قرارَ مُشغِّلٍ.
        await tx.query(
          `INSERT INTO delivery_inventory_conflicts
             (adjustment_id, marketplace_event_id, store_id, product_id,
              conflict_kind, reason_code, quantity_delta, observed_quantity_after,
              adjustment_sequence, affected_order_count, affected_units_total,
              affected_order_public_ids, changes_order_state,
              occurred_for, detected_at, trace_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                   $5, $6, $7, $8,
                   $9, $10, $11,
                   $12::text[], FALSE,
                   $13::timestamptz, $14::timestamptz, $15)
           ON CONFLICT (adjustment_id) DO NOTHING`,
          [
            report.adjustmentId,
            context.eventId,
            report.storeId,
            report.productId,
            report.kind,
            report.reasonCode,
            report.quantityDelta,
            report.observedQuantityAfter,
            report.adjustmentSequence,
            report.affectedOrderCount,
            report.affectedUnitsTotal,
            report.affectedOrderPublicIds,
            data.occurred_for,
            report.detectedAt,
            context.traceId,
          ],
        );
      }

      return { observation: "applied", conflict: assessment };
    });
  }

  /* ── قراءةُ راياتِ التضاربِ ── */

  async listInventoryConflicts(query: {
    readonly unacknowledgedOnly: boolean;
    readonly limit: number;
  }): Promise<readonly InventoryConflictRow[]> {
    // التصفيةُ بـ`$1` لا بتركيبِ نصٍّ: فرعانِ في استعلامٍ واحدٍ يعنيانِ خطًّا واحدًا
    // يُختبرُ، والفهرسُ الجزئيُّ يُستخدَمُ حينَ يكونُ الشرطُ مُقيِّداً فعلاً.
    const r = await this.pool.query<ConflictColumnRow>(
      `SELECT ${CONFLICT_COLUMNS}
         FROM delivery_inventory_conflicts
        WHERE ($1::boolean = FALSE OR acknowledged_at IS NULL)
        ORDER BY detected_at DESC, adjustment_id
        LIMIT $2`,
      [query.unacknowledgedOnly, query.limit],
    );

    return r.rows.map(mapConflictRow);
  }

  /* ── إقرارُ رايةٍ (المراجعةُ 18/N · ADR-026 §4.20) ── */

  /**
   * عبارةٌ **واحدةٌ** لا اثنتانِ، ولا معاملةٌ مُصرَّحةٌ.
   *
   * والسببُ ليسَ اقتصادَ نداءٍ: `UPDATE … WHERE acknowledged_at IS NULL` هوَ
   * وحدَهُ الحاجزُ الذي يجعلُ «الأوّلُ يفوزُ» صحيحاً تحتَ التزاحُمِ — فمُشغِّلانِ
   * يُنادِيانِ في اللحظةِ نفسِها يُصيبُ أحدُهما صفّاً واحداً ويُصيبُ الآخرُ صفراً،
   * ولا ثالثَ. وقراءةٌ ثمَّ كتابةٌ في نداءَينِ كانت ستُتيحُ للثاني أن يمحوَ الأوّلَ
   * بينَ النداءَينِ، وهوَ نقضٌ لـ§4.18-6 من البابِ الآخرِ.
   *
   * وشكلُ العبارةِ يحلُّ سؤالاً حقيقيّاً: `RETURNING` وحدَهُ لا يُفرِّقُ بينَ
   * «أُقِرَّت قبلي» و«لا وجودَ لها» — كلتاهما صفرُ صفوفٍ. فالفرعُ الثاني في
   * `UNION ALL` يقرأُ الصفَّ **حينَ لم تُصِبْهُ الكتابةُ** (`NOT EXISTS (SELECT 1
   * FROM upd)`)، فيُعادُ إمّا صفٌّ كتبتُهُ أنا بـ`recorded = TRUE`، أو صفٌّ
   * أقرَّهُ غيري بـ`FALSE`، أو **لا صفَّ** — وهذا وحدَهُ يعني 404. وثلاثةُ
   * أجوبةٍ من نداءٍ واحدٍ على لقطةٍ واحدةٍ: لا نافذةَ بينَ سؤالَينِ.
   */
  async acknowledgeInventoryConflict(input: {
    readonly adjustmentId: string;
    readonly acknowledgedBy: string;
    readonly acknowledgedAt: string;
  }): Promise<InventoryConflictAcknowledgementOutcome> {
    const r = await this.pool.query<ConflictColumnRow & { recorded: boolean }>(
      `WITH upd AS (
         UPDATE delivery_inventory_conflicts
            SET acknowledged_at = $2::timestamptz,
                acknowledged_by = $3::text
          WHERE adjustment_id = $1::uuid
            AND acknowledged_at IS NULL
         RETURNING ${CONFLICT_COLUMNS}, TRUE AS recorded
       )
       SELECT * FROM upd
       UNION ALL
       SELECT ${CONFLICT_COLUMNS}, FALSE AS recorded
         FROM delivery_inventory_conflicts
        WHERE adjustment_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM upd)`,
      [input.adjustmentId, input.acknowledgedAt, input.acknowledgedBy],
    );

    const row = r.rows[0];
    if (row === undefined) return { acknowledgement: "unknown_conflict" };
    return row.recorded
      ? { acknowledgement: "recorded", row: mapConflictRow(row) }
      : { acknowledgement: "already_recorded", row: mapConflictRow(row) };
  }

  /* ── replay / rebuild ── */

  async clearInventoryObservations(): Promise<void> {
    await this.withTransaction(async (tx) => {
      await tx.query(`DELETE FROM delivery_inventory_observations`);
      // الراياتُ تمضي معَ اللقطاتِ: إعادةُ بناءٍ تُبقي راياتٍ قديمةً تعني راياتٍ
      // مُكرّرةً لا مُضاعفةً (المفتاحُ يمنعُ)، لكنَّها أيضاً تعني **إقراراً مُحتفَظاً
      // بهِ لحادثةٍ أُعيدَ بناءُها** — وإعادةُ البناءِ تعني أنَّ الحكمَ يُعادُ.
      await tx.query(`DELETE FROM delivery_inventory_conflicts`);
      await tx.query(`DELETE FROM delivery_inventory_relay_consumed_events`);
      await tx.query(`DELETE FROM delivery_inventory_relay_checkpoint`);
    });
  }

  /* ── internals ── */

  private async withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
