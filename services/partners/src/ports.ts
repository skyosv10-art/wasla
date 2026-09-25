/**
 * Ports for the partners service — infrastructure interfaces.
 */

import type { ApiCredential, AuditEntry, CredentialCreateInput, PartnerWebhook, UsageCounter, LifecycleState, SlaTier } from "./domain/lifecycle";

export interface CredentialStore {
  create(credential: CredentialCreateInput): Promise<ApiCredential>;
  listByTenant(storeId: string): Promise<ApiCredential[]>;
  revoke(credentialId: string, revokedAt: string): Promise<ApiCredential | null>;
  findByHash(keyHash: string): Promise<ApiCredential | null>;
}

export interface WebhookStore {
  create(webhook: Omit<PartnerWebhook, "createdAt" | "updatedAt">): Promise<PartnerWebhook>;
  listByTenant(storeId: string): Promise<PartnerWebhook[]>;
  delete(webhookId: string, deletedAt: string): Promise<PartnerWebhook | null>;
  pause(webhookId: string, updatedAt: string): Promise<PartnerWebhook | null>;
}

export interface UsageStore {
  incrementApiCalls(storeId: string, windowStart: string): Promise<UsageCounter>;
  incrementWebhookDeliveries(storeId: string, windowStart: string): Promise<UsageCounter>;
  get(storeId: string, windowStart: string): Promise<UsageCounter | null>;
}

export interface AuditStore {
  append(entry: Omit<AuditEntry, "createdAt">): Promise<AuditEntry>;
  listByTenant(storeId: string, limit: number): Promise<AuditEntry[]>;
}

export interface LifecycleStore {
  get(storeId: string): Promise<PartnerLifecycleEntry | null>;
  create(storeId: string, slaTier: SlaTier): Promise<PartnerLifecycleEntry>;
  transition(storeId: string, to: LifecycleState, reason?: string): Promise<PartnerLifecycleEntry>;
}

export interface PartnerLifecycleEntry {
  readonly tenantStoreId: string;
  readonly state: LifecycleState;
  readonly slaTier: SlaTier;
  readonly suspendedReason: string | null;
  readonly suspendedAt: string | null;
  readonly offboardedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoreStaffPort {
  isStoreStaff(storeId: string, memberPublicId: string): Promise<import("./domain/tenant-guard").StoreStaffMember | null>;
}

export interface PartnerPorts {
  readonly staffPort: StoreStaffPort;
  readonly credentialStore: CredentialStore;
  readonly webhookStore: WebhookStore;
  readonly usageStore: UsageStore;
  readonly auditStore: AuditStore;
  readonly lifecycleStore: LifecycleStore;
}
