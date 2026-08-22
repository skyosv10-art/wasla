# نموذج مجال التفاوض والمحادثة — Negotiation & Chat

> **الطور:** 08 · **القرار الحاكم:** [ADR-013](../15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md)
> **العقود الكنسية:** [`services/negotiations/contracts/`](../../services/negotiations/contracts/README.md)
> **الأنواع المُكتبة:** `packages/contracts/negotiation/` (`@wasla/contracts-negotiation`)
> **الحالة:** عقود كنسية فقط (MR 1/6) — لا `src/` بعد

---

## 1. الحدّ في سطر واحد

> **يملك التفاوض «بكم اتّفقنا»، ولا يملك «ما هو الطلب» ولا «من يُنفّذه» ولا «متى يُدفَع».**

الطور 07 أثبت أنّ طلباً حقيقياً يجد سائقاً حقيقياً. وهذه المرحلة تجيب السؤال الذي بقي: **بكم؟**
و`price_mode = 'negotiable'` في مخطّط الطلب يُجبر `offered_amount_minor` على `NULL` — أي أنّ محرّك
الطلب **يُعلن الحاجة إلى هذه المرحلة في مخطّطه**.

---

## 2. المفاهيم الخمسة

| المفهوم | ما هو | ما ليس هو |
|---|---|---|
| **الخيط** `negotiation_thread` | حوارٌ **ثنائي** بين عميلٍ واحد وسائقٍ واحد، مربوطٌ بعرض توزيع قائم واحد | ليس مزاداً ولا غرفةً جماعية: لا قائمة أطراف في المخطّط، وذاك ما يمنع المزاد لا حسنُ النيّة |
| **الدور** `negotiation_round` | مبلغٌ **مُرقّم** اقترحه طرفٌ، له عملة ومهلة وحالة | ليس رسالة: الرسالة نصّ، والدور رقمٌ يُقبل أو يُرفض |
| **الرسالة** `negotiation_message` | نصّ يكتبه طرفٌ أو إشعارٌ نظاميّ برمزٍ لا نصّ | ليست سعراً: نصٌّ فيه رقم لا يُنشئ دوراً |
| **الاتفاق** `negotiation_agreement` | **قبولٌ صريح لدورٍ برقمه** من الطرف الآخر | ليس تقارباً حسابياً ولا آخرَ رسالة ولا نيّةً تُستنتَج |
| **التسليم** `negotiation_price_handoff` | محاولةُ إخبار محرّك الطلب بالمبلغ المتَّفق عليه، صفٌّ لكل محاولة | ليس شرطاً لصحّة الاتفاق: فشلُه **لا يُبطله** |

---

## 3. مسار الحياة

```text
عرض توزيع قائم (Phase 07)
        │
        ▼
  POST /negotiations ──────────────► thread(open) + round 1(pending)
        │                             حدث: negotiations.thread_opened
        │
        ├── POST .../rounds ────────► round n(pending)، والسابق superseded
        │      (تبادلٌ إلزاميّ: من اقترح ينتظر جواباً)
        │      حدث: negotiations.round_proposed
        │
        ├── POST .../messages ──────► رسالة، والنصّ لا يعبر أي حدث
        │      حدث: negotiations.message_posted  (body_length لا body)
        │
        ├── POST .../rounds/{n}/reject ─► round(rejected)
        │      thread_remains_open = هل سيقترح غيره؟
        │      حدث: negotiations.round_rejected
        │
        ├── POST .../rounds/{n}/accept ─► round(accepted) + thread(agreed) + agreement
        │      شروطه الثلاثة: expected_round_no مطابق · ليس المقترح نفسه · لم تنتهِ المهلة
        │      حدث: negotiations.agreed
        │                │
        │                ▼
        │        AgreedPricePort ──► محرّك الطلب (Phase 06) يسجّل السعر
        │          نجح → negotiations.agreed_price_handed_off (handoff_state=handed_off)
        │          فشل → negotiations.price_handoff_failed    (الاتفاق **قائم**)
        │
        └── POST /negotiations/tick ─► المستحقّ: round(expired) · thread(expired)
               حدثان: negotiations.round_expired · negotiations.thread_closed
```

### حالات الخيط

`open` → واحدة من: `agreed` · `declined` · `expired` · `cancelled`. **كلّها نهائية**، ولا إغلاق بلا
`close_reason_code` من قائمة مُقفلة (`ck_negotiation_threads_closed_has_reason`).

و`cancelled` **ليست** انسحاب طرف: انسحابُ طرفٍ **رفضٌ** (`declined_by_customer` /
`declined_by_driver`). الإلغاء لطرفٍ ثالث فقط: `cancelled_by_dispatch` أو `order_withdrawn`.

### حالات الدور

`pending` → `accepted` · `rejected` · `superseded` · `expired`. دورٌ معلّق **واحد** لكل خيط
(`ux_negotiation_rounds_one_pending`)، ودورٌ مقبول **واحد** (`ux_negotiation_rounds_one_accepted`).

---

## 4. القواعد التي تحرسها القاعدة لا الكود وحده

