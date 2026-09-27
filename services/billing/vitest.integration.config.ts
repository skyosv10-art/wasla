/**
 * إعدادُ Vitest لاختباراتِ تكاملِ خدمةِ الفوترةِ على PostgreSQL (M5-17P · CLM-0375).
 *
 * يختارُ ملفّاتِ التكاملِ وحدَها ويمنعُ توازيَ الملفّات: كلُّ ملفٍّ يُعيدُ ضبطَ قاعدةِ
 * الاختبارِ نفسِها، فتوازيهما كانَ سيُنتجُ فشلاً متقطّعاً.
 * تتخطّى الاختباراتُ نفسَها بلا `DATABASE_URL`.
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
