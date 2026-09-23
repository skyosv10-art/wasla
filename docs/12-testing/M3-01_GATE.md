# M3-01 — بوّابةُ الخروجِ (تدقيقٌ رجعيٌّ)

> **Work Item:** `M3-01` — Customer Mini App · **كُتِب بواسطة:** `CLM-0313` (`M3-08`) · **التاريخ:** 2026-09-23
>
> **الحالةُ بعد التدقيق:** **Completed يبقى.** دليلُ الإغلاق المطلوب في اللوحة («secure UI E2E + accessibility») قائمٌ ومقيس. ولا يُدّعى هنا إنتاجٌ: راجع §1 طبقة PRODUCTION.
>
> **لماذا رجعيّ:** البندُ عُلِّم `Completed` بلا ملفِّ بوّابة، وهذا خلافُ [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md) §1 (GATED شرطٌ لـCOMPLETED). هذا الملفُّ **يقيس** ما هو قائمٌ اليوم على `main` @ `a9e028f`، ولا يعيد كتابة ما قيل. وما لا يُقاس هنا يُكتب «غيرُ مقيس» ولا يُحتسب نجاحًا.

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ✅ VERIFIED  — الفحصُ 24: 13/13 نداءً مختلفًا يطابق مسارًا قائمًا في customers · marketplace · reputation · search
CI         ✅ PR        — PR #376 (Wave 6): WASLA CI run 35684258785 success · customer-mini-app-e2e SUCCESS
           ⚪ main      — NOT VERIFIED (انظر أدناه)
PRODUCTION ⚪ NOT VERIFIED — لا نشرَ للتطبيق ولا بوّابةَ توجيهٍ إلى الخدمات (M3-09)
```

**طبقةُ CI على `main` — ⚪ NOT VERIFIED (سببٌ مقيس):** كلُّ تشغيلٍ لـ«WASLA CI» على `main` منذ `bf08146` (2026-09-22T08:54Z) بقي `pending` ثمّ أُلغي عند الدفعة التالية. السبب: التشغيلُ [`35707402954`](https://github.com/skyosv10-art/wasla/actions/runs/35707402954) علِق `queued` خمس عشرة ساعة (وظيفةُ `exit-gate-e2e (marketplace)` لم يلتقطها مُشغِّل)، فاحتجز مجموعةَ التزامن `wasla-ci-refs/heads/main`. ونتيجةُ ذلك أنّ دمجات M3-01..M3-05 كلَّها لم تحصل على حكمٍ على `main`. أُلغي التشغيلُ العالق في 2026-09-23 (`CLM-0313`)، وأوّلُ تشغيلٍ على `main` بعده هو [`35797579171`](https://github.com/skyosv10-art/wasla/actions/runs/35797579171) (`a9e028f`). وأحكامُ فروع PR أدناه حقيقيّةٌ، لكنّها ليست حكمَ `main`.

## 2. دليلُ الإغلاقِ المطلوب

| الدليل | القياس | الحكم |
|---|---|---|
| secure UI E2E | [`M3-01_CUSTOMER_MINI_APP_E2E_ACCESSIBILITY.md`](M3-01_CUSTOMER_MINI_APP_E2E_ACCESSIBILITY.md): الرمزُ غائبٌ عن localStorage/sessionStorage، وBearer وIdempotency-Key موجودان على POST · وظيفةُ [`customer-mini-app-e2e`](https://github.com/skyosv10-art/wasla/actions/runs/35684258785/job/106607614350) نجحت على PR [#376](https://github.com/skyosv10-art/wasla/pull/376) | ✅ |
| accessibility | `e2e/accessibility.spec.ts` (axe-core، وسومُ WCAG 2.0 A/AA) ضمن الوظيفة نفسها | ✅ |
| وجودُ مسارات الخدمة لكلِّ نداء | الفحصُ 24 ([`APP_API_ROUTES.md`](APP_API_ROUTES.md)): صفرُ فجوةٍ للتطبيق | ✅ (أُضيف في هذا التدقيق) |

## 3. ما لم يُقَس في هذا التدقيق

- مربّعاتُ القبول في [`CUSTOMER_MINI_APP_SPEC.md`](../01-product/CUSTOMER_MINI_APP_SPEC.md) §5 كلُّها ما تزال `[ ]`. لم تُعلَّم عند الإغلاق، ولم يُعِد هذا التدقيقُ قياسها معيارًا معيارًا. من أمثلتها: زمنُ التحميل الأوّلي أقلُّ من 3 ثوانٍ، وتباينُ WCAG AA على الأجهزة الحقيقية. **لا تُعلَّم هنا.** وقياسُها معيارًا معيارًا عملُ `M3-06` (مصفوفةُ القبول).
- الوصولُ الحقيقيُّ إلى الخدمات: `createApiClient()` بـ`baseUrl` فارغ، ولا طبقةَ توجيه → `M3-09`.
