/**
 * PostgreSQL adapter for partner usage counters (UsageStore).
 *
 * Implements UsageStore using the `partner_usage_counters` table.
 *
 * Key design decisions (ADR-048):
 * - Counters are per-tenant, per-window (hourly).
 * - Upsert with increment: `ON CONFLICT DO UPDATE SET api_calls = api_calls + 1`.
 * - This is not a distributed rate limiter — it's a usage meter for SLA reporting.
 */

import type { Pool, PoolClient } from "pg";
import type { UsageCounter } from "../domain/lifecycle.js";
import type { UsageStore } from "../ports.js";

const INCREMENT_API_CALLS = `
  INSERT INTO partner_usage_counters (tenant_store_id, window_start, api_calls, webhook_deliveries)
  VALUES ($1, $2, 1, 0)
  ON CONFLICT (tenant_store_id, window_start)
  DO UPDATE SET api_calls = partner_usage_counters.api_calls + 1
  RETURNING tenant_store_id::text, window_start::timestamptz::text, api_calls, webhook_deliveries
`;

const INCREMENT_WEBHOOK_DELIVERIES = `
  INSERT INTO partner_usage_counters (tenant_store_id, window_start, api_calls, webhook_deliveries)
  VALUES ($1, $2, 0, 1)
  ON CONFLICT (tenant_store_id, window_start)
  DO UPDATE SET webhook_deliveries = partner_usage_counters.webhook_deliveries + 1
  RETURNING tenant_store_id::text, window_start::timestamptz::text, api_calls, webhook_deliveries
`;

const GET_COUNTER = `
  SELECT tenant_store_id::text, window_start::timestamptz::text, api_calls, webhook_deliveries
  FROM partner_usage_counters
  WHERE tenant_store_id = $1 AND window_start = $2
`;

interface UsageRow {
  tenant_store_id: string;
  window_start: string;
  api_calls: string;
  webhook_deliveries: string;
}

function rowToUsage(row: UsageRow): UsageCounter {
  return {
    tenantStoreId: row.tenant_store_id,
    windowStart: row.window_start,
    apiCalls: parseInt(row.api_calls, 10),
    webhookDeliveries: parseInt(row.webhook_deliveries, 10),
  };
}

export class PgUsageStore implements UsageStore {
  constructor(private pool: Pool | PoolClient) {}

  async incrementApiCalls(storeId: string, windowStart: string): Promise<UsageCounter> {
    const result = await this.pool.query(INCREMENT_API_CALLS, [storeId, windowStart]);
    return rowToUsage(result.rows[0]);
  }

  async incrementWebhookDeliveries(storeId: string, windowStart: string): Promise<UsageCounter> {
    const result = await this.pool.query(INCREMENT_WEBHOOK_DELIVERIES, [storeId, windowStart]);
    return rowToUsage(result.rows[0]);
  }

  async get(storeId: string, windowStart: string): Promise<UsageCounter | null> {
    const result = await this.pool.query(GET_COUNTER, [storeId, windowStart]);
    if (result.rows.length === 0) return null;
    return rowToUsage(result.rows[0]);
  }
}
