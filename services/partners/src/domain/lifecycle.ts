/**
 * Partner domain — lifecycle state machine.
 *
 * (ADR-048 §7):
 *   pending → approved → active → suspended → offboarded
 *                  ↑         ↓
 *                  ←── reinstated ←
 *
 * - pending: store created but not yet approved
 * - approved: store approved, partner can onboard
 * - active: credentials issued, webhooks active
 * - suspended: credentials revoked, webhooks paused
 * - offboarded: all data archived, credentials revoked permanently
 */

export const LIFECYCLE_STATES = [
  "pending",
  "approved",
  "active",
  "suspended",
  "offboarded",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  pending: ["approved"],
  approved: ["active", "offboarded"],
  active: ["suspended", "offboarded"],
  suspended: ["active", "offboarded"],
  offboarded: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new LifecycleTransitionError(from, to);
  }
}

export class LifecycleTransitionError extends Error {
  constructor(readonly from: LifecycleState, readonly to: LifecycleState) {
    super(`Invalid lifecycle transition: ${from} → ${to}`);
    this.name = "LifecycleTransitionError";
  }
}

export const SLA_TIERS = ["standard", "enterprise"] as const;
export type SlaTier = (typeof SLA_TIERS)[number];

export interface PartnerLifecycle {
  readonly tenantStoreId: string;
  readonly state: LifecycleState;
  readonly slaTier: SlaTier;
  readonly suspendedReason: string | null;
  readonly suspendedAt: string | null;
  readonly offboardedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const PARTNER_AUDIT_ACTIONS = [
  "credential.issued",
  "credential.revoked",
  "webhook.created",
  "webhook.deleted",
  "webhook.paused",
  "lifecycle.suspended",
  "lifecycle.reinstated",
  "lifecycle.offboarded",
  "lifecycle.approved",
  "lifecycle.activated",
] as const;

export type PartnerAuditAction = (typeof PARTNER_AUDIT_ACTIONS)[number];

export interface AuditEntry {
  readonly actorPublicId: string;
  readonly tenantStoreId: string;
  readonly action: PartnerAuditAction;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface CredentialCreateInput {
  readonly credentialId: string;
  readonly tenantStoreId: string;
  readonly issuedByPublicId: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
  readonly scopes: readonly string[];
  readonly state: "active" | "revoked";
}

export interface ApiCredential {
  readonly credentialId: string;
  readonly tenantStoreId: string;
  readonly issuedByPublicId: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  readonly state: "active" | "revoked";
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface PartnerWebhook {
  readonly webhookId: string;
  readonly tenantStoreId: string;
  readonly url: string;
  readonly eventTypes: readonly string[];
  readonly state: "active" | "paused" | "deleted";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UsageCounter {
  readonly tenantStoreId: string;
  readonly windowStart: string;
  readonly apiCalls: number;
  readonly webhookDeliveries: number;
}
