/**
 * حدُّ التشغيل: الملفُّ **الوحيد** الذي يقرأ البيئةَ ويفتح منفذاً (مع `db/migrate-cli.ts`).
 *
 * ولمَ ملفٌّ واحدٌ لا موزّعاً؟ لأنّ `process.env` المقروءةَ في عشرةِ ملفاتٍ تجعل سؤالَ «ما
 * الذي تحتاجه هذه الخدمةُ لتعمل؟» بلا جوابٍ إلّا بمسحِ المستودع، ويجعل اختباراً يمرّ لأنّ
 * متغيّراً بقي في بيئةِ المُشغّل. وحرسُ `__tests__/purity.test.ts` يُثبت أنّ القائمةَ هي
 * هذان الملفان بالضبط — لا أقلَّ ولا أكثر.
 *
 * ## `DATABASE_URL` الغائبةُ لا تُسقط العمليّة
 *
 * تُشغّل الخدمةُ في **وضعِ الذاكرة**: كلُّ عمليّةٍ تُجيب `503 SUBSCRIPTION_UNAVAILABLE`
 * ويبقى `GET /health` ناطقاً بـ`degraded` + `memory`. والبديلُ — سقوطٌ عند الإقلاع — يجعل
 * حاضنةً تُعيد التشغيلَ في حلقةٍ بلا مسارِ صحّةٍ يُقرأ، فيقضي المُشغّلُ وقتَه في السجلّات
 * بدل أن يقرأ سبباً في جواب. (سابقةُ خدمة السمعة.)
 *
 * ولمَ لا تنفيذَ في الذاكرة كبديل؟ لأنّه كان سيكون أخطرَ من غيابه: اختباراتٌ تمرّ عليه، ثمّ
 * سلوكٌ مختلفٌ في الإنتاج، وسائقٌ يبدأ تجربةً تُنسى عند إعادةِ التشغيل.
 */

import { SUBSCRIPTION_SERVICE_PORT } from "@wasla/contracts-subscription";

import { createSubscriptionDb } from "../db/client.js";
import { SubscriptionUnitOfWork } from "../db/unit-of-work.js";
import { ReferralService } from "../app/referrals.js";
import { SubscriptionService } from "../app/subscriptions.js";
import { systemClock, uuidIdGenerator } from "../app/runtime.js";
import { createSubscriptionApp, type SubscriptionAppServices } from "./app.js";

/** المنفذُ من حزمةِ العقد لا من رقمٍ مكتوبٍ هنا (`SUBSCRIPTION_SERVICE_PORT` = 8093). */
function readPort(): number {
  const raw = process.env.SUBSCRIPTION_SERVICE_PORT;
  if (raw === undefined || raw.trim() === "") return SUBSCRIPTION_SERVICE_PORT;
  const port = Number(raw);
  // منفذٌ غيرُ صالحٍ يُسقط الإقلاعَ صراحةً: الاستماعُ على منفذٍ آخرَ بصمتٍ يجعل بوّابةً
  // تقول «الخدمةُ ساقطة» والخدمةُ حيّةٌ على عنوانٍ لا يعرفه أحد.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SUBSCRIPTION_SERVICE_PORT غير صالح");
  }
  return port;
}

export async function startSubscriptionServer(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const port = readPort();
  const host = process.env.SUBSCRIPTION_SERVICE_HOST ?? "0.0.0.0";

  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    const app = createSubscriptionApp({ mode: "memory", logger: true });
    await app.listen({ port, host });
    return;
  }

  const { pool, db } = createSubscriptionDb({ connectionString: databaseUrl });
  const uow = new SubscriptionUnitOfWork(db);
  const services: SubscriptionAppServices = {
    // ساعةٌ واحدةٌ تُحقن في الخدمتين: مؤشّرُ آخرِ نبضةٍ ونوافذُ الإحالةِ تُقاس بنفسِ الزمن،
    // وساعتان مستقلّتان كانتا ستُنتجان فرقاً لا يُفسَّر في سجلّ.
    // ومُولّدُ مُعرّفاتٍ محقونٌ لا `randomUUID` داخلَ الطبقة: مُعرّفُ الحدثِ قيمةٌ تُراقَب
    // في اختبار، ومصدرٌ مخفيٌّ للعشوائيّةِ يجعل إعادةَ إنتاجِ حالةٍ مستحيلة.
    subscriptions: new SubscriptionService(uow, systemClock, uuidIdGenerator),
    referrals: new ReferralService(uow, systemClock),
  };
  const app = createSubscriptionApp({ services, mode: "postgres", logger: true });

  // إغلاقٌ مُرتَّب: الحاضنةُ تُرسل `SIGTERM` ثمّ تقتل. وإسقاطُ العمليّةِ فوراً يقطع معاملةً
  // مفتوحةً في منتصفها — والقاعدةُ تتراجع عنها، لكنّ المُنادي يستلم انقطاعاً بلا رمزٍ يقرؤه.
  app.addHook("onClose", async () => {
    await pool.end();
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await startSubscriptionServer();
