# بوتات القناة وطبقة تشغيلها — `@wasla/bot-runtime` + `bots/*`

> **النوع:** وثيقة معمارية تنفيذية · **المرحلة:** Phase 03 — Telegram Channel Foundation · **الدفعة:** MR 4/7
> **Last Updated:** 2026-08-21 · **Status:** مُنفَّذ (90 اختبار وحدة في الطبقة · 438 في المستودع بعد MR 6)
> **مُحدَّث لاحقاً:** Phase 04 · MR 5/6 أضاف بذرة المحادثة (`onConversation`) وربط تدفقات بوت العميل — التفصيل في [CUSTOMER_BOT_FLOWS.md](CUSTOMER_BOT_FLOWS.md)، وهذه الوثيقة تبقى مرجع الطبقة المحيّدة.
>
> **Related:** [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) (القرار الحاكم) · [CHANNEL_LAYER_CORE.md](CHANNEL_LAYER_CORE.md) (النواة والمنافذ) · [CHANNEL_TELEGRAM_ADAPTER.md](CHANNEL_TELEGRAM_ADAPTER.md) (المُهيّئ) · [CHANNEL_GROUPS.md](CHANNEL_GROUPS.md) (المجموعات · MR 6) · [CONTAINERS.md §2 و§5.1](CONTAINERS.md) · [عقد القناة](../../packages/channel-core/contracts/README.md) · [كتالوج الأخطاء](../../packages/channel-core/contracts/errors.md) · [SECURITY_RULES](../00-rules/SECURITY_RULES.md)

---

## 1. لماذا توجد هذه الطبقة، ولماذا حزمة مشتركة

بوابة خروج المرحلة 03 تقول: «**كل Bot يفتح Mini App المناسبة**، ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter». هذه الدفعة هي التي تجعل الشطر الأول قابلاً للتشغيل: ثلاثة تطبيقات قابلة للنشر، كل واحد يخدم بوتاً واحداً ويفتح تطبيقه المصغّر وحده.

**لماذا ثلاثة تطبيقات لا واحد؟** لأن كل بوت يملك **رمز Telegram خاصاً به ورمز webhook خاصاً به**. دمجها في عملية واحدة يجعل تسريب رمز واحد تسريباً للثلاثة، ويجعل تعطّل تحديث بوت العميل يوقف السائقين والشركاء معه. الفصل هنا فصل **نطاق ضرر** لا تفضيل شكلي.

**لماذا حزمة مشتركة `@wasla/bot-runtime` بدل ثلاث نسخ؟** (مبرّر الحزمة الجديدة الذي تفرضه [ENGINEERING_DOCUMENTATION_LAW §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md)):

1. **الـwebhook هو نقطة الدخول الوحيدة غير الموثوقة في وصلة**، والتحقّق من رمزه *هو* مصادقته. ثلاث نسخ من هذا التحقّق تعني ثلاثة أماكن تتعفّن مستقلةً، ونسخةً واحدةً ستنسى الفحص يوماً. النسخة الواحدة تُختبر مرة وتصحّ للثلاثة.
2. **بوابة الخروج تُفحَص مرة لا ثلاثاً**: قاعدة «بوت واحد ⇄ Mini App واحدة» تُفرَض في مكان واحد (`SingleBotRegistry`)، فيصبح خطأ التوصيل مستحيلاً بدل أن يكون مكشوفاً بالمراجعة.
3. **اتجاه الاعتماد يبقى أحادياً**: `bots/*` → `@wasla/bot-runtime` → `@wasla/telegram-adapter` → `@wasla/channel-core`. لا شيء في هذه الطبقة يعرف حالة استخدام، ولا شيء تحتها يعرف HTTP.

ما تبقّى في كل جذر بعد ذلك: **اسم بوته فقط**. لا معالج، ولا مسار، ولا قاعدة عمل.

---

## 2. البنية الداخلية

```text
packages/bot-runtime/src/
├── config.ts               البيئة → BotConfig (فحص صارم) + SingleBotRegistry
├── system.ts               SystemClock + CryptoIdGenerator (منفذا الساعة والمعرّفات في الإنتاج)
├── identity-bootstrap.ts   IdentityBootstrapPort عبر HTTP إلى خدمة الهوية
├── welcome.ts              نص الترحيب + بناء ردّ /start (زر Mini App واحد)
├── runtime.ts              التركيب: المكان الوحيد الذي يسمّي مُهيّئاً ملموساً
├── http/app.ts             سطح عقد القناة على Fastify (webhook · messages · mini-app · deep-links)
├── http/errors.ts          ChannelError → جسم Error الموحّد بالكود والحالة
├── http/server.ts          buildBotApp / startBot / runBot (شؤون العملية: بيئة · منفذ · خروج)
├── index.ts                السطح العام + مبرّر الحزمة
└── __tests__/              80 اختباراً في سبعة ملفات

bots/<customer|driver|partner>-bot/src/
├── server.ts               `buildApp()` = buildBotApp("<bot>") — بلا أثر جانبي
├── main.ts                 الملف الوحيد الذي يربط منفذاً
├── index.ts                السطح العام (BOT + buildApp)
└── __tests__/              6 اختبارات: هل يخدم بوته ويرفض الآخرين؟
```

