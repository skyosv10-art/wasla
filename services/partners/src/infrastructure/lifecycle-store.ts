/**
 * PostgreSQL adapter for partner lifecycle (LifecycleStore).
 *
 * Implements LifecycleStore using the `partner_lifecycle` table.
 *
 * Key design decisions (ADR-048):
 * - One row per store (tenant_store_id is PRIMARY KEY).
 * - State transitions are validated by CHECK constraints.
 * - `suspended_at` and `offboarded_at` are paired with state via CHECK.
 * - `updated_at` is set on every transition.
 */

import type { Pool, PoolClient } from "pg";
import type { LifecycleState, SlaTier } from "../domain/lifecycle.js";
import type { LifecycleStore, PartnerLifecycleEntry } from "../ports.js";

const GET_LIFECYCLE = `
  SELECT tenant_store_id::text, state, sla_tier, suspended_reason,
    suspended_at::timestamptz::text, offboarded_at::timestamptz::text,
    created_at::timestamptz::text, updated_at::timestamptz::text
  FROM partner_lifecycle
  WHERE tenant_store_id = $1
`;

const CREATE_LIFECYCLE = `
  INSERT INTO partner_lifecycle (tenant_store_id, state, sla_tier)
  VALUES ($1, 'pending', $2)
  RETURNING tenant_store_id::text, state, sla_tier, suspended_reason,
    suspended_at::timestamptz::text, offboarded_at::timestamptz::text,
    created_at::timestamptz::text, updated_at::timestamptz::text
`;

const TRANSITION_LIFECYCLE = `
  UPDATE partner_lifecycle
  SET state = $2,
    updated_at = now(),
    suspended_reason = CASE WHEN $2 = 'suspended' THEN $3 ELSE NULL END,
    suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END,
    offboarded_at = CASE WHEN $2 = 'offboarded' THEN now() ELSE offboarded_at END
  WHERE tenant_store_id = $1
  RETURNING tenant_store_id::text, state, sla_tier, suspended_reason,
    suspended_at::timestamptz::text, offboarded_at::timestamptz::text,
    created_at::timestamptz::text, updated_at::timestamptz::text
`;

interface LifecycleRow {
  tenant_store_id: string;
  state: LifecycleState;
  sla_tier: SlaTier;
  suspended_reason: string | null;
  suspended_at: string | null;
  offboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLifecycle(row: LifecycleRow): PartnerLifecycleEntry {
  return {
    tenantStoreId: row.tenant_store_id,
    state: row.state,
    slaTier: row.sla_tier,
    suspendedReason: row.suspended_reason,
    suspendedAt: row.suspended_at,
    offboardedAt: row.offboarded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgLifecycleStore implements LifecycleStore {
  constructor(private pool: Pool | PoolClient) {}

  async get(storeId: string): Promise<PartnerLifecycleEntry | null> {
    const result = await this.pool.query(GET_LIFECYCLE, [storeId]);
    if (result.rows.length === 0) return null;
    return rowToLifecycle(result.rows[0]);
  }

  async create(storeId: string, slaTier: SlaTier): Promise<PartnerLifecycleEntry> {
    const result = await this.pool.query(CREATE_LIFECYCLE, [storeId, slaTier]);
    return rowToLifecycle(result.rows[0]);
  }

  async transition(
    storeId: string,
    to: LifecycleState,
    reason?: string,
  ): Promise<PartnerLifecycleEntry> {
    const result = await this.pool.query(TRANSITION_LIFECYCLE, [
      storeId,
      to,
      reason || null,
    ]);
    if (result.rows.length === 0) {
      throw new Error(`Lifecycle not found for store ${storeId}`);
    }
    return rowToLifecycle(result.rows[0]);
  }
}
