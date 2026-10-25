import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute } from "./helpers";

// Navigation smoke tests: verify all screens are reachable via hash routes.
// Confirms router wiring from Wave 6 App.tsx integration.

test.describe("Navigation smoke", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  // ADR-072 D1 (G-S7 · owner decision 2026-10-18): Home is exactly the seven
  // items of CMS §3.1; saved places moved to Profile. (Was: "home shows all 8
  // menu items", which included saved places.)
  test("home shows exactly the seven spec menu items and no saved-places entry", async ({ page }) => {
    await gotoRoute(page, "home");

    const links = page.locator(".home nav a");
    await expect(links).toHaveCount(7);
    await expect(page.getByText("اطلب مشوار")).toBeVisible();
    await expect(page.getByText("اطلب توصيل")).toBeVisible();
    await expect(page.getByText("تصفح المتاجر")).toBeVisible();
    await expect(page.getByText("ابحث")).toBeVisible();
    await expect(page.getByText("طلباتي")).toBeVisible();
    await expect(page.getByText("سمعتي")).toBeVisible();
    await expect(page.getByText("حسابي")).toBeVisible();
    await expect(page.getByText("الأماكن المحفوظة")).toHaveCount(0);
    await expect(page.locator('.home a[href="#/places"]')).toHaveCount(0);
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
