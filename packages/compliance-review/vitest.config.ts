import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    timeout: 15000,
    hookTimeout: 15000,
  },
});