كل ملف يبدأ بتعليق يشرح **لماذا** يوجد لا ماذا يفعل، كما تفرض [ENGINEERING_DOCUMENTATION_LAW](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md).

---

## 3. سطح HTTP (نفس عقد القناة، حرفياً)

المصدر الحاكم هو [`packages/channel-core/contracts/api.openapi.yml`](../../packages/channel-core/contracts/api.openapi.yml). لا مسار هنا خارج العقد، ولا حقل يُعاد بغير أسماء العقد (`snake_case`).

| المسار | الحماية | ماذا يفعل | الاستجابة |
|---|---|---|---|
| `GET /health` | — | حالة العملية | `200 {status, channel}` — `degraded` إذا لم تُوصَل خدمة الهوية |
| `POST /channel/{bot}/webhook` | ترويسة `X-Telegram-Bot-Api-Secret-Token` | تفسير التحديث → منع التكرار → تهيئة الهوية لـ`/start` → صندوق الصادر | `202 UpdateAccepted` |
| `POST /channel/messages` | داخلي (شبكة الكلستر) | رسالة صادرة واحدة عبر `sendMessage` | `202 DeliveryAccepted` |
| `GET /channel/{bot}/mini-app` | — | وصف Mini App هذا البوت | `200 MiniAppLaunch` |
| `POST /channel/{bot}/deep-links` | داخلي | رابط عميق من قالب البوت | `200 DeepLinkResponse` |

**ترتيب مقصود في الـwebhook:** التحقّق من الرمز يسبق **كل شيء** — قبل قراءة الجسم وقبل معرفة أي بوت في المسار. سبب ذلك أن أي عمل يُنجَز قبل المصادقة هو عمل يستطيع الغريب أن يُجبرنا عليه.

**`202` حتى للتكرار:** Telegram يعيد إرسال أي تحديث لا يُجاب بـ`2xx`. لذلك التحديث المُعاد يعود `202 {status:"duplicate"}` لا خطأً، والتحديث الذي فشل ردّ الترحيب عليه يعود `202` أيضاً — التحديث مُسجَّل أصلاً، والتسليم مُقيَّد في صندوق الصادر، فلا فائدة من دفع Telegram لإعادة إرسال شيء سنرفضه بعدها كمكرّر.

**`failed` ليست حالة في العقد:** إذا رفضت القناة التسليم رفضاً دائماً، يُعاد كود الخطأ نفسه (`CHANNEL_CHAT_UNREACHABLE` → 422) بدل اختراع حالة تسليم لا يعرفها العقد.

---

## 4. ردّ `/start` — بوابة الخروج نفسها

`/start` هو الأمر الوحيد المدعوم في المرحلة 03 (`DEFAULT_SUPPORTED_COMMANDS`). الردّ رسالة واحدة من نوع `text_with_buttons` بزرّ **واحد** من نوع `mini_app` يشير إلى `BOT_MINI_APP[bot]`:

| البوت | Mini App | نص الترحيب الافتراضي (قابل للتخصيص من جذر التركيب) |
|---|---|---|
| `customer` | `customer` | ترحيب العميل |
| `driver` | `driver` | ترحيب السائق |
| `partner` | `partner` | ترحيب الشريك |

مفتاح التكرار (`idempotencyKey`) للردّ هو `start:<bot>:<channel_update_id>`: إعادة إرسال التحديث نفسه لا تُنتج رسالة ترحيب ثانية، حتى لو نجح منع التكرار وفشل شيء بعده.

`mini_app` في الزرّ يجب أن يطابق Mini App البوت، وإلا رفضه المُهيّئ ([CHANNEL_TELEGRAM_ADAPTER §4](CHANNEL_TELEGRAM_ADAPTER.md)). أي أن قاعدة بوابة الخروج مُفروضة في طبقتين، لا موصوفة في وثيقة فقط.

