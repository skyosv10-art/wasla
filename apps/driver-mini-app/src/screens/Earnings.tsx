import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEarningsStore } from "../store/earnings";
import type { EarningsPeriod, JobHistoryEntry } from "../types/earnings";

const PERIODS: EarningsPeriod[] = ["today", "week", "month"];

function formatAmount(amountMinor: number, currency: string): string {
  const major = (amountMinor / 100).toFixed(2);
  return `${major} ${currency}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function Earnings(): JSX.Element {
  const { t } = useTranslation();
  const { period, summary, loading, error, fetchEarnings, setPeriod } = useEarningsStore();

  useEffect(() => {
    fetchEarnings(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <div>
      <h2>{t("driver.earnings.title")}</h2>

      <div>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            disabled={loading}
            data-testid={`period-${p}`}
            aria-pressed={period === p}
          >
            {t(`driver.earnings.${p}`)}
          </button>
        ))}
      </div>

      {loading && <p data-testid="loading">{t("common.loading")}</p>}

      {error && !loading && (
        <p data-testid="error">{t("common.error")}: {error}</p>
      )}

      {summary && !loading && !error && (
        <div data-testid="summary">
          <p data-testid="summary-count">
            {summary.job_count} {t("driver.earnings.jobs")}
          </p>
          <p data-testid="summary-total">
            {formatAmount(summary.total_amount.amount_minor, summary.total_amount.currency)}
          </p>
        </div>
      )}

      {summary && !loading && !error && summary.jobs.length === 0 && (
        <p data-testid="empty">{t("driver.earnings.no_jobs")}</p>
      )}

      {summary && !loading && !error && summary.jobs.length > 0 && (
        <ul data-testid="job-list">
          {summary.jobs.map((job: JobHistoryEntry) => (
            <li key={job.order_public_id} data-testid={`job-${job.order_public_id}`}>
              <span>{job.order_public_id}</span>
              <span>{t(`driver.earnings.type_${job.order_type}`)}</span>
              <span>
                {job.agreed_price
                  ? formatAmount(job.agreed_price.amount_minor, job.agreed_price.currency)
                  : "—"}
              </span>
              <span>{t(`driver.earnings.status_${job.status}`)}</span>
              <span>{formatDate(job.completed_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
