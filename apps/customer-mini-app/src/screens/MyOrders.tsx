import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

/**
 * CMS §3.6 L86: the screen lists the customer's last five requests.
 * G-S9.11 (CLM-0638): the DTO field is `id` per the published contract
 * (`OrderRequest` in packages/contracts/customer/src/api-types.ts) — the app
 * previously read `order_request_id`, which the service never returns.
 */
interface OrderRequest {
  id: string;
  order_type: string;
  status: string;
  vehicle_class: string;
  price_mode: string;
  created_at: string;
}

/** CMS §3.6 L87: «تفاصيل الحالة والمسار» — the detail contract fields. */
interface OrderStop {
  kind: "pickup" | "dropoff";
  sequence: number;
  zone_id: string;
  zone_path?: string | null;
  label?: string | null;
}

interface OrderRequestDetail extends OrderRequest {
  wasla_public_id: string;
  offered_price?: { amount: number; currency: string } | null;
  stops: OrderStop[];
  notes?: string | null;
}

export const LAST_ORDERS_LIMIT = 5;

/**
 * G-S9.12 (CLM-0640): CMS §3.6 L88 «التحديثُ المباشرُ (Polling أو WebSocket لاحقًا)»
 * — Polling is the implemented half; WebSocket is explicitly deferred by the spec.
 * 30s: حالةُ الطلبِ تتغيّرُ ببطءٍ نسبيًّا؛ كلُّ تحديثٍ إعادةُ قراءةٍ للمسارَينِ القائمَينِ
 * (G-S9.10/G-S9.11) بلا عقدٍ جديدٍ، فأثرُ النداءِ على الخدمةِ مُزدَرًى.
 */
export const STATUS_POLL_INTERVAL_MS = 30_000;

