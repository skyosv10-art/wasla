/**
 * DTO mappers — convert domain entities (each paired with their full
 * LocalizedName) into the API DTO shapes from @wasla/contracts-geography,
 * applying the locale fallback (resolveLocalizedName) at this layer.
 *
 * Per ADR-006: the repository returns the full LocalizedName; the use-case
 * layer resolves a single display name for the requested locale (falling back
 * to `ar`). This keeps the fallback rule in the domain, not per-adapter.
 */

import type {
  Country,
  Region,
  City,
  District,
  Zone,
  ZoneDetail,
  UserLocation,
  UserLocationHistoryEntry,
} from "@wasla/contracts-geography";

import { resolveLocalizedName } from "../domain/locale.js";
import type {
  WithNames,
  ZoneDetailRecord,
} from "../ports.js";
import type {
  Country as CountryEntity,
  Region as RegionEntity,
  City as CityEntity,
  District as DistrictEntity,
  Zone as ZoneEntity,
  UserLocationAssignment,
  UserLocationHistoryEntry as HistoryEntity,
} from "../domain/model.js";

export function toCountryDto(
  entity: WithNames<CountryEntity>,
  locale: "ar" | "en" | "ur",
): Country {
  return {
    id: entity.id,
    code: entity.code,
    iso3: entity.iso3 ?? undefined,
    status: entity.status,
    name: resolveLocalizedName(entity.names, locale),
  };
}

export function toRegionDto(
  entity: WithNames<RegionEntity>,
  locale: "ar" | "en" | "ur",
): Region {
  return {
    id: entity.id,
    country_id: entity.countryId,
    code: entity.code,
    status: entity.status,
    name: resolveLocalizedName(entity.names, locale),
  };
}

export function toCityDto(
  entity: WithNames<CityEntity>,
  locale: "ar" | "en" | "ur",
): City {
  return {
    id: entity.id,
    region_id: entity.regionId,
    code: entity.code,
    status: entity.status,
    name: resolveLocalizedName(entity.names, locale),
  };
}

export function toDistrictDto(
  entity: WithNames<DistrictEntity>,
  locale: "ar" | "en" | "ur",
): District {
  return {
    id: entity.id,
    city_id: entity.cityId,
    code: entity.code,
    status: entity.status,
    name: resolveLocalizedName(entity.names, locale),
  };
}

export function toZoneDto(
  entity: WithNames<ZoneEntity>,
  locale: "ar" | "en" | "ur",
): Zone {
  return {
    id: entity.id,
    district_id: entity.districtId,
    code: entity.code,
    status: entity.status,
    name: resolveLocalizedName(entity.names, locale),
  };
}

export function toZoneDetailDto(
  record: ZoneDetailRecord,
  locale: "ar" | "en" | "ur",
): ZoneDetail {
  return {
    id: record.zone.id,
    code: record.zone.code,
    status: record.zone.status,
    name: resolveLocalizedName(record.zone.names, locale),
    path: {
      country: toCountryDto(record.path.country, locale),
      region: toRegionDto(record.path.region, locale),
      city: toCityDto(record.path.city, locale),
      district: toDistrictDto(record.path.district, locale),
    },
  };
}

export function toUserLocationDto(
  assignment: UserLocationAssignment,
  zone: WithNames<ZoneEntity>,
  locale: "ar" | "en" | "ur",
): UserLocation {
  return {
    wasla_public_id: assignment.waslaPublicId,
    zone: toZoneDto(zone, locale),
    source: assignment.source,
    effective_at: assignment.effectiveAt,
    version: assignment.version,
  };
}

export function toHistoryEntryDto(
  entry: HistoryEntity,
  oldZone: WithNames<ZoneEntity> | null,
  newZone: WithNames<ZoneEntity>,
  locale: "ar" | "en" | "ur",
): UserLocationHistoryEntry {
  return {
    old_zone: oldZone
      ? { id: oldZone.id, name: resolveLocalizedName(oldZone.names, locale) }
      : null,
    new_zone: {
      id: newZone.id,
      name: resolveLocalizedName(newZone.names, locale),
    },
    changed_at: entry.changedAt,
    source: entry.source,
  };
}
