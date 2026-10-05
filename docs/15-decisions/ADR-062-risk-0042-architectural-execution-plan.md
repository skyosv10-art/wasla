# ADR-062 — خريطة التنفيذ المعمارية لفجوات RISK-0042 الـ19 المتبقية

| | |
|---|---|
| **الحالة** | Proposed — تنتظر قرار Program Owner لاعتماد النطاق قبل أي implementation |
| **التاريخ** | 2026-10-05 |
| **عنصر العمل** | `M0-49` (RISK-0042) |
| **القرار يُلزِم** | لا أحد بعد — هذه خريطة لا implementation. أي تنفيذ يحتاج claim مستقل وقرار Program Owner |
| **يبني على** | [ADR-060](ADR-060-end-user-assertion-propagation.md) (تأكيد المستخدم) · [ADR-028](ADR-028-token-bound-owner-binding.md) · [ADR-029](ADR-029-tenant-membership-binding.md) · [ADR-031](ADR-031-product-lifecycle-actor-binding.md) |
| **لا يغيّر** | Production · Render · migrations · cutover · أي وضع enforce/observe جديد. RISK-0042 يبقى `open` |

---

## 1. السياق

بعد موجات RISK-0042 الأربع (CLM-0435 → CLM-0468) وتصنيف كل العمليات المفروضة الـ166، تبقى **19 فجوة مقيسة** (منها 2 كامنة) لم تُغلق. كل فجوة هي مسار `strength: "none"` له مالك أو مستأجر بطبيعته، ولا يوجد منادي إنتاجي يمرّر `obo` أو تأكيد مستخدم اليوم. هذا تقييم بنيوي لا فردي: البوتات الثلاثة (customer-bot, driver-bot, partner-bot) وخدمة `drivers` هي المصادر الوحيدة لهوية المستخدم النهائي (ADR-060 §2.4)، ولا تدفّق أي منها إلى الفجوات الـ19 اليوم.

**القاعدة المعمارية الحاكمة (ADR-060):** تأكيد المستخدم (`wua1`, Ed25519) يُصدَر من `identity` وحدها، يُمرَّر عبر البوتات أو `drivers`، ويُتحقَّق منه عند المستقبل. `obo` في رمز الخدمة (HMAC) لا يُقبَل دليلاً بذاته. الفصل بين المسارات النظامية (dispatch, delivery, tick-scheduler) ومسارات المستخدم يتم بصلاحية نظامية مستقلة.

---

## 2. جدول الفجوات الـ19

### مجموعة Delivery (6 فجوات)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D1 | `POST /store-orders` | delivery | high | user-bound | لا يوجد (e2e فقط) | customer-bot أو partner-bot يمرّر تأكيد `customer` | `wua1` من identity عبر customer-bot | نعم — `customer_ref` في الجسم يُقارَن بـ`endUser.publicId` | صلاحية نظامية مستقلة إن فُصل مسار المتجر عن مسار العميل | Program Owner | mismatch → 404 `STORE_ORDER_NOT_FOUND`; `off` يبقى سلوك اليوم | نعم — طلبات متجر حقيقية عند تفعيل production | نعم — إضافة `asserted()` + مقارنة في المعالج | authz-policy bindings + delivery app.ts | ADR-060 P2 + تفعيل customer-bot على delivery | positive/negative/off/observe/enforce + mutation | لا migration | العودة إلى `off` (لا enforce) | CLM-0471 | A |
| D2 | `GET /store-orders/:orderPublicId` | delivery | medium | user-bound | لا يوجد | customer-bot أو partner-bot | `wua1` | نعم — `orderPublicId` يُحلَّل إلى `customerPublicId` ويُقارَن | تقسيم المسار: قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 | نعم عند تفعيل production | نعم — `asserted()` | authz-policy + delivery | D1 | positive/negative | لا migration | `off` | CLM-0472 | A |
| D3 | `POST /store-orders/:orderPublicId/cancellation` | delivery | high | user-bound | لا يوجد | customer-bot أو partner-bot | `wua1` | نعم — صاحب الطلب وحده يُلغي | صلاحية نظامية للإلغاء الإداري | Program Owner | mismatch → 404 | نعم | نعم — `asserted()` + مقارنة | authz-policy + delivery | D1 | positive/negative | لا migration | `off` | CLM-0473 | A |
| D4 | `POST /store-orders/:orderPublicId/confirmation` | delivery | medium | system-bound (متجر) | لا يوجد | partner-bot يمرّر تأكيد `store_staff` | `wua1` بـ`act: store_staff` | نعم — المتجر صاحب الطلب وحده يؤكد | صلاحية نظامية إن فُصل | Program Owner | mismatch → 404 | نعم عند تفعيل partner-bot | نعم — `asserted()` | authz-policy + delivery + partners | D1 + partner-bot assertion flow | positive/negative | لا migration | `off` | CLM-0474 | A |
| D5 | `POST /store-orders/:orderPublicId/fulfillment-transition` | delivery | medium | system-bound | لا يوجد | partner-bot أو dispatch | `wua1` بـ`act: store_staff` أو صلاحية نظامية | جزئياً — المتجر ينتقل، والسائق قد يُمرَّر | مساران: متجر مؤكد + سائق مؤكد منفصلان | Program Owner | mismatch → 404; `system` بلا obo | نعم | نعم — `asserted()` | authz-policy + delivery | D4 + dispatch binding | positive/negative | لا migration | `off` | CLM-0475 | D |
| D6 | `GET /store-orders/:orderPublicId/delivery-task` | delivery | low | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — صاحب الطلب أو السائق المُسنَد | قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 | نعم عند تفعيل | نعم — `asserted()` | authz-policy + delivery | D1 + dispatch assignment | positive/negative | لا migration | `off` | CLM-0476 | A |