| القاعدة | الحارس |
|---|---|
| خيطٌ واحد لكل (طلب × سائق) | `ux_negotiation_threads_order_driver` |
| خيطٌ واحد لكل عرض توزيع | `ux_negotiation_threads_dispatch_offer` |
| من اقترح لا يقبل ولا يرفض | `ck_negotiation_rounds_no_self_resolution` |
| خيطٌ `agreed` يسمّي دوره، وغيرُه لا يسمّي | `ck_negotiation_threads_agreed_names_round` |
| لا إغلاق بلا سبب، ولا سببَ بلا إغلاق | `ck_negotiation_threads_closed_has_reason` · `ck_negotiation_threads_open_is_clean` |
| اتفاقٌ واحد لكل (طلب × سائق) | `ux_negotiation_agreements_order_driver` |
| رسالةٌ إمّا نصٌّ من طرف أو رمزٌ نظاميّ، لا كلاهما ولا لا شيء | `ck_negotiation_messages_body_or_code` |
| تنقيحٌ بسببٍ مُسمّى، والصفّ يبقى | `ck_negotiation_messages_redaction` |
| حدُّ المبلغ من سياسةٍ مُرقّمة | `ck_negotiation_policies_amount_bounds` + `policy_version` على الخيط |

---

## 5. الزمن

`expires_at` مخزّن على الخيط وعلى كل دور، و`next_tick_at` مفهرس. **والانتهاء يُقاس مرّتين**:

1. **عند كل فعل** — قبولٌ لدورٍ استحقّ انتهاؤه يُرفض بـ`NEGOTIATION_ROUND_EXPIRED` وإن لم تمرّ
   نبضةٌ بعد. من اعتمد على النبضة وحدها فتح نافذةً يُشترى فيها سعرٌ انتهى.
2. **في النبضة** — `POST /negotiations/tick` يُنظّف ويُعلن.

ولا `is_expired` مخزّن: حالةٌ محسوبة تُخزَّن تتخلّف عن مصادرها (سابقة [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) §2).
وكل حدث يحمل `occurred_for` (زمن العمل): إعادةُ تشغيلٍ تؤجّل الاكتشاف ولا تُغيّر **متى** انتهى.

---

## 6. الخصوصية

| ما يُخزَّن | ما لا يعبر أي حدث | ما لا يُخزَّن أصلاً |
|---|---|---|
| `body` في `negotiation_messages` وحدها | `body` · الملاحظة المصاحبة لعرض · أي نصّ مستخدم | نصّ مترجَم · اسم · هاتف · إحداثية · `chat_id` |
| `source_locale` | — | جدول ترجمات |
| المبلغ والعملة | — (المبلغ **يعبر**: هو التغيّر نفسه) | — |

الحارس آليّ: `NEGOTIATION_EVENT_FORBIDDEN_FIELDS` تُفحص على كل مفاتيح كل حمولة في
`packages/contracts/negotiation/src/__tests__/events.test.ts`. والانضباط اليدويّ ينهار عند أوّل
تعديلٍ مستعجل، فلذلك لا يُترك حدّ الخصوصية للمراجعة البشرية.

---

## 7. ما تعتمد عليه وما لا تعرفه

```text
negotiations → orders     (AgreedPricePort — نداءٌ صادر واحد، ولا قراءة لقاعدته ولا FK)
negotiations → dispatch   (DispatchOfferPort — هل العرض قائم؟ مرجع opaque)
orders       ↛ negotiations  (محرّك الطلب لا ينادي التفاوض ولا يعرف أنّه موجود)
dispatch     ↛ negotiations  (التوزيع يعرض، ولا يعرف أنّ حواراً جرى)
```

**ما لا يعرفه التفاوض:** حالة الطلب وآلته · أهليّة السائق (العرض القائم هو الدليل أنّه كان
مؤهَّلاً حين عُرض) · هويّة الشخص واسمه · قناة التوصيل.

**وما لا يملكه:** عمود السعر في `orders`. المبلغ يُسلَّم، ومحرّك الطلب وحده يسجّله.

---

## 8. الدَّين المُعلَن (بوابة الخروج)

بوابة خروج الطور: **«تفاوض + توافق على السعر وتسجيله في Order»**. والشقّ الأخير يقتضي أن يكسب
**محرّك الطلب** — لا التفاوض — أربعة أعمدة ونقطةَ نهايةٍ تكتبها في **MR لاحق من هذا الطور**:

| العمود | لماذا |
|---|---|
| `agreed_amount_minor` | لا يوجد اليوم: `price_mode='negotiable'` يُجبر `offered_amount_minor` على `NULL` |
| `agreed_currency` | كل مبلغ في النظام بعملةٍ صريحة |
| `agreed_at` | تمييز «اتُّفق» عن «سُجِّل» |
| `agreed_negotiation_id` | أثرٌ يعيد السعر إلى الخيط الذي أنتجه |

بترحيلٍ عكسيّ كامل، ومالكه محرّك الطلب. حتى ذلك الـMR يبقى `handoff_state` هو مصدر الحقيقة عن
**هل عرف الطلبُ سعره**.

---

## 9. ما ليس في هذه المرحلة بقرار

الدفع والتسوية (Phase 19) · السمعة وسلوك التفاوض المسيء (Phase 09) · محرّك تسعير يقترح مبلغاً
(بلا مالك: يحتاج بيانات تاريخية لا نملكها) · مرفقات المحادثة · الخيوط الجماعية والمزاد ·
قناة التوصيل ([ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)).

**ولا عمود ولا حقل ولا مسارٍ معطّل** لأيٍّ منها: عمودٌ يُضاف قبل مالكه يُملأ بقيَم يخترعها من لا
يملك القرار (سابقة [ADR-012](../15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) §7). وحرّاس اختبارٍ سالبة تفحص ذلك في المخطّط وفي سطح الواجهة.
