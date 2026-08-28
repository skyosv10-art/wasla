/**
 * حدُّ التشغيلِ للترحيل — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأ البيئة**.
 *
 * ولمَ يُفصل في ملفٍّ لا يستورده مخزنٌ ولا اختبار؟ لأنّ عنوانَ الاتصالِ مُدخلٌ خارجيّ، ومن
 * قرأه داخلَ `migrate.ts` جعل كلَّ اختبارٍ يُصيب قاعدةً لم يُصرّح بها — واختبارٌ يمسح مخطّطاً
 * في قاعدةِ تطويرٍ لأنّ `DATABASE_URL` كانت مضبوطةً في الصدفةِ عطبٌ يُكتشَف مرّةً واحدةً
 * ويُذكَر سنة. والفصلُ هنا يُبقي `purity.test.ts` قادراً على أن يقول: قارئُ `process.env`
 * واحدٌ **بالاسم**، وكلُّ ما بعده نقيّ.
 *
 * ولا ساعةَ هنا خلافاً لنظيره في خدمةِ الاشتراكات: ولا صفٌّ مبذورٌ يحمل لحظةً يكتبها الكودُ
 * (`created_at` من `DEFAULT now()` في العقد)، فلا لحظةَ تُقرأ.
 *
 * ## والبذرُ هنا لا في `applyMarketplaceSchema` — وهذا قرارٌ
 *
 * `migrate.ts` يُنفّذ `contracts/schema.sql` **حرفاً** ولا شيءَ غيرَه: مُقارنُ المخطّطِ يقرأ
 * مخرجَه دليلاً على أنّ العقدَ هو المطبّق، وإدراجُ بياناتٍ فيه كان سيجعل «المخطّطُ مُطبّقٌ»
 * دعوى تحمل شيئاً زائداً. ومُراقبُ الاختبارِ (`__tests__/pg-harness.ts`) يُفرِّغ الجداولَ
 * كلَّها بين الاختبارات؛ فبذرٌ داخلَ المُهاجرةِ كان سينجو من التفريغِ في الاختبارِ الأوّلِ
 * وحدَه ثمّ يغيب في الباقي — أي اختباراتٌ تمرّ أو تفشل بترتيبِ تشغيلِها.
 *
 * والشجرةُ المبذورةُ **فارغةٌ اليومَ بقرارٍ مُعلَن** (`domain/category-seed.ts`): الآليّةُ
 * موصولةٌ ومُختبَرة، ومحتوى الشجرةِ قرارُ مالِكِ منتَجٍ لم يُتّخذ بعد.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/marketplace-service db:migrate`
 */

import { PostgresCategoryStore } from "./categories.js";
import { createMarketplaceDb } from "./client.js";
import { applyMarketplaceSchema } from "./migrate.js";
import { MARKETPLACE_CATEGORY_SEED } from "../domain/category-seed.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the marketplace migration");
  }

  const { pool, db } = createMarketplaceDb({ connectionString, max: 1 });
  try {
    await applyMarketplaceSchema(pool);
    process.stdout.write("marketplace schema applied · contracts/schema.sql executed verbatim\n");

    const seeded = await new PostgresCategoryStore(db).seedCategories(MARKETPLACE_CATEGORY_SEED);
    process.stdout.write(
      `category seed · inserted=${seeded.inserted} existing=${seeded.existing} declared=${MARKETPLACE_CATEGORY_SEED.length}\n`,
    );
  } finally {
    await pool.end();
  }
}

await main();
