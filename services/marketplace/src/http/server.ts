/**
 * حدُّ التشغيل: الملفُّ **الثاني والأخيرُ** الذي يقرأ البيئةَ (مع `db/migrate-cli.ts`).
 *
 * ولمَ ملفّان لا موزّعاً؟ لأنّ `process.env` المقروءةَ في عشرةِ ملفاتٍ تجعل سؤالَ «ما الذي
 * تحتاجه هذه الخدمةُ لتعمل؟» بلا جوابٍ إلّا بمسحِ المستودع، وتجعل اختباراً يمرّ لأنّ متغيّراً
 * بقي في بيئةِ المُشغّل. وحرسُ `__tests__/purity.test.ts` يُثبت أنّ القائمةَ هي هذان الملفان
 * بالضبط، ويُحدَّث **بالاسم** عند إضافةِ ملفٍّ — لا بتوسيعِ نمطٍ ولا بتعطيلِ حرس.
 *
 * ## `DATABASE_URL` الغائبةُ لا تُسقط العمليّة
 *
 * تُشغَّل الخدمةُ في **وضعِ الذاكرة**: كلُّ عمليّةٍ تُجيب `503 MARKETPLACE_UNAVAILABLE` ويبقى
 * `GET /health` ناطقاً بحالتِه. والبديلُ — سقوطٌ عند الإقلاع — يجعل حاضنةً تُعيد التشغيلَ في
 * حلقةٍ بلا مسارِ صحّةٍ يُقرأ، فيقضي المُشغّلُ وقتَه في السجلّات بدل أن يقرأ سبباً في جواب.
 * (سابقتا خدمةِ السمعةِ والاشتراكات.)
 *
 * ولمَ لا تنفيذَ في الذاكرةِ بديلاً؟ لأنّه كان سيكون أخطرَ من غيابه: اختباراتٌ تمرّ عليه، ثمّ
 * سلوكٌ مختلفٌ في الإنتاج، وتاجرٌ يُسجّل متجراً يُنسى عند إعادةِ التشغيل.
 */

import { MARKETPLACE_SERVICE_PORT } from "../domain/contract-sets.js";
import { MarketplaceCatalogService } from "../app/catalog.js";
import { MarketplaceProductService } from "../app/products.js";
import { systemClock } from "../app/runtime.js";
import { MarketplaceStoreService } from "../app/stores.js";
import { createMarketplaceDb } from "../db/client.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import { createMarketplaceApp, type MarketplaceServices } from "./app.js";

/** المنفذُ من حزمةِ العقدِ لا من رقمٍ مكتوبٍ هنا (`MARKETPLACE_SERVICE_PORT` = 8094). */
function readPort(): number {
  const raw = process.env.MARKETPLACE_SERVICE_PORT;
  if (raw === undefined || raw.trim() === "") return MARKETPLACE_SERVICE_PORT;
  const port = Number(raw);
  // منفذٌ غيرُ صالحٍ يُسقط الإقلاعَ صراحةً: الاستماعُ على منفذٍ آخرَ بصمتٍ يجعل بوّابةً تقول
  // «الخدمةُ ساقطة» والخدمةُ حيّةٌ على عنوانٍ لا يعرفه أحد.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MARKETPLACE_SERVICE_PORT غير صالح");
  }
  return port;
}

export async function startMarketplaceServer(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const port = readPort();
  const host = process.env.MARKETPLACE_SERVICE_HOST ?? "0.0.0.0";

  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    const app = createMarketplaceApp({ mode: "memory", logger: true });
    await app.listen({ port, host });
    return;
  }

  const { pool, db } = createMarketplaceDb({ connectionString: databaseUrl });
  // وحدةُ عملٍ بلا `probe`: الخطّافُ أداةُ اختبارٍ تُوقف المعاملةَ بين الدفترِ وإسقاطِه،
  // ومسارُ إنتاجٍ يقبلها كان سيقبل ما يُبطئ معاملةً أو يُفشلها.
  const uow = new MarketplaceUnitOfWork(db);
  // ساعةٌ واحدةٌ تُحقن في الخدماتِ الثلاث: زمنُ القرارِ في الدفترِ وزمنُ فرقِ المخزونِ
  // يُقاسان بنفسِ المصدر، وساعتان مستقلّتان كانتا ستُنتجان فرقاً لا يُفسَّر في سجلّ.
  const deps = { uow, clock: systemClock };
  const services: MarketplaceServices = {
    stores: new MarketplaceStoreService(deps),
    products: new MarketplaceProductService(deps),
    catalog: new MarketplaceCatalogService(deps),
  };
  const app = createMarketplaceApp({ services, mode: "postgres", logger: true });

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

await startMarketplaceServer();
