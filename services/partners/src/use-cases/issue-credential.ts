/**
 * Use case: Issue an API credential for a tenant.
 * (ADR-048 §4)
 */

import type { CredentialStore, AuditStore, StoreStaffPort } from "../ports";
import { generateApiKey } from "../domain/credentials";
import { assertTenantMember, assertTenantRole } from "../domain/tenant-guard";

export interface IssueCredentialInput {
  readonly storeId: string;
  readonly actorPublicId: string;
  readonly scopes: readonly string[];
}

export interface IssueCredentialResult {
  readonly credentialId: string;
  readonly plaintextKey: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
}

export async function issueCredential(
  staffPort: StoreStaffPort,
  credentialStore: CredentialStore,
  auditStore: AuditStore,
  input: IssueCredentialInput,
): Promise<IssueCredentialResult> {
  const member = await assertTenantMember(staffPort, input.storeId, input.actorPublicId);
  assertTenantRole(member, ["owner", "manager"]);

  const { plaintext, keyPrefix, keyHash } = generateApiKey();
  const credential = await credentialStore.create({
    credentialId: crypto.randomUUID(),
    tenantStoreId: input.storeId,
    issuedByPublicId: input.actorPublicId,
    keyPrefix,
    keyHash,
    scopes: input.scopes,
    state: "active",
  });

  await auditStore.append({
    actorPublicId: input.actorPublicId,
    tenantStoreId: input.storeId,
    action: "credential.issued",
    metadata: { credentialId: credential.credentialId, keyPrefix, scopes: input.scopes },
  });

  return {
    credentialId: credential.credentialId,
    plaintextKey: plaintext,
    keyPrefix,
    scopes: input.scopes,
  };
}
