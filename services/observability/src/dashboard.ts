// HTML dashboard — exposes service status, metrics summary, alerts, and traces

import { scraper } from './scraper.js';
import { alertEvaluator } from './alerts.js';
import { otlpReceiver } from './otlp.js';

export function renderDashboard(): string {
  const results = scraper.getResults();
  const alerts = alertEvaluator.getAlerts();
  const firing = alerts.filter(a => a.state === 'firing');
  const traces = otlpReceiver.getRecentTraces(10);

  const upCount = results.filter(r => r.status === 'up').length;
  const downCount = results.filter(r => r.status === 'down').length;
  const totalLines = results.reduce((sum, r) => sum + r.lineCount, 0);

  const serviceRows = results.map(r => `
    <tr class="${r.status}">
      <td>${r.service}</td>
      <td><span class="badge ${r.status}">${r.status.toUpperCase()}</span></td>
      <td>${r.httpStatus}</td>
      <td>${r.lineCount}</td>
      <td>${r.durationMs}ms</td>
      <td>${new Date(r.scrapedAt).toISOString()}</td>
      <td>${r.error ? `<span class="error">${r.error}</span>` : '—'}</td>
    </tr>`).join('');

  const alertRows = alerts.map(a => `
    <tr class="${a.state}">
      <td>${a.name}</td>
      <td><span class="badge ${a.severity}">${a.severity}</span></td>
      <td>${a.sli}</td>
      <td><span class="badge ${a.state}">${a.state.toUpperCase()}</span></td>
      <td>${typeof a.value === 'number' ? a.value.toFixed(4) : a.value}</td>
      <td>${typeof a.threshold === 'number' ? a.threshold.toFixed(4) : a.threshold}</td>
      <td>${a.description}</td>
      <td>${a.servicesAffected.length > 0 ? a.servicesAffected.join(', ') : '—'}</td>
    </tr>`).join('');

  const traceRows = traces.map(t => `
    <tr>
      <td title="${t.traceId}">${t.traceId.substring(0, 16)}…</td>
      <td title="${t.spanId}">${t.spanId.substring(0, 8)}</td>
      <td>${t.service}</td>
      <td>${t.name}</td>
      <td>${t.durationMs.toFixed(1)}ms</td>
      <td>${new Date(t.startTime).toISOString()}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WASLA Observability Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; margin: 0 0 4px; }
    h2 { color: #555; margin: 24px 0 8px; font-size: 18px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 16px; }
    .summary { display: flex; gap: 12px; margin-bottom: 20px; }
    .stat { background: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat .num { font-size: 28px; font-weight: bold; }
    .stat .lbl { font-size: 12px; color: #888; text-transform: uppercase; }
    .up .num { color: #2e7d32; }
    .down .num { color: #c62828; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #eee; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666; }
    td { padding: 8px 12px; border-top: 1px solid #f0f0f0; font-size: 13px; }
    tr.up td:first-child { border-left: 3px solid #4caf50; }
    tr.down td:first-child { border-left: 3px solid #f44336; }
    tr.firing td:first-child { border-left: 3px solid #ff9800; }
    tr.resolved td:first-child { border-left: 3px solid #4caf50; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
    .badge.up, .badge.resolved, .badge.critical.resolved { background: #c8e6c9; color: #2e7d32; }
    .badge.down, .badge.firing { background: #ffcdd2; color: #c62828; }
    .badge.warning { background: #fff9c4; color: #f57f17; }
    .badge.critical { background: #ffcdd2; color: #c62828; }
    .badge.info { background: #bbdefb; color: #1565c0; }
    .error { color: #c62828; font-size: 12px; }
    .refresh { float: right; font-size: 12px; color: #888; }
    a { color: #1976d2; }
  </style>
  <meta http-equiv="refresh" content="30">
</head>
<body>
  <h1>WASLA Observability Dashboard</h1>
  <div class="subtitle">M2-08 Stage B — Node.js collector · ADR-041 · auto-refresh 30s</div>
  <div class="summary">
    <div class="stat up"><div class="num">${upCount}</div><div class="lbl">Services Up</div></div>
    <div class="stat down"><div class="num">${downCount}</div><div class="lbl">Services Down</div></div>
    <div class="stat"><div class="num">${totalLines}</div><div class="lbl">Metric Lines</div></div>
    <div class="stat"><div class="num" style="color: ${firing.length > 0 ? '#c62828' : '#2e7d32'}">${firing.length}</div><div class="lbl">Alerts Firing</div></div>
    <div class="stat"><div class="num">${otlpReceiver.getTraceCount()}</div><div class="lbl">Traces Received</div></div>
    <div class="stat"><div class="num">${scraper.getScrapeCount()}</div><div class="lbl">Scrape Cycles</div></div>
  </div>

  <h2>Service Status (14 targets)</h2>
  <table>
    <tr><th>Service</th><th>Status</th><th>HTTP</th><th>Lines</th><th>Duration</th><th>Last Scrape</th><th>Error</th></tr>
    ${serviceRows || '<tr><td colspan="7" style="text-align:center;color:#999">No data yet — first scrape in progress</td></tr>'}
  </table>

  <h2>SLI Alerts (4 rules)</h2>
  <table>
    <tr><th>Alert</th><th>Severity</th><th>SLI</th><th>State</th><th>Value</th><th>Threshold</th><th>Description</th><th>Affected</th></tr>
    ${alertRows || '<tr><td colspan="8" style="text-align:center;color:#999">No alerts evaluated yet</td></tr>'}
  </table>

  <h2>Recent Traces (OTLP)</h2>
  <table>
    <tr><th>Trace ID</th><th>Span ID</th><th>Service</th><th>Operation</th><th>Duration</th><th>Started</th></tr>
    ${traceRows || '<tr><td colspan="6" style="text-align:center;color:#999">No traces received yet</td></tr>'}
  </table>

  <p style="margin-top:20px;font-size:12px;color:#888">
    Collector: <a href="/metrics">/metrics</a> ·
    <a href="/api/v1/targets">/api/v1/targets</a> ·
    <a href="/api/v1/alerts">/api/v1/alerts</a> ·
    <a href="/api/v1/traces">/api/v1/traces</a> ·
    <a href="/healthz">/healthz</a>
  </p>
</body>
</html>`;
}
