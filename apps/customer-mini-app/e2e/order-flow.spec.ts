import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, MOCK_PREVIEW, MOCK_ORDER_RESULT } from "./helpers";

// Secure order flow E2E tests: verify ride order preview and submit.
// Mocks API at the Playwright route layer — no real backend needed.
// Asserts Authorization: Bearer header and Idempotency-Key on submit.

test.describe("Order flow — ride order", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);

    // Mock the preview endpoint
    await page.route("**/customers/WS-1234567890/order-requests/preview", (route) => {
      const authHeader = route.request().headers()["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) });
        return;
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PREVIEW),
      });
    });

    // Mock the submit endpoint
    await page.route("**/customers/WS-1234567890/order-requests", (route) => {
      if (route.request().method() !== "POST") {
        route.fulfill({ status: 405, body: "Method Not Allowed" });
        return;
      }
      const authHeader = route.request().headers()["authorization"];
      const idempotencyKey = route.request().headers()["idempotency-key"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) });
        return;
      }
      if (!idempotencyKey) {
        route.fulfill({ status: 400, body: JSON.stringify({ message: "Missing Idempotency-Key" }) });
        return;
      }
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(MOCK_ORDER_RESULT),
      });
    });
  });

  test("preview order sends Bearer token", async ({ page }) => {
    await gotoRoute(page, "ride");

    // Fill pickup zone
    await page.getByTestId("pickup-zone-input").fill("zone-1");
    await page.getByTestId("pickup-label-input").fill("Home");

    // Fill dropoff zone
    await page.getByTestId("dropoff-zone-input").fill("zone-2");
    await page.getByTestId("dropoff-label-input").fill("Work");

    // Click preview
    await page.getByTestId("preview-button").click();

    // Verify preview result appears
    await expect(page.getByTestId("preview-result")).toBeVisible({ timeout: 10_000 });
  });

  test("submit order sends Bearer token and Idempotency-Key", async ({ page }) => {
    await gotoRoute(page, "ride");

    // Fill form
    await page.getByTestId("pickup-zone-input").fill("zone-1");
    await page.getByTestId("pickup-label-input").fill("Home");
    await page.getByTestId("dropoff-zone-input").fill("zone-2");
    await page.getByTestId("dropoff-label-input").fill("Work");

    // Preview first
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-result")).toBeVisible({ timeout: 10_000 });

    // Submit
    await page.getByTestId("submit-button").click();

    // Verify success
    await expect(page.getByTestId("submit-success")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("تم إرسال طلبك بنجاح")).toBeVisible();
  });

  test("submit error shows error message", async ({ page }) => {
    // Override the submit mock to return an error
    await page.route("**/customers/WS-1234567890/order-requests", (route) => {
      if (route.request().method() !== "POST") {
        route.fulfill({ status: 405, body: "Method Not Allowed" });
        return;
      }
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Internal server error" }),
      });
    });

    await gotoRoute(page, "ride");

    // Fill form
    await page.getByTestId("pickup-zone-input").fill("zone-1");
    await page.getByTestId("dropoff-zone-input").fill("zone-2");

    // Submit directly (preview not needed for error test, but form must be valid)
    await page.getByTestId("submit-button").click();

    // Verify error appears
    await expect(page.getByTestId("submit-error")).toBeVisible({ timeout: 10_000 });
  });

  test("form validation prevents submit with empty fields", async ({ page }) => {
    await gotoRoute(page, "ride");

    // Try to submit without filling any fields
    await page.getByTestId("submit-button").click();

    // Should show form validation error
    await expect(page.getByTestId("form-error")).toBeVisible({ timeout: 5_000 });
  });
});
