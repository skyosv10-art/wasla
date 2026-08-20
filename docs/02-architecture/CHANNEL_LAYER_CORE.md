# طبقة القنوات — النواة المحايدة `@wasla/channel-core`

> **النوع:** وثيقة معمارية تنفيذية (Component-level) · **القرار الحاكم:** [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) · **مُعدَّل بـ**[ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) (المنفذ العاشر: سجل المجموعات)
>
> **الحزمة:** `packages/channel-core` · **الحالة:** مُنفَّذة (Phase 03 · MR 2، ومُوسَّعة بالمجموعات في MR 6) · **Last Updated:** 2026-08-21
>
> **Related:** [CONTAINERS.md §5.1](CONTAINERS.md) · [CHANNEL_GROUPS.md](CHANNEL_GROUPS.md) · [عقود القناة](../../packages/channel-core/contracts/README.md) · [MASTER_PROGRESS](../16-progress/MASTER_PROGRESS.md) · [HANDOFF §7](../16-progress/HANDOFF_NEXT_STEPS.md)

---

## 1. لماذا توجد هذه الحزمة

بوابة خروج المرحلة 03 تقول: **«كل بوت يفتح Mini App المناسبة، ويمكن استبدال مُهيّئ القناة في الاختبارات بمُهيّئ Mock»**. لا يمكن إثبات هذا إلا إذا كان *كل* منطق القناة (استلام، منع تكرار، إرسال، إعادة محاولة، روابط عميقة، فتح Mini App) موجوداً في حزمة **لا تعرف أي قناة**، ويتصل بالعالم عبر منافذ (Ports) فقط.

لذلك هذه الحزمة:

- **لا** تعرف اسم أي قناة ولا شكل رسائلها ولا أسماء دوالها ولا أشكال أزرارها.
- **لا** تعرف HTTP ولا Postgres ولا مؤقّتات (timers) ولا متغيّرات بيئة.
- **لا** تعتمد على شيء في وقت التشغيل غير `@wasla/contracts-channel` و`@wasla/errors` (محروس باختبار).

اتجاه الاعتماد الملزم: `bots/* → telegram-adapter → channel-core`. النواة لا تستورد ما هو تحتها أبداً.

---

## 2. البنية الداخلية

```text
packages/channel-core/
├── contracts/                  عقود المرحلة (MR 1): OpenAPI · events.json · schema.sql · errors.md
└── src/
    ├── domain/                 مفردات محيّدة + أحداث + مُرمِّز روابط + سياسة إعادة المحاولة
    │   ├── model.ts            ChatRef · InboundUpdate · ButtonIntent · DeliveryRecord · BotPresence · LIMITS
    │   │                       ConversationScope · GroupRole · GroupPresence (MR 6)
    │   ├── errors.ts           ChannelError (يشتق الصنف/الحالة/retryable من كتالوج العقود)
    │   ├── events.ts           بناة الأحداث الأربعة بمغلّف واحد
    │   ├── deep-link.ts        encode/decodeDeepLinkPayload (base64url ≤ 64 حرفاً)
    │   └── retry.ts            exponentialBackoffPolicy + الجدول المنشور
    ├── ports.ts                المنافذ العشرة (الحدود الوحيدة مع الخارج)
    ├── use-cases/              السلوك: receiveUpdate · sendMessage · retryDueDeliveries · سطوح التشغيل
    ├── infrastructure/
    │   └── in-memory.ts        مُهيّئات in-memory + MockChannelAdapter (أداة إثبات بوابة الخروج)
    └── __tests__/              102 اختباراً منها اختبار حراسة معماري
```

---

## 3. المنافذ العشرة

| المنفذ | المسؤولية | مُهيّئ MR 2 (اختبار) | مُهيّئ الإنتاج |
|---|---|---|---|
| `ChannelPort` | إرسال رسالة واحدة وإرجاع نجاح/فشل بكود `CHANNEL_*` | `MockChannelAdapter` | MR 3 (مُهيّئ القناة) |
| `UpdateParserPort` | تحويل حِمل القناة الخام إلى `InboundUpdate` محيّد | `FakeUpdateParser` | MR 3 |
| `ProcessedUpdateStorePort` | `remember` **ذرّي** لمنع التكرار + `has` | `InMemoryProcessedUpdateStore` | MR 5 (Postgres) |
| `DeliveryStorePort` | إنشاء idempotent · تقدّم المحاولات · طابور الاستحقاق · استرجاع الجسم | `InMemoryDeliveryStore` | MR 5 |
| `OutboxPort` | إلحاق حدث مجال بصندوق الصادر | `InMemoryOutbox` | MR 5 |
| `IdentityBootstrapPort` | ضمان وجود هوية عند بدء المحادثة (بدون تخزين ربط) | `FakeIdentityBootstrap` | MR 4 (HTTP) |
| `MiniAppRegistryPort` | حضور البوت: أي Mini App وأي قالب رابط | `StaticMiniAppRegistry` | MR 4 (من الإعداد) |
| `GroupRegistryPort` | أي المجموعات نُشغّلها وبأي دور (دعم/تصعيد/مجتمع) | `StaticGroupRegistry` | MR 6 (من الإعداد) |
| `ClockPort` | الزمن كقيمة قابلة للحقن | `FixedClock` | ساعة النظام (MR 4) |
| `IdGeneratorPort` | معرّفات الأحداث والتسليمات | `SequentialIdGenerator` | `crypto.randomUUID` (MR 4) |

