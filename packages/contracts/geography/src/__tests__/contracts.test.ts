import { describe, it, expect } from "vitest";
import type {
  Country,
  Region,
  City,
  District,
  Zone,
  ZoneDetail,
  UserLocation,
  SetUserLocationRequest,
  UserLocationHistoryEntry,
  LocalizedName,
  SupportedLocale,
  paths,
} from "../index.js";
import { LOCALE_DIRECTION, DEFAULT_LOCALE } from "../index.js";

/**
 * Contract First smoke tests (ADR-004) — compile-time type checks confirming
 * the generated types align with the published OpenAPI contract. They run at
 * runtime too (to exercise the vitest pipeline) but their primary value is
 * failing to compile if the contract drifts.
 */

describe("@wasla/contracts-geography (typed contracts)", () => {
  it("exposes a valid country shape with localized name", () => {
    const country: Country = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      code: "SA",
      iso3: "SAU",
      status: "active",
      name: "المملكة العربية السعودية",
    };
    expect(country.code).toBe("SA");
    expect(country.status).toBe("active");
  });

  it("exposes the region shape within a country", () => {
    const region: Region = {
      id: "660e8400-e29b-41d4-a716-446655440000",
      country_id: "550e8400-e29b-41d4-a716-446655440000",
      code: "MD",
      status: "active",
      name: "المدينة المنورة",
    };
    expect(region.code).toBe("MD");
  });

  it("exposes city, district, zone shapes", () => {
    const city: City = {
      id: "1",
      region_id: "2",
      code: "MAD",
      status: "active",
      name: "المدينة",
    };
    const district: District = {
      id: "3",
      city_id: "1",
      code: "D1",
      status: "active",
      name: "الحرة",
    };
    const zone: Zone = {
      id: "4",
      district_id: "3",
      code: "Z1",
      status: "active",
      name: "الحرة الشرقية",
    };
    expect(district.name).toBe("الحرة");
    expect(city.code).toBe("MAD");
    expect(zone.code).toBe("Z1");
  });

  it("exposes ZoneDetail with full hierarchy path", () => {
    const detail: ZoneDetail = {
      id: "4",
      code: "Z1",
      status: "active",
      name: "الحرة الشرقية",
      path: {
        country: { id: "1", code: "SA", iso3: "SAU", status: "active", name: "السعودية" },
        region: { id: "2", country_id: "1", code: "MD", status: "active", name: "المدينة" },
        city: { id: "3", region_id: "2", code: "MAD", status: "active", name: "المدينة" },
        district: { id: "5", city_id: "3", code: "D1", status: "active", name: "الحرة" },
      },
    };
    expect(detail.path.country.code).toBe("SA");
  });

  it("exposes the user location + set request shape", () => {
    const loc: UserLocation = {
      wasla_public_id: "WS-0000010427",
      zone: { id: "4", district_id: "3", code: "Z1", status: "active", name: "الحرة الشرقية" },
      source: "customer_bot",
      effective_at: "2026-08-20T11:00:00Z",
      version: 1,
    };
    expect(loc.wasla_public_id).toMatch(/^WS-\d{10}$/);
    const req: SetUserLocationRequest = {
      zone_id: "4",
      source: "customer_bot",
    };
    expect(req.source).toBe("customer_bot");
  });

  it("exposes the user location history entry shape", () => {
    const entry: UserLocationHistoryEntry = {
      old_zone: { id: "4", name: "الحرة الشرقية" },
      new_zone: { id: "9", name: "قباء" },
      changed_at: "2026-08-20T12:00:00Z",
      source: "customer_bot",
    };
    expect(entry.new_zone.name).toBe("قباء");
  });

  it("exposes LocalizedName (ar required, en/ur nullable)", () => {
    const names: LocalizedName = { ar: "المدينة", en: "Madinah", ur: null };
    expect(names.ar).toBe("المدينة");
  });

  it("locale direction metadata: ar+ur RTL, en LTR; default locale ar", () => {
    const rtl: SupportedLocale[] = ["ar", "ur"];
    for (const l of rtl) expect(LOCALE_DIRECTION[l]).toBe("rtl");
    expect(LOCALE_DIRECTION.en).toBe("ltr");
    expect(DEFAULT_LOCALE).toBe("ar");
  });

  it("declares the list-countries path as GET /geo/countries", () => {
    type ListPath = paths["/geo/countries"]["get"];
    const _: ListPath = {} as ListPath;
    expect(_).toBeDefined();
  });

  it("declares the set-user-location path as PUT /geo/users/{waslaPublicId}/location", () => {
    type SetPath = paths["/geo/users/{waslaPublicId}/location"]["put"];
    const _: SetPath = {} as SetPath;
    expect(_).toBeDefined();
  });
});
