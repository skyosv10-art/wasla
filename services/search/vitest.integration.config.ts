/**
 * إعدادُ Vitest لاختباراتِ تكاملِ خدمةِ البحثِ على PostgreSQL.
 *
 * يختار ملفّاتِ التكاملِ وحدَها ويمنع توازيَ الملفّات: كلُّ ملفٍّ يُعيد ضبطَ نفسِ
 * قاعدةِ الاختبارِ عبر `pg-harness`، فتوازيهما كان سيُنتج فشلاً متقطّعاً.
 * تتخطّى الاختباراتُ نفسها بلا `DATABASE_URL`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
    environment: "node",
  },
});
