import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
import { Home } from "./screens/Home";

// ADR-044 Decision 2: Hash-based routing (no router framework).
// Telegram WebView does not support history API reliably.

type Route =
  | "home"
  | "ride"
  | "delivery"
  | "marketplace"
  | "search"
  | "orders"
  | "reputation"
  | "profile";

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const validRoutes: Route[] = [
    "home",
    "ride",
    "delivery",
    "marketplace",
    "search",
    "orders",
    "reputation",
    "profile",
  ];
  return validRoutes.includes(hash as Route) ? (hash as Route) : "home";
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

  // ADR-044: All routes show Home for now (placeholder).
  // Screen implementations come in later waves.
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
      {route !== "home" && (
        <div className="placeholder">
          <Home />
        </div>
      )}
    </div>
  );
}
