# خدمة الاشتراك — الأحداثُ وصندوقُ الصادرِ ومنعُ التكرارِ ومكافأةُ الإحالة

> **النوع:** وثيقةٌ معماريّةٌ تنفيذيّةٌ (Component-level) · **القرارُ الحاكم:** [ADR-015](../15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)
>
> **الخدمة:** `services/subscriptions` · **الحالة:** مُنفَّذةٌ (Phase 10 · MR 5/6) · **Last Updated:** 2026-08-24
>
> **Related Code:** `services/subscriptions/src/domain/events.ts` · `src/app/{events,facts,idempotency,sync}.ts` · `src/db/{outbox,idempotency,referrals,unit-of-work}.ts` · `src/http/mappers.ts` · `src/__tests__/{events,events.integration,http-drift,schema-drift,purity}.test.ts`
>
> **Related Team:** Team 06 — Driver Subscription & Referral
>
> **Related Docs:** [SUBSCRIPTION_HTTP.md](../04-api/SUBSCRIPTION_HTTP.md) · [SUBSCRIPTION_PERSISTENCE.md](SUBSCRIPTION_PERSISTENCE.md) · [DRIVER_SUBSCRIPTION_REFERRAL.md](../03-domain/DRIVER_SUBSCRIPTION_REFERRAL.md) · [HANDOFF §18](../16-progress/HANDOFF_NEXT_STEPS.md) · [MASTER_PROGRESS](../16-progress/MASTER_PROGRESS.md)

---

## 1. ما تُسلّمه هذه الدفعة، وما لا تُغيّره

MR 4/6 سلّمت خدمةً تعمل: دفترٌ، ومؤشِّرٌ مُشتقٌّ منه، ومعاملةٌ واحدة، واثنا عشرَ مساراً على المنفذ 8093. وكانت **خرساء**: لا أحدَ خارجَ الخدمةِ يعلم أنّ سائقاً بدأ تجربتَه أو انقضت مُدّتُه، ولا شيءَ يدخلها من خدمةِ السمعة. والإحالةُ كانت `pending` إلى الأبد، ومفتاحُ منعِ التكرارِ يُتحقَّق شكلاً ثمّ يُرمى.

هذه الدفعة تضع **الحدَّ الحدثيَّ للخدمةِ في الاتجاهَين**، بلا وسيطِ رسائلَ في هذا الطور:

| الملف | الأسطر | ما يفعله |
| --- | --- | --- |
| `src/domain/events.ts` | 403 | **مصانعُ الأحداثِ النقيّة** — ستّةُ أنواعٍ بمُغلَّفٍ واحدٍ، بلا ساعةٍ وبلا مُعرِّفٍ يُولَّد داخلها |
| `src/db/outbox.ts` | 233 | `PostgresOutboxStore` — إلحاقٌ · قراءةٌ · مُطالبةٌ بـ`FOR UPDATE SKIP LOCKED` · تعليمُ نشرٍ · تسجيلُ فشل |
| `src/app/events.ts` | 343 | `toOutboxDraft` · `transitionEvent` · `EventSinkPort` · **`drainSubscriptionOutbox`** (الناشر) |
| `src/db/idempotency.ts` | 211 | `PostgresIdempotencyStore` — `read`/`remember`، بلا `UPDATE` أبداً |
| `src/app/idempotency.ts` | 79 | `fingerprint` — sha256 لتمثيلٍ قانونيٍّ لا يتأثّر بترتيبِ المفاتيح |
| `src/app/facts.ts` | 496 | **`ReputationFactConsumer`** — واقعةُ سمعةٍ ⇒ عدٌّ ⇒ تأهّلٌ ⇒ **مُدّةٌ في الدفتر** |
| `src/http/mappers.ts` | 274 (+3 أغلفة) | `toGrantResultWire` · `toRecomputeResultWire` · `toReferralClaimResultWire` |

**وما لم يتغيّر:** الدفترُ يبقى إلحاقاً فقط، والمؤشِّرُ يبقى مُشتقّاً بـ`deriveState` (القرار 2)، وحزمةُ العقدِ **مُجمَّدةٌ لم تُلمَس** (§8)، ولا مالَ: `payment_reference` معرّفٌ معتمٌ يُخزَّن ولا يُفسَّر، والمكافأةُ **أيّامٌ في الدفتر لا رصيدٌ ولا نقاط**.

