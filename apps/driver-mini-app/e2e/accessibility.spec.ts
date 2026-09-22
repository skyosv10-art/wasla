import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedSession, gotoRoute, mockDriverApis } from "./helpers";

// Accessibility E2E tests: verify WCAG A/AA compliance across all screens.
// Uses @axe-core/playwright to run automated accessibility audits.
// Mobile viewport, RTL Arabic default (per ADR-045).

test.describe("Accessibility — axe-core audit", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockDriverApis(page);
  });

  test("home screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "home");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("offers screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "offers");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("job detail screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "job");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("earnings screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "earnings");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("vehicles screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "vehicles");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("zones screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "zones");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("documents screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "documents");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("profile screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "profile");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
