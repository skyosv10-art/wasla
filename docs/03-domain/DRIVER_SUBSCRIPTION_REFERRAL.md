# نموذج مجال اشتراك السائق والإحالة — Driver Subscription & Referral

> **الطور:** 10 · **القرار الحاكم:** [ADR-015](../15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md)
> **العقود الكنسية:** [`services/subscriptions/contracts/`](../../services/subscriptions/contracts/README.md)
> **المنفذ:** `8093` · **الحزمة:** `@wasla/subscriptions-service`
> **الحالة:** عقود كنسية فقط (MR 1/6) — لا `src/` بعد

---

## 1. الحدّ في سطر واحد

> **تملك الاشتراكات «أي مدّة مُنحت وأي امتياز يترتب عليها»، وتملك الإحالة «متى تتحول واقعةُ عمل إلى منحة مدّة»؛ ولا تملك المال أو العقوبة أو الهوية.**

بوابة الخروج هي جملتان منفصلتان لا شعار واحد:

1. **«Trial → Active → Expired → Community»** دورة حياة اشتراك بأربع حالات وانتقالات
   معلنة؛ التجديد مدّة جديدة لا انتقال، و`community` أرضية لا نهاية.
2. **«الإحالاتُ لا تكافئ النشاطَ المُصطنع»** قاعدة اقتصاد: التأهيل لا يحدث بالتسجيل،
   بل بخمس وقائع سمعة مسجلة للمحال خلال نافذة ثلاثين يوماً.

لا تعبر هذا الحد إلا مُعرّفات `WS-##########` opaque. فلا هاتف ولا اسم ولا معرّف قناة،
ولا FK عابر، ولا قراءة مباشرة في مخزن خدمة أخرى.

---

## 2. المفاهيم الستة

| المفهوم | ما هو | ما ليس هو |
|---|---|---|
| **الخطة** `subscription_plans` | كتالوج نسخة مجمّدة بمفتاح `(plan_code, plan_version)` | ليست سعراً ولا فاتورة؛ لا عمود مال |
| **الامتياز** `subscription_plan_entitlements` | قدرة خطة وحدّها؛ `-1` في `limit_value` بلا سقف | ليس قرار أهلية أو عقوبة |
| **المدّة** `subscription_periods` | صف append-only لتجربة أو دفع أو مكافأة إحالة | ليست عداداً قابلاً للزيادة أو التعديل |
| **الحالة** `subscriptions` | صف متحقق مشتق من الدفتر، يعاد بناؤه | ليست مصدر الحقيقة ولا `UPDATE` يدوي |
| **الانتقال** `subscription_transitions` | أثر زمني للحركة بسبب معلوم وتسلسل معلوم | ليس تجديداً؛ لا `active → active` |
| **الإحالة والمكافأة** `referrals` و`referral_rewards` | مطالبة، تأهيل بوقائع، ثم منحة أيام مرة واحدة | ليست مكافأة تسجيل ولا رصيداً مستقلاً |

---

## 3. دورة الحياة

```text
POST /subscriptions
  idempotency-key + {driver_public_id, plan_code, plan_version, requested_at}
        │
        ▼
trial_granted ──► trial ── period_ended ──► expired ── community_grace_ended ──► community
                     │                         │                                      │
                     └── payment_activated أو referral_reward_applied ────────────────┤
                                               │                                      │
                                               └── payment_activated أو referral_reward_applied ─► active

active ── period_ended ──► expired
active + مدّة دفع جديدة ──► active  (تجديد في الدفتر، لا انتقال)
community + مدّة دفع/إحالة ──► active
```

| من | إلى | السبب | ما يُسجّل |
|---|---|---|---|
| `∅` | `trial` | `trial_granted` | مدّة `trial` وانتقال الإنشاء |
| `trial` | `active` | `payment_activated` أو `referral_reward_applied` | مدّة دفع أو مكافأة وانتقال |
| `trial` | `expired` | `period_ended` | انتقال انقضاء |
| `active` | `expired` | `period_ended` | انتقال انقضاء |
| `expired` | `active` | `payment_activated` أو `referral_reward_applied` | مدّة وانتقال |
| `expired` | `community` | `community_grace_ended` | انتقال مهلة المجتمع |
| `community` | `active` | `payment_activated` أو `referral_reward_applied` | مدّة وانتقال |

