# CLM-0613 — G-S10: توفّرُ السائقِ وأهليّتُه ومسارُ غيرِ المؤهَّلِ (+ قياسُ المهامِ النشطةِ)

**الحجزُ:** CLM-0613 · **العنصرُ:** M0-53 · **الأساسُ:** main `478c3ff26ac01e0113bf32448a66f4a9635ff24a` (بعدَ دمجِ #763 / CLM-0612 — أُعيدَ التأسيسُ عليه؛ الأساسُ الآليُّ أُعيدَ توليدُه على هذا الأساسِ §5c). التفويضُ: «نفّذ حالات توفر السائق وأهليته والمهام النشطة وغير المؤهل، مع اختبار حدود الصلاحية وعقود الخدمة.»

## §1 القياسُ قبلَ

| البندُ | المواصفةُ (DMS) | الواجهةُ قبلَ | العقدُ الخلفيُّ |
|---|---|---|---|
| تبديلُ التوفّرِ (RQ-DMA-15) | §4.2 L77 «`available` / `busy`» · §5 L228 `PUT /drivers/:id/availability` | لا شيءَ في Home | **قائمٌ** `services/drivers/src/http/app.ts` L536 (`ownerScoped(availabilityWrite)`) · العقدُ المعتمَدُ `DRIVER_DECLARED_AVAILABILITY = ["available", "offline"]` (`packages/contracts/driver/src/index.ts` L109) · **`busy` يُرفَضُ 400** (اختبارٌ قائمٌ `http-profile.test.ts` L301) |
| تنبيهُ الأهليّةِ (RQ-DMA-16) · Profile (RQ-DMA-43) | §4.2 L78 · §4.9 L213/L221 · §5 L229 | لا شيءَ | **قائمٌ** L573 (`ownerScoped(eligibilityRead)`) · الشكلُ `eligibility_state` ∈ `eligible·ineligible·suspended·unknown` + `reason_codes` (`mappers.ts` `eligibilityToWire`) |
| غيرُ المؤهَّلِ: السببُ + رابطُ الوثائقِ (RQ-DMA-44) | §3.2 L33-35 · §7 L269 | لا شيءَ | كما فوق |
| المهامُ النشطةُ أوّلًا (RQ-DMA-17) | §4.2 L79 | عنصرُ تنقّلٍ «المهام النشطة» → `#/offers` (العروضُ لا المهامُ) | **لا عقدَ:** `GET /orders/drivers/:id/jobs` يُرجعُ الطرفيّةَ فقط — `completed · driver_cancelled · customer_cancelled` (`in-memory.ts` L184-190 · `drizzle/repository.ts` L468-470) · dispatch بلا قائمةٍ لسائقٍ (`/dispatch/jobs/:job_id` و`/offers/:offer_id` بالمعرّفِ فقط) |
| اختباراتُ حدودِ الصلاحيّةِ | — | — | لا اختبارَ لـ403 (صلاحيّةٌ ناقصةٌ) ولا 404 (مُنتَفِعٌ آخرُ) على المسارينِ |
| حدُّ القناةِ | — | — | المسارانِ **غيرُ مُدرَجينِ** في `packages/channel-edge/allowlist/driver-mini-app.json` (`docs/12-testing/EDGE_ALLOWLIST.md` L93: حُذفَ PUT availability «لأن التطبيق لا يناديه (R-02)») |

## §2 اختلافُ القياسِ عن المواصفةِ — `busy`

DMS §4.2 L77 يقولُ `available` / `busy`؛ العقدُ المعتمَدُ المنفَّذُ يجعلُ السائقَ يُعلِنُ `available` / `offline` فقط، و`busy` تضعُه المنظومةُ أثناءَ مهمّةٍ (`busy` يُرفَضُ 400 — مُثبَتٌ مجدَّدًا أدناه). **التنفيذُ يتبعُ العقدَ** (نمطُ G-S11: لا يُستبدَلُ عقدٌ مختبَرٌ بنصٍّ متقادمٍ)؛ وأُضيفتْ ملاحظةٌ مؤرَّخةٌ تحتَ DMS L77 بلا محوٍ. لا قرارَ مالكٍ يخالفُ ذلك؛ إن أرادَ المالكُ `busy` يدويًّا فذلك تغييرُ عقدٍ مستقلٌّ.

## §3 التغييرُ

- `apps/driver-mini-app/src/types/profile.ts`: `DriverEligibility` بقيمِ العقدِ.
- `store/profile.ts`: `fetchEligibility` · `setAvailability` (حارسُ طلبٍ واحدٍ في الطيرانِ؛ الجوابُ — الملفُّ كاملًا — يحلُّ محلَّ المخزَّنِ فتعرضُ الشاشةُ ما عندَ الخادمِ).
- `screens/Home.tsx`: قسمُ التوفّرِ (زرٌّ `aria-pressed` · خطأٌ ظاهرٌ · تعطيلٌ أثناءَ الطلبِ) · قسمُ الأهليّةِ (مؤهَّلٌ · غيرُ محسومٍ · `ineligible`/`suspended` ← `role=alert` بكلِّ الأسبابِ بالترتيبِ + رابطُ `#/documents` · خطأٌ بإعادةٍ).
- `screens/Profile.tsx`: صفُّ الأهليّةِ (DMS §4.9).
- i18n ar/en/ur: مفاتيحُ التوفّرِ والأهليّةِ والأسبابِ التسعةِ.
- `services/drivers/src/__tests__/availability-eligibility-boundaries.test.ts` (جديدٌ — اختباراتٌ فقط، لا تغييرَ في الخدمةِ).

## §4 الاختباراتُ (التوكيدُ لا الاسمُ)

**خدمةٌ حقيقيّةٌ** (Fastify + وسيطُ هويّةِ الخدمةِ الحقيقيُّ، `rawInject` بتوقيعٍ صريحٍ — لا توقيعَ السندِ التلقائيَّ) — `availability-eligibility-boundaries.test.ts`:

| L | الحالةُ | التوكيدُ |
|---|---|---|
| 53 | المالكُ بـ`drivers:availability:write` | 200 لـ available→offline→available وكلُّ قيمةٍ تُقرأُ من `GET /drivers/:id` |
| 69 | بلا الصلاحيّةِ (بـ`profile:write`) | **403** والإعلانُ **لم يتغيّرْ** (إعادةُ قراءةٍ) |
| 84 | رمزٌ لسائقٍ آخرَ | **404 لا 403** والإعلانُ لم يتغيّرْ |
| 103 | `busy` | **400** `field: declared_availability` ولم يتغيّرْ |
| 120 | المالكُ بـ`drivers:eligibility:read` | 200 · `ineligible` · `reason_codes` = `["NO_PRIMARY_VEHICLE","NO_SERVICE_ZONE","DOCUMENT_MISSING"]` بالضبطِ |
| 137 | بلا الصلاحيّةِ | **403** |
| 148 | رمزٌ لسائقٍ آخرَ | **404 لا 403** |

**الواجهةُ** — `Home.test.tsx` (L78 التحميلُ · L87 available→offline وما أعادَه الخادمُ · L101 offline→available و`busy` لا يُرسَلُ أبدًا · L111 الفشلُ ظاهرٌ والحالةُ باقيةٌ · L119 لا طلبَ ثانٍ أثناءَ الأوّلِ · L132 غيرُ مؤهَّلٍ: الأسبابُ الثلاثةُ بالترتيبِ ونصوصُها والرابطُ · L146 الموقوفُ · L154 `unknown` لا مؤهَّلٌ ولا محجوبٌ · L161 خطأُ الجلبِ وإعادتُه) · `Profile.test.tsx` (الجلبُ عندَ التركيبِ وعرضُ الحالةِ · لا صفَّ قبلَ الحكمِ). **E2E** `home-availability.spec.ts` (L15 جسما PUT بالضبطِ `[offline, available]` · L33 الأسبابُ ثمَّ الانتقالُ إلى `#/documents`).

**المحليُّ:** driver-mini-app vitest **158/158** · Playwright **37/37** · `tsc` 0 — services/drivers vitest **224/224** (17 ملفًّا؛ ملفّاتُ تكاملِ Postgres خارجَ هذا التشغيلِ) · `tsc` 0. [raw](raw/).

**طفراتٌ مقيسةٌ (أُعيدتِ الملفّاتُ):** الزرُّ يرسلُ `busy` ← يُخفقُ L101/L87 · إزالةُ حارسِ الطيرانِ والتعطيلِ ← يُخفقُ L119 · `suspended` لا يُحجَبُ ← يُخفقُ L146 · مسارُ الخدمةِ بصلاحيّةِ `profile:write` بدلَ `availability:write` ← 4 إخفاقاتٍ في اختبارِ الخدمةِ.

## §5 حاجزانِ مرفوعانِ بدليلٍ (لا يُتجاوَزانِ)

1. **مدخلا حدِّ القناةِ (G-S10.4):** أُضيفَ المدخلانِ (O · `production_open=false` · دليلُ L84/L148) فرفضَهما الحارسُ 28: `[EA-SNAPSHOT-NEW] … مدخل خارج لقطة route-enforcement.json — يحتاج قرارًا موثقًا` ([raw](raw/edge-allowlist-refusal.txt)). القائمةُ جزءٌ من ADR-069 §2.8 (قرارُ المالكِ 2026-10-10)، فـ**أُعيدَ الملفُّ** ولم يُعدَّلِ الحارسُ ولا اللقطةُ. بلا قرارٍ موثَّقٍ يبقى المسارانِ 404 من الحدِّ — والشاشةُ لا تصيرُ حيّةً (وكلُّ المدخلاتِ `production_open=false` أصلًا).
2. **المهامُ النشطةُ (G-S10.3):** لا عقدَ يُرجعُ مهامَّ السائقِ الجاريةَ (§1). تنفيذُها يتطلّبُ مسارًا جديدًا في orders أو dispatch بصلاحيّةٍ ومستودعِ Postgres وعقدِ OpenAPI ومدخلِ حدٍّ (يقعُ تحتَ الحاجزِ 1) — شريحةُ عقدٍ مستقلّةٌ؛ لم تُختلَقْ شاشةٌ على بياناتٍ لا مصدرَ لها.

## §5b عدّاداتُ نداءاتِ التطبيقاتِ

النداءانِ الجديدانِ (`GET …/eligibility` و`PUT …/availability`) يرفعانِ المقيسَ في `docs/12-testing/APP_API_ROUTES.md` §5: `APP_CALL_SITES` 74→**76** · `DISTINCT_APP_CALLS` 67→**69** · `MATCHED_CALL_SITES` 74→**76** — كلاهما يطابقُ مسارَ خدمةٍ (البابُ 2) وله بادئةُ توجيهٍ (البابُ 6)؛ نُشرتِ الأرقامُ المقيسةُ (البابُ 5 كانَ يرفضُ المنشورَ القديمَ).

## §5c الأساسُ الآليُّ (BASELINE)

ملفّا اختبارٍ جديدانِ ← `test_files_tracked` 575 → **577**. أُعيدَ التوليدُ وفقَ [BASELINE_FORMAT §4-§5](../../BASELINE_FORMAT.md): `verify.sh` كاملًا على الأساسِ ← [raw/verify-log-stale-baseline-only.txt](raw/verify-log-stale-baseline-only.txt) (أخفقَ **فقط** في الفحصِ 11 — الأساسُ المتقادمُ — ثمَّ حزمةِ الحوكمةِ التي تشغّلُه؛ الأنواعُ والاختباراتُ نجحتْ) ← `scripts/baseline.sh --log …` على شجرةٍ نظيفةٍ ← `validate-baseline.sh` ✓.

## §6 حدودُ الدليلِ

Playwright وvitest الواجهةِ محاكيانِ؛ دليلُ الصلاحيّةِ والعقدِ هو اختبارُ الخدمةِ (§4). لا تكاملَ حيٌّ (الحدُّ مغلقٌ). G-S10 مفتوحٌ: G-S10.1/G-S10.2 تُغلقانِ بعدَ CI على main؛ G-S10.3/G-S10.4 قائمتانِ.
