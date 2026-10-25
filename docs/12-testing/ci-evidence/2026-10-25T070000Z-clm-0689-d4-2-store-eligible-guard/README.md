# CLM-0689 — D4.2: حارسُ أهليّةِ المتاجرِ `E-20:store-eligible` (ADR-025 §6.10)

**التاريخ:** 2026-10-25 · **البند:** M0-53 (G-S9.7) · **الفرع:** `fix/clm-0689-d4-2-store-eligible-guard` · **الأساس:** `main` عندَ `ea04de0d3b486eaef3b890903338f76f3308981c`.

**التكليفُ (نصُّه):** «D4.2 هو العمل الهندسي التالي قبل T1… أضف حالات تشمل متجرًا مؤرشفًا، ومنتجًا مؤرشفًا، ومتجرًا معتمدًا مؤهلًا وغير مؤهل، وأثبت أن تعطيل الحارس أو إضعاف شرط الأهلية يُسقط الاختبار. افصل حالة المتجر عن حالة المنتج… لا تُجرِ T1 ضمن هذا التكليف.»

## ما تغيّر

| الوحدة | التغيير |
| --- | --- |
| `services/search/src/__tests__/support/store-eligibility-seed.ts` (جديد) | بذرةٌ بحقلَين منفصلَين `store` و`product`؛ أحداثُ سوقٍ حقيقيّةٌ عبرَ المُرحِّلِ الحقيقيِّ؛ تقرأُ الحالتَين من جدولَيهما وتُسقطُ الاختبارَ إن خالفتا المُعلَن |
| `services/search/src/__tests__/store-search-journey.integration.test.ts` | حالةٌ جديدةٌ: 6 متاجر (معتمَدانِ بمنتجٍ ظاهرٍ · معتمَدٌ بمنتجٍ مؤرشَفٍ · معتمَدٌ بلا منتج · موقوفٌ بمنتجٍ ظاهرٍ · مؤرشَفٌ بمنتجٍ ظاهرٍ) عبرَ Channel Edge الحقيقيِّ إلى حدِّ بحثٍ حقيقيٍّ، و`toEqual` بالمؤهَّلَين، وإسقاطُ ثلاثةِ حقول |
| `scripts/checks/lib/ts_evidence.cjs` | الاستيراداتُ المسمّاةُ للملف · نداءاتُ البذرِ بصفوفٍ حرفيّة · شكلا `X.map((i) => i.F)` و`Object.keys(X)` مع مصفوفةِ نصوصٍ حرفيّة |
| `scripts/checks/lib/edge_allowlist_guard.py` | `prove_e20_store_eligible` · `EA-P-E20-STORE` (الدليلُ المعلَنُ يُفحَصُ والمدخلُ مغلق) · `EA-P-E20-STORE-SCOPE` (D5) · على مسارِ المتاجرِ يحلُّ store-eligible محلَّ published-only |
| `scripts/checks/lib/gov-cases-edge-allowlist.sh` | 21 حالةً جديدة (1 ضابطٌ موجب · 17 طفرةَ دليل · 3 نطاقٌ/فتح) |
| `packages/channel-edge/allowlist/customer-mini-app.json` | دليلٌ رابعٌ `proves: ["E-20:store-eligible"]` · نصُّ `blocked_until` محدَّث · **`production_open=false` بلا تغيير** |
| ADR-025 §6.10 · `docs/12-testing/EDGE_ALLOWLIST.md` | التوثيق |

## النتائجُ المحليّة (ليست CI)

PostgreSQL 18 محليٌّ (CI يستعملُ 17). السجلّاتُ في `raw/`.

