import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProfileStore } from "../store/profile";
import { useSessionStore } from "../store/session";
import { navigate } from "../router";
import type { ServiceKind } from "../types/profile";

export function Profile() {
  const { t } = useTranslation();
  const { isAuthenticated } = useSessionStore();
  const authenticated = isAuthenticated();
  const {
    profile,
    loading,
    error,
    saving,
    saveError,
    saveSuccess,
    fetchProfile,
    updateProfile,
    clearErrors,
  } = useProfileStore();

  const [displayName, setDisplayName] = useState("");
  const [preferredLocale, setPreferredLocale] = useState("ar");
  const [workCityZoneId, setWorkCityZoneId] = useState("");
  const [serviceKinds, setServiceKinds] = useState<ServiceKind[]>([]);

  useEffect(() => {
    if (authenticated) {
      fetchProfile();
    }
  }, [authenticated, fetchProfile]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? "");
      setPreferredLocale(profile.preferred_locale);
      setWorkCityZoneId(profile.work_city_zone_id ?? "");
      setServiceKinds([...profile.service_kinds]);
    }
  }, [profile]);

  const toggleServiceKind = (kind: ServiceKind) => {
    setServiceKinds((prev) =>
      prev.includes(kind)
        ? prev.filter((k) => k !== kind)
        : [...prev, kind],
    );
  };

  const handleSave = async () => {
    const patch: Record<string, unknown> = {};
    if (displayName !== (profile?.display_name ?? "")) {
      patch.display_name = displayName || null;
    }
    if (preferredLocale !== profile?.preferred_locale) {
      patch.preferred_locale = preferredLocale;
    }
    if (workCityZoneId !== (profile?.work_city_zone_id ?? "")) {
      patch.work_city_zone_id = workCityZoneId || null;
    }
    const currentKinds = profile?.service_kinds ?? [];
    if (JSON.stringify([...serviceKinds].sort()) !== JSON.stringify([...currentKinds].sort())) {
      patch.service_kinds = serviceKinds;
    }
    await updateProfile(patch);
  };

  if (loading) {
    return <div className="loading">{t("common.loading")}</div>;
  }

  if (error) {
    return (
      <div className="error-state">
        <p className="error-text">{error}</p>
        <button className="btn-primary" onClick={() => fetchProfile()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="screen profile-screen">
      <header className="screen-header">
        <h1>{t("profile.title")}</h1>
        <button className="btn-back" onClick={() => navigate("home")}>
          {t("common.back")}
        </button>
      </header>

      {profile && (
        <div className="profile-info" data-testid="profile-info">
          <div className="info-row">
            <span className="label">{t("profile.status")}</span>
            <span className={`value status-${profile.status}`} data-testid="profile-status">
              {t(`profile.statuses.${profile.status}`)}
            </span>
          </div>
          <div className="info-row">
            <span className="label">{t("profile.verification_status")}</span>
            <span className="value" data-testid="profile-verification">
              {t(`profile.verification.${profile.verification_status}`)}
            </span>
          </div>
          <div className="info-row">
            <span className="label">{t("profile.availability")}</span>
            <span className="value" data-testid="profile-availability">
              {t(`profile.availability_${profile.declared_availability}`)}
            </span>
          </div>
          {profile.suspension_reason_code && (
            <div className="info-row" data-testid="profile-suspension">
              <span className="label">{t("profile.suspension_reason")}</span>
              <span className="value">{profile.suspension_reason_code}</span>
            </div>
          )}
        </div>
      )}

      <div className="profile-form" data-testid="profile-form">
        <label>
          <span>{t("profile.display_name")}</span>
          <input
            data-testid="form-display_name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label>
          <span>{t("profile.preferred_locale")}</span>
          <select
            data-testid="form-preferred_locale"
            value={preferredLocale}
            onChange={(e) => setPreferredLocale(e.target.value)}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
            <option value="ur">اردو</option>
          </select>
        </label>
        <label>
          <span>{t("profile.work_city_zone_id")}</span>
          <input
            data-testid="form-work_city_zone_id"
            type="text"
            value={workCityZoneId}
            onChange={(e) => setWorkCityZoneId(e.target.value)}
          />
        </label>
        <div className="service-kinds">
          <span>{t("profile.service_kinds")}</span>
          <div className="checkbox-group">
            {(["ride", "delivery"] as ServiceKind[]).map((kind) => (
              <label key={kind} className="checkbox-item" data-testid={`service-kind-${kind}`}>
                <input
                  data-testid={`service-kind-checkbox-${kind}`}
                  type="checkbox"
                  checked={serviceKinds.includes(kind)}
                  onChange={() => toggleServiceKind(kind)}
                />
                <span>{t(`profile.service_kind_${kind}`)}</span>
              </label>
            ))}
          </div>
        </div>

        {saveError && (
          <div className="save-error" data-testid="save-error">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="save-success" data-testid="save-success">
            {t("profile.save_success")}
          </div>
        )}

        <button
          className="btn-primary"
          data-testid="save-profile"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t("common.submitting") : t("common.save")}
        </button>
        <button className="btn-secondary" onClick={() => clearErrors()}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
