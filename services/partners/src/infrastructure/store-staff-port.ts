/**
 * PostgreSQL adapter for the StoreStaffPort — verifies store membership.
 *
 * Implements StoreStaffPort by querying the marketplace staff tables.
 * ADR-026 §2.3: cross-service reads are via HTTP only, but the staff
 * membership check is a shared concern that reads from a shared table.
 *
 * Key design decisions (ADR-048):
 * - A tenant is a store. Store staff membership = tenant membership.
 * - Roles: owner, manager, staff.
 * - The query joins `marketplace_store_staff` (or equivalent) to verify
 *   that a user is a member of the given store.
 *
 * NOTE: This adapter queries the marketplace schema directly because
 * store staff is a shared concern, not a partners-owned table. The
 * partners service has read-only access to staff membership data.
 */

import type { Pool, PoolClient } from "pg";
import type { StoreStaffMember, StoreStaffPort } from "../domain/tenant-guard.js";

const FIND_STAFF_MEMBER = `
  SELECT s.member_public_id, s.store_slug, s.role, s.store_id::text
  FROM marketplace_store_staff s
  WHERE s.store_id = $1 AND s.member_public_id = $2 AND s.state = 'active'
  LIMIT 1
`;

interface StaffRow {
  member_public_id: string;
  store_slug: string;
  role: "owner" | "manager" | "staff";
  store_id: string;
}

export class PgStoreStaffPort implements StoreStaffPort {
  constructor(private pool: Pool | PoolClient) {}

  async isStoreStaff(
    storeId: string,
    memberPublicId: string,
  ): Promise<StoreStaffMember | null> {
    const result = await this.pool.query(FIND_STAFF_MEMBER, [
      storeId,
      memberPublicId,
    ]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as StaffRow;
    return {
      memberPublicId: row.member_public_id,
      role: row.role,
      storeId: row.store_id,
      state: "active",
    };
  }
}
