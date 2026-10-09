# ADR-069 — مسار المصادقة البشرية من التطبيقات إلى الخدمات: حدّ قناة واعٍ بالمصادقة (Channel Edge)

| | |
|---|---|
| **الحالة** | **Proposed** — لا يصير Accepted إلا بموافقة مالك البرنامج المكتوبة بعد مراجعة xuuux-voox التقنية. لا تنفيذ قبل ذلك. |
| **التاريخ** | 2026-10-09 |
| **الحجز** | `CLM-0518` · البند `M3-09` (مسار الوصول من التطبيقات إلى الخدمات) |
| **يعالج** | صفوف مصفوفة الاكتمال P-03 · P-04 · A-01 ([`ENGINEERING_COMPLETION_MATRIX.md`](../12-testing/ENGINEERING_COMPLETION_MATRIX.md)) |
| **يبني على (لا يبطل)** | [ADR-001](ADR-001-identity-decoupled-from-telegram.md) · [ADR-018](ADR-018-unified-principal-model-and-user-service-boundary.md) · [ADR-019](ADR-019-human-session-lifecycle-and-init-data-verification.md) · [ADR-020](ADR-020-service-to-service-identity.md) · [ADR-027](ADR-027-authorization-policy-matrix.md) · [ADR-028](ADR-028-token-bound-owner-binding.md) · [ADR-029](ADR-029-tenant-membership-binding.md) · [ADR-036](ADR-036-request-binding-includes-query.md) · [ADR-060](ADR-060-end-user-assertion-propagation.md) |
| **يعدّل بالإضافة** | [ADR-048](ADR-048-app-access-path-static-sites-rewrites.md): وجهة إعادة الكتابة تصير حدّ القناة بدل الخدمة مباشرة (§2.7). جدول البادئات يبقى المصدر الوحيد. |
| **المراجعات** | r1 (2026-10-09): النص الأول، اعتمده xuuux-voox تقنيًا. **r2 (2026-10-09، `CLM-0518`):** إغلاق ملاحظة أمان قبل موافقة المالك — قائمة السماح لم تعد «مشتقة آليًا من الفحص 24»، بل جدول إنفاذ لكل مسار (§2.8)؛ ومسارات تعتمد على `wua1` أو بلا ربط ملكية تُستبعد من قائمة الإنتاج؛ وصُحّحت E-08؛ وأضيفت E-18…E-27 وبوابة G-ENF. |
| **لا يغيّر** | الإنتاج · Render · قواعد البيانات · مسارات المصادقة الحالية · `WASLA_USER_ASSERTION_MODE` · صلاحيات الخدمات — كلها خارج هذه المرحلة |

تم إعداد هذا القرار بموجب التفويض التنفيذي للمالك، ويبقى مقترحًا حتى موافقته الصريحة.

---

## 1. المشكلة المثبتة

### 1.1 ما هو موجود فعلًا (كود مدموج على `a93fe5ec`)

| المكوّن | الموضع | الحالة |
|---|---|---|
| التحقق من `initData` (HMAC، عمر 900 ث، انحراف 60 ث، ترتيب بنية ← توقيع ← عمر) | `packages/telegram-adapter/src/init-data.ts` · `verifyTelegramInitData(raw, botToken, opts)` · `fingerprintInitData` | موجود، مختبر (ADR-019 §5) — **بلا مستدعٍ تشغيلي** |
| إصدار الجلسة والتحقق منها وسحبها (رمز معتم 32 بايت، `sha256` مخزّن، منع إعادة بقيد `uq_identity_sessions_init_data`) | `services/identity/src/use-cases/session.ts` | موجود، مختبر على Postgres (`channel-e2e/m1-02-session-gate`) — **بلا مسار HTTP ولا مستدعٍ** |
| جدول الجلسات | `identity_sessions` في `services/identity/drizzle/0000_*.sql` (`actor_type IN ('customer','driver','admin','support')`) | مُرحَّل |
| هوية الخدمة `wsvc3` (HMAC، ربط بالطلب، منع إعادة، `obo`) | `packages/service-auth` · ترويسة `x-wasla-service-auth` | مفروضة على 17 حدًّا |
| تأكيد المستخدم `wua1` (Ed25519، المصدر `identity` وحدها) | `packages/service-auth/src/user-assertion.ts` · `POST /identity/assertions` | P1 منفّذ؛ المستقبلون `off` في الإنتاج؛ لا مفتاح توقيع مضبوط على Render (ADR-060 §6) |
| جدول التوجيه | `infra/render/app-rewrites.json` (ADR-048) | موسوم LEGACY-ONLY؛ غير مطبّق على حزمة Singapore |

### 1.2 ما ليس موصولًا

1. **لا مسار HTTP لإصدار جلسة.** المواصفة تطلب `POST /identity/sessions/telegram`؛ مسارات identity الفعلية: `resolve`، `users/*`، `assertions` فقط.
2. **التطبيقات لا تنشئ جلسة في الإنتاج.** `setSession` لا يُستدعى إلا خلف `import.meta.env.VITE_E2E === "true"` في `apps/*/src/main.tsx`؛ في البناء الإنتاجي تبقى الشاشة «جارٍ التحميل» إلى الأبد.
3. **عدم تطابق البروتوكول.** `apps/*/src/api/client.ts` يرسل `Authorization: Bearer <token>`، والخدمات تشترط `x-wasla-service-auth` — بوابة M3-09 قاست `401`.
4. **لا مصدر لدور الإدارة.** لا جدول ولا منح يقول إن مستخدمًا ما `admin` أو `support`؛ `PRODUCTION_GRANTS` مفاتيحها أسماء خدمات لا أدوار بشر.
5. **جمهور `wua1` ضيق.** `ASSERTION_AUDIENCES_BY_ACTOR` يغطي 8 خدمات مميزة (identity · negotiations · marketplace · delivery · geography · subscriptions للعميل؛ drivers · matching للسائق) ولا يشمل customers · orders · dispatch · reputation · search التي تناديها التطبيقات.
6. **`actorType` في `VerifiedTelegramSessionRequest` اختياري وافتراضه `customer`** — مصدره يُحسم في §2.6-4.
7. **(r2) المسار `asserted` في الوضع `off` لا يتحقق من شيء.** في `packages/service-auth/src/fastify.ts` تعود `applyUserAssertion` فورًا عند `mode === "off"`، فلا يُضبط `request.endUser`. ولا يُطلب `obo` على هذه المسارات أصلًا (`requireBeneficiary` لا يصدق إلا على `beneficiary: "required"`). فحراس الملكية المبنية على `endUser`، مثل `assertOfferDriver` في dispatch و`assertOwnerFilter` في marketplace، **لا تعمل في الإنتاج اليوم**، لأن الإنتاج `off` (ADR-060 P3 لم يُفعَّل). **فوجود `X-Wasla-User-Assertion` في الطلب ليس دليلًا على التحقق منه.**

