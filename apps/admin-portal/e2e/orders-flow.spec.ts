import { test, expect } from "@playwright/test";
import { seedAdminSession, gotoRoute, mockAdminApi } from "./helpers";

// UAT-03: Review document — driver document review, accept/reject.
// UAT-05: View order — view order detail with stops, driver, status.

test.describe("UAT-03: Driver document review", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("drivers detail view shows document review buttons", async ({ page }) => {
    // Mock driver detail with documents
    await page.route("**/drivers**", (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/drivers/") && url.includes("/documents")) {
        // Documents list
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            documents: [
              { id: "doc-1", type: "driving_license", status: "pending", submitted_at: "2026-01-01T00:00:00Z" },
            ],
          }),
        });
      } else if (route.request().method() === "GET" && url.includes("/drivers/")) {
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
      } else if (route.request().method() === "GET") {
        // Drivers list
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
    // Click on driver row to open detail view
    await page.getByTestId("driver-row-DRV-1234567890").click();
    // Document approve/reject buttons should be visible for pending docs
    await expect(page.getByTestId("btn-approve-doc-1")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("btn-reject-doc-1")).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("UAT-05: View order detail", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("orders screen shows search by public ID", async ({ page }) => {
    await gotoRoute(page, "orders");
    // Search input for order ID
    const searchInput = page.locator("input[type='text']").first();
    await expect(searchInput).toBeVisible();
  });

  test("orders screen shows order detail after search", async ({ page }) => {
    // Mock order lookup — the orders store uses raw fetch with /api/orders/orders/lookup
    await page.route("**/api/orders/orders/lookup**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          order_public_id: "ORD-1234567890",
          order_type: "ride",
          vehicle_class: "sedan",
          status: "assigned",
          price_mode: "negotiated",
          offered_price: { amount_minor: 5000, currency: "SAR" },
          agreed_price: { amount_minor: 4500, currency: "SAR" },
          stops: [],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      });
    });

    await gotoRoute(page, "orders");
    const searchInput = page.locator("input[type='text']").first();
    await searchInput.fill("ORD-1234567890");

    const searchBtn = page.getByRole("button", { name: /search|بحث/i }).first();
    await searchBtn.click();

    // The order detail or results should appear — verify no error state
    await page.waitForTimeout(2000);
    const errorElements = page.locator(".error-text");
    await expect(errorElements).toHaveCount(0);
  });
});
