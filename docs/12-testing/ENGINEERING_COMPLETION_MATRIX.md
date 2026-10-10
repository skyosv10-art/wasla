# مصفوفة الاكتمال الهندسي — ENGINEERING COMPLETION AUDIT (CLM-0517)

- **التاريخ:** 2026-10-09 · **main المُدقَّق:** `76d60fa832f080e5329538120ee22dd492b0b46a` (مُتحقَّق محليًا = API)
- **النطاق:** جرد فقط — لا تغيير إنتاجي، لا بيانات في قاعدة الإنتاج، لا partition، لا تغيير في `pool_size`/`max_connections`/كود الاتصال.
- **الجرد الآلي القابل للإعادة:** `python3 scripts/audit/engineering_completion_inventory.py --out <file>` — اللقطة:
  [`ci-evidence/2026-10-09T120000Z-clm-0517-engineering-completion-audit/inventory.json`](ci-evidence/2026-10-09T120000Z-clm-0517-engineering-completion-audit/inventory.json)
- **الأدلة اليدوية والأوامر:** [`README.md` في مجلد الأدلة](ci-evidence/2026-10-09T120000Z-clm-0517-engineering-completion-audit/README.md)

## 1. قواعد الحكم

الحالات المسموحة فقط: `COMPLETE` · `PARTIAL` · `BLOCKED` · `DEFERRED` · `NOT APPLICABLE`.

`COMPLETE` لا تُمنح إلا باجتماع الخمسة: (1) كود محدد، (2) مستدعٍ حقيقي في التشغيل (أو N/A موثّق)،
(3) اختبار نجاح **و**اختبار فشل، (4) دليل قابل للإعادة، (5) التكامل المطلوب مُتحقَّق منه.
مستوى الدليل يُذكر صراحة: **CI-PG** = حزمة E2E في CI على PostgreSQL حقيقي ومستمعي HTTP حقيقيين (تركيبي، معزول)؛
**LIVE** = بيئة منشورة. **لا يُعدّ** اختبار الوحدات ولا `200` من `/health` ولا اختبارات Playwright المُحاكاة (`page.route`)
دليلًا على تدفق مستخدم كامل.

> **قاعدة رئيسية لهذه المصفوفة:** `COMPLETE` هنا تعني «مكتمل هندسيًا على مستوى CI-PG». لا توجد رحلة مستخدم LIVE واحدة
> مُثبتة (الصف O-08) — وهذا مسجّل بوصفه فجوة مستقلة، لا يُخفَّف بمنح `COMPLETE`.

## 2. الأعداد

| الحالة | العدد |
|---|---|
| COMPLETE | 13 |
| PARTIAL | 39 |
| BLOCKED | 4 |
| DEFERRED | 6 |
| NOT APPLICABLE | 3 |
| **المجموع** | **65** |

**الجرد الآلي (من `inventory.json`):** 184 مسارًا (162 مسارًا مجاليًا + 22 صحة/جاهزية) في 17 خدمة ·
159/162 لها اختبار يذكر المسار، 157/162 فيها إشارة نجاح وفشل (مؤشر نصّي تقريبي لا حكم) · **3 مسارات بلا أي اختبار**
(`partners DELETE /partners/credentials/:id` · `POST /partners/lifecycle/suspend` · `POST /partners/lifecycle/reinstate`) ·
74 نداء تطبيق: 0 غير محلول و0 بلا مسار مطابق · المستدعون: 65 مسارًا من تطبيق، 29 من خدمة/روبوت عبر HTTP،
**68 بلا مستدعٍ HTTP تشغيلي** (فُحصت يدويًا: بعضها يُستدعى داخل العملية من الروبوتات أو من `tick-scheduler`، والبقية بلا أي مستدعٍ — انظر الأعمدة).
26 شاشة: 0 معالج فارغ؛ مؤشرات `placeholder` هي سمات حقول إدخال لا شاشات وهمية.

## 3. المصفوفة

الأعمدة: الميزة → الواجهة → المستدعي → الخلفية → قاعدة البيانات → التكامل → الاختبارات → الدليل → الحالة.

