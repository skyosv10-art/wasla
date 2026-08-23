/**
 * العمليّة: توصيلٌ ولا شيء غيره (Phase 08 · MR 4/6).
 *
 * كل قرار عن رمز حالة أو جسم أو قاعدة يسكن `app.ts` وحالات الاستخدام. الباقي هنا هو
 * اختيار المحوّلات، وهذا **الموضع الوحيد** الذي يقرأ `process.env` عن قصد — حالةُ استخدام
 * تقرأ متغيّر بيئة تتصرّف في الاختبار غير تصرّفها في الإنتاج، وذاك الفرقُ الوحيد الذي لا
 * يستطيع اختبارٌ أن يكشفه.
 *
 * `DATABASE_URL` موجود → Postgres، معاملةٌ واحدة لكل كتابة، و`/health` يقول `ok`.
 * غائب → مخازن ذاكرية و`degraded`، فيستطيع مُطوّرٌ أن يُشغّل الخدمة بلا قاعدة ولا يستطيع
 * مُشغّلٌ أن يظنّ تلك العمليّة حقيقية.
 *
 * والمنفذان الصادران يُختاران من البيئة في `infrastructure/outbound-wiring.ts` لا هنا
 * (MR 5/6): `DISPATCH_SERVICE_URL` و`ORDERS_SERVICE_URL` موجودان → نداءان حقيقيان على
 * 8089 و8087؛ وأحدهما غائب → منفذٌ يرفض بالاسم ولا يتظاهر بالنجاح
 * (`infrastructure/runtime.ts` يشرح الفرق بين الرفض والرمي)، وملاحظةٌ تُسمّي المتغيّر
 * الناقص. فالبيئة الذاكرية بلا عناوين صالحةٌ لتصفّح المسارات وقراءة `/health`، ولا تفتح
 * خيطاً — وهو أصدق من كتالوجٍ مُختلَق يفتح خيوطاً على عروضٍ لا وجود لها.
 *
 * ولاحظ أنّ اختيار التخزين واختيار المنافذ الصادرة **قرارانِ مستقلّان**: مُطوّرٌ يُشغّل
 * مخازن ذاكرية أمام توزيعٍ ومحرّكِ طلبٍ حقيقيّين حالةٌ عادية، ورَبطُهما كان سيُجبره على
 * قاعدةٍ لا يحتاجها أو على منافذَ لا تنادي أحداً.
 *
 * لا `await main()` مُصدَّر ولا مُستورَد: هذا الملف **ليس** في `src/index.ts`، لأنّ استيراد
 * الحزمة لقراءة نوعٍ منها كان سيرفع خادماً.
 */

import type { Pool } from "pg";

import { NEGOTIATION_SERVICE_PORT } from "@wasla/contracts-negotiation";

import { createNegotiationDb } from "../infrastructure/drizzle/db.js";
import type { NegotiationSharedDeps } from "../infrastructure/drizzle/transaction.js";
import { createInMemoryNegotiationDependencies } from "../infrastructure/in-memory.js";
import {
  configuredAgreedPrice,
  configuredDispatchOffers,
} from "../infrastructure/outbound-wiring.js";
import { CryptoIdGenerator, SystemClock } from "../infrastructure/runtime.js";
import {
  createDirectNegotiationRunner,
  PostgresNegotiationRunner,
  type NegotiationRunner,
} from "../runner.js";

import { createNegotiationApp, type NegotiationHealthDescriptor } from "./app.js";

interface Wiring {
  runner: NegotiationRunner;
  health: NegotiationHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  // `console.warn` وليس `app.log`: هذا الاختيار يقع قبل أن يوجد تطبيقٌ بسجلٍّ، وتأخيرُ
  // الملاحظة إلى ما بعد الرفع كان سيجعل أوّل سببٍ لعطلٍ يظهر بعد أوّل طلبٍ يفشل.
  const outbound = { log: (message: string) => console.warn(message) };
  const offers = configuredDispatchOffers(process.env, outbound.log);
  const agreedPrice = configuredAgreedPrice(process.env, outbound.log);

  if (process.env.DATABASE_URL) {
    const { pool, db } = createNegotiationDb({ connectionString: process.env.DATABASE_URL });
    const shared: NegotiationSharedDeps = { offers, agreedPrice, clock, ids };
    return {
      runner: new PostgresNegotiationRunner(db, shared),
      health: { persistence: "postgres" },
      pool,
    };
  }

  // السياسة المجمَّدة تُزرع في `schema.sql`، فالبيئة الذاكرية تحملها في مستودعها الخاص
  // أصلاً؛ ما يُستبدل هنا هو الساعة والمُعرّفات فقط، لأنّ عمليّةً حقيقية بساعةٍ تُحرَّك
  // بيد لا تُنهي صلاحية شيء أبداً.
  const memory = createInMemoryNegotiationDependencies();
  return {
    runner: createDirectNegotiationRunner({ ...memory, offers, agreedPrice, clock, ids }),
    health: { persistence: "memory" },
    pool: null,
  };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
  const app = createNegotiationApp({ runner, health, logger: true });
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }
  // إغلاق التطبيق قبل الخروج هو ما يُتيح للكتابات الجارية أن تنتهي وللبركة أن تُصرَّف؛
  // و`process.exit` عارياً على SIGTERM كان سيتخلّى عن معاملةٍ مفتوحة في كل نشر.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
  try {
    await app.listen({
      port: Number(process.env.PORT ?? NEGOTIATION_SERVICE_PORT),
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
