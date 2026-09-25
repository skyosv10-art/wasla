/**
 * Integration test: PgCredentialStore against real PostgreSQL.
 *
 * Verifies:
 * - Create credential → row persisted with correct fields
 * - List by tenant → returns only that tenant's credentials
 * - Revoke credential → state changes to 'revoked', revoked_at set
 * - Find by hash → returns active credential only
 * - Tenant isolation: credentials from other tenants are not returned
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PgCredentialStore } from "../infrastructure/credential-store";
import { newUuid, nowIso } from "../infrastructure/pg";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  countRows,
  type PgFixture,
} from "./pg-harness";

const SKIP = !PG_ENABLED;

describe.skipIf(SKIP)("PgCredentialStore", () => {
  let fixture: PgFixture;
  let store: PgCredentialStore;

  beforeAll(async () => {
    fixture = await setupPostgres();
    store = new PgCredentialStore(fixture.pool);
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("creates a credential and persists all fields", async () => {
    const credentialId = newUuid();
    const tenantStoreId = newUuid();
    const input = {
      credentialId,
      tenantStoreId,
      issuedByPublicId: "WS-1000000001",
      keyPrefix: "wsk_abc12",
      keyHash: "sha256:" + "a".repeat(64),
      scopes: ["partners:credentials:read"],
      state: "active" as const,
    };

    const result = await store.create(input);

    expect(result.credentialId).toBe(credentialId);
    expect(result.tenantStoreId).toBe(tenantStoreId);
    expect(result.issuedByPublicId).toBe("WS-1000000001");
    expect(result.keyPrefix).toBe("wsk_abc12");
    expect(result.scopes).toEqual(["partners:credentials:read"]);
    expect(result.state).toBe("active");
    expect(result.createdAt).toBeTruthy();
    expect(result.revokedAt).toBeNull();
    expect(await countRows(fixture.pool, "partner_api_credentials")).toBe(1);
  });

  it("lists credentials by tenant (tenant isolation)", async () => {
    const tenant1 = newUuid();
    const tenant2 = newUuid();

    await store.create({
      credentialId: newUuid(),
      tenantStoreId: tenant1,
      issuedByPublicId: "WS-1000000001",
      keyPrefix: "wsk_aaaa1",
      keyHash: "sha256:" + "1".repeat(64),
      scopes: [],
      state: "active",
    });

    await store.create({
      credentialId: newUuid(),
      tenantStoreId: tenant2,
      issuedByPublicId: "WS-1000000002",
      keyPrefix: "wsk_bbbb2",
      keyHash: "sha256:" + "2".repeat(64),
      scopes: [],
      state: "active",
    });

    const tenant1Creds = await store.listByTenant(tenant1);
    const tenant2Creds = await store.listByTenant(tenant2);

    expect(tenant1Creds).toHaveLength(1);
    expect(tenant1Creds[0].keyPrefix).toBe("wsk_aaaa1");
    expect(tenant2Creds).toHaveLength(1);
    expect(tenant2Creds[0].keyPrefix).toBe("wsk_bbbb2");
  });

  it("revokes a credential and sets revoked_at", async () => {
    const credentialId = newUuid();
    const tenantStoreId = newUuid();
    await store.create({
      credentialId,
      tenantStoreId,
      issuedByPublicId: "WS-1000000001",
      keyPrefix: "wsk_rev1",
      keyHash: "sha256:" + "r".repeat(64),
      scopes: [],
      state: "active",
    });

    const revokedAt = nowIso();
    const result = await store.revoke(credentialId, revokedAt);

    expect(result).not.toBeNull();
    expect(result!.state).toBe("revoked");
    expect(result!.revokedAt).not.toBeNull();
  });

  it("returns null when revoking a non-existent credential", async () => {
    const result = await store.revoke(newUuid(), nowIso());
    expect(result).toBeNull();
  });

  it("finds an active credential by hash", async () => {
    const keyHash = "sha256:" + "f".repeat(64);
    await store.create({
      credentialId: newUuid(),
      tenantStoreId: newUuid(),
      issuedByPublicId: "WS-1000000001",
      keyPrefix: "wsk_find1",
      keyHash,
      scopes: ["partners:credentials:read"],
      state: "active",
    });

    const found = await store.findByHash(keyHash);
    expect(found).not.toBeNull();
    expect(found!.keyPrefix).toBe("wsk_find1");
    expect(found!.scopes).toEqual(["partners:credentials:read"]);
  });

  it("does not find a revoked credential by hash", async () => {
    const keyHash = "sha256:" + "x".repeat(64);
    const credentialId = newUuid();
    await store.create({
      credentialId,
      tenantStoreId: newUuid(),
      issuedByPublicId: "WS-1000000001",
      keyPrefix: "wsk_rev2",
      keyHash,
      scopes: [],
      state: "active",
    });

    await store.revoke(credentialId, nowIso());

    const found = await store.findByHash(keyHash);
    expect(found).toBeNull();
  });
});
