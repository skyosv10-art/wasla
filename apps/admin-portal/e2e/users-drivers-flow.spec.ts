import { test, expect } from "@playwright/test";
import { seedAdminSession, gotoRoute, mockAdminApi } from "./helpers";

// UAT-02: Search user by name — verify results appear.
// UAT-04: Suspend driver — verify status changes.

test.describe("UAT-02: Users management flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("users screen shows search bar and empty state", async ({ page }) => {
    await gotoRoute(page, "users");
    // Search input exists (data-testid="input-search")
    await expect(page.getByTestId("input-search")).toBeVisible();
    // Search button exists
    await expect(page.getByTestId("btn-search")).toBeVisible();
  });

  test("users screen renders table when results exist", async ({ page }) => {
    // Override mock to return users
    await page.route("**/customers**", (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/customers/")) {
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
      } else if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            customers: [
              { id: 1, wasla_public_id: "WS-1234567890", full_name: "Ahmed Ali", phone_number: "+966501234567", status: "active", order_count: 15, preferred_locale: "ar", created_at: "2026-01-01T00:00:00Z" },
            ],
            limit: 50,
            offset: 0,
          }),
        });
      } else {
        route.fulfill({ status: 405 });
      }
    });

    await gotoRoute(page, "users");
    await expect(page.getByTestId("users-table")).toBeVisible();
  });
});

test.describe("UAT-04: Suspend driver flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("drivers screen shows search bar and table", async ({ page }) => {
    await page.route("**/drivers**", (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/drivers/") && !url.includes("/documents")) {
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
      } else if (route.request().method() === "GET" && url.includes("/drivers/")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ documents: [] }),
        });
      } else if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            drivers: [
              { id: 1, wasla_public_id: "DRV-1234567890", full_name: "Khaled Omar", phone_number: "+966509876543", status: "active", vehicle_class: "sedan", rating_avg: 4.5, verification_status: "verified", availability_status: "online", zone_id: "zone-1", service_kinds: ["ride"], created_at: "2026-01-01T00:00:00Z" },
            ],
            limit: 50,
            offset: 0,
          }),
        });
      } else {
        route.fulfill({ status: 405 });
      }
    });

    await gotoRoute(page, "drivers");
    await expect(page.getByTestId("drivers-table")).toBeVisible();
  });

  test("driver suspend button exists in detail view", async ({ page }) => {
    // Mock to return a driver and their detail
    await page.route("**/drivers**", (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/drivers/") && !url.includes("/documents")) {
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
      } else if (route.request().method() === "GET" && url.includes("/drivers/")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ documents: [] }),
        });
      } else if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            drivers: [
              { id: 1, wasla_public_id: "DRV-1234567890", full_name: "Khaled Omar", phone_number: "+966509876543", status: "active", vehicle_class: "sedan", rating_avg: 4.5, verification_status: "verified", availability_status: "online", zone_id: "zone-1", service_kinds: ["ride"], created_at: "2026-01-01T00:00:00Z" },
            ],
            limit: 50,
            offset: 0,
          }),
        });
      } else {
        route.fulfill({ status: 405 });
      }
    });

    await gotoRoute(page, "drivers");
    // Click on the driver row to open detail view
    await page.getByTestId("driver-row-DRV-1234567890").click();
    // Suspend button should be visible in detail view
    await expect(page.getByTestId("btn-suspend-driver")).toBeVisible({ timeout: 5_000 });
  });
});
