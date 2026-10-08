import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadTargets, parseTargets, TARGETS_DIR, SLI_THRESHOLDS, SCRAPE_INTERVAL_MS } from '../config.js';

// CLM-0499 · ADR-068: one targets file per environment, selected by WASLA_OBS_ENVIRONMENT.
const ENVS = readdirSync(TARGETS_DIR).filter(f => f.endsWith('.targets')).map(f => f.replace(/\.targets$/, ''));

describe('observability targets', () => {
  it('ships the legacy and singapore environments', () => {
    expect(ENVS.sort()).toEqual(['render-oregon-legacy', 'render-singapore']);
  });

  it.each(ENVS)('%s defines the same 14 services, https only', (env) => {
    const t = loadTargets({ WASLA_OBS_ENVIRONMENT: env });
    expect(t.environment).toBe(env);
    expect(t.services).toHaveLength(14);
    for (const s of t.services) expect(s.url).toMatch(/^https:\/\/[a-z0-9.-]+\.onrender\.com$/);
    const legacy = loadTargets({ WASLA_OBS_ENVIRONMENT: 'render-oregon-legacy' });
    expect(t.services.map(s => s.name)).toEqual(legacy.services.map(s => s.name));
  });

  // CLM-0504 paging flip: the invariant reversed — singapore is now the paging
  // owner (its Alertmanager is a NEW-workspace host, never a legacy one) and the
  // legacy environment owns no paging. The 'at most one environment owns paging'
  // case below still guards the single-owner rule.
  it('singapore never points at a legacy host, and owns paging; legacy owns none', () => {
    const legacyHosts = new Set(loadTargets({ WASLA_OBS_ENVIRONMENT: 'render-oregon-legacy' }).services.map(s => s.url));
    const sg = loadTargets({ WASLA_OBS_ENVIRONMENT: 'render-singapore' });
    for (const s of sg.services) expect(legacyHosts.has(s.url)).toBe(false);
    expect(sg.alertmanager).not.toBeNull();
    expect(legacyHosts.has(`https://${sg.alertmanager}`)).toBe(false);
    expect(loadTargets({ WASLA_OBS_ENVIRONMENT: 'render-oregon-legacy' }).alertmanager).toBeNull();
  });

  it('at most one environment owns paging', () => {
    const owners = ENVS.filter(e => loadTargets({ WASLA_OBS_ENVIRONMENT: e }).alertmanager !== null);
    expect(owners.length).toBeLessThanOrEqual(1);
  });

  it('fails closed without an environment', () => {
    expect(() => loadTargets({})).toThrow(/WASLA_OBS_ENVIRONMENT is not set/);
  });

  it('fails closed on an unknown or malformed environment', () => {
    expect(() => loadTargets({ WASLA_OBS_ENVIRONMENT: 'production' })).toThrow(/no targets file/);
    expect(() => loadTargets({ WASLA_OBS_ENVIRONMENT: '../x' })).toThrow(/must match/);
  });

  it('rejects a file whose declared environment differs', () => {
    const text = readFileSync(`${TARGETS_DIR}/render-singapore.targets`, 'utf8');
    expect(() => parseTargets(text, 'render-oregon-legacy')).toThrow(/declares environment/);
  });

  it('rejects http, paths, duplicates, unknown lines and a missing alertmanager line', () => {
    const base = 'environment e\nalertmanager none\n';
    expect(() => parseTargets(base + 'service a http://a.onrender.com\n', 'e')).toThrow(/https/);
    expect(() => parseTargets(base + 'service a https://a.onrender.com/x\n', 'e')).toThrow(/https/);
    expect(() => parseTargets(base + 'service a https://a.x\nservice a https://b.x\n', 'e')).toThrow(/duplicate/);
    expect(() => parseTargets(base + 'target a\n', 'e')).toThrow(/unrecognised/);
    expect(() => parseTargets('environment e\nservice a https://a.x\n', 'e')).toThrow(/alertmanager/);
    expect(() => parseTargets(base, 'e')).toThrow(/no services/);
  });
});

describe('observability config', () => {
  it('defines SLI thresholds', () => {
    expect(SLI_THRESHOLDS.availability).toBeGreaterThan(0);
    expect(SLI_THRESHOLDS.latencyP95).toBeGreaterThan(0);
    expect(SLI_THRESHOLDS.errorRate).toBeGreaterThan(0);
  });

  it('uses a 30s scrape interval', () => {
    expect(SCRAPE_INTERVAL_MS).toBe(30000);
  });
});
