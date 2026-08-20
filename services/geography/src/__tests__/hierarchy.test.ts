import { describe, it, expect } from "vitest";

import {
  createInMemoryGeographyDeps,
  SAUDI_FIXTURE_IDS,
} from "../infrastructure/in-memory.js";
import {
  listCountries,
  listRegions,
  listCities,
  listDistricts,
  listZones,
  getZone,
} from "../use-cases/list-hierarchy.js";

const I = SAUDI_FIXTURE_IDS;

describe("hierarchy use cases", () => {
  it("lists countries with localized names (default locale ar)", async () => {
    const deps = createInMemoryGeographyDeps();
    const countries = await listCountries(deps, "ar");
    expect(countries).toHaveLength(1);
    expect(countries[0].code).toBe("SA");
    expect(countries[0].iso3).toBe("SAU");
    expect(countries[0].name).toBe("المملكة العربية السعودية");
  });

  it("returns en names when locale=en is requested", async () => {
    const deps = createInMemoryGeographyDeps();
    const countries = await listCountries(deps, "en");
    expect(countries[0].name).toBe("Saudi Arabia");
  });

  it("lists regions of a country", async () => {
    const deps = createInMemoryGeographyDeps();
    const regions = await listRegions(deps, I.country, "ar");
    expect(regions).toHaveLength(1);
    expect(regions[0].code).toBe("MD");
    expect(regions[0].country_id).toBe(I.country);
    expect(regions[0].name).toBe("منطقة المدينة");
  });

  it("throws GEO_COUNTRY_NOT_FOUND for an unknown country", async () => {
    const deps = createInMemoryGeographyDeps();
    await expect(listRegions(deps, "00000000-0000-0000-0000-000000000000", "ar"))
      .rejects.toMatchObject({ code: "GEO_COUNTRY_NOT_FOUND" });
  });

  it("lists cities of a region and throws GEO_REGION_NOT_FOUND when missing", async () => {
    const deps = createInMemoryGeographyDeps();
    const cities = await listCities(deps, I.region, "en");
    expect(cities).toHaveLength(1);
    expect(cities[0].name).toBe("Madinah");
    await expect(listCities(deps, "00000000-0000-0000-0000-000000000000", "ar"))
      .rejects.toMatchObject({ code: "GEO_REGION_NOT_FOUND" });
  });

  it("lists districts of a city and throws GEO_CITY_NOT_FOUND when missing", async () => {
    const deps = createInMemoryGeographyDeps();
    const districts = await listDistricts(deps, I.city, "ar");
    expect(districts).toHaveLength(2);
    await expect(listDistricts(deps, "00000000-0000-0000-0000-000000000000", "ar"))
      .rejects.toMatchObject({ code: "GEO_CITY_NOT_FOUND" });
  });

  it("lists zones of a district and throws GEO_DISTRICT_NOT_FOUND when missing", async () => {
    const deps = createInMemoryGeographyDeps();
    const zones = await listZones(deps, I.districtAlHara, "ar");
    expect(zones).toHaveLength(1);
    expect(zones[0].code).toBe("HRE");
    await expect(listZones(deps, "00000000-0000-0000-0000-000000000000", "ar"))
      .rejects.toMatchObject({ code: "GEO_DISTRICT_NOT_FOUND" });
  });

  it("getZone returns the zone with its full parent path", async () => {
    const deps = createInMemoryGeographyDeps();
    const detail = await getZone(deps, I.zoneHaraEast, "ar");
    expect(detail.path.country.code).toBe("SA");
    expect(detail.path.region.code).toBe("MD");
    expect(detail.path.city.code).toBe("MAD");
    expect(detail.path.district.code).toBe("HRA");
    expect(detail.code).toBe("HRE");
  });

  it("locale fallback: zone with no en/ur name returns the ar name", async () => {
    const deps = createInMemoryGeographyDeps();
    const detail = await getZone(deps, I.zoneHaraEast, "en");
    // Hara East has en=null → fallback to ar "الحرة الشرقية"
    expect(detail.name).toBe("الحرة الشرقية");
  });

  it("getZone throws GEO_ZONE_NOT_FOUND for an unknown zone", async () => {
    const deps = createInMemoryGeographyDeps();
    await expect(getZone(deps, "00000000-0000-0000-0000-000000000000", "ar"))
      .rejects.toMatchObject({ code: "GEO_ZONE_NOT_FOUND" });
  });
});
