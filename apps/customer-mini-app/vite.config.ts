import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ADR-044: React 18 + Vite 5. Hash-based routing (no history API in Telegram WebView).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
