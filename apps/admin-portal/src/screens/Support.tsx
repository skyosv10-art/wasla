/**
 * Support screen — manage support tickets.
 *
 * M5-16 review 7/N: Support admin screen — list tickets with state filter,
 * view ticket details, escalate, resolve, close.
 *
 * Calls the support service via the admin API client:
 *   GET  /support/tickets                    — list (with state filter + cursor)
 *   GET  /support/tickets/:ticketId          — get ticket details
 *   POST /support/tickets/:ticketId/escalate — escalate ticket
 *   POST /support/tickets/:ticketId/resolve  — resolve ticket
 *   POST /support/tickets/:ticketId/close    — close ticket
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSupportStore } from "../store/support";
import type {
  SupportTicketState,
  SupportEscalationLevel,
  SupportResolutionReason,
} from "../types/support";

const STATES: SupportTicketState[] = ["open", "investigating", "escalated", "resolved", "closed"];
const ESCALATION_LEVELS: SupportEscalationLevel[] = ["agent", "supervisor", "admin"];
const RESOLUTION_REASONS: SupportResolutionReason[] = ["resolved", "unfounded", "duplicate", "wont_fix"];

export function Support() {
  const { t } = useTranslation();
  const {
    tickets,
    nextCursor,
    selectedTicket,
    loading,
    error,
    stateFilter,
    fetchTickets,
    fetchMoreTickets,
    fetchTicket,
    escalateTicket,
    resolveTicket,
    closeTicket,
    setStateFilter,
    clearSelected,
    clearError,
  } = useSupportStore();

  const [showDetail, setShowDetail] = useState(false);
  const [escalateLevel, setEscalateLevel] = useState<SupportEscalationLevel>("supervisor");
  const [resolveReason, setResolveReason] = useState<SupportResolutionReason>("resolved");
  const [evidenceId, setEvidenceId] = useState("");

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleFilterChange = (state: SupportTicketState | null) => {
    setStateFilter(state);
    fetchTickets(state);
  };

  const handleSelect = (ticketId: string) => {
    fetchTicket(ticketId);
    setShowDetail(true);
  };

  const handleEscalate = async () => {
    if (!selectedTicket) return;
    await escalateTicket(selectedTicket.ticket_id, escalateLevel);
  };

  const handleResolve = async () => {
    if (!selectedTicket || !evidenceId) return;
    await resolveTicket(selectedTicket.ticket_id, resolveReason, evidenceId);
  };

  const handleClose = async () => {
    if (!selectedTicket) return;
    await closeTicket(selectedTicket.ticket_id);
  };

  if (showDetail && selectedTicket) {
    return (
      <div className="support-detail">
        <button onClick={() => { setShowDetail(false); clearSelected(); }}>
          {t("support.backToList")}
        </button>

        <h2>{t("support.ticket")} #{selectedTicket.ticket_id.slice(0, 8)}</h2>

        <dl>
          <dt>{t("support.state")}</dt>
          <dd>{t(`support.states.${selectedTicket.state}`)}</dd>
          <dt>{t("support.type")}</dt>
          <dd>{t(`support.types.${selectedTicket.ticket_type}`)}</dd>
          <dt>{t("support.escalationLevel")}</dt>
          <dd>{selectedTicket.escalation_level ?? "—"}</dd>
          <dt>{t("support.reporter")}</dt>
          <dd>{selectedTicket.reporter_public_id}</dd>
          <dt>{t("support.subject")}</dt>
          <dd>{selectedTicket.subject_public_id ?? "—"}</dd>
          <dt>{t("support.order")}</dt>
          <dd>{selectedTicket.order_public_id ?? "—"}</dd>
          <dt>{t("support.openedAt")}</dt>
          <dd>{new Date(selectedTicket.opened_at).toLocaleString()}</dd>
        </dl>

        {selectedTicket.state === "open" || selectedTicket.state === "investigating" ? (
          <div className="escalate-section">
            <h3>{t("support.escalate")}</h3>
            <select value={escalateLevel} onChange={(e) => setEscalateLevel(e.target.value as SupportEscalationLevel)}>
              {ESCALATION_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>{t(`support.escalationLevels.${lvl}`)}</option>
              ))}
            </select>
            <button onClick={handleEscalate} disabled={loading}>
              {t("support.escalate")}
            </button>
          </div>
        ) : null}

        {selectedTicket.state === "investigating" || selectedTicket.state === "escalated" ? (
          <div className="resolve-section">
            <h3>{t("support.resolve")}</h3>
            <input
              placeholder={t("support.evidenceId")}
              value={evidenceId}
              onChange={(e) => setEvidenceId(e.target.value)}
            />
            <select value={resolveReason} onChange={(e) => setResolveReason(e.target.value as SupportResolutionReason)}>
              {RESOLUTION_REASONS.map((r) => (
                <option key={r} value={r}>{t(`support.resolutionReasons.${r}`)}</option>
              ))}
            </select>
            <button onClick={handleResolve} disabled={loading || !evidenceId}>
              {t("support.resolve")}
            </button>
          </div>
        ) : null}

        {selectedTicket.state === "resolved" ? (
          <div className="close-section">
            <button onClick={handleClose} disabled={loading}>
              {t("support.close")}
            </button>
          </div>
        ) : null}

        {error && <div className="error" onClick={clearError}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="support-list">
      <h1>{t("support.title")}</h1>

      <div className="filter-bar">
        <button
          className={stateFilter === null ? "active" : ""}
          onClick={() => handleFilterChange(null)}
        >
          {t("support.allStates")}
        </button>
        {STATES.map((s) => (
          <button
            key={s}
            className={stateFilter === s ? "active" : ""}
            onClick={() => handleFilterChange(s)}
          >
            {t(`support.states.${s}`)}
          </button>
        ))}
      </div>

      {error && <div className="error" onClick={clearError}>{error}</div>}

      {loading && tickets.length === 0 ? (
        <p>{t("common.loading")}</p>
      ) : tickets.length === 0 ? (
        <p>{t("support.noTickets")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("support.ticketId")}</th>
              <th>{t("support.type")}</th>
              <th>{t("support.state")}</th>
              <th>{t("support.escalationLevel")}</th>
              <th>{t("support.reporter")}</th>
              <th>{t("support.openedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.ticket_id} onClick={() => handleSelect(ticket.ticket_id)}>
                <td>{ticket.ticket_id.slice(0, 8)}</td>
                <td>{t(`support.types.${ticket.ticket_type}`)}</td>
                <td>{t(`support.states.${ticket.state}`)}</td>
                <td>{ticket.escalation_level ?? "—"}</td>
                <td>{ticket.reporter_public_id}</td>
                <td>{new Date(ticket.opened_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextCursor && (
        <button onClick={fetchMoreTickets} disabled={loading}>
          {t("common.loadMore")}
        </button>
      )}
    </div>
  );
}
