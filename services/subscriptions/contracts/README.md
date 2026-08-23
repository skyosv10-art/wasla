# عقود خدمة اشتراك السائق والإحالة — `services/subscriptions/contracts`

> **الطور:** 10 — Driver Subscription & Referral
> **المرجع الحاكم:** [ADR-015](../../../docs/15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md)
> **وثيقة المجال:** [`docs/03-domain/DRIVER_SUBSCRIPTION_REFERRAL.md`](../../../docs/03-domain/DRIVER_SUBSCRIPTION_REFERRAL.md)
> **المنفذ:** `8093`

---

## ما هذا المجلد

عقود الخدمة **قبل** أي تنفيذ. لا كود خدمة في هذا الطور بعد: المراجعة 1/6 عقود ووثائق
وحزمة أنواع فقط، ولا `src/` في `services/subscriptions`. والملفات الخمسة هي مصدر الحقيقة
لما يبنى لاحقاً:

| الملف | ما يحكمه | من يقرؤه |
|---|---|---|
| `schema.sql` | عشرة جداول: الخطط وامتيازاتها، الحالة ودفتر مددها وانتقالاتها، رموز الإحالة ومطالباتها ومكافآتها، سجل المفاتيح، وصندوق الصادر | طبقة الاستمرارية وحرّاس الانحراف |
| [`api.openapi.yml`](api.openapi.yml) | أحد عشر مساراً فريداً واثنتا عشرة عملية على المنفذ 8093 | طبقة HTTP ومولّد الأنواع |
| `events.json` | ستة أحداث بمنتج واحد `subscriptions-service` | مستهلكو الأحداث |
| `errors.md` | سبعة عشر رمز خطأ في خمسة أصناف | كل مستهلك يتعاقد على `error.code` |
| [`README.md`](README.md) | حدّ العقد وملكيته وحرّاس انحرافه | فريق Phase 10 وكل مراجع للعقد |

---

## العقد أولاً ([ADR-004](../../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md))

الأنواع تُولّد من العقد ولا تُكتب بيد ثانية:

```bash
pnpm --filter @wasla/contracts-subscription generate   # openapi-typescript → src/api-types.ts
```

حرّاس الانحراف في `packages/contracts/subscription/src/__tests__` يقرأون هذه العقود من
القرص. لا تُسجل هنا أرقام اختبارات أو نتائج قياس؛ لم تُقَس بعد.

| الحارس | ما يثبته |
|---|---|
| `contracts.test.ts` | أكواد `errors.md` وأصنافها ورموز HTTP = الثوابت · مسارات OpenAPI = `SUBSCRIPTION_API_PATHS` · المنفذ في `servers` = `SUBSCRIPTION_SERVICE_PORT` · لا `502` |
| `events.test.ts` | الأحداث الستة بأسمائها ومنتج واحد · `occurred_for` و`additionalProperties: false` في كل حدث · لا حقل محظور ولا حدث رفض |
| `schema.test.ts` | الجداول العشرة بأسمائها · التعدادات = الثوابت حرفاً · القيود المسماة موجودة · جدول الانتقالات بلا `active → active` |
| `boundary.test.ts` | لا مال ولا FK عابر · لا هاتف ولا اسم ولا معرّف قناة · لا نص حر · المنفذ 8093 لا يصطدم بطور سابق · `community` لا تقترن بحجب أو إيقاف |

---

## من يملك ماذا

| الحقيقة | مالكها | كيف تصل هنا أو تبقى خارجه |
|---|---|---|
| هوية السائق والعميل وأهليته وإيقافه | `services/drivers` | `WS-##########` opaque فقط؛ لا FK ولا قرار إيقاف صادر من هنا |
| وقائع السمعة للمحال | `services/reputation` ([ADR-014](../../../docs/15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md)) | حدث أو قراءة، لا استعلام في قاعدة السمعة ولا نسخ لمنطقها |
| الخطة والامتيازات والمدد والحالة والانتقالات | `services/subscriptions` | تُحفظ وتُشتق وتُعاد هنا |
| رمز الإحالة ومطالبتها وتأهيلها ومكافأتها | `services/subscriptions` | المكافأة مدّة من دفتر هذه الخدمة |
| السعر والفاتورة والدفع والاسترداد | Phase 17 (Billing) | `payment_reference` opaque فقط؛ لا مبلغ أو سعر هنا |
| تشغيل الزمن | مشغّل خارجي | يستدعي `POST /subscriptions/tick`؛ لا مؤقّت داخل الخدمة |

---

## الحدود الملزمة

1. **خدمة واحدة لا خدمتان.** `services/subscriptions` يملك الاشتراك والإحالة، و
   `services/referrals/` يبقى فارغاً؛ المكافأة مدّة لا معاملة موزعة.
2. **المدّة تُخزّن والحالة تُشتق.** `subscription_periods` append-only، و
   `subscriptions` صف متحقق يعاد بـ`POST /subscriptions/{driverPublicId}/recompute`.
   حذف الحالة ثم إعادة بنائها من الدفتر عمل بلا خسارة.
3. **أربع حالات فقط.** `trial` · `active` · `expired` · `community`، بالأسباب
   `trial_granted` · `payment_activated` · `referral_reward_applied` · `period_ended` ·
   `community_grace_ended`. التجديد مدّة لا انتقال.
