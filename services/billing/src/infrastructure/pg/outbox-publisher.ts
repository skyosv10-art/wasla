/**
 * PostgresOutboxPublisher — `BillingEventPublisher` يكتبُ صفّاً في `billing_outbox` (M5-17P · CLM-0375).
 *
 * الناشرُ لا يُرسِلُ شيئاً عبرَ الشبكة: يُدرِجُ الحدثَ في جدولِ الصادرِ، وداخلَ معاملةِ المُرحِّلِ
 * يُكتَبُ مع التسويةِ نفسِها فلا حدثَ بلا تسويةٍ ولا تسويةَ بلا حدث. والحمولةُ مراجعُ وأنواعٌ
 * وفتراتٌ فقط — المبلغُ لا يدخلُ حدثَ `fee_settled` (ADR-050 §5).
 */

import type { BillingFeeType } from "@wasla/contracts-billing";
import type { BillingEventPublisher } from "../../ports.js";
import type { Queryable } from "./queryable.js";

export class PostgresOutboxPublisher implements BillingEventPublisher {
  constructor(private readonly db: Queryable) {}

  private async insert(eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO billing_outbox (event_type, event_version, aggregate_id, payload)
       VALUES ($1, 'v1', $2::uuid, $3::jsonb)`,
      [eventType, aggregateId, JSON.stringify(payload)],
    );
  }

  async publishInvoiceIssued(event: { invoice_id: string; store_public_id: string; period: string }): Promise<void> {
    await this.insert("billing.invoice_issued", event.invoice_id, { ...event });
  }

  async publishFeeSettled(event: { settlement_id: string; fee_type: BillingFeeType; period: string }): Promise<void> {
    await this.insert("billing.fee_settled", event.settlement_id, { ...event });
  }

  async publishPayoutRequested(event: { payout_id: string; partner_public_id: string; amount_cents: number }): Promise<void> {
    await this.insert("billing.payout_requested", event.payout_id, { ...event });
  }
}
