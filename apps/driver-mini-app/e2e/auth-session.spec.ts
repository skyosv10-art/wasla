import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, mockDriverApis } from "./helpers";

// Session security E2E tests: verify that the in-memory session model is secure.
// ADR-045 Decision 4: Session token in memory only, no localStorage.

test.describe("Session security", () => {
  // G-S8 (CLM-0610): outside Telegram there is no session source, so the app
  // says so with a retry instead of parking on «جارٍ التحميل» forever. (Was:
  // "fresh browser shows loading state without session".)
  test("fresh browser outside Telegram shows an explicit session error, not endless loading", async ({ page }) => {
    await page.goto("http://localhost:4174/");

    await expect(page.getByTestId("session-error")).toHaveText("افتح التطبيق من تلغرام لبدء الجلسة");
    await expect(page.getByTestId("session-retry")).toBeVisible();
    await expect(page.locator(".app-loading")).toHaveCount(0);
  });

  test("a rejected edge session is shown with retry, and retry recovers the app", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: { initData: "query_id=e2e&hash=abc", ready: () => undefined },
      };
    });
    let calls = 0;
    await page.route("**/edge/session", (route) => {
      calls += 1;
      if (calls === 1) {
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "EDGE_UNAVAILABLE", message: "x" }) });
        return;
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "e2e-edge-token",
          wasla_public_id: "WS-1234567890",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          session_id: "s-e2e",
        }),
      });
    });

    await page.goto("http://localhost:4174/");
    await expect(page.getByTestId("session-error")).toHaveText("تعذّر بدء الجلسة");
    expect(calls).toBe(1);

    await page.getByTestId("session-retry").click();
    await expect(page.locator(".app")).toBeVisible();
    expect(calls).toBe(2);
  });

  test("no API calls are made without a session token", async ({ page }) => {
    // Intercept all requests to verify no driver API calls happen
    const apiCalls: string[] = [];
    await page.route("**/drivers/**", (route) => {
      apiCalls.push(route.request().url());
      route.abort();
    });
    await page.route("**/dispatch/**", (route) => {
      apiCalls.push(route.request().url());
      route.abort();
    });

    await page.goto("http://localhost:4174/");

    // Wait a moment for any potential requests
    await page.waitForTimeout(1000);

    expect(apiCalls).toHaveLength(0);
  });

  test("localStorage does not contain session token", async ({ page }) => {
    await page.goto("http://localhost:4174/");
    await page.waitForTimeout(500);

    const localStorageContent = await page.evaluate(() => {
      return JSON.stringify(window.localStorage);
    });

    expect(localStorageContent).not.toContain("e2e-test-token");
    expect(localStorageContent).not.toContain("token");
    expect(localStorageContent).not.toContain("drv_test");
  });

  test("sessionStorage does not contain session token", async ({ page }) => {
    await page.goto("http://localhost:4174/");
    await page.waitForTimeout(500);

    const sessionStorageContent = await page.evaluate(() => {
      return JSON.stringify(window.sessionStorage);
    });

    expect(sessionStorageContent).not.toContain("e2e-test-token");
    expect(sessionStorageContent).not.toContain("token");
    expect(sessionStorageContent).not.toContain("drv_test");
  });

  test("authenticated session shows app content", async ({ page }) => {
    await seedSession(page);
    await page.goto("http://localhost:4174/");

    // Should show the app, not loading state
    await expect(page.locator(".app")).toBeVisible();
    await expect(page.locator(".home")).toBeVisible();
  });

  test("API calls carry Authorization Bearer header", async ({ page }) => {
    await seedSession(page);
    await mockDriverApis(page);

    // Intercept driver API calls and check for Authorization header
    let authHeader: string | null = null;
    await page.route("**/drivers/**", (route) => {
      authHeader = route.request().headers()["authorization"] ?? null;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await page.goto("http://localhost:4174/#/profile");
    await page.waitForTimeout(1000);

    expect(authHeader).toBeTruthy();
    expect(authHeader).toContain("Bearer e2e-test-token");
  });
});
