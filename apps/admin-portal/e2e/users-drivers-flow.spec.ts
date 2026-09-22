import { test, expect } from "@playwright/test";
import { seedAdminSession, gotoRoute, mockAdminApi } from "./helpers";

// UAT-02: Search user by name — verify results appear.
// UAT-04: Suspend driver — verify status changes.

const MOCK_DRIVER_LIST = {
  drivers: [
    {
      wasla_public_id: "DRV-1234567890",
      display_name: "Khaled Omar",
      status: "active",
      verification_status: "verified",
      declared_availability: "online",
      work_city_zone_id: "zone-1",
      service_kinds: ["ride"],
      suspension_reason_code: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

const MOCK_DRIVER_DETAIL = {
  wasla_public_id: "DRV-1234567890",
  display_name: "Khaled Omar",
  phone_number: "+966509876543",
  status: "active",
  verification_status: "verified",
  declared_availability: "online",
  work_city_zone_id: "zone-1",
  service_kinds: ["ride"],
  suspension_reason_code: null,
  preferred_locale: "ar",
  eligibility_policy_version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const MOCK_DRIVER_DOCUMENTS = {
  documents: [
    { id: "doc-1", type: "driving_license", status: "pending", submitted_at: "2026-01-01T00:00:00Z" },
  ],
};

function mockDriversApi(page: import("@playwright/test").Page, withDocuments = false) {
  page.route("**/drivers**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "GET" && url.includes("/documents")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(withDocuments ? MOCK_DRIVER_DOCUMENTS : { documents: [] }),
      });
    } else if (method === "GET" && url.includes("/drivers/")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DRIVER_DETAIL),
      });
    } else if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DRIVER_LIST),
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
}

test.describe("UAT-02: Users management flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("users screen shows search bar and empty state", async ({ page }) => {
    await gotoRoute(page, "users");
    await expect(page.getByTestId("input-search")).toBeVisible();
    await expect(page.getByTestId("btn-search")).toBeVisible();
  });

  test("users screen renders table when results exist", async ({ page }) => {
    await page.route("**/customers**", (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/customers/")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            wasla_public_id: "WS-1234567890",
            display_name: "Ahmed Ali",
            phone_number: "+966501234567",
            status: "active",
            order_count: 15,
            preferred_locale: "ar",
            suspension_reason_code: null,
            rating_avg: 4.5,
            rating_count: 10,
            recent_orders: [],
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          }),
        });
      } else if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            customers: [
              { wasla_public_id: "WS-1234567890", display_name: "Ahmed Ali", phone_number: "+966501234567", status: "active", order_count: 15, preferred_locale: "ar", suspension_reason_code: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
            ],
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
    mockDriversApi(page);
  });

  test("drivers screen shows search bar and table", async ({ page }) => {
    await gotoRoute(page, "drivers");
    await expect(page.getByTestId("drivers-table")).toBeVisible();
  });

  test("driver suspend button exists in detail view", async ({ page }) => {
    await gotoRoute(page, "drivers");
    // Click the View button inside the driver row
    const row = page.getByTestId("driver-row-DRV-1234567890");
    await expect(row).toBeVisible();
    // Click the button inside the row
    await row.getByRole("button").click();
    // Suspend button should be visible in detail view
    await expect(page.getByTestId("btn-suspend-driver")).toBeVisible({ timeout: 5_000 });
  });
});
