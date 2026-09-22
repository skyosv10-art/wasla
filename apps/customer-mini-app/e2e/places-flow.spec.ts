import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute } from "./helpers";
import type { SavedPlace } from "../src/store/places";

// Saved places E2E tests: verify places CRUD flow.
// Mocks API at the Playwright route layer with stateful tracking.
// Asserts Authorization: Bearer header on all requests.

const INITIAL_PLACES: SavedPlace[] = [
  { place_id: "place-1", label: "Home", zone_id: "zone-1", created_at: "2026-09-22T00:00:00Z" },
  { place_id: "place-2", label: "Work", zone_id: "zone-2", created_at: "2026-09-22T00:00:00Z" },
];

test.describe("Places flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);

    // Stateful mock: tracks places across requests
    let places = [...INITIAL_PLACES];

    await page.route("**/customers/WS-1234567890/places", (route) => {
      const authHeader = route.request().headers()["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) });
        return;
      }
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: places, limit: 50 }),
        });
      } else if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const newPlace: SavedPlace = {
          place_id: "place-new",
          label: body.label,
          zone_id: body.zone_id,
          created_at: "2026-09-22T00:00:00Z",
        };
        places = [...places, newPlace];
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(newPlace),
        });
      }
    });

    // Mock DELETE for individual places
    await page.route("**/customers/WS-1234567890/places/*", (route) => {
      if (route.request().method() !== "DELETE") {
        route.fulfill({ status: 405, body: "Method Not Allowed" });
        return;
      }
      const authHeader = route.request().headers()["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) });
        return;
      }
      const url = route.request().url();
      const placeId = url.split("/").pop();
      places = places.filter((p) => p.place_id !== placeId);
      route.fulfill({ status: 204 });
    });
  });

  test("loads saved places with Bearer token", async ({ page }) => {
    await gotoRoute(page, "places");

    // Verify places are loaded
    await expect(page.getByText("Home")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Work")).toBeVisible();
  });

  test("adds a new place with Bearer token", async ({ page }) => {
    await gotoRoute(page, "places");

    // Wait for initial load
    await expect(page.getByText("Home")).toBeVisible({ timeout: 10_000 });

    // Fill and submit new place
    await page.getByTestId("place-label-input").fill("Gym");
    await page.getByTestId("place-zone-input").fill("zone-3");
    await page.getByTestId("add-place-button").click();

    // The new place should appear (after re-fetch)
    await expect(page.getByText("Gym")).toBeVisible({ timeout: 10_000 });
  });

  test("deletes a place with Bearer token", async ({ page }) => {
    await gotoRoute(page, "places");

    // Wait for initial load
    await expect(page.getByText("Home")).toBeVisible({ timeout: 10_000 });

    // Click delete on the first place
    await page.getByTestId("delete-place-place-1").click();

    // The place should be removed from the list
    await expect(page.getByText("Home")).not.toBeVisible({ timeout: 10_000 });
  });

  test("shows empty state when no places", async ({ page }) => {
    // Override mock to return empty list
    await page.route("**/customers/WS-1234567890/places", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], limit: 50 }),
        });
      }
    });

    await gotoRoute(page, "places");

    // Should show empty state
    await expect(page.getByText("لا توجد أماكن محفوظة")).toBeVisible({ timeout: 10_000 });
  });
});
