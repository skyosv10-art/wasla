import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
import { retrySession } from "./session/session-init";
import { OfflineBanner } from "./components/OfflineBanner";
import { Home } from "./screens/Home";
import { RideOrder } from "./screens/RideOrder";
import { DeliveryOrder } from "./screens/DeliveryOrder";
import { SavedPlaces } from "./screens/SavedPlaces";
import { Marketplace } from "./screens/Marketplace";
import { Search } from "./screens/Search";
import { MyOrders } from "./screens/MyOrders";
import { Reputation } from "./screens/Reputation";
import { Profile } from "./screens/Profile";

// ADR-044 Decision 2: Hash-based routing (no router framework).
// Telegram WebView does not support history API reliably.

type Route =
  | "home"
  | "ride"
  | "delivery"
  | "places"
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
    "places",
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
  const { isAuthenticated, initStatus, initError } = useSessionStore();

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ADR-044 Decision 4: Session token in memory only. Unauthenticated users
  // see a loading state until the session is initialized from Telegram initData.
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
      {route === "ride" && <RideOrder />}
      {route === "delivery" && <DeliveryOrder />}
      {route === "places" && <SavedPlaces />}
      {route === "marketplace" && <Marketplace />}
      {route === "search" && <Search />}
      {route === "orders" && <MyOrders />}
      {route === "reputation" && <Reputation />}
      {route === "profile" && <Profile />}
    </div>
    </>
  );
}
