# Search Service — طبقة HTTP (Phase 12 · MR 3/N)

> **النوع:** توثيق واجهة (API Layer) · **Scope:** عقد واجهة البحث في منتجات السوق، وقواعد التطبيع والترتيب، وحدودها مع نموذج القراءة المشتق.
>
> **المصدر الكنسي للعقد:** [`services/search/contracts/api.openapi.yml`](../../services/search/contracts/api.openapi.yml) · [`errors.md`](../../services/search/contracts/errors.md) · [`schema.sql`](../../services/search/contracts/schema.sql) · [`events.json`](../../services/search/contracts/events.json)
>
> **الخدمة:** `services/search` (منفذ **8012**) · **Status:** In Progress (المراجعة 3/N HTTP مُدمجة) · **Last Updated:** 2026-09-08
>
> **Related Code:** `services/search/src/domain/{model,query,visibility,ranking}.ts` · `services/search/src/http/{app,requests,errors,mappers,server}.ts` · `services/search/src/infrastructure/search-index-reader.ts` · `services/search/src/__tests__/{http-requests,http-app,search-index-reader.integration}.test.ts`
>
> **Related Docs:** [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [ADR-016](../15-decisions/ADR-016-marketplace-store-ownership-catalog-and-moderation-boundary.md) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

---

## 1. ماذا يُضاف في هذا العنصر

هذا توثيقُ خدمةِ البحثِ لـ M5-12. **المراجعة 3/N (طبقة HTTP) مُدمجةٌ** فوق المراجعتَين 1/N (العقدُ والنطاقُ) و2/N (المستهلكُ relay). لا تُدّعى إكمالُ بوّابة relevance/load ولا وظائفُ CI التكامليّةُ بعد. ما يُغطّيه:

- **عقدُ البياناتِ** (`schema.sql`): وثيقةُ فهرسِ المنتجِ المُشتقّة (`search_product_index`) مع فهارسِ `tsvector` (إنجليزي) و`pg_trgm` (عربي/تقريبي) وoutbox.
- **عقدُ الواجهةِ** (`api.openapi.yml`): `GET /search/products` + `GET /search/health`.
- **عقدُ الأحداثِ** (`events.json`): أحداثُ دورةِ حياةِ الفهرسِ (بُنيَ/أُعيدَ بناؤُهُ/تدهورَ).
- **كتالوجُ الأخطاءِ** (`errors.md`): أكوادٌ ثابتةٌ + مساراتُ فشلٍ.
- **نواةُ النطاقِ** (`src/domain/`): تطبيعُ الاستعلامِ (عربي/إنجليز)، قواعدُ الترتيبِ المفسَّرة، قواعدُ الظهورِ المُعادةِ من الحالةِ.
- **اختباراتُ وحدةٍ** (`src/__tests__/`): 24 حالةً تغطّي التطبيعَ والترتيبَ والظهورَ.

### 1.1 ما يُؤجَّلُ لمراجعاتٍ لاحقة (مُعلَنٌ لا مطويٌّ)

| المؤجَّل | السبب | أين يُسجَّل |
|---|---|---|
| المستهلكُ الكاملُ (relay) لأحداثِ outbox السوقِ | قرارٌ معماريٌّ + تنفيذٌ يُفصَلان | ADR-025 §2.3 + TASK_LOG |
| ~~بوّابةُ relevance/load (exit gate)~~ | **أُنجزت في المراجعة 4/N** — حزمةُ `@wasla/search-e2e`، عشرونَ اختباراً على PostgreSQL وسلكٍ حقيقيَّين | [`PHASE12_EXIT_GATE_E2E.md`](../12-testing/PHASE12_EXIT_GATE_E2E.md) |
| ~~طبقةُ HTTP الكاملةُ (Fastify app)~~ | **أُنجزت في المراجعة 3/N** — تطبيقُ Fastify مُحقَنٌ بمنفذِ قراءة، ومعالجُ أخطاءٍ واحد، و503 كملاذٍ أخير | TASK_LOG · SEARCH_HTTP §5 |
| ~~اختباراتٌ تكامليّةٌ على PostgreSQL + وظائفُ CI~~ | **أُنجزت في المراجعة 4/N** — ساقانِ جديدتانِ في `db-integration` و`exit-gate-e2e` بقاعدتَينِ مستقلّتَين، وساقٌ ثالثةٌ في القاعدةِ المشتركةِ (13/13) | [`PHASE12_EXIT_GATE_E2E.md`](../12-testing/PHASE12_EXIT_GATE_E2E.md) §7 |

---

## 2. نقطةُ الدخولِ الوحيدةُ للبحثِ

```text
GET /search/products?q=...&locale=ar|en&category_id=...&page=1&page_size=20&sort=relevance
```

- **`q`** (إلزاميٌّ، 1..200 حرف): نصُّ البحثِ الحر. يُطبَّعُ ويُجزَّأُ قبلَ التنفيذ. «الكترونيات» و«electronics» و«إلكترونيات» يجبُ أن تجدَ نفسَ المنتجات.
- **`locale`** (`ar` افتراضيٌّ): لغةُ النتائجِ. `ar` = fallback إلزاميٌّ.
- **`category_id`** (اختياريٌّ): فلترُ تصنيف. التصنيفُ من أصلِ السوقِ لا يُخترَعُ هنا.
- **`page`/`page_size`**: تجزئةٌ (1-based، الحدُّ الأعلى 50).
- **`sort`**: `relevance` (افتراضي) · `price_asc` · `price_desc` · `newest`.

---

## 3. سُلَّمُ الترتيبِ المفسَّرُ (لا سحرَ)

الترتيبُ قواعدُ مقروءةٌ مفسَّرةٌ، لا تعلّمٌ آليٌّ ولا نموذجٌ مُدرَّبٌ:

1. **مطابقةٌ تامّةٌ** (exact) على slug أو title → الدرجةُ `1.0`
2. **بادئةٌ** (prefix) → الدرجةُ `0.8`
3. **كلُّ المصطلحاتِ حاضرةٌ** (fts proxy) → الدرجةُ `0.6`
4. **تشابهُ ثلاثيِّ الحروفِ** (trigram) → بين `0.1` و`0.59`

درجةُ كلِّ وثيقةٍ هي **الحدُّ الأقصى** عبرَ إشاراتِ المطابقة، فلا يُخفَضُ منتجٌ طابقَ slug تامًّا بسببِ تشابهِ trigram منخفض.

---

## 4. قواعدُ الظهورِ (مُشتقّةٌ لا مُخزَّنة)

لا عمودَ `is_visible` في الفهرس. شرطُ الظهورِ (ADR-016 القرارُ 3) يُعادُ بناؤُهُ من الحالةِ المُستهلكةِ عند بناءِ الوثيقةِ:

- المتجرُ `approved`
- المنتجُ `published`
- الاعتدالُ `approved`
- الكميّةُ `> 0`

فوثيقةٌ لا تُبنى أصلًا لمنتجٍ غيرِ ظاهر. وإن اختلفتِ الحالةُ بينَ الفهرسِ والمصدر، فالفهرسُ هو الخطأُ ويُصلِحُهُ الاستهلاكُ أو إعادةُ البناءِ. **البحثُ ليس بوّابةَ معاملةٍ** — لا حجزَ ولا دفعَ، فالاتساقُ الناعمُ (eventual) مقبولٌ.

---

## 5. تنفيذُ طبقةِ HTTP (المراجعةُ 3/N)

طبقةُ HTTP هي **حدٌّ مُحقَنٌ لا حدٌّ مُتصلٌ**: تطبيقُ Fastify يعتمدُ على `SearchProductsReadPort` مُحقَنٍ، فلا يفتحُ اتصالاً بقاعدةِ البياناتِ بنفسِه. الاختباراتُ تبني التطبيقَ بمنفذٍ وهميٍّ (fake) بلا DB؛ والتوصيلُ الفعليُّ في `http/server.ts`.

### 5.1 المساراتُ

- **`GET /search/products`** — يُحلِّلُ المعاملاتِ (`parseSearchRequest`)، يُمرِّرُها للمنفذِ، يُعيّنُ النتيجةَ إلى شكلِ العقدِ (`toSearchPage`).
- **`GET /search/health`** — يُرجع `{ status: "ok" }`. **ليس بوّابةَ جاهزيّةٍ تَسألُ الفهرسَ**، وهذا **مُثبَتٌ بقياسٍ** لا موصوفٌ: بوّابةُ المرحلةِ 12 تُسقِطُ جدولَ الفهرسِ فيُجيبُ `/search/products` بـ`503 · SEARCH_INDEX_DEGRADED` ويظلُّ `/search/health` يُجيبُ `ok` في اللحظةِ نفسِها. العلاجُ (مسارُ جاهزيّةٍ منفصلٌ) مُسجَّلٌ بمالكٍ ومهلةٍ في [`RISK-0030`](../07-security/RISK_REGISTER.md).

### 5.2 معالجُ أخطاءٍ واحدٌ، بلا try/catch في المعالِجات

المعالِجاتُ تُلقي بأخطاءٍ مُصنَّفةٍ (`SearchValidationError` / `SearchUnavailableError`) أو تتركُ المنفذَ يُلقي؛ ومعالجُ `setErrorHandler` واحدٌ يُترجمُها عبرَ `sendSearchError`. لا يُغلِّفُ معالجٌ جسمَه بـtry/catch — فذلك يعني ترجمةً ثانيةً لنفسِ الخطأِ في مكانٍ لا يقرؤه أحدٌ، وأولُ مسارٍ ينسى الشكلَ يُرجعُ جسمًا لا يطابقُ `ErrorResponse`.

### 5.3 503 لا 500

الملاذُ الأخيرُ هو `503 SEARCH_INTERNAL_ERROR` لا `500`. نموذجُ قراءةِ البحثِ يعتمدُ على فهرسٍ مشتقٍّ تُغلبُ على إخفاقاتِه الحالةُ العابرةُ (اتصالٌ، مهلةٌ، تأخّرُ relay) — حالةٌ قابلةٌ لإعادةِ المحاولة. `500` يقولُ للعميلِ «عيبُ منطقٍ، لا تُعد»؛ `503` يقولُ «أعد». بحثٌ ينجحُ بعدَ ثانيتَين لا يُهجَرُ بعميلٍ حذرٍ.

شكلُ الخطأِ مسطّحٌ `{ code, message, trace_id }` حسب `errors.md` — لا متداخلٌ `{ error: {...} }`.

### 5.4 التحققُ والتحويل

- **`parseSearchRequest`** (`http/requests.ts`): المصدرُ الوحيدُ لما يُعدُّ طلبَ بحثٍ صالحًا. القيمُ الموجودةُ-غيرُ-الصالحةِ تُرفَضُ (400) — لا تسكّتٌ إلى افتراضات. المصفوفاتُ مرفوضةٌ (مفتاحٌ مكرَّرٌ خطأُ عميلٍ)، لا يُؤخذُ أوّلُ عنصرٍ صمتًا.
- **`toSearchPage`** (`http/mappers.ts`): يُحوِّلُ `SearchPage` النطاقيَّ إلى `SearchPage` العقدِ بتعيينٍ صريحٍ للحقول — لا `as`-cast — فيُصبحُ حقلٌ يُضافُ لأحدهما دونَ الآخرِ فشلَ نوعٍ لا انجرافَ شكلٍ صامت.

### 5.5 القارئُ الفعليُّ (integration)

`SearchIndexReader` (`infrastructure/search-index-reader.ts`) هو المحوِّلُ الإنتاجيُّ لـ`SearchProductsReadPort` فوقَ `pg.Pool`. يقرأُ **فقط** `search_product_index` — لا JOIN لجداولِ السوقِ (حدُّ ADR-016 القرارُ 9). الظهورُ شرطُ WHERE على الأعمدةِ الأربعةِ، لا رايةٌ مُخزَّنة. المطابقةُ على مرحلتَين: SQL يُضيِّقُ المُرشَّحينَ (trigram + FTS + substring)، ثمَّ ترتيبُ النطاقِ (`rankAndSort`) يُعيدُ تسجيلَ النتائجِ بسُلَّمِ exact > prefix > fts > trigram. اختبارُ التكاملِ يتخطّى نفسَه بلا `DATABASE_URL`، **ووظيفةُ CI التي تُشغِّلُه قائمةٌ منذُ المراجعةِ 4/N**: `db-integration (search, @wasla/search-service, wasla_search_test)`. **وسقفُ المُرشَّحينَ (500) مقيسٌ الآنَ لا موصوفٌ:** على ألفَي وثيقةٍ مُطابِقةٍ يُرجعُ الحدُّ `total = 500` — [`RISK-0029`](../07-security/RISK_REGISTER.md).

### 5.6 ما يُؤجَّلُ بعدَ هذه المراجعة

| المؤجَّل | أين يُسجَّل |
|---|---|
| ~~بوّابةُ relevance/load (exit gate)~~ | **أُنجزت 4/N** — [`PHASE12_EXIT_GATE_E2E.md`](../12-testing/PHASE12_EXIT_GATE_E2E.md) |
| ~~وظيفةُ CI `search-db-integration`~~ | **أُنجزت 4/N** — ساقُ `search` في مصفوفةِ `db-integration` |
| ~~وظيفةُ CI `search-exit-gate-e2e`~~ | **أُنجزت 4/N** — ساقُ `search` في مصفوفةِ `exit-gate-e2e` |
| رفعُ سقفِ المُرشَّحينَ (v1: 500) فوقَ بوّابةِ الحملِ | [`RISK-0029`](../07-security/RISK_REGISTER.md) — **مقيسٌ الآنَ** بمالكٍ ومهلةِ مراجعةٍ |
| مسارُ جاهزيّةٍ يسألُ الفهرسَ (`/search/ready`) | [`RISK-0030`](../07-security/RISK_REGISTER.md) — عيبٌ **مُثبَتٌ بتوكيدٍ** في البوّابةِ |
