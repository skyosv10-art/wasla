import { describe, it, expect } from 'vitest';
import { WASLA_SERVICES, SLI_THRESHOLDS, SCRAPE_INTERVAL_MS } from '../config.js';

describe('observability config', () => {
  it('defines 14 service targets', () => {
    expect(WASLA_SERVICES).toHaveLength(14);
  });

  it('each target has name and url', () => {
    for (const t of WASLA_SERVICES) {
      expect(t.name).toBeTruthy();
      expect(t.url).toBeTruthy();
    }
  });

  it('defines SLI thresholds', () => {
    expect(SLI_THRESHOLDS.availability).toBeGreaterThan(0);
    expect(SLI_THRESHOLDS.latencyP95).toBeGreaterThan(0);
    expect(SLI_THRESHOLDS.errorRate).toBeGreaterThan(0);
  });

  it('uses a 30s scrape interval', () => {
    expect(SCRAPE_INTERVAL_MS).toBe(30000);
  });
});
