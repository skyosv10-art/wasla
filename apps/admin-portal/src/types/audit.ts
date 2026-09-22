/**
 * Audit log types for admin portal.
 *
 * Mirrors the audit event schema from ADMIN_MVP_SPEC.md §6.
 * Audit service is planned for services/audit/ (Fastify, port 8090) —
 * frontend built ahead per ADR-047 Wave 3 pattern.
 */

export const AUDIT_ACTIONS = [
  "user.suspended",
  "user.reinstated",
  "driver.suspended",
  "driver.reinstated",
  "driver.document.reviewed",
  "driver.availability.changed",
  "order.viewed",
  "audit.exported",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ROLES = ["operator", "admin"] as const;
export type AuditRole = (typeof AUDIT_ROLES)[number];

export const RESOURCE_TYPES = ["user", "driver", "order", "audit"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Audit event as returned by GET /audit/events */
export interface AuditEvent {
  id: number;
  actor_id: string;
  actor_role: AuditRole;
  action: AuditAction;
  resource_type: ResourceType;
  resource_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Wire response from GET /audit/events */
export interface AuditEventListResponse {
  events: AuditEvent[];
  total: number;
}

/** Query params for GET /audit/events */
export interface AuditEventQuery {
  from_date?: string;
  to_date?: string;
  actor_id?: string;
  action?: AuditAction;
  resource_type?: ResourceType;
  limit?: number;
  offset?: number;
}
