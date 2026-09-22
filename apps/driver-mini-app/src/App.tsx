import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
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
  const { isAuthenticated } = useSessionStore();

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!isAuthenticated()) {
    return (
      <div className="app-loading">
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  return (
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
  );
}