---

## 2. المُغلَّفُ الواحدُ وستّةُ الأنواع

كلُّ حدثٍ يخرج من الخدمةِ بمُغلَّفٍ واحدٍ لا استثناءَ له:

```jsonc
{
  "event_id": "…",            // uuid — يُولَّد في الحدِّ لا في المجال
  "event_type": "subscription.trial_started",
  "event_version": "v1",
  "occurred_at": "…",         // لحظةُ الكتابة (ساعةُ الخدمة المحقونة)
  "producer": "subscriptions-service",
  "aggregate": { "type": "subscription" | "referral", "id": "…" },
  "trace_id": "…" | null,
  "data": { "…": "…", "occurred_for": "…" }
}
```

| النوع | يُنشَر حين | `aggregate.type` |
| --- | --- | --- |
| `subscription.trial_started` | وثبةٌ إلى `trial` | `subscription` |
| `subscription.activated` | وثبةٌ إلى `active` (دفعٌ **أو** مكافأةُ إحالة) | `subscription` |
| `subscription.expired` | وثبةٌ إلى `expired` | `subscription` |
| `subscription.moved_to_community` | وثبةٌ إلى `community` | `subscription` |
| `referral.qualified` | `pending → qualified` | `referral` |
| `referral.rewarded` | `qualified → rewarded` | `referral` |

**`data.occurred_for` ليس تكراراً لـ`occurred_at`.** الأولى **لحظةُ الانتقالِ في الدفتر** (نهايةُ التجربةِ مثلاً)، والثانية لحظةُ كتابةِ الصفّ. ونبضةٌ تأخّرت ثلاثةَ أيّامٍ تجعل الفارقَ ثلاثةَ أيّام؛ ومستهلكٌ يحاسب على الوقتِ يحتاج الأولى، ومَن يرتّب التسليمَ يحتاج الثانية. دمجُهما في حقلٍ واحدٍ كان سيجعل كلَّ تأخيرِ تشغيلٍ كذبةً في التاريخ.

**سببُ الانتقالِ رمزٌ مُغلَقٌ لا نصّ:** `trial_granted` · `payment_activated` · `referral_reward_applied` · `period_ended` · `community_grace_ended`. ونصٌّ حرٌّ هنا كان سيصير عقداً بلا مالكٍ يقرأه مستهلكٌ بمطابقةِ حروف.

**المصانعُ نقيّةٌ بالحرف:** لا تقرأ ساعةً ولا تُولّد `uuid`؛ تستلم `meta {eventId, occurredAt, traceId}`. وحمولةٌ ناقصةٌ تُرفَع `EventPayloadIncompleteError` بحقلٍ مُسمّى — لا حدثٌ بحقلٍ `undefined` يُنشَر ثمّ يُكتشف عند مستهلكٍ بعد أسبوع. و`purity.test.ts` يحرس أنّ `domain/events.ts` لا يعرف قاعدةً ولا شبكةً.

---

## 3. صندوقُ الصادر: لماذا لا يُنشَر من داخلِ المعاملة

النشرُ المباشرُ داخلَ المعاملةِ يُنتج إحدى كذبتَين: إمّا نُشِر حدثٌ لمعاملةٍ تراجعت، أو ارتكزت معاملةٌ لم يُعلَم بها أحد. فالحدثُ يُكتب **صفّاً في `subscription_outbox` في نفسِ معاملةِ التغيير**، ثمّ يُسلَّم لاحقاً.

`PostgresOutboxStore` — وما تُثبته كلُّ طريقةٍ منه:

| الطريقة | العقد |
| --- | --- |
| `append(draft)` | إلحاقُ صفٍّ في معاملةِ التغييرِ نفسِها |
| `read(eventId)` | قراءةُ صفٍّ واحدٍ للتحقّق |
| `claimUnpublished(limit)` | `FOR UPDATE SKIP LOCKED` بترتيبِ `occurred_at, event_id` — ناشرانِ متوازيانِ لا يتنازعان صفّاً |
| `markPublished(eventId, at)` | `published_at` + `last_error = null` + **`attempts + 1`** ⇒ `boolean` |
| `recordDeliveryFailure(eventId, reason)` | `attempts + 1` + سببٌ مقصوصٌ إلى 500 حرفاً ⇒ `boolean` |