وبعد MR 7 صارت مُثبَتة في طبقة ثالثة: البوتات الثلاثة تعمل معاً في اختبار واحد أمام خدمة هوية واحدة، فيُقاس أن customer→customer · driver→driver · partner→partner فعلاً لا في كل بوت على انفراد — [بوابة خروج Phase 03](../12-testing/PHASE03_EXIT_GATE_E2E.md).

---

## 5. التهيئة من البيئة (لا عنوان ولا رمز في الكود)

`<BOT>` أحد `CUSTOMER` · `DRIVER` · `PARTNER`.

| المتغيّر | إلزامي | الافتراضي | لماذا يُفحَص عند الإقلاع |
|---|---|---|---|
| `<BOT>_BOT_TOKEN` | نعم | — | بلا رمز لا إرسال؛ الفشل عند أول مستخدم أسوأ من الفشل عند الإقلاع |
| `<BOT>_BOT_WEBHOOK_SECRET` | نعم | — | ≥ 16 محرفاً (`MIN_WEBHOOK_SECRET_LENGTH`)؛ رمز قصير = webhook مفتوح فعلياً |
| `<BOT>_BOT_MINI_APP_URL` | نعم | — | HTTPS إلزامي؛ Telegram لا يفتح `http` وسيظهر العطل للمستخدم لا للمشغّل |
| `<BOT>_BOT_MINI_APP_LABEL` | لا | نص عربي لكل بوت | نص الزر |
| `<BOT>_BOT_DEEP_LINK_TEMPLATE` | لا | — | يجب أن يحتوي `{payload}` وإلا فالقالب يُنتج روابط بلا حمولة صامتةً |
| `<BOT>_BOT_PORT` ثم `PORT` | لا | 8083 / 8084 / 8085 | منفذ الاستماع |
| `IDENTITY_SERVICE_URL` | لا (لكن…) | — | بدونه يعود `/health` بـ`degraded` و`/start` بـ503 |
| `IDENTITY_TIMEOUT_MS` | لا | 2000 | مهلة نداء الهوية |
| `SUPPORT_GROUP_CHAT_IDS` | لا | — | مجموعات الدعم، مفصولة بفواصل ([CHANNEL_GROUPS.md](CHANNEL_GROUPS.md)) — مرجع فارغ أو مكرَّر بدورين يمنع الإقلاع |
| `ESCALATION_GROUP_CHAT_IDS` | لا | — | مجموعات التصعيد؛ الغرفة غير المُعلَنة تُسجَّل بلا أي ردّ |
| `COMMUNITY_GROUP_CHAT_IDS` | لا | — | مجموعات مجتمع الكباتن |
| `CUSTOMER_DATABASE_URL` | لا | — | **بوت العميل وحده** (Phase 04): بوّابة تدفقات المجال؛ بغيابه لا يُسجَّل `/places` ولا `/orders` ([CUSTOMER_BOT_FLOWS §8](CUSTOMER_BOT_FLOWS.md)) |
| `GEOGRAPHY_SERVICE_URL` | لا | — | **بوت العميل وحده**: مراجع المناطق داخل نواة العميل؛ لا تحتاجه القراءات الثلاث |

> `DATABASE_URL` (مخازن القناة) و`CUSTOMER_DATABASE_URL` (نواة العميل) **متغيّران منفصلان** بقصد: قاعدة القناة تحتفظ بمنع التكرار وطابور التسليم، وقاعدة العميل ببيانات شخصية. مرجع واحد لهما جائز في التطوير، لكن الكود لا يفترضه أبداً.

**فشل الإقلاع صريح:** `loadBotConfig` يرمي خطأً **يسمّي المتغيّر الناقص ولا يطبع قيمته أبداً** (SECURITY_RULES). لا قيم افتراضية للأسرار ولا وضع «تطوير» يتجاوز الفحص، لأن قيمة افتراضية لرمز webhook تعني بوتاً بلا مصادقة في أول نشر يُنسى فيه المتغيّر.

---

## 6. تهيئة الهوية عبر HTTP

`HttpIdentityBootstrap` يُنفّذ `IdentityBootstrapPort` بنداء واحد:

```text
POST {IDENTITY_SERVICE_URL}/identity/resolve
{ telegram_user_id, telegram_language_code?, source: "<bot>_bot" }
  ├─ 200 → { waslaPublicId, created: false }
  ├─ 201 → { waslaPublicId, created: true }
  └─ غير ذلك / مهلة / شبكة → CHANNEL_IDENTITY_BOOTSTRAP_FAILED (503، قابل للإعادة)
```

