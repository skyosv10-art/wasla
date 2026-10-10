# قوائم سماح حدّ القناة (edge-allowlist) — الحارس 28

**الحالة:** إلزامي · مُفرَض آليًا عبر `scripts/checks/verify-governance.sh` (الفحص 28) · **نشأ:** `2026-10-10` (`CLM-0521` · ADR-069 §6-2 المرحلة 2 الجزء 1)

> **الغرض:** أن تكون قائمة مسارات حدّ القناة (`packages/channel-edge/allowlist/<surface>.json`) تابعةً للشفرة الفعلية ولقرار ADR-069 §2.8 في كل لحظة، لا وثيقةً حرةً تنحرف بلا حارس. القوائم هي الصيغة القياسية التي سيقرؤها حدّ القناة نفسه (الجزء الثاني من المرحلة 2 — حزمة `channel-edge`)، والحارس يُثبِت أنها لا تكذب قبل أن يُبنى الحدّ.

## 1. الأبواب الخمسة (أ–هـ)

الحارس `edge-allowlist-guard` (الفحص 28) يُسقِط الدفعة إذا:

| الباب | ما يُسقِط الدفعة |
| --- | --- |
| **أ** | مدخل `production_open: true` لفئة `W` أو `N` أو `ADM` (أو `P` بلا `blocked_until` ودليل) — فئات محجوبة حتى G-ENF/حارس مختبر/المرحلة 4 لا تُفتح |
| **ب** | فئة مدخل تخالف تصنيف المستقبل المقيس من الشفرة (`ownerScoped`/`assertedStaff`/`assertedDriver`/`scoped`/`internalScoped`) — مع تسامح مُعلن: `P` تُقبل على مستقبلٍ `scoped`/`internalScoped` بشرط `blocked_until` |
| **ج** | `evidence_tests` غائبة أو تشير إلى ملف/حالة غير موجودة في المستودع |
| **د** | المسار لا يناديه التطبيق في الفحص 24 (`app_api_routes.py`) |
| **هـ** | المدخل خارج لقطة `route-enforcement.json` التاريخية (`ci-evidence/2026-10-09T140000Z-clm-0518-human-auth-adr/`) — لقطة تصنيف لا مصدر حقيقة، فالانحراف عنها قرار يحتاج تعليلًا |

## 2. صيغة المدخل

```json
{
  "method": "GET",
  "path": "/customers/:waslaPublicId/profile",
  "service": "customers",
  "class": "O",
  "required_scopes": ["customers:profile:read"],
  "production_open": false,
  "evidence_tests": [{ "file": "…", "case": "…" }],
  "blocked_until": "…"
}
```

- `class` حرفيًا من ADR-069 §2.8: `O` · `P` · `W` · `N` · `ADM`.
- `production_open: true` مسموحة لـ`O` (مع `evidence_tests` غير فارغة) و`P` (بعد دليل E-20). الحالة الحالية: **كل المدخلات `false` عمدًا** — فتح `O` يتطلب حالات E-18/E-19 على المستقبل في `off` ضمن `app-edge-e2e` (لم تُكتب بعد).
- `blocked_until` مطلوبة لكل مدخل غير `O` — سبب الحجب مسجّل في القائمة نفسها.
- `required_scopes` تُقاس من `services/<svc>/src/http/service-identity.ts` — لا تُخترع.

## 3. الحالة المقيسة عند النشأة (2026-10-10)

- سطحان: `customer-mini-app` (13 مدخلًا) · `driver-mini-app` (16 مدخلًا). المجموع 29 = نفس حصيلة ADR-069 §2.8 (O 19 · P 2 · W 3 · N 5) — مع حذف `PUT /drivers/:waslaPublicId/availability` لأن التطبيق لا يناديه أصلًا (R-02 PARTIAL، لا نداء `PUT` من التطبيق) فلا يدخل قائمة الحدّ حتى يُبنى النداء.
- 6 اختبارات طفرة في `scripts/checks/lib/gov-cases-edge-allowlist.sh` (باب لكل طفرة + استعادة) تعمل ضمن `scripts/checks/test-governance.sh`.

## 4. حدود معلنة

- الحارس يقرأ الشفرة بـregex (نمط `app.<method>(\n?"path", {\n config: <guard>(`) — تغيير صيغة التسجيل في الخدمات يُسقِط الحارس (فشلٌ صادق لا تجميل).
- لقطة `route-enforcement.json` **تاريخية**: تحديثها قرار موثق (بند مالك)، لا أن يُحدَّث الملف تلقائيًا فيمسح الحارس انحرافًا حقيقيًا.

## 5. العلاقة بالمراحل

- **المرحلة 2 الجزء 1 (هذه):** صيغة + حارس + طفرات. لا مسارات حدّ ولا تركيب بوتات ولا توصيل تطبيقات.
- **المرحلة 2 الجزء 2 (مطالبة مستقلة):** حزمة `channel-edge` (Fastify plugin) تقرأ هذه القوائم، تركيبها في البوتين، تهيئة `main.tsx`، حزمة `app-edge-e2e`.
- **المرحلة 3/4/5:** بقرار مالك مستقل حرفيًا (ADR-069 §6).
