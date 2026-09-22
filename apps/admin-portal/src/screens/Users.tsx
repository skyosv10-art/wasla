import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUsersStore } from "../store/users";
import type { UserSummary } from "../types/users";

export function Users() {
  const { t } = useTranslation();
  const {
    users,
    selectedUser,
    loading,
    error,
    actionLoading,
    actionError,
    searchQuery,
    statusFilter,
    fetchUsers,
    fetchUserDetail,
    suspendUser,
    reinstateUser,
    setSearchQuery,
    setStatusFilter,
    clearSelected,
    clearErrors,
  } = useUsersStore();

  const [suspendReason, setSuspendReason] = useState("");
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers();
  };

  const handleViewUser = (id: string) => {
    fetchUserDetail(id);
  };

  const handleSuspend = async (id: string) => {
    const success = await suspendUser(id, suspendReason || "admin_action");
    if (success) {
      setShowSuspendDialog(false);
      setSuspendReason("");
      fetchUsers();
    }
  };

  const handleReinstate = async (id: string) => {
    const success = await reinstateUser(id);
    if (success) {
      fetchUsers();
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="screen users-screen">
        <p className="loading-text">{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen users-screen">
        <p className="error-text">{t("common.error")}: {error}</p>
        <button onClick={() => { clearErrors(); fetchUsers(); }}>{t("common.retry")}</button>
      </div>
    );
  }

  if (selectedUser) {
    return (
      <div className="screen users-screen">
        <header className="screen-header">
          <button className="back-btn" onClick={clearSelected}>← {t("common.back")}</button>
          <h1>{selectedUser.display_name ?? selectedUser.wasla_public_id}</h1>
        </header>
        <div className="detail-grid">
          <div className="detail-card" data-testid="detail-public-id">
            <span className="detail-label">{t("users.public_id")}</span>
            <span className="detail-value">{selectedUser.wasla_public_id}</span>
          </div>
          <div className="detail-card" data-testid="detail-status">
            <span className="detail-label">{t("common.status")}</span>
            <span className="detail-value">{selectedUser.status}</span>
          </div>
          <div className="detail-card" data-testid="detail-orders">
            <span className="detail-label">{t("users.order_count")}</span>
            <span className="detail-value">{selectedUser.order_count}</span>
          </div>
          <div className="detail-card" data-testid="detail-locale">
            <span className="detail-label">{t("users.preferred_locale")}</span>
            <span className="detail-value">{selectedUser.preferred_locale}</span>
          </div>
          <div className="detail-card" data-testid="detail-created">
            <span className="detail-label">{t("common.created_at")}</span>
            <span className="detail-value">{selectedUser.created_at}</span>
          </div>
        </div>

        {selectedUser.status === "active" ? (
          <div className="action-bar">
            <button
              className="btn-danger"
              onClick={() => setShowSuspendDialog(true)}
              data-testid="btn-suspend"
              disabled={actionLoading}
            >
              {t("users.suspend")}
            </button>
          </div>
        ) : (
          <div className="action-bar">
            <button
              className="btn-success"
              onClick={() => handleReinstate(selectedUser.wasla_public_id)}
              data-testid="btn-reinstate"
              disabled={actionLoading}
            >
              {t("users.reinstate")}
            </button>
          </div>
        )}

        {showSuspendDialog && (
          <div className="dialog-overlay" data-testid="suspend-dialog">
            <div className="dialog">
              <h2>{t("users.suspend")}</h2>
              <input
                type="text"
                placeholder={t("users.reason_code")}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                data-testid="input-suspend-reason"
              />
              <div className="dialog-actions">
                <button onClick={() => setShowSuspendDialog(false)}>{t("common.cancel")}</button>
                <button
                  className="btn-danger"
                  onClick={() => handleSuspend(selectedUser.wasla_public_id)}
                  disabled={actionLoading}
                  data-testid="btn-confirm-suspend"
                >
                  {t("common.submit")}
                </button>
              </div>
            </div>
          </div>
        )}

        {actionError && <p className="error-text">{actionError}</p>}
      </div>
    );
  }

  return (
    <div className="screen users-screen">
      <header className="screen-header">
        <h1>{t("users.title")}</h1>
      </header>

      <form className="filter-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder={t("common.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="input-search"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="select-status"
        >
          <option value="all">{t("common.all")}</option>
          <option value="active">{t("users.status_active")}</option>
          <option value="suspended">{t("users.status_suspended")}</option>
        </select>
        <button type="submit" data-testid="btn-search">{t("common.search")}</button>
      </form>

      {users.length === 0 ? (
        <p className="empty-text">{t("common.empty")}</p>
      ) : (
        <table className="data-table" data-testid="users-table">
          <thead>
            <tr>
              <th>{t("users.public_id")}</th>
              <th>{t("users.display_name")}</th>
              <th>{t("common.status")}</th>
              <th>{t("users.order_count")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user: UserSummary) => (
              <tr key={user.wasla_public_id} data-testid={`user-row-${user.wasla_public_id}`}>
                <td>{user.wasla_public_id}</td>
                <td>{user.display_name ?? "—"}</td>
                <td>{user.status}</td>
                <td>{user.order_count}</td>
                <td>
                  <button onClick={() => handleViewUser(user.wasla_public_id)}>
                    {t("users.view")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
