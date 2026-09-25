/**
 * Partners screen — manage partner lifecycle, credentials, usage, and audit.
 *
 * M5-15: Admin Operations full — privileged workflow for partner management.
 * Calls the partners service via the admin API gateway.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePartnersStore } from "../store/partners";
import { useSessionStore } from "../store/session";

export function Partners() {
  const { t } = useTranslation();
  const { role } = useSessionStore();
  const {
    lifecycles,
    credentials,
    usage,
    auditEntries,
    loading,
    error,
    selectedStoreId,
    fetchLifecycles,
    fetchCredentials,
    fetchUsage,
    fetchAudit,
    suspendTenant,
    reinstateTenant,
    issueCredential,
    revokeCredential,
    setSelectedStoreId,
    clearError,
  } = usePartnersStore();

  const [storeIdInput, setStoreIdInput] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const isAdmin = role === "admin";

  useEffect(() => {
    if (selectedStoreId) {
      fetchLifecycles(selectedStoreId);
      fetchCredentials(selectedStoreId);
      fetchUsage(selectedStoreId);
      fetchAudit(selectedStoreId);
    }
  }, [selectedStoreId, fetchLifecycles, fetchCredentials, fetchUsage, fetchAudit]);

  const handleSearch = () => {
    if (storeIdInput.trim()) {
      setSelectedStoreId(storeIdInput.trim());
      clearError();
    }
  };

  const handleSuspend = async () => {
    if (!selectedStoreId || !suspendReason.trim()) return;
    await suspendTenant(selectedStoreId, suspendReason);
    setShowSuspendDialog(false);
    setSuspendReason("");
  };

  const handleReinstate = async () => {
    if (!selectedStoreId) return;
    await reinstateTenant(selectedStoreId);
  };

  const handleIssueCredential = async () => {
    if (!selectedStoreId) return;
    try {
      const result = await issueCredential(selectedStoreId, ["partners:read"]);
      setIssuedKey(result.plaintextKey);
    } catch {
      // error is set in store
    }
  };

  const handleRevoke = async (credentialId: string) => {
    if (!selectedStoreId) return;
    await revokeCredential(selectedStoreId, credentialId);
  };

  if (!isAdmin) {
    return (
      <div className="screen">
        <h2>{t("partners.title")}</h2>
        <p className="error-message">{t("partners.accessDenied")}</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <h2>{t("partners.title")}</h2>

      {error && (
        <div className="error-message" role="alert">
          {error}
          <button onClick={clearError} aria-label={t("common.dismiss")}>×</button>
        </div>
      )}

      {issuedKey && (
        <div className="success-message" role="status">
          <p>{t("partners.issuedKeyWarning")}</p>
          <code data-testid="issued-key">{issuedKey}</code>
          <button onClick={() => setIssuedKey(null)}>{t("common.dismiss")}</button>
        </div>
      )}

      <div className="search-bar">
        <input
          type="text"
          value={storeIdInput}
          onChange={(e) => setStoreIdInput(e.target.value)}
          placeholder={t("partners.storeIdPlaceholder")}
          data-testid="partner-store-id-input"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button onClick={handleSearch} data-testid="partner-search-btn">
          {t("common.search")}
        </button>
      </div>

      {loading && <p className="loading">{t("common.loading")}</p>}

      {selectedStoreId && !loading && (
        <div className="partner-details">
          {/* Lifecycle Section */}
          <section className="card">
            <h3>{t("partners.lifecycle")}</h3>
            {lifecycles.length > 0 ? (
              <div className="lifecycle-info">
                <table>
                  <tbody>
                    <tr>
                      <td>{t("partners.state")}</td>
                      <td data-testid="partner-state">{lifecycles[0].state}</td>
                    </tr>
                    <tr>
                      <td>{t("partners.slaTier")}</td>
                      <td>{lifecycles[0].slaTier}</td>
                    </tr>
                    {lifecycles[0].suspendedAt && (
                      <tr>
                        <td>{t("partners.suspendedAt")}</td>
                        <td>{new Date(lifecycles[0].suspendedAt).toLocaleString()}</td>
                      </tr>
                    )}
                    {lifecycles[0].offboardedAt && (
                      <tr>
                        <td>{t("partners.offboardedAt")}</td>
                        <td>{new Date(lifecycles[0].offboardedAt).toLocaleString()}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="actions">
                  {lifecycles[0].state === "suspended" ? (
                    <button
                      onClick={handleReinstate}
                      data-testid="partner-reinstate-btn"
                    >
                      {t("partners.reinstate")}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowSuspendDialog(true)}
                      data-testid="partner-suspend-btn"
                    >
                      {t("partners.suspend")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="empty-state">{t("partners.noLifecycle")}</p>
            )}
          </section>

          {/* Suspend Dialog */}
          {showSuspendDialog && (
            <div className="dialog-overlay" role="dialog" aria-modal="true">
              <div className="dialog">
                <h3>{t("partners.suspendTitle")}</h3>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder={t("partners.suspendReasonPlaceholder")}
                  data-testid="suspend-reason-input"
                  rows={3}
                />
                <div className="dialog-actions">
                  <button onClick={() => setShowSuspendDialog(false)}>
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={handleSuspend}
                    disabled={!suspendReason.trim()}
                    data-testid="confirm-suspend-btn"
                  >
                    {t("partners.confirmSuspend")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Credentials Section */}
          <section className="card">
            <h3>{t("partners.credentials")}</h3>
            <button onClick={handleIssueCredential} data-testid="issue-credential-btn">
              {t("partners.issueCredential")}
            </button>
            {credentials.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("partners.keyPrefix")}</th>
                    <th>{t("partners.scopes")}</th>
                    <th>{t("partners.state")}</th>
                    <th>{t("partners.createdAt")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((cred) => (
                    <tr key={cred.id}>
                      <td>{cred.keyPrefix}</td>
                      <td>{cred.scopes.join(", ")}</td>
                      <td>{cred.state}</td>
                      <td>{new Date(cred.createdAt).toLocaleString()}</td>
                      <td>
                        {cred.state === "active" && (
                          <button
                            onClick={() => handleRevoke(cred.id)}
                            data-testid={`revoke-cred-${cred.id}`}
                            className="danger-btn"
                          >
                            {t("partners.revoke")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">{t("partners.noCredentials")}</p>
            )}
          </section>

          {/* Usage Section */}
          <section className="card">
            <h3>{t("partners.usage")}</h3>
            {usage ? (
              <table>
                <tbody>
                  <tr>
                    <td>{t("partners.apiCalls")}</td>
                    <td data-testid="partner-api-calls">{usage.apiCalls}</td>
                  </tr>
                  <tr>
                    <td>{t("partners.webhookDeliveries")}</td>
                    <td>{usage.webhookDeliveries}</td>
                  </tr>
                  <tr>
                    <td>{t("partners.windowStart")}</td>
                    <td>{new Date(usage.windowStart).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="empty-state">{t("partners.noUsage")}</p>
            )}
          </section>

          {/* Audit Section */}
          <section className="card">
            <h3>{t("partners.auditTrail")}</h3>
            {auditEntries.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("partners.action")}</th>
                    <th>{t("partners.actor")}</th>
                    <th>{t("partners.timestamp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.slice(0, 20).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.action}</td>
                      <td>{entry.actorPublicId}</td>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">{t("partners.noAuditEntries")}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