**`attempts` تزيد في النجاحِ أيضاً**، لأنّ صفّاً منشوراً بصفرِ محاولاتٍ يُقرَأ «نُشِر بلا أن يُحاوَل» — نصٌّ بلا معنى في تحقيقٍ بعد حادثة. والعدّادُ بهذا يُجيب سؤالاً واحداً واضحاً: كم مرّةً لامسَ هذا الحدثُ الناقل.

**`drainSubscriptionOutbox(uow, sink, {limit, clock})`** — والضمانُ المُعلَنُ **تسليمٌ مرّةً على الأقلّ لا مرّةً واحدةً بالضبط**: الصفُّ يُعلَّم منشوراً بعد نجاحِ التسليم، فانقطاعٌ بين التسليمِ والتعليمِ يُعيد التسليم. والصدقُ في ذلك أرخصُ من ضمانٍ لا يمكن تحقيقُه بلا مشاركةِ المستهلك، **فمنعُ التكرارِ مسؤوليّةُ المستهلكِ بالعقد** — وخدمتُنا نفسُها تُطبّقه على ما تستهلكه (§5).

- الفشلُ **يُسجَّل ولا يُرفَع**: دفعةٌ من مئةٍ لا يُسقطها حدثٌ واحدٌ عاطبٌ، والتقريرُ `DrainReport {claimed, published, failed, alreadyPublished}` يحمل الفشلَ بسببِه.
- `DRAIN_BATCH_LIMIT = 100`، و`limit < 1` يُرفَع `RangeError` — حدٌّ صفريٌّ صامتٌ كان سيبدو ناشراً يعمل بلا أن ينشر شيئاً.
- **لا ناقلَ حقيقيّاً في هذا الطور**: `unconfiguredEventSink(reason)` يرفع `EventSinkUnconfiguredError` مع سببٍ مُسمّى. الناقلُ الحقيقيُّ والمُنادي الدوريُّ مرحلةُ 09 ودَينٌ مُعلَنٌ (§9)، ومنفذُ `EventSinkPort` هو موضعُ وصلِه بلا تعديلِ منطق.

---

## 4. منعُ التكرار: نفسُ البايتاتِ لا 409

`PostgresIdempotencyStore` يخزّن الجوابَ لا وجودَ المفتاحِ وحدَه، ولذلك عمليّتانِ فقط:

- `remember(...)` — `INSERT … ON CONFLICT DO NOTHING RETURNING`. صفٌّ عائدٌ ⇒ `verdict: "stored"` (أوّلُ مرّة). لا صفَّ ⇒ يُقرأ الصفُّ القائمُ ويُقابَل `request_hash`:
  - تساوَيا ⇒ `verdict: "replay"` مع **الجوابِ المخزَّنِ نفسِه** (رمزُ الحالةِ والجسم).
  - اختلفا ⇒ `SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED` (409): مفتاحٌ واحدٌ لطلبَين مختلفَين خطأُ عميلٍ يجب أن يصرخ.
- `read(...)` — قراءةٌ محضة.

**ولا `UPDATE` في هذا المخزنِ أبداً.** جوابٌ يُعاد كتابتُه ليس منعَ تكرارٍ بل مصدرَ حقيقةٍ ثانياً؛ والصفُّ يُكتب مرّةً ويُقرأ ما بقي.

و`fingerprint` (في `app/idempotency.ts`) sha256 لتمثيلٍ قانونيٍّ **يرتّب مفاتيحَ الكائناتِ ويحفظ ترتيبَ المصفوفات**: مفتاحان بترتيبِ حقولٍ مختلفٍ لنفسِ الطلبِ يجب أن يتساوى بصمتُهما، ومصفوفةٌ بترتيبٍ مختلفٍ **طلبٌ آخر** فعلاً.

**⚠️ حدٌّ مُعلَنٌ صريح:** إعادةُ تشغيلِ **مسارِ HTTP** (تخزينُ جوابِ المسارِ وإعادةُ بايتاتِه على نفسِ `Idempotency-Key`) **مؤجَّلةٌ إلى MR 6/6** بقصد. المخزنُ في هذه الدفعةِ يستعمله **مستهلكُ الوقائعِ وحدَه**. ومسارُ الكتابةِ في HTTP يُجيب `duplicate: true` من قيدِ القاعدةِ (وليس من هذا المخزن) — أيْ لا 409 على إعادةٍ حقيقيّةٍ، لكن جسمَ الجوابِ يُعاد حسابُه لا يُقرأ من صفٍّ محفوظ. (تفصيلُ الدَّينِ في §9-2.)

