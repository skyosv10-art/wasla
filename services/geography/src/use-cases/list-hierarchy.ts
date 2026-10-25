/**
 * Hierarchy browse use cases. Each returns the API DTO shapes from
 * @wasla/contracts-geography with names resolved for the requested locale
 * (falling back to `ar`). A parent that does not exist yields a stable
 * *_NOT_FOUND error (no empty-array ambiguity).
 */

import type {
  Country,
  Region,
  City,
  District,
  Zone,
  ZoneDetail,
} from "@wasla/contracts-geography";

import { GeographyError } from "../domain/errors.js";
import {
  toCountryDto,
  toRegionDto,
  toCityDto,
  toDistrictDto,
  toZoneDto,
  toZoneDetailDto,
} from "./mappers.js";
import type { UseCaseDeps, UseCaseLocale } from "./deps.js";

export async function listCountries(
  deps: UseCaseDeps,
  locale: UseCaseLocale,
): Promise<Country[]> {
  const rows = await deps.repo.listCountries();
  return rows.map((r) => toCountryDto(r, locale));
}

export async function listRegions(
  deps: UseCaseDeps,
  countryId: string,
  locale: UseCaseLocale,
): Promise<Region[]> {
  // Validate the parent country exists before listing its children.
  const countries = await deps.repo.listCountries();
  if (!countries.some((c) => c.id === countryId)) {
    throw new GeographyError(
      "GEO_COUNTRY_NOT_FOUND",
      `no country with id ${countryId}`,
    );
  }
  const rows = await deps.repo.listRegions(countryId);
  return rows.map((r) => toRegionDto(r, locale));
}

export async function listCities(
  deps: UseCaseDeps,
  regionId: string,
  locale: UseCaseLocale,
): Promise<City[]> {
  if (!(await deps.repo.findRegion(regionId))) {
    throw new GeographyError(
      "GEO_REGION_NOT_FOUND",
      `no region with id ${regionId}`,
    );
  }
  const rows = await deps.repo.listCities(regionId);
  return rows.map((r) => toCityDto(r, locale));
}

export async function listDistricts(
  deps: UseCaseDeps,
  cityId: string,
  locale: UseCaseLocale,
): Promise<District[]> {
  if (!(await deps.repo.findCity(cityId))) {
    throw new GeographyError("GEO_CITY_NOT_FOUND", `no city with id ${cityId}`);
  }
  const rows = await deps.repo.listDistricts(cityId);
  return rows.map((r) => toDistrictDto(r, locale));
}

export async function listZones(
  deps: UseCaseDeps,
  districtId: string,
  locale: UseCaseLocale,
): Promise<Zone[]> {
  if (!(await deps.repo.findDistrict(districtId))) {
    throw new GeographyError(
      "GEO_DISTRICT_NOT_FOUND",
      `no district with id ${districtId}`,
    );
  }
  const rows = await deps.repo.listZones(districtId);
  return rows.map((r) => toZoneDto(r, locale));
}

export async function getZone(
  deps: UseCaseDeps,
  zoneId: string,
  locale: UseCaseLocale,
): Promise<ZoneDetail> {
  const record = await deps.repo.getZoneDetail(zoneId);
  if (!record) {
    throw new GeographyError("GEO_ZONE_NOT_FOUND", `no zone with id ${zoneId}`);
  }
  return toZoneDetailDto(record, locale);
}

/** G-S9.3 (CLM-0645) — bounds of `GET /geo/zones/search` (api.openapi.yml). */
export const ZONE_SEARCH_MIN_LENGTH = 2;
export const ZONE_SEARCH_MAX_LENGTH = 64;
export const ZONE_SEARCH_DEFAULT_LIMIT = 10;
export const ZONE_SEARCH_MAX_LIMIT = 20;

/**
 * Search active zones by localized name (any locale). The validity rule is the
 * one customers enforces on an order's zone_id (`status = active`), so a result
 * is always a zone an order may use. `rawQuery` is trimmed; its length is
 * counted in code points. `rawLimit` is the query-string value (undefined →
 * default). Invalid input → GEO_INVALID_SEARCH_QUERY (400).
 */
export async function searchZones(
  deps: UseCaseDeps,
  rawQuery: unknown,
  rawLimit: unknown,
  locale: UseCaseLocale,
): Promise<ZoneDetail[]> {
  if (typeof rawQuery !== "string") {
    throw new GeographyError("GEO_INVALID_SEARCH_QUERY", "q is required");
  }
  const query = rawQuery.trim();
  const length = [...query].length;
  if (length < ZONE_SEARCH_MIN_LENGTH || length > ZONE_SEARCH_MAX_LENGTH) {
    throw new GeographyError(
      "GEO_INVALID_SEARCH_QUERY",
      `q must be ${ZONE_SEARCH_MIN_LENGTH}..${ZONE_SEARCH_MAX_LENGTH} characters after trimming`,
    );
  }
  let limit = ZONE_SEARCH_DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== "") {
    const parsed = typeof rawLimit === "string" && /^[0-9]+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > ZONE_SEARCH_MAX_LIMIT) {
      throw new GeographyError(
        "GEO_INVALID_SEARCH_QUERY",
        `limit must be an integer 1..${ZONE_SEARCH_MAX_LIMIT}`,
      );
    }
    limit = parsed;
  }
  const records = await deps.repo.searchActiveZones(query, limit);
  return records.map((r) => toZoneDetailDto(r, locale));
}
