/**
 * Document types for the driver mini app.
 *
 * Mirrors the API contract from the drivers-service (packages/contracts/driver).
 * The wire format is snake_case; the domain types use camelCase.
 */

export const DOCUMENT_TYPES = [
  "national_id",
  "driving_license",
  "vehicle_registration",
  "vehicle_insurance",
  "vehicle_photo",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = [
  "pending",
  "verified",
  "rejected",
  "superseded",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Document submission payload for POST /drivers/:id/documents */
export interface DocumentSubmission {
  document_type: DocumentType;
  storage_ref: string;
  vehicle_id?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
}

/** Driver document as returned by the API */
export interface DriverDocument {
  id: string;
  document_type: DocumentType;
  status: DocumentStatus;
  vehicle_id: string | null;
  storage_ref: string;
  issued_at: string | null;
  expires_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason_code: string | null;
  created_at: string;
  updated_at: string;
}

/** Wire response from GET /drivers/:id/documents */
export interface DriverDocumentList {
  documents: DriverDocument[];
}
