import type { Page } from "@playwright/test";

// E2E test helpers for the Customer Mini App.
// These helpers seed the in-memory session store via the compile-time gated
// window.__waslaE2E hook. No production backdoor is created.

export const TEST_TOKEN = "e2e-test-token";
export const TEST_CUSTOMER_ID = "WS-1234567890";

export interface MockOrderPreview {
  order_type: string;
  vehicle_class: string;
  stops: unknown[];
  offered_price?: { amount: number; currency: string };
}

export interface MockOrderResult {
  order_request_id: string;
  order_public_id: string;
  status: string;
}

export const MOCK_PREVIEW: MockOrderPreview = {
  order_type: "ride",
  vehicle_class: "sedan",
  stops: [
    { kind: "pickup", zone_id: "zone-1", label: "Home" },
    { kind: "dropoff", zone_id: "zone-2", label: "Work" },
  ],
};

export const MOCK_ORDER_RESULT: MockOrderResult = {
  order_request_id: "ord-123",
  order_public_id: "ORD-ABC123",
  status: "submitted",
};

/** Seed an authenticated session via the E2E hook. */
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __waslaE2ESession?: unknown }).__waslaE2ESession = {
      token: "e2e-test-token",
      customerId: "WS-1234567890",
      expiresAt: Date.now() + 3_600_000,
    };
  });
}

/** Navigate to a hash route and wait for the page to settle. */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`http://localhost:4173/#/${route}`);
  // Wait for the app to render (not loading state)
  await page.waitForSelector(".app", { timeout: 10_000 });
}
