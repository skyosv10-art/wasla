/**
 * المُهاجرة: تُطبّق **عقدَ المخطّط نفسَه** على محرّكٍ حقيقيّ، وتبذر الكتالوجَ من `plans.ts`.
 *
 * ## قاعدتان تجعلان هذا الملفَّ ترحيلاً لا وصفاً له
 *
 * **1) الـDDL يُقرأ ويُنفَّذ، ولا يُولَّد ولا يُقرأ قراءةً نصّيّةً للتحقّق.** المراجعة 1/6
 * أعلنت أنّ `contracts/schema.sql` هو الترحيلُ (مُغلَّفٌ بـ`BEGIN;`/`COMMIT;` وعكسُه في
 * ذيله تعليقاً)، فالمُهاجرةُ تُرسله إلى Postgres كما هو. واختبارٌ يقرأ الملفَّ ويؤكّد أنّه
 * يحتوي كلمةَ `CREATE TABLE` كان سيُثبت أنّ الملفَّ يشبه نفسَه؛ أمّا تنفيذُه على محرّكٍ
 * فيُثبت أنّ كلَّ قيدٍ فيه **مقبولٌ من Postgres**، وأنّ الجداولَ والقيودَ موجودةٌ بأسمائها
 * بعده. ولذلك بوّابةُ هذه المراجعة تقول: مخطّطٌ طُبّق فعلاً، أو عجزٌ بيئيٌّ **مُعلَنٌ ديناً**
 * لا نجاحاً مُدّعىً.
 *
 * **2) البذرةُ من `PLAN_CATALOG` نفسِه، لا أرقاماً مُعادَ كتابتها.** لا رقمَ واحدٌ مكتوبٌ في
 * هذا الملف: كلُّ قيمةٍ تُقرأ من حقلٍ في `PlanVersion` بالاسم. ولو كُتبت `INSERT` بأرقامٍ
 * منسوخة لصار للوعد مصدران — واحدٌ يقرؤه البوتُ من الكتالوج وواحدٌ في القاعدة — ولاختلفا
 * أوّلَ مرّةٍ تتغيّر ثابتةٌ في حزمة العقد بلا أن يفشل شيء. والاختبارُ
 * `migrate.integration.test.ts` يقرأ الصفوفَ من القاعدة ويقارنها **حقلاً حقلاً** بـ
 * `LAUNCH_PLAN`، فالبذرةُ مُثبَتةٌ لا موصوفة.
 *
 * ## لماذا `frozenAt` وسيطٌ ولا `now()` هنا
 *
 * العقدُ يُلزم اقترانَ `is_frozen` بـ`frozen_at` (`ck_subscription_plans_frozen_at`)،
 * والكتالوجُ في المجال يقول `isFrozen: true` ولا يحمل لحظةَ تجميد — وهو صوابٌ: لحظةُ
 * التجميد واقعةُ تشغيلٍ لا رقمٌ في الوعد. فتدخل من الحاقن كما تدخل كلُّ لحظةٍ في هذه
 * الخدمة (القرار 5)، وقارئُ الساعةِ الحقيقيّةِ الوحيدُ هو `migrate-cli.ts` مُعلَناً بالاسم
 * في `__tests__/purity.test.ts`. ومُهاجرةٌ تقرأ ساعتَها كانت ستجعل اختبارَ البذرةِ يقارن
 * لحظةً لا يملكها.
 *
 * ## الإعادةُ آمنة
 *
 * الـDDL كلُّه `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`، والبذرةُ تتجاهل
 * التعارضَ على المفتاح المركّب (`onConflictDoNothing`) — فتشغيلُ المُهاجرةِ مرّتين لا يُنشئ
 * صفّاً ثانياً ولا يُعدّل صفّاً مُنح منه سائقٌ أيّاماً في الماضي (القرار 7: النسخةُ تُجمَّد ثمّ
 * تُستعمل، ولا تُعدَّل في مكانها).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { PLAN_CATALOG } from "../domain/plans.js";
import { assertTimestamp } from "../domain/time.js";
import type { PlanVersion } from "../domain/model.js";
import type { DbOrTx } from "./client.js";
import { subscriptionPlanEntitlements, subscriptionPlans } from "./schema.js";

/** يُحلّ من موضع الملف حتى لو شُغّل من جذر مساحة العمل. */
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SCHEMA_CONTRACT_PATH = path.join(SERVICE_ROOT, "contracts", "schema.sql");

