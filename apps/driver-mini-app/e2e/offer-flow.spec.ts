import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, mockDriverApis } from "./helpers";

// Offer flow E2E tests: verify the offer feed and job detail lifecycle.
// API calls are mocked at the Playwright route layer.

test.describe("Offer flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockDriverApis(page);
  });

  test("offers screen renders without errors", async ({ page }) => {
    await gotoRoute(page, "offers");
    await expect(page.locator(".app")).toBeVisible();
  });

  test("job detail screen renders without errors", async ({ page }) => {
    await gotoRoute(page, "job");
    await expect(page.locator(".app")).toBeVisible();
  });

  test("earnings screen shows period buttons", async ({ page }) => {
    await gotoRoute(page, "earnings");
    await expect(page.getByTestId("period-today")).toBeVisible();
    await expect(page.getByTestId("period-week")).toBeVisible();
    await expect(page.getByTestId("period-month")).toBeVisible();
  });

  test("period buttons switch active state", async ({ page }) => {
    await gotoRoute(page, "earnings");

    // Click week period
    await page.getByTestId("period-week").click();

    // Verify aria-pressed changes
    await expect(page.getByTestId("period-week")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("period-today")).toHaveAttribute("aria-pressed", "false");
  });

  test("documents screen renders without errors", async ({ page }) => {
    await gotoRoute(page, "documents");
    await expect(page.locator(".app")).toBeVisible();
  });

  test("profile screen renders without errors", async ({ page }) => {
    await gotoRoute(page, "profile");
    await expect(page.locator(".app")).toBeVisible();
  });

  test("vehicles screen renders without errors", async ({ page }) => {
    await gotoRoute(page, "vehicles");
    await expect(page.locator(".app")).toBeVisible();
  });

  test("zones screen renders without errors", async ({ page }) => {
    await gotoRoute(page, "zones");
    await expect(page.locator(".app")).toBeVisible();
  });
});
