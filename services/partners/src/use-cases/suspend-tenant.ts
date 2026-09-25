/**
 * Use case: Suspend a tenant (lifecycle transition).
 * (ADR-048 §7)
 */

import type { LifecycleStore, AuditStore } from "../ports";
import { assertTransition } from "../domain/lifecycle";

export interface SuspendTenantInput {
  readonly storeId: string;
  readonly actorPublicId: string;
  readonly reason: string;
}

export async function suspendTenant(
  lifecycleStore: LifecycleStore,
  auditStore: AuditStore,
  input: SuspendTenantInput,
): Promise<void> {
  const current = await lifecycleStore.get(input.storeId);
  if (!current) {
    throw new Error("Lifecycle not found");
  }

  assertTransition(current.state, "suspended");

  await lifecycleStore.transition(input.storeId, "suspended", input.reason);

  await auditStore.append({
    actorPublicId: input.actorPublicId,
    tenantStoreId: input.storeId,
    action: "lifecycle.suspended",
    metadata: { reason: input.reason },
    
  });
}
