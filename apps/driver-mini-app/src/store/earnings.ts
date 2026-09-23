/**
 * Earnings / Job History Zustand store.
 *
 * Fetches completed jobs for the current driver with period filtering.
 * The API contract follows the orders service wire format.
 *
 * GET /orders/drivers/:driverPublicId/jobs?status=completed&period=... → { jobs: JobHistoryEntry[] }
 *
 * Period filtering:
 * - today: jobs completed today
 * - week: jobs completed in the last 7 days
 * - month: jobs completed in the last 30 days
 */

import { create } from "zustand";
import { apiClient } from "../api/client";
import { useSessionStore } from "./session";
import type { EarningsPeriod, EarningsSummary, JobHistoryEntry, Money } from "../types/earnings";

interface EarningsState {
  period: EarningsPeriod;
  jobs: JobHistoryEntry[];
  summary: EarningsSummary | null;
  loading: boolean;
  error: string | null;
  fetchEarnings: (period?: EarningsPeriod) => Promise<void>;
  setPeriod: (period: EarningsPeriod) => void;
  clearErrors: () => void;
}

function computeSummary(jobs: JobHistoryEntry[], period: EarningsPeriod): EarningsSummary {
  const totalMinor = jobs.reduce((sum, j) => {
    if (j.agreed_price && j.agreed_price.currency === "SAR") {
      return sum + j.agreed_price.amount_minor;
    }
    return sum;
  }, 0);

  const currency = jobs.find((j) => j.agreed_price)?.agreed_price?.currency ?? "SAR";

  const total: Money = {
    amount_minor: totalMinor,
    currency,
  };

  return {
    period,
    job_count: jobs.length,
    total_amount: total,
    jobs,
  };
}

export const useEarningsStore = create<EarningsState>((set, get) => ({
  period: "today",
  jobs: [],
  summary: null,
  loading: false,
  error: null,

  fetchEarnings: async (period?: EarningsPeriod) => {
    const driverId = useSessionStore.getState().driverId;
    if (!driverId) {
      set({ error: "no_driver_session", loading: false });
      return;
    }

    const currentPeriod = period ?? get().period;
    set({ loading: true, error: null, period: currentPeriod });

    try {
      const data = await apiClient.get<{ jobs: JobHistoryEntry[] }>(
        `/orders/drivers/${driverId}/jobs?status=completed&period=${currentPeriod}`,
      );
      const jobs = data.jobs ?? [];
      const summary = computeSummary(jobs, currentPeriod);
      set({ jobs, summary, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "fetch_earnings_failed";
      set({ error: message, loading: false });
    }
  },

  setPeriod: (period: EarningsPeriod) => {
    set({ period });
  },

  clearErrors: () => set({ error: null }),
}));
