import { test, expect } from "@playwright/test";
import { seedSession } from "./helpers";

// Security E2E tests: verify that the in-memory session model is secure.
// ADR-044 Decision 4: Session token in memory only, no localStorage.
// ADR-019 §2.5: Token never persisted to localStorage, sessionStorage, or cookies.

test.describe("Session security", () => {
  test("fresh browser shows loading state without session", async ({ page }) => {
    // No session seeded — app should show loading state
    await page.goto("http://localhost:4173/");

    // The loading text should be visible
    await expect(page.locator(".app-loading")).toBeVisible();
    await expect(page.getByText("جارٍ التحميل")).toBeVisible();
  });

  test("no API calls are made without a session token", async ({ page }) => {
    // Intercept all requests to verify no customer API calls happen
    const apiCalls: string[] = [];
    await page.route("**/customers/**", (route) => {
      apiCalls.push(route.request().url());
      route.abort();
    });

    await page.goto("http://localhost:4173/");

    // Wait a moment for any potential requests
    await page.waitForTimeout(1000);

    expect(apiCalls).toHaveLength(0);
  });

  test("localStorage does not contain session token", async ({ page }) => {
    await page.goto("http://localhost:4173/");
    await page.waitForTimeout(500);

    const localStorageContent = await page.evaluate(() => {
      return JSON.stringify(window.localStorage);
    });

    // localStorage should be empty or at least not contain token/session
    expect(localStorageContent).not.toContain("e2e-test-token");
    expect(localStorageContent).not.toContain("token");
    expect(localStorageContent).not.toContain("WS-");
  });

  test("sessionStorage does not contain session token", async ({ page }) => {
    await page.goto("http://localhost:4173/");
    await page.waitForTimeout(500);

    const sessionStorageContent = await page.evaluate(() => {
      return JSON.stringify(window.sessionStorage);
    });

    expect(sessionStorageContent).not.toContain("e2e-test-token");
    expect(sessionStorageContent).not.toContain("token");
    expect(sessionStorageContent).not.toContain("WS-");
  });

  test("authenticated session shows app content", async ({ page }) => {
    await seedSession(page);
    await page.goto("http://localhost:4173/");

    // Should show the app, not loading state
    await expect(page.locator(".app")).toBeVisible();
    await expect(page.locator(".home")).toBeVisible();
  });
});
