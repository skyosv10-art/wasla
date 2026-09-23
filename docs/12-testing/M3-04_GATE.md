# M3-04 — بوّابةُ الخروجِ (تدقيقٌ رجعيٌّ)

> **Work Item:** `M3-04` — Admin MVP · **كُتِب بواسطة:** `CLM-0313` (`M3-08`) · **التاريخ:** 2026-09-23
>
> **الحالةُ بعد التدقيق:** **خُفِض إلى In Progress** (STATUS_MODEL §2.7): دليلُ الإغلاق «RBAC + audit + UAT» قائمٌ في الواجهة على محاكاة، **وغائبٌ في الخلفية**.
>
> **لماذا رجعيّ:** البندُ عُلِّم `Completed` بلا ملفِّ بوّابة، وهذا خلافُ [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md) §1 (GATED شرطٌ لـCOMPLETED). هذا الملفُّ **يقيس** ما هو قائمٌ اليوم على `main` @ `a9e028f`، ولا يعيد كتابة ما قيل. وما لا يُقاس هنا يُكتب «غيرُ مقيس» ولا يُحتسب نجاحًا.

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ❌ فجوةٌ مقيسة — الفحصُ 24: 9 من 14 نداءً مختلفًا بلا مسار
CI         ✅ PR   — PR #402 (Wave 4): WASLA CI run 35784610325 success · admin-portal-e2e SUCCESS (على محاكاة)
           ⚪ main — NOT VERIFIED (انظر أدناه)
PRODUCTION ⚪ NOT VERIFIED — لا خدمةَ تدقيق، ولا نشرَ، ولا طبقةَ توجيه
```

**طبقةُ CI على `main` — ⚪ NOT VERIFIED (سببٌ مقيس):** كلُّ تشغيلٍ لـ«WASLA CI» على `main` منذ `bf08146` (2026-09-22T08:54Z) بقي `pending` ثمّ أُلغي عند الدفعة التالية. السبب: التشغيلُ [`35707402954`](https://github.com/skyosv10-art/wasla/actions/runs/35707402954) علِق `queued` خمس عشرة ساعة (وظيفةُ `exit-gate-e2e (marketplace)` لم يلتقطها مُشغِّل)، فاحتجز مجموعةَ التزامن `wasla-ci-refs/heads/main`. ونتيجةُ ذلك أنّ دمجات M3-01..M3-05 كلَّها لم تحصل على حكمٍ على `main`. أُلغي التشغيلُ العالق في 2026-09-23 (`CLM-0313`)، وأوّلُ تشغيلٍ على `main` بعده هو [`35797579171`](https://github.com/skyosv10-art/wasla/actions/runs/35797579171) (`a9e028f`). وأحكامُ فروع PR أدناه حقيقيّةٌ، لكنّها ليست حكمَ `main`.

## 2. دليلُ الإغلاق المطلوب ([`ADMIN_MVP_SPEC.md`](../01-product/ADMIN_MVP_SPEC.md))

| الدليل | القياس | الحكم |
|---|---|---|
| **audit** | §6.2 يشترط `services/audit/` وجدولَ `audit_events` append-only. **المجلّدُ محذوف** (`96928bd`: «Audit service deferred to Wave 3»)، ولم يُبنَ في Wave 3 ولا Wave 4. والشاشةُ تنادي `GET /api/audit/audit/events` ولا مسارَ له | ❌ |
| **RBAC** | §5.2 يشترط صلاحيات `admin:*` في مصفوفة M1-05، ولا وجودَ لـ`admin:` في `packages/authz-policy/src`. أمّا UAT-07 (403 لمشغّلٍ على إدارة الفريق) فمُثبَتٌ في الواجهة على محاكاة، لا على خادمٍ يرفض | ❌ |
| **مساراتُ الإدارة** | `GET /customers` و`GET /customers/:id` و`POST /customers/:id/suspend\|reinstate` و`GET /drivers` (قائمة) كلُّها غائبة. و`/api/orders/orders/…` بادئةٌ لا تحذفها طبقة، مع أنّ `GET /orders/:id` و`/history` و`/lookup` قائمةٌ في `orders` | ❌ (9 فجوات في [`APP_API_ROUTES.md`](APP_API_ROUTES.md) §4) |
| UAT-08 (عدمُ قابلية التدقيق للتعديل) | لا خدمةَ تُسأل | ❌ |
| مراجعةُ الوثائق وتعليقُ السائق | `POST /drivers/:id/documents/:docId/review` و`suspend` و`reinstate` قائمةٌ في `drivers` | ✅ مسار |
| E2E + axe | وظيفةُ [`admin-portal-e2e`](https://github.com/skyosv10-art/wasla/actions/runs/35784610325/job/106938241898) نجحت على PR [#402](https://github.com/skyosv10-art/wasla/pull/402) | ✅ على محاكاة |

## 3. شرطُ العودة إلى Completed

1. خدمةُ تدقيقٍ append-only (مسارا `POST` و`GET /audit/events`) مع اختبار رفضِ التعديل على قاعدة حقيقية.
2. مساراتُ إدارة العملاء، وقائمةُ السائقين، وصلاحياتُ `admin:*` في مصفوفة التفويض (الفحص 16).
3. حسمُ البادئة `/api/<svc>`: إمّا طبقةٌ تحذفها (`M3-09`)، وإمّا إزالتُها من الواجهة.
4. حذفُ صفوفها التسعة من §4. والبابان 3 و4 يُنفِذان هذا الشرط آليًّا.

ويعتمد `M3-07` («Supportable operations without DB edits»، ودليلُه runbook drill) على `M3-04`، فيبقى محجوبًا فعليًّا حتى تتحقّق هذه الشروط.
