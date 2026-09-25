import { describe, it, expect, vi } from "vitest";
import { assertTenantMember, assertTenantRole, TenantAccessDeniedError, TenantRoleError } from "../domain/tenant-guard";
import type { StoreStaffPort, StoreStaffMember } from "../domain/tenant-guard";

function mockStaffPort(member: StoreStaffMember | null): StoreStaffPort {
  return {
    isStoreStaff: vi.fn().mockResolvedValue(member),
  };
}

describe("tenant guard", () => {
  it("allows access for active staff member", async () => {
    const member: StoreStaffMember = {
      storeId: "store-1",
      memberPublicId: "WS-0000000001",
      role: "owner",
      state: "active",
    };
    const port = mockStaffPort(member);
    const result = await assertTenantMember(port, "store-1", "WS-0000000001");
    expect(result.role).toBe("owner");
  });

  it("denies access for non-member", async () => {
    const port = mockStaffPort(null);
    await expect(assertTenantMember(port, "store-1", "WS-0000000002")).rejects.toThrow(TenantAccessDeniedError);
  });

  it("denies access for removed staff member", async () => {
    const member: StoreStaffMember = {
      storeId: "store-1",
      memberPublicId: "WS-0000000003",
      role: "staff",
      state: "removed",
    };
    const port = mockStaffPort(member);
    await expect(assertTenantMember(port, "store-1", "WS-0000000003")).rejects.toThrow(TenantAccessDeniedError);
  });

  it("assertTenantRole allows owner for [owner, manager]", () => {
    const member: StoreStaffMember = {
      storeId: "store-1",
      memberPublicId: "WS-0000000001",
      role: "owner",
      state: "active",
    };
    expect(() => assertTenantRole(member, ["owner", "manager"])).not.toThrow();
  });

  it("assertTenantRole rejects staff for [owner, manager]", () => {
    const member: StoreStaffMember = {
      storeId: "store-1",
      memberPublicId: "WS-0000000001",
      role: "staff",
      state: "active",
    };
    expect(() => assertTenantRole(member, ["owner", "manager"])).toThrow(TenantRoleError);
  });

  it("assertTenantRole allows staff for [owner, manager, staff]", () => {
    const member: StoreStaffMember = {
      storeId: "store-1",
      memberPublicId: "WS-0000000001",
      role: "staff",
      state: "active",
    };
    expect(() => assertTenantRole(member, ["owner", "manager", "staff"])).not.toThrow();
  });
});
