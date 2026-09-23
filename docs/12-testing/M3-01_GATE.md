# M3-01 — بوّابةُ الخروجِ (تدقيقٌ رجعيٌّ)

> **Work Item:** `M3-01` — Customer Mini App · **كُتِب بواسطة:** `CLM-0313` (`M3-08`) · **التاريخ:** 2026-09-23
>
> **الحالةُ بعد التحديث:** **Completed يبقى.** دليلُ الإغلاق المطلوب في اللوحة («secure UI E2E + accessibility») قائمٌ ومقيس. وCI على `main` أصبحَ أخضر.
>
> **التحديثُ يقيسُ ما هو قائمٌ على `main` @ `29bf3f8` (2026-09-23T09:38Z) بعد دمج CLM-0317..CLM-0320.**

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ✅ VERIFIED  — الفحصُ 24: 0 فجوة (جميع النداءات تطابق مسارًا قائمًا)
CI         ✅ PR        — PR #376 (Wave 6): WASLA CI run 35684258785 success · customer-mini-app-e2e SUCCESS
           ✅ main      — WASLA CI run 35844148744 success @ `29bf3f8` (2026-09-23T09:38Z)
PRODUCTION ⚪ NOT VERIFIED — لا نشرَ للتطبيق ولا بوّابةَ توجيهٍ إلى الخدمات (M3-09)
```

**طبقةُ CI على `main` — ✅ VERIFIED:** التشغيلُ [`35844148744`](https://github.com/skyosv10-art/wasla/actions/runs/35844148744) على `29bf3f8` ناجحٌ (38/38 وظيفة). والفجوةُ السابقةُ (تشغيلٌ عالقٌ من `bf08146`) أُصلِحَت في `CLM-0313`.

## 2. دليلُ الإغلاقِ المطلوب

| الدليل | القياس | الحكم |
|---|---|---|
| secure UI E2E | [`M3-01_CUSTOMER_MINI_APP_E2E_ACCESSIBILITY.md`](M3-01_CUSTOMER_MINI_APP_E2E_ACCESSIBILITY.md): الرمزُ غائبٌ عن localStorage/sessionStorage، وBearer وIdempotency-Key موجودان على POST · وظيفةُ [`customer-mini-app-e2e`](https://github.com/skyosv10-art/wasla/actions/runs/35684258785/job/106607614350) نجحت على PR [#376](https://github.com/skyosv10-art/wasla/pull/376) | ✅ |
| accessibility | `e2e/accessibility.spec.ts` (axe-core، وسومُ WCAG 2.0 A/AA) ضمن الوظيفة نفسها | ✅ |
| وجودُ مسارات الخدمة لكلِّ نداء | الفحصُ 24 ([`APP_API_ROUTES.md`](APP_API_ROUTES.md)): صفرُ فجوةٍ للتطبيق | ✅ (أُضيف في هذا التدقيق) |

## 3. ما لم يُقَس في هذا التدقيق

- مربّعاتُ القبول في [`CUSTOMER_MINI_APP_SPEC.md`](../01-product/CUSTOMER_MINI_APP_SPEC.md) §5 كلُّها ما تزال `[ ]`. لم تُعلَّم عند الإغلاق، ولم يُعِد هذا التدقيقُ قياسها معيارًا معيارًا. من أمثلتها: زمنُ التحميل الأوّلي أقلُّ من 3 ثوانٍ، وتباينُ WCAG AA على الأجهزة الحقيقية. **لا تُعلَّم هنا.** وقياسُها معيارًا معيارًا عملُ `M3-06` (مصفوفةُ القبول).
- الوصولُ الحقيقيُّ إلى الخدمات: `createApiClient()` بـ`baseUrl` فارغ، ولا طبقةَ توجيه → `M3-09`.
