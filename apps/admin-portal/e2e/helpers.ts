import type { Page } from "@playwright/test";

// E2E test helpers for the Admin Portal.
// These helpers seed the in-memory session store via the compile-time gated
// window.__waslaE2E hook. No production backdoor is created.

export const TEST_TOKEN = "e2e-admin-token";
export const TEST_USER_ID = "admin-001";

/** Seed an admin session via the E2E hook. */
export async function seedAdminSession(page: Page, role: string = "admin"): Promise<void> {
  await page.addInitScript((r) => {
    (window as unknown as { __waslaE2ESession?: unknown }).__waslaE2ESession = {
      token: "e2e-admin-token",
      userId: "admin-001",
      role: r,
      expiresAt: Date.now() + 3_600_000,
    };
  }, role);
}

/** Navigate to a hash route and wait for the app to render. */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`http://localhost:4173/#/${route}`);
  await page.waitForSelector(".app", { timeout: 10_000 });
}

/** Mock all admin API endpoints to prevent network errors. */
export async function mockAdminApi(page: Page): Promise<void> {
  // Users endpoints
  await page.route("**/api/users**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], limit: 50, offset: 0 }),
      });
    } else if (method === "PATCH") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1, status: "suspended" }),
      });
    } else {
      route.fulfill({ status: 405 });
    }
  });

  // Drivers endpoints
  await page.route("**/api/drivers**", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], limit: 50, offset: 0 }),
      });
    } else if (method === "PATCH") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1, status: "suspended" }),
      });
    } else {
      route.fulfill({ status: 405 });
    }
  });

  // Orders endpoints
  await page.route("**/api/orders/**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], limit: 50, offset: 0 }),
    });
  });

  // Audit endpoints
  await page.route("**/api/audit/**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [], total: 0, limit: 50 }),
    });
  });
}