تصنيف الفشل هو جوهر هذا الملف: عطل نقل **قابل للإعادة** (التحديث يُعاد لاحقاً فينجح)، ومعرّف مستخدم غير رقمي **دائم** (`CHANNEL_INVALID_UPDATE`) لأنه لن يُصلَح بإعادة المحاولة. العكس يُهدر ميزانية الإعادة أو يُسقط مستخدماً كان سينجح.

**بلا خدمة هوية مُهيّأة**، يرفض `UnconfiguredIdentityBootstrap` بوضوح ولا يختلق `wasla_public_id`: هوية مُختلَقة ستُخزَّن عبر حدث صندوق الصادر ولا يمكن مطابقتها بعدها أبداً. و`/health` يقول `degraded` **قبل** أن يرسل مستخدم أول `/start`.

**فجوة معروفة (مقصودة، لا سهو):** عقد الهوية يستقبل `telegram_user_id` و`telegram_username`، أي أنه **مصوغ بشكل Telegram**، بينما `InboundActor` في النواة محايد ولا يحمل `username` أصلاً. النتيجة: (أ) لا نرسل `telegram_username`؛ (ب) قناة غير Telegram ستحتاج تعديل عقد الهوية. القرار: لا يُصلَح في المرحلة 03 لأن إصلاحه يعني تغيير عقد خدمة قائمة، ومحلّه المرحلة التي تُدخل قناة ثانية (Web/WhatsApp) — مذكور في [HANDOFF](../16-progress/HANDOFF_NEXT_STEPS.md) حتى لا يُكتشَف متأخراً.

---

## 7. التركيب — المكان الوحيد الذي يسمّي مُهيّئاً

`buildBotRuntime(config, overrides?)` هو الموضع الوحيد في النظام العامل الذي يذكر `TelegramChannelAdapter`. ما فوقه يعتمد على منافذ فقط، وهذا ما يجعل أكسيوم ADR-007 **قابلاً للاختبار** لا موعوداً: في `runtime.test.ts` و`bots/*/src/__tests__`، تُحقن `MockChannelAdapter` و`FakeIdentityBootstrap` عبر نفس الدالة، ويعمل كل ما فوقها بلا تغيير سطر واحد.

| المنفذ | الإنتاج | الاختبار |
|---|---|---|
| `ChannelPort` | `TelegramChannelAdapter` | `MockChannelAdapter` |
| `UpdateParserPort` | `TelegramUpdateParser` | نفسه (تحديثات Telegram خام) |
| `IdentityBootstrapPort` | `HttpIdentityBootstrap` | `FakeIdentityBootstrap` |
| `ClockPort` / `IdGeneratorPort` | `SystemClock` / `CryptoIdGenerator` | `FixedClock` / `SequentialIdGenerator` |
| `MiniAppRegistryPort` | `SingleBotRegistry` (من البيئة) | `StaticMiniAppRegistry` |
| التخزين الثلاثي | **في الذاكرة (مؤقّت)** | في الذاكرة |

---

## 8. حالة التحقّق

| المستوى | العدد | ماذا يُثبت |
|---|---|---|
| `bot-runtime/webhook.test.ts` | 14 | رمز خاطئ/مفقود/غير مُهيّأ ⇒ 401 بلا أي معالجة · `/start` للبوتات الثلاثة يفتح Mini App الصحيحة · تكرار ⇒ `202 duplicate` بلا إرسال ثانٍ · بوت آخر ⇒ 404 · جسم فاسد ⇒ 400 · أمر غير مدعوم ⇒ 422 |
| `bot-runtime/messages.test.ts` | 8 | تخطيط `snake_case` → أمر محايد · أزرار Mini App والرابط العميق · تكرار المفتاح ⇒ `duplicate` · فشل قابل للإعادة ⇒ `queued` · فشل دائم ⇒ كود القناة |
| `bot-runtime/launch-surfaces.test.ts` | 8 | Mini App لكل بوت + رفض غيره · روابط عميقة من القالب وحده |
| `bot-runtime/config.test.ts` | 18 | كل خطأ نشر يُلتقط عند الإقلاع (رمز ناقص · سرّ قصير · `http` · قالب بلا `{payload}` · منفذ غير رقمي) |
| `bot-runtime/identity-bootstrap.test.ts` | 7 | 200/201 · تصنيف الفشل قابل للإعادة مقابل دائم · `source` الصحيح |
| `bot-runtime/runtime.test.ts` | 3 | التركيب من البيئة وحدها · استبدال القناة والهوية بلا تغيير فوقهما · `degraded` |
| `bots/*/…` | 6 × 3 | كل تطبيق قابل للنشر يخدم بوته **ويرفض الآخرين بـ404** |

