import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
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
  const { isAuthenticated } = useSessionStore();

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ADR-044 Decision 4: Session token in memory only. Unauthenticated users
  // see a loading state until the session is initialized from Telegram initData.
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