| الفحص | النتيجة | السجلّ |
| --- | --- | --- |
| الحالةُ الجديدةُ + ملفُّ الرحلة | 8/8 | `raw/positive-integration.log` |
| كلُّ تكاملِ search | 12 ملفًّا · 95/95 | `raw/search-integration-all.log` |
| وحداتُ search | 14 ملفًّا · 187/187 | `raw/search-unit.log` |
| `tsc --noEmit` (search) | rc=0 | `raw/tsc-search.log` |
| حالاتُ الحارسِ 28 (مجموعةُ edge-allowlist وحدَها) | 119/0 | `raw/gov-edge-allowlist-positive.log` |

## الطفرات — شرطُ الأهليّةِ في الشفرة (`STORE_ELIGIBILITY_SQL`)

| الطفرة | النتيجة | ملاحظة |
| --- | --- | --- |
| m1 حذفُ `ss.store_state = 'approved'` | 2 فشلتا (الجديدةُ والقديمة) | `raw/mut-m1-no-store-state.log` |
| m2 حذفُ `p.archived_at IS NULL` وحدَه | **نجت** — 8/8 | مكافئةٌ على المسارِ الحقيقيِّ: `product_archived` يضبطُ `product_state=archived` و`archived_at` معًا (`src/domain/projector.ts`). حدٌّ مُعلَن |
| m3 حذفُ `product_state='published'` و`archived_at IS NULL` | 2 فشلتا | `raw/mut-m3-no-published.log` |
| m4 حذفُ شرطِ وجودِ منتجٍ ظاهرٍ كلِّه | 2 فشلتا | `raw/mut-m4-no-exists.log` |
| m5 `store_state <> 'suspended'` بدلَ `= 'approved'` | **الجديدةُ وحدَها فشلت** | يُثبتُ أنّ المتجرَ المؤرشَفَ يضيفُ قوّةً لم تكن في دليلِ D4.1 |

## الطفرات — البذرةُ نفسُها

| الطفرة | النتيجة |
| --- | --- |
| s1 البذرةُ لا تُرسلُ حدثَ أرشفةِ المتجر | فشلٌ صريح: «البذرةُ لم تُسقِطْ حالةَ المتجرِ المُعلَنةَ لـelig-archived-store-visible: approved ≠ archived» |
| s2 البذرةُ لا تُرسلُ حدثَ أرشفةِ المنتج | فشلٌ صريح: «… حالةَ المنتجِ … elig-approved-archived-product: visible ≠ archived» |

## الطفرات — الحارسُ 28 (في نسخةٍ مؤقّتة)

| الطفرة | النتيجة |
| --- | --- |
| g1 المُثبِتُ يعيدُ `[]` دائمًا (الحارسُ معطَّل) | 17 حالةً فشلت (كلُّ طفراتِ الدليلِ الـ17) |
| g2 شرطُ «متجرٌ مؤرشَف» صادقٌ دائمًا | فشلت «بذرةٌ بلا متجرٍ مؤرشَف» وحدَها |
| g3 المساواةُ ← «جزءٌ من المؤهَّل» | فشلت «المتوقَّعُ ينقصُه متجرٌ مؤهَّل» وحدَها — **أُضيفت هذه الحالةُ بعدَ أن نجت g3 في المسودّة** |
| g4 لا فحصَ لمصدرِ الاستيراد | فشلت «دالةُ بذرٍ محلّيّة» وحدَها |

## حدودٌ غيرُ مثبَتة

1. الملفُّ يتخطّى نفسَه بلا `DATABASE_URL` عبرَ `(PG_ENABLED ? describe : describe.skip)`، والمحلّلُ لا يرى هذا شرطًا؛ الحارسُ يُثبتُ **شكلَ** الدليل، وتنفيذُه يُثبَتُ في مهمّةِ `integration (search)` في CI.
2. قائمةُ سماحٍ اصطناعيّة و`exchangeSession` محوَّرة — ليسَ T1 ولا إنتاجًا.
3. طفرةُ m2 مكافئة (أعلاه).
4. لا شيءَ حيّ: لا نشر، لا Render، لا T1 (D4.3 يحتاجُ إذنًا منفصلًا من المالك).