---

## 5. مستهلكُ وقائعِ السمعة: من واقعةٍ إلى أيّامٍ في الدفتر

`ReputationFactConsumer.record(payload)` يستهلك `reputation.fact_recorded`، **كلُّه في معاملةٍ واحدة**:

1. **منعُ التكرارِ أوّلاً** — مفتاحٌ `fact:<fact_id>` يُكتب **لكلِّ قرارٍ حتّى الإهمال**. وإهمالٌ لا يُسجَّل يُعاد حسابُه كلَّ إعادةِ تسليمٍ، ويومَ تتغيّر القاعدةُ تُقلب واقعةٌ قديمةٌ إلى تأهّلٍ متأخّرٍ بلا سبب.
2. **إهمالٌ بسببٍ مُسمّى**: `subject_not_driver` · `fact_kind_not_qualifying` · `no_referral_for_referee` · `referral_not_pending`. (والقاطعُ المؤهِّلُ وحدَه `order_completed`.)
3. **العدُّ في القاعدة** — `incrementQualifyingFacts` مشروطٌ بحالةِ `pending`، فتسليمانِ متزامنانِ لا يعدّان مرّتين.
4. **الأدلّةُ من الدفترِ لا من عدّادٍ وحدَه**: تأهّلٌ يشترط مُدّةً مصدرُها `payment` للمُحال، لا عدَّ وقائعَ فقط.
5. **تأهّلٌ** ⇒ `advanceState(pending→qualified)` محروسٌ بحالتِه السابقة + حدثُ `referral.qualified`.
6. **المكافأةُ مُدّةٌ تبدأ من نهايةِ تغطيةِ المُحيل** (`currentCoverageEnd`) لا من الآن: مكافأةٌ تبدأ الآن كانت ستحرق ما بقي من مُدّةٍ مدفوعةٍ **فتُعاقب مَن دفع**.
7. المُدّةُ تُكتب بـ`syncFromLedger` **نفسِها** ⇒ فتُنشَر `subscription.activated` تلقائيّاً إن نقلت المكافأةُ المُحيلَ من انقضاءٍ إلى سريان، ثمّ `insertReward` ثمّ `advanceState(qualified→rewarded)` وحدثُ `referral.rewarded`.

والحكمُ يعود واحداً من أربعة: `duplicate` · `ignored` · `counted` (عُدَّت ولم تُؤهِّل، بسببِ رفضٍ مُسمّى) · `rewarded`.

**رفضُ التأهّلِ لا يُرجِع العدّاد**: الإحالةُ تبقى `pending` بعدّادٍ أعلى بواحدٍ، فوقائعُ اليومِ تُحسَب يومَ يتحقّق الشرطُ الناقص.

### 5.1 عيبُ إنتاجٍ حقيقيٌّ كشفه اختبارُ التكاملِ وأُصلح — الصفُّ البائتُ يمنع حقّاً

المستهلكُ كان يحكم على حالةِ المُحيلِ **من صفِّه المُتحقِّق**. والمُحيلُ الذي دفع في يومِ تجربتِه الأوّلِ يبقى صفُّه `trial` حتّى تُعيد نبضةٌ حسابَه، **وهو ساري الاشتراكِ فعلاً بالاشتقاق**. فكان التأهّلُ يُرفَض بـ`referrer_not_active` رفضاً كاذباً، ثمّ تُغلَق نافذةُ الثلاثين يوماً **فيضيع حقُّ سائقٍ بسببِ تأخّرِ مهمّةٍ دوريّةٍ، بلا خطأٍ ولا سجلٍّ يشير إلى السبب**.

**الإصلاح:** حالةُ المُحيلِ تُشتقُّ **الآن** من دفترِه داخلَ نفسِ المعاملةِ عبرِ `syncFromLedger` قبلَ الحكم — أيْ المستهلكُ يكتب الانتقالاتِ التي كانت النبضةُ ستكتبها وينشر أحداثَها. وبهذا يبقى موضعُ اشتقاقِ الحالةِ **واحداً** في الخدمةِ كلِّها (القرار 2)، ولا نسخةَ ثانيةً من قواعدِ الانتقال. والبديلُ الأرخصُ الخاطئُ كان تصحيحَ التوقّعِ في الاختبارِ أو إعادةَ الحسابِ في مُهيّئِه — يُخفي الاعتمادَ الحقيقيَّ على النبضةِ ويترك العيبَ في الإنتاج.

