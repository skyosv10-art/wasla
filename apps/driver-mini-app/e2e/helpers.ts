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

/** Navigate to a hash route and wait for the page to settle. */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`http://localhost:4174/#/${route}`);
  // Wait for the app to render (not loading state)
  await page.waitForSelector(".app", { timeout: 10_000 });
}

/** Mock driver API endpoints to prevent network errors during E2E tests. */
export async function mockDriverApis(page: Page): Promise<void> {
  // Mock dispatch offers
  await page.route("**/dispatch/offers**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ offers: [] }),
    });
  });
  // Mock dispatch jobs
  await page.route("**/dispatch/jobs/**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
  // Mock driver documents
  await page.route("**/drivers/**/documents**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ documents: [] }),
      });
    } else if (method === "POST") {
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
  // Mock driver profile
  await page.route("**/drivers/**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
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
    } else if (method === "PATCH") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
  // Mock driver vehicles
  await page.route("**/drivers/**/vehicles**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ vehicles: [] }),
      });
    } else if (method === "POST" || method === "PATCH") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
  // Mock driver zones
  await page.route("**/drivers/**/zones**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ zones: [] }),
      });
    } else if (method === "PUT") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
  // Mock driver jobs (earnings)
  await page.route("**/drivers/**/jobs**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobs: [] }),
    });
  });
}
