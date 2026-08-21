/**
 * Shared test fixtures for the Customer Core use cases.
 *
 * Everything is deterministic (fixed clock, sequential ids) so the assertions
 * describe behavior rather than timing, and the same fixtures will be reused by
 * the Postgres suite in MR 3/6 to prove both adapters behave identically.
 */

import {
  FakeGeography,
  FakeIdentityLookup,
  FixedClock,
  InMemoryCustomerRepository,
  InMemoryOutbox,
  RecordingOrderIntake,
  SequentialIdGenerator,
} from "../infrastructure/in-memory.js";
import type { OrderRequestDraft, ZoneReference } from "../domain/model.js";
import type { OrderIntakePort } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import { upsertCustomerProfile } from "../use-cases/customer-profile.js";

export const CUSTOMER = "WS-1000000001";
export const OTHER_CUSTOMER = "WS-1000000002";

export const ZONE_A = "11111111-1111-4111-8111-111111111111";
export const ZONE_B = "22222222-2222-4222-8222-222222222222";
export const ZONE_INACTIVE = "33333333-3333-4333-8333-333333333333";
export const ZONE_UNKNOWN = "44444444-4444-4444-8444-444444444444";

export const ZONES: ZoneReference[] = [
  { zoneId: ZONE_A, status: "active", path: "المدينة المنورة / العزيزية" },
  { zoneId: ZONE_B, status: "active", path: "المدينة المنورة / قربان" },
  { zoneId: ZONE_INACTIVE, status: "inactive", path: "المدينة المنورة / مؤجّلة" },
];

export interface TestContext extends UseCaseDeps {
  repo: InMemoryCustomerRepository;
  outbox: InMemoryOutbox;
  clock: FixedClock;
  identityLookup: FakeIdentityLookup;
  geography: FakeGeography;
  intake: RecordingOrderIntake;
}

/** Build a full set of in-memory dependencies. */
export function makeContext(
  options: { orderIntake?: OrderIntakePort; traceId?: string } = {},
): TestContext {
  const clock = new FixedClock();
  const intake = new RecordingOrderIntake({ clock });
  return {
    repo: new InMemoryCustomerRepository(),
    outbox: new InMemoryOutbox(),
    clock,
    idGen: new SequentialIdGenerator(),
    identityLookup: new FakeIdentityLookup([CUSTOMER, OTHER_CUSTOMER]),
    geography: new FakeGeography(ZONES),
    intake,
    orderIntake: options.orderIntake ?? intake,
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  };
}

/** Create an active profile and clear the events it produced. */
export async function seedProfile(
  ctx: TestContext,
  waslaPublicId: string = CUSTOMER,
): Promise<void> {
  await upsertCustomerProfile(ctx, {
    waslaPublicId,
    patch: { displayName: "أبو محمد", preferredLocale: "ar" },
  });
  ctx.outbox.clear();
}

/** A valid ride draft: pickup in zone A, dropoff in zone B, offered price. */
export function rideDraft(overrides: Partial<OrderRequestDraft> = {}): OrderRequestDraft {
  return {
    orderType: "ride",
    vehicleClass: "sedan",
    priceMode: "customer_offer",
    offeredPrice: { amountMinor: 1500, currency: "SAR" },
    stops: [
      { kind: "pickup", zoneId: ZONE_A, source: "map" },
      { kind: "dropoff", zoneId: ZONE_B, source: "text_search" },
    ],
    notes: "الاتصال قبل الوصول",
    ...overrides,
  };
}

/** A valid delivery draft with shipment details. */
export function deliveryDraft(
  overrides: Partial<OrderRequestDraft> = {},
): OrderRequestDraft {
  return {
    ...rideDraft(),
    orderType: "delivery",
    vehicleClass: "motorcycle",
    shipment: { shipmentType: "parcel", weightKg: 3.5 },
    ...overrides,
  };
}

/** Assert an operation fails with a specific documented error code. */
export async function expectCustomerError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<{ code: string; httpStatus: number; reasonCode?: string | null }> {
  try {
    await operation();
  } catch (error) {
    const thrown = error as { code?: string; httpStatus?: number; reasonCode?: string | null };
    if (thrown.code !== code) {
      throw new Error(`expected ${code} but got ${String(thrown.code)}`);
    }
    return {
      code: thrown.code,
      httpStatus: thrown.httpStatus ?? 0,
      reasonCode: thrown.reasonCode ?? null,
    };
  }
  throw new Error(`expected ${code} but the operation succeeded`);
}
