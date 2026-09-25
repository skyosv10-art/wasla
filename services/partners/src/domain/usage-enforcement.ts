/**
 * Usage counter enforcement — rate limiting per tenant.
 *
 * (ADR-048 §5):
 * - Usage limits are per-tenant, not per-user.
 * - Default limits: 1000 API calls/hour, 100 webhook deliveries/hour.
 * - Enforcement is advisory: it counts and warns, does not hard-block.
 *   Hard blocking is a policy decision left to the API gateway.
 *
 * This module computes the current usage window and checks limits.
 */

import type { UsageStore } from "../ports.js";

export type { UsageCounter } from "./lifecycle.js";
export type { UsageStore } from "../ports.js";

export const DEFAULT_API_CALL_LIMIT = 1000;
export const DEFAULT_WEBHOOK_DELIVERY_LIMIT = 100;
export const WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour

export interface UsageLimits {
  apiCallsPerWindow: number;
  webhookDeliveriesPerWindow: number;
}

export interface UsageCheckResult {
  readonly allowed: boolean;
  readonly apiCallsRemaining: number;
  readonly webhookDeliveriesRemaining: number;
  readonly windowStart: string;
  readonly limit: UsageLimits;
}

export function currentWindowStart(now: Date = new Date()): string {
  const windowStart = new Date(
    Math.floor(now.getTime() / WINDOW_DURATION_MS) * WINDOW_DURATION_MS,
  );
  return windowStart.toISOString();
}

export async function checkUsage(
  store: UsageStore,
  tenantStoreId: string,
  limits: UsageLimits = {
    apiCallsPerWindow: DEFAULT_API_CALL_LIMIT,
    webhookDeliveriesPerWindow: DEFAULT_WEBHOOK_DELIVERY_LIMIT,
  },
  now: Date = new Date(),
): Promise<UsageCheckResult> {
  const windowStart = currentWindowStart(now);
  const counter = await store.get(tenantStoreId, windowStart);

  const apiCalls = counter?.apiCalls ?? 0;
  const webhookDeliveries = counter?.webhookDeliveries ?? 0;

  const apiCallsRemaining = Math.max(0, limits.apiCallsPerWindow - apiCalls);
  const webhookDeliveriesRemaining = Math.max(
    0,
    limits.webhookDeliveriesPerWindow - webhookDeliveries,
  );

  return {
    allowed: apiCalls < limits.apiCallsPerWindow,
    apiCallsRemaining,
    webhookDeliveriesRemaining,
    windowStart,
    limit: limits,
  };
}

export async function incrementApiCall(
  store: UsageStore,
  tenantStoreId: string,
  now: Date = new Date(),
): Promise<void> {
  const windowStart = currentWindowStart(now);
  await store.incrementApiCalls(tenantStoreId, windowStart);
}

export async function incrementWebhookDelivery(
  store: UsageStore,
  tenantStoreId: string,
  now: Date = new Date(),
): Promise<void> {
  const windowStart = currentWindowStart(now);
  await store.incrementWebhookDeliveries(tenantStoreId, windowStart);
}