### 3.1 المنصة والمسارات المشتركة

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | هوية خدمة-لخدمة موقّعة + منع الإعادة على 17 حدًّا | — | كل محوّلات `http-*.ts` + الروبوتات | `packages/service-auth` (`x-wasla-service-auth`) | متجر إعادة Postgres (`replay-postgres.ts`) | CI-PG | `dispatch-e2e` (401/403/إعادة/ربط مسار) + وحدات | `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md` | **COMPLETE** |
| P-02 | حدود المالك/المستأجر (125 SCOPED · 37 OWNER_SCOPED) | — | كل المسارات المالكة | `ownerScoped`/`assertedActors` | — | CI-PG جزئي | حراس + وحدات | RISK-0042 مفتوح، M0-49 In Progress | **PARTIAL** — الملكية «مُدَّعاة من المنادي» (RISK-0042) |
| P-03 | إصدار جلسة بشرية من Telegram initData | Mini Apps | **لا أحد** | `services/identity/src/use-cases/session.ts` + `telegram-adapter/init-data.ts` | `identity_sessions` | لا | وحدات `session.test.ts`، `channel-e2e/m1-02-session-gate`، **`channel-e2e/clm-0519-identity-sessions` (I-01..I-13)** | المواصفة تطلب `POST /identity/sessions/telegram`؛ المساراتُ الثلاثةُ (`POST /identity/sessions`، `POST /identity/sessions/exchange`، `POST /identity/sessions/revoke`) **أُضيفت في CLM-0519 (2026-10-09)** مع نطاقاتِ `identity:session:{issue,exchange,revoke}` في PRODUCTION_GRANTS واختبارِ I-01..I-13 على Postgresِ حقيقي؛ يبقى `wua1` غير مُستعمَلٍ من أيّ عميلِ إنتاجٍ (لا `bot-runtime` يُبدّلُ ولا تطبيقُ يستهلك) — **البرهانُ الحيّ مطلوب** | **PARTIAL** — الكودُ والاختباراتُ موجودةٌ؛ لا مُستدعٍ إنتاجيّ ولا برهانٌ حيّ |
| P-04 | وصول المتصفح من التطبيقات إلى الخدمات | 3 تطبيقات | `apiClient` يرسل `Authorization: Bearer` | الخدمات تشترط `x-wasla-service-auth` (رمز خدمة) | — | **مقيس فاشلًا:** بوابة M3-09 قاست `401` من الخدمات | — | `docs/12-testing/M3-09_GATE.md`؛ ADR-048 «لا يزعم رحلة مصادقة كاملة» | **PARTIAL** — التوجيه موجود، جسر المصادقة (BFF/edge يحوّل الجلسة البشرية إلى رمز خدمة + user assertion) غير موجود؛ كل تدفقات التطبيقات معطّلة تشغيليًا · **(تحديث 2026-10-10 · CLM-0521):** صيغةُ قائمةِ سماحِ الحدّ `packages/channel-edge/allowlist/<surface>.json` (29 مدخلًا مصنّفًا) + الحارسُ 28 `edge-allowlist-guard` موجودة؛ الحدُّ الفعليُّ (plugin) **لم يُبنَ بعد** — بلا تغييرٍ في الحالة |
| P-05 | استضافة التطبيقات الثلاثة على حزمة الإنتاج الحالية (Singapore) | — | — | `infra/terraform/apps/` | — | لا | — | `app-rewrites.json` موسوم LEGACY-ONLY؛ `render-sync.py` لا ينشر مواقع ثابتة | **PARTIAL** |
| P-06 | تشغيل الروبوتات + bootstrap الهوية + user assertions | Telegram | webhook | `packages/bot-runtime` → `/identity/resolve`، `/identity/assertions` | `identity_*` | CI-PG (`channel-e2e`)؛ LIVE: صحة فقط (deploy smoke 24/24) | وحدات + `channel-e2e` | run 37869185543 (صحة) | **PARTIAL** — لا دليل LIVE لتدفق `/start` حقيقي ضمن هذا الجرد |
| P-07 | تسليم الأحداث بين الخدمات (`EventSinkPort`) | — | drains | `packages/outbox/src/sink.ts` → `unconfiguredEventSink` في reputation/subscriptions | `*_outbox` | لا ناقل موصول (G8) | وحدات drain | `docs/08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md` | **PARTIAL** |
| P-08 | المُجدوِل (`tick-scheduler`) للنبضات | — | `packages/tick-scheduler/src/scheduler.ts` | `/dispatch/tick` · `/negotiations/tick` · `/drivers/eligibility/tick` · `/reputation/tick` · `/subscriptions/tick` | — | CI-PG للنبضات؛ LIVE غير مُتحقَّق ضمن الجرد | وحدات + e2e | — | **PARTIAL** |