الحالات هي `trial` · `active` · `expired` · `community` فقط. لا `cancelled` ولا
`suspended` في Phase 10. وفي `community` يبقى `accept_orders` بسقف يومي؛ لا حجب ولا
إيقاف ولا سعر مختلف، لأن فقدان الامتياز المدفوع ليس عقوبة.

---

## 4. دفتر المدّات وكتالوج الخطة

الخطة صالحة للاستعمال فقط إذا كانت `is_frozen`. خطة الإطلاق
`saudi-driver-monthly` بالنسخة `1`: `trial_days = 14` و`duration_days = 30` و
`community_grace_days = 7`. وكل صف مشتق يحمل `plan_version` كي لا يعيد تعديل خطة اليوم
تفسير أيام الأمس.

| المصدر `source` | `payment_reference` | `granted_days` | المعنى |
|---|---|---|---|
| `trial` | فارغ | موجب | منحة التجربة |
| `payment` | غير فارغ، opaque، ≤64 | موجب | تفعيل مدّة؛ المرجع ليس مبلغاً ولا فاتورة |
| `referral_reward` | فارغ | موجب | مكافأة إحالة من الدفتر نفسه |

`ends_at > starts_at` دائماً، ووجود `payment_reference` غير الفارغ **إن وفقط إن** كان
`source = 'payment'`. الانقضاء يُشتق من `ends_at ≤ now`، وصف الحالة المعلن قبل النبضة
يحمل `is_stale`؛ لذلك لا تعرض القراءة يقيناً زائفاً.

---

## 5. مسار الإحالة

```text
رمز WR-XXXXXXXX + POST /referrals
        │
        ▼
pending ── فحص نافذة الإحالة ووقائع السمعة ──► qualified
  │                                                │
  └──── سبب رفض من القائمة المغلقة ──► rejected    └──► rewarded
                                                          │
                                                          ▼
                                              referral_rewards (مرة واحدة)
                                                          │
                                                          ▼
                                  subscription_periods.source = referral_reward
```

رمز الإحالة يطابق `^WR-[0-9A-Z]{8}$`، وله مالك واحد. ولكل محال مطالبة واحدة، ولا يصح
أن يساوي `referrer_public_id` `referee_public_id`. التأهيل يستهلك وقائع
`reputation_facts` عبر حدث أو قراءة، لا عبر FK؛ والعدد المطلوب
`REFERRAL_QUALIFYING_FACT_COUNT = 5`، والنافذة `REFERRAL_WINDOW_DAYS = 30`، والمكافأة
`REFERRAL_REWARD_DAYS = 30`.

| الحالة | معناها | المخرج |
|---|---|---|
| `pending` | المطالبة سُجلت ولم تحسم | انتظار التأهيل أو الرفض |
| `qualified` | وقائع المحال حققت العتبة داخل النافذة | مؤهلة لمنحة الأيام |
| `rewarded` | المدّة أضيفت إلى الدفتر | حدث `referral.rewarded` |
| `rejected` | شرط معلوم لم يتحقق | `reason_code` إلزامي ويُقرأ بالـAPI |

وأسباب الرفض لا تتسع: `self_referral` · `referrer_not_active` ·
`referee_already_referred` · `referee_no_qualifying_facts` · `referral_window_expired` ·
`referee_subscription_never_activated`.

---

## 6. الجداول العشرة وحدود ملكيتها

| الجدول | الحقيقة المحفوظة | الحارس أو الحد |
|---|---|---|
| `subscription_plans` | نسخة الخطة ومدة التجربة والمدّة والمهلة | PK `(plan_code, plan_version)`؛ لا مال |
| `subscription_plan_entitlements` | الامتياز وحده | PK مركب؛ `limit_value` INTEGER و`-1` بلا سقف |
| `subscriptions` | الحالة المتحققة الحالية | `ux_subscriptions_driver`؛ قابلة لإعادة البناء |
| `subscription_periods` | دفتر المدّات | append-only؛ مصدره من القائمة المغلقة |
| `subscription_transitions` | تسلسل تغيّر الحالة | `ux_subscription_transitions_sequence`؛ append-only |
| `referral_codes` | رمز المالك النشط | `ux_referral_codes_owner` |
| `referrals` | مطالبة الإحالة وتأهيلها أو رفضها | `ux_referrals_referee` · `ck_referrals_not_self` |
| `subscription_idempotency` | جواب الطلب المحفوظ فعلاً | `route_key` و`request_hash` والجواب، لا جسم يعاد بناؤه |
| `subscription_outbox` | حدث ينتظر النشر أو محاولة النشر | المنتج ليس جزءاً من هذه المراجعة |
| `referral_rewards` | منحة مرة واحدة للإحالة | `ux_referral_rewards_referral` في قيود المخطط؛ وصياغة قرار المرة الواحدة تسمي `ux_referral_reward_once` |

