-- WASLA Geography & Localization — Saudi Arabia Seed Data (Phase 02)
--
-- بيانات أولية idempotent للمملكة العربية السعودية (النطاق الأولي للـExit Gate):
--   Country SA → Madinah region → Madinah city → 2 districts → 2 zones
--   + أسماء مترجمة (ar/en/ur). ar إلزامي لكل كيان (fallback).
--
-- المعرّفات UUID ثابتة (تطابق بيانات الـin-memory fixture في
-- services/geography/src/infrastructure/in-memory.ts) كي تكون الاختبارات
-- deterministic عبر الطبقتين.
--
-- التشغيل: psql ... -f contracts/seeds/saudi-arabia.sql
-- (بعد تطبيق contracts/schema.sql على قاعدة فارغة)
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING — آمن لإعادة التشغيل.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Country: Saudi Arabia
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO geo_countries (id, code, iso3, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'SA', 'SAU', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO geo_country_names (country_id, locale, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ar', 'المملكة العربية السعودية'),
  ('11111111-1111-1111-1111-111111111111', 'en', 'Saudi Arabia'),
  ('11111111-1111-1111-1111-111111111111', 'ur', 'سعودی عرب')
ON CONFLICT (country_id, locale) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Region: Madinah
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO geo_regions (id, country_id, code, status) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'MD', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO geo_region_names (region_id, locale, name) VALUES
  ('22222222-2222-2222-2222-222222222222', 'ar', 'منطقة المدينة'),
  ('22222222-2222-2222-2222-222222222222', 'en', 'Madinah Region'),
  ('22222222-2222-2222-2222-222222222222', 'ur', 'مدینہ علاقہ')
ON CONFLICT (region_id, locale) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3) City: Madinah
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO geo_cities (id, region_id, code, status) VALUES
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'MAD', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO geo_city_names (city_id, locale, name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'ar', 'المدينة المنورة'),
  ('33333333-3333-3333-3333-333333333333', 'en', 'Madinah'),
  ('33333333-3333-3333-3333-333333333333', 'ur', 'مدینہ منورہ')
ON CONFLICT (city_id, locale) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Districts: Al-Hara + Quba
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO geo_districts (id, city_id, code, status) VALUES
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'HRA', 'active'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'QBA', 'active')
ON CONFLICT (id) DO NOTHING;

-- Al-Hara: ar + en فقط (ur مفقود — لاختبار fallback)
INSERT INTO geo_district_names (district_id, locale, name) VALUES
  ('44444444-4444-4444-4444-444444444444', 'ar', 'حي الحرة'),
  ('44444444-4444-4444-4444-444444444444', 'en', 'Al-Hara District')
ON CONFLICT (district_id, locale) DO NOTHING;

-- Quba: ar + en + ur
INSERT INTO geo_district_names (district_id, locale, name) VALUES
  ('55555555-5555-5555-5555-555555555555', 'ar', 'حي قباء'),
  ('55555555-5555-5555-5555-555555555555', 'en', 'Quba District'),
  ('55555555-5555-5555-5555-555555555555', 'ur', 'قباء')
ON CONFLICT (district_id, locale) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Zones: Hara East + Quba North
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO geo_zones (id, district_id, code, status) VALUES
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 'HRE', 'active'),
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'QBN', 'active')
ON CONFLICT (id) DO NOTHING;

-- Hara East: ar فقط (en/ur مفقود — لاختبار fallback إلى ar)
INSERT INTO geo_zone_names (zone_id, locale, name) VALUES
  ('66666666-6666-6666-6666-666666666666', 'ar', 'الحرة الشرقية')
ON CONFLICT (zone_id, locale) DO NOTHING;

-- Quba North: ar + en + ur
INSERT INTO geo_zone_names (zone_id, locale, name) VALUES
  ('77777777-7777-7777-7777-777777777777', 'ar', 'قباء الشمالية'),
  ('77777777-7777-7777-7777-777777777777', 'en', 'Quba North'),
  ('77777777-7777-7777-7777-777777777777', 'ur', 'قباء شمالی')
ON CONFLICT (zone_id, locale) DO NOTHING;

COMMIT;

-- ملاحظة: هذا النطاق الأولي يكفي لـPhase 02 Exit Gate (تغيير الموقع بين حيّين).
-- التغطية الوطنية الكاملة تُضاف لاحقاً من مصدر رسمي (موثّقة في ADR-006).
