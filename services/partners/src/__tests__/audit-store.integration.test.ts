/**
 * Integration test: PgAuditStore against real PostgreSQL.
 *
 * Verifies:
 * - Append audit entry → row persisted with all fields
 * - List by tenant → returns entries ordered by created_at DESC
 * - Limit is respected
 * - Metadata is stored as JSONB
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PgAuditStore } from "../infrastructure/audit-store";
import { newUuid } from "../infrastructure/pg";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  countRows,
  type PgFixture,
} from "./pg-harness";

const SKIP = !PG_ENABLED;

describe.skipIf(SKIP)("PgAuditStore", () => {
  let fixture: PgFixture;
  let store: PgAuditStore;

  beforeAll(async () => {
    fixture = await setupPostgres();
    store = new PgAuditStore(fixture.pool);
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("appends an audit entry and returns it", async () => {
    const tenantStoreId = newUuid();
    const result = await store.append({
      actorPublicId: "WS-1000000001",
      tenantStoreId,
      action: "credential.issued",
      metadata: { credentialId: newUuid(), scopes: ["partners:credentials:read"] },
    });

    expect(result.actorPublicId).toBe("WS-1000000001");
    expect(result.tenantStoreId).toBe(tenantStoreId);
    expect(result.action).toBe("credential.issued");
    expect(result.metadata).toEqual({
      credentialId: expect.any(String),
      scopes: ["partners:credentials:read"],
    });
    expect(result.createdAt).toBeTruthy();
    expect(await countRows(fixture.pool, "partner_audit_log")).toBe(1);
  });

  it("lists entries by tenant ordered by created_at DESC", async () => {
    const tenantStoreId = newUuid();

    await store.append({
      actorPublicId: "WS-1000000001",
      tenantStoreId,
      action: "credential.issued",
      metadata: { seq: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await store.append({
      actorPublicId: "WS-1000000002",
      tenantStoreId,
      action: "credential.revoked",
      metadata: { seq: 2 },
    });

    const entries = await store.listByTenant(tenantStoreId, 10);

    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe("credential.revoked");
    expect(entries[1].action).toBe("credential.issued");
  });

  it("respects the limit parameter", async () => {
    const tenantStoreId = newUuid();
    for (let i = 0; i < 5; i++) {
      await store.append({
        actorPublicId: "WS-1000000001",
        tenantStoreId,
        action: "credential.issued",
        metadata: { seq: i },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const entries = await store.listByTenant(tenantStoreId, 3);
    expect(entries).toHaveLength(3);
  });

  it("does not return entries from other tenants", async () => {
    const tenant1 = newUuid();
    const tenant2 = newUuid();

    await store.append({
      actorPublicId: "WS-1000000001",
      tenantStoreId: tenant1,
      action: "credential.issued",
      metadata: {},
    });

    await store.append({
      actorPublicId: "WS-1000000002",
      tenantStoreId: tenant2,
      action: "credential.issued",
      metadata: {},
    });

    const tenant1Entries = await store.listByTenant(tenant1, 10);
    const tenant2Entries = await store.listByTenant(tenant2, 10);

    expect(tenant1Entries).toHaveLength(1);
    expect(tenant2Entries).toHaveLength(1);
  });
});
