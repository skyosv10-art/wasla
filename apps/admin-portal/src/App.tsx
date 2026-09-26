import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "./store/session";
import { OfflineBanner } from "./components/OfflineBanner";
import { Dashboard } from "./screens/Dashboard";
import { Users } from "./screens/Users";
import { Drivers } from "./screens/Drivers";
import { Orders } from "./screens/Orders";
import { AuditLog } from "./screens/AuditLog";
import { Partners } from "./screens/Partners";
import { Moderation } from "./screens/Moderation";
import { Support } from "./screens/Support";

type Route = "dashboard" | "users" | "drivers" | "orders" | "audit" | "partners" | "moderation" | "support";

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const valid: Route[] = ["dashboard", "users", "drivers", "orders", "audit", "partners", "moderation", "support"];
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
      <nav className="sidebar">
        <a href="#/dashboard" data-testid="nav-dashboard">{t("nav.dashboard")}</a>
        <a href="#/users" data-testid="nav-users">{t("nav.users")}</a>
        <a href="#/drivers" data-testid="nav-drivers">{t("nav.drivers")}</a>
        <a href="#/orders" data-testid="nav-orders">{t("nav.orders")}</a>
        <a href="#/audit" data-testid="nav-audit">{t("nav.audit")}</a>
        <a href="#/partners" data-testid="nav-partners">{t("nav.partners")}</a>
        <a href="#/moderation" data-testid="nav-moderation">{t("nav.moderation")}</a>
        <a href="#/support" data-testid="nav-support">{t("nav.support")}</a>
      </nav>
      <main className="content">
        {route === "dashboard" && <Dashboard />}
        {route === "users" && <Users />}
        {route === "drivers" && <Drivers />}
        {route === "orders" && <Orders />}
        {route === "audit" && <AuditLog />}
        {route === "partners" && <Partners />}
        {route === "moderation" && <Moderation />}
        {route === "support" && <Support />}
      </main>
    </div>
    </>
  );
}
