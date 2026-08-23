/**
 * سطحُ حزمة `@wasla/reputation-service`.
 *
 * يُصدَّر المجالُ والمنافذُ وحالاتُ الاستخدام والمُهيئان (الذاكرة وPostgres) ووحدةُ
 * العمل. ولا يُصدَّر **خادمٌ**: لا وجودَ له في هذه المراجعة (3/6)، وطبقةُ HTTP على
 * المنفذ 8092 تأتي في المراجعة 4/6 فوق **نفس** هذه الحالات بلا تعديلٍ فيها — وذاك هو
 * الاختبارُ الحقيقيّ لكون المجال نقياً، وقد مضى نصفُه: مُهيئُ Postgres في 3/6 لم يُغيّر
 * سطراً واحداً في `domain/` ولا في `ports.ts`.
 *
 * وترتيبُ التصدير مقصود: المجالُ أوّلاً، ثم المنافذُ، ثم حالاتُ الاستخدام، ثم مُهيئُ
 * الذاكرة. كلُّ سطرٍ يعتمد على ما قبله ولا شيءَ يعتمد على ما بعده، فاتّجاهُ التبعية
 * مرئيٌّ في الملفّ نفسه.
 *
 * **ولا يُصدَّر من هنا شيءٌ يلمس Postgres** — لا `infrastructure/drizzle/*` ولا
 * `runner.js` — وذاك قصدٌ لا سهو: `runner.ts` يستورد
 * `PostgresReputationUnitOfWork` **قيمةً لا نوعاً**، فتصديرُه من السطح يجرّ سائقَ
 * القاعدة إلى كلّ من يستورد الحزمة للمجال وحده. الاستمراريّةُ والمُشغّلُ يُستورَدان
 * بمسارٍ صريح (`.../runner.js` و`.../infrastructure/drizzle/{db,transaction}.js`) — كما
 * تفعل حزمةُ التكامل وكما ستفعل طبقةُ HTTP — فيكون الاعتمادُ على Postgres خياراً
 * **مكتوباً في سطر الاستيراد** لا أثراً جانبيّاً لسطح الحزمة.
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

// المُهيئات — الذاكرةُ وحدها هنا، وقيودُها بأسماء قيود القاعدة نفسِها.
export * from "./infrastructure/constraints.js";
export * from "./infrastructure/in-memory.js";
