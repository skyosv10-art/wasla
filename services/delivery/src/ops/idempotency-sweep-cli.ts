/**
 * حدُّ التشغيلِ للمُنادي — **الملفُّ الوحيدُ في هذا المجلَّدِ الذي يقرأُ البيئةَ
 * ويُنهي العمليّةَ** (المراجعةُ 14/N · ADR-026 §4.16).
 *
 * التشغيل:
 *   DATABASE_URL=… pnpm --filter @wasla/delivery-service sweep:idempotency
 *
 * ولمَ يُفصلُ عن `idempotency-sweep-runner.ts`؟ لنفسِ سببِ فصلِ
 * `db/migrate-cli.ts` عن `db/migrate.ts`: عنوانُ الاتصالِ مُدخلٌ خارجيٌّ، ومن
 * قرأَهُ في ملفِّ المنطقِ جعلَ كلَّ اختبارٍ يستوردُهُ يُصيبُ قاعدةً لم يُصرِّح
 * بها. وهنا يُضافُ سببٌ ثانٍ: `process.exit` في ملفِّ منطقٍ يُنهي مُشغِّلَ
 * الاختباراتِ نفسَهُ.
 *
 * ## أينَ يُكتَبُ ماذا
 *
 * التقريرُ (JSON سطرٌ واحدٌ) إلى **stdout**، والعِلَلُ إلى **stderr**. فمن
 * أنبَبَ stdout إلى جامعِ سجلّاتٍ لا يتلوَّثُ صفُّهُ برسالةِ عطلٍ عربيّةٍ، ومن
 * قرأَ بريدَ cron يرى العلّةَ وحدَها. والتقريرُ يُطبَعُ **حتّى في الجَولةِ
 * غيرِ المكتملةِ** (رمزُ 3 أو 4): «لم يكتملْ» بلا أرقامٍ سؤالٌ بلا جوابٍ.
 *
 * ## والقتلُ في منتصفِ الجَولةِ آمنٌ بالبناءِ
 *
 * لا حالةَ في الذاكنِ تُفقَدُ: كلُّ دفعةٍ عبارةُ حذفٍ واحدةٌ تلتزمُ وحدَها،
 * وحدُّ الجَولةِ عدَّادٌ محليٌّ لا أثرَ لهُ في القاعدةِ. فمُهلةُ جَدوَلٍ تقتلُ
 * العمليّةَ بعدَ الدفعةِ الثالثةِ تكونُ قد حذفَت ثلاثَ دفعاتٍ ولم تكسِرْ شيئاً،
 * والجَولةُ التاليةُ تبدأُ من حيثُ تقفُ القاعدةُ لا من حيثُ توقَّفَت الذاكرةُ.
 * ولذلكَ لا مِقبضَ إغلاقٍ رشيقٍ هنا: مِقبضٌ لا يحمي شيئاً شفرةٌ تُوهِمُ.
 *
 * Scope: خدمة التوصيل · حدُّ تشغيلِ مُنادي المُكنسةِ
 * Last Updated: 2026-09-12
 * Status: Active
 * Related Code: src/ops/idempotency-sweep-runner.ts · src/db/migrate-cli.ts
 * Related Docs: docs/14-runbooks/DELIVERY_IDEMPOTENCY_SWEEP.md
 * Related Team: Delivery & Store Orders
 */

import { Pool } from "pg";

import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import {
  SWEEP_EXIT_FAILED,
  formatSweepReportLine,
  resolveSweepRunnerConfig,
  runIdempotencySweepRound,
} from "./idempotency-sweep-runner.js";

export async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stderr.write("DATABASE_URL مطلوبٌ لتشغيلِ مُكنسةِ مفاتيحِ التماثُلِ\n");
    return SWEEP_EXIT_FAILED;
  }

  let config;
  try {
    config = resolveSweepRunnerConfig(process.env);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return SWEEP_EXIT_FAILED;
  }

  // `max: 1` لأنَّ الجَولةَ متتاليةٌ بطبعِها: دفعةٌ بعدَ دفعةٍ. وبِركةٌ أوسعُ
  // على مضيفِ جَدوَلٍ تحجزُ اتّصالاتٍ من حصّةِ القاعدةِ بلا أن تُسرِّعَ شيئاً.
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const report = await runIdempotencySweepRound({
      // المخزنُ يطلبُ مدّةً في مُنشئِهِ ولا تُستعملُ في الحذفِ: المُكنسةُ تحذفُ
      // بـ`expires_at` المحفوظِ في الصفِّ لا بمدّةٍ تُحسَبُ الآنَ (13/N §4.15).
      // فالافتراضُ يُترَكُ كما هوَ صريحاً بدلَ تمريرِ رقمٍ يُوهِمُ أنّهُ يؤثِّرُ.
      sweepPort: new StoreOrderStore(pool),
      config,
      now: () => new Date(),
    });
    process.stdout.write(formatSweepReportLine(report));
    return report.exitCode;
  } catch (err) {
    process.stderr.write(
      `أخفقَت جَولةُ المُكنسةِ: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return SWEEP_EXIT_FAILED;
  } finally {
    await pool.end();
  }
}

process.exit(await main());
