/**
 * حدُّ التشغيل للمُهاجرة — **الملفُّ الوحيدُ في هذه الحزمة الذي يقرأ البيئةَ والساعةَ**.
 *
 * ولمَ يُفصل في ملفٍّ لا يُستورَد من المخزن؟ لأنّ العنوانَ واللحظةَ مُدخلانِ خارجيّان، ومن
 * قرأهما داخل `migrate.ts` جعل كلَّ اختبارٍ يُصيب قاعدةً لم يُصرّح بها ويقارن لحظةً لا
 * يملكها. والفصلُ هنا يُبقي `purity.test.ts` قادراً على أن يقول: قارئُ `process.env` واحدٌ
 * **بالاسم**، وقارئُ الساعةِ الحقيقيّةِ واحدٌ **بالاسم** — وكلُّ ما بعدهما نقيّ.
 *
 * التشغيل: `DATABASE_URL=… pnpm --filter @wasla/subscriptions-service db:migrate`
 */

import { createSubscriptionDb } from "./client.js";
import { migrateSubscriptions } from "./migrate.js";

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run the subscriptions migration");
  }

  const { pool, db } = createSubscriptionDb({ connectionString, max: 1 });
  try {
    const frozenAt = new Date().toISOString();
    const result = await migrateSubscriptions(pool, db, frozenAt);
    process.stdout.write(
      `subscriptions schema applied · plan versions seeded: ${result.seededPlanVersions}\n`,
    );
  } finally {
    await pool.end();
  }
}

await main();
