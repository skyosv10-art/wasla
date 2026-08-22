/** أدوات مشتركة لاختبارات HTTP كي يبقى كل اختبار متعلقاً بعقده لا بتجهيز الذاكرة. */

import { createMatchingApp } from "../http/app.js";
import { createDirectRunner } from "../runner.js";

import { createHarness, ORDER_ID, ORDER_PUBLIC_ID, ZONE_PICKUP } from "./harness.js";

export { ORDER_ID, ORDER_PUBLIC_ID, ZONE_PICKUP };

export function createHttpHarness() {
  const deps = createHarness();
  const app = createMatchingApp({ runner: createDirectRunner(deps) });
  return { app, deps };
}

export function candidatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: ORDER_ID,
    order_public_id: ORDER_PUBLIC_ID,
    order_type: "ride",
    vehicle_class: "sedan",
    pickup_zone_id: ZONE_PICKUP,
    ...overrides,
  };
}

export function candidacyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    availability_state: "available",
    eligibility_state: "eligible",
    service_kinds: ["ride"],
    vehicle_class: "sedan",
    zone_ids: [ZONE_PICKUP],
    ...overrides,
  };
}

export const DRIVER_ID = "WS-0000000001";
export const IDEMPOTENCY_KEY = "matching-test-key";