4. **`community` ليست عقوبة.** يبقى `accept_orders` بسقف يومي، ولا حجب ولا إيقاف ولا
   سعر مختلف.
5. **الزمن نبضة لا مؤقّت.** `POST /subscriptions/tick` وحده يحقق الانقضاء والمهلة؛
   الانقضاء مشتق من `ends_at ≤ now` وتعلن القراءة `is_stale`.
6. **لا مال في العقد.** لا `amount` ولا `amount_minor` ولا `currency` ولا `price` ولا
   `invoice` ولا `refund` في جدول أو حمولة؛ مرجع الدفع opaque بطول ≤64 فقط.
7. **الخطة مجمّدة ومُنسّخة.** `(plan_code, plan_version)` مفتاحها، و`is_frozen` شرط
   استعمالها، وكل مشتق يحمل `plan_version`.
8. **الإحالة تؤهّل بوقائع لا بتسجيل.** حالاتُها `pending` · `qualified` · `rewarded` ·
   `rejected`، ورفضها سبب من قائمة مغلقة.
9. **المكافأة مرة واحدة وفي الدفتر نفسه.** `referral_rewards` صف واحد للإحالة، ومنحتها
   `subscription_periods.source = 'referral_reward'` لا عداد أيام منفصل.

---

## سطح العقد الثابت

| المجال | القيم الملزمة |
|---|---|
| الحالات | `SUBSCRIPTION_STATES = ["trial","active","expired","community"]` |
| أسباب الانتقال | `SUBSCRIPTION_TRANSITION_REASONS = ["trial_granted","payment_activated","referral_reward_applied","period_ended","community_grace_ended"]` |
| مصادر المدّة | `SUBSCRIPTION_PERIOD_SOURCES = ["trial","payment","referral_reward"]` |
| الامتيازات | `SUBSCRIPTION_ENTITLEMENTS = ["accept_orders","daily_order_cap","priority_dispatch","zone_multi_select"]` |
| حالات الإحالة | `REFERRAL_STATES = ["pending","qualified","rewarded","rejected"]` |
| أسباب الرفض | `REFERRAL_REJECTION_REASONS = ["self_referral","referrer_not_active","referee_already_referred","referee_no_qualifying_facts","referral_window_expired","referee_subscription_never_activated"]` |
| ثوابت الإطلاق | `SUBSCRIPTION_LAUNCH_PLAN_CODE = "saudi-driver-monthly"` · `SUBSCRIPTION_LAUNCH_PLAN_VERSION = 1` · `trial_days = 14` · `duration_days = 30` · `community_grace_days = 7` · `REFERRAL_REWARD_DAYS = 30` · `REFERRAL_QUALIFYING_FACT_COUNT = 5` · `REFERRAL_WINDOW_DAYS = 30` |
| المنفذ والرمز | `SUBSCRIPTION_SERVICE_PORT = 8093` · `^WR-[0-9A-Z]{8}$` |

أكواد الخطأ السبعة عشر موزعة على: 400
`SUBSCRIPTION_VALIDATION_FAILED` · `SUBSCRIPTION_IDEMPOTENCY_KEY_REQUIRED` ·
`SUBSCRIPTION_FILTER_REQUIRED`؛ 404 `SUBSCRIPTION_NOT_FOUND` ·
`SUBSCRIPTION_PLAN_NOT_FOUND` · `REFERRAL_CODE_NOT_FOUND`؛ 409
`SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED` · `SUBSCRIPTION_ALREADY_EXISTS` ·
`SUBSCRIPTION_TRANSITION_NOT_ALLOWED` · `REFERRAL_REFEREE_ALREADY_REFERRED` ·
`REFERRAL_REWARD_ALREADY_GRANTED`؛ 422 `SUBSCRIPTION_PLAN_NOT_FROZEN` ·
`SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED` · `REFERRAL_SELF_FORBIDDEN` ·
`REFERRAL_WINDOW_CLOSED` · `REFERRAL_REFEREE_NOT_QUALIFIED`؛ و503
`SUBSCRIPTION_UNAVAILABLE`.

---

## ما ليس هنا

كود خدمة أو `src/` · خدمة `services/referrals` أو عقد لها · سعر أو مبلغ أو فاتورة أو
استرداد (Phase 17) · هوية أو هاتف أو اسم أو معرّف قناة · FK عابر لحد خدمة · حجب أو
إيقاف أو عقوبة · `cancelled` أو `suspended` · مؤقّت داخلي · نص حر · حدث رفض · ناشر
صندوق الصادر · واجهة مستخدم.

---

> **Scope:** عقود `services/subscriptions` في Phase 10، للمراجعة 1/6 (عقود ووثائق وحزمة أنواع فقط).
>
> **Last Updated:** 2026-08-23
>
> **Status:** Accepted — لا كود خدمة ضمن هذا النطاق.
>
> **Related Code:** `services/subscriptions/contracts/` · `packages/contracts/subscription/` · `services/referrals/.gitkeep` (تبقى فارغةً بقرار — لا كودَ فيها، كسابقة `services/fraud/` في الطور 09)
>
> **Related Team:** Team 03 — Driver (مالك `services/subscriptions/` و`services/referrals/` في [CODEOWNERS](../../../CODEOWNERS)) · Team 01 — Identity (مُشارِك في `services/referrals/`) · Team 09 — Data (وقائع السمعة مصدرُ التأهيل)
