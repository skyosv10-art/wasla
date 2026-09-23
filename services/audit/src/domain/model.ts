/**
 * Domain model for the Audit service (M3-04 ADMIN_MVP_SPEC §6.2).
 *
 * An audit event is an immutable record of an administrative action.
 * The table is append-only: no update, no delete — the repository ports
 * expose only `append` and `list`.
 */

export interface AuditEvent {
  readonly id: number;
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface CreateAuditEventInput {
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
}

export interface ListAuditEventsOptions {
  readonly actorId?: string;
  readonly actorRole?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}