/** نصُّ العقد كما هو — تُتيحه المُهاجرةُ لحارس الانحراف كي لا يُخمّن مسارَه. */
export async function readSchemaContract(): Promise<string> {
  return readFile(SCHEMA_CONTRACT_PATH, "utf8");
}

/**
 * تُطبّق عقدَ المخطّط على المحرّك.
 *
 * `pool.query` لا Drizzle: الـDDL نصٌّ واحدٌ متعدّدُ العبارات، ومُنشئُ الاستعلامات لا يُرسله.
 */
export async function applySubscriptionSchema(pool: Pool): Promise<void> {
  await pool.query(await readSchemaContract());
}

/**
 * تبذر نسخةَ خطّةٍ واحدةً واستحقاقاتِها من كائن `PlanVersion` نفسِه.
 *
 * كلُّ حقلٍ يُنسَب بالاسم في الطرفين (`trialDays → trial_days`) ولا نسخَ تلقائيّ: نسخٌ
 * تلقائيٌّ كان سيُدخل حقلاً أُضيف إلى النوع بلا عمودٍ يستقبله فيفشل في الإنتاج، أو يُسقط
 * حقلاً أُعيد تسميتُه بلا أن يفشل شيء (سابقةُ Phase 09 · المراجعة 3/6 · HANDOFF §16-ز).
 */
async function seedPlanVersion(db: DbOrTx, plan: PlanVersion, frozenAt: string): Promise<void> {
  await db
    .insert(subscriptionPlans)
    .values({
      planCode: plan.planCode,
      planVersion: plan.planVersion,
      label: plan.label,
      trialDays: plan.trialDays,
      durationDays: plan.durationDays,
      communityGraceDays: plan.communityGraceDays,
      communityDailyOrderCap: plan.communityDailyOrderCap,
      referralRewardDays: plan.referralRewardDays,
      referralQualifyingFacts: plan.referralQualifyingFacts,
      referralWindowDays: plan.referralWindowDays,
      isFrozen: plan.isFrozen,
      frozenAt: plan.isFrozen ? new Date(frozenAt) : null,
    })
    .onConflictDoNothing();

  for (const entitlement of plan.entitlements) {
    await db
      .insert(subscriptionPlanEntitlements)
      .values({
        planCode: plan.planCode,
        planVersion: plan.planVersion,
        entitlementCode: entitlement.entitlementCode,
        limitValue: entitlement.limitValue,
      })
      .onConflictDoNothing();
  }
}

/** تبذر الكتالوجَ كلَّه بترتيبه؛ لا تعرف عددَ نسخِه ولا رمزَ خطّةٍ بعينها. */
export async function seedPlanCatalog(db: DbOrTx, frozenAt: string): Promise<number> {
  const at = assertTimestamp(frozenAt, "frozen_at");
  for (const plan of PLAN_CATALOG) await seedPlanVersion(db, plan, at);
  return PLAN_CATALOG.length;
}

/** الترحيلُ كاملاً: عقدُ المخطّط ثمّ بذرةُ الكتالوج، بهذا الترتيب لا غيره. */
export async function migrateSubscriptions(
  pool: Pool,
  db: DbOrTx,
  frozenAt: string,
): Promise<{ readonly seededPlanVersions: number }> {
  await applySubscriptionSchema(pool);
  return { seededPlanVersions: await seedPlanCatalog(db, frozenAt) };
}
