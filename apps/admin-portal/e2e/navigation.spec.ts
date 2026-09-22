import { test, expect } from "@playwright/test";
import { seedAdminSession, gotoRoute, mockAdminApi } from "./helpers";

// UAT-01: Login — admin opens portal, sees Dashboard.
// Navigation smoke: verify all 5 admin screens are reachable via hash routes.

test.describe("UAT-01: Login + Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("dashboard renders after login", async ({ page }) => {
    await gotoRoute(page, "dashboard");
    await expect(page.locator(".app")).toBeVisible();
    // Dashboard has stat cards or alert cards
    const cards = page.locator(".stat-card, .alert-card");
    await expect(cards.first()).toBeVisible();
  });

  test("navigates to users screen", async ({ page }) => {
    await gotoRoute(page, "users");
    await expect(page.locator(".screen")).toBeVisible();
  });

  test("navigates to drivers screen", async ({ page }) => {
    await gotoRoute(page, "drivers");
    await expect(page.locator(".screen")).toBeVisible();
  });

  test("navigates to orders screen", async ({ page }) => {
    await gotoRoute(page, "orders");
    await expect(page.locator(".screen")).toBeVisible();
  });

  test("navigates to audit log screen", async ({ page }) => {
    await gotoRoute(page, "audit");
    await expect(page.locator(".screen")).toBeVisible();
  });

  test("sidebar has all 5 nav links", async ({ page }) => {
    await gotoRoute(page, "dashboard");
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-users")).toBeVisible();
    await expect(page.getByTestId("nav-drivers")).toBeVisible();
    await expect(page.getByTestId("nav-orders")).toBeVisible();
    await expect(page.getByTestId("nav-audit")).toBeVisible();
  });
});
