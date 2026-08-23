/**
 * إعدادُ Vitest لاختبارات استمرارية السمعة على PostgreSQL.
 *
 * يختار ملفّاتِ التكامل وحدها ويمنع توازيَ الملفات: كلُّ ملفٍّ يُعيد ضبطَ **نفسِ** قاعدةِ
 * الاختبار عبر `pg-harness`، فتوازيهما كان سينتج فشلاً متقطّعاً لا علاقةَ له بالكود —
 * وأسوأ من الفشل أنّه فشلٌ يُدرَّب المرءُ على إعادة تشغيله بدل قراءته.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
  },
});