export function MyOrders() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [orders, setOrders] = useState<OrderRequest[]>([]);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  // G-S9.11 (CLM-0638): CMS §3.6 L87 — click a request → its status and route.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadOrders = useCallback(async (filterStatus?: string) => {
    if (!token || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      // G-S9.10 (CLM-0616): CMS §3.6 L86 «آخر 5 طلبات» · L90
      // `GET /customers/{id}/order-requests?limit=5`. `limit` is the only query
      // parameter of `listOrderRequests`; the status filter is kept as it was
      // (sent alongside, unchanged) — the service does not declare or read it,
      // a separate measured finding (G-S9.15), not resolved in this slice.
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", String(LAST_ORDERS_LIMIT));
      const result = await apiClient.get<{ items: OrderRequest[] }>(
        `/customers/${customerId}/order-requests?${params.toString()}`
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

  // G-S9.12 (CLM-0640): تحديثٌ صامتٌ دوريّ للحالةِ — لا يُومضُ مؤشّرَ التحميلِ ولا يمسحُ
  // القائمةَ عندَ تعذّرِ النداءِ (العرضُ السابقُ يبقى)، ويتوقّفُ في الخلفيّةِ (document.hidden).
  // CLM-0643 (review follow-up): the current selection, kept synchronously by
  // openDetail/closeDetail — not mirrored at render time, which would lag one
  // render behind a click. Each open/close bumps `selectionGenRef`; a detail
  // response (initial open or periodic refresh) reaches the UI only if its
  // generation AND its order id are still the current selection. This covers
  // A→B, close-before-response, re-opening the same order (A→close→A), and a
  // refresh that lands after the selection changed.
  const selectedIdRef = useRef<string | null>(null);
  const selectionGenRef = useRef(0);
  const isCurrent = (gen: number, orderRequestId: string): boolean =>
    selectionGenRef.current === gen && selectedIdRef.current === orderRequestId;
  const statusRef = useRef("");
  statusRef.current = status;

  const refreshOrders = useCallback(async (): Promise<void> => {
    if (!token || !customerId) return;
    try {
      const params = new URLSearchParams();
      const filterStatus = statusRef.current;
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", String(LAST_ORDERS_LIMIT));
      const result = await apiClient.get<{ items: OrderRequest[] }>(
        `/customers/${customerId}/order-requests?${params.toString()}`
      );
      setOrders(result.items);
    } catch {
      // صامتٌ: فشلُ التحديثِ الدوريّ لا يُفرِغُ القائمةَ ولا يُظهرُ خطأً (القائمةُ الأخيرةُ تبقى).
    }
  }, [token, customerId]);

  const refreshDetail = useCallback(
    async (orderRequestId: string): Promise<void> => {
      if (!token || !customerId) return;
      const gen = selectionGenRef.current;
      try {
        const result = await apiClient.get<OrderRequestDetail>(
          `/customers/${customerId}/order-requests/${orderRequestId}`
        );
        if (!isCurrent(gen, orderRequestId)) return; // stale: selection changed meanwhile
        setDetail(result);
      } catch {
        // صامتٌ: تفاصيلُ آخرِ قراءةٍ ناجحةٍ تبقى.
      }
    },
    [token, customerId]
  );

  useEffect(() => {
    if (!token || !customerId) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refreshOrders();
      const current = selectedIdRef.current;
      if (current !== null) void refreshDetail(current);
    }, STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [token, customerId, refreshOrders, refreshDetail]);

  // CMS §3.6 L87 · L90: `GET /customers/{id}/order-requests/{orderRequestId}`.
  const openDetail = useCallback(
    async (orderRequestId: string) => {
      if (!token || !customerId) return;
      selectionGenRef.current += 1;
      const gen = selectionGenRef.current;
      selectedIdRef.current = orderRequestId;
      setSelectedId(orderRequestId);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const result = await apiClient.get<OrderRequestDetail>(
          `/customers/${customerId}/order-requests/${orderRequestId}`
        );
        if (!isCurrent(gen, orderRequestId)) return; // stale: another selection owns the view
        setDetail(result);
        setDetailLoading(false);
      } catch (e) {
        if (!isCurrent(gen, orderRequestId)) return;
        // 404 → «الطلب غير موجود» (CUSTOMER_ORDER_REQUEST_NOT_FOUND)؛ غيره خطأُ تحميلٍ.
        const status = (e as { status?: number }).status;
        setDetailError(status === 404 ? "not_found" : "load_error");
        setDetailLoading(false);
      }
    },
    [token, customerId]
  );

  const closeDetail = useCallback(() => {
    selectionGenRef.current += 1;
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

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

      {selectedId !== null ? (
        <section
          className="order-detail"
          aria-label={t("orders.detail_title")}
          data-testid="order-detail"
        >
          <button
            type="button"
            className="back-button"
            onClick={closeDetail}
            data-testid="order-detail-back"
          >
            {t("orders.detail_back")}
          </button>
          <h2>{t("orders.detail_title")}</h2>
          {detailLoading && (
            <div className="loading-indicator" data-testid="order-detail-loading">
              {t("common.loading")}
            </div>
          )}
          {detailError && (
            <div className="error-message" role="alert" data-testid="order-detail-error">
              {detailError === "not_found"
                ? t("orders.detail_not_found")
                : t("orders.detail_load_error")}
            </div>
          )}
          {detail && (
            <dl className="order-detail-grid" data-testid={`order-detail-${detail.id}`}>
              <div>
                <dt>{t("orders.detail_status")}</dt>
                <dd data-testid="order-detail-status">
                  {t(`orders.status_${detail.status}`)}
                </dd>
              </div>
              <div>
                <dt>{t("orders.detail_vehicle")}</dt>
                <dd>{t(`ride_order.vehicle_${detail.vehicle_class}`)}</dd>
              </div>
              <div>
                <dt>{t("orders.detail_price")}</dt>
                <dd data-testid="order-detail-price">
                  {detail.offered_price
                    ? `${detail.offered_price.amount} ${detail.offered_price.currency}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("orders.detail_created_at")}</dt>
                <dd>{new Date(detail.created_at).toLocaleDateString("ar-SA")}</dd>
              </div>
              {detail.notes && (
                <div>
                  <dt>{t("orders.detail_notes")}</dt>
                  <dd>{detail.notes}</dd>
                </div>
              )}
              <div>
                <dt>{t("orders.detail_route")}</dt>
                <dd>
                  <ol className="order-detail-stops" data-testid="order-detail-stops">
                    {detail.stops.map((stop) => (
                      <li
                        key={`${stop.sequence}-${stop.zone_id}`}
                        data-testid={`order-detail-stop-${stop.sequence}`}
                      >
                        {t(
                          stop.kind === "pickup"
                            ? "orders.detail_stop_pickup"
                            : "orders.detail_stop_dropoff"
                        )}{" "}
                        — {stop.label ?? stop.zone_path ?? stop.zone_id}
                      </li>
                    ))}
                  </ol>
                </dd>
              </div>
            </dl>
          )}
        </section>
      ) : (
        <>
      {orders.length > 0 && (
        <ul className="orders-list" data-testid="orders-list">
          {orders.map((order) => (
            <li key={order.id} className="order-item" data-testid={`order-${order.id}`}>
              {/* CMS §3.6 L87: النقر على الطلب يفتح تفاصيل الحالة والمسار. */}
              <button
                type="button"
                className="order-item-button"
                onClick={() => void openDetail(order.id)}
                data-testid={`order-detail-open-${order.id}`}
                aria-label={`${t("orders.detail_title")}: ${order.id}`}
              >
                <span className="order-id">{order.id}</span>
                <span className="order-type">{t(`orders.type_${order.order_type}`)}</span>
                <span className="order-status">{t(`orders.status_${order.status}`)}</span>
                <span className="order-vehicle">{t(`ride_order.vehicle_${order.vehicle_class}`)}</span>
                <span className="order-date">{new Date(order.created_at).toLocaleDateString("ar-SA")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
        </>
      )}
    </div>
  );
}
