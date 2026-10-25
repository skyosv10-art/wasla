import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, mockDriverApis } from "./helpers";

// G-S10 (CLM-0613): availability toggle + eligibility path on Home, in a real
// browser. The edge/services are mocked (page.route) — this proves the screen
// wiring and the request it sends, not live integration (that is the drivers
// service test `availability-eligibility-boundaries.test.ts`).

test.describe("Home availability and eligibility (G-S10)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockDriverApis(page);
  });

  test("toggle sends PUT availability with offline, then available — never busy", async ({ page }) => {
    const bodies: unknown[] = [];
    page.on("request", (req) => {
      if (req.method() === "PUT" && req.url().endsWith("/availability")) bodies.push(req.postDataJSON());
    });

    await gotoRoute(page, "home");
    await expect(page.getByTestId("home-eligibility-state")).toHaveText("مؤهل للعمل");
    await expect(page.getByTestId("home-availability-state")).toHaveText("متاح لاستقبال العروض");

    await page.getByTestId("home-availability-toggle").click();
    await expect(page.getByTestId("home-availability-state")).toHaveText("غير متصل — لا تصلك عروض");
    await page.getByTestId("home-availability-toggle").click();
    await expect(page.getByTestId("home-availability-state")).toHaveText("متاح لاستقبال العروض");

    expect(bodies).toEqual([{ declared_availability: "offline" }, { declared_availability: "available" }]);
  });

  test("an ineligible driver sees the reasons and reaches Documents from Home", async ({ page }) => {
    await page.route("**/drivers/*/eligibility", (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          wasla_public_id: "DRV-0000000001", eligibility_state: "ineligible",
          reason_codes: ["DOCUMENT_EXPIRED", "NO_SERVICE_ZONE"], policy_version: 1,
          evaluated_at: "2026-10-18T00:00:00Z",
        }),
      }),
    );

    await gotoRoute(page, "home");
    const blocked = page.getByTestId("home-eligibility-blocked");
    await expect(blocked).toBeVisible();
    await expect(blocked.getByRole("listitem")).toHaveText(["وثيقة منتهية", "لم تُحدَّد منطقة عمل"]);

    await page.getByTestId("home-eligibility-documents").click();
    await expect(page).toHaveURL(/#\/documents$/);
  });
});