### مجموعة Geography (3 فجوات)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G1 | `GET /geo/users/:waslaPublicId/location` | geography | high | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — `:waslaPublicId` يُقارَن بـ`endUser.publicId` | صلاحية نظامية لقراءة الموقع (تشغيل) | Program Owner | mismatch → 404 `LOCATION_NOT_FOUND` | نعم — موقع أي مستخدم قابل للقراءة اليوم | نعم — `asserted()` | authz-policy + geography app.ts | ADR-060 P2 + تفعيل customer/driver-bot على geography | positive/negative/off/observe/enforce | لا migration | `off` | CLM-0477 | A |
| G2 | `PUT /geo/users/:waslaPublicId/location` | geography | high | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — كتابة موقع المستخدم بنفسه فقط | صلاحية نظامية (تشغيل) | Program Owner | mismatch → 404 | نعم — كتابة موقع أي مستخدم اليوم | نعم — `asserted()` | authz-policy + geography | G1 | positive/negative | لا migration | `off` | CLM-0478 | A |
| G3 | `GET /geo/users/:waslaPublicId/location/history` | geography | high | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — سجل تنقل المستخدم بنفسه فقط | قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 | نعم — تسريب نمط تنقل | نعم — `asserted()` | authz-policy + geography | G1 | positive/negative | لا migration | `off` | CLM-0479 | A |

### مجموعة Support (4 فجوات)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | `POST /support/tickets` | support | medium | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — `reporter_public_id` في الجسم يُقارَن بـ`endUser.publicId` | تذكرة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 `TICKET_NOT_FOUND` | نعم — إنشاء تذكرة باسم أي مستخدم | نعم — `asserted()` | authz-policy + support app.ts | ADR-060 P2 + تفعيل customer/driver-bot على support | positive/negative/off/observe/enforce | لا migration | `off` | CLM-0480 | A |
| S2 | `GET /support/tickets` | support | medium | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — الترشيح بـ`reporter_public_id` يُقارَن بـ`endUser` | قائمة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 أو قائمة فارغة | نعم — قراءة تذاكر أي مستخدم | نعم — `asserted()` | authz-policy + support | S1 | positive/negative | لا migration | `off` | CLM-0481 | A |
| S3 | `GET /support/tickets/:ticketId` | support | medium | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — التذكرة تُحمَّل ثم يُقارَن `reporter_public_id` بـ`endUser` | قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 | نعم — قراءة تذكرة أي مستخدم | نعم — `asserted()` | authz-policy + support | S1 | positive/negative | لا migration | `off` | CLM-0482 | A |
| S4 | `POST /support/tickets/:ticketId/evidence` | support | medium | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — `reporter_public_id` للتذكرة يُقارَن بـ`endUser` | صلاحية نظامية لإرفاق الأدلة | Program Owner | mismatch → 404 | نعم — إرفاق دليل بأي تذكرة | نعم — `asserted()` | authz-policy + support | S1 + S3 | positive/negative | لا migration | `off` | CLM-0483 | A |

