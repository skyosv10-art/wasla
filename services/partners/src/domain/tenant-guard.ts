/**
 * Tenant membership guard.
 *
 * (ADR-048 §2): Tenant isolation is enforced at the partners service boundary.
 * A principal must be an active member of the store (tenant) to perform any
 * partner operation. Membership is verified via HTTP to the marketplace service
 * (ADR-026 §2.3 — no JOIN across service boundaries).
 */

export interface StoreStaffMember {
  readonly storeId: string;
  readonly memberPublicId: string;
  readonly role: "owner" | "manager" | "staff";
  readonly state: "active" | "removed";
}

export interface StoreStaffPort {
  /** Verify that a user is an active staff member of a store. */
  isStoreStaff(storeId: string, memberPublicId: string): Promise<StoreStaffMember | null>;
}

export class TenantAccessDeniedError extends Error {
  constructor(readonly storeId: string, readonly memberPublicId: string) {
    super(`Tenant access denied: ${memberPublicId} is not a member of store ${storeId}`);
    this.name = "TenantAccessDeniedError";
  }
}

export async function assertTenantMember(
  port: StoreStaffPort,
  storeId: string,
  memberPublicId: string,
): Promise<StoreStaffMember> {
  const member = await port.isStoreStaff(storeId, memberPublicId);
  if (!member || member.state !== "active") {
    throw new TenantAccessDeniedError(storeId, memberPublicId);
  }
  return member;
}

export function assertTenantRole(
  member: StoreStaffMember,
  allowedRoles: readonly ("owner" | "manager" | "staff")[],
): void {
  if (!allowedRoles.includes(member.role)) {
    throw new TenantRoleError(member.role, allowedRoles);
  }
}

export class TenantRoleError extends Error {
  constructor(readonly role: string, readonly allowed: readonly string[]) {
    super(`Role ${role} not allowed; required one of: ${allowed.join(", ")}`);
    this.name = "TenantRoleError";
  }
}