لا `NUMERIC` ولا `FLOAT` ولا `MONEY` في هذه الجداول، ولا `comment` ولا `note` ولا نص حر.
الأسباب رموز قوائم مغلقة، والمبالغ غائبة لا مخفية في حقل آخر.

---

## 7. واجهة العقد والأحداث

### العمليات الاثنتا عشرة

| العملية | غرضها وحدّها |
|---|---|
| `GET /health` | `status` من `ok · degraded · unavailable` و`mode` من `postgres · memory` و`last_tick_at` |
| `GET /subscriptions/plans` | قائمة الخطط؛ مرشح `frozen_only` |
| `GET /subscriptions/plans/{planCode}/{planVersion}` | الخطة مع امتيازاتها |
| `POST /subscriptions` | بدء التجربة؛ `idempotency-key` إلزامي |
| `GET /subscriptions/{driverPublicId}` | حالة مشتقة مع `is_stale` |
| `POST /subscriptions/{driverPublicId}/activate` | تفعيل بمرجع دفع opaque؛ مفتاح تكرار |
| `POST /subscriptions/{driverPublicId}/recompute` | إعادة بناء الحالة من الدفتر |
| `GET /subscriptions/{driverPublicId}/periods` | دفتر المدد |
| `POST /referrals` | مطالبة رمز؛ مفتاح تكرار |
| `GET /referrals` | مرشح واحد إلزامي: المُحيل أو المحال أو الحالة |
| `GET /referrals/codes/{ownerPublicId}` | رمز المالك |
| `POST /subscriptions/tick` | تحقيق الانقضاء والمهلة وإرجاع `TickResult` |

لا `502` في أي فرع. و`500` انحراف معلن لقيد تماسك فقط، برمز غائب قصداً من الكتالوج.

### الأحداث الستة

`subscription.trial_started` · `subscription.activated` · `subscription.expired` ·
`subscription.moved_to_community` · `referral.qualified` · `referral.rewarded`.

كلها من المنتج الوحيد `subscriptions-service`، وبالحقول المشتركة:
`event_id` · `event_type` · `event_version:"v1"` · `occurred_at` · `occurred_for` ·
`producer` · `aggregate{type,id}` · `trace_id` · `data{...}`، ومع
`additionalProperties: false`. الرفض ليس حدثاً.

---

## 8. الخصوصية والمال

| ما يُخزّن | ما لا يعبر حدثاً | ما لا يُخزّن أصلاً |
|---|---|---|
| `WS-##########` ورمز الإحالة ونسخة الخطة ومدّتها | `phone` · `phone_number` · `telegram_id` · `channel_user_id` · `full_name` | هوية شخصية أو معرّف قناة |
| مرجع دفع opaque | `amount` · `amount_minor` · `currency` · `price` · `invoice_id` | مبلغ أو فاتورة أو سعر أو استرداد |
| سبب رفض مسمّى وعدد وقائع | `is_fraudster` | تعليق أو `comment` أو `note` |

---

## 9. ما تعتمد عليه وما لا تعرفه

```text
reputation ──► subscriptions  (وقائع مؤهلة، بحدث أو قراءة، بلا FK)
subscriptions ↛ reputation    (لا يكتب حقيقة السمعة ولا ينسخ منطقها)
subscriptions ↛ drivers       (لا يوقف ولا يقرر أهلية)
subscriptions ↛ billing       (لا سعر ولا مبلغ ولا فاتورة)
subscriptions ↛ referrals     (لا خدمة referrals مستقلة؛ الدليل فارغ)
```

**ما لا تعرفه الخدمة:** هوية السائق وقناته · أهلية السائق أو سبب إيقافه · مبلغ الدفع
وعملته وفاتورته · منطق احتساب السمعة · قرار إداري أو عقوبة. و**ما لا تملكه:** الإيقاف
والحجب والسعر واسترداده.

---

## 10. الدَّين المُعلن وما ليس في المرحلة