الساعة ومولّد المعرّفات منفذان لسبب واحد: **الاختبارات حتمية**؛ فشل اختبار يشير إلى سلوك لا إلى توقيت.

---

## 4. حالات الاستخدام

### 4.1 `receiveUpdate` — المسار الداخل

ترتيب الخطوات مقصود ومُثبَّت باختبارات:

1. **تفسير** (`UpdateParserPort`) — تحديث غير قابل للتفسير يُرفض قبل أي تغيير حالة (`CHANNEL_INVALID_UPDATE`).
2. **رفض غير المدعوم** — نوع غير مدعوم (`CHANNEL_UNSUPPORTED_UPDATE`) أو أمر غير مُسجّل (`CHANNEL_UNSUPPORTED_COMMAND`) **قبل** تسجيل التحديث، حتى تبقى إعادة المحاولة بعد الإصلاح ممكنة بنفس المعرّف.
3. **منع التكرار ذرّياً** — `remember` يُرجع `false` ⇒ النتيجة `duplicate` (يترجمها المُهيّئ إلى 202) **بلا أي حدث وبلا أي أثر جانبي**.
4. **تهيئة الهوية** — لأمر البدء فقط، وبعد منع التكرار حتى لا يُقصف خدمة الهوية بإعادة إرسال. أي فشل يُترجم إلى `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` (قابل لإعادة المحاولة).
5. **فك الرابط العميق** إن حمله أمر البدء.
6. **إلحاق `channel.update.received`** بصندوق الصادر.

منع التكرار مُقيَّد بـ`(channel, bot, channelUpdateId)` مطابقةً للفهرس الفريد في `schema.sql`؛ بوتان مختلفان قد يريان نفس المعرّف بشكل مشروع.

### 4.2 `sendMessage` — المخرج الوحيد

1. **تحقّق** مقابل `LIMITS` قبل لمس المُهيّئ ⇒ `CHANNEL_INVALID_MESSAGE` (مُثبَت بسبع حالات).
2. **إنشاء idempotent** على `(channel, idempotencyKey)`؛ التكرار يُرجَع `duplicate` **ولا يُرسل ثانية**.
3. **محاولة واحدة** عبر `ChannelPort`، ثم:
   - نجاح ⇒ `sent` + `channel.message.delivered` (+ `channel.mini_app.launched` إن حملت الرسالة زر Mini App — وهذا هو أثر بوابة الخروج).
   - فشل قابل للإعادة والمحاولات < السقف ⇒ يعود `queued` بـ`nextAttemptAt` على **نفس** التسليم، بلا حدث.
   - غير ذلك ⇒ `failed` + `channel.message.failed` مرة واحدة فقط.

جسم الرسالة يُخزَّن مع التسليم (`channel_deliveries.body`) لأن إعادة المحاولة تُرسل *نفس* الرسالة ولا يمكن إعادة بنائها من المُنادي لاحقاً. **هذا العمود أُضيف في MR 2** بعد أن كشفت النواة الحاجة إليه، مع عمود `bot` لعزو حدث فتح الـMini App.

### 4.3 `retryDueDeliveries` — استنزاف الطابور

يعيد محاولة التسليمات المستحقّة فقط، بنفس الصف ونفس مفتاح منع التكرار ونفس الجسم — إعادة المحاولة **محاولة جديدة لا رسالة جديدة**. لا يقرّر شيئاً عن الحدود (ذلك في `RetryPolicy`) ولا يجدول نفسه (المجدول في MR 4/5)، فيبقى خالياً من المؤقّتات وقابلاً للاختبار حتمياً. تسليم مستحقّ فقد جسمه يُفشل بصراحة بـ`CHANNEL_INTERNAL_ERROR` بدلاً من اختراع رسالة بديلة.