### 3.2 العميل

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| C-01 | تهيئة العميل من `/start` (هوية + ملف) | customer-bot | `bots/customer-bot/src/customer-core.ts` (داخل العملية) | customers use cases + `/identity/resolve` | `customer_profiles`، `identity_users` | CI-PG | `customer-e2e` نجاح + رفض | `packages/customer-e2e` | **COMPLETE** (CI-PG) |
| C-02 | عرض/تعديل الملف | `Profile.tsx` | `store/profile` | `GET/PUT /customers/:id/profile` | `customer_profiles` | محجوب بـ P-03/P-04 | UI مُحاكاة + وحدات + e2e | — | **PARTIAL** |
| C-03 | الأماكن المحفوظة | `SavedPlaces.tsx` | `store/places` | `GET/POST/DELETE /customers/:id/places` | `customer_saved_places` | محجوب بـ P-03/P-04 | كما سبق | — | **PARTIAL** |
| C-04 | معاينة + إنشاء طلب مشوار | `RideOrder.tsx` | `store/orders` | `POST …/order-requests/preview` · `POST …/order-requests` → `POST /orders/intake` | `customer_order_requests` → `orders` | CI-PG للخلفية؛ التطبيق محجوب | `customer-e2e`/`order-e2e` | — | **PARTIAL** (+ D-03) |
| C-05 | طلب توصيل طرد | `DeliveryOrder.tsx` | `store/orders` | نفس C-04 | نفس C-04 | كما سبق | كما سبق | — | **PARTIAL** |
| C-06 | طلباتي (قائمة + تفاصيل) | `MyOrders.tsx` | `GET …/order-requests` فقط | `GET …/order-requests/:orderRequestId` **بلا مستدعٍ** | — | محجوب | — | المواصفة §3.6 تطلب التفاصيل | **PARTIAL** |
| C-07 | تصفح المتاجر والمنتجات | `Marketplace.tsx` | `store/marketplace` | `GET /stores`، `GET /stores/:slug/products` | marketplace | محجوب | — | — | **PARTIAL** |
| C-08 | البحث | `Search.tsx` | `store/search` | `GET /search/products` | `search_product_index` | محجوب | `search-e2e` (خلفية) | — | **PARTIAL** |
| C-09 | السمعة | `Reputation.tsx` | `store/reputation` | `GET /reputation/scores/...` | `reputation_*` | محجوب | — | — | **PARTIAL** |
| C-10 | تقييم السائق من التطبيق | — | — | `POST /reputation/ratings` (بلا مستدعٍ) | `reputation_*` | — | وحدات | المواصفة §7 «مرحلة لاحقة» | **DEFERRED** |
| C-11 | محادثة داخل التطبيق | — | — | `services/chat` فارغ | — | — | — | المواصفة §7 خارج النطاق | **DEFERRED** |
| C-12 | الدفع الإلكتروني / المحفظة | — | — | — | — | — | — | المواصفة §7 + مبدأ 7 | **NOT APPLICABLE** |