**وأثرُ ذلك مُعلَنٌ في الجواب:** حتّى حين يُرفَض التأهّلُ، يحمل الجوابُ `eventIds` لأحداثِ الاشتقاقِ إن وُجدت — كي لا يقرأ أحدٌ «رُفض» فيفترض أنّ المعاملةَ لم تكتب شيئاً.

---

## 6. ذرّيّةُ المعاملةِ — مُثبَتةٌ بفشلٍ مُصطنعٍ في منتصفِها (سدُّ دَينِ 18.9-7)

MR 4/6 ادّعت الذرّيّةَ ولم تُثبتها. الآن `SubscriptionUnitOfWork(db, probe?)` يقبل **مِسْباراً** `TransactionProbe = (stage: "after-period" | "after-transition") => Promise<void>`، والاختبارُ يجعله يرفع خطأً بعدَ كتابةِ المُدّةِ وقبلَ الانتقال، ثمّ يقرأ الجداولَ الأربعةَ بـSQL خامٍ فيجدها **فارغةً كلَّها** — لا مُدّةَ ولا انتقالَ ولا مؤشِّرَ ولا صفَّ صادرٍ. ونقطةُ الحقنِ في وحدةِ العملِ لا في منطقِ المجال، فلا كودَ اختبارٍ في مسارِ الإنتاج.

و`write` تُعيد `{value, attempts}` وتُعيد المحاولةَ على تصادمِ تسلسلِ الانتقالات (سدُّ دَينِ 18.9-6).

---

## 7. أغلفةُ أجوبةِ الكتابةِ — انحرافُ عقدٍ ثالثٌ كُشف وأُصلح

العقدُ يُلزم `POST /subscriptions/{id}/trial` و`/activate` بجسمٍ يحمل `{subscription, period, duplicate}`، و`/recompute` بـ`{subscription, rebuilt}`، ومطالبةَ الإحالةِ بـ`{referral, duplicate}`. وكان الحدُّ يُرسل **الحالةَ وحدَها** في هذه المسارات — أيْ ثلاثةُ حقولٍ إلزاميّةٍ غائبةٌ يحقُّ لمستهلكٍ صارمٍ أن يرفضَ الجوابَ لغيابها.

فأُضيفت ثلاثةُ مُحوِّلاتٍ (`toGrantResultWire` · `toRecomputeResultWire` · `toReferralClaimResultWire`)، و`toStateWire` بقي على `GET /subscriptions/{id}` وحدَه. **والحارسُ الجديدُ يقرأ `required:` من العقدِ على القرصِ** ويقابله بمفاتيحِ جسمِ المُحوِّلِ وبعددِ نداءاتِ الإرسالِ في كلِّ مسار — فانحرافٌ كهذا لا يمرُّ صامتاً مرّةً أخرى (`http-drift.test.ts`، 23 فحصاً).

---

## 8. حزمةُ العقدِ مُجمَّدةٌ — وهذه فجواتُها المعروفة

**لم تُلمَس `packages/contracts/subscription`** في هذه الدفعة (الحزمةُ مُجمَّدةٌ بعد MR 1/6)، والفجواتُ التاليةُ **مُحرَّسةٌ باختبارِ فجوةٍ معروفةٍ يفشل يومَ تُسَدّ**:

1. **`payment_reference`**: العقدُ `minLength: 1`، والمجالُ يشترط `4..64`. معرّفُ دفعٍ بحرفٍ واحدٍ لا يُطابق أيَّ بوّابةٍ حقيقيّة، فالخدمةُ أصرمُ من عقدِها بقصد — ويلزم تعديلُ العقدِ في مراجعةٍ تملكه.
2. **تعدادُ `ErrorResponse.code` ناقصٌ أربعةَ رموزٍ** تُصدرها الخدمةُ فعلاً: `REFERRAL_REFEREE_ALREADY_REFERRED` · `REFERRAL_REWARD_ALREADY_GRANTED` · `SUBSCRIPTION_ALREADY_EXISTS` · `SUBSCRIPTION_TRANSITION_NOT_ALLOWED`.
3. **ورمزٌ خامسٌ محلّيٌّ بالكامل**: `SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED` (409) ليس من رموزِ العقدِ السبعةَ عشرَ — أُضيف لأنّ إعادةَ مفتاحٍ لطلبٍ مختلفٍ خطأُ عميلٍ يجب أن يُسمّى، وتسميتُه محلّيّاً أصدقُ من إخفائِه تحتَ رمزٍ عامّ.
4. **`errors.md` القاعدةُ 5**: نصُّها يذكر مفتاحاً `idempotent_replay` في الجواب، وهو **غيرُ قابلٍ للاستعمالِ** لأنّ كلَّ المخطَّطاتِ `additionalProperties: false`. فالعلامةُ القانونيّةُ للإعادةِ هي `duplicate` المُعلَنُ في أجسامِ الكتابة، ونصُّ الوثيقةِ يحتاج تصحيحاً في مراجعةِ العقد.

