# M3-02 — بوّابةُ الخروجِ (تحديثٌ بعد إغلاق الفجوة)

> **Work Item:** `M3-02` — Driver Mini App · **كُتب بواسطة:** `CLM-0313` (M3-08) · **حدَّث:** `CLM-0321` (M3-08) · **التاريخ:** 2026-09-23
>
> **الحالةُ بعد التحديث:** **Completed يُعاد.** معيارُ القبول 8 (الأرباحُ وسجلُّ المهام) تحقَّق — `GET /orders/drivers/:driverPublicId/jobs` أُضيف (CLM-0316 · PR #408 · squash `a659fbc`)، والفجوةُ في الفحصِ 24 أُغلِقَت. وCI على `main` أصبحَ أخضر.
>
> **التحديثُ يقيسُ ما هو قائمٌ على `main` @ `29bf3f8` (2026-09-23T09:38Z).**

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ✅ VERIFIED  — الفحصُ 24: 0 فجوة (جميع النداءات تطابق مسارًا قائمًا)
CI         ✅ PR        — PR #391 (Wave 6): WASLA CI run 35732948700 success · driver-mini-app-e2e SUCCESS
           ✅ main      — WASLA CI run 35844148744 success @ `29bf3f8` (2026-09-23T09:38Z)
PRODUCTION ⚪ NOT VERIFIED — لا نشرَ ولا طبقةَ توجيه (M3-09)
```

**طبقةُ CI على `main` — ✅ VERIFIED:** التشغيلُ [`35844148744`](https://github.com/skyosv10-art/wasla/actions/runs/35844148744) على `29bf3f8` ناجحٌ (38/38 وظيفة). والفجوةُ السابقةُ (تشغيلٌ عالقٌ من `bf08146`) أُصلِحَت في `CLM-0313`.

## 2. معاييرُ القبول ([`DRIVER_MINI_APP_SPEC.md`](../01-product/DRIVER_MINI_APP_SPEC.md) §10) — مُحدَّث

| # | المعيار | القياس | الحكم |
|---|---|---|---|
| 2 | تبديلُ التوفّر | `PUT /drivers/:id/availability` قائمٌ في `drivers` | ✅ مسار |
| 3 | قبولُ العروض ورفضُها | `POST /dispatch/offers/:id/accept\|reject` قائمان | ✅ مسار |
| 4 | انتقالاتُ حالة الطلب | `POST /orders/:id/transitions` قائم | ✅ مسار |
| 5–7 | المركباتُ والمناطقُ والوثائق | كلُّ نداءاتها تطابق `drivers` | ✅ مسار |
| **8** | **الأرباحُ وسجلُّ المهام** | **`GET /orders/drivers/:driverPublicId/jobs` أُضيف (CLM-0316 · PR #408 · squash `a659fbc`)، والصفُّ حُذف من APP_API_ROUTES §4** | ✅ |
| 10–12 | E2E وaxe ومنعُ التخزين | وظيفةُ [`driver-mini-app-e2e`](https://github.com/skyosv10-art/wasla/actions/runs/35842348529/job/107121204642) نجحت على PR [#416](https://github.com/skyosv10-art/wasla/pull/416) | ✅ على محاكاة |
| 1، 9 | الشاشاتُ التسع وi18n | غيرُ مُعاد القياس هنا | ⚪ |

## 3. شرطُ العودة إلى Completed — مُنجَز

`GET /orders/drivers/:driverPublicId/jobs` بُني (CLM-0316)، وصفُّ الفجوةِ حُذف من [`APP_API_ROUTES.md`](APP_API_ROUTES.md) §4 (0 فجوة). والبابُ 3 والبابُ 4 مُستوفَيان.
