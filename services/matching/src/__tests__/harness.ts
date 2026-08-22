/**
 * Test harness — one zone hierarchy and one candidacy builder shared by the suite.
 *
 * The hierarchy is fixed and explicit so a proximity expectation reads as a fact
 * about the tree, not as a magic uuid: two zones in one district, a third in
 * another district of the same city, a fourth in another city of the same region,
 * a fifth in another region, and a sixth in another country.
 */

import type { Candidacy, ZoneLineage } from "../domain/model.js";
import {
  createInMemoryDependencies,
  type InMemoryMatchingDependencies,
} from "../infrastructure/in-memory.js";

const uuid = (suffix: string): string => `00000000-0000-4000-9000-${suffix.padStart(12, "0")}`;

export const COUNTRY_SA = uuid("c1");
export const COUNTRY_AE = uuid("c2");
export const REGION_MADINAH = uuid("r1");
export const REGION_RIYADH = uuid("r2");
export const REGION_DUBAI = uuid("r3");
export const CITY_MADINAH = uuid("y1");
export const CITY_YANBU = uuid("y2");
export const CITY_RIYADH = uuid("y3");
export const CITY_DUBAI = uuid("y4");
export const DISTRICT_QUBA = uuid("d1");
export const DISTRICT_AWALI = uuid("d2");
export const DISTRICT_YANBU = uuid("d3");
export const DISTRICT_OLAYA = uuid("d4");
export const DISTRICT_MARINA = uuid("d5");

/** The pickup zone every test uses unless it says otherwise. */
export const ZONE_PICKUP = uuid("01");
/** Same district as the pickup zone. */
export const ZONE_SAME_DISTRICT = uuid("02");
/** Same city, different district. */
export const ZONE_SAME_CITY = uuid("03");
/** Same region, different city. */
export const ZONE_SAME_REGION = uuid("04");
/** Same country, different region. */
export const ZONE_SAME_COUNTRY = uuid("05");
/** Different country — no proximity at all. */
export const ZONE_OTHER_COUNTRY = uuid("06");
/** A zone id absent from the hierarchy. */
export const ZONE_UNKNOWN = uuid("99");

export const LINEAGES: readonly ZoneLineage[] = [
  {
    zoneId: ZONE_PICKUP,
    districtId: DISTRICT_QUBA,
    cityId: CITY_MADINAH,
    regionId: REGION_MADINAH,
    countryId: COUNTRY_SA,
  },
  {
    zoneId: ZONE_SAME_DISTRICT,
    districtId: DISTRICT_QUBA,
    cityId: CITY_MADINAH,
    regionId: REGION_MADINAH,
    countryId: COUNTRY_SA,
  },
  {
    zoneId: ZONE_SAME_CITY,
    districtId: DISTRICT_AWALI,
    cityId: CITY_MADINAH,
    regionId: REGION_MADINAH,
    countryId: COUNTRY_SA,
  },
  {
    zoneId: ZONE_SAME_REGION,
    districtId: DISTRICT_YANBU,
    cityId: CITY_YANBU,
    regionId: REGION_MADINAH,
    countryId: COUNTRY_SA,
  },
  {
    zoneId: ZONE_SAME_COUNTRY,
    districtId: DISTRICT_OLAYA,
    cityId: CITY_RIYADH,
    regionId: REGION_RIYADH,
    countryId: COUNTRY_SA,
  },
  {
    zoneId: ZONE_OTHER_COUNTRY,
    districtId: DISTRICT_MARINA,
    cityId: CITY_DUBAI,
    regionId: REGION_DUBAI,
    countryId: COUNTRY_AE,
  },
];

export const NOW = "2026-08-22T00:00:00.000Z";
export const ORDER_ID = "11111111-1111-4111-8111-111111111111";
export const ORDER_PUBLIC_ID = "ORD-0000000001";

let driverCounter = 0;

/** A driver public id in the contract shape, deterministic per call order. */
export function nextDriverId(): string {
  driverCounter += 1;
  return `WS-${driverCounter.toString().padStart(10, "0")}`;
}

/**
 * A candidacy row that passes every hard filter by default, so each test can
 * break exactly one thing and name it. Defaults deliberately mirror the happy
 * path of the contract, not the database defaults (`offline`/`unknown`).
 */
export function candidacyFixture(overrides: Partial<Candidacy> = {}): Candidacy {
  return {
    driverPublicId: overrides.driverPublicId ?? nextDriverId(),
    availabilityState: "available",
    eligibilityState: "eligible",
    eligibilitySource: "claimed",
    serviceKinds: ["ride", "delivery"],
    vehicleClass: "sedan",
    zoneIds: [ZONE_PICKUP],
    lastOfferedAt: null,
    lastAssignedAt: null,
    offersReceived: 0,
    offersAccepted: 0,
    ordersCompleted: 0,
    updatedAt: NOW,
    createdAt: NOW,
    updatedBy: "driver_bot",
    ...overrides,
  };
}

export function createHarness(now: string = NOW): InMemoryMatchingDependencies {
  return createInMemoryDependencies({ now, lineages: LINEAGES });
}

/** Seed rows straight into the projection (the service owns the history columns). */
export function seedAll(
  deps: InMemoryMatchingDependencies,
  rows: readonly Candidacy[],
): void {
  for (const row of rows) deps.candidacy.seed(row);
}

/** The minimal valid query — every test overrides only what it is about. */
export function queryFixture(overrides: Record<string, unknown> = {}): {
  orderId: string;
  orderPublicId: string;
  orderType: string;
  vehicleClass: string;
  pickupZoneId: string;
} & Record<string, unknown> {
  return {
    orderId: ORDER_ID,
    orderPublicId: ORDER_PUBLIC_ID,
    orderType: "ride",
    vehicleClass: "sedan",
    pickupZoneId: ZONE_PICKUP,
    ...overrides,
  };
}
