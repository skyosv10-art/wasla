import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
import { Dashboard } from "./screens/Dashboard";
import { Users } from "./screens/Users";
import { Drivers } from "./screens/Drivers";

type Route = "dashboard" | "users" | "drivers" | "orders" | "audit";

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const valid: Route[] = ["dashboard", "users", "drivers", "orders", "audit"];
  return valid.includes(hash as Route) ? (hash as Route) : "dashboard";
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
      <nav className="sidebar">
        <a href="#/dashboard" data-testid="nav-dashboard">{t("nav.dashboard")}</a>
        <a href="#/users" data-testid="nav-users">{t("nav.users")}</a>
        <a href="#/drivers" data-testid="nav-drivers">{t("nav.drivers")}</a>
        <a href="#/orders" data-testid="nav-orders">{t("nav.orders")}</a>
        <a href="#/audit" data-testid="nav-audit">{t("nav.audit")}</a>
      </nav>
      <main className="content">
        {route === "dashboard" && <Dashboard />}
        {route === "users" && <Users />}
        {route === "drivers" && <Drivers />}
        {route === "orders" && <div className="placeholder">{t("nav.orders")}</div>}
        {route === "audit" && <div className="placeholder">{t("nav.audit")}</div>}
      </main>
    </div>
  );
}
