/**
 * Billing screen — manage invoices and settlements.
 *
 * M5-17 review 6/N: Billing admin screen — list invoices (with store filter),
 * list settlements (with state filter), view invoice details, issue, void,
 * record payment.
 *
 * Calls the billing service via the admin API client:
 *   GET  /billing/invoices                    — list (with store_public_id filter)
 *   GET  /billing/invoices/:id                — get invoice details
 *   POST /billing/invoices/:id/issue          — issue invoice (draft → issued)
 *   POST /billing/invoices/:id/payment        — record payment
 *   POST /billing/invoices/:id/void           — void invoice
 *   GET  /billing/settlements                 — list settlements (with state filter)
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBillingStore } from "../store/billing";
import type {
  BillingInvoiceState,
  BillingSettlementState,
} from "../types/billing";

const INVOICE_STATES: BillingInvoiceState[] = ["draft", "issued", "paid", "partially_paid", "closed", "void"];
const SETTLEMENT_STATES: BillingSettlementState[] = ["settled", "pending", "failed"];

export function Billing() {
  const { t } = useTranslation();
  const {
    invoices,
    invoiceNextCursor,
    settlements,
    settlementNextCursor,
    selectedInvoice,
    loading,
    error,
    invoiceStateFilter,
    settlementStateFilter,
    fetchInvoices,
    fetchMoreInvoices,
    fetchInvoice,
    issueInvoice,
    voidInvoice,
    recordPayment,
    fetchSettlements,
    fetchMoreSettlements,
    setInvoiceStateFilter,
    setSettlementStateFilter,
    clearSelected,
    clearError,
  } = useBillingStore();

  const [showDetail, setShowDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<"invoices" | "settlements">("invoices");
  const [storeFilter, setStoreFilter] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");

  useEffect(() => {
    fetchInvoices();
    fetchSettlements();
  }, [fetchInvoices, fetchSettlements]);

  const handleInvoiceFilterChange = (state: BillingInvoiceState | null) => {
    setInvoiceStateFilter(state);
    fetchInvoices();
  };

  const handleSettlementFilterChange = (state: BillingSettlementState | null) => {
    setSettlementStateFilter(state);
    fetchSettlements(state);
  };

  const handleSelectInvoice = (invoiceId: string) => {
    fetchInvoice(invoiceId);
    setShowDetail(true);
  };

  const handleIssue = async () => {
    if (!selectedInvoice) return;
    await issueInvoice(selectedInvoice.id);
  };

  const handleVoid = async () => {
    if (!selectedInvoice) return;
    await voidInvoice(selectedInvoice.id);
  };

  const handlePayment = async () => {
    if (!selectedInvoice || !paymentAmount || !paymentRef) return;
    await recordPayment(selectedInvoice.id, {
      amount_cents: parseInt(paymentAmount, 10),
      payment_ref: paymentRef,
    });
    setPaymentAmount("");
    setPaymentRef("");
  };

  if (showDetail && selectedInvoice) {
    return (
      <div className="billing-detail">
        <button onClick={() => { setShowDetail(false); clearSelected(); }}>
          {t("billing.backToList")}
        </button>

        <h2>{t("billing.invoice")} #{selectedInvoice.id.slice(0, 8)}</h2>

        <dl>
          <dt>{t("billing.state")}</dt>
          <dd>{t(`billing.states.${selectedInvoice.state}`)}</dd>
          <dt>{t("billing.store")}</dt>
          <dd>{selectedInvoice.store_public_id}</dd>
          <dt>{t("billing.period")}</dt>
          <dd>{selectedInvoice.period}</dd>
          <dt>{t("billing.feeType")}</dt>
          <dd>{t(`billing.feeTypes.${selectedInvoice.fee_type}`)}</dd>
          <dt>{t("billing.amount")}</dt>
          <dd>{(selectedInvoice.amount_cents / 100).toFixed(2)} SAR</dd>
          <dt>{t("billing.paidAmount")}</dt>
          <dd>{(selectedInvoice.paid_amount_cents / 100).toFixed(2)} SAR</dd>
          <dt>{t("billing.paymentRef")}</dt>
          <dd>{selectedInvoice.payment_ref ?? "—"}</dd>
          <dt>{t("billing.createdAt")}</dt>
          <dd>{new Date(selectedInvoice.created_at).toLocaleString()}</dd>
          <dt>{t("billing.updatedAt")}</dt>
          <dd>{new Date(selectedInvoice.updated_at).toLocaleString()}</dd>
        </dl>

        {selectedInvoice.state === "draft" ? (
          <div className="issue-section">
            <button onClick={handleIssue} disabled={loading}>
              {t("billing.issue")}
            </button>
          </div>
        ) : null}

        {(selectedInvoice.state === "issued" || selectedInvoice.state === "partially_paid") ? (
          <div className="payment-section">
            <h3>{t("billing.recordPayment")}</h3>
            <input
              type="number"
              placeholder={t("billing.amountCents")}
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
            />
            <input
              placeholder={t("billing.paymentRef")}
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
            <button onClick={handlePayment} disabled={loading || !paymentAmount || !paymentRef}>
              {t("billing.recordPayment")}
            </button>
          </div>
        ) : null}

        {selectedInvoice.state !== "void" && selectedInvoice.state !== "closed" ? (
          <div className="void-section">
            <button onClick={handleVoid} disabled={loading}>
              {t("billing.void")}
            </button>
          </div>
        ) : null}

        {error && <div className="error" onClick={clearError}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="billing-list">
      <h1>{t("billing.title")}</h1>

      <div className="tab-bar">
        <button
          className={activeTab === "invoices" ? "active" : ""}
          onClick={() => setActiveTab("invoices")}
        >
          {t("billing.invoices")}
        </button>
        <button
          className={activeTab === "settlements" ? "active" : ""}
          onClick={() => setActiveTab("settlements")}
        >
          {t("billing.settlements")}
        </button>
      </div>

      {activeTab === "invoices" ? (
        <>
          <div className="filter-bar">
            <input
              placeholder={t("billing.storeFilter")}
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") fetchInvoices(storeFilter || undefined); }}
            />
            <button onClick={() => fetchInvoices(storeFilter || undefined)} disabled={loading}>
              {t("common.search")}
            </button>
            <button
              className={invoiceStateFilter === null ? "active" : ""}
              onClick={() => handleInvoiceFilterChange(null)}
            >
              {t("billing.allStates")}
            </button>
            {INVOICE_STATES.map((s) => (
              <button
                key={s}
                className={invoiceStateFilter === s ? "active" : ""}
                onClick={() => handleInvoiceFilterChange(s)}
              >
                {t(`billing.states.${s}`)}
              </button>
            ))}
          </div>

          {error && <div className="error" onClick={clearError}>{error}</div>}

          {loading && invoices.length === 0 ? (
            <p>{t("common.loading")}</p>
          ) : invoices.length === 0 ? (
            <p>{t("billing.noInvoices")}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("billing.invoiceId")}</th>
                  <th>{t("billing.store")}</th>
                  <th>{t("billing.period")}</th>
                  <th>{t("billing.state")}</th>
                  <th>{t("billing.feeType")}</th>
                  <th>{t("billing.amount")}</th>
                  <th>{t("billing.createdAt")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} onClick={() => handleSelectInvoice(inv.id)}>
                    <td>{inv.id.slice(0, 8)}</td>
                    <td>{inv.store_public_id}</td>
                    <td>{inv.period}</td>
                    <td>{t(`billing.states.${inv.state}`)}</td>
                    <td>{t(`billing.feeTypes.${inv.fee_type}`)}</td>
                    <td>{(inv.amount_cents / 100).toFixed(2)} SAR</td>
                    <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {invoiceNextCursor && (
            <button onClick={fetchMoreInvoices} disabled={loading}>
              {t("common.loadMore")}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="filter-bar">
            <button
              className={settlementStateFilter === null ? "active" : ""}
              onClick={() => handleSettlementFilterChange(null)}
            >
              {t("billing.allStates")}
            </button>
            {SETTLEMENT_STATES.map((s) => (
              <button
                key={s}
                className={settlementStateFilter === s ? "active" : ""}
                onClick={() => handleSettlementFilterChange(s)}
              >
                {t(`billing.settlementStates.${s}`)}
              </button>
            ))}
          </div>

          {error && <div className="error" onClick={clearError}>{error}</div>}

          {loading && settlements.length === 0 ? (
            <p>{t("common.loading")}</p>
          ) : settlements.length === 0 ? (
            <p>{t("billing.noSettlements")}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("billing.settlementId")}</th>
                  <th>{t("billing.state")}</th>
                  <th>{t("billing.invoiceId")}</th>
                  <th>{t("billing.feeType")}</th>
                  <th>{t("billing.amount")}</th>
                  <th>{t("billing.period")}</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.settlement_id}>
                    <td>{s.settlement_id.slice(0, 12)}</td>
                    <td>{t(`billing.settlementStates.${s.state}`)}</td>
                    <td>{s.invoice_id.slice(0, 8)}</td>
                    <td>{t(`billing.feeTypes.${s.fee_type}`)}</td>
                    <td>{(s.amount_cents / 100).toFixed(2)} SAR</td>
                    <td>{s.period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {settlementNextCursor && (
            <button onClick={fetchMoreSettlements} disabled={loading}>
              {t("common.loadMore")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
