/**
 * إعداد Vitest لتكامل استمرارية التفاوض.
 *
 * يختار اختبارات PostgreSQL فقط ويمنع توازي الملفات كي لا تشترك الحالات في
 * قاعدة الاختبار التي يعيد `pg-harness` ضبطها بين السيناريوهات.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
  },
});
