/**
 * PostgresSettlement — `SettlementPort` على جدول `billing_settlements` (M5-17P · CLM-0375).
 *
 * التسويةُ والربطُ بالفاتورةِ عبارةٌ واحدةٌ (CTE): صفُّ التسويةِ يُدرَجُ و`billing_invoices.settlement_id`
 * يُحدَّثُ معاً أو لا يحدثُ شيء — فلا تسويةَ يتيمةٌ بلا فاتورتِها ولو استُعمِلَ المحوِّلُ خارجَ معاملة.
 * وداخلَ معاملةِ المُرحِّلِ يُمرَّرُ عميلُ المعاملةِ نفسُهُ فيرتدُّ مع غيرِهِ.
 */

import type { BillingFeeType, BillingSettlementState } from "@wasla/contracts-billing";
import type { SettlementPort } from "../../ports.js";
import type { Queryable } from "./queryable.js";
import { isUuid } from "./queryable.js";

interface SettlementRow {
  readonly settlement_id: string;
  readonly state: BillingSettlementState;
  readonly invoice_id: string;
  readonly fee_type: BillingFeeType;
  readonly amount_cents: string | number;
  readonly period: string;
}

export class PostgresSettlement implements SettlementPort {
  constructor(private readonly db: Queryable) {}

  async settle(params: {
    invoice_id: string;
    fee_type: BillingFeeType;
    amount_cents: number;
    period: string;
  }): Promise<{ settlement_id: string; state: BillingSettlementState }> {
    const result = await this.db.query<{ settlement_id: string; state: BillingSettlementState }>(
      `WITH s AS (
         INSERT INTO billing_settlements (invoice_id, fee_type, amount_cents, period, state, settled_at)
         VALUES ($1::uuid, $2, $3, $4, 'settled', now())
         RETURNING settlement_id, state
       ), linked AS (
         UPDATE billing_invoices i
            SET settlement_id = s.settlement_id, updated_at = now()
           FROM s
          WHERE i.invoice_id = $1::uuid
         RETURNING i.invoice_id
       )
       SELECT s.settlement_id::text AS settlement_id, s.state
         FROM s, linked`,
      [params.invoice_id, params.fee_type, params.amount_cents, params.period],
    );
    const row = result.rows[0];
    if (!row) {
      // الفاتورةُ غيرُ موجودةٍ — المفتاحُ الأجنبيُّ كانَ سيرفضُ الإدراجَ قبلَ هذا.
      throw new Error(`settlement not linked: invoice ${params.invoice_id} not found`);
    }
    return { settlement_id: row.settlement_id, state: row.state };
  }

  async findById(settlementId: string): Promise<{ settlement_id: string; state: BillingSettlementState } | null> {
    if (!isUuid(settlementId)) return null;
    const result = await this.db.query<{ settlement_id: string; state: BillingSettlementState }>(
      `SELECT settlement_id::text AS settlement_id, state
         FROM billing_settlements
        WHERE settlement_id = $1::uuid`,
      [settlementId],
    );
    return result.rows[0] ?? null;
  }

  async listSettlements(params: {
    state?: BillingSettlementState;
    limit?: number;
    cursor?: string;
  }): Promise<{
    items: { settlement_id: string; state: BillingSettlementState; invoice_id: string; fee_type: BillingFeeType; amount_cents: number; period: string }[];
    nextCursor: string | null;
  }> {
    const limit = params.limit ?? 20;
    const cursor = params.cursor && isUuid(params.cursor) ? params.cursor : null;
    const result = await this.db.query<SettlementRow>(
      `SELECT settlement_id::text AS settlement_id, state, invoice_id::text AS invoice_id,
              fee_type, amount_cents, period
         FROM billing_settlements
        WHERE ($1::text IS NULL OR state = $1::text)
          AND ($2::uuid IS NULL OR settlement_id > $2::uuid)
        ORDER BY settlement_id ASC
        LIMIT $3`,
      [params.state ?? null, cursor, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const items = rows.map((r) => ({
      settlement_id: r.settlement_id,
      state: r.state,
      invoice_id: r.invoice_id,
      fee_type: r.fee_type,
      amount_cents: Number(r.amount_cents),
      period: r.period,
    }));
    return { items, nextCursor: hasMore ? items[items.length - 1].settlement_id : null };
  }
}
