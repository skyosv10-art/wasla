import { test, expect } from "@playwright/test";

// M3-06 frontend quality gate: locale override, offline banner, responsive layout.
// Mobile viewport (375x667) and RTL Arabic default come from playwright.config.ts.

test.describe("Frontend quality (M3-06)", () => {
  test("locale override ?locale=en switches document lang/dir and renders English", async ({ page }) => {
    await page.goto("http://localhost:4173/?locale=en#/dashboard");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByText("Loading...")).toBeVisible();
  });

  test("offline banner appears when the network drops and clears on reconnect", async ({ page }) => {
    await page.goto("http://localhost:4173/#/dashboard");

    await page.context().setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toContainText("غير متصل");

    // corrective hardening (CLM-0324): the banner must be a full-width top bar,
    // never a side-by-side flex child of the loading/shell container.
    const bannerGeo = await page.getByTestId("offline-banner").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, width: r.width, viewport: window.innerWidth };
    });
    expect(bannerGeo.top).toBeLessThanOrEqual(1);
    expect(bannerGeo.viewport - bannerGeo.width).toBeLessThanOrEqual(1);

    await page.context().setOffline(false);
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:4173/#/dashboard");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