| الدَّين | من يملكه | لماذا يُترك الآن |
|---|---|---|
| ناشر `subscription_outbox` | البنية التحتية للناقل | الصندوق ضمن العقد، والناشر خارج MR 1/6 |
| استهلاك وقائع السمعة | مراجعة لاحقة من Phase 10 | العقد يعلن التأهيل؛ لا كود خدمة الآن |
| تشغيل النبضة الخارجية | المشغّل الخارجي | الخدمة تملك الباب `tick` لا المؤقّت |
| المال والسعر والفواتير والاسترداد | Phase 17 (Billing) | لا مصدر حقيقة ثانٍ للسعر |
| `cancelled` و`suspended` | طور يملك معناهما | لا تدخلان جدول الحالات قبل مالكهما |

ولا تدخل في المرحلة: خدمة `services/referrals` أو عقودها · مؤقّت داخلي · حجب أو إيقاف ·
سعر أو فاتورة أو استرداد · نص حر · واجهة مستخدم.

## 11. ما نفّذته المراجعة 2/6 من هذا النموذج (طبقةُ المجالِ النقيّة)

النموذجُ أعلاه صار كوداً في `services/subscriptions/src/domain/` بلا قاعدةٍ ولا شبكةٍ ولا
ساعةِ نظامٍ (الزمنُ **مُدخلٌ محقون**). وثلاثةُ توضيحاتٍ لزمت النموذجَ عند تنفيذِه، وهي جزءٌ
منه من الآن:

1. **الحدُّ نصفُ مفتوح:** المُدّةُ `[starts_at, ends_at)` — لحظةُ النهايةِ **غيرُ مغطّاة**.
   ولو كانت مغطّاةً لصار لكلّ سائقٍ لحظةٌ تملكها مدّتان، ويقرّر ترتيبُ الفرزِ حالتَه فيها.
2. **الحالةُ تُشتقّ على «سلاسلِ تغطية»:** المُدَدُ المتلاصقةُ أو المتداخلةُ تُدمَج في سلسلةٍ
   واحدة، فثلاثُ دفعاتٍ متتاليةٍ حالةٌ واحدةٌ لا ثلاث — وهذا هو **سببُ** أنّ التجديدَ ليس
   انتقالاً. والمهلةُ تُقاس من **آخرِ نهايةٍ مضت** لا من أبعدِ نهايةٍ في الدفتر، فمدّةٌ
   مستقبليّةٌ مُجدولةٌ لا تجعل سائقاً بلا تغطيةٍ اليومَ يبدو في مهلةٍ لم تبدأ.
3. **`expired` و`community` أرضيّةٌ واحدة:** المهلةُ نافذةُ **تذكيرٍ** لا امتياز
   (ملحقُ [ADR-015](../15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md)، المراجعة 2/6).
   وسقفٌ يوميٌّ **صفرٌ** يُسقط `accept_orders` بدلاً من إعلانِه بحدٍّ صفر.

**والحُكمُ لا يخرج من هذا الحدّ:** لا مالَ ولا عقوبةَ ولا نصَّ حرٍّ — محروسٌ نصّيّاً في
`src/__tests__/purity.test.ts` بعد حذفِ التعليقاتِ من المصدر، فلا يُفلت شرحٌ صحيحٌ حارساً ولا
يُفلت حقلٌ خاطئٌ منه.

ولا يدخل بعد: كودُ استمراريّةٍ أو مُهجِّرٌ (3/6) · طبقةُ HTTP والنبضةُ (4/6) · مستهلكُ
الوقائعِ وناشرُ الصادر (5/6) · بوابةُ الخروج (6/6).

---

> **Scope:** نموذج مجال اشتراك السائق والإحالة في Phase 10 — المراجعة 1/6 (عقود ووثائق وحزمة أنواع) + **المراجعة 2/6** (طبقةُ المجالِ النقيّةُ المُنفَّذة، §11).
>
> **Last Updated:** 2026-08-24
>
> **Status:** Accepted — طبقةُ المجالِ مُنفَّذةٌ ومُختبَرةٌ (100 اختباراً)؛ لا استمراريّةَ ولا HTTP بعد.
>
> **Related Code:** `services/subscriptions/contracts/` · `services/subscriptions/src/domain/` · `services/subscriptions/src/__tests__/` · `packages/contracts/subscription/` · `services/referrals/.gitkeep` (تبقى فارغةً بقرار — لا كودَ فيها، كسابقة `services/fraud/` في الطور 09)
>
> **Related Team:** Team 03 — Driver (مالك `services/subscriptions/` و`services/referrals/` في [CODEOWNERS](../../CODEOWNERS)) · Team 01 — Identity (مُشارِك في `services/referrals/`) · Team 09 — Data (وقائع السمعة مصدرُ التأهيل)
