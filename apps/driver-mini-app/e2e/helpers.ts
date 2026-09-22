import type { Page } from "@playwright/test";

// E2E test helpers for the Driver Mini App.
// These helpers seed the in-memory session store via the compile-time gated
// window.__waslaE2E hook. No production backdoor is created.

export const TEST_TOKEN = "e2e-test-token";
export const TEST_DRIVER_ID = "drv_test_e2e";

/** Seed an authenticated session via the E2E hook. */
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __waslaE2ESession?: unknown }).__waslaE2ESession = {
      token: "e2e-test-token",
      driverId: "drv_test_e2e",
      expiresAt: Date.now() + 3_600_000,
    };
  });
}

/** Navigate to a hash route and wait for the app to settle. */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`http://localhost:4174/#/${route}`);
  // Wait for the page to load, then wait for the app container
  await page.waitForLoadState("domcontentloaded");
  // Wait for either .app (authenticated) or .app-loading (unauthenticated)
  await page.waitForSelector(".app, .app-loading", { timeout: 10_000 });
  // If loading state is shown, wait for it to transition to .app
  const isLoading = await page.locator(".app-loading").isVisible().catch(() => false);
  if (isLoading) {
    await page.waitForSelector(".app", { timeout: 10_000 });
  }
}

/** Mock driver API endpoints to prevent network errors during E2E tests. */
export async function mockDriverApis(page: Page): Promise<void> {
  // Generic fallback: intercept any remaining API calls and return empty JSON.
  // This prevents unhandled requests from hanging the app.
  // Must be registered FIRST so specific routes below take priority.
  // Actually, Playwright uses first-match, so we register specific routes first.

  // Mock dispatch offers (GET /dispatch/jobs/:id/offers, POST /dispatch/offers/:id/accept|reject)
  await page.route("**/dispatch/**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/offers")) {
      if (method === "GET") {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ offers: [] }),
        });
      }
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    }
    // Dispatch jobs (GET /dispatch/jobs/:id, POST /dispatch/jobs/:id/cancel)
    if (method === "GET") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  // Mock driver documents (GET/POST /drivers/:id/documents)
  await page.route("**/drivers/**/documents**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ documents: [] }),
      });
    }
    return route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  // Mock driver vehicles (GET/POST/PATCH /drivers/:id/vehicles)
  await page.route("**/drivers/**/vehicles**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ vehicles: [] }),
      });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  // Mock driver zones (GET/PUT /drivers/:id/zones)
  await page.route("**/drivers/**/zones**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ zones: [] }),
      });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  // Mock driver jobs/earnings (GET /drivers/:id/jobs)
  await page.route("**/drivers/**/jobs**", (route) => {
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ jobs: [] }),
    });
  });

  // Mock driver profile (GET/PATCH /drivers/:id) — catch-all for driver API
  await page.route("**/drivers/**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          wasla_public_id: "DRV-0000000001",
          display_name: "Test Driver",
          preferred_locale: "ar",
          status: "active",
          verification_status: "verified",
          declared_availability: "available",
          work_city_zone_id: null,
          service_kinds: ["ride"],
          suspension_reason_code: null,
          eligibility_policy_version: null,
          eligibility_recheck_at: null,
          last_published_state: null,
          last_published_at: null,
          created_at: "2026-09-22T00:00:00Z",
          updated_at: "2026-09-22T00:00:00Z",
        }),
      });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}