---

## 9. الدَّينُ المُعلَنُ الخارجُ من هذه الدفعة

1. **لا ناقلَ ولا مُنادٍ دوريّ**: `EventSinkPort` بلا مُهيّئٍ حقيقيّ، ولا مَن يستدعي `drainSubscriptionOutbox` تلقائيّاً. المرحلة 09، ومنفذُ الوصلِ جاهزٌ.
2. **إعادةُ تشغيلِ مسارِ HTTP مؤجَّلةٌ إلى MR 6/6** (§4): المخزنُ يعمل ومُختبَرٌ، ووصلُه بمعالجاتِ المسارِ لم يُنجَز بقصدِ حصرِ النطاق.
3. **`TickOutcome.referralsQualified` و`rewardsApplied` صفرانِ ثابتان**: التأهّلُ يقع في المستهلكِ لا في النبضة، والحقلانِ يبقيان في العقدِ ويُملآنِ يومَ يوجد ناقلٌ يبلع الوقائعَ في النبضة.
4. **لا اختبارَ تزامنٍ لحلقةِ الإعادة** (`MAX_TRANSITION_ATTEMPTS`) ولا `projection.integration.test.ts` مستقلّاً — مساواةُ المؤشِّرِ للاشتقاقِ مُثبَتةٌ عَبَر HTTP وعبرَ هذا الملفِّ لا على المخزنِ مباشرةً.
5. **الأرقامُ كلُّها محلّيّةٌ** (`ci_quota_exceeded`) — انحرافٌ مُعلَنٌ وفق [HANDOFF §2-أ](../16-progress/HANDOFF_NEXT_STEPS.md).

---

## 10. الأرقامُ المقيسةُ (محلّيّاً · 2026-08-24)

| الحزمة | الأمر | النتيجة |
| --- | --- | --- |
| السريعة | `pnpm test` | **205 ناجحاً · 11 ملفّاً** (كانت 180 · 10) |
| التكامل | `pnpm vitest run --config vitest.integration.config.ts` | **54 ناجحاً · 4 ملفّات** (كانت 41 · 3) |
| المستودعُ كاملاً | `pnpm -r test` | **0 فاشل** |
| الأنواع | `pnpm typecheck` | نظيف |

الجديدُ منها: `events.test.ts` **21** · `events.integration.test.ts` **13** · `http-drift.test.ts` 23 (كانت 14) · `schema-drift.test.ts` 23 (المرآةُ صارت **10/10 جداولَ** و`NOT_MIRRORED_TABLES` فارغةٌ).

---

## 11. مراجعُ ذاتُ صلة

- [ADR-015 — دفترُ الاستحقاقِ ومكافأةُ الإحالةِ المُشتقّة](../15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md)
- [SUBSCRIPTION_HTTP.md — طبقةُ HTTP (MR 4/6)](../04-api/SUBSCRIPTION_HTTP.md)
- [SUBSCRIPTION_PERSISTENCE.md — طبقةُ الاستمراريّة (MR 3/6)](SUBSCRIPTION_PERSISTENCE.md)
- [DRIVER_SUBSCRIPTION_REFERRAL.md — نموذجُ المجال](../03-domain/DRIVER_SUBSCRIPTION_REFERRAL.md)
- [HANDOFF_NEXT_STEPS.md §18 — حالةُ الطور 10](../16-progress/HANDOFF_NEXT_STEPS.md)
- [LOCAL_POSTGRES_FOR_TESTS.md — قاعدةٌ محلّيّةٌ بلا root](../14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md)