### 1.3 حقيقتان أمنيتان تحكمان البدائل

- **مفاتيح `wsvc3` مجموعة واحدة للأسطول غير مربوطة باسم خدمة** (`WASLA_SERVICE_AUTH_KEYS` + `WASLA_SERVICE_AUTH_ACTIVE_KID`؛ `ServiceAuthKeyRegistry` يربط `kid → secret` فقط). من يملك المفتاح يصكّ رمزًا بأي `svc` وأي `scope` وأي `obo`.
- **سقف المنح يُفرض عند المُوقِّع لا عند المستقبل** (`assertSignerComposition` في `outbound.ts`). المستقبل يقرأ الصلاحية من الرمز.

النتيجة: أي مكوّن يملك مفتاح `wsvc3` هو داخل حدّ الثقة الكامل للأسطول. وهذا قائم اليوم للروبوتات الثلاثة (مكشوفة للإنترنت عبر webhook) ولكل خدمة.

### 1.4 تدفق البيانات الحالي (مقيس)

```text
Telegram ──(open Mini App, initData)──▶ المتصفح
المتصفح ──(لا شيء: setSession لا يُستدعى)──▶ شاشة تحميل دائمة
[مسار E2E فقط] المتصفح ──Authorization: Bearer <seeded>──▶ static-site rewrite ──▶ service
service: لا x-wasla-service-auth ⇒ 401
```

## 2. القرار

**البديل A: حدّ قناة واعٍ بالمصادقة (Channel Edge / BFF)، يُركَّب داخل عمليات الروبوتات القائمة للعميل والسائق، وفي عملية حدٍّ مستقلة للإدارة.** البديلان B وC مرفوضان (§4).

### 2.1 التدفق المقترح

```text
(1) إصدار الجلسة
Telegram ──initData (HMAC بمفتاح customer-bot)──▶ المتصفح
المتصفح ──POST /edge/session {init_data}──▶ customer-bot [Channel Edge]
  edge: verifyTelegramInitData(raw, CUSTOMER_BOT_TOKEN, now)   ← telegram-adapter (ADR-019 §1)
  edge: fingerprintInitData(raw)
  edge ──wsvc3(svc=customer-bot, scope=identity:session:issue)
        POST /identity/sessions {init_data_fingerprint, telegram_user_id, username?, first_name?, language_code?}──▶ identity
  identity: actorType ← ASSERTION_ACTOR_BY_CALLER[svc]   (لا من الجسم)
  identity: resolveTelegramIdentity → issueSessionFromTelegram (قيد منع الإعادة 23505 → 409)
  identity ──{token, expires_at, wasla_public_id}──▶ edge ──▶ المتصفح (ذاكرة فقط، ADR-044 §4)

(2) نداء محمي
المتصفح ──Authorization: Bearer <session>  GET /customers/CUS-…/profile──▶ customer-bot [Edge]
  edge: يطابق (method, path) مع قائمة السماح للسطح (جدول الإنفاذ §2.8، لا الفحص 24 وحده)؛ غير ذلك ⇒ 404
  edge: يحذف من الطلب الوارد كل x-wasla-* و Authorization و X-Customer-Public-Id و X-Wasla-User-Assertion
  edge ──wsvc3(scope=identity:session:exchange)
        POST /identity/sessions/exchange {token, audience:["customers"]}──▶ identity
  identity: verifySessionToken (منتهٍ/مسحوب/مجهول) → mintUserAssertion(sub, act, aud, via=customer-bot, ≤60 ث)
  identity ──{wasla_public_id, actor_type, session_expires_at, assertion}──▶ edge
  edge: actor_type يجب أن يساوي فاعل السطح (customer) وإلا 401
  edge ──wsvc3(svc=customer-bot, aud=customers, obo=wasla_public_id) + X-Wasla-User-Assertion──▶ customers
  customers: ownerScoped (ADR-028: obo == :waslaPublicId وإلا 404) · asserted (ADR-060 §2.3)
  ──رد الخدمة كما هو (حالة + جسم)، بلا ترويسات داخلية──▶ المتصفح
```

### 2.2 هوية كل مكوّن وصلاحياته

| المكوّن | الهوية | يملك | لا يملك | الصلاحيات الجديدة المقترحة |
|---|---|---|---|---|
| المتصفح (Mini App) | لا هوية خدمة | `initData` الذي تسلّمه تلغرام · رمز جلسة معتم في الذاكرة | أي مفتاح · أي `wsvc3` · أي `wua1` · سر الروبوت | — |
| customer-bot + Edge | `svc=customer-bot` | `CUSTOMER_BOT_TOKEN` · مفتاح الأسطول (قائم) | مفتاح توقيع `wua1` | `identity:session:issue` · `identity:session:exchange` · `identity:session:revoke` + صلاحيات مسارات تطبيق العميل الـ15 فقط |
| driver-bot + Edge | `svc=driver-bot` | `DRIVER_BOT_TOKEN` · مفتاح الأسطول | كما سبق | نفس صلاحيات الجلسة + صلاحيات مسارات تطبيق السائق الـ16 فقط |
| admin-edge (عملية جديدة، المرحلة 4) | `svc=admin-edge` | سر روبوت الإدارة (يُنشئه المالك) · مفتاح الأسطول | كما سبق | صلاحيات الجلسة + صلاحيات مسارات لوحة الإدارة الـ38، مقيدة بجدول دور→مسار |
| identity | `svc=identity` | مفتاح توقيع `wua1` الخاص (وحده) · `identity_sessions` | أي سر روبوت (ADR-019 §1) | — (هي المستقبل) |
| الخدمات المستقبلة | كما هي | المفاتيح العامة لـ`wua1` | — | لا تغيير في P-03/P-04؛ توسيع `ASSERTION_AUDIENCES_BY_ACTOR` ليشمل customers · orders · dispatch · reputation · search |

