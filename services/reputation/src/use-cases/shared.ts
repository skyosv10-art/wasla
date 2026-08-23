/**
 * ما تتشاركه حالاتُ الاستخدام: النسخةُ النشطة، بصمةُ الطلب، حرسُ المعالجة الواحدة،
 * وإعادةُ الحساب مع أحداثها.
 *
 * القاعدةُ في كل ما هنا: **الحسابُ في `../domain`، والتنسيقُ هنا.** لا صيغةَ ولا عتبةَ
 * ولا حدَّ رتبةٍ في هذا الملف؛ من أراد تغيير الأحكام يُغيّر نسخةَ القواعد، ومن أراد تغيير
 * الصيغة يُغيّر `domain/score.ts` ويواجه اختباراتَه.
 */

import type {
  ReputationRecomputeTrigger,
  ReputationSubjectType,
} from "../domain/contract-sets.js";
import { idempotencyKeyRequired, idempotencyKeyReused, rulesetNotFound } from "../domain/errors.js";
import {
  scoreRecomputed,
  tierChanged,
  type EventMeta,
  type ReputationDomainEvent,
} from "../domain/events.js";
import type {
  ReputationIdempotencyRow,
  ReputationRulesetRow,
  ReputationScoreRow,
} from "../domain/model.js";
import { LAUNCH_RULESET_VERSION, requireUsableRuleset } from "../domain/ruleset.js";
import { computeScore, toScoreRow } from "../domain/score.js";
import type { ReputationDependencies } from "../ports.js";

/** حدُّ الصفوف في نبضةٍ واحدة. رقمٌ مُعلَنٌ يُمكن تجاوزه في الطلب، لا سرٌّ في دالّة. */
export const DEFAULT_TICK_LIMIT = 200;

// ---------------------------------------------------------------------------
// النسخة النشطة
// ---------------------------------------------------------------------------

/**
 * النسخةُ التي يُحسب بها الآن — أو رفضٌ.
 *
 * غيابُ نسخةٍ مجمَّدةٍ **خطأ** لا حالةٌ تُعالَج بقيمةٍ افتراضية: خدمةٌ تحسب بأحكامٍ مضمّنةٍ
 * في الكود حين تخلو القاعدة تُنتج أرقاماً لا تُفسَّر ولا تُراجَع، وذاك بعينه ما وُجد
 * `ruleset_version` لمنعه (ADR-014 القرار 4).
 */
export async function requireActiveRuleset(
  deps: ReputationDependencies,
): Promise<ReputationRulesetRow> {
  const active = await deps.rulesets.findActive();
  if (active === null) throw rulesetNotFound(LAUNCH_RULESET_VERSION);
  return requireUsableRuleset(active, active.rulesetVersion);
}

// ---------------------------------------------------------------------------
// بصمة الطلب
// ---------------------------------------------------------------------------

/**
 * تسلسلٌ **حتميّ** لأي حمولة: مفاتيحٌ مُرتّبةٌ أبجدياً على كل عمق.
 *
 * `JSON.stringify` وحده يحفظ ترتيبَ الكتابة، فطلبان متطابقان في المعنى ومختلفان في ترتيب
 * حقلين يُنتجان بصمتين — فيُقرأ إعادةُ إرسالٍ عاديّة كـ«نفس المفتاح بحمولةٍ مختلفة»
 * ويُردّ 409 على عميلٍ لم يفعل شيئاً خطأً. والترتيبُ يُصلح هذا عند مصدره.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/** بصمةُ حمولةٍ = تسلسلُها الحتميّ. تُخزَّن نصّاً كي يُقرأ الفرقُ عند التشخيص. */
export function fingerprintOf(payload: unknown): string {
  return stableStringify(payload);
}

// ---------------------------------------------------------------------------
// حرس المعالجة الواحدة
// ---------------------------------------------------------------------------

export function requireIdempotencyKey(key: string | undefined | null): string {
  if (typeof key !== "string" || key.trim().length === 0) throw idempotencyKeyRequired();
  return key;
}

export type IdempotencyDecision =
  | { readonly kind: "fresh" }
  | { readonly kind: "replay"; readonly row: ReputationIdempotencyRow };

/**
 * ثلاثةُ احتمالاتٍ لمفتاح معالجةٍ واحدة، ولا رابع:
 *
 *   - **لا سجلّ** ⇒ `fresh`: أوّلُ مرور.
 *   - **سجلٌّ ببصمةٍ مطابقة** ⇒ `replay`: نفسُ الطلب وصل مرّتين. ليس خطأً
 *     (`errors.md` القاعدة 4)، والمستدعي يُعيد نفسَ النتيجة المُخزَّنة.
 *   - **سجلٌّ ببصمةٍ مختلفة** ⇒ `REPUTATION_IDEMPOTENCY_KEY_REUSED`: مفتاحٌ أُعيد
 *     استعمالُه لطلبٍ آخر. والرفضُ هنا وقايةٌ لا تزمّت: تنفيذُه كان سيكتب قراراً ثانياً
 *     تحت مفتاحٍ يظنّ صاحبُه أنّه يحمي منه.
 */
