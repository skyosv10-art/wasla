import { defineConfig, devices } from "@playwright/test";

// ADR-047: Playwright E2E + accessibility gate (Wave 4).
// Runs against the built Vite production bundle served by `vite preview`.
// API calls are mocked at the Playwright route layer — no real backend needed.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 800 },
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    extraHTTPHeaders: {
      "Accept-Language": "ar",
    },
  },

  webServer: {
    command: "bash -c 'VITE_E2E=true npx vite build && npx vite preview --port 4173'",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
