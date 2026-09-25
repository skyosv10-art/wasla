/**
 * إعدادُ Vitest لاختباراتِ تكاملِ خدمةِ الشركاءِ على PostgreSQL.
 *
 * يختار ملفّاتِ التكاملِ وحدَها ويمنع توازيَ الملفّات: كلُّ ملفٍّ يُعيد ضبطَ نفسِ
 * قاعدةِ الاختبارِ، فتوازيهما كان سيُنتج فشلاً متقطّعاً.
 * تتخطّى الاختباراتُ نفسها بلا `DATABASE_URL`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    environment: "node",
    fileParallelism: false,
  },
});
