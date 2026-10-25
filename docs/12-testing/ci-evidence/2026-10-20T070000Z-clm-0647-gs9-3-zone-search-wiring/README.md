# CLM-0647 — G-S9.3 (ب): مدخلُ حدٍّ مغلقٌ من صنفِ P + وصلُ نموذجِ الطلبِ بالبحثِ عن المنطقةِ (M0-53)

**الفرع:** `stage-zero/clm-0647-gs9-3-zone-search-wiring` · **البند:** M0-53 · **الصف:** G-S9.3 (على RQ-CMA-15 — فرعُ «بحثٌ نصّيٌّ»)
**الحالة عند البدء:** `main` = `16c1ec3` (#791 — العقدُ `GET /geo/zones/search`، CLM-0645) · لا حجزَ ولا فرعَ متعارضٌ.

## 1) الحدّ — قرارٌ موثَّقٌ: [ADR-075](../../../15-decisions/ADR-075-edge-snapshot-gs9-3-zone-search.md)

- مدخلُ `customer-mini-app`: `GET /geo/zones/search` · geography · **P** · `geography:zone:read` · `accepts_body=false` · **`production_open=false`** · `blocked_until` مكتوبٌ · دليلٌ: `zone-search.test.ts` «returns only active zones …».
- اللقطةُ `route-enforcement.json`: صفٌّ بـ`added_by: CLM-0647 · ADR-075` وسجلٌّ في `additions` — 68 → 69 مسارًا؛ القياسُ الأصليُّ (67) وإضافةُ ADR-074 محفوظانِ.
- الصنفُ P: لا هويّةَ ولا مالكَ؛ والجوابُ مقصورٌ على النشطِ **في الخدمةِ** فلا معاملَ يوسّعُه (طفرةُ نزعِ شرطِ النشاطِ مكشوفةٌ في دليلِ CLM-0645).
- التوجيهُ: `/geo` ← geography قائمٌ في `infra/render/app-rewrites.json` (لا تغييرَ).

## 2) التطبيق

- `components/ZoneSearch.tsx` (جديدٌ): حقلُ بحثٍ + زرٌّ/Enter ← `GET /geo/zones/search?q=…&locale=<لغةُ الواجهةِ>`؛ أقلُّ من حرفينِ ← رسالةٌ بلا نداءٍ؛ حالاتُ التحميلِ والفراغِ والخطأِ؛ النتيجةُ «المنطقةُ — الحيُّ · المدينةُ». **درسُ G-S9.18:** عدّادُ تسلسلٍ — جوابُ بحثٍ أقدمَ لا يستبدلُ أحدثَ.
- `screens/RideOrder.tsx`: لكلٍّ من الالتقاطِ والوصولِ — النتيجةُ تملأُ `zone_id` واسمَها تسميةً و`source = "text_search"` (`StopSource` القائمُ)، وتُلغي اختيارَ المكانِ المحفوظِ؛ التحريرُ اليدويُّ بعدَها يُفرغُ التسميةَ ويعيدُ `manual_zone` (كقاعدةِ CLM-0622).
- `i18n`: ثمانيةُ مفاتيحَ × ar/en/ur.

## 3) الاختبارات

| | النتيجة | الخام |
|---|---|---|
| `ZoneSearch.test.tsx` (جديدٌ · 10): مسارُ العقدِ بالاستعلامِ المقصوصِ المرمَّزِ ولغةِ الواجهةِ · لا نداءَ لأقلَّ من حرفينِ · Enter · فراغٌ ≠ خطأٌ · خطأٌ · الاختيارُ يُبلَّغُ ويُفرَّغُ · جوابٌ متأخّرٌ لا يستبدلُ الأحدثَ · locale=en · **الوصلُ:** الإرسالُ بـ`text_search` و`zone_id` والتسميةِ للمحطّتينِ · التحريرُ اليدويُّ يعيدُ `manual_zone` | ✓ | [raw/customer-app-tests.txt](raw/customer-app-tests.txt) — التطبيقُ **124/124** · typecheck ✓ |
| طفرةٌ: نزعُ حارسِ التسلسلِ | يُكشَفُ (1✗) | [raw/mutation-check.txt](raw/mutation-check.txt) |
| الحارسانِ 28 و24 | ✓ 31 مدخلًا · 81 نداءً مطابقًا | [raw/guards-28-24.txt](raw/guards-28-24.txt) |

الأعدادُ المنشورةُ المحدَّثةُ: `APP_API_ROUTES.md` (`APP_CALL_SITES` 80 → 81 · `DISTINCT_APP_CALLS` 70 → 71 · `MATCHED_CALL_SITES` 80 → 81) · `EDGE_ALLOWLIST.md` (31 = 20 O · 3 P · 3 W · 5 N).

**الأساسُ (M0-08):** ملفُّ اختبارٍ جديدٌ ← `test_files_tracked` 579 → 580؛ أُعيدَ التوليدُ بـ`scripts/baseline.sh --log` من [raw/verify-log-stale-baseline-only.txt](raw/verify-log-stale-baseline-only.txt) (`verify.sh` أخفقَ فقط على الأساسِ القديمِ) على التزامٍ مدفوعٍ (درسُ CLM-0645).

## 4) ما لا يتغيّرُ

لا فتحَ إنتاجيٌّ (ADR-069 §6 · G-ENF) · Render مجمَّدٌ (ADR-073) · الحكمُ NO-GO · G-S9.2 كما هو (لا هندسةَ مناطقَ ولا مصدرَ بياناتٍ جديدٌ) · G-S9 الأمُّ مفتوحةٌ · M0-53 قيدَ التنفيذِ.

## 5) حكمُ CI

بعدَ الدفعِ — يُسجَّلُ بالأمرِ الفعليِّ.

**الحكمُ الفعليُّ (CLM-0646 · بالإضافةِ):** سيرُ الفرعِ 39381064568 على `957a1e9` **أخفقَ** (`verify` و`governance-guard`) — وهو الالتزامُ الوسيطُ الذي حملَ سجلَّ التحقّقِ قبلَ إعادةِ توليدِ الأساسِ (579 والحيُّ 580)، أي الإخفاقُ المتوقَّعُ نفسُه الذي أصلحَه الالتزامُ التالي. الرأسُ `ed1ec58`: 43 فحصًا ناجحًا ← PR [#792](https://github.com/skyosv10-art/wasla/pull/792) دُمِجَ بالتزامِ `f1f35c7`. على main: **WASLA CI** (السيرُ [39383688618](https://github.com/skyosv10-art/wasla/actions/runs/39383688618)) **نجاحٌ 41/41** · Roadmap freshness (39383688754) نجاحٌ — [raw/main-ci-f1f35c7.json](raw/main-ci-f1f35c7.json).
