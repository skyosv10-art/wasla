import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePlacesStore, type SavedPlace } from "../store/places";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

export function SavedPlaces() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const placesStore = usePlacesStore();
  const { setPlaces, setStatus, setError } = placesStore;
  const [newLabel, setNewLabel] = useState("");
  const [newZoneId, setNewZoneId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadPlaces = useCallback(async () => {
    if (!token || !customerId) return;
    setStatus("loading");
    setError(null);

    try {
      const result = await apiClient.get<{ items: SavedPlace[]; limit: number }>(
        `/customers/${customerId}/places`
      );
      setPlaces(result.items);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
      setStatus("error");
    }
  }, [token, customerId, setPlaces, setStatus, setError]);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadPlaces();
  }, [loadPlaces]);

  const handleAddPlace = useCallback(async () => {
    if (!token || !customerId) return;
    if (!newLabel.trim() || !newZoneId.trim()) {
      setAddError("fields_required");
      return;
    }
    setAdding(true);
    setAddError(null);

    try {
      const idempotencyKey = crypto.randomUUID();
      await apiClient.post(
        `/customers/${customerId}/places`,
        { label: newLabel.trim(), zone_id: newZoneId.trim() },
        { "Idempotency-Key": idempotencyKey }
      );
      setNewLabel("");
      setNewZoneId("");
      await loadPlaces();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "add_failed");
    } finally {
      setAdding(false);
    }
  }, [token, customerId, newLabel, newZoneId, loadPlaces, setError]);

  const handleDeletePlace = useCallback(async (placeId: string) => {
    if (!token || !customerId) return;

    try {
      await apiClient.del(`/customers/${customerId}/places/${placeId}`);
      await loadPlaces();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    }
  }, [token, customerId, loadPlaces, setError]);

  return (
    <div className="screen saved-places-screen">
      <h1>{t("places.title")}</h1>

      {/* Add new place */}
      <div className="form-group">
        <label htmlFor="place-label">{t("places.label")}</label>
        <input
          id="place-label"
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={t("places.label_placeholder")}
          aria-label={t("places.label")}
          data-testid="place-label-input"
        />
      </div>
      <div className="form-group">
        <label htmlFor="place-zone">{t("places.zone_id")}</label>
        <input
          id="place-zone"
          type="text"
          value={newZoneId}
          onChange={(e) => setNewZoneId(e.target.value)}
          placeholder={t("ride_order.zone_placeholder")}
          aria-label={t("places.zone_id")}
          data-testid="place-zone-input"
        />
      </div>

      {addError && (
        <div className="error-message" role="alert" data-testid="place-add-error">
          {t(`errors.${addError}`)}
        </div>
      )}

      <button
        type="button"
        onClick={handleAddPlace}
        disabled={adding || !token || !customerId}
        data-testid="add-place-button"
      >
        {adding ? t("common.loading") : t("places.add_button")}
      </button>

      {/* Places list */}
      {placesStore.status === "loading" && (
        <div className="loading-indicator" data-testid="places-loading">
          {t("common.loading")}
        </div>
      )}
      {placesStore.error && (
        <div className="error-message" role="alert" data-testid="places-error">
          {placesStore.error}
        </div>
      )}
      {placesStore.status === "success" && placesStore.places.length === 0 && (
        <div className="empty-state" data-testid="places-empty">
          {t("places.empty")}
        </div>
      )}
      {placesStore.status === "success" && placesStore.places.length > 0 && (
        <ul className="places-list" data-testid="places-list">
          {placesStore.places.map((place) => (
            <li key={place.place_id} className="place-item" data-testid={`place-${place.place_id}`}>
              <span className="place-label">{place.label}</span>
              {place.zone_path && (
                <span className="place-zone-path">{place.zone_path.join(" / ")}</span>
              )}
              <button
                type="button"
                onClick={() => handleDeletePlace(place.place_id)}
                className="delete-button"
                aria-label={t("places.delete_aria", { label: place.label })}
                data-testid={`delete-place-${place.place_id}`}
              >
                {t("places.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
