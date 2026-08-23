/**
 * سطحُ حزمة `@wasla/reputation-service`.
 *
 * يُصدَّر المجالُ والمنافذُ وحالاتُ الاستخدام ومُهيئُ الذاكرة. ولا يُصدَّر خادمٌ ولا
 * مُشغّلٌ: لا وجودَ لهما في هذه المراجعة (2/6)، وطبقةُ HTTP على المنفذ 8092 تأتي في
 * المراجعة 4/6 فوق **نفس** هذه الحالات بلا تعديلٍ فيها — وذاك هو الاختبارُ الحقيقيّ
 * لكون المجال نقياً.
 *
 * وترتيبُ التصدير مقصود: المجالُ أوّلاً، ثم المنافذُ، ثم حالاتُ الاستخدام، ثم المُهيئ.
 * كلُّ سطرٍ يعتمد على ما قبله ولا شيءَ يعتمد على ما بعده، فاتّجاهُ التبعية مرئيٌّ في
 * الملفّ نفسه.
 */

// المجال — لا شيء فيه يعرف قاعدةً ولا شبكةً ولا ساعةَ نظام.
export * from "./domain/contract-sets.js";
export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/time.js";
export * from "./domain/validation.js";
export * from "./domain/ruleset.js";
export * from "./domain/score.js";
export * from "./domain/fraud.js";
export * from "./domain/events.js";

// المنافذ — حدودُ العمارة.
export * from "./ports.js";

// حالات الاستخدام.
export * from "./use-cases/shared.js";
export * from "./use-cases/record-fact.js";
export * from "./use-cases/submit-rating.js";
export * from "./use-cases/recompute-score.js";
export * from "./use-cases/reads.js";
export * from "./use-cases/run-tick.js";

// المُهيئات — الذاكرةُ وحدها في هذه المراجعة، وقيودُها بأسماء قيود القاعدة.
export * from "./infrastructure/constraints.js";
export * from "./infrastructure/in-memory.js";
