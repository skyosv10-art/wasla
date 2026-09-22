import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useDriversStore } from "../store/drivers";
import type { DriverSummary, DriverDocument } from "../types/drivers";

export function Drivers() {
  const { t } = useTranslation();
  const {
    drivers,
    selectedDriver,
    documents,
    loading,
    error,
    actionLoading,
    actionError,
    searchQuery,
    statusFilter,
    verificationFilter,
    fetchDrivers,
    fetchDriverDetail,
    fetchDocuments,
    reviewDocument,
    suspendDriver,
    reinstateDriver,
    setSearchQuery,
    setStatusFilter,
    setVerificationFilter,
    clearSelected,
    clearErrors,
  } = useDriversStore();

  const [suspendReason, setSuspendReason] = useState("");
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [rejectDocId, setRejectDocId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDrivers();
  };

  const handleViewDriver = (id: string) => {
    fetchDriverDetail(id);
    fetchDocuments(id);
  };

  const handleApproveDocument = async (driverId: string, docId: string) => {
    await reviewDocument(driverId, docId, "approved");
  };

  const handleRejectDocument = async (driverId: string, docId: string) => {
    await reviewDocument(driverId, docId, "rejected", rejectReason || "admin_rejection");
    setRejectDocId(null);
    setRejectReason("");
  };

  const handleSuspend = async (id: string) => {
    const success = await suspendDriver(id, suspendReason || "admin_action");
    if (success) {
      setShowSuspendDialog(false);
      setSuspendReason("");
      fetchDrivers();
    }
  };

  const handleReinstate = async (id: string) => {
    const success = await reinstateDriver(id);
    if (success) {
      fetchDrivers();
    }
  };

  if (loading && drivers.length === 0) {
    return (
      <div className="screen drivers-screen">
        <p className="loading-text" role="status">{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen drivers-screen">
        <p className="error-text" role="alert">{t("common.error")}: {error}</p>
        <button onClick={() => { clearErrors(); fetchDrivers(); }}>{t("common.retry")}</button>
      </div>
    );
  }

  if (selectedDriver) {
    return (
      <div className="screen drivers-screen">
        <header className="screen-header">
          <button className="back-btn" onClick={clearSelected}>← {t("common.back")}</button>
          <h1>{selectedDriver.display_name ?? selectedDriver.wasla_public_id}</h1>
        </header>
        <div className="detail-grid">
          <div className="detail-card" data-testid="detail-driver-public-id">
            <span className="detail-label">{t("drivers.public_id")}</span>
            <span className="detail-value">{selectedDriver.wasla_public_id}</span>
          </div>
          <div className="detail-card" data-testid="detail-driver-status">
            <span className="detail-label">{t("common.status")}</span>
            <span className="detail-value">{selectedDriver.status}</span>
          </div>
          <div className="detail-card" data-testid="detail-verification">
            <span className="detail-label">{t("drivers.verification_status")}</span>
            <span className="detail-value">{selectedDriver.verification_status}</span>
          </div>
          <div className="detail-card" data-testid="detail-availability">
            <span className="detail-label">{t("drivers.availability")}</span>
            <span className="detail-value">{selectedDriver.declared_availability}</span>
          </div>
          <div className="detail-card" data-testid="detail-zone">
            <span className="detail-label">{t("drivers.zone")}</span>
            <span className="detail-value">{selectedDriver.work_city_zone_id ?? "—"}</span>
          </div>
          <div className="detail-card" data-testid="detail-services">
            <span className="detail-label">{t("drivers.service_kinds")}</span>
            <span className="detail-value">{selectedDriver.service_kinds.join(", ")}</span>
          </div>
        </div>

        <section className="documents-section">
          <h2>{t("drivers.documents")}</h2>
          {documents.length === 0 ? (
            <p className="empty-text">{t("common.empty")}</p>
          ) : (
            <table className="data-table" data-testid="documents-table">
              <thead>
                <tr>
                  <th>{t("drivers.doc_type")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("drivers.expires_at")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc: DriverDocument) => (
                  <tr key={doc.id} data-testid={`doc-row-${doc.id}`}>
                    <td>{doc.document_type}</td>
                    <td>{doc.status}</td>
                    <td>{doc.expires_at ?? "—"}</td>
                    <td>
                      {doc.status === "pending" && (
                        <div className="action-buttons">
                          <button
                            className="btn-success btn-sm"
                            onClick={() => handleApproveDocument(selectedDriver.wasla_public_id, doc.id)}
                            disabled={actionLoading}
                            data-testid={`btn-approve-${doc.id}`}
                          >
                            {t("drivers.approve")}
                          </button>
                          <button
                            className="btn-danger btn-sm"
                            onClick={() => setRejectDocId(doc.id)}
                            disabled={actionLoading}
                            data-testid={`btn-reject-${doc.id}`}
                          >
                            {t("drivers.reject")}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {rejectDocId && (
          <div className="dialog-overlay" data-testid="reject-dialog">
            <div className="dialog">
              <h2>{t("drivers.reject_document")}</h2>
              <input
                type="text"
                placeholder={t("drivers.reason_code")}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                data-testid="input-reject-reason"
              />
              <div className="dialog-actions">
                <button onClick={() => { setRejectDocId(null); setRejectReason(""); }}>
                  {t("common.cancel")}
                </button>
                <button
                  className="btn-danger"
                  onClick={() => handleRejectDocument(selectedDriver.wasla_public_id, rejectDocId)}
                  disabled={actionLoading}
                  data-testid="btn-confirm-reject"
                >
                  {t("common.submit")}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedDriver.status === "active" ? (
          <div className="action-bar">
            <button
              className="btn-danger"
              onClick={() => setShowSuspendDialog(true)}
              data-testid="btn-suspend-driver"
              disabled={actionLoading}
            >
              {t("drivers.suspend")}
            </button>
          </div>
        ) : (
          <div className="action-bar">
            <button
              className="btn-success"
              onClick={() => handleReinstate(selectedDriver.wasla_public_id)}
              data-testid="btn-reinstate-driver"
              disabled={actionLoading}
            >
              {t("drivers.reinstate")}
            </button>
          </div>
        )}

        {showSuspendDialog && (
          <div className="dialog-overlay" data-testid="suspend-driver-dialog">
            <div className="dialog">
              <h2>{t("drivers.suspend")}</h2>
              <input
                type="text"
                placeholder={t("drivers.reason_code")}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                data-testid="input-suspend-driver-reason"
              />
              <div className="dialog-actions">
                <button onClick={() => setShowSuspendDialog(false)}>{t("common.cancel")}</button>
                <button
                  className="btn-danger"
                  onClick={() => handleSuspend(selectedDriver.wasla_public_id)}
                  disabled={actionLoading}
                  data-testid="btn-confirm-suspend-driver"
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
    <div className="screen drivers-screen">
      <header className="screen-header">
        <h1>{t("drivers.title")}</h1>
      </header>

      <form className="filter-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder={t("common.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="input-driver-search"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="select-driver-status"
        >
          <option value="all">{t("common.all")}</option>
          <option value="active">{t("drivers.status_active")}</option>
          <option value="suspended">{t("drivers.status_suspended")}</option>
        </select>
        <select
          value={verificationFilter}
          onChange={(e) => setVerificationFilter(e.target.value)}
          data-testid="select-verification"
        >
          <option value="all">{t("common.all")}</option>
          <option value="unverified">{t("drivers.verif_unverified")}</option>
          <option value="pending_review">{t("drivers.verif_pending")}</option>
          <option value="verified">{t("drivers.verif_verified")}</option>
          <option value="rejected">{t("drivers.verif_rejected")}</option>
        </select>
        <button type="submit" data-testid="btn-driver-search">{t("common.search")}</button>
      </form>

      {drivers.length === 0 ? (
        <p className="empty-text">{t("common.empty")}</p>
      ) : (
        <table className="data-table" data-testid="drivers-table">
          <thead>
            <tr>
              <th>{t("drivers.public_id")}</th>
              <th>{t("drivers.display_name")}</th>
              <th>{t("common.status")}</th>
              <th>{t("drivers.verification_status")}</th>
              <th>{t("drivers.availability")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver: DriverSummary) => (
              <tr key={driver.wasla_public_id} data-testid={`driver-row-${driver.wasla_public_id}`}>
                <td>{driver.wasla_public_id}</td>
                <td>{driver.display_name ?? "—"}</td>
                <td>{driver.status}</td>
                <td>{driver.verification_status}</td>
                <td>{driver.declared_availability}</td>
                <td>
                  <button onClick={() => handleViewDriver(driver.wasla_public_id)}>
                    {t("drivers.view")}
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
