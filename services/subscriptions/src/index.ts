/**
 * سطحُ خدمةِ الاشتراك والإحالة — **طبقةُ مجالٍ نقيّةٌ وحدها** (Phase 10 · المراجعة 2/6).
 *
 * لا Postgres ولا HTTP ولا مؤقّتَ ولا مستهلكَ أحداثٍ في هذه المراجعة، وذلك **قرارٌ لا
 * نقصٌ**: القواعدُ التي تُقاس عليها المراجعاتُ التالية (اشتقاقُ الحالة · الانتقالاتُ
 * السبعةُ · تأهيلُ الإحالة · أرضيّةُ المجتمع) تُختبَر هنا في أجزاءٍ من الثانية على جهازٍ لا
 * قاعدةَ فيه. ومن ربَط القاعدةَ بالمخزن أوّلاً وجد نفسَه يُصلح قاعدةً في استعلامٍ لا في
 * دالّة، ثم يُصلحها ثانيةً في المكان الآخر الذي نسخها.
 *
 * ما يأتي بعد هذه المراجعة، بالترتيب المُعلَن في `docs/16-progress/HANDOFF_NEXT_STEPS.md`:
 * الاستمراريةُ على Postgres ومُهاجرةٌ تُطبّق `schema.sql` (3/6) · طبقةُ HTTP باثنتَي عشرةَ
 * عمليّة (4/6) · مستهلكُ وقائعِ السمعة وناشرُ الصندوقِ الصادر (5/6) · بوّابةُ الخروج (6/6).
 */

export * from "./domain/contract-sets.js";
export * from "./domain/entitlements.js";
export * from "./domain/errors.js";
export * from "./domain/model.js";
export * from "./domain/periods.js";
export * from "./domain/plans.js";
export * from "./domain/referral.js";
export * from "./domain/state.js";
export * from "./domain/time.js";
export * from "./domain/transitions.js";
