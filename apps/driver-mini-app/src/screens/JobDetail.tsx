import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatchStore } from "../store/dispatch";
import type { OrderStatus } from "../types/orders";

// ADR-045 Decision 3: State machine — only show action buttons valid for the current state.
// Driver transitions:
//   assigned → driver_en_route (start_trip)
//   driver_en_route → arrived (arrived)
//   arrived → in_progress (start_delivery)
//   in_progress → completed (complete)
// Backend rejects illegal transitions with 409 (source of truth).

function parseJobIdFromHash(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [route, queryString] = hash.split("?");
  if (route !== "job" || !queryString) return null;
  const params = new URLSearchParams(queryString);
  return params.get("job_id");
}

interface TransitionButton {
  labelKey: string;
  toStatus: OrderStatus;
  testId: string;
}

function getTransitionForStatus(status: string | null): TransitionButton | null {
  if (!status) return null;

  const transitions: Record<string, TransitionButton> = {
    assigned: {
      labelKey: "job.start_trip",
      toStatus: "driver_en_route",
      testId: "transition-driver_en_route",
    },
    driver_en_route: {
      labelKey: "job.arrived",
      toStatus: "arrived",
      testId: "transition-arrived",
    },
    arrived: {
      labelKey: "job.start_delivery",
      toStatus: "in_progress",
      testId: "transition-in_progress",
    },
    in_progress: {
      labelKey: "job.complete",
      toStatus: "completed",
      testId: "transition-completed",
    },
  };

  return transitions[status] ?? null;
}

export function JobDetail() {
  const { t } = useTranslation();
  const {
    activeJob,
    jobLoading,
    jobError,
    actionLoading,
    actionError,
    fetchJobDetail,
    transitionOrder,
    cancelJob,
    clearErrors,
  } = useDispatchStore();

  const [jobId, setJobId] = useState<string | null>(parseJobIdFromHash());
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("driver_cancelled");

  // Fetch job detail on mount and when jobId changes
  useEffect(() => {
    const id = parseJobIdFromHash();
    setJobId(id);
    if (id) {
      fetchJobDetail(id);
    }
  }, [fetchJobDetail]);

  // Listen for hash changes
  useEffect(() => {
    const onHashChange = () => {
      const id = parseJobIdFromHash();
      setJobId(id);
      if (id) {
        fetchJobDetail(id);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [fetchJobDetail]);

  if (!jobId) {
    return (
      <div className="screen job-screen" data-testid="job-no-jobid">
        <p>{t("common.empty")}</p>
      </div>
    );
  }

  if (jobLoading && !activeJob) {
    return (
      <div className="screen job-screen" data-testid="job-loading">
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (jobError && !activeJob) {
    return (
      <div className="screen job-screen" data-testid="job-error">
        <p className="error-text">{jobError}</p>
        <button onClick={() => fetchJobDetail(jobId)} disabled={actionLoading}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (!activeJob) {
    return (
      <div className="screen job-screen" data-testid="job-empty">
        <p>{t("common.empty")}</p>
      </div>
    );
  }

  const transition = getTransitionForStatus(activeJob.status);

  const handleTransition = async () => {
    if (!transition || !activeJob) return;
    const success = await transitionOrder(activeJob.order_id, transition.toStatus);
    if (success) {
      // Refresh job detail
      fetchJobDetail(activeJob.id);
    }
  };

  const handleCancel = async () => {
    if (!activeJob) return;
    const success = await cancelJob(activeJob.id, cancelReason);
    if (success) {
      setShowCancelForm(false);
      fetchJobDetail(activeJob.id);
    }
  };

  return (
    <div className="screen job-screen" data-testid="job-detail-screen">
      <h2>
        {t("job.title")} #{activeJob.order_public_id}
      </h2>

      {actionError && (
        <div className="error-banner" data-testid="action-error">
          <p className="error-text">{actionError}</p>
          <button onClick={clearErrors} aria-label="dismiss">
            ×
          </button>
        </div>
      )}

      <div className="job-status-card" data-testid="job-status">
        <p>
          <strong>{t("job.status")}:</strong>{" "}
          <span data-testid="job-status-value">
            {t(`job_status.${activeJob.status}`)}
          </span>
        </p>
      </div>

      <div className="job-details" data-testid="job-details">
        <div className="detail-row">
          <span className="label">{t("job.pickup")}:</span>
          <span className="value" data-testid="job-order-id">
            {activeJob.order_public_id}
          </span>
        </div>
        <div className="detail-row">
          <span className="label">{t("job.vehicle")}:</span>
          <span className="value" data-testid="job-vehicle-class">
            {activeJob.vehicle_class}
          </span>
        </div>
        <div className="detail-row">
          <span className="label">{t("offers.vehicle_type")}:</span>
          <span className="value" data-testid="job-order-type">
            {activeJob.order_type}
          </span>
        </div>
      </div>

      {/* State machine — only show transition button for valid current state */}
      {transition && (
        <button
          className="primary-action"
          onClick={handleTransition}
          disabled={actionLoading}
          data-testid={transition.testId}
          aria-label={t(transition.labelKey)}
        >
          {actionLoading ? t("common.submitting") : t(transition.labelKey)}
        </button>
      )}

      {/* Cancel job — only for non-terminal states */}
      {activeJob.status !== "completed" && activeJob.status !== "cancelled" && !showCancelForm && (
        <button
          className="danger-action"
          onClick={() => setShowCancelForm(true)}
          disabled={actionLoading}
          data-testid="show-cancel-form"
        >
          {t("job.cancel")}
        </button>
      )}

      {showCancelForm && (
        <div className="cancel-form" data-testid="cancel-form">
          <label htmlFor="cancel-reason">{t("job.cancel_reason")}</label>
          <select
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            aria-label={t("job.cancel_reason")}
          >
            <option value="driver_cancelled">{t("job.cancel")}</option>
            <option value="vehicle_breakdown">{t("job.vehicle")}</option>
            <option value="emergency">{t("common.error")}</option>
          </select>
          <button
            className="danger-action"
            onClick={handleCancel}
            disabled={actionLoading}
            data-testid="confirm-cancel"
          >
            {actionLoading ? t("common.submitting") : t("job.cancel")}
          </button>
          <button onClick={() => setShowCancelForm(false)} disabled={actionLoading}>
            {t("common.back")}
          </button>
        </div>
      )}
    </div>
  );
}
