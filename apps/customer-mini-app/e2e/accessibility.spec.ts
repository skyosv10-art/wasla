import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedSession, gotoRoute } from "./helpers";

// Accessibility E2E tests: verify WCAG A/AA compliance across all screens.
// Uses @axe-core/playwright to run automated accessibility audits.
// Mobile viewport, RTL Arabic default (per ADR-044).

test.describe("Accessibility — axe-core audit", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);

    // Mock all API endpoints to prevent network errors from affecting a11y
    await page.route("**/customers/**", (route) => {
      const method = route.request().method();
      if (method === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 50 }) });
      } else if (method === "POST") {
        route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "mock", created_at: "2026-09-22T00:00:00Z" }) });
      } else if (method === "DELETE") {
        route.fulfill({ status: 204 });
      } else if (method === "PUT") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      }
    });
    await page.route("**/stores", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });
    await page.route("**/stores/**", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });
    await page.route("**/search/**", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) });
    });
    await page.route("**/reputation/**", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ score: 0, level: "fair" }) });
    });
    await page.route("**/reputation/ratings**", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) });
    });
  });

  test("home screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "home");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("ride order screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "ride");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("delivery order screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "delivery");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("saved places screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "places");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("marketplace screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "marketplace");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("search screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "search");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("my orders screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "orders");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("reputation screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "reputation");
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("profile screen has no WCAG A/AA violations", async ({ page }) => {
    await gotoRoute(page, "profile");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
