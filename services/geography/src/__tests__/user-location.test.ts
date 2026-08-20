import { describe, it, expect } from "vitest";

import {
  createInMemoryGeographyDeps,
  InMemoryIdentityLookupPort,
  SAUDI_FIXTURE_IDS,
} from "../infrastructure/in-memory.js";
import { setUserLocation } from "../use-cases/set-user-location.js";
import { getUserLocation } from "../use-cases/get-user-location.js";
import { getUserLocationHistory } from "../use-cases/get-user-location-history.js";

const I = SAUDI_FIXTURE_IDS;
const PID = "WS-0000000001";
const UNKNOWN_PID = "WS-0000000099";

function depsWith(knownIds?: Iterable<string>) {
  return createInMemoryGeographyDeps({
    identityLookup: new InMemoryIdentityLookupPort(knownIds),
  });
}

describe("setUserLocation use case", () => {
  it("creates a location on first set (201) and emits geo.user_location.set", async () => {
    const deps = depsWith();
    const result = await setUserLocation(deps, {
      waslaPublicId: PID,
      zoneId: I.zoneHaraEast,
      source: "customer_bot",
    });
    expect(result.created).toBe(true);
    expect(result.location.wasla_public_id).toBe(PID);
    expect(result.location.zone.id).toBe(I.zoneHaraEast);
    expect(result.location.version).toBe(1);
    const events = await deps.outbox.unread();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("geo.user_location.set");
  });

  it("records history with old_zone_id=null on first set", async () => {
    const deps = depsWith();
    await setUserLocation(deps, {
      waslaPublicId: PID,
      zoneId: I.zoneHaraEast,
      source: "customer_bot",
    });
    const history = await getUserLocationHistory(deps, { waslaPublicId: PID });
    expect(history).toHaveLength(1);
    expect(history[0].old_zone).toBeNull();
    expect(history[0].new_zone.id).toBe(I.zoneHaraEast);
  });

  it("changes location to a new zone (200) and emits geo.user_location.changed", async () => {
    const deps = depsWith();
    await setUserLocation(deps, {
      waslaPublicId: PID,
      zoneId: I.zoneHaraEast,
      source: "customer_bot",
    });
    const result = await setUserLocation(deps, {
      waslaPublicId: PID,
      zoneId: I.zoneQubaNorth,
      source: "driver_bot",
    });
    expect(result.created).toBe(false);
    expect(result.location.version).toBe(2);
    expect(result.location.zone.id).toBe(I.zoneQubaNorth);
    const events = await deps.outbox.unread();
    expect(events).toHaveLength(2);
    expect(events[1].event_type).toBe("geo.user_location.changed");
  });

  it("records history with old/new zone on a change", async () => {
    const deps = depsWith();
    await setUserLocation(deps, { waslaPublicId: PID, zoneId: I.zoneHaraEast, source: "customer_bot" });
    await setUserLocation(deps, { waslaPublicId: PID, zoneId: I.zoneQubaNorth, source: "driver_bot" });
    const history = await getUserLocationHistory(deps, { waslaPublicId: PID });
    expect(history).toHaveLength(2);
    expect(history[1].old_zone?.id).toBe(I.zoneHaraEast);
    expect(history[1].new_zone.id).toBe(I.zoneQubaNorth);
  });

  it("is idempotent for the same zone (no event, no history, no version bump)", async () => {
    const deps = depsWith();
    await setUserLocation(deps, { waslaPublicId: PID, zoneId: I.zoneHaraEast, source: "customer_bot" });
    const result = await setUserLocation(deps, { waslaPublicId: PID, zoneId: I.zoneHaraEast, source: "customer_bot" });
    expect(result.created).toBe(false);
    expect(result.location.version).toBe(1); // unchanged
    const events = await deps.outbox.unread();
    expect(events).toHaveLength(1); // only the initial set event
    const history = await getUserLocationHistory(deps, { waslaPublicId: PID });
    expect(history).toHaveLength(1); // no new history entry
  });

  it("rejects an invalid wasla_public_id format (GEO_INVALID_PUBLIC_ID)", async () => {
    const deps = depsWith();
    await expect(
      setUserLocation(deps, { waslaPublicId: "not-a-public-id", zoneId: I.zoneHaraEast, source: "customer_bot" }),
    ).rejects.toMatchObject({ code: "GEO_INVALID_PUBLIC_ID", httpStatus: 400 });
  });

  it("rejects when the identity does not exist (GEO_IDENTITY_NOT_FOUND)", async () => {
    // Identity lookup knows only PID; UNKNOWN_PID is not registered.
    const deps = depsWith([PID]);
    await expect(
      setUserLocation(deps, { waslaPublicId: UNKNOWN_PID, zoneId: I.zoneHaraEast, source: "customer_bot" }),
    ).rejects.toMatchObject({ code: "GEO_IDENTITY_NOT_FOUND", httpStatus: 404 });
  });

  it("rejects an unknown zone (GEO_ZONE_NOT_FOUND)", async () => {
    const deps = depsWith();
    await expect(
      setUserLocation(deps, { waslaPublicId: PID, zoneId: "00000000-0000-0000-0000-000000000000", source: "customer_bot" }),
    ).rejects.toMatchObject({ code: "GEO_ZONE_NOT_FOUND", httpStatus: 404 });
  });

  it("locale fallback in location response (en missing → ar)", async () => {
    const deps = depsWith();
    await setUserLocation(deps, { waslaPublicId: PID, zoneId: I.zoneHaraEast, source: "customer_bot", locale: "en" });
    const loc = await getUserLocation(deps, { waslaPublicId: PID, locale: "en" });
    // Hara East en=null → fallback to ar "الحرة الشرقية"
    expect(loc.zone.name).toBe("الحرة الشرقية");
  });
});

describe("getUserLocation use case", () => {
  it("throws GEO_USER_LOCATION_NOT_FOUND when no location is set", async () => {
    const deps = depsWith();
    await expect(getUserLocation(deps, { waslaPublicId: PID, locale: "ar" }))
      .rejects.toMatchObject({ code: "GEO_USER_LOCATION_NOT_FOUND", httpStatus: 404 });
  });

  it("rejects an invalid public id", async () => {
    const deps = depsWith();
    await expect(getUserLocation(deps, { waslaPublicId: "bad", locale: "ar" }))
      .rejects.toMatchObject({ code: "GEO_INVALID_PUBLIC_ID" });
  });
});
