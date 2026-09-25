import { describe, it, expect, vi } from "vitest";
import { issueCredential } from "../use-cases/issue-credential";
import type { CredentialStore, AuditStore, StoreStaffPort } from "../ports";
import type { StoreStaffMember } from "../domain/tenant-guard";
import type { ApiCredential, AuditEntry } from "../domain/lifecycle";

const member: StoreStaffMember = {
  storeId: "store-1",
  memberPublicId: "WS-0000000001",
  role: "owner",
  state: "active",
};

function mockPorts() {
  const credential: ApiCredential = {
    credentialId: "cred-1",
    tenantStoreId: "store-1",
    issuedByPublicId: "WS-0000000001",
    keyPrefix: "wsk_abc",
    scopes: ["partners:credential:read"],
    state: "active",
    createdAt: "2026-09-25T10:00:00Z",
    revokedAt: null,
  };

  return {
    staffPort: { isStoreStaff: vi.fn().mockResolvedValue(member) } as unknown as StoreStaffPort,
    credentialStore: {
      create: vi.fn().mockResolvedValue(credential),
      listByTenant: vi.fn(),
      revoke: vi.fn(),
      findByHash: vi.fn(),
    } as unknown as CredentialStore,
    auditStore: {
      append: vi.fn().mockResolvedValue({} as AuditEntry),
      listByTenant: vi.fn(),
    } as unknown as AuditStore,
  };
}

describe("issueCredential", () => {
  it("issues a credential for an owner", async () => {
    const ports = mockPorts();
    const result = await issueCredential(ports.staffPort, ports.credentialStore, ports.auditStore, {
      storeId: "store-1",
      actorPublicId: "WS-0000000001",
      scopes: ["partners:credential:read"],
    });
    expect(result.plaintextKey).toMatch(/^wsk_/);
    expect(result.scopes).toEqual(["partners:credential:read"]);
    expect(ports.credentialStore.create).toHaveBeenCalledOnce();
    expect(ports.auditStore.append).toHaveBeenCalledOnce();
  });

  it("denies credential issuance for staff role", async () => {
    const ports = mockPorts();
    const staffMember = { ...member, role: "staff" as const };
    ports.staffPort.isStoreStaff = vi.fn().mockResolvedValue(staffMember);

    await expect(
      issueCredential(ports.staffPort, ports.credentialStore, ports.auditStore, {
        storeId: "store-1",
        actorPublicId: "WS-0000000001",
        scopes: [],
      }),
    ).rejects.toThrow();
  });

  it("denies credential issuance for non-member", async () => {
    const ports = mockPorts();
    ports.staffPort.isStoreStaff = vi.fn().mockResolvedValue(null);

    await expect(
      issueCredential(ports.staffPort, ports.credentialStore, ports.auditStore, {
        storeId: "store-1",
        actorPublicId: "WS-0000000009",
        scopes: [],
      }),
    ).rejects.toThrow();
  });

  it("writes an audit entry on credential issuance", async () => {
    const ports = mockPorts();
    await issueCredential(ports.staffPort, ports.credentialStore, ports.auditStore, {
      storeId: "store-1",
      actorPublicId: "WS-0000000001",
      scopes: ["partners:credential:read"],
    });
    expect(ports.auditStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "credential.issued",
        tenantStoreId: "store-1",
      }),
    );
  });
});
