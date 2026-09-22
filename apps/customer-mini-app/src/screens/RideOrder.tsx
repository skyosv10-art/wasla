import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOrderFormStore, buildOrderRequest, validateOrderForm, type VehicleClass, type PriceMode } from "../store/order-form";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

const VEHICLE_CLASSES: VehicleClass[] = ["sedan", "suv", "van", "pickup", "motorcycle", "truck_small"];
const PRICE_MODES: PriceMode[] = ["negotiable", "customer_offer"];

export function RideOrder() {
  const { t } = useTranslation();
  const store = useOrderFormStore();
  const { token, customerId } = useSessionStore();
  const [formError, setFormError] = useState<string | null>(null);

  const handlePreview = useCallback(async () => {
    if (!token || !customerId) return;
    const error = validateOrderForm(store);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    store.setPreviewStatus("loading");
    store.setPreviewError(null);

    try {
      const body = buildOrderRequest(store);
      const result = await apiClient.post(
        `/customers/${customerId}/order-requests/preview`,
        body
      );
      store.setPreview(result as never);
      store.setPreviewStatus("success");
    } catch (e) {
      store.setPreviewError(e instanceof Error ? e.message : "preview_failed");
      store.setPreviewStatus("error");
    }
  }, [token, customerId, store]);

  const handleSubmit = useCallback(async () => {
    if (!token || !customerId) return;
    const error = validateOrderForm(store);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    store.setSubmitStatus("loading");
    store.setSubmitError(null);

    try {
      const body = buildOrderRequest(store);
      const idempotencyKey = crypto.randomUUID();
      const result = await apiClient.post(
        `/customers/${customerId}/order-requests`,
        body,
        { "Idempotency-Key": idempotencyKey }
      );
      store.setSubmitResult(result as never);
      store.setSubmitStatus("success");
    } catch (e) {
      store.setSubmitError(e instanceof Error ? e.message : "submit_failed");
      store.setSubmitStatus("error");
    }
  }, [token, customerId, store]);

  const isSubmitting = store.submitStatus === "loading";
  const isPreviewing = store.previewStatus === "loading";
  const disabled = isPreviewing || isSubmitting || !token || !customerId;

  return (
    <div className="screen ride-order-screen">
      <h1>{t("ride_order.title")}</h1>

      {/* Pickup */}
      <div className="form-group">
        <label htmlFor="pickup-zone">{t("ride_order.pickup_zone")}</label>
        <input
          id="pickup-zone"
          type="text"
          value={store.pickupZoneId}
          onChange={(e) => store.setPickupZoneId(e.target.value)}
          placeholder={t("ride_order.zone_placeholder")}
          aria-label={t("ride_order.pickup_zone")}
          data-testid="pickup-zone-input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="pickup-label">{t("ride_order.pickup_label")}</label>
        <input
          id="pickup-label"
          type="text"
          value={store.pickupLabel}
          onChange={(e) => store.setPickupLabel(e.target.value)}
          placeholder={t("ride_order.label_placeholder")}
          aria-label={t("ride_order.pickup_label")}
          data-testid="pickup-label-input"
        />
      </div>

      {/* Dropoff */}
      <div className="form-group">
        <label htmlFor="dropoff-zone">{t("ride_order.dropoff_zone")}</label>
        <input
          id="dropoff-zone"
          type="text"
          value={store.dropoffZoneId}
          onChange={(e) => store.setDropoffZoneId(e.target.value)}
          placeholder={t("ride_order.zone_placeholder")}
          aria-label={t("ride_order.dropoff_zone")}
          data-testid="dropoff-zone-input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="dropoff-label">{t("ride_order.dropoff_label")}</label>
        <input
          id="dropoff-label"
          type="text"
          value={store.dropoffLabel}
          onChange={(e) => store.setDropoffLabel(e.target.value)}
          placeholder={t("ride_order.label_placeholder")}
          aria-label={t("ride_order.dropoff_label")}
          data-testid="dropoff-label-input"
        />
      </div>

      {/* Vehicle class */}
      <div className="form-group">
        <label htmlFor="vehicle-class">{t("ride_order.vehicle_class")}</label>
        <select
          id="vehicle-class"
          value={store.vehicleClass}
          onChange={(e) => store.setVehicleClass(e.target.value as VehicleClass)}
          aria-label={t("ride_order.vehicle_class")}
          data-testid="vehicle-class-select"
        >
          {VEHICLE_CLASSES.map((vc) => (
            <option key={vc} value={vc}>
              {t(`ride_order.vehicle_${vc}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Price mode */}
      <div className="form-group">
        <label htmlFor="price-mode">{t("ride_order.price_mode")}</label>
        <select
          id="price-mode"
          value={store.priceMode}
          onChange={(e) => store.setPriceMode(e.target.value as PriceMode)}
          aria-label={t("ride_order.price_mode")}
          data-testid="price-mode-select"
        >
          {PRICE_MODES.map((pm) => (
            <option key={pm} value={pm}>
              {t(`ride_order.price_mode_${pm}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Offered price (only for customer_offer) */}
      {store.priceMode === "customer_offer" && (
        <div className="form-group">
          <label htmlFor="offered-price">{t("ride_order.offered_price")}</label>
          <input
            id="offered-price"
            type="number"
            min="0"
            step="0.01"
            value={store.offeredPrice}
            onChange={(e) => store.setOfferedPrice(e.target.value)}
            placeholder="0.00"
            aria-label={t("ride_order.offered_price")}
            data-testid="offered-price-input"
          />
        </div>
      )}

      {/* Notes */}
      <div className="form-group">
        <label htmlFor="notes">{t("ride_order.notes")}</label>
        <textarea
          id="notes"
          value={store.notes}
          onChange={(e) => store.setNotes(e.target.value)}
          maxLength={500}
          placeholder={t("ride_order.notes_placeholder")}
          aria-label={t("ride_order.notes")}
          data-testid="notes-input"
        />
      </div>

      {/* Form validation error */}
      {formError && (
        <div className="error-message" role="alert" data-testid="form-error">
          {t(`errors.${formError}`)}
        </div>
      )}

      {/* Preview */}
      {store.previewStatus === "loading" && (
        <div className="loading-indicator" data-testid="preview-loading">
          {t("common.loading")}
        </div>
      )}
      {store.previewStatus === "error" && store.previewError && (
        <div className="error-message" role="alert" data-testid="preview-error">
          {store.previewError}
        </div>
      )}
      {store.previewStatus === "success" && store.preview && (
        <div className="preview-result" data-testid="preview-result">
          <h3>{t("ride_order.preview_title")}</h3>
          <p>{t("ride_order.vehicle_label")}: {t(`ride_order.vehicle_${store.preview.vehicle_class}`)}</p>
          <p>{t("ride_order.stops_label")}: {store.preview.stops.length}</p>
          {store.preview.offered_price && (
            <p>{t("ride_order.price_label")}: {store.preview.offered_price.amount} {store.preview.offered_price.currency}</p>
          )}
        </div>
      )}

      {/* Submit result */}
      {store.submitStatus === "success" && store.submitResult && (
        <div className="success-message" data-testid="submit-success">
          <p>{t("ride_order.order_submitted")}</p>
          <p>{t("ride_order.order_id")}: {store.submitResult.order_request_id}</p>
          {store.submitResult.order_public_id && (
            <p>{t("ride_order.order_public_id")}: {store.submitResult.order_public_id}</p>
          )}
        </div>
      )}
      {store.submitStatus === "error" && store.submitError && (
        <div className="error-message" role="alert" data-testid="submit-error">
          {store.submitError}
        </div>
      )}

      {/* Actions */}
      <div className="form-actions">
        <button
          type="button"
          onClick={handlePreview}
          disabled={disabled}
          data-testid="preview-button"
        >
          {isPreviewing ? t("common.loading") : t("ride_order.preview_button")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          data-testid="submit-button"
        >
          {isSubmitting ? t("common.submitting") : t("ride_order.submit_button")}
        </button>
      </div>
    </div>
  );
}
