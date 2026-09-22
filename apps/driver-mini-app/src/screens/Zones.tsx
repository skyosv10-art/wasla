import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useZonesStore } from "../store/zones";
import { useSessionStore } from "../store/session";
import type { ServiceZoneUpdate } from "../types/zones";
import { navigate } from "../router";

export function Zones() {
  const { t } = useTranslation();
  const {
    zones,
    availableZones,
    loading,
    error,
    saving,
    saveError,
    saveSuccess,
    fetchZones,
    setAvailableZones,
    saveZones,
    clearErrors,
  } = useZonesStore();
  const { isAuthenticated } = useSessionStore();

  // Selected zones: zone_id → preference_rank (1-indexed by selection order)
  const [selected, setSelected] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (isAuthenticated()) {
      fetchZones();
    }
  }, [isAuthenticated, fetchZones]);

  // Sync selected from fetched zones (only on initial load)
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (zones.length > 0 && !synced) {
      const map = new Map<string, boolean>();
      zones.forEach((z) => map.set(z.zone_id, true));
      setSelected(map);
      setSynced(true);
    }
  }, [zones, synced]);

  // Load available zones (in a real app, this would come from geography service)
  // For now, derive from existing zone_ids as display names
  useEffect(() => {
    if (availableZones.length === 0 && zones.length > 0) {
      setAvailableZones(
        zones.map((z) => ({
          id: z.zone_id,
          name: `Zone ${z.zone_id.slice(0, 8)}`,
          parent_path: "",
        })),
      );
    }
  }, [availableZones.length, zones, setAvailableZones]);

  const toggleZone = (zoneId: string) => {
    const next = new Map(selected);
    if (next.has(zoneId)) {
      next.delete(zoneId);
    } else {
      next.set(zoneId, true);
    }
    setSelected(next);
  };

  const handleSave = async () => {
    // Sort by original preference_rank, then assign new sequential ranks
    const zoneRankMap = new Map(zones.map((z) => [z.zone_id, z.preference_rank]));
    const sortedIds = Array.from(selected.keys()).sort((a, b) => {
      const ra = zoneRankMap.get(a) ?? 999;
      const rb = zoneRankMap.get(b) ?? 999;
      return ra - rb;
    });
    const updates: ServiceZoneUpdate[] = sortedIds.map((zoneId, i) => ({
      zone_id: zoneId,
      preference_rank: i + 1,
    }));
    await saveZones(updates);
  };

  if (loading) {
    return (
      <div className="screen-loading">
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-error">
        <p className="error-text">{error}</p>
        <button onClick={() => fetchZones()} className="btn-retry">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  // Build display list: existing selected zones + any available zones
  const allZoneIds = new Set<string>([
    ...zones.map((z) => z.zone_id),
    ...availableZones.map((z) => z.id),
  ]);

  return (
    <div className="screen zones-screen">
      <h2 className="screen-title">{t("zones.title")}</h2>

      {allZoneIds.size === 0 && (
        <div className="empty-state">
          <p>{t("common.empty")}</p>
        </div>
      )}

      <div className="zones-list">
        {Array.from(allZoneIds).map((zoneId) => {
          const zone = availableZones.find((z) => z.id === zoneId);
          const name = zone?.name ?? `Zone ${zoneId.slice(0, 8)}`;
          const isSelected = selected.has(zoneId);
          return (
            <label key={zoneId} className="zone-item" data-testid={`zone-${zoneId}`}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleZone(zoneId)}
                data-testid={`zone-checkbox-${zoneId}`}
              />
              <span>{name}</span>
            </label>
          );
        })}
      </div>

      {saveError && (
        <p className="error-text" data-testid="save-error">
          {saveError}
        </p>
      )}

      {saveSuccess && (
        <p className="success-text" data-testid="save-success">
          {t("common.saved")}
        </p>
      )}

      <button
        onClick={handleSave}
        className="btn-primary"
        disabled={saving || selected.size === 0}
        data-testid="save-zones"
      >
        {saving ? t("common.submitting") : t("zones.save")}
      </button>

      <button onClick={() => clearErrors()} className="btn-secondary">
        {t("common.cancel")}
      </button>

      <button onClick={() => navigate("home")} className="btn-back">
        {t("common.back")}
      </button>
    </div>
  );
}