### 2.3 مصدر الأسرار والإعدادات

| المتغير | أين | الحالة اليوم | ملاحظة |
|---|---|---|---|
| `CUSTOMER_BOT_TOKEN` / `DRIVER_BOT_TOKEN` | customer-bot / driver-bot فقط | مضبوط | لا ينتقل إلى أي عملية أخرى — ميزة تركيب الحد في الروبوت |
| `WASLA_SERVICE_AUTH_KEYS` · `_ACTIVE_KID` | كل الخدمات | مضبوط | لا تغيير |
| `WASLA_USER_ASSERTION_SIGNING_KEY` | identity وحدها | **غير مضبوط في الإنتاج** | شرط المرحلة 3 (قرار مالك، دورة المفتاح في `USER_ASSERTION_KEY_LIFECYCLE.md`) |
| `WASLA_USER_ASSERTION_PUBLIC_KEYS` | المستقبلون + الحدود | غير مضبوط | كما سبق |
| `WASLA_EDGE_SESSION_CACHE_SECONDS` (جديد) | الحدود | — | افتراض 0 (لا تخزين)؛ حد أقصى 30 ث (§2.5) |
| `WASLA_EDGE_ALLOWED_ORIGINS` (جديد) | الحدود | — | منشأ الموقع الثابت للسطح فقط |
| `ADMIN_BOT_TOKEN` (جديد، المرحلة 4) | admin-edge وحدها | غير موجود | يُنشئه المالك عبر BotFather |

كل متغير جديد يُسجَّل في `packages/config/env-registry.json` (M2-04) قبل استعماله.

### 2.4 أدوار الإدارة والدعم (A-01)

- **مصدر الحقيقة:** جدول جديد تملكه identity، `identity_staff_grants (wasla_public_id, role IN ('admin','support'), granted_by, granted_at, revoked_at, reason)`.
- **الإسناد:** بأداة CLI تحمل هوية خدمة وصلاحية `identity:staff-grant:write` لا تُمنح لأي حد، ويشغّلها المالك وفق دليل تشغيل. كل إسناد أو سحب يُكتب في `identity_history`. **لا مسار HTTP يمنح دورًا من المتصفح.**
- **الإصدار:** `POST /identity/sessions` من `admin-edge` يُصدر جلسة `actor_type` = الدور من المنح الساري. فإن لم يوجد منح ⇒ `403 IDENTITY_STAFF_GRANT_REQUIRED` بلا جلسة. أي `actorType` في الجسم **يُتجاهل**.
- **القناة:** لوحة الإدارة تُفتح Mini App من روبوت إدارة مخصص، فيُعاد استعمال `verifyTelegramInitData` نفسه بلا بروتوكول جديد، بقناة `telegram` القائمة. وTelegram Login Widget بديل مرفوض لهذه المرحلة: خوارزميته مختلفة (`secret = sha256(bot_token)`)، وتحتاج قناة `admin_web` جديدة في `CHECK` وفي `SESSION_CHANNELS` (ADR-019 §6).
- **السحب:** سحب المنح يسحب كل جلسات المستخدم من ذلك الدور في المعاملة نفسها.

### 2.5 الإلغاء والانتهاء وتعذّر identity

- **العمر:** جلسة 4 س بلا تجديد (ADR-019 §8). عند الانتهاء يرد الحد `401 AUTHN_EXPIRED`، فيطلب التطبيق `initData` جديدًا. ولأن `initData` نفسه يُرفض بعد 900 ث أو عند إعادته، يُطلب من المستخدم إعادة فتح التطبيق المصغّر.
- **السحب:** `POST /edge/session/logout` يستدعي `revokeSession`. أثره فوري، لأن الحد يتحقق في **كل** نداء عبر `exchange` ولا يخزّن مؤقتًا افتراضيًا. وتخزين مؤقت ≤ 30 ث خيار تشغيلي مكتوب الثمن: تأخر السحب بقدره.
- **تعذّر identity:** يفشل الحد مغلقًا بـ`503 EDGE_IDENTITY_UNAVAILABLE` مع `Retry-After`. لا رجوع إلى نداء بلا `obo` أو بلا تأكيد. وتبقى webhooks الروبوتات وصحتها تعمل.
- **تعذّر الخدمة المستقبلة:** يمرّر الحد ردّها كما هو. وعند المهلة يرد `504` بلا تفاصيل داخلية.

### 2.6 شروط أمنية مُلزِمة (تُختبر كلها، §6)

1. الحد **لا يقرأ** `actor` ولا الدور ولا الصلاحيات ولا هوية المالك ولا المستأجر من جسم الطلب أو ترويساته. مصدر `obo` الوحيد هو `wasla_public_id` العائد من `exchange`.
2. الحد يحذف من الطلب الوارد كل ترويسة `x-wasla-*` و`authorization` و`x-customer-public-id` و`x-wasla-user-assertion` قبل التوجيه، ويصنعها هو.
3. التحقق من `initData` يجري في الحد بمكتبة `telegram-adapter` وبسر الروبوت الصاحب للسطح. وidentity لا تستورد `telegram-adapter` ولا تملك سر روبوت.
4. `actorType` يُشتق في identity من هوية الخدمة المنادية (`customer-bot→customer`، `driver-bot→driver`، `admin-edge→` الدور من المنح)، كما في `ASSERTION_ACTOR_BY_CALLER` القائم.
5. لا يُصدَّر رمز الجلسة إلا مرة واحدة، ولا يُسجَّل رمز ولا `initData` ولا تأكيد ولا سر في أي log. يُسجَّل `describePrincipal` (بصمة 8 محارف) والمعرّف العام فقط.
6. **(r2، يحلّ محل النص الأول)** قائمة السماح لكل سطح **ملف صريح يُراجَع**، لا اشتقاق آلي. وكل مدخل يربط المسار بفئة إنفاذ وبالصلاحية المطلوبة عند المستقبل وبمسار الاختبار الدليل (§2.8). أما الفحص 24 (`app_api_routes.py`) فيبقى **حدًّا أعلى**: لا يُقبل في القائمة مسار لا يناديه التطبيق. لكنه لا يُدخل مسارًا لمجرد وجوده. ومسار غير مدرج (`/dispatch/tick`، `/delivery/relay/*`، `/identity/assertions`…) يرد عليه الحد بـ`404` قبل أي نداء خلفي.
9. **(r2)** لا يُفتح للتطبيقات في الإنتاج مسار يعتمد تفويضه على `wua1` ما دامت الخدمة المستقبلة غير مُثبَتة في `enforce`. ولا مسار بلا ربط ملكية أو مستأجر بالهوية الموثّقة. وتفعيل `enforce` يبقى قرار ADR-060 P3 للمالك (بوابة **G-ENF**، §2.8). وهذا القرار لا يغيّر أي إعداد حي.
7. الحد لا يقبل إلا منشأ موقعه الثابت (`WASLA_EDGE_ALLOWED_ORIGINS`)، ويرفض `Bearer` في query string، ولا يضع الرمز في cookie (ADR-044 §4).
8. حد معدّل على `POST /edge/session` لكل `telegram_user_id` ولكل IP، وهو أيضًا يسدّ دين ADR-060 §2.5.

