/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * ولمَ يُفصلُ في ملفٍّ لا يستوردُهُ مخزنٌ ولا اختبارٌ؟ لأنّ عنوانَ الاتصالِ مُدخلٌ خارجيٌّ،
 * ومن قرأَهُ داخلَ `migrate.ts` جعلَ كلَّ اختبارٍ يُصيبُ قاعدةً لم يُصرِّح بها — واختبارٌ
 * يمسحُ مخطّطاً في قاعدةِ تطويرٍ لأنّ `DATABASE_URL` كانت مضبوطةً في الصدفةِ عطبٌ يُكتشَفُ
 * مرّةً واحدةً ويُذكَرُ سنةً.
 *
 * ولا بذرَ بياناتٍ هنا: عقدُ البحثِ DDL خالصٌ لا يزرعُ صفّاً (الفهرسُ إسقاطٌ يُبنى من
 * أحداثِ السوقِ لا من بذورٍ — ADR-025).
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/search-service db:migrate`
 */

import { Pool } from "pg";

import { applySearchSchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the search migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applySearchSchema(pool);
    process.stdout.write("search schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
