import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

interface Profile {
  display_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  preferred_language?: string | null;
}

export function Profile() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const loadedRef = useRef(false);

  const loadProfile = useCallback(async () => {
    if (!token || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<Profile>(`/customers/${customerId}/profile`);
      setProfile(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadProfile();
  }, [loadProfile]);

  const handleSave = useCallback(async () => {
    if (!token || !customerId) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await apiClient.put(`/customers/${customerId}/profile`, profile);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }, [token, customerId, profile]);

  const handleFieldChange = useCallback((field: keyof Profile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value || null }));
    setSuccess(false);
  }, []);

  if (loading) {
    return (
      <div className="screen profile-screen">
        <h1>{t("profile.title")}</h1>
        <div className="loading-indicator" data-testid="profile-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="screen profile-screen">
      <h1>{t("profile.title")}</h1>

      {error && (
        <div className="error-message" role="alert" data-testid="profile-error">
          {t(`errors.${error}`)}
        </div>
      )}

      {success && (
        <div className="success-message" data-testid="profile-saved">
          {t("profile.saved")}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="display-name">{t("profile.display_name")}</label>
        <input
          id="display-name"
          type="text"
          value={profile.display_name || ""}
          onChange={(e) => handleFieldChange("display_name", e.target.value)}
          placeholder={t("profile.display_name_placeholder")}
          data-testid="display-name-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="phone-number">{t("profile.phone_number")}</label>
        <input
          id="phone-number"
          type="tel"
          value={profile.phone_number || ""}
          onChange={(e) => handleFieldChange("phone_number", e.target.value)}
          placeholder="+966..."
          data-testid="phone-number-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="email">{t("profile.email")}</label>
        <input
          id="email"
          type="email"
          value={profile.email || ""}
          onChange={(e) => handleFieldChange("email", e.target.value)}
          placeholder="email@example.com"
          data-testid="email-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="preferred-language">{t("profile.preferred_language")}</label>
        <select
          id="preferred-language"
          value={profile.preferred_language || ""}
          onChange={(e) => handleFieldChange("preferred_language", e.target.value)}
          data-testid="preferred-language-select"
        >
          <option value="">{t("profile.language_none")}</option>
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="ur">اردو</option>
        </select>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !token || !customerId}
        data-testid="save-profile-button"
      >
        {saving ? t("common.loading") : t("profile.save_button")}
      </button>
    </div>
  );
}
