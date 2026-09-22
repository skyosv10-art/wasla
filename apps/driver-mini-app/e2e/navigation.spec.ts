import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, mockDriverApis } from "./helpers";

// Navigation smoke tests: verify all screens are reachable via hash routes.
// Confirms router wiring from App.tsx integration.

test.describe("Navigation smoke", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockDriverApis(page);
  });

  test("home shows all 6 menu items", async ({ page }) => {
    await gotoRoute(page, "home");

    await expect(page.getByText("العروض")).toBeVisible();
    await expect(page.getByText("مهمة نشطة")).toBeVisible();
    await expect(page.getByText("أرباحي")).toBeVisible();
    await expect(page.getByText("مركباتي")).toBeVisible();
    await expect(page.getByText("مناطق عملي")).toBeVisible();
    await expect(page.getByText("الملف الشخصي")).toBeVisible();
  });

  test("navigates to offers screen", async ({ page }) => {
    await gotoRoute(page, "offers");
    await expect(page.locator("h2")).toBeVisible();
  });

  test("navigates to job detail screen", async ({ page }) => {
    await gotoRoute(page, "job");
    await expect(page.locator("h2")).toBeVisible();
  });

  test("navigates to earnings screen", async ({ page }) => {
    await gotoRoute(page, "earnings");
    await expect(page.getByText("أرباحي")).toBeVisible();
  });

  test("navigates to vehicles screen", async ({ page }) => {
    await gotoRoute(page, "vehicles");
    await expect(page.getByText("مركباتي")).toBeVisible();
  });

  test("navigates to zones screen", async ({ page }) => {
    await gotoRoute(page, "zones");
    await expect(page.getByText("مناطق عملي")).toBeVisible();
  });

  test("navigates to documents screen", async ({ page }) => {
    await gotoRoute(page, "documents");
    await expect(page.locator("h2")).toBeVisible();
  });

  test("navigates to profile screen", async ({ page }) => {
    await gotoRoute(page, "profile");
    await expect(page.locator("h2")).toBeVisible();
  });

  test("clicking menu items navigates correctly", async ({ page }) => {
    await gotoRoute(page, "home");

    // Click the offers link
    await page.getByRole("link", { name: "العروض" }).click();
    await expect(page.locator("h2")).toBeVisible();

    // Navigate back home via hash
    await page.evaluate(() => {
      window.location.hash = "#/home";
    });
    await expect(page.locator(".app")).toBeVisible();
  });
});
