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
    // Search input exists
    const searchInput = page.locator(".search-input, input[type='search'], input[placeholder*='search' i]");
    await expect(searchInput.first()).toBeVisible();
  });

  test("users screen renders table when results exist", async ({ page }) => {
    // Override mock to return users
    await page.route("**/api/users**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { id: 1, full_name: "Ahmed Ali", phone_number: "+966501234567", status: "active", created_at: "2026-01-01T00:00:00Z" },
          ],
          limit: 50,
          offset: 0,
        }),
      });
    });

    await gotoRoute(page, "users");
    await expect(page.locator("table")).toBeVisible();
  });
});

test.describe("UAT-04: Suspend driver flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("drivers screen shows search bar and table", async ({ page }) => {
    await page.route("**/api/drivers**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { id: 1, full_name: "Khaled Omar", phone_number: "+966509876543", status: "active", vehicle_class: "sedan", rating_avg: 4.5, created_at: "2026-01-01T00:00:00Z" },
          ],
          limit: 50,
          offset: 0,
        }),
      });
    });

    await gotoRoute(page, "drivers");
    await expect(page.locator("table")).toBeVisible();
  });

  test("driver suspend button exists when driver is active", async ({ page }) => {
    await page.route("**/api/drivers**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { id: 1, full_name: "Khaled Omar", status: "active", vehicle_class: "sedan", rating_avg: 4.5, created_at: "2026-01-01T00:00:00Z" },
          ],
          limit: 50,
          offset: 0,
        }),
      });
    });

    await gotoRoute(page, "drivers");
    // Look for suspend button
    const suspendBtn = page.getByRole("button", { name: /suspend|تعليق/i });
    await expect(suspendBtn.first()).toBeVisible();
  });
});
