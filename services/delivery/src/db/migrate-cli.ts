/**
 * حدُّ التشغيلِ للترحيلِ — **الملفُّ الوحيدُ في هذه الحزمةِ الذي يقرأُ البيئةَ**.
 *
 * ولمَ يُفصلُ في ملفٍّ لا يستوردُهُ مخزنٌ ولا اختبارٌ؟ لأنّ عنوانَ الاتصالِ مُدخلٌ خارجيٌّ،
 * ومن قرأَهُ داخلَ `migrate.ts` جعلَ كلَّ اختبارٍ يُصيبُ قاعدةً لم يُصرِّح بها — واختبارٌ
 * يمسحُ مخطّطاً في قاعدةِ تطويرٍ لأنّ `DATABASE_URL` كانت مضبوطةً في الصدفةِ عطبٌ يُكتشَفُ
 * مرّةً واحدةً ويُذكَرُ سنةً.
 *
 * ولا بذرَ بياناتٍ هنا: العقدُ يُنشئُ مخطّطاً فارغاً بقصدٍ، ومُراقبُ الاختبارِ
 * (`__tests__/pg-harness.ts`) يُفرّغُ الجداولَ بينَ الاختباراتِ — فبذرٌ داخلَ المُهاجرةِ كان
 * سينجو من التفريغِ في الاختبارِ الأوّلِ وحدَهُ ثمّ يغيبُ في الباقي.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/delivery-service db:migrate`
 */

import { Pool } from "pg";

import { applyDeliverySchema } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the delivery migration");
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await applyDeliverySchema(pool);
    process.stdout.write("delivery schema applied · contracts/schema.sql executed verbatim\n");
  } finally {
    await pool.end();
  }
}

await main();
