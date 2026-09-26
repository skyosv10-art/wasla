/**
 * PostgresInvoiceStore — تنفيذ مستودع الفواتير على PostgreSQL.
 *
 * يترجم كائن مجال Invoice إلى صفوف billing_invoices والعكس. لا يحمل قراراً
 * مجاليًّا ولا يعرف نتيجة ولا ينشر حدثًا.
 */

import { and, desc, eq, lt } from "drizzle-orm";
import type { InvoiceStore } from "../../ports.js";
import type { Invoice } from "../../domain/model.js";
import type { DbOrTx } from "./db.js";
import { billingInvoices } from "./schema.js";

type InvoiceRow = typeof billingInvoices.$inferSelect;

function rowToInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.invoiceId,
    store_public_id: row.storePublicId,
    period: row.period,
    state: row.state as Invoice["state"],
    fee_type: row.feeType,
    amount_cents: row.amountCents,
    paid_amount_cents: row.paidAmountCents,
    payment_ref: row.paymentRef,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export class PostgresInvoiceStore implements InvoiceStore {
  constructor(private readonly db: DbOrTx) {}

  async save(invoice: Invoice): Promise<void> {
    await this.db
      .insert(billingInvoices)
      .values({
        invoiceId: invoice.id,
        storePublicId: invoice.store_public_id,
        period: invoice.period,
        state: invoice.state,
        feeType: invoice.fee_type,
        amountCents: invoice.amount_cents,
        paidAmountCents: invoice.paid_amount_cents,
        paymentRef: invoice.payment_ref,
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at,
      })
      .onConflictDoUpdate({
        target: billingInvoices.invoiceId,
        set: {
          state: invoice.state,
          paidAmountCents: invoice.paid_amount_cents,
          paymentRef: invoice.payment_ref,
          updatedAt: invoice.updated_at,
        },
      });
  }

  async findById(id: string): Promise<Invoice | null> {
    const rows = await this.db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.invoiceId, id))
      .limit(1);

    return rows.length > 0 ? rowToInvoice(rows[0]) : null;
  }

  async findByStore(
    storePublicId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: Invoice[]; nextCursor: string | null }> {
    const conditions = [eq(billingInvoices.storePublicId, storePublicId)];
    if (cursor) {
      const cursorRow = await this.db
        .select({ createdAt: billingInvoices.createdAt })
        .from(billingInvoices)
        .where(eq(billingInvoices.invoiceId, cursor))
        .limit(1);
      if (cursorRow.length > 0) {
        conditions.push(lt(billingInvoices.createdAt, cursorRow[0].createdAt));
      }
    }

    const rows = await this.db
      .select()
      .from(billingInvoices)
      .where(and(...conditions))
      .orderBy(desc(billingInvoices.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, -1) : rows).map(rowToInvoice);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }
}
