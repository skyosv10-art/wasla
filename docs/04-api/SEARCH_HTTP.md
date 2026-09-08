# Search Service — طبقة HTTP (Phase 12 · MR 1/N)

> **النوع:** توثيق واجهة (API Layer) · **Scope:** عقد واجهة البحث في منتجات السوق، وقواعد التطبيع والترتيب، وحدودها مع نموذج القراءة المشتق.
>
> **المصدر الكنسي للعقد:** [`services/search/contracts/api.openapi.yml`](../../services/search/contracts/api.openapi.yml) · [`errors.md`](../../services/search/contracts/errors.md) · [`schema.sql`](../../services/search/contracts/schema.sql) · [`events.json`](../../services/search/contracts/events.json)
>
> **الخدمة:** `services/search` (منفذ **8012**) · **Status:** In Progress (PR أول تأسيسي) · **Last Updated:** 2026-09-08
>
> **Related Code:** `services/search/src/domain/{model,query,visibility,ranking}.ts` · `services/search/src/__tests__/{query,visibility,ranking}.test.ts`
>
> **Related Docs:** [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [ADR-016](../15-decisions/ADR-016-marketplace-store-ownership-catalog-and-moderation-boundary.md) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

---

## 1. ماذا يُضاف في هذا العنصر

هذا **PR أول تأسيسي (review 1/N)** لـ M5-12. لا يدّعي إكمال بوّابة relevance/load ولا المستهلك الكامل. ما يُغطّيه:

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
| بوّابةُ relevance/load (exit gate) | فحوصُ أداءٍ صعبةٌ لا تُخلطُ مع القرارِ | ADR-025 §2.4 + TASK_LOG |
| طبقةُ HTTP الكاملةُ (Fastify app) | تأتي بعد استقرارِ النطاقِ والعقدِ | TASK_LOG |
| اختباراتٌ تكامليّةٌ على PostgreSQL + وظائفُ CI | تتطلّبُ ناقلًا وDB | ADR-025 §4 + TASK_LOG |

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
