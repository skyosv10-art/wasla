/**
 * M4-05 Privacy/Compliance Review harness.
 *
 * Covers Saudi Arabia Personal Data Protection Law (PDPL) compliance
 * for the WASLA platform. Defines data categories, compliance requirements,
 * data subject rights, and verification checks.
 *
 * Reference: Saudi PDPL (Royal Decree M/19, 2021, effective Sep 2023)
 *             Implementing Regulations (2023)
 */

export type DataCategory = "personal" | "sensitive" | "non-personal";

export type ProcessingPurpose =
  | "service_delivery"
  | "payment_processing"
  | "identity_verification"
  | "location_tracking"
  | "marketing"
  | "analytics"
  | "legal_compliance"
  | "safety_security";

export interface DataElement {
  readonly name: string;
  readonly category: DataCategory;
  readonly purpose: ProcessingPurpose;
  readonly services: readonly string[];
  readonly retentionDays: number;
  readonly consentRequired: boolean;
  readonly pdplArticle: string;
}

export const DATA_ELEMENTS: readonly DataElement[] = [
  {
    name: "customer_phone",
    category: "personal",
    purpose: "service_delivery",
    services: ["identity", "customers", "orders"],
    retentionDays: 90,
    consentRequired: true,
    pdplArticle: "Art. 5 — Lawful basis",
  },
  {
    name: "customer_location",
    category: "sensitive",
    purpose: "location_tracking",
    services: ["geography", "orders", "delivery", "dispatch"],
    retentionDays: 30,
    consentRequired: true,
    pdplArticle: "Art. 23 — Sensitive data",
  },
  {
    name: "driver_license",
    category: "sensitive",
    purpose: "identity_verification",
    services: ["drivers", "identity"],
    retentionDays: 365,
    consentRequired: true,
    pdplArticle: "Art. 23 — Sensitive data",
  },
  {
    name: "driver_location",
    category: "sensitive",
    purpose: "location_tracking",
    services: ["geography", "delivery", "dispatch"],
    retentionDays: 30,
    consentRequired: true,
    pdplArticle: "Art. 23 — Sensitive data",
  },
  {
    name: "payment_info",
    category: "sensitive",
    purpose: "payment_processing",
    services: ["subscriptions", "marketplace"],
    retentionDays: 365,
    consentRequired: true,
    pdplArticle: "Art. 23 — Sensitive data",
  },
  {
    name: "order_history",
    category: "personal",
    purpose: "service_delivery",
    services: ["orders", "delivery", "marketplace"],
    retentionDays: 90,
    consentRequired: false,
    pdplArticle: "Art. 5 — Lawful basis (contract)",
  },
  {
    name: "reputation_scores",
    category: "personal",
    purpose: "analytics",
    services: ["reputation"],
    retentionDays: 180,
    consentRequired: false,
    pdplArticle: "Art. 5 — Lawful basis (legitimate interest)",
  },
  {
    name: "audit_logs",
    category: "non-personal",
    purpose: "legal_compliance",
    services: ["audit"],
    retentionDays: 365,
    consentRequired: false,
    pdplArticle: "Art. 27 — Records",
  },
  {
    name: "bot_chat_messages",
    category: "personal",
    purpose: "service_delivery",
    services: ["customer-bot", "driver-bot", "partner-bot"],
    retentionDays: 90,
    consentRequired: true,
    pdplArticle: "Art. 5 — Lawful basis",
  },
  {
    name: "search_queries",
    category: "personal",
    purpose: "service_delivery",
    services: ["search"],
    retentionDays: 30,
    consentRequired: false,
    pdplArticle: "Art. 5 — Lawful basis (contract)",
  },
] as const;

// ── PDPL Compliance Requirements ───────────────────────────────────────

export interface ComplianceRequirement {
  readonly id: string;
  readonly article: string;
  readonly requirement: string;
  readonly status: "compliant" | "partial" | "not_implemented" | "not_applicable";
  readonly evidence: string;
  readonly remediation?: string;
}