### مجموعة Audit (1 فجوة)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | `POST /audit/events` | audit | medium | system-bound | لا يوجد | لا مُنتَفِع — `actor_id`/`actor_role` من الجسم يُكتبان في سجل التدقيق بلا تحقق | `wua1` إن كان الفاعل مستخدمًا، أو إزالة الحقل من الجسم واشتقاقه من `principal` | لا — audit هو وجهة السجل، لا ينبغي أن يقبل `obo` كدليل | إزالة `actor_id`/`actor_role` من جسم الطلب واشتقاقهما من `serviceCaller.onBehalfOfPublicId` أو من التأكيد إن وُجد | Service Owner | `actor_id` لا يُقبَل من الجسم؛ يُشتق من الرمز أو التأكيد | نعم — كتابة أحداث باسم أي فاعل | نعم — إزالة حقول من العقد | authz-policy + audit app.ts + contracts | قرار معماري: هل audit يصدّق الفاعل من الرمز أم من التأكيد؟ | positive/negative + contract test | لا migration | إعادة الحقول إن لزم | CLM-0484 | D |

### مجموعة Billing (2 فجوات كامنة)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1 | `GET /billing/invoices` | billing | medium | tenant-bound | لا يوجد (لا مُنادٍ من المتجر) | partner-bot إن عُرِضَ للمتجر | `wua1` بـ`act: store_staff` | نعم — `store_public_id` من الاستعلام يُقارَن بـ`endUser` | قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 | لا اليوم — كامنة | نعم — `asserted()` إن عُرِضَ | authz-policy + billing | partner-bot assertion flow + ADR-060 P2 | positive/negative | لا migration | `off` | CLM-0485 | B |
| B2 | `GET /billing/invoices/:id` | billing | medium | tenant-bound | لا يوجد | partner-bot إن عُرِضَ | `wua1` بـ`act: store_staff` | نعم — الفاتورة تُحمَّل ثم `store_public_id` يُقارَن | قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 | لا اليوم — كامنة | نعم — `asserted()` | authz-policy + billing | B1 | positive/negative | لا migration | `off` | CLM-0486 | B |

### مجموعة Reputation (2 فجوات)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | `GET /reputation/facts` | reputation | low | user-bound | لا يوجد | لا مُنتَفِع — `internalScoped` | `wua1` إن كان الفاعل مستخدمًا | جزئياً — الوقائع من خدمة مصدر لا من صاحبها | تقسيم المسار: قراءة نظامية بصلاحية مستقلة + ترشيح شخصي بـ`asserted` | Service Owner | الشخص المُرشَّح بـ`subject_public_id` يجب أن يطابق `endUser` أو قراءة نظامية بصلاحية مستقلة | نعم — قراءة وقائع أي شخص | نعم — `asserted()` على المسار المُرشَّح | authz-policy + reputation app.ts | قرار معماري: هل reputation يقبل تأكيد مستخدم أم يبقى نظاميًا؟ | positive/negative | لا migration | `off` | CLM-0487 | D |
| R2 | `GET /reputation/ratings` | reputation | low | user-bound | لا يوجد | لا مُنتَفِع — `internalScoped` | `wua1` | جزئياً — التقييمات مُرشَّحة بشخص | مساران: نظامي + مُرشَّح بـ`asserted` | Service Owner | نفس R1 | نعم — قراءة تقييمات أي شخص | نعم — `asserted()` على المسار المُرشَّح | authz-policy + reputation | R1 | positive/negative | لا migration | `off` | CLM-0488 | D |

### مجموعة Subscriptions (1 فجوة)

| # | Endpoint/Operation | الخدمة المالكة | الخطورة | user/system | Caller الإنتاجي الحالي | Caller المطلوب | مصدر الهوية | OBO مناسب؟ | البديل | مالك القرار | معيار القبول | بيانات/مستخدمون متأثرون؟ | تغيير API contract؟ | identity/authz/schema/event changes؟ | Dependencies | الاختبارات المطلوبة | Migration Strategy | Rollback Plan | Claim المقترح | التصنيف |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U1 | `GET /referrals` | subscriptions | low | user-bound | لا يوجد | customer-bot أو driver-bot | `wua1` | نعم — `referrer_public_id` أو `referee_public_id` يُقارَن بـ`endUser` | قراءة نظامية بصلاحية مستقلة | Program Owner | mismatch → 404 أو قائمة فارغة | نعم — قراءة إحالات أي شخص | نعم — `asserted()` | authz-policy + subscriptions app.ts | ADR-060 P2 + تفعيل customer/driver-bot على subscriptions | positive/negative/off/observe/enforce | لا migration | `off` | CLM-0489 | A |

---

## 3. التصنيف A/B/C/D

