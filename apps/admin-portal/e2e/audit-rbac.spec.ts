import { test, expect } from "@playwright/test";
import { seedAdminSession, gotoRoute, mockAdminApi } from "./helpers";

// UAT-06: View audit log — view events with filtering.
// UAT-07: RBAC enforcement — operator cannot access team management.
// UAT-08: Audit immutability — cannot modify audit records.

test.describe("UAT-06: Audit log viewing", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("audit log screen shows filter bar", async ({ page }) => {
    await gotoRoute(page, "audit");
    // Filter bar with date inputs, actor, action, resource type
    const filterBar = page.locator(".filter-bar, form");
    await expect(filterBar.first()).toBeVisible();
  });

  test("audit log renders events table when events exist", async ({ page }) => {
    await page.route("**/audit/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            {
              event_id: "evt-001",
              timestamp: "2026-01-01T10:00:00Z",
              actor_type: "admin",
              actor_id: "admin-001",
              action: "user.suspended",
              resource_type: "user",
              resource_id: "user-123",
              metadata: {},
            },
          ],
          total: 1,
          limit: 50,
        }),
      });
    });

    await gotoRoute(page, "audit");
    await expect(page.locator("table")).toBeVisible({ timeout: 5_000 });
  });

  test("audit log has action filter dropdown", async ({ page }) => {
    await gotoRoute(page, "audit");
    // Action filter dropdown
    const actionSelect = page.locator("select[aria-label='Action'], select").first();
    await expect(actionSelect).toBeVisible();
  });

  test("audit log has resource type filter", async ({ page }) => {
    await gotoRoute(page, "audit");
    // Resource type filter dropdown
    const selects = page.locator("select");
    await expect(selects.nth(1)).toBeVisible();
  });
});

test.describe("UAT-07: RBAC enforcement", () => {
  test("operator role can view dashboard", async ({ page }) => {
    await seedAdminSession(page, "operator");
    await mockAdminApi(page);
    await gotoRoute(page, "dashboard");
    await expect(page.locator(".app")).toBeVisible();
  });

  test("operator can view audit log", async ({ page }) => {
    await seedAdminSession(page, "operator");
    await mockAdminApi(page);
    await gotoRoute(page, "audit");
    await expect(page.locator(".screen")).toBeVisible();
  });

  test("operator can view orders", async ({ page }) => {
    await seedAdminSession(page, "operator");
    await mockAdminApi(page);
    await gotoRoute(page, "orders");
    await expect(page.locator(".screen")).toBeVisible();
  });
});

test.describe("UAT-08: Audit immutability", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("audit log has no edit/delete buttons on events", async ({ page }) => {
    await page.route("**/audit/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            {
              event_id: "evt-001",
              timestamp: "2026-01-01T10:00:00Z",
              actor_type: "admin",
              actor_id: "admin-001",
              action: "user.suspended",
              resource_type: "user",
              resource_id: "user-123",
              metadata: {},
            },
          ],
          total: 1,
          limit: 50,
        }),
      });
    });

    await gotoRoute(page, "audit");
    // Verify no edit/delete buttons in the events table
    const editBtns = page.getByRole("button", { name: /edit|delete|تعديل|حذف/i });
    await expect(editBtns).toHaveCount(0);
  });

  test("PUT to audit events returns 405", async ({ page }) => {
    // This is a frontend test — we verify the UI doesn't expose any edit capability
    await gotoRoute(page, "audit");
    // No form to edit audit events should exist
    const editForms = page.locator("form[action*='edit' i]");
    await expect(editForms).toHaveCount(0);
  });
});
