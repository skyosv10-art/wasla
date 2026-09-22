import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

interface OrderRequest {
  order_request_id: string;
  order_type: string;
  status: string;
  vehicle_class: string;
  price_mode: string;
  created_at: string;
}

export function MyOrders() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [orders, setOrders] = useState<OrderRequest[]>([]);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadOrders = useCallback(async (filterStatus?: string) => {
    if (!token || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      const params = filterStatus ? `?status=${filterStatus}` : "";
      const result = await apiClient.get<{ items: OrderRequest[]; limit: number }>(
        `/customers/${customerId}/order-requests${params}`
      );
      setOrders(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadOrders();
  }, [loadOrders]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    setStatus(newStatus);
    loadOrders(newStatus || undefined);
  }, [loadOrders]);

  if (loading && orders.length === 0) {
    return (
      <div className="screen my-orders-screen">
        <h1>{t("orders.title")}</h1>
        <div className="loading-indicator" data-testid="orders-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="screen my-orders-screen">
        <h1>{t("orders.title")}</h1>
        <div className="error-message" role="alert" data-testid="orders-error">
          {t(`errors.${error}`)}
        </div>
      </div>
    );
  }

  return (
    <div className="screen my-orders-screen">
      <h1>{t("orders.title")}</h1>

      <div className="form-group">
        <label htmlFor="status-filter">{t("orders.filter_status")}</label>
        <select
          id="status-filter"
          value={status}
          onChange={handleFilterChange}
          data-testid="status-filter-select"
        >
          <option value="">{t("orders.filter_all")}</option>
          <option value="submitted">{t("orders.status_submitted")}</option>
          <option value="accepted">{t("orders.status_accepted")}</option>
          <option value="completed">{t("orders.status_completed")}</option>
          <option value="cancelled">{t("orders.status_cancelled")}</option>
        </select>
      </div>

      {loading && orders.length > 0 && (
        <div className="loading-indicator" data-testid="orders-reloading">
          {t("common.loading")}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="empty-state" data-testid="orders-empty">
          {t("orders.empty")}
        </div>
      )}

      {orders.length > 0 && (
        <ul className="orders-list" data-testid="orders-list">
          {orders.map((order) => (
            <li key={order.order_request_id} className="order-item" data-testid={`order-${order.order_request_id}`}>
              <span className="order-id">{order.order_request_id}</span>
              <span className="order-type">{t(`orders.type_${order.order_type}`)}</span>
              <span className="order-status">{t(`orders.status_${order.status}`)}</span>
              <span className="order-vehicle">{t(`ride_order.vehicle_${order.vehicle_class}`)}</span>
              <span className="order-date">{new Date(order.created_at).toLocaleDateString("ar-SA")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
