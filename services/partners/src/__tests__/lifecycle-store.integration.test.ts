/**
 * Integration test: PgLifecycleStore against real PostgreSQL.
 *
 * Verifies:
 * - Create lifecycle entry → row persisted with 'pending' state
 * - Get lifecycle → returns entry by store_id
 * - Transition lifecycle → state changes correctly
 * - Transition to 'suspended' sets suspended_at and reason
 * - Transition to 'offboarded' sets offboarded_at
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PgLifecycleStore } from "../infrastructure/lifecycle-store";
import { newUuid } from "../infrastructure/pg";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  type PgFixture,
} from "./pg-harness";

const SKIP = !PG_ENABLED;

describe.skipIf(SKIP)("PgLifecycleStore", () => {
  let fixture: PgFixture;
  let store: PgLifecycleStore;

  beforeAll(async () => {
    fixture = await setupPostgres();
    store = new PgLifecycleStore(fixture.pool);
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("creates a lifecycle entry with pending state", async () => {
    const storeId = newUuid();
    const result = await store.create(storeId, "standard");

    expect(result.tenantStoreId).toBe(storeId);
    expect(result.state).toBe("pending");
    expect(result.slaTier).toBe("standard");
    expect(result.suspendedReason).toBeNull();
    expect(result.suspendedAt).toBeNull();
    expect(result.offboardedAt).toBeNull();
    expect(result.createdAt).toBeTruthy();
    expect(result.updatedAt).toBeTruthy();
  });

  it("gets a lifecycle entry by store id", async () => {
    const storeId = newUuid();
    await store.create(storeId, "enterprise");

    const result = await store.get(storeId);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("pending");
    expect(result!.slaTier).toBe("enterprise");
  });

  it("returns null when getting non-existent lifecycle", async () => {
    const result = await store.get(newUuid());
    expect(result).toBeNull();
  });

  it("transitions from pending to approved", async () => {
    const storeId = newUuid();
    await store.create(storeId, "standard");

    const result = await store.transition(storeId, "approved");
    expect(result.state).toBe("approved");
  });

  it("transitions to suspended and sets reason and timestamp", async () => {
    const storeId = newUuid();
    await store.create(storeId, "standard");
    await store.transition(storeId, "approved");
    await store.transition(storeId, "active");

    const result = await store.transition(storeId, "suspended", "SLA violation");

    expect(result.state).toBe("suspended");
    expect(result.suspendedReason).toBe("SLA violation");
    expect(result.suspendedAt).not.toBeNull();
  });

  it("transitions to offboarded and sets timestamp", async () => {
    const storeId = newUuid();
    await store.create(storeId, "standard");
    await store.transition(storeId, "approved");
    await store.transition(storeId, "active");

    const result = await store.transition(storeId, "offboarded");

    expect(result.state).toBe("offboarded");
    expect(result.offboardedAt).not.toBeNull();
  });
});
