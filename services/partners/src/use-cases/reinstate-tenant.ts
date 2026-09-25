/**
 * Use case: Reinstate a suspended tenant.
 * (ADR-048 §7)
 */

import type { LifecycleStore, AuditStore } from "../ports";
import { assertTransition } from "../domain/lifecycle";

export interface ReinstateTenantInput {
  readonly storeId: string;
  readonly actorPublicId: string;
}

export async function reinstateTenant(
  lifecycleStore: LifecycleStore,
  auditStore: AuditStore,
  input: ReinstateTenantInput,
): Promise<void> {
  const current = await lifecycleStore.get(input.storeId);
  if (!current) {
    throw new Error("Lifecycle not found");
  }

  assertTransition(current.state, "active");

  await lifecycleStore.transition(input.storeId, "active");

  await auditStore.append({
    actorPublicId: input.actorPublicId,
    tenantStoreId: input.storeId,
    action: "lifecycle.reinstated",
    metadata: {},
    
  });
}
