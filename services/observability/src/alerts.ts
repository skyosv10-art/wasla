// SLI alert evaluator — replaces Prometheus alerting rules
// Evaluates: availability ≥ 99%, latency p95 ≤ 500ms, error rate ≤ 5%, service down ≤ 2min

import { scraper } from './scraper.js';
import { SLI_THRESHOLDS, ALERT_EVAL_INTERVAL_MS } from './config.js';

export interface AlertState {
  name: string;
  severity: 'critical' | 'warning' | 'info';
  sli: string;
  state: 'firing' | 'pending' | 'resolved';
  value: number | string;
  threshold: number | string;
  description: string;
  lastEvaluated: number;
  servicesAffected: string[];
}

class AlertEvaluator {
  private alerts: Map<string, AlertState> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private evalCount = 0;

  start(): void {
    console.log('[alerts] Starting SLI alert evaluator — %ds interval', ALERT_EVAL_INTERVAL_MS / 1000);
    this.evaluate();
    this.interval = setInterval(() => this.evaluate(), ALERT_EVAL_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private evaluate(): void {
    this.evalCount++;
    const results = scraper.getResults();
    const now = Date.now();

    // ── 1. Service Down: no metrics in 2 min ──────────────────────────
    const downServices: string[] = [];
    for (const r of results) {
      if (r.status === 'down' || now - r.scrapedAt > SLI_THRESHOLDS.serviceDownMs) {
        downServices.push(r.service);
      }
    }
    this.updateAlert('WASLAServiceDown', {
      name: 'WASLAServiceDown',
      severity: 'critical',
      sli: 'availability',
      state: downServices.length > 0 ? 'firing' : 'resolved',
      value: downServices.length,
      threshold: 0,
      description: downServices.length > 0
        ? `${downServices.length} service(s) down: ${downServices.join(', ')}`
        : 'All services reporting metrics',
      lastEvaluated: now,
      servicesAffected: downServices,
    });

    // ── 2. Availability: ≥ 99% (non-5xx / total) ────────────────────
    let totalReqs = 0;
    let errorReqs = 0;
    const availByService: Record<string, { total: number; errors: number }> = {};
    for (const r of results) {
      if (r.status !== 'up') continue;
      const metrics = scraper.parseHttpRequests(r);
      for (const m of metrics) {
        const status = m.labels.status || '';
        const service = m.labels.service || r.service;
        if (!availByService[service]) availByService[service] = { total: 0, errors: 0 };
        availByService[service].total += m.value;
        totalReqs += m.value;
        if (status.startsWith('5')) {
          availByService[service].errors += m.value;
          errorReqs += m.value;
        }
      }
    }
    const availability = totalReqs > 0 ? 1 - errorReqs / totalReqs : 1;
    const availViolations = Object.entries(availByService)
      .filter(([, v]) => v.total > 0 && (1 - v.errors / v.total) < SLI_THRESHOLDS.availability)
      .map(([k]) => k);
    this.updateAlert('WASLAAvailabilityBelow99', {
      name: 'WASLAAvailabilityBelow99',
      severity: 'critical',
      sli: 'availability',
      state: availViolations.length > 0 ? 'firing' : 'resolved',
      value: availability,
      threshold: SLI_THRESHOLDS.availability,
      description: `Availability: ${(availability * 100).toFixed(2)}% (target: ≥ 99%)`,
      lastEvaluated: now,
      servicesAffected: availViolations,
    });

    // ── 3. Error Rate: ≤ 5% (4xx+5xx / total) ───────────────────────
    let clientServerErrors = 0;
    const errorByService: Record<string, { total: number; errors: number }> = {};
    for (const r of results) {
      if (r.status !== 'up') continue;
      const metrics = scraper.parseHttpRequests(r);
      for (const m of metrics) {
        const status = m.labels.status || '';
        const service = m.labels.service || r.service;
        if (!errorByService[service]) errorByService[service] = { total: 0, errors: 0 };
        errorByService[service].total += m.value;
        if (status.startsWith('4') || status.startsWith('5')) {
          errorByService[service].errors += m.value;
          clientServerErrors += m.value;
        }
      }
    }
    const errorRate = totalReqs > 0 ? clientServerErrors / totalReqs : 0;
    const errorViolations = Object.entries(errorByService)
      .filter(([, v]) => v.total > 0 && v.errors / v.total > SLI_THRESHOLDS.errorRate)
      .map(([k]) => k);
    this.updateAlert('WASLAErrorRateAbove5Percent', {
      name: 'WASLAErrorRateAbove5Percent',
      severity: 'warning',
      sli: 'error-rate',
      state: errorViolations.length > 0 ? 'firing' : 'resolved',
      value: errorRate,
      threshold: SLI_THRESHOLDS.errorRate,
      description: `Error rate: ${(errorRate * 100).toFixed(2)}% (target: ≤ 5%)`,
      lastEvaluated: now,
      servicesAffected: errorViolations,
    });

    // ── 4. Latency p95: ≤ 500ms ─────────────────────────────────────
    // Parse histogram buckets for p95 calculation
    const latencyByService: Record<string, { buckets: { le: number; count: number }[]; total: number }> = {};
    for (const r of results) {
      if (r.status !== 'up') continue;
      for (const line of r.metricsRaw.split('\n')) {
        if (!line.startsWith('http_request_duration_seconds_bucket')) continue;
        const match = line.match(/^http_request_duration_seconds_bucket\{([^}]*)\}\s+([\d.]+)/);
        if (!match) continue;
        const [, labelsStr, valStr] = match;
        const labels: Record<string, string> = {};
        for (const lm of labelsStr.matchAll(/(\w+)="([^"]*)"/g)) {
          labels[lm[1]] = lm[2];
        }
        const service = labels.service || r.service;
        const le = parseFloat(labels.le || '0');
        if (!latencyByService[service]) latencyByService[service] = { buckets: [], total: 0 };
        latencyByService[service].buckets.push({ le, count: parseFloat(valStr) });
      }
    }
    const latencyViolations: string[] = [];
    let maxP95 = 0;
    for (const [service, data] of Object.entries(latencyByService)) {
      data.buckets.sort((a, b) => a.le - b.le);
      const totalCount = data.buckets.length > 0 ? data.buckets[data.buckets.length - 1].count : 0;
      if (totalCount === 0) continue;
      const p95Count = totalCount * 0.95;
      let p95 = 0;
      for (const b of data.buckets) {
        if (b.count >= p95Count) {
          p95 = b.le;
          break;
        }
      }
      if (p95 > maxP95) maxP95 = p95;
      if (p95 > SLI_THRESHOLDS.latencyP95) {
        latencyViolations.push(service);
      }
    }
    this.updateAlert('WASLALatencyP95Above500ms', {
      name: 'WASLALatencyP95Above500ms',
      severity: 'warning',
      sli: 'latency',
      state: latencyViolations.length > 0 ? 'firing' : 'resolved',
      value: maxP95,
      threshold: SLI_THRESHOLDS.latencyP95,
      description: `Max p95 latency: ${(maxP95 * 1000).toFixed(0)}ms (target: ≤ 500ms)`,
      lastEvaluated: now,
      servicesAffected: latencyViolations,
    });

    if (this.evalCount <= 2) {
      const firing = Array.from(this.alerts.values()).filter(a => a.state === 'firing');
      console.log('[alerts] Eval #%d: %d alerts, %d firing', this.evalCount, this.alerts.size, firing.length);
    }
  }

  private updateAlert(name: string, alert: AlertState): void {
    this.alerts.set(name, alert);
  }

  getAlerts(): AlertState[] {
    return Array.from(this.alerts.values());
  }

  getFiringAlerts(): AlertState[] {
    return this.getAlerts().filter(a => a.state === 'firing');
  }

  getEvalCount(): number {
    return this.evalCount;
  }
}

export const alertEvaluator = new AlertEvaluator();
