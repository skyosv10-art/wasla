// Metrics scraper — fetches /metrics from all 14 WASLA services
// Replaces Prometheus scrape_configs for Render staging

import { WASLA_SERVICES, SCRAPE_INTERVAL_MS, SCRAPE_TIMEOUT_MS } from './config.js';

export interface ScrapeResult {
  service: string;
  url: string;
  status: 'up' | 'down';
  httpStatus: number;
  metricsRaw: string;
  lineCount: number;
  scrapedAt: number;
  error?: string;
  durationMs: number;
}

export interface ParsedMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

class MetricsScraper {
  private results: Map<string, ScrapeResult> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private scrapeCount = 0;

  start(): void {
    console.log('[scraper] Starting metrics scraper — %d services, %ds interval', WASLA_SERVICES.length, SCRAPE_INTERVAL_MS / 1000);
    this.scrapeAll();
    this.interval = setInterval(() => this.scrapeAll(), SCRAPE_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private async scrapeAll(): Promise<void> {
    this.scrapeCount++;
    const promises = WASLA_SERVICES.map(svc => this.scrapeService(svc));
    await Promise.allSettled(promises);
  }

  private async scrapeService(svc: { name: string; url: string }): Promise<void> {
    const start = Date.now();
    const metricsUrl = `${svc.url}/metrics`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
      const res = await fetch(metricsUrl, {
        signal: controller.signal,
        headers: { Accept: 'text/plain' },
      });
      clearTimeout(timeout);
      const metricsRaw = await res.text();
      const result: ScrapeResult = {
        service: svc.name,
        url: metricsUrl,
        status: res.ok ? 'up' : 'down',
        httpStatus: res.status,
        metricsRaw,
        lineCount: metricsRaw.split('\n').filter(l => l.trim().length > 0).length,
        scrapedAt: Date.now(),
        durationMs: Date.now() - start,
      };
      this.results.set(svc.name, result);
      if (this.scrapeCount <= 2) {
        console.log('[scraper] %s: %d lines, %dms', svc.name, result.lineCount, result.durationMs);
      }
    } catch (err: any) {
      const result: ScrapeResult = {
        service: svc.name,
        url: metricsUrl,
        status: 'down',
        httpStatus: 0,
        metricsRaw: '',
        lineCount: 0,
        scrapedAt: Date.now(),
        error: err.message || String(err),
        durationMs: Date.now() - start,
      };
      this.results.set(svc.name, result);
      if (this.scrapeCount <= 2) {
        console.log('[scraper] %s: DOWN (%s)', svc.name, result.error);
      }
    }
  }

  getResults(): ScrapeResult[] {
    return Array.from(this.results.values());
  }

  getResult(service: string): ScrapeResult | undefined {
    return this.results.get(service);
  }

  getScrapeCount(): number {
    return this.scrapeCount;
  }

  // Parse Prometheus text format — extract http_requests_total by status
  parseHttpRequests(result: ScrapeResult): ParsedMetric[] {
    const metrics: ParsedMetric[] = [];
    if (!result.metricsRaw) return metrics;
    for (const line of result.metricsRaw.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue;
      if (!line.startsWith('http_requests_total')) continue;
      // Format: http_requests_total{label1="val1",label2="val2"} 123
      const match = line.match(/^(\w+)\{([^}]*)\}\s+([\d.]+)/);
      if (match) {
        const [, name, labelsStr, valStr] = match;
        const labels: Record<string, string> = {};
        for (const labelMatch of labelsStr.matchAll(/(\w+)="([^"]*)"/g)) {
          labels[labelMatch[1]] = labelMatch[2];
        }
        metrics.push({ name, labels, value: parseFloat(valStr) });
      }
    }
    return metrics;
  }
}

export const scraper = new MetricsScraper();
