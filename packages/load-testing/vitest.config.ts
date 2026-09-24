import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    timeout: 30000,
    hookTimeout: 30000,
  },
});
