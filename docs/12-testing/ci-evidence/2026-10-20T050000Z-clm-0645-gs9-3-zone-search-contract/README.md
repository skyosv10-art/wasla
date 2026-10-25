# CLM-0645 — G-S9.3 (أ): عقدُ البحثِ عن منطقةٍ صالحةٍ بالاسمِ في geography — العقدُ أوّلًا (M0-53)

**الفرع:** `stage-zero/clm-0645-gs9-3-zone-search-contract` · **البند:** M0-53 · **الصف:** G-S9.3 (على RQ-CMA-15 — فرعُ «بحثٌ نصّيٌّ»)
**الحالة عند البدء:** `main` = `2ed2c77` (#789) · لا حجزَ ولا فرعَ ولا PR لـ`zones/search` (`find-existing-work.sh`).

## 1) القياسُ قبلَ الكتابةِ

| السؤال | المقيس | المرجع |
|---|---|---|
| هل في geography مسارُ بحثٍ؟ | **لا.** ثمانيةُ مساراتٍ: الهرمُ (5) · `GET /geo/zones/{zoneId}` · موقعُ المستخدمِ (2+1). | `services/geography/contracts/api.openapi.yml` |
| هل في search مسارٌ قابلٌ لإعادةِ الاستعمالِ؟ | **لا.** `GET /search/products` (+ health/ready) — فهرسُ منتجاتٍ. | `services/search/contracts/api.openapi.yml` |
| مَن يملكُ أسماءَ المناطقِ؟ | geography — جداولُ `geo_*_names` (ar/en/ur، fallback إلى ar). | ADR-006 · `schema.sql` |
| ما معيارُ «منطقةٍ صالحةٍ»؟ | ما تفرضُه خدمةُ العملاءِ على `zone_id` الطلبِ: `requireActiveZone` ← `status = active` فقط. | `services/customers/src/use-cases/zones.js` · `infrastructure/http-geography.ts` |
| أين تذهبُ النتيجةُ في الطلبِ؟ | `StopSource` يعرّفُ `text_search` أصلًا، و`zone_id` هو مرجعُ المحطّةِ. | `packages/contracts/customer` (`StopSource`) |
| هل يصلُ تطبيقُ العميلِ إلى geography اليومَ؟ | **لا.** لا مدخلَ geography في `allowlist/customer-mini-app.json` ولا مسارَ geography في لقطةِ فرضِ المساراتِ. | الحدّ · `route-enforcement.json` |

**الحكم:** لا مسارَ قائمَ يُعادُ استعمالُه؛ والمالكُ الوحيدُ للأسماءِ geography ← **عقدٌ جديدٌ في geography**. لا مصدرَ بياناتٍ جديدٌ: البحثُ على البذرةِ والجداولِ القائمةِ فقط، ولا يمسُّ قرارَ G-S9.2 (لا هندسةَ مناطقَ).

## 2) العقد — `GET /geo/zones/search`

- `q` إلزاميٌّ، يُقصُّ، 2..64 حرفًا (بنقاطِ الترميزِ) · `limit` 1..20 (الافتراضيُّ 10) · `locale` ar/en/ur.
- **المناطقُ النشطةُ فقط** — المعيارُ نفسُه في خدمةِ العملاءِ، فلا يُعرضُ للاختيارِ ما سيُرفضُ عندَ الإرسالِ (مصدرُ حقيقةٍ واحدٌ للصلاحيّةِ).
- مطابقةٌ جزئيّةٌ لأيِّ اسمٍ مترجَمٍ للمنطقةِ دونَ حساسيّةٍ لحالةِ الأحرفِ؛ `%` و`_` والشرطةُ العكسيّةُ **حرفيّةٌ** (تُهرَّبُ).
- الترتيبُ حتميٌّ: `code` ثم `id`. الشكلُ `ZoneDetail[]` القائمُ (لا مخطّطَ جديدَ). لا تطابقَ ← `200 []`.
- مدخلٌ غيرُ صالحٍ ← `400 GEO_INVALID_SEARCH_QUERY` (رمزٌ جديدٌ مُضافٌ لا مُعدَّلٌ — `errors.md`).
- الصلاحيّةُ `geography:zone:read` القائمةُ (لا صلاحيّةَ جديدةَ ولا منحَ جديدٌ) · ربطُ تفويضٍ `none` — بياناتٌ مرجعيّةٌ عامّةٌ كـ`/geo/zones/:zoneId`.
- قيدٌ مُعلَنٌ: لا تطبيعَ للتشكيلِ والهمزاتِ في هذا الإصدارِ.

## 3) التنفيذ

`api.openapi.yml` → `packages/contracts/geography/src/api-types.ts` (مولَّدٌ بـopenapi-typescript 7.13.0 — [raw/contract-types-regen.txt](raw/contract-types-regen.txt)) · `ports.ts` `searchActiveZones` · `in-memory.ts` · `drizzle/repository.ts` (`selectDistinct … ILIKE` مع هروبٍ) · `use-cases/list-hierarchy.ts` `searchZones` (التحقّقُ في حالةِ الاستخدامِ) · `http/app.ts` (مسارٌ ثابتٌ قبلَ `:zoneId`) · `authz-policy` `operations`/`bindings` (169 → 170 عمليّةً · موجةُ RISK-0042 الأولى 18 → 19 صفًّا `none` بدليلٍ وسببٍ) · `SERVICE_AUTH_ENFORCEMENT.md` · `GEOGRAPHY_HTTP.md`.

## 4) الاختبارات

| المجموعة | النتيجة | الخام |
|---|---|---|
| `zone-search.test.ts` (جديدٌ · 23) — عربيٌّ/إنجليزيٌّ/أورديٌّ · fallback · النشطةُ فقط · الترتيبُ والحدُّ · القصُّ · الحرفيّةُ · فارغٌ · 11 حالةَ تحقّقٍ وحدودَها · 401/403/200 · عدمُ التظليلِ بـ`:zoneId` | ✓ | [raw/geography-unit.txt](raw/geography-unit.txt) — geography **85/85** · typecheck ✓ |
| تكاملُ Postgres (+5 · ILIKE حقيقيٌّ · هروبٌ بأسماءٍ تحوي `%_\` · inactive بـUPDATE · DISTINCT) | ✓ | [raw/geography-integration-postgres18.txt](raw/geography-integration-postgres18.txt) — **26/26** محليًّا على Postgres 18 |
| طفراتٌ: نزعُ الهروبِ · نزعُ شرطِ النشاطِ | كلٌّ يُكشَفُ باختبارٍ واحدٍ | [raw/mutation-checks.txt](raw/mutation-checks.txt) |
| `authz-policy` | **52/52** | [raw/authz-policy.txt](raw/authz-policy.txt) |

**الأساسُ (M0-08):** ملفُّ اختبارٍ جديدٌ ← `test_files_tracked` 578 → 579؛ أُعيدَ التوليدُ بـ`scripts/baseline.sh --log` من [raw/verify-log-stale-baseline-only.txt](raw/verify-log-stale-baseline-only.txt) (`verify.sh` أخفقَ فقط على الأساسِ القديمِ وعلى STATE-SYNC المُصحَّحِ بعدَ بدئِه) · `tests_passed` 6158 → 6194.

**إخفاقُ CI أوّلُ وسببُه الجذريُّ (السيرُ 39374488496 · `governance-guard`):** الفحصُ 11 البابُ 4 — `repo.commit` في الأساسِ كان `fb2f3e2`، التزامًا سبقَ إعادةَ البناءِ على main فلم يُدفَعْ قطُّ ولا يُحَلُّ في `origin` (RISK-0028). الإصلاحُ: إعادةُ التوليدِ على التزامٍ مدفوعٍ (`e84be1b`) لا تعطيلُ البابِ.

الأخضرُ المحلّيُّ ليسَ حكمًا: حكمُ CI (ساقُ `geography · test:integration` على Postgres الخاصِّ بـCI) بعدَ الدفعِ.

## 5) خارجَ هذه الشريحةِ — G-S9.3 (ب)

وصولُ تطبيقِ العميلِ إلى هذا المسارِ يتطلّبُ **مدخلَ حدٍّ جديدًا من صنفِ P** (قراءةٌ عامّةٌ — ADR-069 §2.8: «مشروطٌ: الحدُّ يثبّتُ معاملاتِ الاستعلامِ ويُثبتُ اختبارٌ أنّ الجوابَ لا يحوي إلا المنشورَ») + إضافةً إلى لقطةِ فرضِ المساراتِ بقرارٍ موثَّقٍ مستقلٍّ (ADR-074 D4) + بادئةَ توجيهٍ + ربطَ نموذجِ الطلبِ (`source=text_search`). يُحجَزُ في شريحةٍ مستقلّةٍ بعدَ حكمِ CI على هذه. لا نشرَ (`frozen` — ADR-073).

## 6) حكمُ CI على main (CLM-0646 · بالإضافةِ)

PR [#791](https://github.com/skyosv10-art/wasla/pull/791) دُمِجَ بالتزامِ `16c1ec3` بعدَ 43 فحصًا ناجحًا على رأسِ الفرعِ `85f108f` — ومنها ساقُ `db-integration (geography …)` على Postgres الخاصِّ بـCI. على main: **WASLA CI** (السيرُ [39377275818](https://github.com/skyosv10-art/wasla/actions/runs/39377275818)) **نجاحٌ 41/41** · Roadmap freshness (39377275704) نجاحٌ — [raw/main-ci-16c1ec3.json](raw/main-ci-16c1ec3.json). وسيرُ الفرعِ الأوّلُ الفاشلُ (39374488496 على `e84be1b`) سببُه مُسجَّلٌ أعلاه (§4) ومُصلَحٌ بجذرِه.
