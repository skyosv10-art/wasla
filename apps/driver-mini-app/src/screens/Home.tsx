import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useProfileStore } from "../store/profile";

/**
 * Driver Home (DRIVER_MINI_APP_SPEC §4.2).
 *
 * G-S10 (CLM-0613): availability toggle (`PUT /drivers/:id/availability`) and the
 * eligibility verdict (`GET /drivers/:id/eligibility`) with the ineligible path —
 * every reason plus a link to Documents (§7 L269).
 *
 * The toggle is `available` ↔ `offline`, not `available` ↔ `busy` as DMS §4.2 L77
 * words it: the approved contract (`DRIVER_DECLARED_AVAILABILITY` in
 * packages/contracts/driver) lets the driver declare only those two, and the route
 * refuses `busy` with 400 — `busy` is set by the system while a job is running.
 * Measured and recorded in the CLM-0613 evidence; the code follows the contract.
 */
export function Home() {
  const { t } = useTranslation();
  const {
    profile,
    fetchProfile,
    eligibility,
    eligibilityLoading,
    eligibilityError,
    fetchEligibility,
    availabilityUpdating,
    availabilityError,
    setAvailability,
  } = useProfileStore();

  useEffect(() => {
    void fetchProfile();
    void fetchEligibility();
  }, [fetchProfile, fetchEligibility]);

  const navItems = [
    { key: "activeJobs", href: "#/offers", icon: "📋" },
    { key: "earnings", href: "#/earnings", icon: "📊" },
    { key: "vehicles", href: "#/vehicles", icon: "🚗" },
    { key: "zones", href: "#/zones", icon: "📍" },
    { key: "documents", href: "#/documents", icon: "📄" },
    { key: "profile", href: "#/profile", icon: "👤" },
  ] as const;

  const declared = profile?.declared_availability ?? null;
  const isAvailable = declared === "available";
  const blocked =
    eligibility !== null &&
    (eligibility.eligibility_state === "ineligible" || eligibility.eligibility_state === "suspended");

  return (
    <div className="home">
      <h1>{t("appName")}</h1>

      <section className="home-availability" aria-labelledby="home-availability-title">
        <h2 id="home-availability-title">{t("home.availability_title")}</h2>
        <p data-testid="home-availability-state">
          {declared === null ? t("common.loading") : t(`home.availability_${declared}`)}
        </p>
        <button
          type="button"
          data-testid="home-availability-toggle"
          aria-pressed={isAvailable}
          disabled={declared === null || availabilityUpdating}
          onClick={() => void setAvailability(isAvailable ? "offline" : "available")}
        >
          {isAvailable ? t("home.go_offline") : t("home.go_available")}
        </button>
        {availabilityError && (
          <p role="alert" data-testid="home-availability-error">
            {t("home.availability_error")}
          </p>
        )}
      </section>

      <section className="home-eligibility" aria-labelledby="home-eligibility-title">
        <h2 id="home-eligibility-title">{t("home.eligibility_title")}</h2>
        {eligibilityError ? (
          <div role="alert" data-testid="home-eligibility-error">
            <p>{t("home.eligibility_error")}</p>
            <button type="button" data-testid="home-eligibility-retry" onClick={() => void fetchEligibility()}>
              {t("common.retry")}
            </button>
          </div>
        ) : eligibility === null || eligibilityLoading ? (
          <p data-testid="home-eligibility-loading">{t("common.loading")}</p>
        ) : blocked ? (
          <div role="alert" data-testid="home-eligibility-blocked">
            <p data-testid="home-eligibility-state">{t(`home.eligibility_${eligibility.eligibility_state}`)}</p>
            <ul data-testid="home-eligibility-reasons">
              {eligibility.reason_codes.map((code) => (
                <li key={code} data-reason={code}>
                  {t(`home.reason.${code}`)}
                </li>
              ))}
            </ul>
            <a href="#/documents" data-testid="home-eligibility-documents">
              {t("home.eligibility_fix_documents")}
            </a>
          </div>
        ) : (
          <p data-testid="home-eligibility-state">{t(`home.eligibility_${eligibility.eligibility_state}`)}</p>
        )}
      </section>

      <nav>
        <ul>
          {navItems.map((item) => (
            <li key={item.key}>
              <a href={item.href} aria-label={t(`home.${item.key}`)}>
                <span aria-hidden="true">{item.icon}</span>
                {t(`home.${item.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
