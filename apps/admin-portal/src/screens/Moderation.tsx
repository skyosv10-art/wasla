/**
 * Moderation screen — manage marketplace store and product moderation.
 *
 * M5-15: Admin Operations full — privileged workflow for moderation.
 * Calls the marketplace service via the admin API gateway:
 *   GET  /stores/:storeSlug/reviews        — store review ledger (append-only)
 *   POST /stores/:storeSlug/decisions      — store decision (one path, one table)
 *   POST /products/:productId/decisions    — product moderation decision
 *   POST /products/:productId/publish      — product publish lifecycle
 *   POST /products/:productId/archive      — product archive lifecycle
 *
 * The moderation ledger is append-only; this screen reads it and records
 * decisions, never edits rows. Rejection and suspension require a reason code
 * from the closed list (the service enforces STORE_REJECTION_REASON_REQUIRED).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useModerationStore } from "../store/moderation";
import { useSessionStore } from "../store/session";
import {
  STORE_DECISIONS,
  STORE_REASON_CODES,
  PRODUCT_DECISIONS,
  type StoreDecision,
  type StoreReasonCode,
  type ProductDecision,
  type ProductReasonCode,
} from "../types/moderation";

const REJECT_SUSPEND_DECISIONS: StoreDecision[] = ["rejected", "suspended"];

export function Moderation() {
  const { t } = useTranslation();
  const { role } = useSessionStore();
  const {
    storeReviews,
    storeReviewsCursor,
    lastProductDecision,
    loading,
    error,
    selectedStoreSlug,
    fetchStoreReviews,
    fetchMoreStoreReviews,
    decideStore,
    decideProduct,
    publishProduct,
    archiveProduct,
    setSelectedStoreSlug,
    clearError,
    clearLastProductDecision,
  } = useModerationStore();

  const [slugInput, setSlugInput] = useState("");
  const [productIdInput, setProductIdInput] = useState("");
  const [storeDecision, setStoreDecision] = useState<StoreDecision>("approved");
  const [storeReason, setStoreReason] = useState<StoreReasonCode | "">("");
  const [productDecision, setProductDecision] = useState<ProductDecision>("approved");
  const [productReason, setProductReason] = useState<ProductReasonCode | "">("");

  const isAdmin = role === "admin";

  const handleSearch = () => {
    if (slugInput.trim()) {
      setSelectedStoreSlug(slugInput.trim());
      clearError();
      fetchStoreReviews(slugInput.trim());
    }
  };

  const handleStoreDecision = async () => {
    if (!selectedStoreSlug) return;
    const needsReason = REJECT_SUSPEND_DECISIONS.includes(storeDecision);
    if (needsReason && !storeReason) return;
    await decideStore(
      selectedStoreSlug,
      storeDecision,
      needsReason ? (storeReason as StoreReasonCode) : null,
    );
    setStoreReason("");
  };

  const handleProductDecision = async () => {
    if (!productIdInput.trim()) return;
    const needsReason = productDecision === "rejected";
    if (needsReason && !productReason) return;
    await decideProduct(
      productIdInput.trim(),
      productDecision,
      needsReason ? (productReason as ProductReasonCode) : null,
    );
  };

  const handlePublish = async () => {
    if (!productIdInput.trim()) return;
    await publishProduct(productIdInput.trim());
  };

  const handleArchive = async () => {
    if (!productIdInput.trim()) return;
    await archiveProduct(productIdInput.trim());
  };

  if (!isAdmin) {
    return (
      <div className="screen">
        <h2>{t("moderation.title")}</h2>
        <p className="error-message">{t("moderation.accessDenied")}</p>
      </div>
    );
  }

  const needsStoreReason = REJECT_SUSPEND_DECISIONS.includes(storeDecision);

  return (
    <div className="screen">
      <h2>{t("moderation.title")}</h2>

      {error && (
        <div className="error-message" role="alert">
          {error}
          <button onClick={clearError} aria-label={t("common.dismiss")}>×</button>
        </div>
      )}

      {/* Store moderation — search by slug */}
      <div className="search-bar">
        <input
          type="text"
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder={t("moderation.storeSlugPlaceholder")}
          data-testid="moderation-store-slug-input"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button onClick={handleSearch} data-testid="moderation-search-btn">
          {t("common.search")}
        </button>
      </div>

      {loading && <p className="loading">{t("common.loading")}</p>}

      {selectedStoreSlug && !loading && (
        <div className="moderation-store">
          {/* Store review ledger */}
          <section className="card">
            <h3>{t("moderation.storeReviews")}</h3>
            {storeReviews.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("moderation.decision")}</th>
                    <th>{t("moderation.fromState")}</th>
                    <th>{t("moderation.toState")}</th>
                    <th>{t("moderation.sequence")}</th>
                    <th>{t("moderation.actor")}</th>
                    <th>{t("moderation.reasonCode")}</th>
                    <th>{t("moderation.decidedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {storeReviews.map((review) => (
                    <tr key={review.review_id} data-testid={`store-review-${review.review_id}`}>
                      <td>{review.decision}</td>
                      <td>{review.from_state ?? "—"}</td>
                      <td>{review.to_state}</td>
                      <td>{review.state_sequence}</td>
                      <td>{review.actor_type}</td>
                      <td>{review.reason_code ?? "—"}</td>
                      <td>{new Date(review.decided_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">{t("moderation.noReviews")}</p>
            )}
            {storeReviewsCursor && (
              <button
                onClick={fetchMoreStoreReviews}
                data-testid="moderation-load-more-btn"
              >
                {t("moderation.loadMore")}
              </button>
            )}
          </section>

          {/* Store decision actions */}
          <section className="card">
            <h3>{t("moderation.storeDecision")}</h3>
            <div className="decision-bar">
              <select
                value={storeDecision}
                onChange={(e) => setStoreDecision(e.target.value as StoreDecision)}
                data-testid="store-decision-select"
              >
                {STORE_DECISIONS.filter((d) => d !== "review_requested").map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {needsStoreReason && (
                <select
                  value={storeReason}
                  onChange={(e) =>
                    setStoreReason(e.target.value as StoreReasonCode | "")
                  }
                  data-testid="store-reason-select"
                >
                  <option value="">{t("moderation.selectReason")}</option>
                  {STORE_REASON_CODES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={handleStoreDecision}
                disabled={needsStoreReason && !storeReason}
                data-testid="store-decision-btn"
                className="danger-btn"
              >
                {t("moderation.recordStoreDecision")}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Product moderation — by product ID */}
      <section className="card">
        <h3>{t("moderation.productModeration")}</h3>
        <div className="search-bar">
          <input
            type="text"
            value={productIdInput}
            onChange={(e) => setProductIdInput(e.target.value)}
            placeholder={t("moderation.productIdPlaceholder")}
            data-testid="moderation-product-id-input"
          />
        </div>
        <div className="decision-bar">
          <select
            value={productDecision}
            onChange={(e) => setProductDecision(e.target.value as ProductDecision)}
            data-testid="product-decision-select"
          >
            {PRODUCT_DECISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {productDecision === "rejected" && (
            <select
              value={productReason}
              onChange={(e) =>
                setProductReason(e.target.value as ProductReasonCode | "")
              }
              data-testid="product-reason-select"
            >
              <option value="">{t("moderation.selectReason")}</option>
              <option value="prohibited_item">prohibited_item</option>
            </select>
          )}
          <button
            onClick={handleProductDecision}
            disabled={productDecision === "rejected" && !productReason}
            data-testid="product-decision-btn"
            className="danger-btn"
          >
            {t("moderation.recordProductDecision")}
          </button>
          <button onClick={handlePublish} data-testid="product-publish-btn">
            {t("moderation.publish")}
          </button>
          <button onClick={handleArchive} data-testid="product-archive-btn">
            {t("moderation.archive")}
          </button>
        </div>
        {lastProductDecision && (
          <div className="success-message" role="status" data-testid="last-product-decision">
            <p>
              {t("moderation.lastDecision")}: {lastProductDecision.decision} →{" "}
              {lastProductDecision.to_state} ({lastProductDecision.moderation_sequence})
            </p>
            <button onClick={clearLastProductDecision}>{t("common.dismiss")}</button>
          </div>
        )}
      </section>
    </div>
  );
}