### 3.3 الطلب والتوزيع والتفاوض

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| D-01 | تسليم النية إلى محرّك الطلبات | — | `services/customers/src/infrastructure/http-order-intake.ts` | `POST /orders/intake` | `orders`، `order_outbox` | CI-PG | `customer-e2e` (إعادة، تعارض، مهلة، فشل مغلق) | — | **COMPLETE** (CI-PG) |
| D-02 | آلة حالات الطلب (441 زوجًا) + السجل | — | dispatch/driver app | `POST /orders/:id/transitions` | `order_status_history` | CI-PG | `order-e2e` | — | **COMPLETE** (CI-PG) |
| D-03 | **إنشاء مهمة توزيع بعد نشر طلب المشوار** | — | **لا أحد في التشغيل** — الاختبارات وحدها تنادي `POST /dispatch/jobs` من harness | `POST /dispatch/jobs` | `dispatch_jobs` | لا | `driver-e2e`/`negotiation-e2e` تبذر المهمة بنفسها | ADR-011 §4: «تُنشأ بنداء صريح من مالك الطلب (اليوم: خدمة العميل…)» — لا محوّل dispatch في `services/customers` | **PARTIAL** — سلسلة المشوار تنقطع بعد intake |
| D-04 | المطابقة (dispatch → matching) | — | `services/dispatch/src/infrastructure/http-matching.ts` | `POST /matching/candidates` | `matching_*` | CI-PG | `dispatch-e2e` | — | **COMPLETE** (CI-PG) |
| D-05 | الموجات وانتهاء المهلة (tick) | — | `tick-scheduler` | `POST /dispatch/tick` | `dispatch_waves`/`offers` | CI-PG | وحدات + e2e | — | **COMPLETE** (CI-PG) |
| D-06 | التصعيد إلى مجموعة المجتمع بقفل ذري | Telegram group | — | الحالة `escalated_community` في `tick.ts` | `dispatch_jobs` | **لا نشر في القناة** | وحدات الحالة | USER_FLOWS + ADR-011 §5 «توصيله في طبقة القناة» — لا كود في الروبوتات | **PARTIAL** |
| D-07 | قبول/رفض العرض من تطبيق السائق | `Offers.tsx` | `store/dispatch` | `/dispatch/offers/:id/accept|reject` | `dispatch_offers` | CI-PG للخلفية؛ التطبيق محجوب | e2e + UI مُحاكاة | — | **PARTIAL** |
| D-08 | انتقالات المهمة من تطبيق السائق | `JobDetail.tsx` | `store/jobs` | `POST /orders/:id/transitions` | `orders` | محجوب | كما سبق | — | **PARTIAL** |
| D-09 | التفاوض متعدد المرشحين عبر الروبوتات | customer/driver bots | `bots/*/src/infrastructure/http-negotiations.ts` | `/negotiations…` → `http-agreed-price.ts`، `http-dispatch-offer.ts` | `negotiation_*` | CI-PG | `negotiation-e2e` + وحدات flows | — | **COMPLETE** (CI-PG) |

### 3.4 السائق

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| R-01 | تسجيل السائق | driver-bot | `driver-core.ts` → `registerDriver` (داخل العملية) | drivers | `drivers_*` | CI-PG | `driver-e2e` (قبل/بعد المراجعة) | — | **COMPLETE** (CI-PG) |
| R-02 | تبديل التوفر | الروبوت ✓؛ **التطبيق يعرض فقط** | `declareAvailability` (الروبوت)؛ لا نداء `PUT /drivers/:id/availability` من التطبيق | drivers | — | جزئي | e2e | DRIVER_MINI_APP_SPEC §4.2 + معيار القبول 2 | **PARTIAL** |
| R-03 | نبضة الأهلية | — | `tick-scheduler` | `POST /drivers/eligibility/tick` | `driver_eligibility_log` | CI-PG | `driver-e2e` «نبضة واحدة تُخرجه» | — | **COMPLETE** (CI-PG) |
| R-04 | الوثائق (رفع + مراجعة الإدارة) | `Documents.tsx` + Admin Drivers | stores | `/drivers/:id/documents…` | `driver_documents` | محجوب | وحدات + UI مُحاكاة | — | **PARTIAL** |
| R-05 | المركبات/المناطق/الملف | `Vehicles`/`Zones`/`Profile` | stores | drivers | drivers | محجوب | كما سبق | — | **PARTIAL** |
| R-06 | الأرباح وسجل المهام | `Earnings.tsx` | `GET /orders/drivers/:id/jobs` | orders | `orders` | محجوب | كما سبق | — | **PARTIAL** |
| R-07 | الاشتراك التجريبي للسائق | — | **لا أحد** (لا HTTP ولا داخل العملية) | `POST /subscriptions`، `/activate` | `subscription_*` | — | `subscription-e2e` | USER_FLOWS: «Trial subscription» في رحلة السائق | **PARTIAL** |
| R-08 | الإحالات | — | **لا أحد** | `/referrals…` (داخل subscriptions) | `referral_*` | — | `subscription-e2e` | — | **PARTIAL** |

