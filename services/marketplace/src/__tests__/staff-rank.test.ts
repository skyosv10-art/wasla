/**
 * Unit tests for assertStaffManager — RISK-0042 debt 1 (CLM-0419).
 *
 * The store owner (stores.owner_public_id) and active managers may manage staff;
 * active `staff` members and removed managers may not.
 */
import { describe, expect, it } from "vitest";

import type { StoreStaffEntry } from "../domain/model.js";
import { assertStaffManager, StaffRankForbidden } from "../domain/staff.js";

describe("assertStaffManager — RISK-0042 debt 1 (CLM-0419)", () => {
  const entry = (memberPublicId: string, role: "owner" | "manager" | "staff", removed = false): StoreStaffEntry =>
    ({
      staffId: `s-${memberPublicId}`,
      memberPublicId,
      role,
      addedByPublicId: "WS-1000000001",
      addedAt: "2026-09-30T00:00:00.000Z",
      ...(removed ? { removedAt: "2026-09-30T01:00:00.000Z", removedByPublicId: "WS-1000000001" } : {}),
    }) as unknown as StoreStaffEntry;
  const owner = "WS-1000000001";
  it("the store owner (stores.owner_public_id) passes without a staff row", () => {
    expect(() => assertStaffManager({ actorPublicId: owner, storeOwnerPublicId: owner, existing: [] })).not.toThrow();
  });
  it("an active manager passes", () => {
    expect(() =>
      assertStaffManager({ actorPublicId: "WS-1000000002", storeOwnerPublicId: owner, existing: [entry("WS-1000000002", "manager")] }),
    ).not.toThrow();
  });
  it("an active `staff` member is refused with StaffRankForbidden", () => {
    expect(() =>
      assertStaffManager({ actorPublicId: "WS-1000000003", storeOwnerPublicId: owner, existing: [entry("WS-1000000003", "staff")] }),
    ).toThrow(StaffRankForbidden);
  });
  it("a removed manager is refused", () => {
    expect(() =>
      assertStaffManager({ actorPublicId: "WS-1000000004", storeOwnerPublicId: owner, existing: [entry("WS-1000000004", "manager", true)] }),
    ).toThrow(StaffRankForbidden);
  });
});
