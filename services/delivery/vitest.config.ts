/**
 * إعدادُ Vitest لخدمةِ الوفاءِ — مجالٌ نقيٌّ وحدَه: لا قاعدةَ ولا HTTP،
 * فتركضُ الأحكامُ في أجزاءٍ من الثانيةِ (ADR-026 §4).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/*.{integration,e2e}.test.ts"],
    environment: "node",
  },
});
