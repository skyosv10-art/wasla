/**
 * Orders Management screen.
 *
 * Search by order public ID, view order detail with status history.
 * Admin list endpoint (GET /orders) is deferred — search by public ID is
 * the available path via GET /orders/lookup.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrdersStore } from "../store/orders";
import { useAuditStore } from "../store/audit";

export function Orders() {
  const { t } = useTranslation();
  const {
    searchResults,
    searchLoading,
    searchError,
    detail,
    detailLoading,
    detailError,
    history,
    historyLoading,
    historyError,
    searchByPublicId,
    fetchDetail,
    fetchHistory,
    clearSearch,
    clearDetail,
  } = useOrdersStore();
  const { fetchEvents } = useAuditStore();

  const [searchInput, setSearchInput] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedOrderId !== null) {
      fetchDetail(selectedOrderId);
      fetchHistory(selectedOrderId);
      fetchEvents({ action: "order.viewed" }).catch(() => {});
    }
  }, [selectedOrderId, fetchDetail, fetchHistory, fetchEvents]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      searchByPublicId(searchInput.trim());
    }
  };

  const handleSelect = (orderId: number) => {
    setSelectedOrderId(orderId);
  };

  const handleBack = () => {
    setSelectedOrderId(null);
    clearDetail();
  };

  if (selectedOrderId !== null && detail) {
    return (
      <div className="screen">
        <div className="screen-header">
          <button className="btn btn-secondary" onClick={handleBack}>
            ← {t("admin.back", "Back")}
          </button>
          <h2>
            {t("admin.orders.detail", "Order Detail")} —{" "}
            {detail.order_public_id}
          </h2>
        </div>

        {detailLoading && <p className="loading">{t("common.loading")}</p>}
        {detailError && (
          <p className="error">
            {t("common.error")}: {detailError}
          </p>
        )}

        <div className="detail-card">
          <div className="detail-grid">
            <div>
              <label>{t("admin.orders.publicId", "Order ID")}</label>
              <span>{detail.order_public_id}</span>
            </div>
            <div>
              <label>{t("admin.orders.status", "Status")}</label>
              <span className={`status-badge status-${detail.status}`}>
                {t(`admin.orders.statuses.${detail.status}`, detail.status)}
              </span>
            </div>
            <div>
              <label>{t("admin.orders.type", "Type")}</label>
              <span>{t(`admin.orders.types.${detail.order_type}`, detail.order_type)}</span>
            </div>
            <div>
              <label>{t("admin.orders.vehicleClass", "Vehicle")}</label>
              <span>{t(`admin.orders.vehicles.${detail.vehicle_class}`, detail.vehicle_class)}</span>
            </div>
            <div>
              <label>{t("admin.orders.priceMode", "Price Mode")}</label>
              <span>{t(`admin.orders.priceModes.${detail.price_mode}`, detail.price_mode)}</span>
            </div>
            <div>
              <label>{t("admin.orders.customer", "Customer")}</label>
              <span>{detail.customer_public_id}</span>
            </div>
            <div>
              <label>{t("admin.orders.offeredPrice", "Offered Price")}</label>
              <span>
                {detail.offered_price
                  ? `${detail.offered_price.amount_minor / 100} ${detail.offered_price.currency}`
                  : "—"}
              </span>
            </div>
            <div>
              <label>{t("admin.orders.agreedPrice", "Agreed Price")}</label>
              <span>
                {detail.agreed_price
                  ? `${detail.agreed_price.amount_minor / 100} ${detail.agreed_price.currency}`
                  : "—"}
              </span>
            </div>
            <div>
              <label>{t("admin.orders.requestedAt", "Requested")}</label>
              <span>{new Date(detail.requested_at).toLocaleString()}</span>
            </div>
            <div>
              <label>{t("admin.orders.createdAt", "Created")}</label>
              <span>{new Date(detail.created_at).toLocaleString()}</span>
            </div>
          </div>

          {detail.notes && (
            <div className="detail-section">
              <label>{t("admin.orders.notes", "Notes")}</label>
              <p>{detail.notes}</p>
            </div>
          )}

          {detail.stops.length > 0 && (
            <div className="detail-section">
              <h3>{t("admin.orders.stops", "Stops")}</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("admin.orders.stopKind", "Kind")}</th>
                    <th>{t("admin.orders.address", "Address")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.stops.map((stop) => (
                    <tr key={stop.sequence}>
                      <td>{stop.sequence}</td>
                      <td>{stop.kind}</td>
                      <td>{stop.short_address || stop.full_address || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detail.active_assignment && (
            <div className="detail-section">
              <h3>{t("admin.orders.assignment", "Active Assignment")}</h3>
              <div className="detail-grid">
                <div>
                  <label>{t("admin.orders.driver", "Driver")}</label>
                  <span>{detail.active_assignment.driver_public_id}</span>
                </div>
                <div>
                  <label>{t("admin.orders.assignmentState", "State")}</label>
                  <span>{detail.active_assignment.state}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="detail-card">
          <h3>{t("admin.orders.history", "Status History")}</h3>
          {historyLoading && <p className="loading">{t("common.loading")}</p>}
          {historyError && (
            <p className="error">
              {t("common.error")}: {historyError}
            </p>
          )}
          {history.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("admin.orders.fromStatus", "From")}</th>
                  <th>{t("admin.orders.toStatus", "To")}</th>
                  <th>{t("admin.orders.reason", "Reason")}</th>
                  <th>{t("admin.orders.actor", "Actor")}</th>
                  <th>{t("admin.orders.occurredAt", "Occurred At")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.sequence}>
                    <td>{entry.sequence}</td>
                    <td>{entry.from_status || "—"}</td>
                    <td>
                      <span className={`status-badge status-${entry.to_status}`}>
                        {entry.to_status}
                      </span>
                    </td>
                    <td>{entry.reason_code || "—"}</td>
                    <td>
                      {entry.actor_type}: {entry.actor_ref}
                    </td>
                    <td>{new Date(entry.occurred_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h2>{t("admin.orders.title", "Orders Management")}</h2>

      <form className="filter-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder={t("admin.orders.searchPlaceholder", "Search by Order ID (ORD-XXXXXXXXXX)")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="search-input"
        />
        <button type="submit" className="btn btn-primary" disabled={searchLoading}>
          {searchLoading ? t("common.loading") : t("common.search", "Search")}
        </button>
        {searchResults.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              clearSearch();
              setSearchInput("");
            }}
          >
            {t("common.clear", "Clear")}
          </button>
        )}
      </form>

      {searchError && (
        <p className="error">
          {t("common.error")}: {searchError}
        </p>
      )}

      {searchResults.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.orders.publicId", "Order ID")}</th>
              <th>{t("admin.orders.status", "Status")}</th>
              <th>{t("admin.orders.type", "Type")}</th>
              <th>{t("admin.orders.vehicleClass", "Vehicle")}</th>
              <th>{t("admin.orders.priceMode", "Price Mode")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {searchResults.map((order) => (
              <tr key={order.order_id}>
                <td>{order.order_public_id}</td>
                <td>
                  <span className={`status-badge status-${order.status}`}>
                    {t(`admin.orders.statuses.${order.status}`, order.status)}
                  </span>
                </td>
                <td>{t(`admin.orders.types.${order.order_type}`, order.order_type)}</td>
                <td>{t(`admin.orders.vehicles.${order.vehicle_class}`, order.vehicle_class)}</td>
                <td>{t(`admin.orders.priceModes.${order.price_mode}`, order.price_mode)}</td>
                <td>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleSelect(order.order_id)}
                  >
                    {t("common.view", "View")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {searchResults.length === 0 && !searchLoading && !searchError && (
        <p className="empty-state">
          {t("admin.orders.searchPrompt", "Search for an order by its public ID (e.g., ORD-1234567890)")}
        </p>
      )}
    </div>
  );
}
