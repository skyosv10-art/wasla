import { useTranslation } from "react-i18next";

export function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className="screen dashboard-screen">
      <header className="screen-header">
        <h1>{t("dashboard.title")}</h1>
      </header>
      <div className="stats-grid">
        <div className="stat-card" data-testid="stat-active-users">
          <span className="stat-label">{t("dashboard.active_users")}</span>
          <span className="stat-value">—</span>
        </div>
        <div className="stat-card" data-testid="stat-available-drivers">
          <span className="stat-label">{t("dashboard.available_drivers")}</span>
          <span className="stat-value">—</span>
        </div>
        <div className="stat-card" data-testid="stat-today-orders">
          <span className="stat-label">{t("dashboard.today_orders")}</span>
          <span className="stat-value">—</span>
        </div>
        <div className="stat-card" data-testid="stat-revenue">
          <span className="stat-label">{t("dashboard.revenue")}</span>
          <span className="stat-value">—</span>
        </div>
      </div>
      <div className="alerts-section">
        <div className="alert-card" data-testid="alert-pending-documents">
          <span className="alert-label">{t("dashboard.pending_documents")}</span>
          <span className="alert-value">0</span>
        </div>
        <div className="alert-card" data-testid="alert-open-disputes">
          <span className="alert-label">{t("dashboard.open_disputes")}</span>
          <span className="alert-value">0</span>
        </div>
      </div>
    </div>
  );
}
