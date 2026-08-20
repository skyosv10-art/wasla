/**
 * Identity domain model — internal entities mirroring the data contract
 * (services/identity/contracts/schema.sql). These are persistence-agnostic
 * domain entities; the repository port (../ports) abstracts how they're
 * stored. The API DTO shapes come from @wasla/contracts-identity.
 */

/** User status (schema.sql identity_users.status CHECK constraint). */
export type UserStatus =
  | "active"
  | "suspended"
  | "deleted"
  | "recovery_in_progress";

/** Identity link provider (schema.sql identity_links.provider). */
export type LinkProvider =
  | "telegram"
  | "phone"
  | "email"
  | "web"
  | "mobile";

/** History field (schema.sql identity_history.field). */
export type HistoryField =
  | "telegram_username"
  | "phone"
  | "link"
  | "status";

/** History source (schema.sql identity_history.source). */
export type HistorySource =
  | "customer_bot"
  | "driver_bot"
  | "partner_bot"
  | "recovery"
  | "admin"
  | "system";

/** Recovery verification method (schema.sql identity_recovery_requests). */
export type VerificationMethod = "phone_otp" | "email_otp" | "admin_assisted";

/** Recovery request status. */
export type RecoveryStatus =
  | "verification_pending"
  | "completed"
  | "rejected";

/** The core Wasla user (identity_users row). */
export interface User {
  readonly internalUuid: string;
  readonly waslaPublicId: string;
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic concurrency version. */
  readonly version: number;
}

/** An external identity link (identity_links row). */
export interface IdentityLink {
  readonly id: number;
  readonly userInternalUuid: string;
  readonly provider: LinkProvider;
  readonly externalId: string;
  readonly verified: boolean;
  readonly linkedAt: string;
}

/** A recorded identity change (identity_history row). */
export interface HistoryEntry {
  readonly id: number;
  readonly userInternalUuid: string;
  readonly field: HistoryField;
  readonly oldValue: string | null;
  readonly newValue: string;
  readonly effectiveAt: string;
  readonly source: HistorySource;
}

/** A recovery request (identity_recovery_requests row). */
export interface RecoveryRequest {
  readonly id: string;
  readonly userInternalUuid: string;
  readonly verificationMethod: VerificationMethod;
  readonly status: RecoveryStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}
