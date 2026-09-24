// Configuration — service targets and alert thresholds from ADR-041 / SLI_BASELINE.md

export interface ServiceTarget {
  name: string;
  url: string;
}

export const SCRAPE_INTERVAL_MS = 30_000; // 30s per prometheus.yml
export const SCRAPE_TIMEOUT_MS = 10_000;
export const ALERT_EVAL_INTERVAL_MS = 30_000;
export const SERVICE_DOWN_THRESHOLD_MS = 120_000; // 2 min — no metrics = service down

export const WASLA_SERVICES: ServiceTarget[] = [
  { name: 'wasla-customers', url: 'https://wasla-customers.onrender.com' },
  { name: 'wasla-delivery', url: 'https://wasla-delivery.onrender.com' },
  { name: 'wasla-dispatch', url: 'https://wasla-dispatch.onrender.com' },
  { name: 'wasla-drivers', url: 'https://wasla-drivers.onrender.com' },
  { name: 'wasla-geography', url: 'https://wasla-geography.onrender.com' },
  { name: 'wasla-identity', url: 'https://wasla-identity.onrender.com' },
  { name: 'wasla-matching', url: 'https://wasla-matching.onrender.com' },
  { name: 'wasla-negotiations', url: 'https://wasla-negotiations.onrender.com' },
  { name: 'wasla-orders', url: 'https://wasla-orders.onrender.com' },
  { name: 'wasla-reputation', url: 'https://wasla-reputation.onrender.com' },
  { name: 'wasla-search', url: 'https://wasla-search.onrender.com' },
  { name: 'wasla-marketplace', url: 'https://wasla-marketplace.onrender.com' },
  { name: 'wasla-subscriptions', url: 'https://wasla-subscriptions.onrender.com' },
  { name: 'wasla-audit', url: 'https://wasla-audit.onrender.com' },
];

// SLI thresholds from alert-rules.yml / SLI_BASELINE.md
export const SLI_THRESHOLDS = {
  availability: 0.99,        // ≥ 99% (2xx+3xx / total)
  latencyP95: 0.5,          // ≤ 500ms
  errorRate: 0.05,           // ≤ 5% (4xx+5xx / total)
  serviceDownMs: 120_000,    // 2 min no metrics
};