export async function checkIdempotency(
  deps: ReputationDependencies,
  idempotencyKey: string,
  fingerprint: string,
): Promise<IdempotencyDecision> {
  const existing = await deps.idempotency.find(idempotencyKey);
  if (existing === null) return { kind: "fresh" };
  if (existing.requestFingerprint !== fingerprint) throw idempotencyKeyReused();
  return { kind: "replay", row: existing };
}

export async function rememberIdempotency(
  deps: ReputationDependencies,
  input: {
    readonly idempotencyKey: string;
    readonly operation: string;
    readonly fingerprint: string;
    readonly subjectType: ReputationSubjectType | null;
    readonly subjectPublicId: string | null;
    readonly at: string;
  },
): Promise<void> {
  await deps.idempotency.insert({
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    requestFingerprint: input.fingerprint,
    subjectType: input.subjectType,
    subjectPublicId: input.subjectPublicId,
    createdAt: input.at,
  });
}

// ---------------------------------------------------------------------------
// إعادة الحساب
// ---------------------------------------------------------------------------

export interface RecomputeOutcome {
  readonly score: ReputationScoreRow;
  readonly previous: ReputationScoreRow | null;
  readonly tierDidChange: boolean;
  readonly events: readonly ReputationDomainEvent[];
}

/**
 * إعادةُ حسابِ نتيجةِ شخصٍ من **كامل** دفتره، وكتابتُها، وتوليدُ أحداثها.
 *
 * الحسابُ من الدفتر كلّه في كل مرّة، ولا زيادةٌ تفاضليّةٌ على النتيجة السابقة. والفرق ليس
 * في الأداء: التلاشي دالّةٌ في **عمر** كل واقعة، فقيمةُ نفس الواقعة اليوم غيرُها بعد
 * شهر، ولا يوجد «دلتا» تُضاف لتُصحّح ذلك. وإعادةُ الحساب الكاملة تجعل الرقم دالّةً في
 * (الدفتر، النسخة، اللحظة) وحدها — فيُعاد إنتاجُه بعد سنةٍ للمراجعة، وهو معنى «نتيجةٌ
 * مُشتقّة من دفتر وقائع» حرفياً.
 *
 * وحدثُ `tier_changed` يُصدَر **فقط** عند تغيّر فعليّ في الرتبة، ومقارنتُه بالرتبة
 * المُخزَّنة لا بحسابٍ سابقٍ في الذاكرة. نبضةٌ تُصدره كل يومٍ لكل شخصٍ كانت ستجعل
 * المستهلكَ يُرشّح بنفسه، فيصير الحدثُ عديمَ المعنى ثم يُتجاهَل.
 */
export async function recomputeSubjectScore(
  deps: ReputationDependencies,
  input: {
    readonly subjectType: ReputationSubjectType;
    readonly subjectPublicId: string;
    readonly ruleset: ReputationRulesetRow;
    readonly trigger: ReputationRecomputeTrigger;
    readonly at: string;
    readonly traceId?: string | null;
  },
): Promise<RecomputeOutcome> {
  const facts = await deps.facts.listBySubject(input.subjectType, input.subjectPublicId);
  const previous = await deps.scores.find(input.subjectType, input.subjectPublicId);

  const computation = computeScore({
    subjectType: input.subjectType,
    facts,
    ruleset: input.ruleset,
    at: input.at,
  });

  const score = await deps.scores.upsert(
    toScoreRow({
      subjectType: input.subjectType,
      subjectPublicId: input.subjectPublicId,
      ruleset: input.ruleset,
      computation,
      at: input.at,
      traceId: input.traceId ?? null,
    }),
  );

  const meta = (): EventMeta => ({
    eventId: deps.ids.uuid(),
    occurredAt: input.at,
    traceId: input.traceId ?? null,
  });

  const events: ReputationDomainEvent[] = [
    scoreRecomputed({
      meta: meta(),
      subjectType: score.subjectType,
      subjectPublicId: score.subjectPublicId,
      rulesetVersion: score.rulesetVersion,
      scorePoints: score.scorePoints,
      previousScorePoints: previous === null ? null : previous.scorePoints,
      tier: score.tier,
      factCount: score.factCount,
      computedThroughFactId: score.computedThroughFactId,
      trigger: input.trigger,
      computedAt: score.computedAt,
    }),
  ];

  const tierDidChange = previous === null || previous.tier !== score.tier;
  if (tierDidChange) {
    events.push(
      tierChanged({
        meta: meta(),
        subjectType: score.subjectType,
        subjectPublicId: score.subjectPublicId,
        fromTier: previous === null ? null : previous.tier,
        toTier: score.tier,
        scorePoints: score.scorePoints,
        rulesetVersion: score.rulesetVersion,
        computedAt: score.computedAt,
      }),
    );
  }

  return { score, previous, tierDidChange, events };
}