المجموع في المستودع بعد هذه الدفعة: **376 اختبار وحدة** (`pnpm -r run test`)، و`pnpm -r run typecheck` نظيف على 12 مشروعاً.

الاختبارات تتحقّق من **الأكواد** لا من النصوص العربية ([DEFINITION_OF_DONE](../00-rules/DEFINITION_OF_DONE.md))، ولا يفتح أي اختبار منفذاً (`app.inject` وحده).

---

## 9. المؤجّل صراحةً (وأين يُنجَز)

| المؤجَّل | الأثر الآن | محلّه |
|---|---|---|
| ~~**التخزين في Postgres**~~ | **أُنجز في MR 5**: مع `DATABASE_URL` تُركّب مُهيّئات `@wasla/channel-postgres` للمنافذ الثلاثة فيعبر منع التكرار وطابور المحاولات إعادة التشغيل؛ وبغيابه تبقى مجموعة الذاكرة للتشغيل المحلي و`runtime.persistence` يُعلن أيّهما يعمل | ✅ [CHANNEL_PERSISTENCE.md](CHANNEL_PERSISTENCE.md) |
| إعادة محاولة التسليم المستحقّ (`retryDueDeliveries`) كعمل دوري | الطابور صار **دائماً** بعد MR 5، لكن لا شيء يستدعيه دوريّاً: الرسالة المُهدَّأة تبقى `queued` حتى نداء صريح. **لم يُنجَز في MR 7** (بوابة الخروج لا تنصّ عليه، وإضافة مُشغّل دوري داخلها كانت ستُخرجها عن نطاقها) | أول عمل تشغيلي في Phase 04 — مُدرَج في [HANDOFF §الديون](../16-progress/HANDOFF_NEXT_STEPS.md) |
| ~~مُهيّئ المجموعات (الدعم/التصعيد)~~ | **أُنجز في MR 6**: الغرف تُعلَن في البيئة (`SUPPORT_GROUP_CHAT_IDS` وأخواتها) وتُركّب سجلّاً واحداً للاتجاهين؛ `/start` في غرفة مُعلَنة يُجاب برابط عميق داخلها، والغرفة المجهولة تُسجَّل بلا أي رسالة | ✅ [CHANNEL_GROUPS.md](CHANNEL_GROUPS.md) |
| ربط مجموعة↔طلب/مدينة · إعلان الطلبات · قفل الاستلام · أوامر الإشراف | منطق أعمال خارج طبقة القنوات | Phase 08/16 (خدمة الدعم) |
| واجهات `apps/*-mini-app` | الرابط يفتح عنواناً من البيئة، والواجهة نفسها ليست في هذه المرحلة | مرحلة الواجهات |
| `telegram_username` في تهيئة الهوية | لا يُرسَل (فجوة §6) | مرحلة القناة الثانية |
| موجّه القناة داخل `notifications` | `POST /channel/messages` يُنادى مباشرة | مرحلة الإشعارات |
| ~~سلوك مجال داخل بوت~~ | **أُنجز في Phase 04 · MR 5/6**: بذرة `onConversation` تسمح للجذر بتسليم دالّة واحدة تأخذ حدثاً محايداً وتُعيد نصاً أو صمتاً؛ فطبقة القناة بقيت بلا أي فرع مجال، وبوت العميل ربط `/start` و`/places` و`/orders` | ✅ [CUSTOMER_BOT_FLOWS.md](CUSTOMER_BOT_FLOWS.md) |
| تدفقات مجال لبوتَي السائق والشريك | البذرة متاحة لهما ولا تدفّق مربوطاً؛ مسارهما كما كان | Phase 06 (السائق) · Phase 08 (الشريك) |

---

## 10. كيف تُشغّل بوتاً محلياً

```bash
export CUSTOMER_BOT_TOKEN="…"                     # من BotFather
export CUSTOMER_BOT_WEBHOOK_SECRET="…"            # ≥ 16 محرفاً، عشوائي
export CUSTOMER_BOT_MINI_APP_URL="https://…"      # HTTPS إلزامي
export IDENTITY_SERVICE_URL="http://localhost:8080"
export SUPPORT_GROUP_CHAT_IDS="-1001,-1002"        # اختياري: غرف الدعم التي يردّ فيها البوت
corepack pnpm --filter @wasla/customer-bot run dev
```

ثم يُوجَّه webhook الخاص بالبوت إلى `POST /channel/customer/webhook` مع **نفس** الرمز في `secret_token`. أي طلب بلا الرمز يعود 401 بكود `CHANNEL_UNAUTHORIZED_WEBHOOK`، وهذا هو السلوك المطلوب لا عطل.
