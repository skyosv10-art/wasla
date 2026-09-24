// WASLA Observability Collector — M2-08 Stage B
// Replaces Prometheus + Alertmanager + OTLP collector with a single Node.js service.
// Uses the existing wasla Dockerfile and build pipeline (ADR-041).
//
// Endpoints:
//   GET  /                — HTML dashboard
//   GET  /healthz         — health check
//   GET  /metrics         — collector's own Prometheus metrics
//   GET  /api/v1/targets  — scrape targets status (Prometheus-compatible)
//   GET  /api/v1/alerts   — alert states (Prometheus-compatible)
//   GET  /api/v1/traces   — recent OTLP traces
//   POST /v1/traces       — OTLP HTTP/JSON trace receiver

import http from 'node:http';
import { readPortEnv } from '@wasla/config';
import { scraper } from './scraper.js';
import { alertEvaluator } from './alerts.js';
import { otlpReceiver } from './otlp.js';
import { renderDashboard } from './dashboard.js';
import { WASLA_SERVICES } from './config.js';

const PORT = readPortEnv(process.env, 'PORT', 3000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && path === '/') {
      const html = renderDashboard();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'wasla-observability-collector',
        uptime: process.uptime(),
        scrapeCount: scraper.getScrapeCount(),
        evalCount: alertEvaluator.getEvalCount(),
        traceCount: otlpReceiver.getTraceCount(),
      }));
      return;
    }

    if (req.method === 'GET' && path === '/metrics') {
      const results = scraper.getResults();
      const upCount = results.filter(r => r.status === 'up').length;
      const downCount = results.filter(r => r.status === 'down').length;
      const totalLines = results.reduce((s, r) => s + r.lineCount, 0);
      const firing = alertEvaluator.getFiringAlerts().length;
      const lines: string[] = [
        '# WASLA Observability Collector metrics',
        '# HELP wasla_collector_services_up Number of WASLA services reporting metrics',
        '# TYPE wasla_collector_services_up gauge',
        `wasla_collector_services_up ${upCount}`,
        '# HELP wasla_collector_services_down Number of WASLA services down',
        '# TYPE wasla_collector_services_down gauge',
        `wasla_collector_services_down ${downCount}`,
        '# HELP wasla_collector_metrics_lines_total Total metric lines scraped',
        '# TYPE wasla_collector_metrics_lines_total gauge',
        `wasla_collector_metrics_lines_total ${totalLines}`,
        '# HELP wasla_collector_alerts_firing Number of alerts currently firing',
        '# TYPE wasla_collector_alerts_firing gauge',
        `wasla_collector_alerts_firing ${firing}`,
        '# HELP wasla_collector_traces_received_total Total OTLP traces received',
        '# TYPE wasla_collector_traces_received_total counter',
        `wasla_collector_traces_received_total ${otlpReceiver.getTraceCount()}`,
        '# HELP wasla_collector_scrape_cycles_total Total scrape cycles completed',
        '# TYPE wasla_collector_scrape_cycles_total counter',
        `wasla_collector_scrape_cycles_total ${scraper.getScrapeCount()}`,
      ];

      for (const r of results) {
        lines.push(`# TYPE wasla_service_up gauge`);
        lines.push(`wasla_service_up{service="${r.service}"} ${r.status === 'up' ? 1 : 0}`);
        lines.push(`wasla_service_metric_lines{service="${r.service}"} ${r.lineCount}`);
      }

      for (const r of results) {
        if (r.status === 'up' && r.metricsRaw) {
          for (const line of r.metricsRaw.split('\n')) {
            if (line.startsWith('#') || line.trim() === '') {
              lines.push(line);
              continue;
            }
            if (line.includes('{') && !line.includes('service=')) {
              lines.push(line.replace('{', `{service="${r.service}",`));
            } else if (!line.includes('{')) {
              const parts = line.split(/\s+/);
              if (parts.length >= 2) {
                lines.push(`${parts[0]}{service="${r.service}"} ${parts.slice(1).join(' ')}`);
              }
            } else {
              lines.push(line);
            }
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(lines.join('\n'));
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/targets') {
      const results = scraper.getResults();
      const targets = results.map(r => ({
        labels: {
          job: 'wasla-services',
          instance: r.service,
          environment: 'staging',
          platform: 'render',
        },
        scrapedUrl: r.url,
        lastError: r.error || '',
        lastScrape: new Date(r.scrapedAt).toISOString(),
        health: r.status === 'up' ? 'up' : 'down',
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { activeTargets: targets } }));
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/alerts') {
      const alerts = alertEvaluator.getAlerts().map(a => ({
        labels: {
          alertname: a.name,
          severity: a.severity,
          sli: a.sli,
        },
        state: a.state,
        activeAt: new Date(a.lastEvaluated).toISOString(),
        value: a.value,
        annotations: {
          summary: a.description,
          description: a.description,
        },
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { alerts } }));
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/traces') {
      const traces = otlpReceiver.getRecentTraces(50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { traces, total: otlpReceiver.getTraceCount() } }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/traces') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          const result = otlpReceiver.receiveTraces(json);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', ...result }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: `Unknown path: ${path}` }));
  } catch (err: any) {
    console.error('[server] Error handling %s %s:', req.method, path, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});

server.listen(PORT, () => {
  console.log('===========================================================');
  console.log('  WASLA Observability Collector — M2-08 Stage B');
  console.log('  ADR-041 · Node.js collector · %d services', WASLA_SERVICES.length);
  console.log('  Listening on :%d', PORT);
  console.log('===========================================================');
  console.log('');
  console.log('  Dashboard:  http://localhost:%d/', PORT);
  console.log('  Metrics:    http://localhost:%d/metrics', PORT);
  console.log('  Targets:    http://localhost:%d/api/v1/targets', PORT);
  console.log('  Alerts:     http://localhost:%d/api/v1/alerts', PORT);
  console.log('  Traces:     POST http://localhost:%d/v1/traces', PORT);
  console.log('  Health:     http://localhost:%d/healthz', PORT);
  console.log('');

  scraper.start();
  alertEvaluator.start();
  console.log('[collector] Scraper and alert evaluator started');
});

process.on('SIGTERM', () => {
  console.log('[collector] SIGTERM — shutting down');
  scraper.stop();
  alertEvaluator.stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[collector] SIGINT — shutting down');
  scraper.stop();
  alertEvaluator.stop();
  server.close(() => process.exit(0));
});
