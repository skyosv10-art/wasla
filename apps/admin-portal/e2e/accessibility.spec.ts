import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedAdminSession, gotoRoute, mockAdminApi } from "./helpers";

// Accessibility E2E tests: verify WCAG 2.0 A/AA compliance across all admin screens.
// Uses @axe-core/playwright to run automated accessibility audits.
// Desktop viewport, RTL Arabic default (per ADR-047).

test.describe("Accessibility — axe-core audit", () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminSession(page);
    await mockAdminApi(page);
  });

  test("dashboard has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "dashboard");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("users screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "users");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("drivers screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "drivers");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("orders screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "orders");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("audit log screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "audit");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
