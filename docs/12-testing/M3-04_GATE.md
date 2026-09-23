# M3-04 — بوّابةُ الخروجِ (تحديثٌ بعد إغلاق الفجوات)

> **Work Item:** `M3-04` — Admin MVP · **كُتب بواسطة:** `CLM-0313` (M3-08) · **حدَّث:** `CLM-0321` (M3-08) · `CLM-0322` (M3-09) · **التاريخ:** 2026-09-23
>
> **الحالةُ بعد التحديث:** **Completed** — الشرطُ الثالثُ (حسمُ طبقةِ التوجيهِ العامة) مُنجَزٌ بتنفيذِ M3-09 ([`M3-09_GATE.md`](M3-09_GATE.md)): مواقعٌ ثابتةٌ منشورةٌ على staging + جدولُ توجيهٍ واحدٌ + نداءٌ حقيقيٌّ من لوحةِ الإدارةِ المنشورةِ يبلغُ خدماتِها (401 من الخدماتِ الحقيقيّة). الأربعةُ شروطٍ الأربعةُ مُنجَزة. النقلُ إلى Completed بتفويضِ المالكِ المكتوبِ في الجلسةِ (سابقةُ M3-05).
>
> **التحديثُ يقيسُ ما هو قائمٌ على `main` @ `29bf3f8` (2026-09-23T09:38Z) بعد دمج CLM-0317..CLM-0320.**

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ✅ VERIFIED  — الفحصُ 24: 0 فجوة (46/46 نداءً يطابق مسارًا قائمًا)
CI         ✅ PR        — PR #416 (CLM-0320): WASLA CI run 35842348529 success · 38/38
           ✅ main      — WASLA CI run 35844148744 success @ `29bf3f8` · وrun 35856358621 success @ `2e79737` (بعدَ دمج M3-09)
PRODUCTION ✅ VERIFIED  — لوحةُ الإدارةِ منشورةٌ (`https://wasla-admin-app.onrender.com`) ونداءاتٌ حقيقيّةٌ من منشأِها تبلغُ customers وaudit والخدماتِ الأخرى (401 من الخدمات) — M3-09_GATE.md §3
```

**طبقةُ CI على `main` — ✅ VERIFIED:** التشغيلُ [`35844148744`](https://github.com/skyosv10-art/wasla/actions/runs/35844148744) على `29bf3f8` ناجحٌ (38/38 وظيفة). والتشغيلُ [`35843498882`](https://github.com/skyosv10-art/wasla/actions/runs/35843498882) على `9cb5f93` ناجحٌ كذلك. والفجوةُ السابقةُ (تشغيلٌ عالقٌ من `bf08146`) أُصلِحَت في `CLM-0313`.

## 2. دليلُ الإغلاق المطلوب ([`ADMIN_MVP_SPEC.md`](../01-product/ADMIN_MVP_SPEC.md)) — مُحدَّث

| الدليل | القياس | الحكم |
|---|---|---|
| **audit** | §6.2 يشترط `services/audit/` وجدولَ `audit_events` append-only. **قائمٌ** (CLM-0320): `services/audit/` مع `POST /audit/events` و`GET /audit/events` و16 اختبارًا. الجدولُ append-only لا يُكشَفُ له مسارُ تعديلٍ | ✅ |
| **RBAC** | §5.2 يشترط صلاحيات `admin:*` في مصفوفة M1-05. **قائمةٌ** (CLM-0319): `customers:admin:read/suspend/reinstate` و`drivers:admin:read` في `packages/authz-policy`. وUAT-07 مُثبَتٌ في الواجهة على محاكاة | ✅ (واجهة) |
| **مساراتُ الإدارة** | `GET /customers` و`GET /customers/:id` و`POST /customers/:id/suspend\|reinstate` (CLM-0319) و`GET /drivers` (CLM-0318) كلُّها قائمة. وبادئةُ `/api/<svc>` أُزيلَت من الواجهة (CLM-0317) | ✅ |
| UAT-08 (عدمُ قابلية التدقيق للتعديل) | خدمةُ التدقيقِ لا تُكشِفُ مسارَ PUT/PATCH/DELETE — مُثبَتٌ بـ16 اختبارًا | ✅ |
| مراجعةُ الوثائق وتعليقُ السائق | `POST /drivers/:id/documents/:docId/review` و`suspend` و`reinstate` قائمةٌ في `drivers` | ✅ مسار |
| E2E + axe | وظيفةُ [`admin-portal-e2e`](https://github.com/skyosv10-art/wasla/actions/runs/35842348529/job/107121204349) نجحت على PR [#416](https://github.com/skyosv10-art/wasla/pull/416) | ✅ على محاكاة |

## 3. شرطُ العودة إلى Completed — مُحدَّث

1. ✅ خدمةُ تدقيقٍ append-only (مسارا `POST` و`GET /audit/events`) مع اختبار رفضِ التعديل — **أُنجِز (CLM-0320)**
2. ✅ مساراتُ إدارة العملاء، وقائمةُ السائقين، وصلاحياتُ `admin:*` في مصفوفة التفويض (الفحص 16) — **أُنجِز (CLM-0318 · CLM-0319)**
3. ✅ حسمُ البادئة `/api/<svc>` والطبقةُ العامةُ للتوجيه: البادئةُ أُزيلَت من الواجهة (CLM-0317)، وطبقةُ التوجيهِ أُنشئَت ونُشِرَت (M3-09 · `CLM-0322`): جدولُ توجيهٍ واحدٌ `infra/render/app-rewrites.json` + مواقعٌ ثابتةٌ منشورةٌ على Render + نداءٌ حقيقيٌّ من التطبيقِ المنشورِ يبلغُ خدمتَه ([`M3-09_GATE.md`](M3-09_GATE.md) §3)
4. ✅ حذفُ صفوف الفجوات التسعة من §4 — **أُنجِز** (الفحص 24: 0 فجوة، APP_API_ROUTES: REGISTERED_GAPS = 0)

**الخلاصة:** الأربعةُ شروطِ الأربعةِ مُنجَزةٌ (الأخيرُ بتنفيذِ M3-09). M3-04 ← **Completed**.

ويعتمد `M3-07` («Supportable operations without DB edits»، ودليلُه runbook drill) على `M3-04` — انفكَّ الحجبُ الفعليّ، فيصبحُ M3-07 وM3-06 قابلَينِ للبدء.
