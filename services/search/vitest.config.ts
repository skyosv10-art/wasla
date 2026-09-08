/**
 * إعدادُ Vitest لاختباراتِ خدمةِ البحثِ — مجالٌ نقيٌّ وحده.
 *
 * اختباراتُ المجالِ (projector, relay, ranking, query, visibility, event-coverage)
 * تركضُ بلا قاعدةٍ وبلا HTTP في أجزاءٍ من الثانية. أمّا اختباراتُ التكاملِ
 * (`*.integration.test.ts`) فتتخطّى نفسها بلا `DATABASE_URL`، وتُفصلُ في إعدادٍ
 * خاصٍّ (`vitest.integration.config.ts`) كي لا تُشغَّل في مسارِ `pnpm test`
 * الافتراضيّ — تماماً كما في طورِ السوقِ. يُنفَّذُ اختبارُ التكاملِ عبر
 * `pnpm test:integration` محليّاً ومع محرّك Postgres حقيقيّ.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/__tests__/*.{integration,e2e}.test.ts",
    ],
    environment: "node",
  },
});
