import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVehiclesStore } from "../store/vehicles";
import { useSessionStore } from "../store/session";
import type { VehicleClass } from "../types/vehicles";
import { navigate } from "../router";

const VEHICLE_CLASSES: VehicleClass[] = [
  "sedan",
  "suv",
  "van",
  "pickup",
  "motorcycle",
  "truck_small",
];

export function Vehicles() {
  const { t } = useTranslation();
  const { vehicles, loading, error, actionLoading, actionError, fetchVehicles, addVehicle, patchVehicle, clearErrors } =
    useVehiclesStore();
  const { isAuthenticated } = useSessionStore();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    vehicle_class: "sedan" as VehicleClass,
    make: "",
    model: "",
    model_year: "",
    color: "",
    plate_number: "",
  });

  useEffect(() => {
    if (isAuthenticated()) {
      fetchVehicles();
    }
  }, [isAuthenticated, fetchVehicles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await addVehicle({
      vehicle_class: form.vehicle_class,
      make: form.make || null,
      model: form.model || null,
      model_year: form.model_year ? parseInt(form.model_year, 10) : null,
      color: form.color || null,
      plate_number: form.plate_number || null,
    });
    if (ok) {
      setShowForm(false);
      setForm({
        vehicle_class: "sedan",
        make: "",
        model: "",
        model_year: "",
        color: "",
        plate_number: "",
      });
      clearErrors();
    }
  };

  const handleRetire = async (vehicleId: string) => {
    await patchVehicle(vehicleId, { status: "retired" });
  };

  const handleSetPrimary = async (vehicleId: string) => {
    await patchVehicle(vehicleId, { is_primary: true });
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
        <button onClick={() => fetchVehicles()} className="btn-retry">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="screen vehicles-screen">
      <h2 className="screen-title">{t("vehicles.title")}</h2>

      {vehicles.length === 0 && !showForm && (
        <div className="empty-state">
          <p>{t("common.empty")}</p>
        </div>
      )}

      <div className="vehicles-list">
        {vehicles.map((v) => (
          <div key={v.id} className="vehicle-card" data-testid={`vehicle-${v.id}`}>
            <div className="vehicle-info">
              <span className="vehicle-class">
                {t(`vehicles.${v.vehicle_class}`)}
              </span>
              {v.make && <span className="vehicle-make">{v.make}</span>}
              {v.model && <span className="vehicle-model">{v.model}</span>}
              {v.plate_number && (
                <span className="vehicle-plate">{v.plate_number}</span>
              )}
              <span
                className={`vehicle-status ${
                  v.status === "active" ? "active" : "retired"
                }`}
              >
                {v.status === "active" ? t("vehicles.active") : t("vehicles.inactive")}
              </span>
              {v.is_primary && (
                <span className="vehicle-primary">{t("vehicles.primary")}</span>
              )}
            </div>
            <div className="vehicle-actions">
              {v.status === "active" && !v.is_primary && (
                <button
                  onClick={() => handleSetPrimary(v.id)}
                  className="btn-secondary"
                  disabled={actionLoading}
                  data-testid={`set-primary-${v.id}`}
                >
                  {t("vehicles.set_primary")}
                </button>
              )}
              {v.status === "active" && (
                <button
                  onClick={() => handleRetire(v.id)}
                  className="btn-danger"
                  disabled={actionLoading}
                  data-testid={`retire-${v.id}`}
                >
                  {t("vehicles.retire")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {actionError && (
        <p className="error-text" data-testid="action-error">
          {actionError}
        </p>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary"
          data-testid="add-vehicle-btn"
        >
          {t("vehicles.add")}
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="vehicle-form" data-testid="vehicle-form">
          <select
            value={form.vehicle_class}
            onChange={(e) =>
              setForm({ ...form, vehicle_class: e.target.value as VehicleClass })
            }
            data-testid="form-vehicle_class"
          >
            {VEHICLE_CLASSES.map((vc) => (
              <option key={vc} value={vc}>
                {t(`vehicles.${vc}`)}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder={t("vehicles.make")}
            value={form.make}
            onChange={(e) => setForm({ ...form, make: e.target.value })}
            data-testid="form-make"
          />

          <input
            type="text"
            placeholder={t("vehicles.model")}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            data-testid="form-model"
          />

          <input
            type="number"
            placeholder={t("vehicles.year")}
            value={form.model_year}
            onChange={(e) => setForm({ ...form, model_year: e.target.value })}
            min="1970"
            max="2100"
            data-testid="form-model_year"
          />

          <input
            type="text"
            placeholder={t("vehicles.color")}
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            data-testid="form-color"
          />

          <input
            type="text"
            placeholder={t("vehicles.plate")}
            value={form.plate_number}
            onChange={(e) => setForm({ ...form, plate_number: e.target.value })}
            data-testid="form-plate_number"
          />

          <div className="form-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={actionLoading}
              data-testid="submit-vehicle"
            >
              {actionLoading ? t("common.submitting") : t("vehicles.add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                clearErrors();
              }}
              className="btn-secondary"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      <button onClick={() => navigate("home")} className="btn-back">
        {t("common.back")}
      </button>
    </div>
  );
}
