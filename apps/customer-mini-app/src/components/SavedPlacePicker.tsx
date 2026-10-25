import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePlacesStore, type SavedPlace } from "../store/places";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

// G-S9.1 (CLM-0618): a saved-place picker for pickup/dropoff.
// CMS §3.2 L52-53 lists «اسم مكان» among the pickup/dropoff sources; the
// contract GET /customers/:id/places already exists (limit 5) and the stop
// contract already declares source: "saved_place". This component only
// renders the picker; the screen decides what selecting a place fills.

interface SavedPlacePickerProps {
  id: string;
  label: string;
  testId: string;
  /** Currently selected place_id ("" = none). */
  selectedPlaceId: string;
  /** Called with the place chosen by the user. */
  onSelect: (place: SavedPlace) => void;
}

export function SavedPlacePicker({
  id,
  label,
  testId,
  selectedPlaceId,
  onSelect,
}: SavedPlacePickerProps) {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const { places, status, setPlaces, setStatus, setError } = usePlacesStore();
  const loadStartedRef = useRef(false);

  const loadPlaces = useCallback(async () => {
    if (!token || !customerId) return;
    // CLM-0622: read the live store, not the render-time snapshot — both
    // pickers mount in the same commit and must share one request.
    if (usePlacesStore.getState().status === "loading") return;
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

  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    // Load once per mount; the shared store caches across screens.
    // Retry on a previous failure so the next mount can recover.
    const current = usePlacesStore.getState().status;
    if (current === "idle" || current === "error") {
      loadPlaces();
    }
  }, [loadPlaces]);

  const handleChange = useCallback(
    (placeId: string) => {
      const place = places.find((p) => p.place_id === placeId);
      if (place) {
        onSelect(place);
      }
    },
    [places, onSelect]
  );

  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        data-testid={testId}
        value={selectedPlaceId}
        onChange={(e) => handleChange(e.target.value)}
        disabled={status === "loading"}
        aria-label={label}
      >
        <option value="">{t("ride_order.saved_place_placeholder")}</option>
        {places.map((place) => (
          <option key={place.place_id} value={place.place_id}>
            {place.label}
            {place.zone_path ? ` — ${place.zone_path.join(" / ")}` : ""}
          </option>
        ))}
      </select>
      {status === "error" && (
        <div role="alert" data-testid={`${testId}-error`}>
          <span>{t("ride_order.saved_places_load_error")}</span>
          <button type="button" onClick={() => loadPlaces()} data-testid={`${testId}-retry`}>
            {t("common.retry")}
          </button>
        </div>
      )}
    </div>
  );
}