| التصنيف | المعنى | الفجوات | العدد |
|---|---|---|---|
| **A** | يمكن إغلاقها باستخدام OBO (تأكيد مستخدم من identity) | D1, D2, D3, D4, D6, G1, G2, G3, S1, S2, S3, S4, U1 | **13** |
| **B** | تحتاج caller إنتاجي جديد لا يوجد اليوم (partner-bot على billing) | B1, B2 | **2** |
| **C** | يجب تحويلها إلى صلاحية نظامية (مسارات تشغيل/إدارة) | — | **0** |
| **D** | تحتاج قرارًا معماريًا مختلفًا (لا OBO ولا صلاحية نظامية كافية) | D5, A1, R1, R2 | **4** |

---

## 4. الأولوية من critical إلى low

| الأولوية | الفجوات | السبب |
|---|---|---|
| **critical** | — | لا توجد فجوة critical: كل الفجوات الـ19 بلا منادي إنتاجي يمرّر `obo` اليوم، فلا يوجد مسار هجوم حي |
| **high** | D1, D3, G1, G2, G3 | كتابة أو قراءة بيانات مستخدم حساسة (طلب، موقع، سجل تنقل) بلا مقارنة ملكية |
| **medium** | D2, D4, D5, D6, S1, S2, S3, S4, A1, B1, B2 | قراءة/كتابة موارد مملوكة لكن بلا منادي إنتاجي، أو كامنة (billing) |
| **low** | R1, R2, U1 | قراءة وقائع/تقييمات/إحالات بلا مُنتَفِع إنتاجي، والبيانات تشغيلية بطبيعتها |

---

## 5. Dependencies

### 5.1 تبعيات داخلية (بين الفجوات)

| الفجوة | تعتمد على |
|---|---|
| D2 | D1 (نفس المسار: قراءة بعد الكتابة) |
| D3 | D1 (نفس الطلب: إلغاء بعد إنشاء) |
| D4 | D1 + partner-bot assertion flow على delivery |
| D5 | D4 + dispatch binding (تمرير السائق من dispatch) |
| D6 | D1 + dispatch assignment (السائق المُسنَد) |
| S2, S3, S4 | S1 (نفس التذكرة: قائمة/قراءة/إرفاق بعد الإنشاء) |
| B2 | B1 (نفس الفاتورة: قراءة بعد القائمة) |
| R2 | R1 (نفس السمعة: تقييمات بعد وقائع) |

### 5.2 تبعيات معمارية

| التبعية | الحالة | ما يلزم |
|---|---|---|
| ADR-060 P1 (identity يُصدِر `wua1`) | **Accepted** (CLM-0440) | لا شيء — الأساس جاهز |
| ADR-060 P2 (تأكيد على المسارات) | **مُنفَّذ** على negotiations, matching, marketplace, dispatch, identity, orders | تطبيق النمط نفسه على الفجوات الـ19 |
| تفعيل `WASLA_USER_ASSERTION_MODE` على Render | **`off`** في الإنتاج | قرار Program Owner منفصل (P3) — خارج نطاق هذه الخريطة |
| تدفّق customer-bot → delivery/geography/support/subscriptions | **غير موجود** | بناء مسار البوت إلى هذه الخدمات (A/B/C/D) |
| تدفّق partner-bot → delivery/billing | **غير موجود** | بناء مسار partner-bot إلى هذه الخدمات (B) |
| تدفّق driver-bot → geography | **غير موجود** | بناء مسار driver-bot إلى geography |

---

## 6. الفجوات التي لا تحتاج تغيير API contract

الفجوات التالية يمكن إغلاقها بتغيير `bindings.ts` + `app.ts` فقط (إضافة `asserted()` + مقارنة في المعالج)، دون تغيير العقد المنشور:

**D1, D2, D3, D4, D6, G1, G2, G3, S1, S2, S3, S4, U1** (13 فجوة — التصنيف A)

جميعها تضيف `asserted()` على المسار وتقارن المورد بـ`endUser.publicId` داخل المعالج، والرفض 404 برمز خطأ قائم في العقد. لا حقول جديدة، لا هياكل جديدة.

---

## 7. الفجوات التي تحتاج API/identity/authz/schema/event changes

| الفجوة | نوع التغيير | التفصيل |
|---|---|---|
| D5 | event contract | انتقال التنفيذ يحتاج تمرير هوية المتجر + السائق معًا — مساران منفصلان أو حدث مركب |
| A1 | API contract | إزالة `actor_id`/`actor_role` من جسم `POST /audit/events` واشتقاقهما من الرمز/التأكيد — تغيير عقد منشور |
| B1, B2 | caller + authz | تحتاج partner-bot caller على billing — لا يوجد اليوم (B) |
| R1, R2 | architectural decision | هل reputation يقبل تأكيد مستخدم أم يبقى نظاميًا؟ — قرار يحدد ما إذا كان التغيير في authz-policy أم في تصميم الخدمة |