### 3.5 المتاجر والشركاء

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| S-01 | تطبيق الشريك المصغّر | `apps/partner-mini-app` (فارغ) | — | — | — | — | — | ADR-046 | **DEFERRED** |
| S-02 | إنشاء متجر/منتجات/مخزون | — | **لا أحد** (partner-bot بلا نداءات مجالية) | `POST /stores`، `/products`، `/inventory` | marketplace | CI-PG | `marketplace-e2e` | — | **PARTIAL** |
| S-03 | مراجعة المتاجر والمنتجات (الإدارة) | Admin Moderation | `store/moderation` | `/stores/:slug/decisions`، `/products/:id/decisions` | `product_reviews` | محجوب بـ A-01 | UI مُحاكاة + e2e | — | **PARTIAL** |
| S-04 | دورة طلب المتجر (`WS-…`) | — | **لا أحد** | `/store-orders…` (13 مسارًا) | `delivery_*` | CI-PG | `delivery-e2e` | RISK-0034 مفتوح (جسر ORD-/WS- إلى dispatch) | **PARTIAL** |
| S-05 | ناقل المخزون marketplace → delivery | — | relay | delivery relay | `delivery_inventory_*` | CI-PG | `delivery-e2e` | RISK-0035 مفتوح (حدث مسموم يُفقد) | **PARTIAL** |
| S-06 | فهرسة البحث marketplace → search | — | relay | search relay | `search_*` | CI-PG | `search-e2e` | — | **COMPLETE** (CI-PG) |
| S-07 | بيانات اعتماد الشركاء ودورة حياتهم (M5-14) | Admin Partners | `store/partners` | `/partners/*` | `partner_*` (schema.sql فقط) | محجوب بـ A-01 | **3 مسارات بلا اختبار** | `inventory.json` summary | **PARTIAL** |

### 3.6 الإدارة والفوترة

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| A-01 | جلسة/دخول لوحة الإدارة | admin-portal | **لا أحد** — `setSession` لا يُستدعى إلا من خطاف `VITE_E2E` | — | — | لا | `session.test.ts` (وحدات) | `apps/admin-portal/src/main.tsx` | **PARTIAL** |
| A-02 | شاشات الإدارة (Dashboard/Users/Drivers/Orders/Moderation/Partners/Support/Audit) | 8 شاشات | stores موصولة، 0 نداء بلا مسار | الخدمات المعنية | — | محجوب بـ A-01/P-04 | UI مُحاكاة (`page.route`) + وحدات | `docs/12-testing/APP_API_ROUTES.md` | **PARTIAL** |
| A-03 | شاشة الفوترة | `Billing.tsx` | `store/billing` | `/billing/invoices…` | `billing_*` | محجوب | **0 اختبار للشاشة** | — | **PARTIAL** |
| A-04 | تذاكر الدعم | Admin Support | قراءة/تصعيد/حل فقط | `POST /support/tickets` و`/evidence` **بلا مستدعٍ** | `support_*` | — | وحدات؛ **لا اختبار تكامل Postgres** | — | **PARTIAL** |
| A-05 | سجل التدقيق | Admin AuditLog | قراءة فقط | `POST /audit/events` **بلا مستدعٍ** | `audit_events` | — | وحدات؛ **لا اختبار تكامل Postgres** | — | **PARTIAL** |
| B-01 | إصدار الفواتير من أحداث التوصيل | — | relay | billing relay | `billing_*` | CI-PG | `billing-e2e` | — | **COMPLETE** (CI-PG) |

### 3.7 البيانات والتشغيل والاستعادة

