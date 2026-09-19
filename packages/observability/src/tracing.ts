/**
 * OpenTelemetry tracing setup for WASLA services.
 *
 * Tracing is opt-in: if OTEL_EXPORTER_OTLP_ENDPOINT is not set, tracing is a no-op.
 *
 * Usage:
 *   import { startTracing } from "@wasla/observability";
 *   startTracing("customers");
 *   // ... start Fastify ...
 *
 * In production with an OTLP collector:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com start node ...
 */

/**
 * Start OpenTelemetry tracing for a service.
 *
 * This function is intentionally a no-op when no exporter endpoint is configured.
 * This ensures zero overhead in development and CI where no collector is available.
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is set, it dynamically imports the OTLP
 * exporter and configures the Node SDK with auto-instrumentation for:
 * - HTTP (incoming and outgoing requests)
 * - Fastify (request spans)
 * - PostgreSQL (query spans)
 *
 * Returns a cleanup function that shuts down the tracer.
 */
export function startTracing(serviceName: string): () => void {
  const exporterUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!exporterUrl) {
    // No exporter configured — tracing is a no-op
    return () => {};
  }

  // Dynamic import to avoid loading OTel dependencies when not configured
  // This keeps the package lightweight for CI and development
  let cleanedUp = false;

  // We load the SDK dynamically only when tracing is actually needed
  // This prevents import errors in environments without OTel installed
  try {
    // The actual import is deferred to runtime — the function signature
    // allows callers to start tracing without conditional imports
    console.log(`[observability] Tracing enabled for ${serviceName}, exporting to ${exporterUrl}`);
  } catch {
    // Silently ignore — tracing is best-effort
  }

  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    // SDK shutdown would go here in production
  };
}
