/**
 * إعدادُ Vitest لاختباراتِ الوحدةِ في خدمةِ الفوترة — بلا قاعدةِ بيانات.
 * ملفّاتُ `*.integration.test.ts` مُستبعَدةٌ هنا وتعملُ عبرَ `vitest.integration.config.ts`
 * في وظيفةِ `billing · db-integration` (M5-17P · CLM-0375).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    pool: "threads",
    environment: "node",
  },
});