| ID | الميزة | الواجهة | المستدعي | الخلفية | قاعدة البيانات | التكامل | الاختبارات | الدليل | الحالة |
|---|---|---|---|---|---|---|---|---|---|
| DB-01 | ترحيلات up/down لـ15 خدمة + تكامل CI | — | `migrate-cli` | — | 15 خدمة | CI-PG | db-integration jobs | main CI 37923590657 أخضر | **COMPLETE** |
| DB-02 | مخطط الشركاء | — | — | partners | `contracts/schema.sql` بلا ترحيلات مرقّمة up/down | — | 3 تكامل | — | **PARTIAL** |
| DB-03 | الدعم والتدقيق على Postgres حقيقي | — | — | support، audit | ترحيل واحد لكلٍّ | **0 اختبار تكامل** | — | `inventory.json` db | **PARTIAL** |
| O-01 | نشر Render مثبّت على commit | — | workflow | `scripts/deploy/render-sync.py` | — | LIVE (صحة) | 24/24 | run 37869185543 | **COMPLETE** |
| O-02 | احتواء فشل قاعدة البيانات (RISK-0058) | — | — | `@wasla/resilience` في الخدمات الـ17 | — | معزول على billing فقط | `db-failure-containment.test.ts` | تمرين الإنتاج بوابة مالك منفصلة | **PARTIAL** |
| O-03 | سعة الاتصالات تحت الحمل (RISK-0067) | — | — | الإصلاح مدموج (#668/59bea99b) — لم يُعَد | — | **لا بيئة معزولة بـ Supavisor** | — | خطة §5 | **BLOCKED** |
| O-04 | خطة Render (RISK-0066) | — | — | — | — | — | — | قرار مالك | **BLOCKED** |
| O-05 | استثناءات ثغرات الصور (RISK-0050) | — | — | — | — | — | البوابة فعّالة | المهلة 2026-12-15 (لا تمديد ولا إزالة آلية) | **DEFERRED** |
| O-06 | M6-19A | — | — | — | — | — | — | اعتماد خارجي | **BLOCKED** |
| O-07 | M7 (M7-01..06) | — | — | — | — | — | — | Not Started بأمر المالك | **DEFERRED** |
| O-08 | رحلة مستخدم LIVE كاملة | — | — | — | — | **لا توجد** | — | محجوبة بـ P-03/P-04/P-05/D-03، ولا يجوز تنفيذها على بيانات الإنتاج | **BLOCKED** |
| O-09 | حزم golden-e2e وload-testing | — | — | — | — | تشير لمضيفات LEGACY (oregon) | golden = «service is reachable» فقط | `packages/golden-e2e/src/harness.ts` | **PARTIAL** |

### 3.8 هياكل فارغة

| ID | العنصر | الحكم | الحالة |
|---|---|---|---|
| K-01 | `apps/admin-web` (فارغ) | استُبدل بـ`apps/admin-portal`؛ `CONTAINERS.md` ما زال يذكره (تصحيح توثيقي لاحق) | **NOT APPLICABLE** |
| K-02 | `services/{auth,rides,referrals,notifications,fraud}` فارغة | المنطق في identity+auth-sdk / orders / subscriptions / bots / reputation (`fraud-signals`) | **NOT APPLICABLE** |
| K-03 | `services/{chat,translation,analytics,compliance}` فارغة | chat خارج النطاق بالمواصفة §7؛ الثلاثة الأخرى **بلا قرار مسجّل** (فجوة حوكمة) | **DEFERRED** |

> **تحديث 2026-10-09 (`CLM-0518`):** قرار مقترح لإغلاق الفجوة 1 — [ADR-069](../15-decisions/ADR-069-human-authentication-edge-for-apps.md) (Proposed). حالات الصفوف بلا تغيير حتى يُنفَّذ ويُثبَت. **r2:** بوابة إنفاذ لكل مسار (ADR-069 §2.8): D-07 ومسار `GET /stores` في C-07 محجوبة حتى G-ENF، وD-08 و`GET /reputation/ratings` محجوبة حتى حارس ربط؛ التصنيف في `ci-evidence/2026-10-09T140000Z-clm-0518-human-auth-adr/route-enforcement.json`.

## 4. أهم خمس فجوات (مرتبة بأثرها على اكتمال التدفقات)

1. **لا مسار مصادقة بشرية من التطبيقات إلى الخدمات (P-03 + P-04 + A-01).** لا مسار `POST /identity/sessions/telegram`،
   ولا طبقة تحوّل الجلسة البشرية إلى رمز خدمة + user assertion؛ الخدمات ترفض نداءات المتصفح بـ`401` (مقيس في M3-09).
   يحجب **22 صفًّا** (كل شاشات العميل والسائق والإدارة). يحتاج قرارًا معماريًا (ADR) — ضمن التفويض الفني.
2. **لا مُنشئ لمهمة التوزيع بعد نشر طلب المشوار (D-03).** حتى بعد إصلاح (1)، الطلب يصل إلى `orders` ولا يصل إلى
   `dispatch`؛ الاختبارات وحدها تملأ الحلقة.
3. **التطبيقات غير منشورة على حزمة الإنتاج الحالية، وحزم E2E/الحمل مثبّتة على مضيفات legacy (P-05 + O-09).** فلا
   إمكان لرحلة LIVE (O-08) ولا لاختبار حمل على البيئة الحالية بأدوات المستودع.
4. **رحلة السائق ناقصة في الاشتراك والتوفر (R-07 + R-02).** الاشتراك التجريبي بلا أي مستدعٍ، وتبديل التوفر غير موجود في التطبيق رغم أنه معيار قبول.
5. **التصعيد إلى المجتمع وتسليم الأحداث بين الخدمات غير موصولين (D-06 + P-07).** حالة `escalated_community` لا تُنشر
   في أي قناة، و`EventSinkPort` بلا تنفيذ إنتاجي.

فجوات أصغر مسجّلة: 3 مسارات شركاء بلا اختبار (S-07)، شاشة الفوترة بلا اختبار (A-03)، تفاصيل «طلباتي» غير موصولة (C-06)،
إنشاء التذاكر وكتابة التدقيق بلا مستدعٍ (A-04/A-05)، الدعم والتدقيق بلا تكامل Postgres (DB-03)، مخطط الشركاء بلا ترحيلات مرقّمة (DB-02).

## 5. RISK-0067 — خطة اختبار الحمل المعزول

**الحالة: مُصمَّم، لم يُنفَّذ.** الإصلاح (#668 · `59bea99b`، `max` افتراضي 2، `WASLA_PG_POOL_MAX` 1..10) **لم يُعَد** ولم يُغيَّر.

- **الطبقة L1 — معزولة في CI، قابلة للتنفيذ الآن (لا أسرار إنتاج):** وظيفة GitHub Actions بحاوية PostgreSQL مضبوطة على
  `max_connections=40` (تحاكي سقف 40 فتحة)؛ تشغيل 17 عملية خدمة حقيقية بمسابحها (`max=2`)؛ حمل متدرّج
  10 → 50 → 100 → 200 طلبًا متزامنًا لكل خطوة 60 ث؛ القياس: `pg_stat_activity` لكل `application_name` (الذروة يجب ≤ 34)،
  أخطاء `53300 too_many_connections`، المهلات، p95، والتعافي بعد `pg_terminate_backend` على حاوية الاختبار وحدها.
  **ما لا تثبته:** سلوك Supavisor نفسه (`EMAXCONNSESSION`).
- **الطبقة L2 — مطابقة لـSupavisor (شرط الإغلاق):** مشروع Supabase **منفصل** (لا `ppixaauyqoykrogwdxtv` الإنتاجي ولا
  `pvyuhjadrygqqdoczmnd` المخصّص للاستعادة) بنفس الطبقة ومُجمِّع session بحجم 40، والحمل نفسه، ورصد `EMAXCONNSESSION` في سجلات المُجمِّع.
- **الناقص لتنفيذ L2:** (أ) مشروع Supabase معزول بموافقة المالك (قرار تكلفة/خطة)، (ب) سلسلة اتصاله سرًّا في GitHub،
  (ج) مفاتيح هوية خدمة لتلك البيئة، (د) قرار المالك هل L1 كافٍ بديلًا. لا تغيير في `pool_size`/`max_connections`/كود الاتصال قبل تحليل النتيجة.

## 6. الاعتمادات على المالك أو جهات خارجية

| البند | الحالة الفعلية في السجل | الاعتماد |
|---|---|---|
| RISK-0058 | `mitigating` (التوقع كان OPEN — لم يُغيَّر) | تمرين احتواء على الإنتاج = بوابة مالك |
| RISK-0066 | `open` | قرار المالك بخطة Render المدفوعة |
| RISK-0067 | `mitigating` | مشروع اختبار معزول (L2) |
| RISK-0050 | `open`، مراجعة 2026-12-15 | إصدار esbuild بـGo مُصلَح (upstream) |
| RISK-0060 | `closed` | — |
| M6-19A | Ready for Gate على اللوحة | اعتماد خارجي — لا يُدَّعى |
| M7 | Not Started | قرار المالك |

## 7. الحكم

**ENGINEERING_COMPLETE = NO.** 39 صفًّا PARTIAL و4 BLOCKED، ولا رحلة مستخدم LIVE مُثبتة.
الاعتمادات المؤجَّلة على الإنتاج (O-03..O-07) **ليست** سبب الحكم؛ السبب فجوات هندسية قابلة للتنفيذ داخل المستودع (§4 · 1–5).