### 4.4 سطوح التشغيل

- `getMiniAppLaunch(bot)` ⇒ واصف Mini App من السجل؛ `CHANNEL_UNKNOWN_BOT` لبوت غير مُسجّل، و`CHANNEL_MINI_APP_NOT_CONFIGURED` لبوت مُسجّل بلا Mini App (تمييز مقصود: الأول خطأ نداء والثاني خطأ إعداد).
- `createDeepLink({bot, action, params})` ⇒ يستبدل الحمولة المُرمَّزة في قالب البوت `{payload}`. النواة **لا تؤلّف شكل رابط قناة**؛ بوت بلا قالب يُرفض بدلاً من التخمين.

---

## 5. سياسة إعادة المحاولة

`delay = base · 2^(attempts−1) + jitter`، الأساس ثانية واحدة، السقف 5 محاولات (`MAX_DELIVERY_ATTEMPTS` من العقود)، ونسبة jitter افتراضية 20%. الجدول المنشور بلا jitter: **1s · 2s · 4s · 8s · 16s** (يُدرك أول أربعة فقط عند سقف 5 محاولات). إذا صرّحت القناة بمدة تهدئة (`retryAfterSeconds`) أطول من الحساب ⇒ **التهدئة تفوز**، ويُوسَم القرار `channel_cooldown` ليُقرأ في السجلات. الأكواد القابلة للإعادة تأتي من العقود وحدها: `CHANNEL_RATE_LIMITED` · `CHANNEL_TRANSPORT_ERROR` · `CHANNEL_IDENTITY_BOOTSTRAP_FAILED`.

## 6. تخطيط الأخطاء

`ChannelError` يمتد `WaslaError` ويشتق **الصنف والحالة و`retryable`** من `CHANNEL_ERRORS` + `statusForChannelError` في `@wasla/contracts-channel` — كتالوج واحد لا نسخة ثانية. الاختبارات تؤكّد على **الكود** لا على نصّ الرسالة (الرسائل عربية وقابلة للتغيير).

## 7. اختبار الحراسة المعماري

`src/__tests__/neutrality.guard.test.ts` يقرأ كل ملف `.ts` في الحزمة (بعد إزالة التعليقات، لأن النثر يشرح مشروعاً ما يُمنع في الكود) ويفشل إذا ظهرت مفردات خاصة بقناة (`telegram`, `chat_id`, `web_app`, `bot_token`, `inline_keyboard`, `api.telegram.org`, أسماء دوال Bot API، مكتبات بوتات) أو استيراد من `@wasla/telegram-adapter` أو مكتبة بوت. كما يؤكّد أن اعتماديات الحزمة في وقت التشغيل هما العقود والأخطاء فقط. اسم القناة الوحيد المسموح يأتي **قيمةً** من العقود (`IMPLEMENTED_CHANNEL`) ولا يظهر حرفياً هنا — وهو تحديداً ما يفرضه هذا الاختبار.

## 8. حالة التحقّق (MR 2)

- `pnpm -r run typecheck`: 7 حزم/خدمات ✅
- `pnpm -r run test`: **214 اختبار وحدة** (كان 130 · الحزمة تضيف 84: استلام 10 · إرسال 14 · إعادة محاولة 9 · روابط عميقة 8 · سطوح تشغيل 5 · حراسة 38)
- تكامل Postgres وE2E: في CI فقط (لا يمسّها هذا الـMR)

## 9. المؤجّل صراحة (وأين يُنجَز)

| مؤجّل | يُنجَز في |
|---|---|
| تفسير حِمل القناة الحقيقي + أزرار القناة + تخطيط أخطائها | MR 3 `telegram-adapter` |
| مسارات HTTP (webhook/messages/mini-app/deep-links) + جذور التركيب + مُهيّئ هوية HTTP | MR 4 `bots/*` |
| مُهيّئات Postgres + ناشر صندوق الصادر + مجدول إعادة المحاولة + وظيفة CI | MR 5 |
| ~~منطق المجموعات (دعم/تصعيد)~~ | ✅ MR 6 — [CHANNEL_GROUPS.md](CHANNEL_GROUPS.md) |
| ربط مجموعة↔طلب/مدينة (`channel_group_bindings`) + إعلان الطلبات وقفل الاستلام | Phase 08/16 (خدمة الدعم) |
| E2E لبوابة الخروج (كل بوت ⇄ Mini App الصحيحة + استبدال المُهيّئ) | MR 7 |
