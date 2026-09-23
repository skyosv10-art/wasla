# M3-02 — بوّابةُ الخروجِ (تدقيقٌ رجعيٌّ)

> **Work Item:** `M3-02` — Driver Mini App · **كُتِب بواسطة:** `CLM-0313` (`M3-08`) · **التاريخ:** 2026-09-23
>
> **الحالةُ بعد التدقيق:** **خُفِض إلى In Progress** (STATUS_MODEL §2.7): معيارُ القبول 8 غيرُ متحقّق على أيِّ خادم.
>
> **لماذا رجعيّ:** البندُ عُلِّم `Completed` بلا ملفِّ بوّابة، وهذا خلافُ [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md) §1 (GATED شرطٌ لـCOMPLETED). هذا الملفُّ **يقيس** ما هو قائمٌ اليوم على `main` @ `a9e028f`، ولا يعيد كتابة ما قيل. وما لا يُقاس هنا يُكتب «غيرُ مقيس» ولا يُحتسب نجاحًا.

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ❌ فجوةٌ مقيسة — الفحصُ 24: 15 من 16 نداءً مختلفًا تطابق خدمة؛ GET /drivers/:id/jobs لا مسارَ له
CI         ✅ PR        — PR #391 (Wave 6): WASLA CI run 35732948700 success · driver-mini-app-e2e SUCCESS (على محاكاة)
           ⚪ main      — NOT VERIFIED (انظر أدناه)
PRODUCTION ⚪ NOT VERIFIED — لا نشرَ ولا طبقةَ توجيه (M3-09)
```

**طبقةُ CI على `main` — ⚪ NOT VERIFIED (سببٌ مقيس):** كلُّ تشغيلٍ لـ«WASLA CI» على `main` منذ `bf08146` (2026-09-22T08:54Z) بقي `pending` ثمّ أُلغي عند الدفعة التالية. السبب: التشغيلُ [`35707402954`](https://github.com/skyosv10-art/wasla/actions/runs/35707402954) علِق `queued` خمس عشرة ساعة (وظيفةُ `exit-gate-e2e (marketplace)` لم يلتقطها مُشغِّل)، فاحتجز مجموعةَ التزامن `wasla-ci-refs/heads/main`. ونتيجةُ ذلك أنّ دمجات M3-01..M3-05 كلَّها لم تحصل على حكمٍ على `main`. أُلغي التشغيلُ العالق في 2026-09-23 (`CLM-0313`)، وأوّلُ تشغيلٍ على `main` بعده هو [`35797579171`](https://github.com/skyosv10-art/wasla/actions/runs/35797579171) (`a9e028f`). وأحكامُ فروع PR أدناه حقيقيّةٌ، لكنّها ليست حكمَ `main`.

## 2. معاييرُ القبول ([`DRIVER_MINI_APP_SPEC.md`](../01-product/DRIVER_MINI_APP_SPEC.md) §10)

| # | المعيار | القياس | الحكم |
|---|---|---|---|
| 2 | تبديلُ التوفّر | `PUT /drivers/:id/availability` قائمٌ في `drivers` | ✅ مسار |
| 3 | قبولُ العروض ورفضُها | `POST /dispatch/offers/:id/accept\|reject` قائمان | ✅ مسار |
| 4 | انتقالاتُ حالة الطلب | `POST /orders/:id/transitions` قائم | ✅ مسار |
| 5–7 | المركباتُ والمناطقُ والوثائق | كلُّ نداءاتها تطابق `drivers` | ✅ مسار |
| **8** | **الأرباحُ وسجلُّ المهام** | **`GET /drivers/:id/jobs?status=completed&period=…` (`src/store/earnings.ts`) لا مسارَ له في `drivers` ولا في `dispatch`**. والشاشةُ خضراءُ في E2E لأنّ النداءَ مُحاكى | ❌ |
| 10–12 | E2E وaxe ومنعُ التخزين | وظيفةُ [`driver-mini-app-e2e`](https://github.com/skyosv10-art/wasla/actions/runs/35732948700/job/106763323427) نجحت على PR [#391](https://github.com/skyosv10-art/wasla/pull/391) | ✅ على محاكاة |
| 1، 9 | الشاشاتُ التسع وi18n | غيرُ مُعاد القياس هنا | ⚪ |

## 3. شرطُ العودة إلى Completed

يُبنى `GET /drivers/:id/jobs` (أو يُعاد توجيهُ الشاشة إلى مسارٍ قائم)، ويُحذف صفُّه من [`APP_API_ROUTES.md`](APP_API_ROUTES.md) §4. البابُ 3 يُلزم بحذف الصفّ، والبابُ 4 يمنع إعلانَ Completed قبل ذلك.
