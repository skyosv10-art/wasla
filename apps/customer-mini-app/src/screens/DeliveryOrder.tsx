import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOrderFormStore, buildOrderRequest, validateOrderForm, type VehicleClass, type PriceMode } from "../store/order-form";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

const VEHICLE_CLASSES: VehicleClass[] = ["sedan", "suv", "van", "pickup", "motorcycle", "truck_small"];
const PRICE_MODES: PriceMode[] = ["negotiable", "customer_offer"];
const SHIPMENT_TYPES = ["parcel", "documents", "food", "goods", "other"] as const;

export function DeliveryOrder() {
  const { t } = useTranslation();
  const store = useOrderFormStore();
  const { token, customerId } = useSessionStore();
  const [formError, setFormError] = useState<string | null>(null);
  const [shipmentType, setShipmentType] = useState<string>("");
  const [shipmentDesc, setShipmentDesc] = useState<string>("");
  const [weightKg, setWeightKg] = useState<string>("");

  const buildDeliveryRequest = useCallback(() => {
    const body = buildOrderRequest(store);
    return {
      ...body,
      order_type: "delivery" as const,
      shipment: {
        shipment_type: shipmentType || null,
        description: shipmentDesc || null,
        weight_kg: weightKg ? parseFloat(weightKg) : null,
      },
    };
  }, [store, shipmentType, shipmentDesc, weightKg]);

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
      const body = buildDeliveryRequest();
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
  }, [token, customerId, store, buildDeliveryRequest]);

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
      const body = buildDeliveryRequest();
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
  }, [token, customerId, store, buildDeliveryRequest]);

  const isSubmitting = store.submitStatus === "loading";
  const isPreviewing = store.previewStatus === "loading";
  const disabled = isPreviewing || isSubmitting || !token || !customerId;

  return (
    <div className="screen delivery-order-screen">
      <h1>{t("delivery_order.title")}</h1>

      {/* Pickup */}
      <div className="form-group">
        <label htmlFor="d-pickup-zone">{t("ride_order.pickup_zone")}</label>
        <input
          id="d-pickup-zone"
          type="text"
          value={store.pickupZoneId}
          onChange={(e) => store.setPickupZoneId(e.target.value)}
          placeholder={t("ride_order.zone_placeholder")}
          aria-label={t("ride_order.pickup_zone")}
          data-testid="d-pickup-zone-input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="d-pickup-label">{t("ride_order.pickup_label")}</label>
        <input
          id="d-pickup-label"
          type="text"
          value={store.pickupLabel}
          onChange={(e) => store.setPickupLabel(e.target.value)}
          placeholder={t("ride_order.label_placeholder")}
          aria-label={t("ride_order.pickup_label")}
          data-testid="d-pickup-label-input"
        />
      </div>

      {/* Dropoff */}
      <div className="form-group">
        <label htmlFor="d-dropoff-zone">{t("ride_order.dropoff_zone")}</label>
        <input
          id="d-dropoff-zone"
          type="text"
          value={store.dropoffZoneId}
          onChange={(e) => store.setDropoffZoneId(e.target.value)}
          placeholder={t("ride_order.zone_placeholder")}
          aria-label={t("ride_order.dropoff_zone")}
          data-testid="d-dropoff-zone-input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="d-dropoff-label">{t("ride_order.dropoff_label")}</label>
        <input
          id="d-dropoff-label"
          type="text"
          value={store.dropoffLabel}
          onChange={(e) => store.setDropoffLabel(e.target.value)}
          placeholder={t("ride_order.label_placeholder")}
          aria-label={t("ride_order.dropoff_label")}
          data-testid="d-dropoff-label-input"
        />
      </div>

      {/* Vehicle class */}
      <div className="form-group">
        <label htmlFor="d-vehicle-class">{t("ride_order.vehicle_class")}</label>
        <select
          id="d-vehicle-class"
          value={store.vehicleClass}
          onChange={(e) => store.setVehicleClass(e.target.value as VehicleClass)}
          aria-label={t("ride_order.vehicle_class")}
          data-testid="d-vehicle-class-select"
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
        <label htmlFor="d-price-mode">{t("ride_order.price_mode")}</label>
        <select
          id="d-price-mode"
          value={store.priceMode}
          onChange={(e) => store.setPriceMode(e.target.value as PriceMode)}
          aria-label={t("ride_order.price_mode")}
          data-testid="d-price-mode-select"
        >
          {PRICE_MODES.map((pm) => (
            <option key={pm} value={pm}>
              {t(`ride_order.price_mode_${pm}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Offered price */}
      {store.priceMode === "customer_offer" && (
        <div className="form-group">
          <label htmlFor="d-offered-price">{t("ride_order.offered_price")}</label>
          <input
            id="d-offered-price"
            type="number"
            min="0"
            step="0.01"
            value={store.offeredPrice}
            onChange={(e) => store.setOfferedPrice(e.target.value)}
            placeholder="0.00"
            aria-label={t("ride_order.offered_price")}
            data-testid="d-offered-price-input"
          />
        </div>
      )}

      {/* Shipment details */}
      <div className="form-group">
        <label htmlFor="shipment-type">{t("delivery_order.shipment_type")}</label>
        <select
          id="shipment-type"
          value={shipmentType}
          onChange={(e) => setShipmentType(e.target.value)}
          aria-label={t("delivery_order.shipment_type")}
          data-testid="shipment-type-select"
        >
          <option value="">{t("delivery_order.shipment_type_none")}</option>
          {SHIPMENT_TYPES.map((st) => (
            <option key={st} value={st}>
              {t(`delivery_order.shipment_type_${st}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="shipment-desc">{t("delivery_order.shipment_description")}</label>
        <input
          id="shipment-desc"
          type="text"
          value={shipmentDesc}
          onChange={(e) => setShipmentDesc(e.target.value)}
          maxLength={300}
          placeholder={t("delivery_order.shipment_description_placeholder")}
          aria-label={t("delivery_order.shipment_description")}
          data-testid="shipment-desc-input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="weight-kg">{t("delivery_order.weight_kg")}</label>
        <input
          id="weight-kg"
          type="number"
          min="0"
          max="3000"
          step="0.1"
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
          placeholder="0"
          aria-label={t("delivery_order.weight_kg")}
          data-testid="weight-kg-input"
        />
      </div>

      {/* Notes */}
      <div className="form-group">
        <label htmlFor="d-notes">{t("ride_order.notes")}</label>
        <textarea
          id="d-notes"
          value={store.notes}
          onChange={(e) => store.setNotes(e.target.value)}
          maxLength={500}
          placeholder={t("ride_order.notes_placeholder")}
          aria-label={t("ride_order.notes")}
          data-testid="d-notes-input"
        />
      </div>

      {/* Form error */}
      {formError && (
        <div className="error-message" role="alert" data-testid="d-form-error">
          {t(`errors.${formError}`)}
        </div>
      )}

      {/* Preview */}
      {store.previewStatus === "loading" && (
        <div className="loading-indicator" data-testid="d-preview-loading">
          {t("common.loading")}
        </div>
      )}
      {store.previewStatus === "error" && store.previewError && (
        <div className="error-message" role="alert" data-testid="d-preview-error">
          {store.previewError}
        </div>
      )}
      {store.previewStatus === "success" && store.preview && (
        <div className="preview-result" data-testid="d-preview-result">
          <h3>{t("ride_order.preview_title")}</h3>
          <p>{t("ride_order.vehicle_label")}: {t(`ride_order.vehicle_${store.preview.vehicle_class}`)}</p>
          <p>{t("ride_order.stops_label")}: {store.preview.stops.length}</p>
        </div>
      )}

      {/* Submit result */}
      {store.submitStatus === "success" && store.submitResult && (
        <div className="success-message" data-testid="d-submit-success">
          <p>{t("ride_order.order_submitted")}</p>
          <p>{t("ride_order.order_id")}: {store.submitResult.order_request_id}</p>
        </div>
      )}
      {store.submitStatus === "error" && store.submitError && (
        <div className="error-message" role="alert" data-testid="d-submit-error">
          {store.submitError}
        </div>
      )}

      {/* Actions */}
      <div className="form-actions">
        <button
          type="button"
          onClick={handlePreview}
          disabled={disabled}
          data-testid="d-preview-button"
        >
          {isPreviewing ? t("common.loading") : t("ride_order.preview_button")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          data-testid="d-submit-button"
        >
          {isSubmitting ? t("common.submitting") : t("ride_order.submit_button")}
        </button>
      </div>
    </div>
  );
}