---

## 8. مالك القرار المطلوب لكل فجوة

| مالك القرار | الفجوات | القرار المطلوب |
|---|---|---|
| **Program Owner** | D1-D6, G1-G3, S1-S4, B1-B2, U1 | اعتماد النطاق: أي فجوات تُغلق في هذه المرحلة، وأيها تُؤجَّل. تفعيل P3 (observe/enforce) خارج النطاق |
| **Service Owner (audit)** | A1 | قرار معماري: هل audit يصدّق الفاعل من الرمز أم من التأكيد؟ إزالة حقول من العقد |
| **Service Owner (reputation)** | R1, R2 | قرار معماري: هل reputation يقبل تأكيد مستخدم أم يبقى نظاميًا؟ |
| **Security Owner** | الكل | مراجعة المخاطر المتبقية بعد الإغلاق وتأكيد عدم وجود مسار هجوم جديد |

---

## 9. معايير إغلاق RISK-0042 بالكامل

1. كل فجوة من الفجوات الـ19 إما:
   - **closed**: أُغلقت بـ`asserted()` + مقارنة ملكية + اختبارات (A)
   - **accepted**: قُبلت كقرار تصميم (مسار نظامي بلا مُنتَفِع) مع سبب مكتوب
   - **deferred**: أُجِّلت بقرار Program Owner مع مهلة مراجعة في RISK_REGISTER.md
   - **not applicable**: لا تنطبق (مثل billing الكامنة إن لم يُعرَض للمتجر)
2. `WASLA_USER_ASSERTION_MODE` = `enforce` على Render لكل خدمة فيها مسار `asserted` (P3)
3. اختبار هجوم حي: بوت مخترق لا يستطيع الوصول إلى موارد مستخدم آخر
4. مراجعة Security Owner وتأكيد عدم وجود مسار هجوم جديد
5. تحديث `RISK_REGISTER.md`: RISK-0042 → `closed` أو `accepted` بقرار مالك

---

## 10. قرارات Program Owner المطلوبة

1. **اعتماد نطاق التنفيذ**: هل تُغلق الفجوات الـ13 (A) في دفعات P2 متتابعة (delivery → geography → support → subscriptions)، أم دفعة واحدة؟
2. **قرار audit (A1)**: هل يُزيل `actor_id`/`actor_role` من العقد ويشتقهما من الرمز، أم يبقى مسارًا إداريًا بقرار تصميم؟
3. **قرار reputation (R1, R2)**: هل reputation يقبل تأكيد مستخدم على المسارات المُرشَّحة بشخص، أم يبقى نظاميًا بقرار تصميم؟
4. **قرار billing (B1, B2)**: هل تُبنى مسارات partner-bot إلى billing الآن، أم تُؤجَّل الفجوتان الكامنتان حتى يُعرَض billing للمتجر؟
5. **قرار fulfillment-transition (D5)**: هل يُقسم المسار إلى متجر مؤكد + سائق مؤكد منفصلين، أم يُبنى حدث مركب؟
6. **تفعيل P3**: خارج نطاق هذه الخريطة — يحتاج قرارًا منفصلًا لكل خدمة بعد اكتمال P2

---

## 11. المخرج المقترح لكل فجوة

| # | المخرج | السبب |
|---|---|---|
| D1-D4, D6 | **closed** (A) | OBO مناسب، caller قابل للبناء |
| D5 | **deferred** (D) | يحتاج قرارًا معماريًا للحدث المركب |
| G1-G3 | **closed** (A) | OBO مناسب، caller قابل للبناء |
| S1-S4 | **closed** (A) | OBO مناسب، caller قابل للبناء |
| A1 | **deferred** (D) | قرار معماري: إزالة حقول من العقد |
| B1-B2 | **deferred** (B) | كامنة — لا caller إنتاجي اليوم |
| R1-R2 | **deferred** (D) | قرار معماري: نظامي أم مؤكد؟ |
| U1 | **closed** (A) | OBO مناسب، caller قابل للبناء |

**النتيجة المقترحة**: 13 مغلقة، 6 مؤجلة. RISK-0042 لا يُغلق بهذه الخريطة — يبقى `open` حتى تُغلق كل فجوة وتُفعَّل في الإنتاج (P3).
