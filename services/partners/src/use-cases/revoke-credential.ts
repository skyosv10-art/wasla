/**
 * Use case: Revoke an API credential.
 * (ADR-048 §4)
 */

import type { CredentialStore, AuditStore, StoreStaffPort } from "../ports";
import { assertTenantMember, assertTenantRole } from "../domain/tenant-guard";

export interface RevokeCredentialInput {
  readonly storeId: string;
  readonly actorPublicId: string;
  readonly credentialId: string;
}

export async function revokeCredential(
  staffPort: StoreStaffPort,
  credentialStore: CredentialStore,
  auditStore: AuditStore,
  input: RevokeCredentialInput,
  now: () => Date = () => new Date(),
): Promise<void> {
  const member = await assertTenantMember(staffPort, input.storeId, input.actorPublicId);
  assertTenantRole(member, ["owner", "manager"]);

  const revoked = await credentialStore.revoke(input.credentialId, now().toISOString());
  if (!revoked) {
    throw new Error("Credential not found");
  }

  await auditStore.append({
    actorPublicId: input.actorPublicId,
    tenantStoreId: input.storeId,
    action: "credential.revoked",
    metadata: { credentialId: input.credentialId },
    
  });
}
