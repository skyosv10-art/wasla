/**
 * Audit Log screen.
 *
 * List audit events with filtering by date, actor, action, resource type.
 * Audit service is planned for services/audit/ — frontend built ahead.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuditStore } from "../store/audit";
import { AUDIT_ACTIONS, RESOURCE_TYPES } from "../types/audit";

export function AuditLog() {
  const { t } = useTranslation();
  const { events, total, loading, error, filters, fetchEvents, setFilter, clearFilters } =
    useAuditStore();

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleFilterChange = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEvents({ offset: 0 });
  };

  return (
    <div className="screen">
      <h2>{t("admin.audit.title", "Audit Log")}</h2>

      <form className="filter-bar" onSubmit={handleFilterChange}>
        <input
          type="date"
          value={filters.from_date || ""}
          onChange={(e) => setFilter("from_date", e.target.value || undefined)}
          placeholder={t("admin.audit.fromDate", "From Date")}
          aria-label={t("admin.audit.fromDate", "From Date")}
        />
        <input
          type="date"
          value={filters.to_date || ""}
          onChange={(e) => setFilter("to_date", e.target.value || undefined)}
          placeholder={t("admin.audit.toDate", "To Date")}
          aria-label={t("admin.audit.toDate", "To Date")}
        />
        <input
          type="text"
          value={filters.actor_id || ""}
          onChange={(e) => setFilter("actor_id", e.target.value || undefined)}
          placeholder={t("admin.audit.actorId", "Actor ID")}
          aria-label={t("admin.audit.actorId", "Actor ID")}
          className="search-input"
        />
        <select
          value={filters.action || ""}
          onChange={(e) =>
            setFilter("action", (e.target.value || undefined) as never)
          }
          aria-label={t("admin.audit.action", "Action")}
        >
          <option value="">{t("admin.audit.allActions", "All Actions")}</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {t(`admin.audit.actions.${action}`, action)}
            </option>
          ))}
        </select>
        <select
          value={filters.resource_type || ""}
          onChange={(e) =>
            setFilter("resource_type", (e.target.value || undefined) as never)
          }
          aria-label={t("admin.audit.resourceType", "Resource Type")}
        >
          <option value="">
            {t("admin.audit.allResourceTypes", "All Types")}
          </option>
          {RESOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`admin.audit.resourceTypes.${type}`, type)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {t("common.filter", "Filter")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            clearFilters();
            fetchEvents({ offset: 0 });
          }}
        >
          {t("common.clear", "Clear")}
        </button>
      </form>

      {error && (
        <p className="error">
          {t("common.error")}: {error}
        </p>
      )}

      {loading && <p className="loading">{t("common.loading")}</p>}

      {!loading && events.length > 0 && (
        <>
          <p className="result-count">
            {t("admin.audit.total", "Total")}: {total}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t("admin.audit.actor", "Actor")}</th>
                <th>{t("admin.audit.role", "Role")}</th>
                <th>{t("admin.audit.action", "Action")}</th>
                <th>{t("admin.audit.resourceType", "Resource")}</th>
                <th>{t("admin.audit.resourceId", "Resource ID")}</th>
                <th>{t("admin.audit.timestamp", "Timestamp")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.id}</td>
                  <td>{event.actor_id}</td>
                  <td>
                    <span className={`status-badge status-${event.actor_role}`}>
                      {event.actor_role}
                    </span>
                  </td>
                  <td>
                    {t(`admin.audit.actions.${event.action}`, event.action)}
                  </td>
                  <td>
                    {t(`admin.audit.resourceTypes.${event.resource_type}`, event.resource_type)}
                  </td>
                  <td>{event.resource_id}</td>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!loading && events.length === 0 && !error && (
        <p className="empty-state">
          {t("admin.audit.empty", "No audit events found")}
        </p>
      )}
    </div>
  );
}
