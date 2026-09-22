import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute } from "./helpers";

// Navigation smoke tests: verify all screens are reachable via hash routes.
// Confirms router wiring from Wave 6 App.tsx integration.

test.describe("Navigation smoke", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("home shows all 8 menu items", async ({ page }) => {
    await gotoRoute(page, "home");

    // Verify all menu items are present
    await expect(page.getByText("اطلب مشوار")).toBeVisible();
    await expect(page.getByText("اطلب توصيل")).toBeVisible();
    await expect(page.getByText("الأماكن المحفوظة")).toBeVisible();
    await expect(page.getByText("تصفح المتاجر")).toBeVisible();
    await expect(page.getByText("ابحث")).toBeVisible();
    await expect(page.getByText("طلباتي")).toBeVisible();
    await expect(page.getByText("سمعتي")).toBeVisible();
    await expect(page.getByText("حسابي")).toBeVisible();
  });

  test("navigates to ride order screen", async ({ page }) => {
    await gotoRoute(page, "ride");
    await expect(page.locator(".ride-order-screen")).toBeVisible();
    await expect(page.getByText("طلب مشوار")).toBeVisible();
  });

  test("navigates to delivery order screen", async ({ page }) => {
    await gotoRoute(page, "delivery");
    await expect(page.getByText("طلب توصيل")).toBeVisible();
  });

  test("navigates to saved places screen", async ({ page }) => {
    await gotoRoute(page, "places");
    await expect(page.getByText("الأماكن المحفوظة")).toBeVisible();
  });

  test("navigates to marketplace screen", async ({ page }) => {
    await gotoRoute(page, "marketplace");
    await expect(page.getByText("المتاجر")).toBeVisible();
  });

  test("navigates to search screen", async ({ page }) => {
    await gotoRoute(page, "search");
    await expect(page.getByText("البحث")).toBeVisible();
  });

  test("navigates to my orders screen", async ({ page }) => {
    await gotoRoute(page, "orders");
    await expect(page.getByText("طلباتي")).toBeVisible();
  });

  test("navigates to reputation screen", async ({ page }) => {
    await gotoRoute(page, "reputation");
    await expect(page.getByText("السمعة")).toBeVisible();
  });

  test("navigates to profile screen", async ({ page }) => {
    await gotoRoute(page, "profile");
    await expect(page.getByText("الملف الشخصي")).toBeVisible();
  });

  test("clicking menu items navigates correctly", async ({ page }) => {
    await gotoRoute(page, "home");

    // Click the ride order link
    await page.getByRole("link", { name: "اطلب مشوار" }).click();
    await expect(page.locator(".ride-order-screen")).toBeVisible();

    // Navigate back home via hash
    await page.evaluate(() => {
      window.location.hash = "#/home";
    });
    await expect(page.locator(".home")).toBeVisible();
  });
});
