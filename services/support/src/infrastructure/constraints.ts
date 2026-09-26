/**
 * أسماءُ القيودِ المُمثَّلة في المرآة — مرجعٌ واحدٌ للمُهيئين والمُطابِق.
 *
 * كلُّ قيدٍ مُسمّى هنا يُطابِقُ اسمَه في `schema.sql` كما يُسمّيه PostgreSQL.
 * الاسمُ غيرُ المُمثَّل هنا يعني «لا أعرفُ هذا القيد» ويُعاد كما هو.
 */

export const ENFORCED_CONSTRAINTS = [
  // support_tickets
  "support_evidence_gate",
  "support_resolution_gate",
  "support_no_skip_closed",
  // support_evidence
  "support_evidence_ticket_id_fkey",
] as const;

export type EnforcedConstraint = (typeof ENFORCED_CONSTRAINTS)[number];

/** مجموعةُ كلِّ الأسماء المُمثَّلة — للاختبار السريع. */
export const ENFORCED_CONSTRAINT_NAMES: ReadonlySet<string> = new Set(
  ENFORCED_CONSTRAINTS,
);

/** هل هذا القيدُ معروفٌ أم غريب؟ */
export function isEnforcedConstraint(name: string): boolean {
  return ENFORCED_CONSTRAINT_NAMES.has(name);
}
