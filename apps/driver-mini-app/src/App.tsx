import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
import { retrySession } from "./session/session-init";
import { OfflineBanner } from "./components/OfflineBanner";
import { Home } from "./screens/Home";
import { Offers } from "./screens/Offers";
import { JobDetail } from "./screens/JobDetail";
import { Vehicles } from "./screens/Vehicles";
import { Zones } from "./screens/Zones";
import { Documents } from "./screens/Documents";
import { Profile } from "./screens/Profile";
import { Earnings } from "./screens/Earnings";

// ADR-045 Decision 2 (reuses ADR-044): Hash-based routing (no router framework).
// Telegram WebView does not support history API reliably.

type Route =
  | "home"
  | "offers"
  | "job"
  | "earnings"
  | "vehicles"
  | "zones"
  | "documents"
  | "profile";

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  // Strip query string (e.g., #offers?job_id=xxx → offers)
  const route = hash.split("?")[0];
  const validRoutes: Route[] = [
    "home",
    "offers",
    "job",
    "earnings",
    "vehicles",
    "zones",
    "documents",
    "profile",
  ];
  return validRoutes.includes(route as Route) ? (route as Route) : "home";
}

export function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<Route>(parseHash());
  const { isAuthenticated, initStatus, initError } = useSessionStore();

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // G-S8 (CLM-0610): a failed init is shown with a retry — never an endless
  // loading screen. Loading is shown only while an init is (or may be) running.
  if (!isAuthenticated() && initStatus === "failed") {
    return (
      <>
        <OfflineBanner />
        <div className="app-session-failed" role="alert">
          <p data-testid="session-error">{t(`session.${initError ?? "edge_rejected"}`)}</p>
          <button type="button" data-testid="session-retry" onClick={() => void retrySession()}>
            {t("common.retry")}
          </button>
        </div>
      </>
    );
  }

  if (!isAuthenticated()) {
    return (
      <>
        <OfflineBanner />
        <div className="app-loading">
          <p>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      <div className="app">
      {route === "home" && <Home />}
      {route === "offers" && <Offers />}
      {route === "job" && <JobDetail />}
      {route === "earnings" && <Earnings />}
      {route === "vehicles" && <Vehicles />}
      {route === "zones" && <Zones />}
      {route === "documents" && <Documents />}
      {route === "profile" && <Profile />}
    </div>
    </>
  );
}
