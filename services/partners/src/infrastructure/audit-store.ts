/**
 * PostgreSQL adapter for partner audit log (AuditStore).
 *
 * Implements AuditStore using the `partner_audit_log` table.
 *
 * Key design decisions (ADR-048):
 * - Append-only: no UPDATE or DELETE operations.
 * - `entry_id` is a database-generated identity column (BIGINT).
 * - `metadata` is JSONB for flexible structured data.
 */

import type { Pool, PoolClient } from "pg";
import type { AuditEntry } from "../domain/lifecycle.js";
import type { AuditStore } from "../ports.js";

const APPEND_AUDIT = `
  INSERT INTO partner_audit_log (actor_public_id, tenant_store_id, action, metadata)
  VALUES ($1, $2, $3, $4)
  RETURNING entry_id, actor_public_id, tenant_store_id::text, action,
    metadata, created_at::timestamptz::text
`;

const LIST_AUDIT = `
  SELECT entry_id, actor_public_id, tenant_store_id::text, action,
    metadata, created_at::timestamptz::text
  FROM partner_audit_log
  WHERE tenant_store_id = $1
  ORDER BY created_at DESC
  LIMIT $2
`;

interface AuditRow {
  entry_id: string;
  actor_public_id: string;
  tenant_store_id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

function rowToAudit(row: AuditRow): AuditEntry {
  return {
    actorPublicId: row.actor_public_id,
    tenantStoreId: row.tenant_store_id,
    action: row.action as AuditEntry["action"],
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export class PgAuditStore implements AuditStore {
  constructor(private pool: Pool | PoolClient) {}

  async append(entry: Omit<AuditEntry, "createdAt">): Promise<AuditEntry> {
    const result = await this.pool.query(APPEND_AUDIT, [
      entry.actorPublicId,
      entry.tenantStoreId,
      entry.action,
      JSON.stringify(entry.metadata),
    ]);
    return rowToAudit(result.rows[0]);
  }

  async listByTenant(storeId: string, limit: number): Promise<AuditEntry[]> {
    const result = await this.pool.query(LIST_AUDIT, [storeId, limit]);
    return result.rows.map(rowToAudit);
  }
}
