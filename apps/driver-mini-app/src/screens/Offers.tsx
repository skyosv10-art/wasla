import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatchStore } from "../store/dispatch";
import type { DispatchOffer } from "../types/dispatch";

// ADR-045 Decision 4: Offer Feed polls GET /dispatch/jobs/:job_id/offers every 10s.
// The job_id is passed via URL hash params: #offers?job_id=xxx

function parseJobIdFromHash(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [route, queryString] = hash.split("?");
  if (route !== "offers" || !queryString) return null;
  const params = new URLSearchParams(queryString);
  return params.get("job_id");
}

function formatCountdown(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "0:00";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function Offers() {
  const { t } = useTranslation();
  const {
    offers,
    offersLoading,
    offersError,
    actionLoading,
    actionError,
    fetchOffers,
    startPolling,
    stopPolling,
    acceptOffer,
    rejectOffer,
    clearErrors,
  } = useDispatchStore();

  const [jobId, setJobId] = useState<string | null>(parseJobIdFromHash());
  const [countdowns, setCountdowns] = useState<Record<string, string>>({});

  // Start polling when jobId is available
  useEffect(() => {
    const id = parseJobIdFromHash();
    setJobId(id);
    if (id) {
      startPolling(id);
    }
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // Update countdowns every second
  useEffect(() => {
    if (offers.length === 0) return;
    const updateCountdowns = () => {
      const next: Record<string, string> = {};
      for (const offer of offers) {
        if (offer.status === "pending") {
          next[offer.id] = formatCountdown(offer.expires_at);
        }
      }
      setCountdowns(next);
    };
    updateCountdowns();
    const timer = setInterval(updateCountdowns, 1_000);
    return () => clearInterval(timer);
  }, [offers]);

  // Listen for hash changes (bot may navigate with new job_id)
  useEffect(() => {
    const onHashChange = () => {
      const id = parseJobIdFromHash();
      setJobId(id);
      if (id) {
        startPolling(id);
      } else {
        stopPolling();
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [startPolling, stopPolling]);

  if (!jobId) {
    return (
      <div className="screen offers-screen" data-testid="offers-no-jobid">
        <p>{t("offers.no_offers")}</p>
      </div>
    );
  }

  if (offersLoading && offers.length === 0) {
    return (
      <div className="screen offers-screen" data-testid="offers-loading">
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (offersError && offers.length === 0) {
    return (
      <div className="screen offers-screen" data-testid="offers-error">
        <p className="error-text">{offersError}</p>
        <button onClick={() => fetchOffers(jobId)} disabled={actionLoading}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const pendingOffers = offers.filter((o) => o.status === "pending");
  const resolvedOffers = offers.filter((o) => o.status !== "pending");

  if (pendingOffers.length === 0 && resolvedOffers.length === 0) {
    return (
      <div className="screen offers-screen" data-testid="offers-empty">
        <p>{t("offers.no_offers")}</p>
      </div>
    );
  }

  return (
    <div className="screen offers-screen" data-testid="offers-screen">
      <h2>{t("offers.title")}</h2>

      {actionError && (
        <div className="error-banner" data-testid="action-error">
          <p className="error-text">{actionError}</p>
          <button onClick={clearErrors} aria-label="dismiss">
            ×
          </button>
        </div>
      )}

      {pendingOffers.map((offer) => (
        <OfferCard
          key={offer.id}
          offer={offer}
          countdown={countdowns[offer.id]}
          actionLoading={actionLoading}
          onAccept={() => acceptOffer(offer.id)}
          onReject={(reason) => rejectOffer(offer.id, reason)}
          t={t}
        />
      ))}

      {resolvedOffers.length > 0 && (
        <div className="resolved-offers" data-testid="resolved-offers">
          {resolvedOffers.map((offer) => (
            <div key={offer.id} className="offer-card resolved" data-testid={`offer-${offer.id}`}>
              <p>
                {t("offers.title")} — {t(`job_status.${offer.status}`)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OfferCardProps {
  offer: DispatchOffer;
  countdown: string | undefined;
  actionLoading: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
  t: (key: string) => string;
}

function OfferCard({ offer, countdown, actionLoading, onAccept, onReject, t }: OfferCardProps) {
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("driver_declined");

  return (
    <div className="offer-card pending" data-testid={`offer-${offer.id}`}>
      <div className="offer-header">
        <span className="offer-label">{t("offers.new_offer")}</span>
        {countdown && (
          <span className="countdown" data-testid={`countdown-${offer.id}`}>
            {countdown}
          </span>
        )}
      </div>

      <div className="offer-details">
        <div className="offer-row">
          <span className="label">{t("offers.vehicle_type")}:</span>
          <span className="value" data-testid={`offer-job-${offer.job_id}`}>
            {offer.job_id}
          </span>
        </div>
        <div className="offer-row">
          <span className="label">{t("offers.offered_price")}:</span>
          <span className="value">{t("offers.time_to_respond")}</span>
        </div>
      </div>

      {!showRejectReason ? (
        <div className="offer-actions">
          <button
            onClick={onAccept}
            disabled={actionLoading}
            data-testid={`accept-${offer.id}`}
            aria-label={t("offers.accept")}
          >
            {t("offers.accept")}
          </button>
          <button
            onClick={() => setShowRejectReason(true)}
            disabled={actionLoading}
            data-testid={`reject-${offer.id}`}
            aria-label={t("offers.reject")}
          >
            {t("offers.reject")}
          </button>
        </div>
      ) : (
        <div className="reject-reason" data-testid={`reject-reason-${offer.id}`}>
          <select
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            aria-label={t("job.cancel_reason")}
          >
            <option value="driver_declined">{t("offers.reject")}</option>
            <option value="too_far">{t("offers.from")} — {t("offers.to")}</option>
            <option value="busy">{t("home.busy")}</option>
          </select>
          <button
            onClick={() => onReject(rejectReason)}
            disabled={actionLoading}
            data-testid={`confirm-reject-${offer.id}`}
          >
            {t("offers.reject")}
          </button>
          <button
            onClick={() => setShowRejectReason(false)}
            disabled={actionLoading}
          >
            {t("common.back")}
          </button>
        </div>
      )}
    </div>
  );
}