export const COMPLIANCE_REQUIREMENTS: readonly ComplianceRequirement[] = [
  {
    id: "PDPL-001",
    article: "Art. 5",
    requirement: "Lawful basis for processing personal data",
    status: "compliant",
    evidence: "Service auth enforcement (SERVICE_AUTH_ENFORCEMENT.md) — all service-to-service calls authenticated",
  },
  {
    id: "PDPL-002",
    article: "Art. 8",
    requirement: "Consent management for personal data processing",
    status: "partial",
    evidence: "Bot interactions include opt-in for location sharing; explicit consent flow not yet formalized",
    remediation: "Implement consent management service with audit trail",
  },
  {
    id: "PDPL-003",
    article: "Art. 9",
    requirement: "Clear privacy notice to data subjects",
    status: "partial",
    evidence: "Privacy policy referenced in beta charter; full notice not yet published to users",
    remediation: "Publish privacy notice in Arabic and English before pilot",
  },
  {
    id: "PDPL-004",
    article: "Art. 12",
    requirement: "Data subject right to access",
    status: "not_implemented",
    evidence: "No data subject access request (DSAR) endpoint exists",
    remediation: "Add DSAR endpoint to identity service with 30-day response window",
  },
  {
    id: "PDPL-005",
    article: "Art. 13",
    requirement: "Data subject right to correction",
    status: "not_implemented",
    evidence: "No data correction request endpoint exists",
    remediation: "Add data correction endpoint to customers service",
  },
  {
    id: "PDPL-006",
    article: "Art. 14",
    requirement: "Data subject right to deletion (right to be forgotten)",
    status: "not_implemented",
    evidence: "No data deletion endpoint exists; audit logs are append-only by design",
    remediation: "Add data deletion endpoint with legal hold exception for audit logs",
  },
  {
    id: "PDPL-007",
    article: "Art. 23",
    requirement: "Special protection for sensitive data (location, biometrics, health)",
    status: "partial",
    evidence: "Location data encrypted in transit (TLS) and at rest (Supabase); access controls via service auth",
    remediation: "Implement field-level encryption for sensitive data columns",
  },
  {
    id: "PDPL-008",
    article: "Art. 24",
    requirement: "Data breach notification within 72 hours",
    status: "partial",
    evidence: "Incident response procedures defined (M4-04); breach notification process not formalized",
    remediation: "Add breach notification checklist to incident-ops runbooks",
  },
  {
    id: "PDPL-009",
    article: "Art. 27",
    requirement: "Records of processing activities (ROPA)",
    status: "compliant",
    evidence: "DATA_ELEMENTS in this package serve as ROPA; audit service logs all data access",
  },
  {
    id: "PDPL-010",
    article: "Art. 28",
    requirement: "Data protection by design and by default",
    status: "compliant",
    evidence: "Service auth enforcement, least-privilege architecture, append-only audit logs, observability stack",
  },
  {
    id: "PDPL-011",
    article: "Art. 33",
    requirement: "Cross-border data transfer safeguards",
    status: "partial",
    evidence: "Data hosted on Supabase (regional) and Render (US); no DPA with processors",
    remediation: "Sign Data Processing Agreements with Supabase and Render; verify data residency",
  },
  {
    id: "PDPL-012",
    article: "Art. 36",
    requirement: "Data Protection Impact Assessment (DPIA) for high-risk processing",
    status: "partial",
    evidence: "Risk register includes data risks; formal DPIA not yet conducted",
    remediation: "Conduct formal DPIA before pilot launch",
  },
] as const;

// ── Data Subject Rights ────────────────────────────────────────────────

export interface DataSubjectRight {
  readonly right: string;
  readonly pdplArticle: string;
  readonly description: string;
  readonly implementationStatus: string;
}

export const DATA_SUBJECT_RIGHTS: readonly DataSubjectRight[] = [
  {
    right: "Access",
    pdplArticle: "Art. 12",
    description: "Right to know what personal data is being processed",
    implementationStatus: "Not implemented — DSAR endpoint needed",
  },
  {
    right: "Correction",
    pdplArticle: "Art. 13",
    description: "Right to correct inaccurate personal data",
    implementationStatus: "Not implemented — correction endpoint needed",
  },
  {
    right: "Deletion",
    pdplArticle: "Art. 14",
    description: "Right to request deletion of personal data",
    implementationStatus: "Not implemented — deletion endpoint with legal hold needed",
  },
  {
    right: "Objection",
    pdplArticle: "Art. 15",
    description: "Right to object to processing for direct marketing",
    implementationStatus: "Partial — marketing opt-out not yet implemented",
  },
  {
    right: "Portability",
    pdplArticle: "Art. 16",
    description: "Right to receive personal data in a structured format",
    implementationStatus: "Not implemented — data export endpoint needed",
  },
] as const;

// ── Compliance Verification ────────────────────────────────────────────

export function getSensitiveDataElements(): readonly DataElement[] {
  return DATA_ELEMENTS.filter((d) => d.category === "sensitive");
}

export function getPersonalDataElements(): readonly DataElement[] {
  return DATA_ELEMENTS.filter((d) => d.category === "personal");
}

export function getConsentRequiredElements(): readonly DataElement[] {
  return DATA_ELEMENTS.filter((d) => d.consentRequired);
}

export function getComplianceGaps(): readonly ComplianceRequirement[] {
  return COMPLIANCE_REQUIREMENTS.filter(
    (r) => r.status === "not_implemented" || r.status === "partial",
  );
}

export function getCompliantCount(): number {
  return COMPLIANCE_REQUIREMENTS.filter((r) => r.status === "compliant").length;
}

export function getTotalCount(): number {
  return COMPLIANCE_REQUIREMENTS.length;
}

export function getComplianceScore(): number {
  const compliant = getCompliantCount();
  const partial = COMPLIANCE_REQUIREMENTS.filter((r) => r.status === "partial").length * 0.5;
  const total = getTotalCount();
  return Math.round(((compliant + partial) / total) * 100);
}
