/**
 * إعدادُ Vitest لاختباراتِ خدمةِ التوصيلِ — مجالٌ نقيٌّ وحده.
 *
 * هذه المراجعةُ (1/N) تُنشئُ العقودَ ونواةَ النطاقِ فقط: لا HTTP ولا قاعدةَ
 * بياناتٍ هنا أصلاً، فالاختباراتُ تركضُ في أجزاءٍ من الثانيةِ. أمّا اختباراتُ
 * التكاملِ (`*.integration.test.ts`) والبوابةُ (`*.e2e.test.ts`) فتُستبعَدُ من
 * المسارِ الافتراضيِّ من الآنَ — لأنَّ المرحلةَ القادمةَ (ADR-026 §4.3) ستُضيفُها
 * فلا تُشغَّلَ في `pnpm test` بالخطأِ (نفسُ نهجِ طورَي السوقِ والبحثِ).
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
