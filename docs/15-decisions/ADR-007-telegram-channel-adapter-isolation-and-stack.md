# ADR-007 — عزل قناة Telegram: موقع المُهيّئ في الشجرة + مكدّس التنفيذ + حدود المنافذ

> **Title:** اعتماد طبقة قنوات محايدة (`@wasla/channel-core`) + مُهيّئ Telegram معزول (`@wasla/telegram-adapter`) + بوتات كجذور تركيب رقيقة، مع منع أي نداء مباشر لواجهة Telegram من الـCore
>
> **Status:** Accepted
>
> **Date:** 2026-08-20
>
> **Decision Owners:** مالك المشروع · Team 12 — Integration/Notifications · Team 01 — Identity · Team 02 — Geography · Team 03 — Bots/Mini Apps · Team 07 — Partners · Team 10 — DevOps · Team 11 — Platform
>
> **Supersedes:** — (لا يُلغي أي قرار سابق؛ يُنفّذ مبدأ [ADR-001](ADR-001-identity-decoupled-from-telegram.md) على مستوى القناة)
>
> **Related:** [ADR-001](ADR-001-identity-decoupled-from-telegram.md) (الهوية مستقلة عن Telegram) · [ADR-003](ADR-003-monorepo-tooling.md) (أساس البناء) · [ADR-004](ADR-004-typed-contracts-from-openapi.md) (العقود المُكتبة) · [ADR-005](ADR-005-identity-service-implementation-stack.md) · [ADR-006](ADR-006-geography-localization-stack-and-model.md) (نفس النمط) · [ROADMAP.md](../16-progress/ROADMAP.md) (Phase 03) · [CONTAINERS.md](../02-architecture/CONTAINERS.md) · [ENGINEERING_DOCUMENTATION_LAW.md §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) (إضافة حزمة/Library جديدة تتطلب مبرراً موثّقاً) · [SECURITY_RULES.md](../00-rules/SECURITY_RULES.md)

---

## Context

Phase 01 (Identity) وPhase 02 (Geography & Localization) مكتملتان، وExit Gate لكل منهما مُتحقَّق في CI (اختبار E2E حقيقي ضد `postgres:15`). الخطوة الموثّقة التالية في [ROADMAP](../16-progress/ROADMAP.md) هي **Phase 03 — Telegram Channel Foundation**، وExit Gate الخاص بها منصوص صراحة:

> «كل Bot يفتح Mini App المناسبة، ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter.»

المتطلبات الموثّقة للمرحلة: ثلاثة بوتات (Customer / Driver / Partner) · أوامر · Deep links · تشغيل Mini App · Identity bootstrap · إعادة المحاولة ومنع التكرار · تجريد مُهيّئ البوت · مُهيّئ المجموعات.

الوضع الحالي في المستودع:

- `bots/{customer,driver,partner}-bot/` و`apps/{customer,driver,partner}-mini-app/` أدلة فارغة (`.gitkeep`) — لا كود قناة إطلاقاً.
- `packages/` تحتوي: `contracts/{identity,geography}` و`errors`.
- `services/` تحتوي 24 خدمة موثّقة في [SERVICES.md](../01-product/SERVICES.md) — **لا توجد خدمة اسمها `telegram` أو `channel`**، والقنوات موثّقة كمسؤولية داخل خدمة `notifications` (Template · Channel · Priority · Retry · Deduplication · Delivery status).
- الوثيقة المرجعية تنص أن السلسلة هي: **Notification Service → Channel Router → Telegram Adapter**، وأن Order Engine/Reputation وغيرها **لا يجوز أن تعرف تفاصيل Telegram**.

السؤال المعماري الذي يجب حسمه قبل أي كود: **أين يسكن كود القناة، وبأي تجريد، وكيف نضمن أن الـCore لا يلمس Telegram؟**

---

## Decision

### 1) الطبقة القناتية = حزم مشتركة، لا خدمة جديدة

لن نُنشئ خدمة رقم 25. القناة **ليست سياقاً محدوداً (Bounded Context)** بل **طبقة توصيل** تخدم كل الخدمات، ولذلك تسكن في `packages/`:

