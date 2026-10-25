import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, mockDriverApis } from "./helpers";

// G-S13 (CLM-0614): «أرباحي» counts and sums completed jobs only, and the
// request carries only the contract's `period` parameter. The orders route is
// mocked (page.route); the service side is proven in services/orders
// `driver-jobs.test.ts`.

test("earnings ignore cancelled jobs and send only ?period=", async ({ page }) => {
  await seedSession(page);
  await mockDriverApis(page);
  const urls: string[] = [];
  const job = (id: string, status: string, amount: number) => ({
    order_public_id: id, order_type: "ride", vehicle_class: "sedan", status,
    agreed_price: { amount_minor: amount, currency: "SAR" },
    agreed_at: "2026-10-18T08:00:00Z", completed_at: "2026-10-18T08:30:00Z",
    pickup_label: "A", dropoff_label: "B",
  });
  await page.route("**/orders/drivers/*/jobs**", (route) => {
    urls.push(route.request().url());
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          job("ORD-0000000001", "completed", 2500),
          job("ORD-0000000002", "driver_cancelled", 9000),
          job("ORD-0000000003", "completed", 1500),
        ],
      }),
    });
  });

  await gotoRoute(page, "earnings");
  await expect(page.getByTestId("summary-count")).toContainText("2");
  await expect(page.getByTestId("job-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("job-ORD-0000000002")).toHaveCount(0);
  await expect(page.getByTestId("summary-total")).toContainText("40");

  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) {
    const q = new URL(u).searchParams;
    expect([...q.keys()]).toEqual(["period"]);
  }
});
