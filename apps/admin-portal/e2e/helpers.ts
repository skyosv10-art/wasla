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
  // Users (customers) endpoints — response format: { customers: [...] }
  await page.route("**/customers**", (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "GET" && url.includes("/customers/")) {
      // User detail
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          wasla_public_id: "WS-1234567890",
          full_name: "Ahmed Ali",
          phone_number: "+966501234567",
          status: "active",
          order_count: 15,
          preferred_locale: "ar",
          created_at: "2026-01-01T00:00:00Z",
        }),
      });
    } else if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ customers: [], limit: 50, offset: 0 }),
      });
    } else if (method === "POST") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1, status: "suspended" }),
      });
    } else {
      route.fulfill({ status: 405 });
    }
  });

  // Drivers endpoints — response format: { drivers: [...] }
  await page.route("**/drivers**", (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "GET" && url.includes("/drivers/") && url.includes("/documents")) {
      // Driver documents
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          documents: [
            { id: "doc-1", type: "driving_license", status: "pending", submitted_at: "2026-01-01T00:00:00Z" },
          ],
        }),
      });
    } else if (method === "GET" && url.includes("/drivers/")) {
      // Driver detail
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          wasla_public_id: "DRV-1234567890",
          full_name: "Khaled Omar",
          phone_number: "+966509876543",
          status: "active",
          vehicle_class: "sedan",
          rating_avg: 4.5,
          verification_status: "verified",
          availability_status: "online",
          zone_id: "zone-1",
          service_kinds: ["ride"],
          created_at: "2026-01-01T00:00:00Z",
        }),
      });
    } else if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drivers: [], limit: 50, offset: 0 }),
      });
    } else if (method === "POST") {
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
  await page.route("**/orders/**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], limit: 50, offset: 0 }),
    });
  });

  // Audit endpoints
  await page.route("**/audit/**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [], total: 0, limit: 50 }),
    });
  });
}
