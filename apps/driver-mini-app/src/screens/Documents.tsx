import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentsStore } from "../store/documents";
import { useSessionStore } from "../store/session";
import { navigate } from "../router";
import type { DocumentType } from "../types/documents";

const DOCUMENT_TYPE_OPTIONS: DocumentType[] = [
  "national_id",
  "driving_license",
  "vehicle_registration",
  "vehicle_insurance",
  "vehicle_photo",
];

export function Documents() {
  const { t } = useTranslation();
  const { isAuthenticated } = useSessionStore();
  const authenticated = isAuthenticated();
  const {
    documents,
    loading,
    error,
    actionLoading,
    actionError,
    fetchDocuments,
    submitDocument,
    clearErrors,
  } = useDocumentsStore();

  const [showForm, setShowForm] = useState(false);
  const [docType, setDocType] = useState<DocumentType>("national_id");
  const [storageRef, setStorageRef] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (authenticated) {
      fetchDocuments();
    }
  }, [authenticated, fetchDocuments]);

  const handleSubmit = async () => {
    const success = await submitDocument({
      document_type: docType,
      storage_ref: storageRef,
      vehicle_id: vehicleId || null,
      issued_at: issuedAt || null,
      expires_at: expiresAt || null,
    });
    if (success) {
      setShowForm(false);
      setStorageRef("");
      setVehicleId("");
      setIssuedAt("");
      setExpiresAt("");
    }
  };

  if (loading) {
    return <div className="loading">{t("common.loading")}</div>;
  }

  if (error) {
    return (
      <div className="error-state">
        <p className="error-text">{error}</p>
        <button className="btn-primary" onClick={() => fetchDocuments()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="screen documents-screen">
      <header className="screen-header">
        <h1>{t("documents.title")}</h1>
        <button className="btn-back" onClick={() => navigate("home")}>
          {t("common.back")}
        </button>
      </header>

      {documents.length === 0 && !showForm && (
        <div className="empty-state">
          <p>{t("common.empty")}</p>
        </div>
      )}

      <div className="document-list">
        {documents.map((doc) => (
          <div key={doc.id} className="document-card" data-testid={`document-${doc.id}`}>
            <div className="document-header">
              <span className="document-type">{t(`documents.types.${doc.document_type}`)}</span>
              <span className={`document-status status-${doc.status}`} data-testid={`doc-status-${doc.id}`}>
                {t(`documents.status.${doc.status}`)}
              </span>
            </div>
            {doc.rejection_reason_code && (
              <p className="document-rejection" data-testid={`doc-rejection-${doc.id}`}>
                {t(`documents.rejection.${doc.rejection_reason_code}`)}
              </p>
            )}
            {doc.expires_at && (
              <p className="document-expiry">
                {t("documents.expires_at")}: {doc.expires_at}
              </p>
            )}
            {doc.issued_at && (
              <p className="document-issued">
                {t("documents.issued_at")}: {doc.issued_at}
              </p>
            )}
          </div>
        ))}
      </div>

      {actionError && (
        <div className="action-error" data-testid="action-error">
          {actionError}
        </div>
      )}

      {showForm ? (
        <div className="document-form" data-testid="document-form">
          <label>
            <span>{t("documents.document_type")}</span>
            <select
              data-testid="form-document_type"
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
            >
              {DOCUMENT_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {t(`documents.types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("documents.storage_ref")}</span>
            <input
              data-testid="form-storage_ref"
              type="text"
              value={storageRef}
              onChange={(e) => setStorageRef(e.target.value)}
              placeholder={t("documents.storage_ref_placeholder")}
            />
          </label>
          <label>
            <span>{t("documents.vehicle_id")}</span>
            <input
              data-testid="form-vehicle_id"
              type="text"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            />
          </label>
          <label>
            <span>{t("documents.issued_at")}</span>
            <input
              data-testid="form-issued_at"
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </label>
          <label>
            <span>{t("documents.expires_at")}</span>
            <input
              data-testid="form-expires_at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            data-testid="submit-document"
            onClick={handleSubmit}
            disabled={actionLoading || !storageRef}
          >
            {actionLoading ? t("common.submitting") : t("common.submit")}
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setShowForm(false);
              clearErrors();
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          className="btn-primary"
          data-testid="add-document-btn"
          onClick={() => setShowForm(true)}
        >
          {t("documents.add")}
        </button>
      )}
    </div>
  );
}