| المسار | الحزمة | المسؤولية |
|---|---|---|
| `packages/channel-core/` | `@wasla/channel-core` | نموذج المجال المحايد + **المنافذ (Ports)** + حالات الاستخدام (استقبال/منع تكرار/تسليم/إعادة محاولة/Deep Link/Mini App) + مُهيّئات in-memory وMock. **صفر معرفة بـTelegram.** |
| `packages/telegram-adapter/` | `@wasla/telegram-adapter` | **المكان الوحيد** الذي يعرف Telegram Bot API: تفسير Update، بناء أزرار `web_app`، تخطيط الأخطاء، حدود المعدّل. |
| `packages/contracts/channel/` | `@wasla/contracts-channel` | الأنواع المُكتبة المُولّدة من العقد (نفس نمط `contracts-identity`/`contracts-geography`). |
| `bots/{customer,driver,partner}-bot/` | — | **جذور تركيب رقيقة (Composition Roots)**: تسجيل الأوامر + عنوان Mini App + تركيب المنافذ. لا منطق مجال. |

مصدر الحقيقة للعقود: `packages/channel-core/contracts/` (نفس نمط `services/geography/contracts/` — العقد يسكن عند مالكه).

**مبرّر إضافة حزمتين جديدتين** (مطلوب بـ[ENGINEERING_DOCUMENTATION_LAW §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md)): الفصل بين `channel-core` و`telegram-adapter` هو الوسيلة التي تُجعل بها بديهية «الاستبدال بـMock» **قابلة للتحقق آلياً**: `channel-core` لا يعتمد على `telegram-adapter` في `package.json`، فأي تسريب لتفاصيل Telegram إلى الـCore يفشل البناء لا المراجعة البشرية.

### 2) المنافذ (Ports) — العقد الداخلي

يُعرّف `@wasla/channel-core` هذه المنافذ، ولكل منها مُهيّئ إنتاج ومُهيّئ اختبار:

| المنفذ | الغرض | مُهيّئ الإنتاج (MR) | مُهيّئ الاختبار |
|---|---|---|---|
| `ChannelPort` | إرسال رسالة صادرة إلى القناة | `TelegramChannelAdapter` (MR 3) | `MockChannelAdapter` (MR 2) |
| `UpdateParserPort` | تحويل تحديث القناة الخام → `InboundUpdate` محايد | `TelegramUpdateParser` (MR 3) | `FakeUpdateParser` (MR 2) |
| `ProcessedUpdateStorePort` | منع تكرار التحديثات (idempotency) | Postgres `channel_updates` (MR 5) | in-memory (MR 2) |
| `DeliveryStorePort` | حالة الرسائل الصادرة + إعادة المحاولة | Postgres `channel_deliveries` (MR 5) | in-memory (MR 2) |
| `OutboxPort` | نشر أحداث المجال | Postgres `channel_outbox` (MR 5) | in-memory (MR 2) |
| `IdentityBootstrapPort` | إنشاء/جلب هوية وصلة عند `/start` | HTTP إلى `identity` (MR 4) | fake (MR 2) |
| `MiniAppRegistryPort` | «أي Mini App يفتحها هذا البوت» | إعداد من البيئة (MR 4) | ثابت في الاختبار |
| `ClockPort` · `RetryPolicy` | زمن + تباطؤ أسّي قابل للحقن | نظامي | مزيّف حتمي |

**قاعدة صلبة:** لا يوجد في `channel-core` أي استيراد لـ`telegram-adapter`، ولا أي نص حرفي مثل `sendMessage` أو `api.telegram.org`. اتجاه الاعتماد أحادي: `bots/*` → `telegram-adapter` → `channel-core`.

### 3) المكدّس التقني

اتساقاً مع [ADR-005](ADR-005-identity-service-implementation-stack.md) و[ADR-006](ADR-006-geography-localization-stack-and-model.md):

| المكوّن | الاختيار | المبرّر |
|---|---|---|
| Runtime | Node.js 20 (LTS) | متوافق مع [ADR-003](ADR-003-monorepo-tooling.md) |
| اللغة | TypeScript 5 (strict) | العقود مُكتبة |
| HTTP (webhook + إرسال) | Fastify (في `bots/*`) + `fetch` المدمج في Node 20 للخروج | لا مكتبة HTTP إضافية |
| مكتبة Telegram | **لا شيء** — عميل رقيق داخل `telegram-adapter` فقط | تفادي حبس المجال بمكتبة بوتات (grammY/telegraf) ومنع تسرّب أنواعها إلى الـCore؛ نحتاج مجموعة صغيرة من نداءات Bot API فقط |
| نمط الاستقبال | Webhook (لا Long Polling) | يُناسب النشر السحابي، ويسمح بالتحقق من secret token، ويُختبر بـ`app.inject` |
| قاعدة البيانات | PostgreSQL 15+ (MR 5) | عقد البيانات بـPostgreSQL DDL |
| ORM | Drizzle ORM (schema-first) | مطابقة الـDDL التعاقدي |
| الاختبارات | Vitest | متوافق مع [ADR-003](ADR-003-monorepo-tooling.md) |

