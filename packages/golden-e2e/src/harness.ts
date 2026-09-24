/**
 * M4-02 Golden Journey harness — staging URL builder and HTTP client.
 *
 * Service URLs follow the Render convention: https://wasla-<service>.onrender.com
 * The observability collector is at https://wasla-observability.onrender.com
 *
 * Environment:
 *   GOLDEN_STAGING_BASE — if unset, tests skip (not running against staging)
 *   GOLDEN_SERVICE_AUTH_KEY — if set, sent as x-wasla-service-auth header
 *   GOLDAL_SERVICE_AUTH_KID — key ID for the auth header
 *
 * This harness is intentionally minimal: it builds URLs, makes fetch calls,
 * and returns structured results. Journey tests use it to drive staging.
 */

export interface StagingConfig {
  /** Base URL convention: https://wasla-<service>.onrender.com */
  readonly enabled: boolean;
  /** Service auth key (optional — some endpoints require it) */
  readonly authKey?: string;
  readonly authKid?: string;
}

export function stagingConfig(): StagingConfig {
  const enabled = !!process.env.GOLDEN_STAGING_BASE;
  return {
    enabled,
    authKey: process.env.GOLDEN_SERVICE_AUTH_KEY,
    authKid: process.env.GOLDEN_SERVICE_AUTH_KID,
  };
}

export function serviceUrl(service: string, path: string = "/health"): string {
  return `https://wasla-${service}.onrender.com${path}`;
}

export function observatoryUrl(path: string = "/healthz"): string {
  return `https://wasla-observability.onrender.com${path}`;
}

export interface FetchResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
  readonly durationMs: number;
}

export async function fetchJson(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    authKey?: string;
    authKid?: string;
  } = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...opts.headers,
  };
  if (opts.authKey) {
    headers["x-wasla-service-auth"] = opts.authKid
      ? `${opts.authKid}:${opts.authKey}`
      : opts.authKey;
  }
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep as text
    }
    return {
      ok: res.ok,
      status: res.status,
      body,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * All services in the golden journey scope, mapped to their health endpoints.
 */
export const GOLDEN_SERVICES = [
  "identity",
  "customers",
  "drivers",
  "geography",
  "orders",
  "delivery",
  "dispatch",
  "matching",
  "negotiations",
  "marketplace",
  "search",
  "subscriptions",
  "reputation",
  "audit",
] as const;

export type GoldenService = (typeof GOLDEN_SERVICES)[number];

/**
 * Service prefix → service name mapping (from infra/render/app-rewrites.json).
 */
export const SERVICE_PREFIXES: Record<string, string> = {
  "/audit": "audit",
  "/candidacy": "matching",
  "/categories": "marketplace",
  "/customers": "customers",
  "/delivery": "delivery",
  "/dispatch": "dispatch",
  "/drivers": "drivers",
  "/geo": "geography",
  "/identity": "identity",
  "/matching": "matching",
  "/negotiations": "negotiations",
  "/orders": "orders",
  "/products": "marketplace",
  "/referrals": "subscriptions",
  "/reputation": "reputation",
  "/search": "search",
  "/store-orders": "delivery",
  "/stores": "marketplace",
  "/subscriptions": "subscriptions",
};
