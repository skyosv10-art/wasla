/**
 * العمليّة: توصيلٌ ولا شيءَ غيره (Phase 09 · المراجعة 4/6).
 *
 * كلُّ قرارٍ عن رمز حالةٍ أو جسمٍ أو قاعدةٍ يسكن `app.ts` وحالاتِ الاستخدام. والباقي هنا
 * اختيارُ المحوّلات، وهذا **الموضعُ الوحيد** الذي يقرأ `process.env` عن قصد — حالةُ استخدامٍ
 * تقرأ متغيّرَ بيئةٍ تتصرّف في الاختبار غيرَ تصرّفها في الإنتاج، وذاك الفرقُ الوحيد الذي لا
 * يستطيع اختبارٌ أن يكشفه.
 *
 * `DATABASE_URL` موجود → Postgres، ومعاملةٌ واحدة لكل كتابة، و`/health` يقول `ok`.
 * غائب → مخازنُ ذاكرية و`degraded`، فيستطيع مُطوّرٌ أن يُشغّل الخدمةَ بلا قاعدة ولا يستطيع
 * مُشغّلٌ أن يظنّ تلك العمليّةَ حقيقية. و`degraded` على الذاكرة ليس تشاؤماً: الدفترُ هو
 * الأصلُ الذي لا يُعاد بناؤه من شيء (النتيجةُ تُشتقّ منه لا العكس)، وعلامةٌ خضراء على
 * عمليّةٍ تفقده بإعادة التشغيل هي الطريقُ الذي تصل به إلى الإنتاج.
 *
 * والساعةُ والمُعرّفات تُستبدل في الطريق الذاكريّ أيضاً: `createInMemoryReputationDependencies`
 * تُعطي ساعةً تُحرَّك بيد ومُعرّفاتٍ متسلسلة (وهي الصحيحةُ في الاختبار)، وعمليّةٌ حقيقية
 * بساعةٍ مُجمّدة لا تُنهي نافذةَ احتيالٍ ولا تُلاشي واقعةً قديمة أبداً.
 *
 * لا `await main()` مُصدَّرٌ ولا مُستورَد: هذا الملفُّ **ليس** في `src/index.ts`، لأنّ
 * استيرادَ الحزمة لقراءة نوعٍ منها كان سيرفع خادماً.
 */

import type { Pool } from "pg";

import { REPUTATION_SERVICE_PORT } from "@wasla/contracts-reputation";

import { createReputationDb } from "../infrastructure/drizzle/db.js";
import { createInMemoryReputationDependencies } from "../infrastructure/in-memory.js";
import { CryptoIdGenerator, SystemClock } from "../infrastructure/runtime.js";
import {
  createDirectReputationRunner,
  PostgresReputationRunner,
  type ReputationRunner,
} from "../runner.js";

import { createReputationApp, type ReputationHealthDescriptor } from "./app.js";

interface Wiring {
  runner: ReputationRunner;
  health: ReputationHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();

  if (process.env.DATABASE_URL) {
    const { pool, db } = createReputationDb({ connectionString: process.env.DATABASE_URL });
    return {
      runner: new PostgresReputationRunner(db, { clock, ids }),
      health: { persistence: "postgres" },
      pool,
    };
  }

  // نسخةُ القواعد المجمَّدة تُزرع في `schema.sql`، فالبيئةُ الذاكرية تحملها في مستودعها
  // الخاصّ أصلاً؛ وما يُستبدل هنا الساعةُ والمُعرّفات فقط.
  const memory = createInMemoryReputationDependencies();
  return {
    runner: createDirectReputationRunner({ ...memory, clock, ids }),
    health: { persistence: "memory" },
    pool: null,
  };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
  const app = createReputationApp({ runner, health, logger: true });
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }
  // إغلاقُ التطبيق قبل الخروج هو ما يُتيح للكتابات الجارية أن تنتهي وللبركة أن تُصرَّف؛
  // و`process.exit` عارياً على SIGTERM كان سيتخلّى عن معاملةٍ مفتوحة في كل نشر.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
  try {
    await app.listen({
      port: Number(process.env.PORT ?? REPUTATION_SERVICE_PORT),
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
