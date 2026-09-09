# Error Contract — Search Service (Phase 12)

> **Scope:** كتالوج أكواد الأخطاء الثابتة لخدمة البحث في السوق.
>
> **القاعدة:** أكواد الأخطاء ثابتة (stable) ولا تتغير دلالتها بعد الإصدار. الأكواد الجديدة تُضاف فقط. أي تغيير في الدلالة يتطلب إصداراً جديداً + ADR.
>
> **Related:** [api.openapi.yml](api.openapi.yml) · [ADR-025](../../../docs/15-decisions/ADR-025-marketplace-search-read-model.md)

---

## أصناف الأخطاء

| الصنف (Class) | HTTP | الوصف |
|---|---|---|
| `validation_error` | 400 | مدخلات غير صالحة (استعلام فارغ/طويل، locale غير مدعوم) |
| `service_unavailable` | 503 | الخدمة في وضع متدهور (الفهرس غير جاهز) |

---

## كتالوج الأكواد

| Code | Class | الوصف | متى يُرجَع |
|---|---|---|---|
| `SEARCH_QUERY_EMPTY` | `validation_error` | نص البحث فارغ | `q` مفقود أو فارغ بعد التقليم |
| `SEARCH_QUERY_TOO_LONG` | `validation_error` | نص البحث يتجاوز الحد | `q` أطول من 200 حرف |
| `SEARCH_PAGE_OUT_OF_RANGE` | `validation_error` | رقم الصفحة خارج النطاق | `page` < 1، أو صفحةٌ ينتهي آخِرُ صفٍّ فيها خارجَ نافذةِ الترتيبِ (5000) |
| `SEARCH_PAGE_SIZE_INVALID` | `validation_error` | حجم الصفحة غير صالح | `page_size` < 1 أو > 50 |
| `SEARCH_UNSUPPORTED_LOCALE` | `validation_error` | locale غير مدعوم | locale ليس ضمن `ar`/`en` |
| `SEARCH_SORT_INVALID` | `validation_error` | ترتيب غير معروف | `sort` ليس ضمن القيم المسموحة |
| `SEARCH_INDEX_DEGRADED` | `service_unavailable` | الفهرس في وضع متدهور | تأخّر الاستهلاك أو فشل إعادة البناء |
| `SEARCH_INTERNAL_ERROR` | `service_unavailable` | خطأ داخلي غير متوقع | خطأ غير مُصنّف (degraded) |

---

## مثال حمولة الخطأ

```json
{
  "code": "SEARCH_QUERY_EMPTY",
  "message": "نص البحث لا يمكن أن يكون فارغاً",
  "trace_id": "01HXY..."
}
```

---

## مسار الفشل (Failure Paths) — وفق قاعدة «لا Feature بلا مسار فشل»

| السيناريو | السلوك المتوقّع |
|---|---|
| طلب بحث بلا `q` أو `q` فارغ بعد التقليم | `SEARCH_QUERY_EMPTY` (400) — يُرفض قبل الوصول للفهرس |
| نص بحث أطول من 200 حرف | `SEARCH_QUERY_TOO_LONG` (400) |
| `locale` غير مدعوم (مثال: `fr`) | `SEARCH_UNSUPPORTED_LOCALE` (400) |
| `page_size` = 0 أو > 50 | `SEARCH_PAGE_SIZE_INVALID` (400) |
| `page` يتجاوز نافذةَ الترتيبِ (مثال: `page=101` بـ`page_size=50`) | `SEARCH_PAGE_OUT_OF_RANGE` (400) — **يُرفَضُ قبلَ لمسِ القاعدةِ**، ولا يُخدَمُ من مجموعةٍ مقصوصةٍ |
| الفهرس غير جاهز (تدهورٌ) | `SEARCH_INDEX_DEGRADED` (503) |
| الفهرسُ غيرُ قابلٍ للوصولِ عندَ `GET /search/ready` | `SEARCH_INDEX_DEGRADED` (503) — بينما يبقى `GET /search/health` بـ`200`: العمليّةُ حيّةٌ وغيرُ جاهزةٍ، وهما سؤالانِ مختلفانِ |
| لا مسبارَ جاهزيّةٍ مُركَّبٌ في التطبيقِ | `SEARCH_INDEX_DEGRADED` (503) — لا تُعلَنُ الجاهزيّةُ افتراضاً بلا إثباتٍ |
| منتجٌ موقوفٌ ظهر في النتائج | خطأٌ في الفهرس — يُصلَحُ بالاستهلاكِ التاليِّ أو إعادةِ البناءِ (لا يُرجَع للمستخدمِ خطأً، بل يُزالُ من النتائجِ) |