### 4) قواعد التصميم المُلزِمة للمرحلة

1. **مدخل واحد:** `POST /channel/{bot}/webhook` هو المدخل الوحيد للتحديثات. التحقّق من `X-Telegram-Bot-Api-Secret-Token` **قبل** أي معالجة → 401 `CHANNEL_UNAUTHORIZED_WEBHOOK`.
2. **مخرج واحد:** `POST /channel/messages`. **يُمنع** على أي خدمة Core نداء واجهة Telegram مباشرة؛ السلسلة الملزمة: `NotificationService → Channel Router → ChannelPort → TelegramChannelAdapter`.
3. **منع التكرار في الاتجاهين:** الوارد بمفتاح `(channel, bot, channel_update_id)`؛ الصادر بمفتاح `(channel, idempotency_key)`. المكرر يُرجَع `status: duplicate` بـ202 وليس خطأ، ولا يُصدر حدثاً.
4. **الهوية:** `/start` يستدعي `IdentityBootstrapPort` فقط. طبقة القنوات **لا تُخزّن** ربط `chat_ref` ↔ `wasla_public_id` ولا FK إلى `identity_users` — الربط ملك خدمة Identity ([ADR-001](ADR-001-identity-decoupled-from-telegram.md)). `chat_ref` مرجع opaque نصّي.
5. **Mini App:** الـCore يصرّح بالنية (`{type: mini_app, mini_app: driver}`) والمُهيّئ يبني زر `web_app`. عنوان Mini App يجب أن يكون HTTPS في الإنتاج.
6. **Deep Links:** ترميز **بلا حالة** (base64url) بحدّ 64 حرفاً؛ التجاوز → 422 `CHANNEL_DEEP_LINK_TOO_LONG`. جداول الروابط المعتمة مؤجّلة صراحة.
7. **تخطيط الأخطاء:** أخطاء Telegram تُترجم داخل المُهيّئ إلى أكواد `CHANNEL_*` مع علم `retryable`. الـCore لا يرى نص خطأ القناة أبداً.
8. **المدخلات غير موثوقة:** كل حقل قادم من القناة (اسم المستخدم، جهة الاتصال، الموقع) يُتحقّق منه داخل حدود المُهيّئ قبل تمريره ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)). لا رموز في الكود — كلها من البيئة.
9. **مُهيّئ المجموعات:** مجموعات الدعم/التصعيد تُعامل كنوع محادثة (`group`) داخل نفس المنافذ — لا مسار كود مُوازٍ.

### 5) ما هو مؤجّل صراحة (خارج نطاق Phase 03)

- بناء واجهات Mini App نفسها (`apps/*-mini-app`) — مرحلة الويب/التطبيقات.
- مُهيّئات Web/Mobile/WhatsApp (محجوزة في العقد كقيم `channel` فقط).
- `channel_deep_link_tokens` · `channel_group_bindings` · `channel_rate_budgets` (مذكورة كمؤجّلات في نهاية `schema.sql`).
- Channel Router داخل خدمة `notifications` (المرحلة الخاصة بالإشعارات) — المرحلة 03 تُسلّم المنفذ الذي سيستهلكه.

---

## Consequences

**إيجابية**

- Exit Gate يصبح قابلاً للتحقق آلياً: اختبار يُبدّل `TelegramChannelAdapter` بـ`MockChannelAdapter` ويؤكد أن كل بوت يُنتج زر Mini App الصحيح.
- الـCore يبقى نظيفاً من Telegram؛ إضافة قناة جديدة لاحقاً = حزمة مُهيّئ جديدة بلا لمس المجال.
- لا خدمة جديدة → لا انحراف عن [SERVICES.md](../01-product/SERVICES.md) الموثّقة (24 خدمة).
- منع التكرار وإعادة المحاولة مُعرَّفان في العقد قبل الكود، فلا يُعاد اختراعهما لكل بوت.

**سلبية / تكلفة**

- عميل Bot API مكتوب يدوياً: نتحمّل صيانة نداءات قليلة بأنفسنا مقابل عزل أفضل.
- ثلاث حزم + ثلاثة جذور تركيب = ملفات إعداد أكثر من حلّ أحادي.
- المرحلة 03 تبدأ بمُهيّئات in-memory؛ مُهيّئات Postgres تأتي في MR 5 — أي نشر قبل MR 5 يفقد منع التكرار عند إعادة التشغيل (موثّق كقيد، لا مفاجأة).

**مخاطر ومعالجتها**