### 2.8 (r2) بوابة الإنفاذ لكل مسار يكشفه الحد

**القاعدة.** لا يدخل مسار قائمة السماح الإنتاجية إلا إذا انتمى إلى فئة مسموحة **وفي الوضع الحالي للمستقبل في الإنتاج**، لا في الوضع الذي تفرضه بيئة الاختبار.

| الفئة | تعريفها (مقيس في الكود) | هل تعمل والإنتاج في `off`؟ | الحكم في الإنتاج |
|---|---|---|---|
| **O · ملكية بـ`obo`** | `beneficiary: "required"`، والمعالج يقارن `ownerPublicIdOf(caller)` بمعرّف المسار أو الجسم (ADR-028). الحد يضع `obo` من الجلسة الموثّقة وحدها | **نعم.** الوسيط يرفض رمزًا بلا `obo`، والمقارنة في المعالج لا تقرأ `endUser` | **يُفتح** بشرط اختبارات E-18 وE-19 على المسار نفسه |
| **P · قراءة عامة** | لا تحمل هوية ولا ملكية، وتعيد بيانات الفهرس العام فقط | لا تعتمد على الهوية | **مشروط:** الحد يثبّت معاملات الاستعلام (E-20)، ويُثبت اختبار أن الجواب لا يحوي إلا المنشور. والدليل **لم يُكتب بعد**، فلا يُفتح قبله |
| **W · تعتمد على `wua1`** | `beneficiary: "asserted"`، وحارس الملكية مبني على `request.endUser` | **لا.** الحارس لا يعمل (§1.2-7) | **محجوب** حتى G-ENF للخدمة المعنية |
| **N · بلا ربط** | `scoped`/`internalScoped` بلا مقارنة بهوية المستخدم | لا ربط في أي وضع | **محجوب** حتى يُضاف حارس ملكية مختبر (حجز مستقل)، ثم يُعاد تصنيفه O |
| **ADM · إدارة** | كل مسارات `admin-portal` | — | **محجوب** حتى المرحلة 4. ويلزم جدول دور→مسار يُراجَع مسارًا مسارًا |

**G-ENF (بوابة مالك مستقلة لكل خدمة):** تُنقل مسارات W لخدمة ما إلى القائمة الإنتاجية بثلاثة شروط مجتمعة: (1) قرار مالك مكتوب بتفعيل ADR-060 P3 لتلك الخدمة، (2) دليل منشور أن المستقبل في `enforce` (§9-6)، (3) نجاح E-26 على تلك الخدمة. ولا يُنفَّذ أيٌّ من ذلك ضمن ADR-069.

#### تصنيف المسارات الـ67 (تطبيق×مسار) على `a93fe5ec`

**تطبيق العميل (13 مسارًا مميزًا):**

