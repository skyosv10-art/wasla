// Configuration — service targets and alert thresholds from ADR-041 / SLI_BASELINE.md

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ServiceTarget {
  name: string;
  url: string;
}

export const SCRAPE_INTERVAL_MS = 30_000; // 30s per prometheus.yml
export const SCRAPE_TIMEOUT_MS = 10_000;
export const ALERT_EVAL_INTERVAL_MS = 30_000;
export const SERVICE_DOWN_THRESHOLD_MS = 120_000; // 2 min — no metrics = service down

// Targets come from ONE file per environment (CLM-0499 · ADR-068):
//   infra/observability/targets/<WASLA_OBS_ENVIRONMENT>.targets
// The same file renders Prometheus (infra/observability/prometheus-entrypoint.sh).
// No default environment and no built-in host list: a missing or unknown value
// fails closed at boot, so an old hostname set cannot come back by omission.
export interface ObservabilityTargets {
  environment: string;
  /** Alertmanager host when this environment owns paging; null = shadow mode. */
  alertmanager: string | null;
  services: ServiceTarget[];
}

export const TARGETS_DIR = fileURLToPath(new URL('../../../infra/observability/targets/', import.meta.url));

const ENV_NAME = /^[a-z0-9-]+$/;

export function parseTargets(text: string, expectedEnvironment: string): ObservabilityTargets {
  let environment: string | undefined;
  let alertmanager: string | undefined;
  const services: ServiceTarget[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [kind, a, b, ...rest] = line.split(/\s+/);
    if (kind === 'environment' && a && !b) environment = a;
    else if (kind === 'alertmanager' && a && !b) alertmanager = a;
    else if (kind === 'service' && a && b && rest.length === 0) {
      if (!/^https:\/\/[a-z0-9.-]+$/.test(b)) throw new Error(`targets: service ${a} url must be https://<host> (got ${b})`);
      if (services.some(s => s.name === a)) throw new Error(`targets: duplicate service ${a}`);
      services.push({ name: a, url: b });
    } else throw new Error(`targets: unrecognised line «${line}»`);
  }
  if (environment !== expectedEnvironment) throw new Error(`targets: file declares environment ${environment}, expected ${expectedEnvironment}`);
  if (!alertmanager) throw new Error('targets: missing alertmanager line (use «alertmanager none»)');
  if (services.length === 0) throw new Error('targets: no services');
  return { environment, alertmanager: alertmanager === 'none' ? null : alertmanager, services };
}

export function loadTargets(env: NodeJS.ProcessEnv = process.env, dir: string = TARGETS_DIR): ObservabilityTargets {
  const name = env.WASLA_OBS_ENVIRONMENT;
  if (!name) throw new Error('WASLA_OBS_ENVIRONMENT is not set — refusing to guess which environment to scrape');
  if (!ENV_NAME.test(name)) throw new Error('WASLA_OBS_ENVIRONMENT must match [a-z0-9-]+');
  let text: string;
  try {
    text = readFileSync(`${dir}/${name}.targets`, 'utf8');
  } catch {
    throw new Error(`no targets file for environment ${name}`);
  }
  return parseTargets(text, name);
}

let cached: ObservabilityTargets | undefined;
/** Loaded once per process; throws (fail closed) on a missing/unknown environment. */
export function targets(): ObservabilityTargets {
  cached ??= loadTargets();
  return cached;
}

// SLI thresholds from alert-rules.yml / SLI_BASELINE.md
export const SLI_THRESHOLDS = {
  availability: 0.99,        // ≥ 99% (2xx+3xx / total)
  latencyP95: 0.5,          // ≤ 500ms
  errorRate: 0.05,           // ≤ 5% (4xx+5xx / total)
  serviceDownMs: 120_000,    // 2 min no metrics
};
