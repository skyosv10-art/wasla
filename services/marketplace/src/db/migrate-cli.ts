/**
 * حدُّ التشغيلِ للترحيل — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأ البيئة**.
 *
 * ولمَ يُفصل في ملفٍّ لا يستورده مخزنٌ ولا اختبار؟ لأنّ عنوانَ الاتصالِ مُدخلٌ خارجيّ، ومن
 * قرأه داخلَ `migrate.ts` جعل كلَّ اختبارٍ يُصيب قاعدةً لم يُصرّح بها — واختبارٌ يمسح مخطّطاً
 * في قاعدةِ تطويرٍ لأنّ `DATABASE_URL` كانت مضبوطةً في الصدفةِ عطبٌ يُكتشَف مرّةً واحدةً
 * ويُذكَر سنة. والفصلُ هنا يُبقي `purity.test.ts` قادراً على أن يقول: قارئُ `process.env`
 * واحدٌ **بالاسم**، وكلُّ ما بعده نقيّ.
 *
 * ولا ساعةَ هنا خلافاً لنظيره في خدمةِ الاشتراكات: الترحيلُ لا يبذر صفّاً واحداً (لا تصنيفاتٍ
 * ولا غيرَها · انظر `migrate.ts`)، فلا لحظةَ تُكتب فلا لحظةَ تُقرأ. والقائمةُ `REAL_CLOCK_FILES`
 * تبقى **فارغةً** في هذه المراجعة، وذاك أضيقُ من أن يُوسَّع بلا سبب.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/marketplace-service db:migrate`
 */

import { createMarketplaceDb } from "./client.js";
import { applyMarketplaceSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the marketplace migration");
  }

  const { pool } = createMarketplaceDb({ connectionString, max: 1 });
  try {
    await applyMarketplaceSchema(pool);
    process.stdout.write("marketplace schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