| الخطر | المعالجة |
|---|---|
| تسرّب تفاصيل Telegram إلى الـCore | لا اعتماد من `channel-core` على المُهيّئ + اختبار حراسة يفحص غياب استيرادات/نصوص Telegram في `channel-core` |
| webhook مكشوف | secret token إلزامي + رفض 401 قبل المعالجة + الرموز من البيئة |
| عاصفة إعادة محاولة | تباطؤ أسّي + احترام `retry_after` + حدّ 5 محاولات + حدث فشل نهائي |
| انحراف العقد عن الكود | أنواع مُولّدة (`@wasla/contracts-channel`) + اختبارات drift على `events.json` (نفس نمط Phase 02) |

---

## Alternatives Considered

| البديل | لماذا رُفض |
|---|---|
| **خدمة `services/telegram`** | يُضيف خدمة 25 غير موثّقة في `SERVICES.md`، ويُثبّت اسم القناة في اسم مكوّن معماري — عكس مبدأ محايدة القناة |
| **كود القناة داخل `services/notifications`** | يخلط التوصيل بالتنسيق، ويُجبر البوتات على الاعتماد على خدمة إشعارات لم تُبنَ بعد؛ الأنسب أن تستهلك `notifications` منفذاً جاهزاً |
| **حزمة واحدة `@wasla/telegram`** (مجال + مُهيّئ) | يستحيل معها إثبات «قابلية الاستبدال بـMock» آلياً — الحدّ يصبح عرفاً لا قيداً |
| **مكتبة بوتات (grammY / telegraf)** | تجرّ أنواعها ونمط middleware إلى منطقنا وتُقاوم تجريد المنافذ؛ احتياجنا محدود بعدد قليل من نداءات Bot API |
| **Long Polling** | لا يناسب النشر السحابي متعدد النسخ، ولا يسمح بالتحقق من secret token، وأصعب في الاختبار من `app.inject` |
| **بوت واحد بثلاثة أدوار** | يخالف المتطلب الموثّق (ثلاثة بوتات) ويخلط تجربة الأدوار وMini Apps |
| **حقل `telegram_chat_id` في الجداول** | يُثبّت القناة في عقد البيانات؛ استُبدل بـ`channel` + `chat_ref` محايدين |

---

## Decision Drivers

1. **Exit Gate قابل للإثبات** لا مجرد ادعاء (استبدال المُهيّئ بـMock).
2. **[ADR-001](ADR-001-identity-decoupled-from-telegram.md):** Telegram قناة لا هوية — يُطبَّق هنا بمنع تخزين أي ربط هوية في طبقة القنوات.
3. **Contract First ([ADR-004](ADR-004-typed-contracts-from-openapi.md)):** العقد (API + أحداث + DDL + أخطاء) قبل الكود.
4. **الاتساق مع Phases 01/02:** نفس المكدّس، نفس بنية العقود، نفس أسلوب الاختبار.
5. **الأمن أولاً:** مدخل واحد مُصادَق، مدخلات غير موثوقة، أسرار من البيئة.
6. **تكلفة تغيير منخفضة لاحقاً:** إضافة قناة = مُهيّئ جديد؛ إضافة بوت = جذر تركيب جديد.

---

## Next Actions

خطة تنفيذ المرحلة 03 كاملة (7 MRs) موثّقة في [HANDOFF_NEXT_STEPS.md §7](../16-progress/HANDOFF_NEXT_STEPS.md). ملخّصها:

| # | MR | المخرج |
|---|---|---|
| 1 | `docs+contracts(channel)` | **هذا الـADR** + عقود القناة + `@wasla/contracts-channel` + خطة المرحلة ✅ |
| 2 | `feat(channel-core)` | نموذج المجال + المنافذ + حالات الاستخدام + مُهيّئات in-memory/Mock + اختبارات وحدة |
| 3 | `feat(telegram-adapter)` | تفسير Update + إرسال + أزرار `web_app` + تخطيط الأخطاء + حدود المعدّل |
| 4 | `feat(bots)` | ثلاثة جذور تركيب Fastify + `/start` + Identity bootstrap + أزرار Mini App + Deep Links |
| 5 | `feat(channel)` | مُهيّئات Postgres (`channel_updates`/`channel_deliveries`/`channel_outbox`) + اختبارات تكامل + وظيفة CI |
| 6 | `feat(channel)` | مُهيّئ المجموعات (دعم/تصعيد) + تحديثات المجموعات |
| 7 | `test(channel)` | **Exit Gate E2E**: كل بوت يفتح Mini App الصحيحة + استبدال المُهيّئ بـMock + إغلاق المرحلة 03 |
