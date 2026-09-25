import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.unit.test.ts"], pool: "threads", environment: "node" },
});
