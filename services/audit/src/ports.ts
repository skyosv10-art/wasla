/**
 * Ports (hexagonal boundaries) for the Audit service.
 *
 * The repository exposes only `append` and `list` — there is no update or
 * delete, because the audit log is append-only (ADMIN_MVP_SPEC §6.2).
 */

import type { AuditEvent, CreateAuditEventInput, ListAuditEventsOptions } from "./domain/model.js";

/** Wall-clock time as an ISO-8601 string. The domain never calls `Date.now()`. */
export interface Clock {
  now(): string;
}

export interface AuditRepository {
  append(input: CreateAuditEventInput): Promise<AuditEvent>;
  list(options: ListAuditEventsOptions): Promise<AuditEvent[]>;
}

export interface AuditDeps {
  readonly repo: AuditRepository;
  readonly clock: Clock;
}
