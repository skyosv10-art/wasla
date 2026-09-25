/**
 * Partner lifecycle types for admin portal.
 *
 * Mirrors the partners service schema from ADR-048.
 * Partners service runs at services/partners/ (Fastify, port 8098).
 */

export const PARTNER_STATES = [
  "pending",
  "approved",
  "active",
  "suspended",
  "offboarded",
] as const;
export type PartnerState = (typeof PARTNER_STATES)[number];

export const SLA_TIERS = ["standard", "enterprise"] as const;
export type SlaTier = (typeof SLA_TIERS)[number];

/** Partner lifecycle record as returned by GET /partners/lifecycle */
export interface PartnerLifecycle {
  tenantStoreId: string;
  state: PartnerState;
  slaTier: SlaTier;
  suspendedAt: string | null;
  offboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Partner credential as returned by GET /partners/credentials */
export interface PartnerCredential {
  id: string;
  tenantStoreId: string;
  keyPrefix: string;
  scopes: string[];
  state: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
}

/** Usage counter as returned by GET /partners/usage */
export interface PartnerUsage {
  tenantStoreId: string;
  windowStart: string;
  apiCalls: number;
  webhookDeliveries: number;
}

/** Audit log entry as returned by GET /partners/audit */
export interface PartnerAuditEntry {
  id: string;
  tenantStoreId: string;
  action: string;
  actorPublicId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