| المسار | الحارس | الفئة | الحكم |
|---|---|---|---|
| `GET·PUT /customers/:waslaPublicId/profile` · `GET·POST /customers/:waslaPublicId/places` · `DELETE /customers/:waslaPublicId/places/:placeId` · `GET·POST /customers/:waslaPublicId/order-requests` · `POST …/order-requests/preview` (8) | `ownerScoped` | O | يُفتح؛ الدليل القائم: `services/customers/src/__tests__/service-identity.test.ts` («مُنتَفِعٌ يخالف :waslaPublicId → 404») و`saved-places.test.ts` («hides another customer's place behind a 404») |
| `GET /reputation/scores/:subjectType/:subjectPublicId` | `ownerScoped` | O | يُفتح؛ `services/reputation/src/__tests__/service-identity.test.ts` («مُنتَفِعٌ يخالف :subjectPublicId → 404») |
| `GET /search/products` | `internalScoped` | P | مشروط (E-20 + دليل «المنشور فقط») |
| `GET /stores/:storeSlug/products` | `scoped` | P | مشروط: `parseProductQuery` يقبل `state` و`moderation_state` و`visible_only`. فالحد يرفض الأولين ويثبّت `visible_only=true` (E-20) |
| `GET /stores` | `assertedStaff` | W | **محجوب:** `assertOwnerFilter` لا يعمل في `off`، و`?owner_public_id=<other>` يمر (`user-assertion-ownership.integration.test.ts`: «lists without an assertion») |
| `GET /reputation/ratings` | `internalScoped` | N | **محجوب:** `subject_public_id` من الاستعلام بلا ربط، ولم تُراجع خصوصية ما يعيده |

**تطبيق السائق (16):**

| المسار | الحارس | الفئة | الحكم |
|---|---|---|---|
| `GET·PATCH /drivers/:waslaPublicId` · `GET·POST /drivers/:waslaPublicId/documents` · `GET·POST /drivers/:waslaPublicId/vehicles` · `PATCH …/vehicles/:vehicleId` · `GET·PUT /drivers/:waslaPublicId/zones` (9) | `ownerScoped` | O | يُفتح؛ `services/drivers/src/__tests__/service-identity.test.ts` («مُنتَفِعٌ يخالف :waslaPublicId → 404») و`repository.integration.test.ts` (المركبة بالمالك) |
| `GET /orders/drivers/:driverPublicId/jobs` | `ownerScoped` | O | يُفتح؛ `services/orders/src/__tests__/http/driver-jobs.test.ts` («beneficiary is a different driver (404)») |
| `POST /dispatch/offers/:offer_id/accept` · `…/reject` | `assertedDriver` | W | **محجوب حتى G-ENF(dispatch):** `assertOfferDriver` يعود بلا فحص حين `endUser` غائب، فسائق يقبل عرض غيره |
| `GET /dispatch/jobs/:job_id` · `GET …/offers` · `POST …/cancel` | `scoped` | N | **محجوب:** لا ربط بالسائق؛ والإلغاء خصوصًا فعل كتابة على مهمة أي سائق |
| `POST /orders/:orderId/transitions` | `scoped` | N | **محجوب:** لا ربط بالسائق المسند |

**بوابة الإدارة (38):** كلها ADM ومحجوبة حتى المرحلة 4. وفيها 7 مسارات `ownerScoped` (5 لـdrivers و2 لـorders)، ومساران `tenantScoped`: هذه ترفض الموظف بطبيعتها (404/403) لأن `obo` الموظف لا يطابق المالك، فتحتاج مسارات إدارية مستقلة بصلاحية إدارة لا تجاوزًا للحارس. ومساران `asserted` (support) تحكمهما G-ENF(support). و27 مسارًا `scoped`/`internalScoped`/`adminScoped` لا تتحقق من دور بشري عند المستقبل، فيحرسها جدول دور→مسار في `admin-edge` مع اختبارات A-*.

**الحصيلة للتطبيقين (29):** O = 19 تُفتح · P = 2 مشروطة بدليل لم يُكتب · W = 3 محجوبة حتى G-ENF · N = 5 محجوبة حتى حارس جديد. والإدارة 38 محجوبة.

**صيغة المدخل (المرحلة 2):** `packages/channel-edge/allowlist/<surface>.json`، وكل مدخل `{method, path, service, class, required_scopes, evidence_tests[]}`. ويضاف فحص CI جديد (`edge-allowlist-guard`) **يفشل** إذا:
(أ) كان المدخل W أو N أو ADM في القائمة الإنتاجية، إلا W مدرجة في `enforce-gates.json` بقرار مالك ودليل منشور؛
(ب) خالفت الفئة المعلنة تصنيف المستقبل الفعلي المقروء من كود الخدمة. مثال: O والمسار ليس `beneficiary: "required"`، أو أزيلت مقارنة المالك من المعالج؛
(ج) غاب `evidence_tests` أو أشار إلى ملف أو حالة غير موجودة؛
(د) لم يناد التطبيق المسار في الفحص 24.

### 2.7 أثره على ADR-048

ADR-048 رفض البوابة **حلًّا للتوجيه**، لأن الحاجة يومها كانت «نفس المنشأ» فقط. والحاجة هنا مختلفة: **حدّ ثقة** يتحقق من دليل بشري ويحوّله إلى هوية خدمة وتأكيد موقّع. وهذا لا يُحل بإعادة كتابة.

التعديل بالإضافة: الموقع الثابت يعيد كتابة بادئات `app-rewrites.json` إلى مضيف حدّ السطح (`customer-bot` / `driver-bot` / `admin-edge`) بدل مضيف الخدمة، والحد يوجّه بالجدول نفسه. فيبقى الجدول مصدرًا وحيدًا، ويبقى الفحص 24 بابه السادس صالحًا.

والكلفة التشغيلية: **صفر عمليات جديدة** للعميل والسائق، لأن الحد يركب في الروبوتين القائمين. أما الإدارة فعملية واحدة جديدة في المرحلة 4، وأثرها على RISK-0066 مذكور في §5.

## 3. لماذا داخل الروبوتات للعميل والسائق

- **نفس حد الثقة القائم:** ADR-060 §2.4 عرّف الروبوت «حدّ قناة» يطلب التأكيد ولا يصكّه. والحد هنا هو الروبوت نفسه يخدم قناة ثانية من التطبيق نفسه.
- **سر الروبوت لا يتحرك:** `verifyTelegramInitData` يحتاج سر الروبوت الذي فتح التطبيق، وهو في عملية الروبوت أصلًا. أما عملية حدّ منفصلة فكانت تستلزم نسخ سرّي روبوتين إلى عملية ثالثة.
- **اشتقاق الفاعل محسوم بلا كود جديد:** `ASSERTION_ACTOR_BY_CALLER` يربط `customer-bot→customer` و`driver-bot→driver` اليوم، فلا يستطيع تطبيق العميل الحصول على جلسة سائق، لأن `initData` موقّع بسر روبوت العميل ولا يتحقق بسر روبوت السائق.
- **الثمن المكتوب:** عملية الروبوت تحمل حملين (webhook + API التطبيق)، فعطل أحدهما قد يمس الآخر. والتخفيف حدود منفصلة لكل مسار، ومهلات `@wasla/resilience`. والفصل لاحقًا إلى عملية مستقلة لا يغيّر العقد، لأن الحد وحدة `packages/channel-edge` تُركَّب ولا تُكتب في الروبوت.
- **لماذا لا يكون الحد للإدارة في روبوت قائم:** الإدارة أعلى صلاحية (38 مسارًا في 8 خدمات)، ودمجها مع سطح عام يوسّع نطاق الضرر. فهي عملية مستقلة وروبوت مستقل.

## 4. مقارنة البدائل

| المعيار | **A. حدّ قناة (المختار)** | B. وسيط جلسة عند كل خدمة | C. رموز خدمة للمتصفح |
|---|---|---|---|
| حد الثقة | الحد داخل الأسطول (يملك مفتاح `wsvc3` كالروبوتات اليوم)؛ المتصفح خارج كل حد | كل خدمة من 17 تصير نقطة دخول بشرية من الإنترنت | المتصفح داخل حد الأسطول |
| من يتحقق من `initData` | الحد بـ`telegram-adapter` (ADR-019 §1 محفوظ) | يجب أن يكون خارج الخدمات؛ فيعود السؤال نفسه | — |
| التحقق من الجلسة | `exchange` لدى identity في كل نداء | كل خدمة تنادي identity في كل طلب (يخالف ADR-018 §2: «الفرض مكتبة لا خدمة في المسار الحرج») أو تتحول الجلسة إلى JWT (يخالف ADR-019 §4) | — |
| هوية المستخدم للمستقبل | `obo` + `wua1` القائمان (ADR-028/060) بلا تغيير في الخدمات | بروتوكول ثالث بجانب `wsvc3` و`wua1` في 17 حدًّا | `obo` يختاره المتصفح |
| أثر على الخدمات الحالية | لا تغيير في المعالجات؛ توسيع جمهور `wua1` ومنح جديدة فقط | تعديل وسيط كل خدمة + مصفوفة دور بشري→صلاحية في كل حد (يخالف ADR-018 §5) | — |
| الكلفة التشغيلية | 0 عمليات للعميل/السائق؛ 1 للإدارة | 0 عمليات، لكن نداء identity إضافي داخل كل خدمة | — |
| تعذّر identity | التطبيقات تفشل مغلقة (503)؛ الروبوتات والخدمات النظامية سليمة | كل مسار بشري في 17 خدمة يفشل؛ وتسرّب الفشل إلى مسارات مختلطة | — |
| الإلغاء والانتهاء | فوري (تحقق كل نداء) | فوري لكن بكلفة ×17 | رمز `wsvc3` لا يُسحب إلا بتدوير مفتاح الأسطول كله |
| الرجوع | إزالة التركيب + إعادة الكتابة إلى الخدمة (= حال اليوم، 401) | تعديل 17 حدًّا للخلف | — |
| **الحكم** | **مختار** | **مرفوض**: يكسر قراري ADR-018 §2 وADR-019 §4، ويضاعف السطح ×17 | **مرفوض قطعًا** (§4.1) |

### 4.1 لماذا C مرفوض قطعًا

- **مفتاح في المتصفح:** مفاتيح `wsvc3` متماثلة وغير مربوطة بخدمة (§1.3)، فمفتاح في المتصفح يعني أن كل مستخدم يصكّ رمزًا بأي `svc` وأي صلاحية وأي `obo`. وهذا اختراق كامل للأسطول.
- **رموز يصكّها الخادم للمتصفح لكل طلب (presigned):** المتصفح يختار المسار والطريقة، فيجب أن يقرر خادم ما الذي يُوقّع، وهذا هو البديل A بلا تمرير. ويكشف رموزًا صالحة لإضافات المتصفح ولـXSS، ويضاعف الذهاب والإياب، ولا يحل مصدر `obo`. ومنع الإعادة في `wsvc3` يحرق الرمز بعد أول استعمال فلا يصلح للإعادة عند انقطاع الشبكة.
- **الاستنتاج:** لا شكل من C يحقق «لا يستطيع المتصفح إنشاء `x-wasla-service-auth` صالح».

## 5. الأثر التشغيلي والمخاطر

- **RISK-0066 (خطة Render):** العميل والسائق بلا عملية جديدة. أما admin-edge فعملية جديدة تستهلك ساعات مجانية إن بقيت مستيقظة، والمرحلة 4 مشروطة بقرار المالك في الخطة.
- **الحمل على identity (RISK-0067):** نداء `exchange` لكل نداء تطبيق، والمسبح محدود بـ`max=2` (CLM-0510). فقبل الفتح الحي يُضاف سيناريو التطبيقات إلى خطة الحمل المعزولة L1، ولا يُغيَّر `pool_size` قبل القياس.
- **نطاق الضرر:** اختراق customer-bot اليوم يعطي مفتاح الأسطول، وكذلك بعد القرار، فلا يتسع حد الثقة. ويضاف سطح HTTP عام جديد على عملية الروبوت، وتخفيفه قائمة السماح (§2.6-6) وحد المعدل وحذف الترويسات.
- **RISK-0042:** لا يتغير. فالحد يجعل `obo` مشتقًا من جلسة متحقَّق منها، لكن إغلاقه يبقى بشرط ADR-060 P3 (`enforce` في الإنتاج).

## 6. خطة التنفيذ المرحلية (بعد الموافقة فقط)

كل مرحلة حجز مستقل، يُدمج بمراجعة xuuux-voox ونجاح CI. ولا مرحلة تغيّر الإنتاج إلا 3 و5، وكلتاهما بموافقة مكتوبة.

| المرحلة | النطاق | الصف | معيار القبول |
|---|---|---|---|
| **1 · إصدار الجلسة (P-03)** | مسارات identity: `POST /identity/sessions` · `POST /identity/sessions/exchange` · `POST /identity/sessions/revoke`؛ صلاحيات `identity:session:{issue,exchange,revoke}` للروبوتين في `PRODUCTION_GRANTS`؛ `actorType` من المنادي؛ توسيع جمهور `wua1`؛ عقد OpenAPI؛ تصنيف المسارات في مصفوفة الربط | P-03 | اختبارات §7 (I-*) على Postgres حقيقي في `channel-e2e`؛ حارس الصلاحيات (الفحص 16) أخضر |
| **2 · حدّ القناة (P-04)** | `packages/channel-edge` (Fastify plugin): `POST /edge/session` · `/edge/session/logout` · التوجيه بقائمة سماح صريحة مصنّفة (§2.8) + فحص `edge-allowlist-guard` · حذف الترويسات · fail-closed؛ تركيبه في customer-bot وdriver-bot؛ التطبيقان: تهيئة الجلسة من `Telegram.WebApp.initData` في `main.tsx` بدل خطاف E2E وحده | P-04 | حزمة `app-edge-e2e` جديدة: مستمعون حقيقيون + Postgres + `signInitDataForTests` بسر روبوت اختباري ⇒ ملف العميل 200، وكل حالات §7 (E-*)؛ **والمستقبلون في الوضع `off` كالإنتاج** لحالات E-18/E-19/E-25، لا في `enforce` وحده؛ وقائمة الإنتاج تحوي O فقط (+P بعد دليلها) |
| **G-ENF · لكل خدمة (بوابة مالك مستقلة)** | تفعيل ADR-060 P3 (`observe` ثم `enforce`) للخدمة، ثم نقل مساراتها W إلى القائمة الإنتاجية | D-07 وجزء من C-07 | **قرار مالك مكتوب لكل خدمة**؛ E-26 + §9-6. وليست جزءًا من تنفيذ ADR-069 |
| **3 · التفعيل على Singapore (P-05)** | مواقع ثابتة على الحزمة الحالية، وإعادة الكتابة إلى الروبوتين، وضبط مفاتيح `wua1` | P-05 | **تغيير إنتاجي: قرار مالك مكتوب**؛ deploy smoke + فحص منشأ |
| **4 · الإدارة (A-01)** | روبوت إدارة (المالك ينشئه)؛ ترحيل `identity_staff_grants`؛ CLI للمنح؛ `admin-edge`؛ جدول دور→مسار (admin/support) | A-01 | اختبارات §7 (A-*)؛ **ترحيل قاعدة + خدمة جديدة: قرار مالك** |
| **5 · البرهان الحي** | رحلة واحدة: فتح التطبيق من تلغرام ⇒ جلسة ⇒ قراءة الملف ⇒ تعديله ⇒ خروج ⇒ رفض | O-08 جزئيًا | **قرار مالك:** بحساب المالك الحقيقي (بيانات حقيقية لا تركيبية) أو بحزمة staging معزولة؛ لا بيانات اختبار في قاعدة الإنتاج |

**لا يُعلن اكتمال المصادقة** بإضافة ADR أو مسار. المعيار رحلة المرحلة 5 مثبتة، بنجاح وفشل وأدلة.

## 7. حالات الاختبار

### 7.1 identity (I-*)

| ID | الحالة | المتوقع |
|---|---|---|
| I-01 | `issue` من customer-bot ببصمة صحيحة | 201 `{token, expires_at, wasla_public_id}`؛ `actor_type=customer` |
| I-02 | `issue` بالبصمة نفسها مرة ثانية | 409 `IDENTITY_SESSION_REPLAY` |
| I-03 | `issue` بجسم يحمل `actor_type: "admin"` من customer-bot | يُتجاهل الحقل؛ `actor_type=customer` |
| I-04 | `issue` من خدمة بلا `identity:session:issue` (مثل dispatch) | 403 |
| I-05 | `issue` بلا `x-wasla-service-auth` | 401 |
| I-06 | `exchange` برمز صحيح وجمهور مسموح | 200 + `wua1` صالح (`aud`، `sub`، `via=customer-bot`، ≤60 ث) |
| I-07 | `exchange` برمز منتهٍ | 401 `AUTHN_EXPIRED` |
| I-08 | `exchange` برمز مسحوب أو مجهول | 401 `AUTHN_UNAUTHENTICATED` بالنص نفسه (ADR-019 §6-5) |
| I-09 | `exchange` لجمهور خارج قائمة الفاعل | 403 `IDENTITY_ASSERTION_FORBIDDEN` |
| I-10 | `exchange` من driver-bot لجلسة عميل | 403 (الفاعل لا يطابق المنادي) |
| I-11 | مستخدم معلّق | 403 `IDENTITY_USER_SUSPENDED` بلا جلسة |
| I-12 | لا مفتاح `wua1` | 503 `IDENTITY_ASSERTION_UNAVAILABLE` |
| I-13 | السجلات أثناء I-01..I-12 | لا رمز ولا بصمة كاملة ولا `internal_uuid` (فحص نصّي للسجل) |

### 7.2 الحد (E-*)

| ID | الحالة | المتوقع |
|---|---|---|
| E-01 | `initData` صحيح ⇒ جلسة ⇒ `GET /customers/{self}/profile` | 200 والجسم من الخدمة |
| E-02 | `initData` بتوقيع مزوّر / مبتور / حقول مكررة | 401 بلا تشخيص أدق (ADR-019 §5) |
| E-03 | `initData` أقدم من 900 ث / من المستقبل > 60 ث | 401 |
| E-04 | `initData` من روبوت السائق إلى حد العميل | 401 (التوقيع لا يتحقق بسر آخر) |
| E-05 | إعادة `initData` نفسه | 409 |
| E-06 | `GET /customers/{other}/profile` بجلسة صحيحة | 404 (ADR-028) |
| E-07 | المتصفح يرسل `x-wasla-service-auth` أو `X-Wasla-User-Assertion` أو `X-Customer-Public-Id` مزوّرة | تُحذف؛ النتيجة كأنها غائبة |
| E-08 | جسم يحمل `actor_type`/`owner_public_id`/`acting_party` مخالفًا | **(r2، مصحَّحة)** على مسار O: يُرفض بمقارنة `obo` (ADR-028)، **بلا اعتماد على `endUser`**. على مسار W: المسار غير مكشوف في الإنتاج (E-21). ولا تصعيد في أي حال |
| E-09 | مسار غير مدرج (`POST /dispatch/tick`، `/identity/assertions`) | 404 من الحد، ولا نداء خلفي |
| E-10 | بلا `Authorization` / رمز في query | 401 |
| E-11 | identity متوقفة | 503 `EDGE_IDENTITY_UNAVAILABLE` + `Retry-After`؛ لا نداء خلفي |
| E-12 | الخدمة المستقبلة متوقفة / بطيئة | تمرير 503 / 504 بلا تفاصيل داخلية |
| E-13 | `logout` ثم النداء نفسه | 401 فورًا (بلا تخزين مؤقت) |
| E-14 | منشأ غير مسموح | 403 |
| E-15 | تجاوز حد المعدل على `/edge/session` | 429 |
| E-16 | جلسة سائق على حد العميل | 401 |
| E-17 | المستقبل في `enforce` مع تأكيد صحيح | 200؛ وبتأكيد منتهٍ 401 `AUTHN_USER_ASSERTION_EXPIRED` |
| **E-18** | (r2) لكل مسار O في القائمة: جلسة A ومعرّف B في المسار، **والمستقبل في `off`** | 404؛ ويفشل الاختبار إن رجع 200. ويتكرر في `observe` و`enforce` بالنتيجة نفسها |
| **E-19** | (r2) لكل مسار O يقبل جسمًا: حقل `owner_public_id`/`acting_party`/`customer_public_id`/`driver_public_id`/`wasla_public_id`/`rater_public_id` لهوية أخرى، والمستقبل في `off` | 400/404، أو قيمة مخزنة = `obo` الجلسة. ولا يُقبل أن تُخزَّن هوية الجسم |
| **E-20** | (r2) مسارات P: `state=draft` أو `moderation_state=pending` أو `visible_only=false` أو `owner_public_id` | 400 من الحد؛ والجواب لا يحوي إلا المنشور المرئي |
| **E-21** | (r2) مسار W في القائمة الإنتاجية بلا مدخل في `enforce-gates.json` | `edge-allowlist-guard` يفشل في CI |
| **E-22** | (r2) مسار N أو ADM في قائمة سطح العميل أو السائق | الفحص يفشل |
| **E-23** | (r2، طفرة) إزالة مقارنة المالك من معالج مسار O، أو تغيير `beneficiary` إلى غير `required` | الفحص يفشل، وE-18 تفشل |
| **E-24** | (r2) مدخل بلا `evidence_tests` أو بإشارة إلى اختبار غير موجود | الفحص يفشل |
| **E-25** | (r2) مسار ينادى في الفحص 24 لكنه غير مدرج في القائمة (مثل `/dispatch/jobs/:job_id/cancel`) | 404 من الحد، ولا نداء خلفي. لا إضافة آلية |
| **E-26** | (r2، لبوابة G-ENF) سائق A يقبل عرضًا لسائق B عبر الحد، والمستقبل في `enforce` | 404 `OFFER_NOT_FOUND`. ويُسجَّل أن الحالة نفسها في `off` تعطي 200، وهذا سبب الاستبعاد |
| **E-27** | (r2) طلب عبر الحد يحمل `X-Wasla-User-Assertion` صالحًا لكن المستقبل في `off` | لا يُحتسب تحققًا: الاختبار يتأكد أن `request.endUser` غير مضبوط، وأن أي مسار W غير مكشوف |

### 7.3 الإدارة (A-*)

| ID | الحالة | المتوقع |
|---|---|---|
| A-01 | مستخدم بمنح `admin` ساري | جلسة `admin`؛ مسارات الإدارة 200 |
| A-02 | مستخدم بلا منح | 403 `IDENTITY_STAFF_GRANT_REQUIRED`، بلا جلسة |
| A-03 | `support` يطلب مسار إدارة (مثل `POST /customers/:id/suspend`) | 403 من الحد |
| A-04 | سحب المنح أثناء الجلسة | النداء التالي 401 |
| A-05 | جسم `actorType=admin` من حد العميل | يُتجاهل؛ لا تصعيد |
| A-06 | كل فعل إداري | يصل بـ`obo` = المعرف العام للموظف، ويُسجَّل في التدقيق (ADR-063) |

## 8. الرجوع

- **المرحلتان 1–2:** إضافية بالكامل، ولا تمسّان مسارًا قائمًا. والرجوع revert للدمج، ولا ترحيل لأن `identity_sessions` قائم.
- **المرحلة 3:** إعادة كتابة المواقع إلى مضيفات الخدمات، فتعود الحال إلى ما هي عليه اليوم (401، بلا ضرر على الروبوتات). وسحب جماعي للجلسات بـ`UPDATE identity_sessions SET revoked_at` عبر دليل التشغيل عند اشتباه.
- **المرحلة 4:** الترحيل `up/down` مختبر (DB-01). وإيقاف admin-edge يوقف الإدارة وحدها.

## 9. ما يحتاج إثباتًا في بيئة منشورة

1. فتح التطبيق المصغّر من تلغرام الحقيقي يولّد `initData` يتحقق عند الحد (سر الروبوت الحقيقي).
2. إعادة الكتابة من الموقع الثابت إلى الحد تحفظ `Authorization` والجسم والمسار.
3. زمن `exchange` تحت الحمل ضمن ميزانية p95، وعدم استنزاف مسبح identity (يرتبط بـRISK-0067).
4. السحب يُرى فورًا في الإنتاج.
5. لا رمز في سجلات Render (فحص نصّي لسجلات النشر).
6. **(r2، لبوابة G-ENF)** قبل نقل أي مسار W: دليل قراءة فقط أن `WASLA_USER_ASSERTION_MODE=enforce` مضبوط على الخدمة المستقبلة المنشورة، وأن طلبًا عبر الحد بتأكيد مفقود أو مخالف يُرفض فعلًا بـ401/403 في البيئة المنشورة. ولا يكفي اختبار CI يفرض `enforce`.
7. **(r2)** القائمة المنشورة في الحد تطابق ملف `allowlist` المدموج (بصمة الملف في `/health` الحد أو في سجل الإقلاع)، فلا يُكشف مسار لم يمر بالفحص.

## 10. أثره على صفوف المصفوفة المحجوبة (22)

| الصفوف | بعد المرحلة | يبقى بعدها |
|---|---|---|
| P-03 | 1 | دليل حي (5) |
| P-04 | 2 | P-05 (3) ودليل حي |
| C-02 · C-03 | 2 (+3 للحي) | — |
| C-07 | 2 للمنتجات (P، بعد دليلها) | `GET /stores` (W) حتى G-ENF(marketplace) |
| C-08 | 2 (P، بعد دليلها) | — |
| C-09 | 2 للنقاط (O) | `GET /reputation/ratings` (N) حتى حارس ربط |
| C-04 · C-05 | 2 | **D-03** (لا مُنشئ لمهمة التوزيع) — مستقل عن هذا القرار |
| C-06 | 2 | ربط تفاصيل الطلب في الواجهة |
| R-05 · R-06 | 2 | — |
| D-07 | — | **G-ENF(dispatch)** (W) |
| D-08 | — | حارس ربط السائق المسند على `POST /orders/:orderId/transitions` ومسارات dispatch الثلاثة (N)، بحجز مستقل |
| R-02 (جزء التطبيق) | 2 | زر التوفر في الواجهة |
| R-04 | 2 للسائق؛ 4 لمراجعة الإدارة | مسارات مراجعة الإدارة `ownerScoped` ترفض الموظف، فتحتاج مسارًا إداريًا مستقلًا |
| A-01 · A-02 · A-03 · S-03 · S-07 | 4 | A-03: اختبارات الشاشة؛ S-07: 3 مسارات بلا اختبار |
| O-08 | 5 | D-03 للرحلة الكاملة |

لا يُرفع صف إلى `COMPLETE` إلا بشروط المصفوفة الخمسة.

## 11. ما لا يقرره هذا القرار

- تجديد الجلسة (refresh) — يبقى مؤجلًا (ADR-019 §8).
- قنوات web/mobile خارج تلغرام.
- تفعيل `WASLA_USER_ASSERTION_MODE=enforce` — يبقى ADR-060 P3 بقرار المالك.
- mTLS أو مفاتيح خدمة مربوطة باسم الخدمة (ADR-020 §6). وهو تحسين يقلل نطاق الضرر في §5، ولا يحجب هذا القرار.
