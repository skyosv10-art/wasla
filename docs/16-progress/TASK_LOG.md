# TASK_LOG — سجل المهام بكل دفع (ملزم)

> **النوع:** سجل إلزامي. كل دفع يمس الكود يجب أن يرافقه إدخال هنا (الحد الأدنى لقاعدة [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)).
>
> **القاعدة:** الإدخال يُكتب **قبل أو مع** الدفع، ويصف ماذا ولماذا وأين وكيف تم الاختبار وما الخطوة التالية.
>
> **التنسيق:** الأحدث في الأعلى.

---

## قالب الإدخال

```markdown
### [YYYY-MM-DD] <عنوان التغيير>
- **Files:** <الملفات/المسارات المتأثرة>
- **Services:** <الخدمات إن وجدت، أو «—»>
- **Why:** <السبب / القرار>
- **Tests:** <كيف تم الاختبار / التحقق>
- **Next:** <الخطوة التالية>
- **Related:** <MR / Issue / ADR>
```

---

## السجل

## 2026-08-21 · Phase 04 MR 1/6 — عقود Customer Core وحدّ تسليم الطلب (ADR-009)

**Task:** فتح Phase 04 من طرفها الصحيح: تعريف **ما يملكه العميل** (ملفه · أماكنه · نيّة طلبه) وتثبيت **الحدّ** بينه وبين محرّك الطلبات غير الموجود بعد، عقوداً أولاً (ADR-004) قبل أي سطر تنفيذ. **Status:** Completed (42 اختباراً جديداً · إجمالي 487 وحدة) · **MR:** [!MRX](https://gitlab.com/uxxxu/wasla/-/merge_requests/MRX) · **ADR:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) بسبعة قرارات: خدمة `services/customers` مستقلّة (انحراف معلَن عن شجرة §68) · ملف العميل **ملفُّ دور** مفتاحه `wasla_public_id` بلا FK إلى الهوية · `OrderIntakePort` منفذاً واحداً للتسليم والخدمة لا تكتب `orders` · النقطة تُعرَّف بـ`zone_id` إلزامياً والإحداثية اختيارية لا تُقرّر شيئاً · النقاط قائمة مرتّبة بنقطتين في هذه المرحلة · السعر وضعان صريحان (`customer_offer` / `negotiable`) بلا سعر استرشادي · `Idempotency-Key` إلزامي على الكتابات. (ب) عقود الخدمة في `services/customers/contracts/`: `api.openapi.yml` (سبعة مسارات) + `events.json` (ستة أحداث v1) + `schema.sql` (خمسة جداول + محفّزات) + `errors.md` (18 كوداً ثابتاً + جدول أسباب فشل التسليم + مسارات الفشل) + `README.md`. (ج) حزمة `@wasla/contracts-customer`: أنواع مُولّدة من OpenAPI + أنواع أحداث مكتوبة يدوياً بحرّاس انحراف + **كتالوج أكواد الأخطاء** وصنف كلٍّ منها ودالة استخراج حالة HTTP + ثوابت سياسة المرحلة. (د) توثيق: [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) (جديد) + [CONTAINERS.md §4.1](../02-architecture/CONTAINERS.md) + `MASTER_PROGRESS.md` + `ROADMAP.md` + `HANDOFF_NEXT_STEPS.md` §9 + هذا الإدخال. **لا كود تنفيذ في هذه الدفعة** — لا نطاق ولا منافذ مُنفَّذة ولا HTTP.
2. **لماذا؟** لأن السؤال الحاكم في هذه المرحلة ليس «كيف نخزّن طلباً» بل «**من يملك الطلب**». محرّك الطلبات مرحلته السادسة، وإن سمحنا لخدمة العميل أن تكتب `orders` اليوم فسيصير التنظيف في Phase 06 هجرة بيانات لا إعادة توصيل. ولذلك ثُبّت الحدّ عقداً واحداً (`OrderIntakePort`) ومُنع الوصول المباشر، وحُرِس المنع **باختبارات تقرأ `schema.sql` و`api.openapi.yml`** لا بتعليق في وثيقة. وثانياً لأن الإحداثية مُغرية: النظام لا يملك Reverse Geocoding ولا حساب مسافة (§28 مؤجّل)، فلو صارت الإحداثية أساس النقطة لصار المجال يعتمد على قدرة لا وجود لها؛ المرساة هي `zone_id` من هرم [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، والإحداثية للعرض والتسليم فقط.
3. **أين؟** `docs/15-decisions/ADR-009-*.md` (جديد) · `services/customers/contracts/{api.openapi.yml,events.json,schema.sql,errors.md,README.md}` (جديدة) · `packages/contracts/customer/{package.json,tsconfig.json,src/{index.ts,api-types.ts,events-types.ts,__tests__/{contracts.test.ts,events.test.ts}}}` (جديدة) · `pnpm-lock.yaml` (ربط الحزمة) · `docs/03-domain/CUSTOMER_CORE.md` (جديد) · `docs/02-architecture/CONTAINERS.md` · `docs/16-progress/*`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على **16** مشروعاً، و`corepack pnpm -r run test` = **487 اختباراً تنجح** (445 سابقاً + 42 جديداً)، و`scripts/checks/scan-secrets.sh` نظيف. الـ42 ليست فحص أنواع فقط: **حرّاس انحراف** يقرأون ملفات العقد نفسها ويفشلون إذا انفصل الرمز عن الوثيقة — (أ) كتالوج `CUSTOMER_ERROR_CODES` يُقارَن سطراً بسطر بجدول `errors.md`، وصنف كل كود يُقارَن بما هو موثّق، ولا حالة HTTP خارج الأصناف الخمسة؛ (ب) `CUSTOMER_EVENT_TYPES` يُقارَن بحروف `event_type` في `events.json` مع تأكيد `producer` و`event_version`؛ (ج) **قاعدة الخصوصية مُختبَرة**: أي حمولة حدث تحوي `latitude`/`longitude`/`label`/`notes`/`description`/`display_name` تُسقط الاختبار؛ (د) **حرّاس حدود ADR-009** على `schema.sql`: لا `CREATE TABLE orders` ولا `REFERENCES orders` ولا FK إلى `identity_users`/`geo_zones`، والمال `BIGINT` لا `NUMERIC`، و`order_public_id` يبقى قابلاً لـ`NULL`، والنقاط مفتاحها `(order_request_id, sequence)` **بلا** فريدة على `kind` (وإلا استحال Multi-stop بلا هجرة)؛ (هـ) على `api.openapi.yml`: `Idempotency-Key` مُعلَن `required: true` ومرجوع إليه في الكتابتين، والنقاط `minItems: 2` و`maxItems: 2`، **ولا مسار ولا عملية تمسّ الطلبات**.
5. **ما الخطوة التالية؟** MR 2/6: نطاق العميل ومنافذه وحالات استخدامه ومُهيّئاته in-memory (`services/customers/src/{domain,ports,use-cases,infrastructure}`) — بلا قاعدة بيانات وبلا HTTP. الخطة الستّة كاملة في [HANDOFF §9](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم: ADR-009 يحمل القرارات وبدائلها ونتائجها، و[CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) يحمل الكيانات وحالات الاستعمال والمنافذ واتجاه التبعية وسياسة Idempotency والفشل وجدول **المؤجّل صراحةً مع مرحلة كلٍّ منه**، و[CONTAINERS.md §4.1](../02-architecture/CONTAINERS.md) يحمل الانحراف عن شجرة الخدمات مُعلَناً لا مسكوتاً عنه.
7. **هل مراجَع؟** الكود والعقود مُتحقَّقة آلياً (typecheck على 16 مشروعاً + 487 اختباراً + فحص الأسرار)، والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** **نعم — وهو ADR-009 نفسه.** الدفعة تُقرّر ثلاثة قرارات لا رجعة فيها بلا ثمن: موضع خدمة جديدة خارج شجرة §68، وملكية الطلب (من يُولّد `order_public_id`)، وتعريف النقطة الجغرافية. كلٌّ منها كان سيصير في Phase 06 هجرة بيانات لو تُرك ضمنياً.
9. **backward compatibility؟** لا كسر: لا تُعدَّل عقود قائمة (الهوية · الجغرافيا · القناة) ولا يُلمس كودها. الحزمة الجديدة `private` ولا مستهلك لها بعد.
10. **migration؟** `schema.sql` جديد بالكامل (`CREATE TABLE IF NOT EXISTS`) وبقسم تراجع معلَّق بترتيب عكسي. لا جدول قائم يُعدَّل. تشغيل الترحيل فعلياً يقع في MR 3/6 مع مُهيّئات Postgres ووظيفة CI الخاصة بها.
11. **مخاطر؟** (أ) **العقد يسبق التنفيذ** فقد يظهر في MR 2/6 أن حقلاً ناقص — مُحتوى لأن العقد لم يُنشر لمستهلك خارجي بعد، وأي تعديل يمرّ بـMR وبحرّاس الانحراف. (ب) **الخدمة تعتمد على محرّك غير موجود** — مُحتوى بأن المحوّل الافتراضي **fail-closed**: بلا تهيئة يُرجع 503 ويُسجّل `submission_failed` وحدث فشل، فلا طلب صامت بلا مالك. (ج) **قيد النقطتين** قد يُقرأ لاحقاً كتصميم دائم — مُحتوى بأن التخزين قائمة مرتّبة والقيد في طبقة الاستعمال ومُختبَر أنه ليس في المخطّط.
12. **security؟** لا أسرار في الدفعة (فحص الأسرار نظيف). قرارات أمنية موجبة: الأحداث **لا تنشر** إحداثيات خام ولا نصوص المستخدم (قاعدة مُختبَرة) · لا FK بين الخدمات يمنع ربط بيانات عبر الحدود بقاعدة واحدة · `Idempotency-Key` يمنع تكرار الكتابة من قناة عامة · وصف الشحنة والملاحظات محدودة الطول بقيود قاعدة.
13. **performance؟** لا مسار تشغيل في الدفعة. المخطّط يحمل فهارس القراءات المتوقّعة: أماكن العميل مرتّبة بالأحدث استعمالاً، طلباته بالأحدث إنشاءً، فريدتا Idempotency، وفهرس جزئي على غير المنشور في صندوق الصادر، وفريدة جزئية على `order_public_id` عند وجوده.
14. **monitoring؟** مؤجّل إلى طبقة HTTP (MR 4/6): `/health` مُعلَن في العقد على المنفذ 8086. وأسباب فشل التسليم الثلاثة (`UNAVAILABLE`/`REJECTED`/`TIMEOUT`) مُعرَّفة الآن ليكون للفشل **اسم قابل للقياس** لا كود 503 مُبهم.

**Related:** [ADR-009](../15-decisions/ADR-009-customer-core-placement-and-order-intake-boundary.md) · [CUSTOMER_CORE.md](../03-domain/CUSTOMER_CORE.md) · [عقود الخدمة](../../services/customers/contracts/README.md) · [CONTAINERS §4.1](../02-architecture/CONTAINERS.md) · [MASTER_PROGRESS](MASTER_PROGRESS.md) · [HANDOFF §9](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-21 · Phase 03 MR 7/7 — بوابة خروج المرحلة (E2E) وإغلاق Phase 03

**Task:** تحويل نصّ بوابة الخروج المنشور («كل Bot يفتح Mini App المناسبة، ويمكن استبدال Telegram adapter في الاختبارات بـMock Adapter») من جملة في خريطة الطريق إلى **اختبار يفشل إذا كُسر**: البوتات الثلاثة معاً في عملية واحدة، أمام خدمة هوية واحدة تستمع فعلياً على HTTP، ومخازن قناة مشتركة — ثم إغلاق المرحلة. **Status:** Completed (446 اختباراً تنجح محلياً: 445 بمخازن الذاكرة + اختبار صفوف يعمل مع `DATABASE_URL`؛ الجديد: 8) · **MR:** [!30](https://gitlab.com/uxxxu/wasla/-/merge_requests/30) · **ADR:** لا حاجة (انظر السؤال 8)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة **اختبارية بحتة** `packages/channel-e2e` (`@wasla/channel-e2e`، بلا `src/index.ts` وبلا تصدير، وكل اعتمادياتها `devDependencies`): `src/__tests__/harness.ts` يبني خدمة الهوية على منفذ حقيقي (`127.0.0.1:0`) بمحوّلات in-memory، ويُنتج بيئة كل بوت (`envFor`) ويبنيه بتجاوز مقبس القناة إلى `MockChannelAdapter` (`buildGateBot`/`buildGateBots`)، ويقرأ صندوق الصادر من المصدر الفعلي (SQL عند وجود قاعدة، وإلّا `InMemoryOutbox.events`) بشكل موحّد، ويُطبّق `packages/channel-core/contracts/schema.sql` ويُفرغ جداوله. و`src/__tests__/phase03-exit-gate.e2e.test.ts` = ثمانية اختبارات (تفصيلها في السؤال 4). (ب) `.gitlab-ci.yml`: وظيفة `channel-exit-gate-e2e` تُوسّع `.db-integration-base` بخدمة `postgres:15` وقاعدة مستقلّة `wasla_channel_e2e`. (ج) توثيق: [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md) (جديد) + [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md) (صفّ الوظيفة + الاستثناء المقصود + تصحيح حدّ قديم صار غير صحيح) + [CONTAINERS.md](../02-architecture/CONTAINERS.md) (صفّ الحزمة + موقعها خارج رسم الاعتماد) + [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md) + [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md) (صفّا المؤجّل يصيران ✅ ويُفرَز منهما ما **لم** يُنجَز) + `MASTER_PROGRESS.md` + `ROADMAP.md` + `HANDOFF_NEXT_STEPS.md` + هذا الإدخال. **لم يُلمس أي كود إنتاجي:** لا عقود (`api.openapi.yml` · `events.json` · `schema.sql` · كتالوج الأخطاء)، ولا نواة، ولا مُهيّئ، ولا طبقة تشغيل، ولا جذور البوتات. الدفعة **دليل** لا ميزة.
2. **لماذا؟** لأن الأخطاء التي وُضعت البوابة لأجلها **لا تظهر في أي اختبار بوت واحد**، فهي أخطاء علاقة لا أخطاء وحدة: (أ) بوت يُجيب بزر Mini App بوتٍ آخر — البوت المقيس بنفسه يبقى متّسقاً مع نفسه أياً كان اشتقاقه؛ (ب) ثلاثة بوتات تُنشئ **ثلاثة حسابات** لشخص واحد — تعدّد الحسابات يحتاج ثلاثة عملاء يقصدون **خدمة هوية واحدة**؛ (ج) `update_id` واحد من بوتين يتصادم في فهرس منع التكرار **المشترك** — لا تصادم إذا لم يشترك أكثر من بوت في مخزن واحد. ولذلك خدمة الهوية تستمع على منفذ حقيقي ويُستدعى محوّل الإنتاج عبر HTTP: «هوية واحدة» يجب أن يكون حكماً تصدره الخدمة لا افتراضاً يصنعه الاختبار.
3. **أين؟** `packages/channel-e2e/{package.json,tsconfig.json,vitest.config.ts,src/__tests__/{harness.ts,phase03-exit-gate.e2e.test.ts}}` (جديدة) + `.gitlab-ci.yml` + `pnpm-lock.yaml` (ربط الحزمة) + `docs/12-testing/` + `docs/02-architecture/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على **15** مشروعاً، و`corepack pnpm -r run test` = **445 اختباراً تنجح** (438 سابقاً + 7 بمخازن الذاكرة)، وبـ`DATABASE_URL` على Postgres 15 محلي: **8 من 8** بما فيها اختبار الصفوف، و`scripts/checks/scan-secrets.sh` نظيف. ما تُثبته الثمانية: (أ) `GET /channel/<bot>/mini-app` يُعيد Mini App البوت وتسميته وعنوانه، وللبوتين الآخرين **404 `CHANNEL_UNKNOWN_BOT`**. (ب) `/start` → 202 و**رسالة واحدة** من نوع `text_with_buttons` بمفتاح `start:<bot>:<update_id>` وزرّ واحد `{type: mini_app, miniApp: <bot>}`: customer→customer · driver→driver · partner→partner، مع `channel.mini_app.launched` لكل بوت في صندوق الصادر. (ج) نفس `telegram_user_id` عبر البوتات الثلاثة ⇒ سؤال الهوية مباشرة يُعيد **200** و`created: false` و`WS-\d{10}`، وحدث `identity.created` **مرّة واحدة**، ولا يظهر `wasla_public_id` في أي حدث قناة (ADR-007 قاعدة 4). (د) إعادة نفس التحديث ⇒ **202 `duplicate`** (لا 4xx: كل ردّ غير 2xx يُغري Telegram بمزيد من الإعادة) ورسالة واحدة وحدث `channel.update.received` واحد. (هـ) نفس `update_id` من customer وdriver ⇒ **كلاهما `accepted`** ولكلٍّ زرّه — أي أنّ مفتاح التفرّد يشمل البوت فعلاً. (و) بوت مبنيّ من **التهيئة وحدها** يحمل `TelegramChannelAdapter`، ونفسه بتجاوز مقبس واحد يحمل `MockChannelAdapter`، والاثنان يجيبان `channel === telegram` — فالاستبدال تجاوزٌ لافتراضٍ حقيقي لا مسارٌ وحيد. (ز) `GET /health` = 200 و`runtime.persistence` يُعلن ما رُكِّب به فعلاً. (ح) على Postgres: صفّ `channel_updates` واحد لكل (بوت، تحديث) بحالة `processed`، وصفّ `channel_deliveries` واحد لكل بوت `sent` بمحاولة واحدة و`body.buttons[0].miniApp` صحيح (لأن الجسم المحفوظ هو ما ستُعيد المحاولة إرساله)، و`channel_outbox.aggregate_id` = مرجع المحادثة لا أي معرّف هوية. **وفحص طفرة**: عند جعل اشتقاق Mini App يُعيد `customer` دائماً في `bot-runtime/src/config.ts` سقطت **4 اختبارات** من الثمانية، ثم أُعيد التعديل — فالبوابة حسّاسة للخطأ الذي وُضعت له، لا خضراء بالمجاملة.
5. **ما الخطوة التالية؟** **Phase 03 مغلقة**؛ التالي Phase 04 حسب [ROADMAP](ROADMAP.md). ويُنقَل إلى أول عمل تشغيلي في المرحلة القادمة عملان مُعلَنان من MR 5 **لم تُنجزهما هذه الدفعة بقصد** (البوابة لا تنصّ عليهما وإدخالهما كان سيُخرجها عن نطاقها): **مُشغّل دوري** لـ`retryDueDeliveries` و**ناشر صندوق الصادر**، ومعهما سياسة استبقاء لـ`channel_updates` وإرسال `telegram_username` في تهيئة الهوية.
6. **هل مستند؟** نعم: [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md) يحمل نصّ البوابة، وجدول الأخطاء الثلاثة التي لا يراها اختبار بوت واحد، ورسم التركيب، وجدول القرارات المقصودة بمبرّر كلٍّ منها، وتفصيل الثمانية، ونتيجة فحص الطفرة **وحدوده** (تغيير قيمة `_MINI_APP_URL` لا يُسقط شيئاً لأن الاختبار يقارن الردّ بنفس المتغيّر المُركَّب — وصحّة العنوان في الإنتاج مسألة تهيئة لا اختبار)، وطريقة التشغيل محلياً وفي CI، والقيود الواعية.
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck على 15 مشروعاً + 445 وحدة + 8/8 على Postgres + فحص الأسرار) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** **لا.** الدفعة لا تُقرّر شيئاً معمارياً: لا منفذ جديد ولا عقد ولا سياسة سلوك؛ هي **إثبات** لما قرّرته [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) و[ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md). القرار الوحيد فيها هيكلي وموضعه هذا السجل + وثيقة البوابة + [CONTAINERS.md](../02-architecture/CONTAINERS.md): **حزمة اختبار جديدة** — مبرَّرة حسب [قانون التوثيق §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) بأنها الموضع الوحيد المسموح فيه استيراد جذور التركيب الثلاثة معاً؛ وضع المجموعة في `bot-runtime` أو `channel-postgres` يخلق دورة اعتماد (`bots → bot-runtime → channel-postgres`)، و`packages/test-utils` موثّقة لأدوات مشتركة لا لمجموعة اختبار قائمة بذاتها.
9. **هل يكسر backward compatibility؟** لا شيء إطلاقاً: صفر تغيير في كود الإنتاج والعقود. الحزمة الجديدة **لا يستوردها** أي كود إنتاجي، فلا حافة جديدة في رسم الاعتماد.
10. **هل migration؟** لا هجرة ولا تعديل مخطّط. بند نشر واحد: `pnpm-lock.yaml` تغيّر بربط الحزمة، وCI يستعمل `--frozen-lockfile` — فأي فرع لا يحمل القفل المحدَّث يفشل عند التثبيت.
11. **هل توجد مخاطر؟** (أ) **حزمة اختبار في `packages/`** قد تُقرأ لاحقاً كأنها مكتبة — مُخفَّف بأنها بلا `src/index.ts` وبلا تصدير، وبصفّ صريح في CONTAINERS يقول ذلك. (ب) **هوية in-memory داخل البوابة** — استمرارية الهوية بوابة Phase 01 ومغطّاة في `db-integration`؛ تكرارها هنا كان سيقيس نفس الشيء مرّتين ويُضيف مخطّطاً ثانياً لهذه الوظيفة بلا مقابل. (ج) **لا شبكة Telegram حقيقية** — العقد مع Bot API مغطّى في 99 اختباراً للمُهيّئ، والبوابة تفحص أنه المُركَّب افتراضياً فقط. (د) **الاختبار يعمل مرّتين في CI** (بمخازن الذاكرة داخل `build-test`، وبـPostgres في وظيفته) — تكلفة زمن مقصودة: بوابةٌ يمكن تخطّيها ليست بوابة. (هـ) **حدّ فحص الطفرة** أعلاه: صحّة عنوان Mini App الفعلي مسألة تهيئة بيئة، ومعلَنة في وثيقة البوابة حتى لا تُقرأ البوابة أوسع مما تُثبت.
12. **هل security؟** لا سطح جديد. وتُثبِت الدفعة قاعدتين أمنيتين قائمتين: **لا ربط `chatRef ↔ waslaPublicId` في طبقة القنوات** (يُفحَص بأن المعرّف العام لا يظهر في أي حدث قناة)، و**التحقّق من رمز الـwebhook** يعمل في المسار الكامل (كل نداء في البوابة يمرّ بالترويسة الصحيحة). ولا رمز ولا مرجع غرفة حقيقي في الملفات الجديدة: كلها قيم اختبار صريحة، و`scan-secrets` نظيف.
13. **هل performance؟** المجموعة كلّها ~0.2 ثانية بمخازن الذاكرة و~0.4 ثانية على Postgres (البوتات عبر `app.inject` بلا منافذ، وخدمة الهوية وحدها تحمل منفذاً). القرار المتعمَّد: خدمة هوية جديدة لكل اختبار — كلفة ملّي ثانية مقابل أن يُثبَت «هوية واحدة» من سجلٍّ فارغ لا موروثاً من اختبار سابق.
14. **هل monitoring؟** لا مقياس جديد، لكن البوابة تُثبت أنّ آثار المراقبة القائمة تُكتب فعلاً في المسار الكامل: صفوف `channel_updates` بحالتها، وصفوف `channel_deliveries` بمحاولاتها، وأحداث `channel.update.received` و`channel.mini_app.launched` في صندوق الصادر — وهي المادة التي سيقوم عليها الناشر والتنبيهات في Phase 04.

**Related:** [PHASE03_EXIT_GATE_E2E.md](../12-testing/PHASE03_EXIT_GATE_E2E.md)، [DB_INTEGRATION_CI.md](../12-testing/DB_INTEGRATION_CI.md)، [CONTAINERS.md](../02-architecture/CONTAINERS.md)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md)، [ROADMAP](ROADMAP.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · Phase 03 MR 6 — مُهيّئ المجموعات (دعم/تصعيد) وتحديثات المجموعات

**Task:** تنفيذ البند الموثّق الأخير قبل بوابة الخروج: أن تعرف طبقة القنوات أنّ محادثةً ما **مجموعة**، وأنها **مجموعتنا**، و**ما يجوز أن يُرسَل إليها** — تنفيذاً للقاعدة 9 في [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) («المجموعة نوع محادثة داخل نفس المنافذ، لا مسار كود مُوازٍ») ومع سياسة صريحة: لا تهيئة هوية داخل غرفة · لا زر Mini App نحو غرفة · صمت تام في غرفة غير مُعلَنة · وأحداث العضوية تصبح مرئية بدل 422. **Status:** Completed (438 اختبار وحدة تنجح محلياً؛ الجديد: 45) · **MR:** [!29](https://gitlab.com/uxxxu/wasla/-/merge_requests/29) · **ADR:** [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `packages/channel-core`: `domain/model.ts` يكتسب `ConversationScope` (`private`/`group`) و`GroupRole` (`support`/`escalation`/`community`) و`GroupPresence`؛ `ports.ts` يكتسب المنفذ **العاشر** `GroupRegistryPort` (`roleFor` · `groupsFor`) وتُعاد ترقيم قسم الساعة/المولّد؛ `use-cases/deps.ts` يُضيف `groups?` **اختياريّاً** إلى `InboundDeps` و`OutboundDeps`؛ `use-cases/receive-update.ts` يشتقّ `scope` ويقرأ `groupRole` من السجل ويحسب `replyAllowed` ويقصر تهيئة الهوية على المحادثات الخاصة (وتُعاد الحقول الثلاثة في فرع التكرار أيضاً)؛ `use-cases/send-message.ts` يرفض نيّة `mini_app` نحو مجموعة مُعلَنة **قبل** إنشاء صفّ التسليم؛ `infrastructure/in-memory.ts` يُضيف `StaticGroupRegistry` + `testGroupRegistry`. (ب) `packages/telegram-adapter`: `api-shapes.ts` يُضيف `MEMBERSHIP_FIELDS` وقائمة الحالات المسموحة؛ `update-parser.ts` يُحلّل `my_chat_member`/`chat_member` **داخل المجموعات** إلى `group_event` بعلامة (`bot_status:<s>` / `member_status:<s>`، وغير المعروف `unknown`) ويُميّز علامات أحداث الخدمة (`joined:N` · `left:1` · `migrated` · `created`)؛ `keyboard.ts` يُصدّر `isGroupChatRef` ويرفض زر `web_app` نحو غرفة؛ `channel-adapter.ts` يُمرّر `chatRef` إلى بناء لوحة الأزرار. (ج) `packages/bot-runtime`: `config.ts` يُضيف `GROUP_ENV_NAMES` و`loadGroupPresences` (قراءة صارمة تفشل عند الإقلاع) و`BotConfig.groups`؛ `runtime.ts` يبني **سجلّاً واحداً** يتشارك الاتجاهان ويُعلنه في `BotRuntime.groups`؛ `welcome.ts` يُضيف نصوص المجموعات لكل دور و`buildGroupStartReply` بزرّ `deep_link`؛ `http/app.ts` يُوجّه الردّ حسب `replyAllowed` و`scope`؛ `http/server.ts` يُخبر التطبيق بتوفّر قالب الرابط العميق. (د) اختبارات: `channel-core/src/__tests__/groups.test.ts` + `telegram-adapter/src/__tests__/group-updates.test.ts` + `bot-runtime/src/__tests__/groups.test.ts` وتمديد الـharness بمساعدَي تحديث. (هـ) توثيق: [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md) (جديد) + [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md) (جديد — ثمانية أقسام) + تحديث `CHANNEL_LAYER_CORE.md` (تسعة → عشرة منافذ) و`CHANNEL_TELEGRAM_ADAPTER.md` و`CHANNEL_BOTS.md` (ثلاثة متغيّرات بيئة جديدة) و`CHANNEL_PERSISTENCE.md` (تصحيح محلّ المؤجّل) + `HANDOFF_NEXT_STEPS.md` + `MASTER_PROGRESS.md` + هذا الإدخال. **لم تُلمس** العقود: لا `api.openapi.yml` ولا `events.json` ولا `schema.sql` ولا كتالوج الأخطاء، ولا `.gitlab-ci.yml`، ولا حزمة جديدة.
2. **لماذا؟** لأن ثلاث فجوات كانت ستُغلق بقرار ضمني في الكود لو لم تُوثَّق: (أ) **من يعرف أنّ الغرفة غرفتنا؟** الجدول المُصمَّم لذلك (`channel_group_bindings`) مؤجَّل إلى Phase 08 لأنه يحتاج خدمة الدعم؛ فجُعلت المعرفة **منفذاً يقرأ الإعداد** لا جدولاً — نفس منطق ADR-007 حين جعل عنوان Mini App إعداداً محقوناً، وثمنه استبدال محوّل واحد لاحقاً بدل تعديل النواة والبوتات. (ب) **الهوية.** الكود قبل هذه الدفعة كان يُهيّئ الهوية لأي `/start` يحمل فاعلاً — بما في ذلك داخل مجموعة. ومرجع المجموعة **مشترك بين كل الأعضاء**، فتهيئتها من غرفة تربط شخصاً واحداً بغرفة كاملة، وهو ربط خاطئ لا يُنقَض لاحقاً. (ج) **سطح التشغيل.** Telegram ترفض زر `web_app` خارج المحادثات الخاصة بخطأ 400 غامض، فالمحاولة تستهلك خمس محاولات إعادة بلا جدوى؛ والصحيح رابط عميق يفتح المحادثة الخاصة حيث يصير الزر شرعيّاً. ورابعة أمنية: **أي شخص يستطيع إضافة البوت إلى غرفة**، فاعتبار كل غرفة شرعية يحوّل البوت إلى ناشر لروابط تطبيقاتنا في غرف لا نعرفها.
3. **أين؟** `packages/channel-core/src/{domain/model.ts,ports.ts,index.ts,use-cases/{deps,receive-update,send-message}.ts,infrastructure/in-memory.ts}` + `packages/telegram-adapter/src/{api-shapes,update-parser,keyboard,channel-adapter,index}.ts` + `packages/bot-runtime/src/{config,runtime,welcome,index}.ts` و`src/http/{app,server}.ts` + ثلاثة ملفات اختبار جديدة وharness + `docs/15-decisions/` + `docs/02-architecture/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على 14 مشروعاً، و`corepack pnpm -r run test` = **438 اختباراً تنجح** (393 سابقاً + 45: النواة 18 · المُهيّئ 13 · طبقة التشغيل 14)، و`scripts/checks/scan-secrets.sh` نظيف (لا مرجع غرفة حقيقي في المستودع — كلّها من البيئة). ما تُثبته: (أ) **النطاق** — تحديث مجموعة يُنتج `scope = group`، والدور يُقرأ من السجل، و`replyAllowed` صحيحة للخاص وللغرفة المُعلَنة وخاطئة للغرفة المجهولة، والحقول الثلاثة تعود **في فرع التكرار أيضاً** (وإلا لتصرّف البوت في إعادة الإرسال تصرّفاً مختلفاً). (ب) **الهوية** — `/start` في مجموعة **لا يُنادي** مُهيّئ الهوية إطلاقاً، بينما في الخاص يُناديه؛ والتحديث يُسجَّل ويُنشر حدثه في الحالتين. (ج) **سطح التشغيل** — نيّة `mini_app` نحو مجموعة مُعلَنة ترفع `CHANNEL_INVALID_MESSAGE` **ولا تُنشئ صفّ تسليم** (يُثبَت بإعادة إرسال بنفس مفتاح الـidempotency فتُنشئ صفّاً جديداً لا تجد قديماً)، و`buildInlineKeyboard` ترفض الزر نحو معرّف سالب مستقلّةً عن السجل. (د) **الردّ** — الغرفة المُعلَنة تُجاب داخلها بزرّ `deep_link` ونصّ يخصّ الدور، وبوت بلا قالب رابط عميق يُجاب بنصّ فقط، ونفس مفتاح منع التكرار يجعل إعادة إرسال Telegram بلا رسالة ثانية. (هـ) **الصمت** — الغرفة المجهولة: 202 · تحديث مُسجَّل · حدث منشور · **صفر رسائل**. (و) **العضوية** — إضافة البوت إلى غرفة تُقبَل `group_event` بعلامة الحالة بدل `unsupported`/422، والحالة غير المعروفة تُبلَّغ `unknown`، وتغيير العضوية في محادثة خاصة يبقى `unsupported` بقصد. (ز) **الإقلاع** — مرجع فارغ أو أطول من الحدّ أو غرفة واحدة تحت دورين ⇒ فشل إقلاع صريح. (ح) **الحراسة المعمارية** — `neutrality.guard.test.ts` يمرّ: لا مفردة قناة في الكود الجديد للنواة. الاختبارات تتحقّق من **الأكواد** لا من النصوص العربية ([DEFINITION_OF_DONE](../00-rules/DEFINITION_OF_DONE.md)).
5. **ما الخطوة التالية؟** MR 7/7: بوابة خروج المرحلة 03 — E2E يُثبت أن كل بوت يفتح Mini App المناسبة وأن مُهيّئ القناة قابل للاستبدال بـMock، ثم إغلاق المرحلة. ويبقى عملان تشغيليان مُعلَنان من MR 5: **مُشغّل دوري** لـ`retryDueDeliveries` و**ناشر صندوق الصادر**.
6. **هل مستند؟** نعم: [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md) بثمانية أقسام تحمل سبب وجود القطعة وحدودها، وجدول حقول القرار (`scope`/`groupRole`/`replyAllowed`)، والمنفذ العاشر ومتغيّراته، والقواعد الأربع بمبرّر كلٍّ منها، وجدول أحداث حياة المجموعة، وخريطة «أين يعيش كل شيء»، وحالة التحقّق، وجدول المؤجّلات ومحلّ كل مؤجّل. ومعها تحديث الوثائق الثلاث القائمة حتى لا يبقى فيها «تسعة منافذ» ولا صفّ مؤجّل يقول «MR 6».
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck + 438 وحدة + فحص الأسرار) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** **نعم — وكُتِب: [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md).** السبب أن الدفعة تُعدّل قائمة منصوصة في ADR-007 §2 (تسعة منافذ ⇒ عشرة) وتُقرّر سياسة لم يحسمها ADR-007: مصدر معرفة المجموعات إعدادٌ لا جدول، ومنع تهيئة الهوية في المجموعات (وهو **تصحيح** لسلوك قائم)، ومنع سطح التشغيل نحو غرفة، والصمت في الغرفة المجهولة مع 202. القرار لا يُلغي ADR-007 بل يُعدّله ويعلن كيف يعود التنفيذ إلى الجدول في Phase 08/16.
9. **هل يكسر backward compatibility؟** لا على مستوى العقد ولا الـHTTP: لا مسار ولا رمز خطأ ولا حالة استجابة تغيّرت (`accepted`/`duplicate` كما هما — ولم تُضَف `ignored` تحديداً لتجنّب تغيير عقد لا حاجة له). `GroupRegistryPort` **اختياري** في حزم الاعتماديات فبوت بلا مجموعات يعمل كما كان حرفياً. و`ReceiveUpdateResult` **اكتسب** حقولاً ولم يفقد شيئاً. التغيير السلوكي الوحيد مقصود ومُبرَّر: `/start` داخل مجموعة لم يعد يُهيّئ هوية.
10. **هل migration؟** لا هجرة بيانات ولا تعديل مخطّط. لكن **للنشر بند جديد**: الغرف تُعلَن في `SUPPORT_GROUP_CHAT_IDS` / `ESCALATION_GROUP_CHAT_IDS` / `COMMUNITY_GROUP_CHAT_IDS`، وغيابها ليس عطلاً بل **صمت** — البوت المُضاف إلى غرفة لن يردّ فيها حتى تُعلَن. مكتوب في جدول الإعداد وفي HANDOFF حتى لا يُقرأ الصمت كخلل.
11. **هل توجد مخاطر؟** (أ) **إعلان يدوي للغرف** — تغيير غرفة يعني تغيير إعداد ونشراً، ونسيانه يعني بوتاً صامتاً في غرفة عاملة؛ مقبول لأن عدد الغرف في هذه المرحلة صغير ومملوك للتشغيل، ومُخفَّف بفشل إقلاع صريح على أي إعلان متضارب. (ب) **الغرفة المجهولة صامتة تماماً** — لا رسالة تُنبّه من أضاف البوت أنّ الغرفة غير مُعلَنة؛ مقصود (الرد يُغري بإساءة الاستخدام)، والأثر مُخفَّف بأن التحديث يُسجَّل فيبقى قابلاً للتدقيق. (ج) **`groupsFor(role)` بلا مستهلك إنتاجي** — رمز مُنفَّذ ومُختبر ينتظر موجِّه التصعيد؛ أُبقي لأنه المِشبك الذي يجعل Phase 16 بلا تعديل منفذ، ومُعلَن في جدول المؤجّلات لا مخبوءاً. (د) **تغيير العضوية في محادثة خاصة يظلّ `unsupported`/422** — قيد قائم قبل هذه الدفعة ولم تُدخله، ومُقيَّد في HANDOFF. (هـ) **الأدوار خشنة** (دعم/تصعيد/مجتمع) ولا تعرف مدينةً ولا طلباً؛ مقصود لأن التفصيل يحتاج مالكاً في خدمة الدعم.
12. **هل security؟** نعم، وهي محور الدفعة: (أ) **قائمة سماح لا اكتشاف تلقائي** — البوت لا يتكلّم إلا في غرفة أعلنها المشغّل؛ إضافةُ غريبٍ للبوت إلى غرفة لا تُنتج نشراً لروابط تطبيقاتنا. (ب) **لا ربط هوية من محادثة مشتركة** — يحفظ [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) والقاعدة 4 من ADR-007 (طبقة القنوات لا تُخزّن رسم `chatRef ↔ waslaPublicId`). (ج) **رفض سطح التشغيل من طبقتين** — النواة تحمي المسار المعروف، والمُهيّئ يحمي أي مُرسِل داخلي عبر `POST /channel/messages` لا يعرف السجل. (د) مراجع الغرف تُقرأ من البيئة ولا تُطبع في رسالة خطأ ولا تُخزَّن في المستودع (`scan-secrets` نظيف)، ورسائل فشل الإقلاع تسمّي المتغيّر ولا تطبع قيمته ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)).
13. **هل performance؟** الكسب أوضح من الكلفة: `roleFor` بحث في خريطة داخل الذاكرة (السجل إعداد يُبنى مرة عند الإقلاع لا استعلام لكل تحديث)، ورفض سطح التشغيل يحدث **قبل** إدخال صفّ التسليم فيمنع خمس محاولات محكومة بالفشل مع كتاباتها، وأحداث العضوية صارت تُقبَل بدل 422 فتوقّفت إعادة الإرسال الدورية من Telegram لتحديثات لا تُشتكى منها. سجل واحد مُشترك بين الاتجاهين لا سجلّان، فلا تكرار في البناء ولا احتمال تباعد.
14. **هل monitoring؟** `BotRuntime.groups` يجعل ما يعرفه البوت من غرف قابلاً للفحص من خارج مسار الطلب، وفشل ردّ المجموعة يُسجَّل بكوده ولا يُحوّل الـwebhook إلى خطأ، وتحديثات المجموعات صارت صفوفاً في `channel_updates` (بعد MR 5) فيمكن قياس نشاط الغرف وكشف غرفة تُغرق البوت. تنبيه على «تحديثات من غرف غير مُعلَنة» يصبح ممكناً بهذه البيانات ولم يُبنَ بعد.

**Related:** [ADR-008](../15-decisions/ADR-008-channel-groups-registry-and-reply-policy.md)، [CHANNEL_GROUPS.md](../02-architecture/CHANNEL_GROUPS.md)، [CHANNEL_LAYER_CORE.md](../02-architecture/CHANNEL_LAYER_CORE.md)، [CHANNEL_TELEGRAM_ADAPTER.md](../02-architecture/CHANNEL_TELEGRAM_ADAPTER.md)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · Phase 03 MR 5 — تخزين دائم لطبقة القنوات `@wasla/channel-postgres`

**Task:** سداد الدَّين المُعلن في MR 4: نقل المنافذ الثلاثة (`ProcessedUpdateStorePort` · `DeliveryStorePort` · `OutboxPort`) من الذاكرة إلى Postgres مقابل `channel_updates` / `channel_deliveries` / `channel_outbox`، بحيث يعبر منع التكرار وطابور إعادة المحاولة إعادة تشغيل العملية، مع اختبارات تكامل على قاعدة حقيقية ووظيفة CI مستقلّة. **Status:** Completed (393 اختبار وحدة + 25 اختبار تكامل تنجح محلياً؛ الجديد: 30) · **MR:** [!28](https://gitlab.com/uxxxu/wasla/-/merge_requests/28)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/channel-postgres` (`@wasla/channel-postgres`): `schema.ts` (مرآة Drizzle لـ`packages/channel-core/contracts/schema.sql` بكل قيود `CHECK` وفريدَي الـidempotency وفهارس الطابور/المحادثة/غير المنشور) · `db.ts` (`createChannelDb` → `{ pool, db }` على `pg.Pool` + `drizzle/node-postgres`) · `processed-update-store.ts` · `delivery-store.ts` · `outbox.ts` · `stores.ts` (`createChannelStores` — الحدّ الوحيد الذي يستهلكه جذر التركيب، يُرجع الثلاثة + `close()`) · `index.ts` · `drizzle.config.ts` + `vitest.config.ts` + `vitest.integration.config.ts` (بـ`fileParallelism: false`) · و`src/__tests__/` (harness يُطبّق العقد ويُفرغ الجداول + 9 اختبارات وحدة لحراسة الانحراف + 15 اختبار تكامل للمخازن + 6 اختبارات مطابقة منافذ). (ب) `packages/bot-runtime`: `config.ts` يقرأ `DATABASE_URL` ويرفض ما ليس `postgres://`/`postgresql://` عند الإقلاع؛ `runtime.ts` يختار المجموعة (`buildStoreSet`) ويُعلن `persistence` ويُصدر `close()` و`ChannelStoreSet` وخيار `stores` للحقن؛ `http/server.ts` يربط `runtime.close()` بخطّاف `onClose`؛ `index.ts` يُصدّر النوع الجديد؛ و8 اختبارات جديدة (5 للتهيئة + 3 لاختيار التخزين وتحرير المجموعة). (ج) `.gitlab-ci.yml`: وظيفة `channel-db-integration` تُوسّع `.db-integration-base` بخدمة `postgres:15` وقاعدة `wasla_channel_test`. (د) توثيق: `docs/02-architecture/CHANNEL_PERSISTENCE.md` (جديد — ثمانية أقسام) + `docs/12-testing/DB_INTEGRATION_CI.md` (صفّ الوظيفة الثالثة + التشغيل المحلي + حدّ التسلسل) + `HANDOFF_NEXT_STEPS.md` (§1 لقطة · §7 البند [4] دَينه مُغلق والبند [5] ✅ Done بتفصيله والبند [6] ← التالي) + `MASTER_PROGRESS.md` (صفّ Phase 03) + هذا الإدخال. (هـ) `pnpm-lock.yaml` للحزمة الجديدة. **لم يُلمس** سطر واحد في `channel-core` ولا في `telegram-adapter` ولا في `bots/*` ولا في العقود.
2. **لماذا؟** لأن الحالة السابقة كانت **صحيحة السلوك وكاذبة الضمان**: `remember` ذرّي في الذاكرة، فإذا أُعيد تشغيل البوت نُسِي كل ما عُولج وتكرّرت رسائل الترحيب، وتبخّر طابور التسليمات المستحقّة بما فيه. وثلاثة قرارات تستحق تبريراً: (أ) **حزمة مستقلّة لا مجلّد في النواة** — اختبار الحراسة `neutrality.guard.test.ts` يقفل اعتماديات النواة عند `@wasla/contracts-channel` و`@wasla/errors`، فإضافة `drizzle-orm`/`pg` إليها تُفشله عن حق: نواة تعرف قاعدة بيانات لم تبقَ قابلة للاستبدال في الاختبار. (ب) **المخازن الثلاثة تُختار معاً** — طابور دائم خلف مجموعة منع تكرار في الذاكرة يفقد الضمان نفسه بعد الإقلاع، فالخلط يشتري لا شيء ويُخفي الخسارة. (ج) **`DATABASE_URL` اختياري لا إلزامي** — المساهم بلا قاعدة محلية يجب أن يبقى قادراً على تشغيل بوت واختباراته، بشرط أن يكون النقص **مُعلَناً** في `runtime.persistence` لا مخبوءاً.
3. **أين؟** `packages/channel-postgres/` (كل الكود الجديد) + `packages/bot-runtime/src/{config.ts,runtime.ts,index.ts,http/server.ts,__tests__/{config,runtime}.test.ts}` + `.gitlab-ci.yml` + `docs/02-architecture/` + `docs/12-testing/` + `docs/16-progress/` + `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `pnpm -r run typecheck` نظيف على 14 مشروعاً، و`pnpm -r run test` = **393 اختباراً تنجح** (376 سابقاً + 9 حراسة انحراف + 8 في طبقة التشغيل)، و`DATABASE_URL=… pnpm --filter @wasla/channel-postgres test:integration` = **21 اختباراً تنجح** على Postgres 15 حقيقي. ما تُثبته: (أ) **منع التكرار** — نفس التحديث يُطالَب به مرّة واحدة، ونفس المعرّف لبوتين حدثان مستقلّان، و**المطالبة تنجو من إعادة الإقلاع** (مجموعة مخازن جديدة على نفس القاعدة ترى المُطالَب به)، ومطالبتان متزامنتان تُنتجان فائزاً واحداً. (ب) **التسليم** — `create` بنفس مفتاح الـidempotency يُعيد نفس الصفّ لا صفّاً ثانياً، `applyProgress` يزيد النسخة ويرفض صفّاً غير موجود بـ`CHANNEL_INTERNAL_ERROR`، والطابور يُرتّب بالأولوية ثم الزمن ويستثني غير المستحقّ ويحترم `limit`، والجسم والأزرار والبوت تعود كما دخلت و`traceId` يغيب حين يكون `NULL` لا يعود `null`. (ج) **صندوق الصادر** — الإلحاق يظهر في `unpublished()` وإعادة إلحاق نفس الحدث لا تُنتج صفّاً ثانياً. (د) **مطابقة المنافذ** — `receiveUpdate`/`sendMessage`/`retryDueDeliveries` تُشغَّل على مجموعة الذاكرة ومجموعة Postgres وتُقارَن المُشاهدات فتتطابق. (هـ) **حراسة الانحراف بلا قاعدة بيانات** — الاختبار يقرأ `schema.sql` فعلياً ويقارن أعمدة كل جدول بالمرآة ويؤكّد وجود الفريدين وأن الأسماء محيّدة (لا مفردة قناة) ولا مفتاح أجنبي إلى الهوية. (و) **طبقة التشغيل** — الافتراضي `memory`، ووجود `DATABASE_URL` يُنتج `postgres`، وصندوق الصادر نفسه يُشارَك بين المسارين، وإغلاق تطبيق Fastify يُحرّر المجموعة مرّة واحدة، ومخطّط غير Postgres يُفشل الإقلاع.
5. **ما الخطوة التالية؟** MR 6/7: مُهيّئ المجموعات (دعم/تصعيد) + تحديثات المجموعات. ثم MR 7: بوابة خروج المرحلة E2E. ويبقى عملان تشغيليان مُعلَنان: **مُشغّل دوري** يستدعي `retryDueDeliveries` (الطابور صار دائماً لكن لا شيء يستدعيه)، و**ناشر صندوق الصادر** حين يوجد مستهلك.
6. **هل مستند؟** نعم: `CHANNEL_PERSISTENCE.md` بثمانية أقسام تحمل مبرّر الحزمة الجديدة (ENGINEERING_DOCUMENTATION_LAW §7) وجدول المنافذ ↔ الجداول ↔ الضمان المُشترى، وستّة قرارات مُبرَّرة (الإدخال الذرّي بدل `SELECT`-ثم-`INSERT` · `processed_at = received_at` · `event_id` مفتاحاً للصادر · ترتيب الطابور داخل SQL قبل `LIMIT` · زيادة `version` داخل `UPDATE` · المخازن تُختار معاً)، وجدول الإعداد، وحالة التحقّق، وجدول المؤجّلات ومحلّ كل مؤجّل، وأثر أمني. ومعها تحديث `DB_INTEGRATION_CI.md` حتى يجد من يأتي بعدنا الوظيفة الثالثة وأمر تشغيلها محلياً في نفس المكان.
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck + 393 وحدة + 21 تكامل) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا. هذه **تنفيذ** لـ[ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) لا انحراف عنه: المنافذ كما هي، والاتجاه الأحادي محفوظ (`channel-postgres → channel-core` ولا شيء في النواة يعرفه)، والمكدّس نفسه المُقرّ في [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)/[ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) (Postgres + Drizzle + `schema.sql` يدوي مصدراً كنسياً). ولا تعديل عقد: لا `schema.sql` ولا `events.json` ولا `api.openapi.yml` ولا كتالوج الأخطاء لُمس.
9. **هل يكسر backward compatibility؟** لا. `BotConfig.databaseUrl` اختياري وغيابه يُنتج سلوك MR 4 حرفياً؛ و`BotRuntime` اكتسب حقلين (`persistence` + `close`) ولم يفقد شيئاً؛ ولا مسار HTTP تغيّر.
10. **هل migration؟** لا هجرة بيانات (لا بيانات قائمة). لكن **للنشر شرط جديد**: يجب تطبيق `packages/channel-core/contracts/schema.sql` على القاعدة وتمرير `DATABASE_URL`؛ بغيره يعمل البوت **في الذاكرة** — وهذا يعني عملياً أن نسيان المتغيّر في الإنتاج ليس عطلاً ظاهراً بل ضماناً مفقوداً، ولذلك يُعلنه `runtime.persistence` صراحةً ويجب فحصه في قائمة النشر.
11. **هل توجد مخاطر؟** (أ) **الغياب الصامت لـ`DATABASE_URL`** — أخطر بند في الدفعة: الفشل ليس صاخباً (البوت يعمل) بل ضمانٌ يذوب؛ خُفِّف بإعلانه في `persistence` وبكتابته في الوثيقة وHANDOFF، ولم يُجعَل إلزامياً حتى لا يُكسر التشغيل المحلي والاختبارات. (ب) **`processed_at = received_at`** — قيمة صادقة بمعنى «وقت المطالبة» لا «وقت إتمام المعالجة»؛ إشارة إكمال حقيقية تستلزم توسيع المنفذ في العقد لا تخميناً في المُهيّئ. (ج) **`channel_updates` ينمو بلا سياسة تقليم** — لا قياس بعد لبناء سياسة احتفاظ؛ مُعلَن كمؤجّل. (د) **لا ناشر للصادر** — الأحداث تُخزَّن دائماً ولا تُنشَر بعد؛ مقصود لأن ناشراً بلا مستهلك رمز ميت. (هـ) **بركة اتصالات لكل بوت** — ثلاثة بوتات × سقف البركة على قاعدة واحدة؛ الحدّ افتراضي اليوم ويُضبط عند أول قياس حقيقي.
12. **هل security؟** سلسلة الاتصال سرّ: تُقرأ من البيئة فقط، ولا تُطبع في رسالة خطأ ولا سجلّ ولا استجابة — ورفض المخطّط الخاطئ يسمّي المتغيّر ولا يطبع قيمته ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)). لا ربط بين محادثة القناة والهوية يُخزَّن، ولا مفتاح أجنبي إلى `identity_users` ([ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)) — فتسريب جداول القناة لا يكشف رسم هوية. وكل استعلام يمرّ ببارامترات Drizzle لا بتركيب نصّي، والقيم المخزّنة سبق أن طُهِّرت وحُدَّت عند حدّ المُهيّئ.
13. **هل performance؟** مسار الـwebhook يكسب إدخالاً واحداً بدل عمل في الذاكرة، وهو الثمن الحقيقي للضمان. `dueForRetry` يُرتّب ويقصر **داخل** SQL على الفهرس المعرَّف في العقد فلا تُجلب صفوف لتُرمى، و`remember` إدخال واحد لا قراءة ثم كتابة (نداء واحد بدل اثنين ونافذة تعارض معدومة)، و`applyProgress` يزيد النسخة داخل العبارة فلا دورة قراءة-تعديل-كتابة. البركة تُحرَّر عند إغلاق التطبيق فلا اتصالات معلّقة بين النشرات.
14. **هل monitoring؟** `runtime.persistence` يُخبر المشغّل بأيّ مجموعة يعمل، و`unpublished()` يجعل عمق صندوق الصادر قابلاً للقياس، وطابور الاستحقاق صار قابلاً للاستعلام من خارج العملية (`status = 'queued'` + `next_attempt_at`) — أي أن المراقبة الأعمق التي أُجّلت في MR 4 صارت ممكنة فعلاً. ربطها بلوحة أو تنبيه يحتاج مُشغّلاً دوريّاً وناشراً، وهما مؤجّلان مُعلَنان.

**Related:** MR [!28](https://gitlab.com/uxxxu/wasla/-/merge_requests/28) (`feat/channel-postgres-stores`)، [CHANNEL_PERSISTENCE.md](../02-architecture/CHANNEL_PERSISTENCE.md)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [DB_INTEGRATION_CI](../12-testing/DB_INTEGRATION_CI.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · Phase 03 MR 4 — البوتات الثلاثة وطبقة تشغيلها `@wasla/bot-runtime`

**Task:** جعل الشطر الأول من بوابة خروج المرحلة 03 قابلاً للتشغيل: ثلاثة تطبيقات قابلة للنشر (customer · driver · partner) كل واحد يخدم عقد القناة على Fastify، يتحقّق من رمز الـwebhook قبل أي معالجة، ويُجيب `/start` بزر يفتح **Mini App الخاصة به** ويرفض البوتين الآخرين. **Status:** Completed (376 اختبار وحدة تنجح محلياً، منها 76 جديدة) · **MR:** [!27](https://gitlab.com/uxxxu/wasla/-/merge_requests/27)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/bot-runtime` (`@wasla/bot-runtime`): `config.ts` (البيئة → `BotConfig` بفحص صارم + `SingleBotRegistry`) · `system.ts` (`SystemClock` + `CryptoIdGenerator`) · `identity-bootstrap.ts` (`HttpIdentityBootstrap` على `POST /identity/resolve`) · `welcome.ts` (نص الترحيب + بناء ردّ `/start` بزر `mini_app` واحد ومفتاح تكرار `start:<bot>:<update>`) · `runtime.ts` (التركيب — المكان الوحيد الذي يسمّي مُهيّئاً ملموساً) · `http/app.ts` (المسارات الخمسة كما في `api.openapi.yml`) · `http/errors.ts` · `http/server.ts` (`buildBotApp`/`startBot`/`runBot`) · `index.ts` + 58 اختباراً في ستة ملفات. (ب) ثلاثة تطبيقات: `bots/{customer,driver,partner}-bot` بـ`package.json` + `tsconfig.json` + `src/server.ts` (`buildApp` بلا أثر جانبي) + `src/main.ts` (الملف الوحيد الذي يربط منفذاً) + `src/index.ts` + 6 اختبارات لكل بوت؛ وحُذفت ملفات `.gitkeep` الثلاثة. (ج) توثيق: `docs/02-architecture/CHANNEL_BOTS.md` (جديد — عشرة أقسام) + `CONTAINERS.md` (§2 حالة البوتات الفعلية بعد MR 4 · §5.1 صفّ `bot-runtime` واتجاه الاعتماد) + `HANDOFF_NEXT_STEPS.md` (§1 لقطة · §7 البند [4] ✅ Done والبند [5] ← التالي مع تحذيرَي التخزين والفجوة · §8 رابط) + `MASTER_PROGRESS.md` (صفّ Phase 03) + هذا الإدخال. (د) `pnpm-lock.yaml` للحزم الأربع الجديدة. **لم يُلمس** سطر واحد في `channel-core` ولا في `telegram-adapter` ولا في الخدمات ولا في `.gitlab-ci.yml`.
2. **لماذا؟** لأن بوابة الخروج تقول «**كل** Bot يفتح Mini App المناسبة»، وهذا لا يُثبَت بحزمة مكتبة بل بتطبيق قابل للنشر. وثلاثة قرارات تستحق التبرير: (أ) **ثلاثة تطبيقات لا واحد** — لكل بوت رمز Telegram ورمز webhook خاصان، فدمجها يجعل تسريب رمز واحد تسريباً للثلاثة ويجعل عطل بوت العميل يوقف السائقين والشركاء؛ الفصل فصل نطاق ضرر. (ب) **حزمة مشتركة لا ثلاث نسخ** — الـwebhook هو نقطة الدخول الوحيدة غير الموثوقة في وصلة، والتحقّق من رمزه *هو* مصادقته؛ ثلاث نسخ من هذا الفحص ثلاثة مواضع تتعفّن مستقلةً وإحداها ستنسى الفحص، كما أن قاعدة «بوت واحد ⇄ Mini App واحدة» تُفرَض حينها في مكان واحد (`SingleBotRegistry`) بدل أن تُراجع ثلاثاً. (ج) **الجذر لا يحمل منطقاً** — كل ما يميّز التطبيق هو اسم بوته، وأي سلوك يُكتب فيه يصبح فوراً سلوكاً بلا نظير في البوتين الآخرين.
3. **أين؟** `packages/bot-runtime/` + `bots/customer-bot/` + `bots/driver-bot/` + `bots/partner-bot/` + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `corepack pnpm -r run typecheck` نظيف على 12 مشروعاً، و`corepack pnpm -r run test` = **376 اختباراً تنجح** (300 سابقاً + 76 جديداً)، كلّها بـ`app.inject` بلا فتح منفذ: (أ) **الحدّ غير الموثوق** — رمز خاطئ · ترويسة مفقودة · **رمز غير مُهيّأ في النشر** ⇒ 401 `CHANNEL_UNAUTHORIZED_WEBHOOK` مع التحقّق **صفر معالجة** (لا تفسير ولا تخزين ولا إرسال). (ب) **بوابة الخروج** — `/start` للبوتات الثلاثة يُنتج زراً واحداً `mini_app` يطابق `BOT_MINI_APP[bot]`، وكل تطبيق يرفض البوتين الآخرين بـ404 `CHANNEL_UNKNOWN_BOT` على الـwebhook وعلى `mini-app` معاً. (ج) **سلوك Telegram** — تحديث مُعاد ⇒ `202 duplicate` بلا إرسال ثانٍ، وفشل ردّ الترحيب لا يُحوّل الـwebhook إلى خطأ. (د) **الصادر** — تخطيط `snake_case` → أمر محايد، تكرار المفتاح ⇒ `duplicate`، فشل قابل للإعادة ⇒ `queued`، فشل دائم ⇒ كود القناة نفسه (`failed` ليست حالة في العقد). (هـ) **التهيئة** — كل خطأ نشر يُلتقط عند الإقلاع (رمز ناقص · سرّ < 16 · `http` في عنوان Mini App · قالب بلا `{payload}` · منفذ غير رقمي). (و) **الأكسيوم** — نفس دالة التركيب تُبنى مرة بـ`TelegramChannelAdapter` ومرة بـ`MockChannelAdapter` + `FakeIdentityBootstrap` بلا تغيير سطر فوقها. الاختبارات تتحقّق من **الأكواد** لا من النصوص العربية.
5. **ما الخطوة التالية؟** MR 5/7: مُهيّئات Postgres لـ`channel_updates` / `channel_deliveries` / `channel_outbox` + اختبارات تكامل + وظيفة CI — تستبدل ثلاثة أسطر في `runtime.ts` ولا شيء غيرها، ومعها مُشغّل دوري لـ`retryDueDeliveries`.
6. **هل مستند؟** نعم: `CHANNEL_BOTS.md` بعشرة أقسام تحمل **جدول متغيّرات البيئة كاملاً** ومبرّر الحزمة الجديدة (ENGINEERING_DOCUMENTATION_LAW §7) وترتيب فحص الرمز ولماذا `202` حتى للتكرار وقائمة المؤجّلات ومحلّ كل مؤجّل، وأمر تشغيل بوت محلياً. من يأتي بعدنا لا يحتاج قراءة الكود ليعرف أيّ متغيّر ينقصه.
7. **هل مراجَع؟** الكود مُتحقَّق آلياً (typecheck + 376 اختباراً) والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا. هذه **تنفيذ** لـ[ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) لا انحراف عنه: `bots/*` بقيت جذور تركيب رقيقة، والحزمة الجديدة طبقة تشغيل داخل نفس الاتجاه الأحادي `bots/*` → `bot-runtime` → `telegram-adapter` → `channel-core`. مبرّر وجودها موثّق في وثيقتها كما تفرض قوانين المستودع.
9. **هل يكسر backward compatibility؟** لا. لا سطح قائم تغيّر: المسارات كلها جديدة ومطابقة لعقد القناة المدمج في MR 1، ولا تعديل على حزمة قائمة.
10. **هل migration؟** لا هجرة بيانات في هذه الدفعة (لا Postgres بعد). **لكن للنشر شرط**: بلا `<BOT>_BOT_TOKEN` و`<BOT>_BOT_WEBHOOK_SECRET` و`<BOT>_BOT_MINI_APP_URL` لا يُقلع البوت أصلاً — وهذا مقصود.
11. **هل توجد مخاطر؟** نعم، خطران معلومان ومكتوبان: (أ) **التخزين في الذاكرة** — إعادة تشغيل العملية تُنسي أيّ تحديث تمّت معالجته، فمنع التكرار لا يعبر الإقلاع وقد تتكرّر رسالة ترحيب بعد إعادة نشر؛ مقبول لتشغيل محلي وغير مقبول للإنتاج، ومحلّه MR 5. (ب) **فجوة عقد الهوية** — `/identity/resolve` مصوغ بشكل Telegram (`telegram_user_id` / `telegram_username`) بينما `InboundActor` في النواة محايد ولا يحمل `username` أصلاً؛ فلا نُرسل `username`، وقناة غير Telegram ستحتاج تعديل عقد خدمة قائمة. لم يُصلَح الآن لأن إصلاحه تغيير عقد خدمة أخرى، ومحلّه مرحلة القناة الثانية — مذكور في الوثيقة وفي HANDOFF حتى لا يُكتشَف متأخراً. (ج) مخاطرة مُغلقة: بلا خدمة هوية مُهيّأة يرفض البوت `/start` بـ503 قابلاً للإعادة و`/health` يقول `degraded` — **لا هوية مُختلَقة** لأن معرّفاً مُختلَقاً سيُخزَّن عبر حدث ولا يمكن مطابقته بعدها.
12. **هل security؟** نعم، وهي جوهر الدفعة: (أ) `assertWebhookSecret` **قبل قراءة الجسم وقبل معرفة أيّ بوت** — أي عمل قبل المصادقة عمل يُجبرنا الغريب عليه؛ ومقارنة ثابتة الزمن من المُهيّئ. (ب) **الفشل مغلق**: نسيان المتغيّر يعني 401 للجميع لا webhook مفتوحاً، ولا قيمة افتراضية لأي سرّ ولا وضع «تطوير» يتجاوز الفحص. (ج) رسائل أخطاء التهيئة **تسمّي المتغيّر ولا تطبع قيمته أبداً**، والرمز لا يظهر في أي مسار خطأ ([SECURITY_RULES](../00-rules/SECURITY_RULES.md)). (د) عنوان Mini App يجب أن يكون HTTPS، والزرّ يجب أن يطابق Mini App البوت (مفروض في طبقتين). (هـ) `POST /channel/messages` **داخلي** ويجب ألا يُنشَر خارج شبكة الكلستر — مكتوب في §3 من الوثيقة.
13. **هل performance؟** لا عمل ثقيل في مسار الـwebhook: تفسير + كتابة في الذاكرة + نداء هوية واحد لـ`/start` بمهلة 2000ms، وردّ الترحيب لا يُعيق الاستجابة لأن فشله لا يُنشر. المُحدِّد في المُهيّئ لا ينام (MR 3)، فلا طلب webhook محتجز.
14. **هل monitoring؟** `GET /health` يُميّز `ok` من `degraded` (خدمة الهوية غير موصولة)، وسجلّ Fastify مُفعَّل مع `request.id` كمعرّف تتبّع، وفشل ردّ الترحيب يُسجَّل بكوده. مراقبة أعمق (عمق صندوق الصادر والتسليمات المستحقّة) تصبح ذات معنى بعد MR 5.

**Related:** [MR !27](https://gitlab.com/uxxxu/wasla/-/merge_requests/27)، [CHANNEL_BOTS.md](../02-architecture/CHANNEL_BOTS.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-21 · حوكمة — تشديد حماية `main` إلى «No one» للدفع المباشر

**Task:** إغلاق السؤال المعلّق في [HANDOFF §5](HANDOFF_NEXT_STEPS.md): مواءمة الإعداد الفعلي على GitLab مع قاعدة «لا Push مباشر» في [GIT_RULES §1](../00-rules/GIT_RULES.md). **Status:** Completed (مُطبَّق على المشروع + موثّق) · **MR:** [!26](https://gitlab.com/uxxxu/wasla/-/merge_requests/26)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) **إعداد على GitLab لا كود**: حماية الفرع `main` أُعيد إنشاؤها بـ`push_access_level = 0` («No one») مع الإبقاء على `merge_access_level = 40` (Maintainers) و`allow_force_push = false`. (ب) توثيق: `docs/00-rules/GIT_RULES.md` §1 — جدول الإعداد الفعلي الثلاثي مع مبرّر كل قيمة وطريقة المراجعة/العكس؛ `docs/16-progress/HANDOFF_NEXT_STEPS.md` §5 — التوصية صارت حالة مُطبَّقة، مع أثرها العملي على من يعمل بعدنا وكيفية عكسها؛ ولقطة §1 (تاريخ آخر تحديث)؛ وهذا الإدخال.
2. **لماذا؟** لأن القاعدة كانت **عُرفاً يعتمد على انتباه من يملك الصلاحية**: `Maintainers` تسمح بالدفع المباشر، وسطر واحد بالخطأ (`git push origin main`) يتجاوز CI والمراجعة و`doc-coverage` معاً — أي أن كل قوانين المستودع كانت قابلة للتجاوز بأمر واحد. مع «No one» يصير التجاوز **مستحيلاً تقنياً** لا مذموماً أخلاقياً، وهو نفس منطق المستودع في مواضع أخرى (اختبار الحراسة المعماري في `channel-core` يفشل البناء بدل أن «يُنصح» بعدم تسريب مفردات القناة).
3. **أين؟** إعدادات المشروع على GitLab (`/projects/85566384/protected_branches`) + `docs/00-rules/GIT_RULES.md` + `docs/16-progress/HANDOFF_NEXT_STEPS.md` + هذا الإدخال. **لا سطر كود.**
4. **كيف تم اختباره؟** (أ) `GET /protected_branches` بعد التغيير يُظهر `push_access_levels = [No one]` ومستوىً واحداً فقط، و`merge_access_levels = [Maintainers]`، و`allow_force_push = false`. (ب) الدليل العملي أن الدمج لم يتأثّر: هذه الدفعة نفسها مرّت بالمسار الكامل (فرع → MR → أنبوب أخضر → دمج) بعد التشديد. (ج) **درس تقني مهم**: `PATCH /protected_branches/main` بـ`allowed_to_push` **أضاف** مستوى «No one» **بجانب** «Maintainers» بدل أن يستبدله — أي أن الدفع بقي مسموحاً فعلياً؛ فالطريق الصحيح `DELETE` ثم `POST` بـ`push_access_level=0`، وقد وُثّق ذلك في المكانين حتى لا يظنّ من يأتي بعدنا أنه شدّد الحماية وهو لم يفعل.
5. **ما الخطوة التالية؟** لا أثر على خطة المرحلة: التالي كما هو MR 4/7 `feat(bots)` — ثلاثة جذور تركيب Fastify + `POST /channel/{bot}/webhook` بالتحقّق من الرمز + سجلّ بوتات مقود بالبيئة + مُهيّئ HTTP لتهيئة الهوية ([HANDOFF §7](HANDOFF_NEXT_STEPS.md)).
6. **هل مستند؟** نعم — وهذا جوهر الدفعة: إعداد غير موثّق يُعادل إعداداً غير موجود، لأن من يجد 403 بلا تفسير قد يُعطّل الحماية ظنّاً أنها خلل. لذلك يحمل التوثيق **القيم الثلاث ومبرّراتها وأمر المراجعة وطريقة العكس المشروط**.
7. **هل مراجَع؟** الإعداد مُتحقَّق منه بالقراءة من الـAPI بعد الكتابة، والتوثيق يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا. هذا **تنفيذ** لقاعدة قائمة في GIT_RULES §1 لا قرار جديد يخالفها. (العكس هو الذي يستلزم قراراً موثّقاً: GIT_RULES §1 ينص أن تعطيل الحماية لا يجوز إلا بـADR ومبرّر تشغيلي.)
9. **هل يكسر backward compatibility؟** لا على مستوى الكود. أما على مستوى سير العمل فيكسر **عادة** واحدة: الدفع المباشر إلى `main` صار يعود 403 للجميع بما فيهم المالك — وهذا هو المقصود، ومُعلَن في HANDOFF §5 وGIT_RULES §1.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** الخطر الوحيد تشغيلي: إصلاح عاجل لا يمكن أن ينتظر أنبوباً يصبح متعذّراً بالدفع المباشر. المقايضة مقبولة لأن الأنبوب دقائق، ولأن البديل (باب خلفي دائم) يُفقد كل ضمانات المستودع قيمتها. مسار العكس المشروط موثّق في المكانين، ويُلزم بإعادة التشديد فوراً وبتسجيل الحادثة هنا. ملاحظة ثانية: من يعمل بأدوات آلية يجب أن يُنشئ فرعاً دائماً — وهو ما نفعله أصلاً في كل دفعات المرحلة 03.
12. **هل security؟** نعم، وهي دفعة أمن حوكمة بالكامل: إغلاق مسار يتجاوز المراجعة وCI (بما فيه `repo-structure` الذي يفحص الأسرار، و`doc-coverage`)؛ وبقاء `allow_force_push = false` يمنع إعادة كتابة تاريخ `main`. يبقى بند [HANDOFF §5](HANDOFF_NEXT_STEPS.md) الآخر قائماً بلا تغيير: **رمز الوصول الذي ظهر في محادثة يجب إبطاله/تدويره**.
13. **هل performance؟** لا أثر.
14. **هل monitoring؟** الرفض يظهر كـ403 من GitLab، وسجلّ الأحداث في المشروع يُظهر تغيير الحماية بفاعله ووقته. لا مراقبة إضافية مطلوبة.

**Related:** [MR !26](https://gitlab.com/uxxxu/wasla/-/merge_requests/26)، [GIT_RULES §1](../00-rules/GIT_RULES.md)، [HANDOFF §5](HANDOFF_NEXT_STEPS.md)، [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)

---

## 2026-08-20 · Phase 03 MR 3 — مُهيّئ قناة Telegram `@wasla/telegram-adapter`

**Task:** تنفيذ المكان **الوحيد** في المستودع الذي يعرف Telegram Bot API وفق [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md): تفسير التحديثات + الإرسال + أزرار `web_app` + تخطيط أخطاء Bot API إلى أكواد `CHANNEL_*` مع احترام `retry_after` + ميزانية معدّل + التحقّق من رمز الـwebhook — يُنفّذ منفذين فقط ولا يعرف حالة استخدام واحدة. **Status:** Completed (300 اختبار وحدة تنجح محلياً، منها 86 جديدة) · **MR:** [!25](https://gitlab.com/uxxxu/wasla/-/merge_requests/25)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/telegram-adapter` (`@wasla/telegram-adapter`): `package.json` + `tsconfig.json`. (ب) `src/api-shapes.ts` — الوصف الجزئي الوحيد لسلك Bot API + قرّاء آمنون (`readIdentifier` يحوّل كل معرّف إلى **سلسلة**، `readEnvelope` يقرأ `ok`/`result`/`description`/`error_code`/`parameters.retry_after`). (ج) `src/sanitize.ts` — `cleanLine`/`cleanText`/`cleanLanguageCode`: حذف محارف التحكّم ومحارف عكس الاتجاه (U+202A–U+202E · U+2066–U+2069) مع إبقاء الأسطر في نص الرسالة. (د) `src/update-parser.ts` — `TelegramUpdateParser` يُنفّذ `UpdateParserPort`: أمر (بحذف `@botname` وتصغير الحرف واستخراج الوسيط) · نص · استجابة زر · جهة اتصال · موقع (إحداثيات مُتحقَّقة → `"lat,lon"`) · حدث مجموعة · `message|edited_message|channel_post|edited_channel_post`. (هـ) `src/keyboard.ts` — نيّة الزر → `inline_keyboard` بزرّ واحد لكل صف: `mini_app` → `web_app` (HTTPS إلزامي · المسار يُحلّل على أساس عنوان البوت · تغيير النطاق مرفوض · يجب أن يطابق Mini App البوت) و`deep_link` → `url` من قالب البوت بترميز `encodeDeepLinkPayload`. (و) `src/error-mapping.ts` — `mapTelegramFailure` → `{errorCode, retryAfterSeconds?}`. (ز) `src/rate-limit.ts` — `TokenBucketRateLimiter` (25/ث للبوت · 1/ث للمحادثة · سقف 5000 محادثة بـLRU) على منفذ الساعة، بـ`take` **لا ينام** و`penalise` يجعل تهدئة Telegram هي المرجع. (ح) `src/bot-api-client.ts` — عميل رقيق بـ`fetch` محقون ومهلة `AbortController`، لا يرمي أبداً ولا يُظهر الرمز في أي مسار. (ط) `src/channel-adapter.ts` — `TelegramChannelAdapter` يُنفّذ `ChannelPort`، نموذج واحد لكل بوت. (ي) `src/webhook-auth.ts` — `assertWebhookSecret` بمقارنة ثابتة الزمن وحدّ أدنى 16 محرفاً وقراءة ترويسة غير حسّاسة لحالة الأحرف. (ك) `src/index.ts` + `src/__tests__/` (86 اختباراً في سبعة ملفات منها **8 اختبارات مطابقة منافذ**). (ل) توثيق: `docs/02-architecture/CHANNEL_TELEGRAM_ADAPTER.md` (جديد) + `CONTAINERS.md` §5.1 + `HANDOFF_NEXT_STEPS.md` (§1 + §7: MR [3] ✅ Done و MR [4] = التالي بتفصيله + §8) + `MASTER_PROGRESS.md` (صف Phase 03) + هذا الإدخال. (م) `pnpm-lock.yaml` للحزمة الجديدة. **لم يُلمس** أي سطر في `channel-core` ولا في الخدمات القائمة ولا في `.gitlab-ci.yml`.
2. **لماذا؟** لأن «إمكانية استبدال المُهيّئ بـMock» تفرض أن تكون معرفة Telegram كلها في حزمة واحدة قابلة للحذف، لا موزّعة في البوتات والخدمات؛ فهذه الحزمة هي حدّ الترجمة: تُحوّل السلك إلى مفردات محايدة وتُحوّل الفشل إلى كود، ثم تتوقّف. وثلاثة قرارات تستحق التبرير: (أ) **الفوضى الشكلية تُرمى وغير المدعوم يُعاد كـ`unsupported`** — لأن رفض غير المدعوم كود `CHANNEL_UNSUPPORTED_UPDATE` وهو قرار النواة؛ لو رماه المفسّر لانقسمت السياسة على مكانين ولما استطاعت النواة تغيير قائمة المدعوم دون لمس المُهيّئ. (ب) **`send` لا يرمي أبداً** — سياسة إعادة المحاولة ملك النواة، واستثناء يعبر الحدود يجعل حالة التسليم غير محدّدة (أُرسِلت؟ لا؟) بينما نتيجة تحمل كوداً تُترجم فوراً إلى `sent`/`queued`/`failed` مع حدث. (ج) **المُحدِّد لا ينام** — النوم داخل `send` يحتجز طلب webhook مفتوحاً ويُخفي عمق الطابور، أما إرجاع `CHANNEL_RATE_LIMITED` فيُظهر الرسالة المُهدَّأة كـ`queued` بزمن استحقاق يقرأه المراقب.
3. **أين؟** `packages/telegram-adapter/` (كل الكود الجديد) + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** محلياً كما في CI: `pnpm -r run typecheck` ✅ (ثماني حزم/خدمات) و`pnpm -r run test` ✅ **300 اختباراً** (214 سابقة + 86 جديدة: مفسّر 23 · مُهيّئ بـfetch مزيف 17 · أزرار 12 · تخطيط أخطاء 10 · معدّل 8 · رمز webhook 8 · **مطابقة منافذ 8**). الاختبارات تُثبت سلوكاً لا شكلاً: معرّف مجموعة فائقة يتجاوز المدى الآمن للأعداد يعود **سلسلة** بلا فقدان دقّة؛ `/start@wasla_bot payload` يعود أمراً `start` بوسيط؛ إحداثيات مستحيلة تعود `unsupported` لا موقعاً؛ محارف عكس الاتجاه تُحذف من الاسم المعروض؛ 403 يعود غير قابل للإعادة و429 قابلاً للإعادة **بتهدئة Telegram نفسها**؛ الرمز لا يظهر في الجسم ولا في `describe()`؛ رمز webhook أقصر من 16 محرفاً يُرفض ولا «يُعطّل التحقّق»؛ ومُهيّئ فشل بناء الزر لا يُصدر نداءً شبكياً واحداً. الاختبارات تؤكّد **أكواد** الأخطاء لا نصوصها العربية، وقابلية الإعادة تُقرأ من كتالوج العقود لا تُكرَّر حرفياً. واختبار الحراسة المعماري في `channel-core` بقي أخضر — أي لم تتسرّب مفردة Telegram إلى النواة.
5. **ما الخطوة التالية؟** MR 4/7: `feat(bots)` — ثلاثة جذور تركيب Fastify (customer/driver/partner) تفتح `POST /channel/{bot}/webhook` بالتحقّق من الرمز **قبل أي معالجة** ثم `receiveUpdate` وردّ 202 دائماً، مع سجلّ بوتات مقود بالبيئة (رمز + `BotPresence`) ومُهيّئ HTTP لمنفذ تهيئة الهوية على نمط `HttpIdentityLookupPort` في geography. التفصيل في [HANDOFF §7](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم — `docs/02-architecture/CHANNEL_TELEGRAM_ADAPTER.md` (لماذا توجد الحزمة · البنية ملفاً ملفاً · شجرة قرار التفسير · جدول القرارات السلوكية بمبرّراتها · سياسة التطهير · تدفّق الإرسال · جدول تخطيط الأخطاء بعمود قابلية الإعادة · ميزانية المعدّل · أمن الحدود · حالة التحقّق · جدول المؤجّلات وأين يُنجَز كل مؤجّل · مثال الاستبدال بـMock) + `CONTAINERS §5.1` + `HANDOFF §1/§7/§8` + `MASTER_PROGRESS` + هذا الإدخال. كل ملف مصدري يبدأ بتعليق يشرح **لماذا** يوجد.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل قواعد ADR-007 السبع الملزمة في HANDOFF §7: النيّة تُبنى زرّاً في المُهيّئ لا في النواة ✅ · أخطاء Telegram تُترجم عند حدّ المُهيّئ مع `retryable` ✅ · روابط عميقة بلا حالة ≤64 (الترميز من النواة) ✅ · لا تخزين لربط `chat_ref` ↔ هوية ✅ (لا مخزن هنا أصلاً) · المجموعات نوع محادثة لا مسار مواز ✅ · كل منفذ له بديل Mock ✅. القاعدتان المتبقيتان (مدخل واحد بالتحقّق من الرمز · مخرج واحد) تحتاجان طبقة HTTP: أداة التحقّق جاهزة هنا و**استخدامها** في MR 4، ومُعلَن في §9. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-007 يحكم البنية والمنافذ والمكدّس وهذه المراجعة تنفيذه الحرفي. ولا تعديل عقد في هذه الدفعة: لا `schema.sql` ولا `events.json` ولا `api.openapi.yml` ولا كتالوج الأخطاء لُمس، والأكواد كلها مستهلَكة من `@wasla/contracts-channel` كما هي.
9. **هل يكسر backward compatibility؟** لا. حزمة جديدة لا مستهلك لها بعد (البوتات في MR 4)، ولا تغيير في سطح `channel-core` ولا في العقود.
10. **هل migration؟** لا — لا لمس لقاعدة بيانات ولا لعقد بياناتها؛ مُهيّئات Postgres في MR 5.
11. **هل توجد مخاطر؟** (أ) **أشكال Bot API موصوفة جزئياً**: حقل يغيّره Telegram قد يُقرأ كـ`unsupported` بدل أن يُفسَّر — مقصود، فالبديل (أنواع كاملة) عبء صيانة بلا مستهلك، والقرّاء الآمنون يمنعون الانهيار. (ب) **ميزانية المعدّل داخل العملية فقط**: مع عدة نسخ من البوت يبقى الحدّ الحقيقي محفوظاً بتهدئة Telegram وحدها حتى يُنفَّذ `channel_rate_budgets` المؤجّل — طبقة أمان لا ضمان، مُعلَن في §6 و§9. (ج) **مطابقة الوصف نصّية**: Telegram يخلط حالات كثيرة تحت 400/403 فتُطابَق أوصافه بجدولين؛ الوصف المجهول يتدهور إلى رمز الحالة بدل أن يُسقط الإرسال. (د) `answerCallbackQuery` غير مُنفَّذ ⇒ دوّارة زر الاستجابة تبقى ظاهرة حتى MR 4/6 (لا تأثير على التسليم).
12. **هل security؟** نعم، وهو نصف قيمة هذه الحزمة: **رمز الـwebhook** يُقارَن بزمن ثابت برسالة واحدة بلا تفاصيل (فلا يصلح أوراكل)، ورمز غير مُهيَّأ أو أقصر من 16 محرفاً = **رفض** لا تعطيل للتحقّق. **رمز البوت** من البيئة فقط، لا حرف منه في المصدر، ويوجد داخل مسار الطلب وحده؛ `describe()` بلا رمز والاستثناءات تُبتلع لأن سببها قد يحمل المسار والمسار يحمل الرمز. **المدخلات غير الموثوقة** تُطهَّر وتُحدَّ عند الحدّ الخارجي (محارف تحكّم واتجاه · حدود `LIMITS` · `language_code` يُرفض ولا يُصلَح لأن locale خاطئاً يغيّر لغة الردّ بصمت). **العناوين** من الإعداد لا من المصدر، وزر `web_app` يشترط HTTPS ويرفض مساراً يغيّر النطاق. **نصوص أخطاء Telegram** تُطابَق ثم تُهمَل فلا تظهر في سجلّ ولا حدث ولا استجابة.
13. **هل performance؟** ميزانية المعدّل تمنع 429 قبل وقوعها (النداء المرفوض يُحسب على البوت والاندفاع يُطيل التهدئة)، والتهدئة تُحسب بحيث يتاح أول رمز **عند** انتهائها بالضبط فلا ينزلق تسليم جدولته النواة خطوة تباطؤ كاملة بسبب مُحدِّدنا. خريطة المحادثات مقيّدة بسقف LRU لأن خريطة بلا سقف تعني تخصيصاً تحكمه رسائل الغرباء. للنداءات مهلة صريحة (10 ثوانٍ) عبر `AbortController` — بدونها يعلق طلب webhook على اتصال ميت.
14. **هل monitoring؟** لا يُصدر المُهيّئ أحداثاً (ملك النواة) لكنه يُغني إشاراتها: كل فشل يعود بكود `CHANNEL_*` وعلم قابلية إعادة، فيُميّز `channel.message.failed` بين «محادثة غير قابلة للوصول» و«خلل نشر» و«تجاوز معدّل»؛ والتجاوز يعود بـ`retryAfterSeconds` فيظهر سبب التأخير في `nextAttemptAt`. المراقبة عبر HTTP (رموز 202/401 وزمن الاستجابة) تأتي مع MR 4.

**Related:** [MR !25](https://gitlab.com/uxxxu/wasla/-/merge_requests/25)، [وثيقة المُهيّئ](../02-architecture/CHANNEL_TELEGRAM_ADAPTER.md)، [وثيقة النواة](../02-architecture/CHANNEL_LAYER_CORE.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [كتالوج أخطاء القناة](../../packages/channel-core/contracts/errors.md)، [SECURITY_RULES](../00-rules/SECURITY_RULES.md)، [CONTAINERS §5.1](../02-architecture/CONTAINERS.md)

---

## 2026-08-20 · Phase 03 MR 2 — نواة `@wasla/channel-core` المحايدة

**Task:** تنفيذ نواة طبقة القنوات وفق [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md): نموذج مجال محايد + المنافذ التسعة + حالات الاستخدام (استقبال ومنع تكرار · تسليم وإعادة محاولة · فتح Mini App · روابط عميقة) + مُهيّئات in-memory وMock — بلا أي معرفة بقناة، مع اختبار حراسة معماري يُفشل البناء عند أي تسريب. **Status:** Completed (214 اختبار وحدة تنجح محلياً، منها 84 جديدة) · **MR:** [!24](https://gitlab.com/uxxxu/wasla/-/merge_requests/24)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) حزمة جديدة `packages/channel-core` (`@wasla/channel-core`): `package.json` + `tsconfig.json`؛ `src/domain/` = `model.ts` (مفردات محيّدة: `ChatRef`/`ChannelUserRef` كسلاسل opaque · `InboundUpdate` · `ButtonIntent` كنيّة لا زر · `DeliveryRecord` مطابق للـDDL · `BotPresence` · `LIMITS`)، `errors.ts` (`ChannelError` يشتق الصنف والحالة و`retryable` من كتالوج العقود — لا كتالوج ثانٍ)، `events.ts` (بناة الأحداث الأربعة بمغلّف واحد)، `deep-link.ts` (ترميز/فك base64url بحد 64 حرفاً)، `retry.ts` (تباطؤ أسّي + jitter + احترام تهدئة القناة + الجدول المنشور). (ب) `src/ports.ts` — المنافذ التسعة: `ChannelPort` · `UpdateParserPort` · `ProcessedUpdateStorePort` · `DeliveryStorePort` · `OutboxPort` · `IdentityBootstrapPort` · `MiniAppRegistryPort` · `ClockPort` · `IdGeneratorPort`. (ج) `src/use-cases/` — `deps.ts` + `receiveUpdate` + `sendMessage` (+`attemptDelivery` المشترك) + `retryDueDeliveries` + `getMiniAppLaunch`/`createDeepLink`. (د) `src/infrastructure/in-memory.ts` — تسعة مُهيّئات اختبار منها **`MockChannelAdapter`** و`FakeUpdateParser` و`FixedClock` و`SequentialIdGenerator`. (هـ) `src/__tests__/` — 84 اختباراً في ستة ملفات منها **38 اختبار حراسة معماري**. (و) تعديل عقد البيانات: عمودا `channel_deliveries.body` (JSONB) و`.bot` في `packages/channel-core/contracts/schema.sql`. (ز) توثيق: `docs/02-architecture/CHANNEL_LAYER_CORE.md` (جديد) + `CONTAINERS.md` §5.1 (حالة الحزم) + `HANDOFF_NEXT_STEPS.md` (لقطة §1 + §7: MR [2] ✅ Done و MR [3] = التالي بتفصيله) + `MASTER_PROGRESS.md` (صف Phase 03) + هذا الإدخال. (ح) `pnpm-lock.yaml` للحزمة الجديدة.
2. **لماذا؟** بوابة خروج المرحلة نصفها الأول «إمكانية استبدال مُهيّئ القناة بـMock» لا يمكن إثباته إلا إذا كان **كل** منطق القناة في حزمة لا تعرف قناة وتتصل بالعالم عبر منافذ فقط؛ لذلك سبقت النواة المُهيّئ (MR 3) والبوتات (MR 4). وفصل الساعة ومولّد المعرّفات كمنفذين ليس تجميلاً: بدونهما تصير اختبارات التباطؤ الأسّي وأزمنة `nextAttemptAt` رهينة التوقيت، فيتحوّل الفشل من «سلوك خاطئ» إلى «اختبار متقلّب». وترتيب خطوات الاستقبال (رفض غير المدعوم **قبل** تسجيل منع التكرار، وتهيئة الهوية **بعده**) اختيار سلوكي مقصود: الأول يحفظ إمكانية إعادة المحاولة بنفس المعرّف بعد الإصلاح، والثاني يمنع قصف خدمة الهوية بإعادة إرسال القناة لنفس التحديث.
3. **أين؟** `packages/channel-core/` (كل الكود الجديد) + `packages/channel-core/contracts/schema.sql` (تعديل) + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`. لم تُلمس أي خدمة قائمة (identity/geography) ولا `.gitlab-ci.yml`.
4. **كيف تم اختباره؟** محلياً كما في CI: `pnpm -r run typecheck` ✅ (سبع حزم/خدمات) و`pnpm -r run test` ✅ **214 اختباراً** (130 سابقة + 84 جديدة: استقبال 10 · إرسال 14 · إعادة محاولة 9 · روابط عميقة 8 · سطوح تشغيل 5 · حراسة 38). الاختبارات تُثبت سلوكاً لا شكلاً: التحديث المكرر يُرجع `duplicate` **بلا حدث وبلا نداء ثانٍ للهوية**؛ منع التكرار مُقيَّد بالبوت فبوتان يريان نفس المعرّف بشكل مشروع؛ الأمر غير المدعوم يُرفض ولا يُسجَّل (فتبقى إعادة المحاولة ممكنة)؛ فشل الهوية يُترجم إلى `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` قابل للإعادة؛ مفتاح منع التكرار المتكرر لا يُرسل ثانية (`sent.length === 1`)؛ الفشل القابل للإعادة يُعيد **نفس** التسليم إلى الطابور بـ`nextAttemptAt` محسوب ودون حدث؛ تهدئة القناة الأطول تفوز على الحساب؛ الفشل النهائي يُصدر `channel.message.failed` **مرة واحدة** بعد استنزاف السقف؛ زر Mini App يُصدر `channel.mini_app.launched`؛ وسبع حالات تحقّق تُرفض **قبل** لمس المُهيّئ (`sent.length === 0`). اختبار الحراسة يقرأ كل ملف `.ts` بعد إزالة التعليقات ويفشل عند أي مفردة قناة أو استيراد ممنوع، ويقفل اعتماديات وقت التشغيل على العقود والأخطاء فقط. أكّدت الاختبارات على **أكواد** الأخطاء لا على نصوصها العربية القابلة للتغيير.
5. **ما الخطوة التالية؟** MR 3/7: `feat(telegram-adapter)` — حزمة تُنفّذ `ChannelPort` + `UpdateParserPort` فقط: تفسير حِمل التحديث، الإرسال، أزرار `web_app`، تخطيط أخطاء Bot API إلى أكواد `CHANNEL_*` مع `retryable` واحترام `retry_after`، وحدود المعدّل. لا تعرف أي حالة استخدام، ولا تستوردها النواة أبداً (اختبار الحراسة يفشل إن حدث). الخطة الكاملة في [HANDOFF §7](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم — `docs/02-architecture/CHANNEL_LAYER_CORE.md` (البنية الداخلية · جدول المنافذ التسعة بمُهيّئ الاختبار ومُهيّئ الإنتاج لكل منفذ · تدفّق كل حالة استخدام بترتيب خطواتها ومبرّره · سياسة إعادة المحاولة والجدول المنشور · تخطيط الأخطاء · اختبار الحراسة · حالة التحقّق · جدول المؤجّلات وأين يُنجَز كل مؤجّل) + `CONTAINERS.md` §5.1 + `HANDOFF §1/§7` + `MASTER_PROGRESS` + هذا الإدخال. كل ملف مصدري يبدأ بتعليق يشرح **لماذا** يوجد لا ماذا يفعل.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل نمط `services/geography` (نفس ترتيب `domain/ports/use-cases/infrastructure` وأسلوب المُهيّئات في الذاكرة) ومقابل قواعد ADR-007 التسع بنداً بنداً: مخرج وحيد ✅ · منع تكرار في الاتجاهين ✅ · لا تخزين ربط `chat_ref` ↔ هوية ولا FK ✅ · نيّة Mini App لا زر قناة ✅ · روابط عميقة عديمة الحالة ≤64 ✅ · تخطيط الأخطاء عند حدود المُهيّئ ✅ · المجموعات نوع محادثة لا مسار مواز ✅ (حقل `isGroup` في نفس التدفّق). ما لا يشمله هذا الـMR من القواعد (التحقّق من secret token عند المدخل) يخصّ طبقة HTTP في MR 4 ومُعلَن في §9 من الوثيقة. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا ADR جديد — ADR-007 يحكم البنية والمنافذ والمكدّس، وهذه المراجعة تنفيذه الحرفي. لكن **تعديل عقد بيانات** حدث ويُعلَن هنا صراحةً: أُضيف عمودا `channel_deliveries.body` و`.bot`. السبب أن النواة أثبتت أن إعادة المحاولة تُرسل *نفس* الرسالة، فجسمها يجب أن يُخزَّن مع التسليم — لا يمكن إعادة بنائه من المُنادي لاحقاً (قد لا يكون موجوداً)، والبديل (تسليم بلا جسم) يجعل إعادة المحاولة وهماً. التعديل إضافة على عقد **لم يُطبَّق على أي قاعدة بعد** (تنفيذ الجداول في MR 5)، فلا هجرة ولا كسر.
9. **هل يكسر backward compatibility؟** لا. حزمة جديدة لا مستهلك لها بعد (المُهيّئ والبوتات في MR 3/4)، وتعديل الـDDL على عقد غير مُطبَّق. الأحداث والأكواد كلها من `@wasla/contracts-channel` بلا إضافة أو تعديل.
10. **هل migration؟** لا. `schema.sql` عقد منشور لا يُنفَّذ بعد؛ إنشاء الجداول ومُهيّئات Drizzle/Postgres في MR 5، ومُعلَن في ADR-007 §5 وفي §9 من وثيقة النواة.
11. **هل توجد مخاطر؟** (أ) كل المُهيّئات حالياً في الذاكرة ⇒ منع التكرار وطابور إعادة المحاولة يُفقدان بإعادة التشغيل — قيد معروف موثّق في ADR-007 ويُرفع في MR 5؛ ولا نشر قبل ذلك. (ب) `retryDueDeliveries` لا يجدول نفسه ⇒ بلا مجدول (MR 5) لا تُعاد أي محاولة فعلياً؛ مقصود (لا مؤقّتات في النواة) ومُعلَن في الوثيقة. (ج) تسليم مستحقّ فقد جسمه المخزَّن: يُفشل صراحةً بـ`CHANNEL_INTERNAL_ERROR` بدل اختراع رسالة بديلة، وله اختبار. (د) اختبار الحراسة يعتمد على قائمة مفردات ⇒ قد تظهر مفردة قناة جديدة غير مُدرَجة؛ خُفِّف بإدراج أسماء دوال Bot API الشائعة ومكتبات البوتات وبقفل الاعتماديات، ويجب تمديد القائمة عند دخول أي قناة جديدة. (هـ) لا `jitter` في الاختبارات (`NO_JITTER`) ⇒ الجدول المنشور مُثبَت بلا عشوائية، أما سلوك الإنتاج فيضيف 20% ومُعلَن في العقد.
12. **هل security؟** نعم بالتصميم وإن لم تُضف أسرار: `chatRef` و`channelUserRef` سلاسل opaque بلا معنى مُستخرَج، ولا تخزين لربط `chat_ref` ↔ `wasla_public_id` في هذه الطبقة (ملك Identity — ADR-001)، والهوية تُنال عبر منفذ لا استعلام مباشر، وكل حقل داخل يُتحقّق قبل استخدامه (نوع/أمر/حدود طول/عدد أزرار/طول حمولة رابط)، وحمولات الروابط العميقة عديمة الحالة ومحدودة بـ64 حرفاً ويُرفض فيها أي فعل غير مُسجَّل (منع تمرير أفعال مُزوّرة)، والنواة لا تُسجّل ولا تُعيد نص خطأ من القناة. لا رموز ولا مفاتيح في الكود.
13. **هل performance؟** إعادة المحاولة تباطؤ أسّي مع jitter وسقف خمس محاولات واحترام تهدئة القناة — لتجنّب عاصفة إعادة محاولة؛ ودفعة الاستنزاف محدودة افتراضياً بـ25 تسليماً (ضغط عكسي) وتُرتَّب بالأولوية ثم وقت الاستحقاق مطابقةً للفهرس الجزئي في الـDDL؛ ومسار الاستقبال يرفض قبل أي كتابة، ومنع التكرار عملية واحدة ذرّية لا «اقرأ ثم اكتب». لا قياس تشغيلي بعد (لا خدمة تعمل).
14. **هل monitoring؟** الأحداث الأربعة هي إشارات المراقبة: `channel.message.failed` يحمل كود الخطأ وعلم `retryable` و`attempts`، و`channel.mini_app.launched` هو أثر نصف بوابة الخروج، وقرار إعادة المحاولة يحمل `source` (`backoff` أو `channel_cooldown`) ليُقرأ سبب التأخير في السجلات لاحقاً. آلياً الآن: `build-test` يشغّل الاختبارات الـ84 (منها اختبار الحراسة الذي يمنع انحراف المعمارية) و`doc-coverage` يمنع دفع كود بلا توثيق.

**Related:** [MR !24](https://gitlab.com/uxxxu/wasla/-/merge_requests/24)، [وثيقة النواة](../02-architecture/CHANNEL_LAYER_CORE.md)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)، [عقود القناة](../../packages/channel-core/contracts/README.md)، [CONTAINERS §5.1](../02-architecture/CONTAINERS.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)

---

## 2026-08-20 · Phase 03 MR 1 — ADR-007 + عقود طبقة القنوات + `@wasla/contracts-channel`

**Task:** بدء المرحلة 03 (Telegram Channel Foundation) بالقرار المعماري الحاكم لموقع كود القناة وحدود عزلها، ثم نشر عقود القناة (API + أحداث + بيانات + أخطاء) وحزمة الأنواع المُكتبة — قبل أي كود قناة. **Status:** Completed (130 اختبار وحدة تنجح محلياً، منها 34 جديدة لعقود القناة) · **MR:** [!23](https://gitlab.com/uxxxu/wasla/-/merge_requests/23)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `docs/15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md` (جديد): القناة **طبقة توصيل لا خدمة** — `packages/channel-core` (نموذج مجال + منافذ، صفر معرفة بـTelegram) + `packages/telegram-adapter` (المكان الوحيد الذي يعرف Bot API) + `packages/contracts/channel` (أنواع) + `bots/*` جذور تركيب رقيقة؛ مع جدول المنافذ التسعة ومُهيّئ إنتاج/اختبار لكل منفذ، والمكدّس (Node 20 + TS strict + Fastify + webhook لا long polling + بلا مكتبة بوتات + Drizzle/Postgres في MR 5)، وتسع قواعد تصميم ملزمة، وقائمة المؤجّلات، وسبعة بدائل مرفوضة بأسبابها. (ب) `packages/channel-core/contracts/` (جديد): `api.openapi.yml` (مدخل وحيد `POST /channel/{bot}/webhook` بترويسة secret token + مخرج وحيد `POST /channel/messages` + `GET /channel/{bot}/mini-app` + `POST /channel/{bot}/deep-links` + `/health`)، `events.json` (أربعة أحداث v1 بمنتج `channel-adapter` وaggregate `channel_chat`)، `schema.sql` (`channel_updates` + `channel_deliveries` + `channel_outbox` مع فهارس منع التكرار وطابور إعادة المحاولة)، `errors.md` (14 كود `CHANNEL_*` + خطة إعادة المحاولة)، و`README.md`. (ج) `packages/contracts/channel/` (حزمة جديدة `@wasla/contracts-channel`): أنواع API مُولّدة بـ`openapi-typescript`، أنواع الأحداث مشتقّة يدوياً، كتالوج الأخطاء ككائن مُكتب + `statusForChannelError`/`isChannelErrorCode`، وثوابت `BOT_MINI_APP`/`DEEP_LINK_MAX_PAYLOAD_LENGTH`/`MAX_DELIVERY_ATTEMPTS`؛ 34 اختباراً في ثلاثة ملفات. (د) توثيق: `docs/02-architecture/CONTAINERS.md` §5.1 (طبقة القنوات) + `HANDOFF_NEXT_STEPS.md` (لقطة الحالة محدّثة + §7 خطة السبع مراجعات + §8 للروابط) + `MASTER_PROGRESS.md` (Phase 03 = In Progress + كيف تُثبت البوابة آلياً) + `ROADMAP.md` (ملاحظة الحالة). (هـ) `pnpm-lock.yaml` للحزمة الجديدة.
2. **لماذا؟** بوابة خروج المرحلة تنص على «إمكانية استبدال Telegram adapter بـMock Adapter»، وهذا **قرار بنيوي لا تفصيل تنفيذي**: لو سكن كود القناة في حزمة واحدة أو داخل خدمة، لبقيت قابلية الاستبدال عُرفاً يُراجَع بشرياً. بفصل `channel-core` عن `telegram-adapter` وجعل الاعتماد أحادي الاتجاه (`bots/*` → `telegram-adapter` → `channel-core`) يصبح أي تسريب لتفاصيل Telegram إلى المجال **فشل بناء لا ملاحظة مراجعة**. ورُفضت خدمة `services/telegram` لأنها تضيف خدمة 25 غير موجودة في `SERVICES.md` وتُثبّت اسم القناة في اسم مكوّن معماري — عكس مبدأ محايدة القناة الذي تفرضه المرحلة 23 (Channel Independence). كما تفرض القوانين البدء بالعقود قبل الكود (ADR-004)، وهو ما فعلته المرحلتان 01 و02.
3. **أين؟** `docs/15-decisions/` + `packages/channel-core/contracts/` + `packages/contracts/channel/` + `docs/02-architecture/` + `docs/16-progress/` + `pnpm-lock.yaml`. **لا سطر واحد من كود تنفيذي للقناة** — هذه المراجعة عقود وقرار وتوثيق فقط.
4. **كيف تم اختباره؟** محلياً بمُثبِّت مُجمّد مطابق لـCI: `pnpm -r run typecheck` ✅ لست حزم (منها الحزمة الجديدة) و`pnpm -r run test` ✅ **130 اختباراً** (96 سابقة + 34 جديدة). الاختبارات الجديدة ليست تجميلية: (أ) **حراسة انحراف الأحداث** — تقرأ `events.json` وتؤكد تطابق `CHANNEL_EVENT_TYPES` مع القيم الحرفية، وتثبيت `producer` و`aggregate.type`، ووجود `channel` في حمولة كل حدث، ومطابقة `required` لكل حدث مع النوع المقابل، وغياب أي اسم حقل `telegram_*` من العقد. (ب) **حراسة انحراف كتالوج الأخطاء** — تُحلّل جدول `errors.md` سطراً سطراً وتؤكد أن الأكواد والأصناف وأعلام `retryable` مطابقة تماماً للكائن المُصدَّر، فأي كود يُضاف في الوثيقة دون الكود (أو العكس) يُفشل CI. (ج) **حراسة حدود ADR-007** على ملف OpenAPI نفسه: وجود مدخل واحد ومخرج واحد، غياب أي نقطة إرسال لكل بوت، إلزامية ترويسة secret token، وغياب أسماء حقول خاصة بـtelegram. (د) اختبارات عقد تُثبت خريطة بوت↔Mini App واحدة لواحدة.
5. **ما الخطوة التالية؟** MR 2/7: نواة `@wasla/channel-core` — نموذج المجال + المنافذ التسعة + حالات الاستخدام (استقبال+منع تكرار · تسليم+إعادة محاولة · تشغيل Mini App · ترميز/فك Deep Link) + مُهيّئات in-memory وMock + اختبار حراسة يمنع أي ذكر لـTelegram داخل النواة. الخطة الكاملة (7 مراجعات) في [HANDOFF §7](HANDOFF_NEXT_STEPS.md).
6. **هل مستند؟** نعم — ADR-007 (القرار وبدائله ونتائجه)، `README.md` للعقود، `CONTAINERS.md` §5.1 (موقع الطبقة واتجاه الاعتماد)، `HANDOFF §7` (خطة المراجعات + سبعة قيود ملزمة + المؤجّلات)، `MASTER_PROGRESS` (الحالة + كيف تُثبت البوابة آلياً)، `ROADMAP` (ملاحظة الحالة)، وهذا الإدخال.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل ADR-006 (نفس القالب والحجّة)، ومقابل بنية عقود `services/geography/contracts/` وحزمة `@wasla/contracts-geography` (نفس الأسماء والنصوص التوضيحية وأسلوب حراسة الانحراف)، ومقابل نصوص المرحلة في `ROADMAP` والدليل التنفيذي (ثلاثة بوتات · أوامر · deep links · Mini App · identity bootstrap · retry/de-duplication · تجريد المُهيّئ · مُهيّئ المجموعات). يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** نعم، وهو جوهر هذه المراجعة: ADR-007. سببان يفرضانه: (أ) [ENGINEERING_DOCUMENTATION_LAW §7](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) يمنع إضافة حزم جديدة بلا مبرر موثّق، وهنا تُضاف ثلاث. (ب) القرار يُنشئ حدّاً معمارياً ملزماً لكل من يعمل بعدنا (يُمنع نداء `telegram.sendMessage()` من أي خدمة Core). ملاحظة توثيقية: قائمة الـADRs في الدليل التنفيذي «أمثلة أولية» وتذكر ترقيماً مختلفاً (ADR-008)؛ التزمنا بترقيم المستودع التسلسلي كما في المراحل السابقة.
9. **هل يكسر backward compatibility؟** لا. عقود وأنواع جديدة فقط؛ لا مستهلك قائم لطبقة القنوات (البوتات أدلة فارغة). أحداث القناة تبدأ من `v1` وأي تغيير غير متوافق لاحقاً يلزمه `v2` + ADR.
10. **هل migration؟** لا في هذه المراجعة. `schema.sql` عقد بيانات منشور لا يُطبَّق بعد؛ تنفيذ جداوله عبر Drizzle + اختبارات تكامل مُخطَّط لـMR 5، ومُعلَن صراحةً في تعليق أعلى الملف وفي ADR-007 §5.
11. **هل توجد مخاطر؟** (أ) بدء المرحلة بمُهيّئات in-memory يعني أن أي نشر قبل MR 5 يفقد منع التكرار عند إعادة التشغيل → موثّق كقيد معروف في ADR-007 (Consequences) وفي جدول المنافذ. (ب) كتابة عميل Bot API يدوياً تعني تحمّل صيانته → مقصور على نداءات قليلة داخل حزمة واحدة قابلة للاستبدال. (ج) انحراف العقود عن الكود → حُيِّد بثلاث طبقات حراسة آلية (أحداث · أخطاء · حدود OpenAPI). (د) حدّ 64 حرفاً لحمولة Deep Link قد يقيّد أفعالاً مستقبلية → أُعلن في العقد بخطأ مخصّص `CHANNEL_DEEP_LINK_TOO_LONG` وبمؤجَّل `channel_deep_link_tokens` بدلاً من تجاهله. (هـ) `packages/channel-core/` يحتوي حالياً `contracts/` فقط دون `package.json` — pnpm يتجاهله حتى MR 2، ولا يؤثر على `--frozen-lockfile`.
12. **هل security؟** نعم بالتصميم: التحقّق من `X-Telegram-Bot-Api-Secret-Token` **قبل** أي تفسير للجسم (401 `CHANNEL_UNAUTHORIZED_WEBHOOK`)، واعتبار كل حقل قادم من القناة غير موثوق ويُتحقّق داخل حدود المُهيّئ، ومنع تخزين ربط `chat_ref` ↔ `wasla_public_id` في طبقة القنوات (ملك Identity — ADR-001)، ولا FK إلى `identity_users`، ولا رموز في الكود (كلها من البيئة)، وترجمة أخطاء القناة فلا يتسرّب نصها إلى الـCore أو إلى المستخدم. لا أسرار أُضيفت في هذه المراجعة.
13. **هل performance؟** العقد يفرض استجابة `202` سريعة للـwebhook (لا معالجة ثقيلة تحجب القناة)، وفهرساً جزئياً لطابور إعادة المحاولة (`WHERE status='queued'`)، وتباطؤاً أسّياً مع jitter واحتراماً لـ`retry_after` لتجنّب عاصفة إعادة محاولة، وحدّ خمس محاولات. لا أثر تشغيلي الآن (لا كود يعمل بعد).
14. **هل monitoring؟** أحداث `channel.message.delivered` و`channel.message.failed` (بكود الخطأ وعلم `retryable`) و`channel.mini_app.launched` هي إشارات المراقبة المستقبلية لطبقة القنوات، و`/health` يُبلّغ `ok|degraded`. آلياً الآن: وظائف CI (`build-test` تُشغّل اختبارات الحراسة الـ34، و`doc-coverage` تمنع أي دفعة كود بلا توثيق).

**Related:** [MR !23](https://gitlab.com/uxxxu/wasla/-/merge_requests/23)، [ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)، [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md)، [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)، [CONTAINERS §5.1](../02-architecture/CONTAINERS.md)، [HANDOFF §7](HANDOFF_NEXT_STEPS.md)، [ROADMAP](ROADMAP.md)

---

## 2026-08-20 · Phase 02 MR 7 — بوابة خروج Phase 02 (E2E) وإغلاق المرحلة

**Task:** إثبات بوابة خروج Phase 02 باختبار E2E يُشغّل خدمتي Identity و Geography معاً كما في الإنتاج، ثم إغلاق المرحلة في وثائق التقدّم. **Status:** Completed (3 اختبارات E2E تنجح في CI ضد postgres:15) · **MR:** [!22](https://gitlab.com/uxxxu/wasla/-/merge_requests/22)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `services/geography/src/__tests__/phase02-exit-gate.e2e.test.ts` (جديد، 3 اختبارات): تطبيق مخطط identity + مخطط geography + البيانات الأولية السعودية في قاعدة اختبار واحدة، تشغيل تطبيق identity على **منفذ حقيقي** (`listen({port:0})`) وتطبيق geography عبر `app.inject` موصولاً به بمحوّل الإنتاج `HttpIdentityLookupPort`. (ب) `vitest.integration.config.ts`: `fileParallelism: false`. (ج) `package.json` للجغرافيا: `@wasla/identity-service` في `devDependencies` (+ تحديث `pnpm-lock.yaml`). (د) توثيق جديد `docs/12-testing/PHASE02_EXIT_GATE_E2E.md` + إغلاق المرحلة في `MASTER_PROGRESS.md` و`ROADMAP.md` و`HANDOFF_NEXT_STEPS.md` §6.
2. **لماذا؟** كل اختبار سابق يتحقّق من خدمة واحدة معزولة: اختبارات الوحدة بمحوّلات في الذاكرة، واختبارات التكامل (MR !19) بـPostgres حقيقي لكن مع **بديل مزيّف** لمنفذ الهوية (`identityExists → true` دائماً). أي أن جوهر البوابة — «يغيّر موقعه دون إنشاء حساب جديد» — لم يُختبَر قطعاً عبر حدود الخدمتين، ولم يُختبَر محوّل `HttpIdentityLookupPort` نفسه ضد خدمة هوية حقيقية. وقانون المراحل يمنع إغلاق مرحلة ببوابة موصوفة نصّاً فقط. لذلك تستمع الهوية على منفذ حقيقي: لو استُعمل بديل في العملية نفسها، لبقي العقد بين الخدمتين غير مُثبَت.
3. **أين؟** `services/geography/` (اختبار + إعداد vitest + package.json) + `pnpm-lock.yaml` + `docs/12-testing/` + `docs/16-progress/`. لا سطر واحد من كود الإنتاج تغيّر.
4. **كيف تم اختباره؟** الاختبار نفسه هو التحقّق: (1) «تغيير الموقع دون حساب جديد» — إنشاء المستخدم في الهوية (201) → تعيين موقع (201، `version=1`) → نطاق آخر (200، `version=2`، نفس المعرّف) → `resolve` مرة أخرى (200، `created:false`، ثبات `wasla_public_id` و`internal_uuid`) → تغيير اسم المستخدم لا يمسّ الموقع → `history` بمدخلين (`old_zone` = null ثم النطاق السابق) → `outbox` يحمل `geo.user_location.set` ثم `geo.user_location.changed` بمُعرِّف aggregate = `wasla_public_id`. (2) «Geo IDs + i18n» — ar افتراضي، `Saudi Arabia` بالإنجليزية، `مدینہ علاقہ` بالأردية، الرجوع إلى ar لحي بلا ترجمة (`حي الحرة`)، ومسار النطاق الكامل بمعرّفات UUID. (3) 404 `GEO_IDENTITY_NOT_FOUND` لهوية غير موجودة (خدمة الهوية الحقيقية أجابت 404 عبر HTTP) و404 `GEO_USER_LOCATION_NOT_FOUND` لموقع غير مسجَّل. محلياً: `typecheck` لخمس حزم ✅ و96 اختبار وحدة ✅ (الـE2E مستثنى من `pnpm -r test`)؛ لا Postgres في بيئة العمل الحالية، فتنفيذ الـE2E يتم في وظيفة `geography-db-integration` في CI.
5. **ما الخطوة التالية؟** **Phase 03 — Telegram Channel Foundation** (Exit Gate: كل Bot يفتح Mini App وAdapter قابل للاستبدال بـMock)، وتبدأ بـADR لمكدّس القناة + عقودها قبل أي كود، كما بدأت 01 و02.
6. **هل مستند؟** نعم — `docs/12-testing/PHASE02_EXIT_GATE_E2E.md` (نص البوابة، مخطط الوصل، جدول القرارات، ما يتحقّق منه، التشغيل المحلي، القيود) + هذا الإدخال + `MASTER_PROGRESS.md` (Phase 02 = Completed) + `ROADMAP.md` (ملاحظة الحالة) + `HANDOFF_NEXT_STEPS.md` §6.
7. **هل مراجَع؟** مُراجَع ذاتياً مقابل نمط بوابة Phase 01 (`services/identity/src/__tests__/exit-gate.e2e.test.ts`) ومقابل البيانات الأولية الفعلية (صُحّحت توقعات الأسماء: `مدینہ علاقہ` و`حي الحرة`، وشكل `path.*` للنطاق). يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-006 يحكم النموذج والترجمة وغياب الـFK؛ هذا إثبات تنفيذي له. لكن قرار «مخططا الخدمتين في قاعدة اختبار واحدة» موثَّق صراحةً في وثيقة الاختبار مع سببه (لا FK بين المخططين، والبوابة سلوكية لا طوبولوجية).
9. **هل يكسر backward compatibility؟** لا — إضافة اختبار وتوثيق فقط؛ لا تغيير في عقد أو كود أو مخطط.
10. **هل migration؟** لا. يُطبَّق `contracts/schema.sql` للخدمتين داخل الاختبار على قاعدة مؤقّتة تُهدم بانتهاء الوظيفة.
11. **هل توجد مخاطر؟** (أ) تسابق على الجداول: ملفّان يملكان مخطط **نفس** القاعدة → عُولج بـ`fileParallelism: false` (إلزامي لا تفضيل، وموثَّق في تعليق الإعداد). (ب) اعتماد الجغرافيا على حزمة الهوية قد يُقرأ خطأً كارتباط معماري → مقصور على `devDependencies` ومُوثَّق أن الإنتاج يبقى عبر HTTP. (ج) الاختبار يعتمد على أسماء البيانات الأولية → تغييرها يُفشله بوضوح (فشل مقصود ومفيد). (د) لا Postgres محلياً → التحقّق يعتمد على CI.
12. **هل security؟** لا أسرار ولا صلاحيات جديدة. المنفذ العشوائي محدود بـ`127.0.0.1` داخل الوظيفة، وبيانات Postgres مؤقّتة خاصة بالوظيفة.
13. **هل performance؟** الاختبار يستغرق ثوانٍ، ويضيف تشغيلاً متسلسلاً لملفَّي التكامل بدل التوازي — أثر مقبول وضروري للصحة.
14. **هل monitoring؟** إشارة CI (حالة وظيفة `geography-db-integration`) هي جرس الإنذار لأي انحدار يكسر بوابة المرحلة.

**Related:** [MR !22](https://gitlab.com/uxxxu/wasla/-/merge_requests/22)، [توثيق بوابة الخروج E2E](../12-testing/PHASE02_EXIT_GATE_E2E.md)، [تكامل قاعدة البيانات في CI](../12-testing/DB_INTEGRATION_CI.md)، [بوابة Phase 01](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [ROADMAP](ROADMAP.md)

---

## 2026-08-20 · Phase 02 MR 6 — تكامل قاعدة البيانات في CI لخدمة geography

**Task:** تشغيل اختبارات تكامل Postgres لخدمة Geography داخل GitLab CI (خدمة `postgres:15`) بعد أن كانت موجودة منذ MR !19 لكن غير مُشغَّلة آلياً. **Status:** Completed (مُتحقَّق: `POST /ci/lint` صالح بدون أخطاء أو تحذيرات، وخط أنابيب الـMR ينفّذ الوظيفة فعلياً) · **MR:** [!21](https://gitlab.com/uxxxu/wasla/-/merge_requests/21)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `.gitlab-ci.yml` — استُخرجت قاعدة مشتركة مخفية `.db-integration-base` (صورة `node:20-alpine` + corepack/pnpm 9 + قواعد التشغيل على أحداث MR وعلى `main`)، وأُعيد تعريف `db-integration` (identity) عبر `extends` دون تغيير سلوكها، وأُضيفت وظيفة جديدة `geography-db-integration` تشغّل `pnpm --filter @wasla/geography-service test:integration` مقابل خدمة `postgres:15` بقاعدة مستقلّة `wasla_geo_test`. (ب) حُذفت تعليقات قديمة صارت غير صحيحة («jobs الـ build لا تنفّذ حالياً لأن shared runners غير متاحة») لأن الـrunners مُفعّلة منذ 2026-08-20 وكل الوظائف تعمل. (ج) `docs/12-testing/DB_INTEGRATION_CI.md` (جديد) — استراتيجية طبقتي الاختبار، جدول الوظائف، التشغيل المحلي، خطوات إضافة خدمة جديدة، والحدود الحالية.
2. **لماذا؟** الاختبارات الأربعة للتكامل كُتبت في MR !19 لكنها كانت تُتخطّى في CI (`describe.skipIf(!DATABASE_URL)`) لأن الوظيفة الوحيدة القائمة تشغّل identity فقط — أي أن طبقة Postgres لـgeography لم تكن محميّة من الانحدار إلا بالتشغيل اليدوي. وبوابة خروج Phase 02 (MR 7) تحتاج أساساً موثوقاً يعمل ضد قاعدة حقيقية في كل MR. اختيار **قاعدة بيانات مستقلّة لكل خدمة** (لا توسيع وظيفة identity) يجعل الفشل مُنسَباً لخدمة واحدة، ويمنع أي تداخل جداول أو ترتيب ضمني بين الخدمتين، ويحترم ملكية كل خدمة لجداولها (ADR-006: لا FK من geography إلى identity).
3. **أين؟** `.gitlab-ci.yml` + `docs/12-testing/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** ✅ تحقّق خادمي عبر `POST /api/v4/projects/:id/ci/lint`: `valid: true`، `errors: []`، `warnings: []`، والوظائف المُحلَّلة هي repo-structure / markdown-lint / doc-coverage / build-test / db-integration / geography-db-integration. ✅ تحقّق YAML محلي (تحليل الملف وتأكيد المفاتيح). ✅ التحقّق النهائي هو خط أنابيب هذا الـMR نفسه: الوظيفتان `db-integration` و`geography-db-integration` تعملان ضد `postgres:15` (لا يمكن تشغيل Postgres في بيئة العمل المحلية الحالية، فالتحقّق الفعلي في CI هو المصدر — والاختبارات نفسها سبق أن نجحت ضد Postgres حقيقي في MR !19).
5. **ما الخطوة التالية؟** Phase 02 MR 7 — اختبار Exit Gate E2E: تطبيق مخططي identity و geography + البيانات الأولية، إنشاء مستخدم عبر Identity، تعيين موقعه ثم تغييره، والتحقّق من ثبات `wasla_public_id`/`internal_uuid` + `history` + `outbox` + الاستجابات المترجمة (ar/en/ur)، ثم إغلاق Phase 02.
6. **هل مستند؟** نعم — هذا الإدخال + `docs/12-testing/DB_INTEGRATION_CI.md` (جديد) + `MASTER_PROGRESS.md` (صف Phase 02) + `HANDOFF_NEXT_STEPS.md` §6 (MR [6] ✅ Done، MR [7] = التالي).
7. **هل مراجَع؟** مُراجعة ذاتياً مقابل الوظيفة القائمة لـidentity (تكافؤ السلوك بعد `extends`) + تحقّق خادمي من الـlint. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-005/ADR-006 يوثّقان تأجيل Testcontainers والاعتماد على خدمة postgres في CI؛ هذا تنفيذ لذلك القرار.
9. **هل يكسر backward compatibility؟** لا — لا تغيير في الكود أو العقود. `db-integration` تحفظ سلوكها بالكامل (نفس الصورة والخدمة والقاعدة والأمر)، والجديد وظيفة إضافية.
10. **هل migration؟** لا — لا تغيير في `contracts/schema.sql` أو البيانات الأولية. تغيير CI فقط. القاعدة الجديدة `wasla_geo_test` تُنشأ داخل خدمة الوظيفة وتُهدم بانتهائها.
11. **هل توجد مخاطر؟** (أ) وظيفة إضافية تعني تثبيت اعتماديات مرة أخرى وزمن خط أنابيب أطول — مقبول مقابل عزل الفشل، ويُحسَّن لاحقاً بذاكرة تخزين مؤقت لـpnpm إن لزم. (ب) `extends` يعيد هيكلة وظيفة identity الناجحة — مُخفَّف بتحقّق الـlint وبتشغيل الوظيفتين في خط أنابيب هذا الـMR قبل الدمج. (ج) لا تزال اختبارات التكامل تُتخطّى صامتة عند غياب `DATABASE_URL` محلياً — مقبول ومقصود، والمتغيّر مضبوط دائماً في CI.
12. **هل security؟** لا أسرار: بيانات اعتماد Postgres خاصة بخدمة مؤقتة داخل الوظيفة (`postgres/postgres` على شبكة الوظيفة فقط) ولا تُستخدم في أي بيئة حقيقية؛ لا متغيّرات CI محميّة أُضيفت.
13. **هل performance؟** زمن خط الأنابيب يزيد بمقدار وظيفة واحدة، وتعمل بالتوازي مع `build-test` و`db-integration` في نفس المرحلة.
14. **هل monitoring؟** لا مراقبة تشغيلية؛ إشارة CI (حالة الوظيفة) هي آلية الكشف عن انحدار طبقة Postgres لـgeography.

**Related:** [MR !21](https://gitlab.com/uxxxu/wasla/-/merge_requests/21)، [توثيق تكامل قاعدة البيانات في CI](../12-testing/DB_INTEGRATION_CI.md)، [MR !19 (طبقة Postgres)](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)، [MR !20 (طبقة HTTP)](https://gitlab.com/uxxxu/wasla/-/merge_requests/20)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)

---

## 2026-08-20 · Phase 02 MR 5 — Fastify HTTP layer + error mapping + app.inject tests (geography)

**Task:** إضافة طبقة HTTP لخدمة Geography & Localization (Fastify) تربط المسارات التسعة في العقد بحالات الاستخدام، مع تعيين أخطاء النطاق إلى استجابات تعاقدية، ومحوّل HTTP للتحقق من الهوية، واختبارات `app.inject`. **Status:** Completed (مُتحقَّق محلياً: تثبيت مُجمّد نظيف + typecheck 5 حزم + 96 اختبار وحدة منها 41 geography + تجربة تشغيل فعلية للخدمة) · **MR:** [!20](https://gitlab.com/uxxxu/wasla/-/merge_requests/20)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** `services/geography/`: (أ) `src/http/app.ts` — `createGeographyApp({deps, logger})` يبني تطبيق Fastify دون `listen` (قابل للاختبار بـ`app.inject`): `/health` + المسارات التسعة في `contracts/api.openapi.yml` (قائمة البلدان، أبناء كل مستوى، تفصيل المنطقة، GET/PUT موقع المستخدم، سجل المواقع)؛ `parseLocale` (الافتراضي `ar`، وإلا `GEO_UNSUPPORTED_LOCALE`)؛ `parseSetLocationBody` (وإلا `GEO_INVALID_REQUEST_BODY`)؛ PUT يُرجع **201** لأول تعيين و**200** للتغيير أو لإعادة التعيين المتماثلة؛ `trace_id` مأخوذ من `request.id` ويُمرّر إلى أحداث الـoutbox. (ب) `src/http/errors.ts` — `sendGeographyError` يعيّن `GeographyError` إلى `{code, message, trace_id}` + `httpStatus` من كتالوج الأخطاء، وأي خطأ غير مُصنّف إلى `GEO_INTERNAL_ERROR` (503) دون تسريب تفاصيل داخلية. (ج) `src/domain/errors.ts` — كود جديد `GEO_INVALID_REQUEST_BODY` (`validation_error`, 400) — **إضافة فقط**، لم تُغيَّر دلالة أي كود قائم. (د) `src/infrastructure/http-identity-lookup.ts` — `HttpIdentityLookupPort`: `GET {baseUrl}/identity/users/{waslaPublicId}` (200 = موجودة، 404 = غير موجودة، غير ذلك = `GEO_INTERNAL_ERROR`) مع مهلة 2000ms عبر AbortController. (هـ) `src/http/server.ts` — composition root: محوّلات Postgres إن وُجد `DATABASE_URL` وإلا in-memory، و`HttpIdentityLookupPort` إن وُجد `IDENTITY_SERVICE_URL` وإلا محوّل تطوير متسامح، و`PORT` افتراضي **8081** (Identity على 8080)، وسجلّ pino مُفعّل. (و) `package.json` — `fastify` كتبعية، `tsx` كتبعية تطوير، سكربتا `dev`/`start` (مطابقة لـIdentity). (ز) `src/index.ts` — تصدير `createGeographyApp`/`sendGeographyError`/`HttpIdentityLookupPort`. (ح) `src/__tests__/http/app.test.ts` — 16 اختبار `app.inject`. (ط) `contracts/errors.md` — توثيق الكود الجديد + حالة الحدّ الجديدة. (ي) `docs/04-api/GEOGRAPHY_HTTP.md` — توثيق طبقة HTTP الكامل.
2. **لماذا؟** النواة المجردة (MR 3) وطبقة Postgres (MR 4) لا تُعرّضان أي سطح استدعاء؛ بدون طبقة HTTP لا يمكن للبوتات/الوحدات الأخرى استعمال Geo IDs، ولا يمكن تنفيذ اختبار Exit Gate الشامل (MR 7). المكدّس مطابق لـIdentity وفق ADR-005/ADR-006 (Node 20 + Fastify + pino) لتفادي تنوّع غير مبرّر.
3. **أين؟** `services/geography/` + `docs/04-api/` + `docs/16-progress/`.
4. **كيف تم اختباره؟** ✅ تثبيت مُجمّد نظيف مطابق لـCI (`rm -rf node_modules && pnpm install --frozen-lockfile`) — تفادياً لتكرار سبب فشل CI في MR !9. ✅ `pnpm -r run typecheck` (5 حزم). ✅ `pnpm -r run test` = 96 اختباراً (geography 41 منها 16 جديدة، identity 24، contracts-identity 13، contracts-geography 15، errors 3). الاختبارات الجديدة تغطّي: الصحة؛ locale الافتراضي ar + en + ur؛ رفض locale غير مدعوم؛ اجتياز الهرم كاملاً؛ كل أكواد `*_NOT_FOUND`؛ تفصيل المنطقة؛ **201 لأول تعيين ثم 200 للتغيير** (مسار Exit Gate)؛ idempotency لنفس المنطقة؛ ترتيب السجل؛ Public ID غير صالح؛ جسم طلب غير صالح؛ منطقة مجهولة؛ هوية مجهولة؛ أنواع أحداث الـoutbox + وجود `trace_id`. ✅ تجربة تشغيل فعلية للخدمة (`PORT=8099 ... start`): `/health` → `{"status":"ok"}`؛ `/geo/countries?locale=en` → Saudi Arabia؛ `PUT /geo/users/WS-0000000009/location` → **201**؛ `history?locale=ur`. ✅ لا أسرار في الكود (كل الإعداد عبر env).
5. **ما الخطوة التالية؟** Phase 02 MR 6 — توسيع CI بوظيفة تكامل قاعدة بيانات لـgeography (خدمة `postgres:15` + `pnpm --filter @wasla/geography-service test:integration`)، ثم MR 7 — اختبار Exit Gate E2E لـPhase 02 وإغلاق المرحلة.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + `docs/04-api/GEOGRAPHY_HTTP.md` (جديد) + تحديث `MASTER_PROGRESS.md` (صف Phase 02) + `HANDOFF_NEXT_STEPS.md` §6 (MR [5] ✅ Done، MR [6] = التالي) + `contracts/errors.md`.
7. **هل مراجَع؟** مُراجعة ذاتياً مقابل العقد (`api.openapi.yml`) مسارًا بمسار ومقابل `errors.md` كودًا بكود؛ ومقابل طبقة HTTP لـIdentity (MR !13) للاتساق في الشكل. يحتاج مراجعة المالك في الـMR.
8. **هل ADR مطلوب؟** لا — ADR-006 (مكدّس + نموذج Geography) و ADR-005 (Fastify/Node 20) يغطّيان القرار؛ هذا تنفيذ ضد العقود.
9. **هل يكسر backward compatibility؟** لا — إضافة سطح HTTP جديد فقط. كتالوج الأخطاء تغيّر بالإضافة فقط (`GEO_INVALID_REQUEST_BODY`)، والأكواد القائمة ثابتة الدلالة، والأحداث بقيت v1 دون تغيير.
10. **هل migration؟** لا — لا تغيير في `contracts/schema.sql` ولا في البيانات الأولية. تغيير تشغيلي: `PORT` (افتراضي 8081) و`IDENTITY_SERVICE_URL` (اختياري) — موثّقان في `docs/04-api/GEOGRAPHY_HTTP.md`. `pnpm-lock.yaml` مُحدَّث (إلزامي لأن CI يستعمل `--frozen-lockfile`).
11. **هل توجد مخاطر؟** نعم: (أ) بدون `IDENTITY_SERVICE_URL` يعمل محوّل هوية متسامح — مقبول للتطوير فقط ويجب ضبط المتغيّر في الإنتاج (موثّق). (ب) التحقق من الجسم يدوي وليس عبر مخططات ajv المولّدة من OpenAPI — مقبول لهذا الحجم، ويُعاد النظر إذا تعدّدت الأجسام. (ج) اختبارات الـHTTP تعمل على in-memory؛ التحقق ضد Postgres حقيقي في CI يأتي في MR 6.
12. **هل security؟** لا أسرار في الكود؛ كل الإعداد عبر متغيّرات البيئة؛ الأخطاء الداخلية لا تُسرّب رسائل أو آثار مكدّس (تُختزل إلى `GEO_INTERNAL_ERROR`)؛ `wasla_public_id` يُتحقَّق نمطه قبل أي استعلام؛ لا FK ولا وصول لجداول الهوية (فقط استدعاء HTTP مقروء).
13. **هل performance؟** مهلة 2000ms على استدعاء خدمة الهوية تمنع تعليق الطلبات؛ لا استعلامات إضافية أُدخلت في هذه الطبقة (الاستعلامات كما في MR 4 مع التحميل الدفعي).
14. **هل monitoring؟** نعم — سجلّ Fastify/pino مُفعّل في التركيب النهائي (مُطفأ في الاختبارات لتقليل الضجيج)، و`trace_id` (معرّف الطلب) يظهر في كل استجابة خطأ وفي أحداث الـoutbox، مما يربط الطلب بالحدث.

**Related:** [MR !20](https://gitlab.com/uxxxu/wasla/-/merge_requests/20)، [توثيق طبقة HTTP](../04-api/GEOGRAPHY_HTTP.md)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، [عقود geography](../../services/geography/contracts/README.md)، [MR !19 (Postgres)](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)

---

## 2026-08-20 · Phase 02 MR 4 — Drizzle/Postgres persistence + Saudi seed (geography)

**Task:** تنفيذ طبقة Postgres لخدمة Geography & Localization عبر Drizzle (schema + db + repository) + بيانات أولية idempotent للمملكة العربية السعودية، مع اختبار تكامل حقيقي ضد Postgres. **Status:** Completed (مُتحقَّق محلياً: typecheck 5 حزم؛ 25 اختبار وحدة + 4 اختبارات تكامل Postgres؛ scan-secrets نظيف) · **MR:** [!19](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** `services/geography/`: (أ) `package.json` — أُضيفت `drizzle-orm`/`pg`/`drizzle-kit` كتبعيات (مثل Identity) + سكربتات `db:generate`/`db:push`/`db:studio`/`test:integration`. (ب) `drizzle.config.ts`. (ج) `src/infrastructure/drizzle/schema.ts` — 13 جدول Drizzle تطابق `contracts/schema.sql` (geo_countries/regions/cities/districts/zones + 5 جداول names + geo_user_locations + geo_user_location_history + geo_outbox) مع قيود CHECK على wasla_public_id و status. (د) `db.ts` — `createDb` (pg.Pool + drizzle)؛ Geography لا يولّد Wasla Public IDs (مرجع opaque) فلا تسلسل public-id هنا (خلافاً Identity). (هـ) `repository.ts` — `PostgresGeographyRepository` (ينفّذ كل منافذ الـports: list/find لكل مستوى + getZoneDetail مع اجتياز المسار + find/set/recordHistory/list للموقع) + `PostgresOutbox` (append/unread). الـrepository يُرجع كل كيان مع LocalizedName الكاملة (كل اللغات)؛ طبقة use-case تطبّق fallback إلى ar — فسلوك in-memory وDrizzle متطابق. (و) `contracts/seeds/saudi-arabia.sql` — INSERT ... ON CONFLICT DO NOTHING (idempotent) للبلد SA ← منطقة المدينة ← مدينة المدينة ← حيّان (الحرة/قباء) ← منطقتان (الحرة الشرقية/قباء الشمالية) + أسماء ar/en/ur؛ المعرّفات UUID ثابتة تطابق الـin-memory fixture. حيّ الحرة ومنطقة الحرة الشرقية تنقصهما ترجمات en/ur لاختبار fallback. (ز) `src/__tests__/postgres-repository.integration.test.ts` — 4 اختبارات تكامل (مُفعّلة بـDATABASE_URL عبر describe.skipIf): تحميل الـseed + التسلسل الهرمي المُترجم؛ fallback إلى ar؛ إنشاء موقع أول (version 1 + set event)؛ تغيير مع history + changed event + idempotent-same-zone no-op. (ح) `src/index.ts` — تصدير طبقة Drizzle.
2. **لماذا؟** Phase 02 Exit Gate يتطلب تغيير الموقع دون حساب جديد + i18n ضد Postgres حقيقي. طبقة Drizzle تُحيّد النواة المجردة (MR 3) عن التخزين الفعلي وفق ADR-006 (نفس المكدّس كـIdentity). الـseed السعودي idempotent يضمن إعادة التشغيل الآمن في CI والإنتاج.
3. **أين؟** `services/geography/`.
4. **كيف تم اختباره؟** ✅ typecheck -r (5 حزم). ✅ 25 اختبار وحدة (نواة، من MR 3، لم تتأثر). ✅ 4 اختبارات تكامل Postgres ضد `geo_test` (Postgres 18): seed+hierarchy مُترجم؛ fallback ar للمناطق الناقصة en/ur؛ set (version 1 + geo.user_location.set)؛ change (history مع old_zone=null للأول + old_zone للسابق + geo.user_location.changed)؛ idempotent-same-zone (لا history/event/version جديد). ✅ scan-secrets نظيف.
5. **ما الخطوة التالية؟** Phase 02 MR 5 — Fastify HTTP layer (9 مسارات) + error mapping لأكواد Geography الـ12 إلى HTTP.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث MASTER_PROGRESS + HANDOFF [4].
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار (تصحيحات: جداول names تُحمّل دفعياً لتفادي N+1؛ الـrepository يُرجع LocalizedName الكاملة والـuse-case يطبّق fallback؛ اختبار التكامل يستخدم delta للـoutbox لأن unread() يُرجع كل الأحداث غير المنشورة عبر المستخدمين).
8. **هل ADR مطلوب؟** لا — ADR-006 يغطي المكدّس ونموذج البيانات (من MR 2). هذا تنفيذ ضد العقود.
9. **هل يكسر backward compatibility؟** لا — إضافة طبقة persistence لخدمة قائمة؛ النواة المجردة (MR 3) لم تتأثر.
10. **هل migration؟** نعم — `contracts/schema.sql` هو عقد DDL (يُطبّق على قاعدة فارغة)؛ `contracts/seeds/saudi-arabia.sql` بيانات أولية. Drizzle schema (`src/infrastructure/drizzle/schema.ts`) يطابق الـDDL اليدوي (ADR-004/006: الـDDL اليدوي هو المصدر). لا توجد هجرة drizzle-kit مُولّدة في CI (db:generate محلي فقط).
11. **هل توجد مخاطر؟** نعم: (أ) الـin-memory seed (TS) و SQL seed يكرّران البيانات — يجب إبقاؤهما متزامنين (المعرّفات UUID ثابتة في كلاهما تخفف ذلك). (ب) اختبار التكامل لا يُشغّل في CI بعد (job db-integration يشغّل Identity فقط) — يُحلّ في MR 6. (ج) تريغر `updated_at` من schema.sql غير مُمثّل في Drizzle schema — يُطبّق عبر DDL عند إنشاء الجداول في الاختبار.
12. **هل security؟** لا أسرار؛ wasla_public_id مرجع opaque مع CHECK نمط؛ الاتصال بـPostgres عبر DATABASE_URL من env.
13. **هل performance؟** جداول names تُحمّل دفعياً (inArray) لتفادي N+1؛ فهارس على (entity_id, locale) و (wasla_public_id) في schema.sql.
14. **هل monitoring؟** لا في هذا الـMR؛ السجلّ المهيكلي (pino) يُضاف في طبقة Fastify (MR 5).

**Related:** [MR !19](https://gitlab.com/uxxxu/wasla/-/merge_requests/19)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [عقود geography](../../services/geography/contracts/README.md)، [النواة المجردة MR !18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18)

---

## 2026-08-20 · Phase 02 MR 3 — geography pure core (domain/ports/in-memory/use-cases/locale fallback)

**Task:** تنفيذ النواة المجردة لخدمة Geography & Localization (domain + ports + in-memory adapters + use-cases + locale fallback) وفق Contract First، دون HTTP أو Drizzle (تأتي في MR 4/5). **Status:** Completed (مُتحقَّق محلياً: typecheck 5 حزم؛ 25 اختباراً + 80 إجمالياً؛ scan-secrets نظيف) · **MR:** [!18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** `services/geography/` (`@wasla/geography-service`): package.json + tsconfig + vitest.config + vitest.integration.config. `src/domain/`: model.ts (كيانات camelCase منفصلة عن DTOs: Country/Region/City/District/Zone/LocalizedName/UserLocationAssignment/UserLocationHistoryEntry + أنواع GeoStatus/Locale/LocationSource)؛ errors.ts (GeographyError + 12 كوداً مع class→HTTP)؛ locale.ts (resolveLocalizedName مع fallback إلى ar)؛ events.ts (مصانع userLocationSet/userLocationChanged). `src/ports.ts` (Clock/IdGenerator/Outbox/IdentityLookupPort.identityExists/GareographyRepository مع find+list لكل مستوى + getZoneDetail + find/set/recordHistory للموقع). `src/infrastructure/in-memory.ts` (InMemoryGeographyRepository مزروع ببيانات Saudi الثابتة + InMemoryIdentityLookupPort + SystemClock/CryptoIdGenerator/InMemoryOutbox). `src/use-cases/`: deps.ts (UseCaseDeps)؛ mappers.ts (entity+names→DTO مع locale fallback)؛ list-hierarchy.ts (6 دوال)؛ set-user-location.ts (النواة)؛ get-user-location.ts؛ get-user-location-history.ts. `src/index.ts`. 25 اختباراً (locale 4 + hierarchy 10 + user-location 11).
2. **لماذا؟** Phase 02 Exit Gate يتطلب تغيير الموقع دون حساب جديد + i18n. النواة المجردة تبني المنطق ضد العقود/الأنواع قبل HTTP/Postgres. فصل domain عن DTOs (camelCase) يجعل النواة مستقلة عن شكل API. locale fallback في طبقة use-case (لا مخفية في repo) يضمن تطابق in-memory وDrizzle لاحقاً.
3. **أين؟** `services/geography/`.
4. **كيف تم اختباره؟** ✅ typecheck -r (5 حزم). ✅ 25 اختباراً: create (set event+201)؛ change (changed event+history+version)؛ idempotent (نفس المنطقة: لا event/history/version)؛ invalid public id (400)؛ identity not found (404)؛ zone not found (404)؛ locale fallback (en مفقود→ar)؛ parent-not-found (country/region/city/district)؛ getUserLocation not found. ✅ scan-secrets نظيف.
5. **ما الخطوة التالية؟** Phase 02 MR 4 — Drizzle/Postgres persistence + Saudi seed (contracts/seeds/saudi-arabia.sql).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث MASTER_PROGRESS + HANDOFF [3].
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار (تصحيحات: فصل domain عن DTOs، إضافة recordUserLocationHistory للـports، locale fallback في use-case لا في repo، تأكيد سلوك setUserLocation idempotent).
8. **هل ADR مطلوب؟** لا — ADR-006 يغطي المكدّس ونموذج البيانات (من MR 2). هذا تنفيذ ضد العقود.
9. **هل يكسر backward compatibility؟** لا — خدمة جديدة مستقلة، لا تمس Identity أو العقود.
10. **هل migration؟** لا — لا DB في هذا الـMR (Drizzle في MR 4).
11. **هل توجد مخاطر؟** نعم: الـin-memory seed (TS) يكرّر منطقياً SQL seed القادم في MR 4 — يجب إبقاؤهما متزامنين. التخفيف: توثيق التزامن في README.
12. **هل security؟** لا أسرار؛ wasla_public_id مرجع opaque مع CHECK نمط.
13. **هل performance؟** الـin-memory repository يستخدم Map (O(1) للبحث). بالنسبة لـPostgres (MR 4) ستُضاف فهارس.
14. **هل monitoring؟** لا في هذا الـMR؛ يُضاف في Phase 18.

**Related:** [MR !18](https://gitlab.com/uxxxu/wasla/-/merge_requests/18)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [عقود geography](../../services/geography/contracts/README.md)

---

## 2026-08-20 · Phase 02 MR 2 — عقود Geography & Localization + ADR-006

**Task:** إنشاء العقود التعاقدية لخدمة Geography & Localization وفق Contract First ([ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)) + توثيق المكدّس ونموذج البيانات في [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md). **Status:** Completed (مُتحقَّق محلياً: DDL يُطبَّق على Postgres 18؛ typecheck 4 حزم؛ 15 اختباراً + ADR) · **MR:** [!17](https://gitlab.com/uxxxu/wasla/-/merge_requests/17)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `services/geography/contracts/`: `schema.sql` (13 جدولاً: 5 هرمي geo_countries/regions/cities/districts/zones + 5 ترجمة *_names + geo_user_locations + geo_user_location_history + geo_outbox + triggers)؛ `events.json` (حدثان: `geo.user_location.set.v1`، `geo.user_location.changed.v1`)؛ `api.openapi.yml` (9 مسارات: استعلام الهرم + موقع المستخدم GET/PUT + history)؛ `errors.md` (12 كود خطأ)؛ `README.md`. (ب) `packages/contracts/geography/` (`@wasla/contracts-geography`): package.json + tsconfig + `src/api-types.ts` (مولّد من OpenAPI عبر openapi-typescript) + `src/events-types.ts` (مشتق يدوياً) + `src/index.ts` (تصدير الأنواع + primitives: `SupportedLocale`/`LOCALE_DIRECTION`/`DEFAULT_LOCALE`) + 15 اختباراً (drift guard + contract smoke). (ج) `docs/15-decisions/ADR-006-...md`.
2. **لماذا؟** Phase 02 Exit Gate يتطلب تغيير الموقع دون حساب جديد + i18n. Contract First يوجب العقود أولاً (DDL + events + OpenAPI + errors)، ثم الأنواع المُكتبة، ثم التنفيذ. ADR-006 يوثّق قرارات التغليف (مرجع opaque لـwasla_public_id، لا FK إلى identity) + الترجمة (جداول منفصلة لا JSONB) + PostGIS/Testcontainers/i18n مستقل مؤجلة.
3. **أين؟** `services/geography/contracts/`، `packages/contracts/geography/`، `docs/15-decisions/`، `docs/16-progress/`.
4. **كيف تم اختباره؟** ✅ DDL يُطبَّق على Postgres 18 (13 جدولاً + triggers). ✅ typecheck -r (4 حزم). ✅ 15 اختباراً (5 drift guard للأحداث + 10 contract smoke). ✅ openapi-typescript يولّد api-types.ts (578 سطراً). ✅ scan-secrets نظيف.
5. **ما الخطوة التالية؟** Phase 02 MR 3 — النواة المجردة (domain + ports + in-memory + use-cases + locale fallback).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + ADR-006 + تحديث MASTER_PROGRESS (Phase 02 → In Progress) + HANDOFF [2].
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار (خطة الـ7 MRs + قرارات التغليف/i18n).
8. **هل ADR مطلوب؟** نعم — [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) (هذا الـ MR نفسه).
9. **هل يكسر backward compatibility؟** لا — حزمة جديدة + عقود جديدة، لا تمس Identity.
10. **هل migration؟** نعم — `schema.sql` هو عقد DDL (يُطبّق على قاعدة فارغة). الترحيل الفعلي عبر Drizzle في MR 4.
11. **هل توجد مخاطر؟** نعم: (أ) التحقق من وجود الهوية عبر `IdentityLookupPort` (HTTP في الإنتاج) يضيف قفزة شبكية — يُخفّف بـfake في الاختبارات. (ب) تغطية Saudi الأولية محدودة (تكفي لـExit Gate) — تُوسَّع لاحقاً.
12. **هل security؟** لا أسرار؛ `wasla_public_id` مرجع opaque مع CHECK نمط — لا تسريب internals.
13. **هل performance؟** جداول الترجمة مفهرسة (PK مركّب)؛ fallback إلى ar سريع.
14. **هل monitoring؟** لا في هذا الـMR؛ يُضاف في Phase 18 (Observability).

**Related:** [MR !17](https://gitlab.com/uxxxu/wasla/-/merge_requests/17)، [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md)، [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)

---

## 2026-08-20 · Phase 02 MR 1 — مصالحة الوثائق بعد إغلاق Phase 01 (توثيقي)

**Task:** تصحيح الحالات القديمة في وثائق التقدم لتعكس الواقع بعد دمج Phase 01 (MR !11–!15) وإغلاق Phase 00/01، كي يعرف أي جهة تلي العمل الوضع الحالي بدقة. **Status:** Completed (توثيقي) · **MR:** [!16](https://gitlab.com/uxxxu/wasla/-/merge_requests/16)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** (أ) `ROADMAP.md`: ملاحظة «W0 لم يبدأ بعد» (عائق shared runners قديم) → «W0 = 2026-08-20، Phase 00/01 = Completed، Phase 02 قيد البدء». (ب) `TASK_LOG.md`: إدخالات MR !8–!15 كانت تقول «مفتوح للمراجعة/الدمج» → «مُدمج، CI أخضر»؛ وإدخال MR !8 صُحّح إلى «أُغلق/استُبدل، ADR-005 دخل عبر !10». (ج) `HANDOFF_NEXT_STEPS.md`: حالة MR !11–!15 → «مُدمج، CI أخضر»؛ ملاحظة Wasla Public ID القديمة («10 محارف كبيرة») → الواقع المنفّذ (`^WS-[0-9]{10}$` من تسلسل Postgres)؛ عنوان القسم 4 → «Checklist Phase 01 (مكتملة)»؛ أُضيف القسم 6 بخطة Phase 02 (7 MRs).
2. **لماذا؟** القاعدة الحاكمة: أي عمل يُدفع يجب توثيقه مع إبقاء خارطة الطريق واضحة لأي جهة تلي العمل — تعرف ماذا تمّ وماذا بقي. العبارات القديمة («مفتوح للمراجعة»، «W0 لم يبدأ») كانت تتناقض مع الواقع (الـMRs مدمجة، CI أخضر، Phase 00/01 مكتملة).
3. **أين؟** `docs/16-progress/{ROADMAP,TASK_LOG,HANDOFF_NEXT_STEPS}.md`.
4. **كيف تم اختباره؟** تحقّق من حالة الـMRs الفعلية على GitLab (!8=closed، !9–!15=merged). تحقق محلياً: grep للعبارات القديمة → 0 بعد التصحيح.
5. **ما الخطوة التالية؟** Phase 02 MR 2 — عقود geography (schema.sql + events + OpenAPI + errors) + ADR-006.
6. **هل مستند؟** نعم — هذا الإدخال.
7. **هل مراجَع؟** مُراجعة ذاتياً + المستشار.
8. **هل ADR مطلوب؟** لا — توثيقي فقط، لا انحراف.
9. **هل يكسر backward compatibility؟** لا.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** لا — توثيقي بحت.
12. **هل security؟** لا.
13. **هل performance؟** لا.
14. **هل monitoring؟** لا.

**Related:** [MR !16](https://gitlab.com/uxxxu/wasla/-/merge_requests/16)، [HANDOFF القسم 6](HANDOFF_NEXT_STEPS.md#6-phase-02-geography--localization---العمل-الحالي)

---

## 2026-08-20 · MR 5 — Phase 01 Exit Gate E2E + إغلاق Phase 01

**Task:** اختبار E2E رسمي للـExit Gate وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — سيناريو متكامل (إنشاء مستخدم Telegram → idempotent → تغيير Username → ثبات الهوية/Public ID) عبر كامل المكدّ (HTTP→use cases→Drizzle/Postgres) باستخدام `app.inject` ضد Postgres حقيقي، مع تأكيدات outbox/history. **Status:** Completed (مُتحقَّق محلياً + CI؛ [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15) مُدمج، CI أخضر) · **MR:** [!15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيف اختبار E2E `exit-gate.e2e.test.ts` يُشغّل كامل التدفّق عبر `createIdentityApp` + محوّلات Postgres (بدون منفذ — `app.inject`) ضد Postgres حقيقي: (1) إنشاء مستخدم من Telegram (201) والتقاط Public ID/internal_uuid؛ (2) حلّ idempotent بنفس telegram_user_id + username (200، created=false، نفس Public ID + internal_uuid)؛ (3) تغيير Username (200، نفس Public ID + internal_uuid — هوية مستقرة)؛ (4) history يُظهر usernameEntries `[v1, v2]` مع old_value؛ (5) outbox يحوي `identity.created` + `identity.link.added` + `identity.telegram_username.changed`؛ (6) رفض ربط telegram_id مملوك لمستخدم آخر (409 `IDENTITY_LINK_ALREADY_LINKED`) مع عدم إفساد هوية المالك. كذلك تحديث إعدادات vitest لتشمل نمط `*.e2e.test.ts` (مستثنى من التشغيل الافتراضي، مُشغّل في `test:integration` الذي ينفّذه job `db-integration` في CI).
2. **لماذا؟** هذا هو تحقّق الـExit Gate لـPhase 01: «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username». الاختبارات السابقة غطّت الطبقات منفصلة (وحدة، تكامل مستودع، HTTP)؛ هذا الاختبار يتحقّق من السلوك المتكامل عبر كل الطبقات في سيناريو واحد شامل.
3. **أين؟** `services/identity/src/__tests__/exit-gate.e2e.test.ts`، `services/identity/vitest.config.ts` و`vitest.integration.config.ts`، `docs/16-progress/{TASK_LOG,MASTER_PROGRESS,HANDOFF_NEXT_STEPS}.md`.
4. **كيف تم اختباره؟** محلياً: ✅ `DATABASE_URL=... pnpm test:integration` → 5 اختبارات تجتاز (2 E2E + 3 تكامل). `pnpm -r typecheck` ✅ (3 حزم)، `pnpm -r test` ✅ (24 افتراضياً، E2E مستثنى)، `scan-secrets` ✅. CI: job `db-integration` يشغّل اختبار E2E ضد خدمة postgres:15 — اجتيازه = اجتياز Exit Gate.
5. **ما الخطوة التالية؟** إغلاق Phase 01 = Completed (بعد اجتياز CI لـMR 5) ثم بدء Phase 02 (Geography & Localization).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` (Phase 01 → Completed) + `HANDOFF_NEXT_STEPS.md` (قائمة [5] + تسليم Phase 01).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف. استخدام `app.inject` (بدون منفذ) للاختبار E2E هو ممارسة قياسية في Fastify.
9. **هل يكسر backward compatibility؟** لا — إضافة اختبار + تحديث إعدادات vitest فقط.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** نعم: (أ) اختبار E2E يعتمد على job `db-integration` (postgres service) في CI — مُفعّل في MR 4. (ب) حالات حافة إضافية (مثل recovery كامل، username→null) مغطّاة جزئياً في اختبارات الطبقات الأدنى؛ يمكن تعزيزها لاحقاً.
12. **هل security؟** لا أسرار؛ قاعدة اختبار فارغة في كل تشغيل.
13. **هل performance؟** اختبار E2E سريع (<200ms)؛ يُشغّل بالتوازي مع build-test في CI.
14. **هل monitoring؟** لا؛ نتيجة job تظهر في pipeline.

**Related:** [MR !15](https://gitlab.com/uxxxu/wasla/-/merge_requests/15)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، MR 1-4 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11)→[!14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14))

---

## 2026-08-20 · MR 4 — CI DB integration (خدمة postgres في CI)

**Task:** ربط اختبارات تكامل Postgres بـCI وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — إضافة job `db-integration` بخدمة `postgres:15` (GitLab service) يُشغّل اختبارات التكامل ضد Postgres حقيقي في كل MR و على main، مع تصحيح مسار `schema.sql` في الاختبار. **Status:** Completed (مُتحقَّق محلياً ضد Postgres 18 + E2E؛ [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14) مُدمج، CI أخضر) · **MR:** [!14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيف job `db-integration` إلى `.gitlab-ci.yml` (مرحلة build، صورة `node:20-alpine`، خدمة `postgres:15` عبر alias `postgres`، متغيرات `POSTGRES_DB=wasla_test`/`POSTGRES_USER`/`POSTGRES_PASSWORD`، و `DATABASE_URL=postgres://postgres:postgres@postgres:5432/wasla_test`) ينفّذ `pnpm --filter @wasla/identity-service test:integration`. كذلك صُحّح مسار `schema.sql` في اختبار التكامل لاستخدام `process.cwd()` بدل `__dirname` (مستقل عن نظام الوحدات).
2. **لماذا؟** MR 4 في خطّة تنفيذ Phase 01 — التحقّق من الـExit Gate ضد Postgres في CI. اختبارات التكامل (MR 2) كانت مكتوبة ومُدقّقة أنواعياً لكنها معزولة عن التشغيل الافتراضي؛ الآن تُشغّل تلقائياً في CI ضد قاعدة حقيقية، فتتحقّق من سلوك Drizzle/Postgres runtime (وليس فقط typecheck).
3. **أين؟** `.gitlab-ci.yml`، `services/identity/src/__tests__/postgres-repository.integration.test.ts`، `docs/16-progress/`.
4. **كيف تم اختباره؟** محلياً: شغّلتُ postgres 18، وأنشأتُ قاعدة `wasla_test`، ونفّذتُ `DATABASE_URL=... pnpm test:integration` → ✅ 3 اختبارات تجتاز (إنشاء/idempotent، استقرار الهوية عبر تغيير Username، رفض التعارض). E2E: أقلعتُ الخادم بـ`DATABASE_URL` → ✅ تدفّق HTTP→Postgres كامل (resolve 201→200 idempotent→200 username-change بنفس Public ID/internal_uuid، history يُظهر sami_v1→sami_v2). CI: التحقّق عبر pipeline الـMR.
5. **ما الخطوة التالية؟** MR 5 — Exit Gate E2E رسمي (سيناريو كامل: مستخدم Telegram يُنشأ، يتغيّر Username، تبقى الهوية/Public ID مستقرة) كاختبار E2E مُفصل + توثيق اجتياز Exit Gate.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` + `HANDOFF_NEXT_STEPS.md` (قائمة [4]).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف. استخدام خدمة postgres في CI هو النمط القياسي لـGitLab.
9. **هل يكسر backward compatibility؟** لا — إضافة job CI جديد؛ الـ build-test الافتراضي دون تغيير (لا يحتاج DB).
10. **هل migration؟** لا — الاختبار يُطبّق schema.sql (الـDDL التعاقدي) على قاعدة فارغة في كل تشغيل.
11. **هل توجد مخاطر؟** نعم: (أ) اعتماد job على خدمة postgres في CI (يتطلب runner يدعم services) — shared runners توفّرها. (ب) التحقّق التكاملي عبر HTTP مؤجّل كاختبار E2E رسمي إلى MR 5 (لكن E2E محلي اجتاز). (ج) Testcontainers مؤجّل تماماً (لا حاجة — خدمة postgres كافية وأبسط).
12. **هل security؟** لا أسرار؛ بيانات اعتماد postgres في CI مؤقتة (job-scoped، قاعدة اختبار فارغة)؛ لا بيانات إنتاج.
13. **هل performance؟** job منفصل يُشغّل بالتوازي مع build-test؛ pnpm install مكرّر (مقبول لآن CI يُخزّن cache مستقبلاً).
14. **هل monitoring؟** لا في هذا الـMR؛ نتيجة job تظهر في GitLab pipeline.

**Related:** [MR !14](https://gitlab.com/uxxxu/wasla/-/merge_requests/14)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، MR 2 ([!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12))، MR 3 ([!13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13))

---

## 2026-08-20 · MR 3 — Fastify HTTP layer (طبقة HTTP)

**Task:** إضافة طبقة HTTP لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — مصنع تطبيق Fastify (`createIdentityApp`) يربط مسارات العقد الخمسة (resolve/getUser/addLink/recovery/history) بحالات الاستخدام، تعيين الأخطاء إلى رموز HTTP وأجسام الأخطاء التعاقدية، نقطة إقلاع (composition root)، واختبارات عبر `app.inject`. **Status:** Completed (مُتحقَّق محلياً + smoke test ناجح؛ [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13) مُدمج، CI أخضر) · **MR:** [!13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيفت طبقة HTTP لحزمة `@wasla/identity-service`: `src/http/app.ts` (مصنع `createIdentityApp(deps)` يعرّف المسارات الخمسة + `/health` + `setErrorHandler`)، `src/http/errors.ts` (`sendIdentityError` يرمي إلى جسم الخطأ التعاقدي `{code, message, trace_id}` مع الحالة الصحيحة)، `src/http/server.ts` (نقطة الإقلاع: تكوّن المحوّلات — Postgres إن وُجد `DATABASE_URL` وإلا في الذاكرة — + الاستماع على `PORT`). أُضيف تصدير `StartRecoveryRequest` من contracts (النوع موجود في OpenAPI لكن لم يُصدّر). اعتماديات: fastify، tsx (dev).
2. **لماذا؟** MR 3 في خطّة تنفيذ Phase 01 — طبقة HTTP. النواة المجردة (MR 1) وطبقة Postgres (MR 2) لا تُستهلك عبر HTTP بعد؛ هذه الطبقة تُعرّض العقد (5 مسارات) للعملاء وتحوّل أخطاء النطاق إلى استجابات HTTP متوافقة مع `errors.md`.
3. **أين؟** `services/identity/src/http/{app,errors,server}.ts`، `services/identity/src/__tests__/http/app.test.ts`، `services/identity/src/index.ts` (تصدير HTTP)، `services/identity/package.json` (dev/start scripts)، `packages/contracts/identity/src/index.ts` (`StartRecoveryRequest`)، `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `pnpm -r typecheck` ✅ (3 حزم)، `pnpm -r test` ✅ (24 اختباراً: 15 نواة + 9 HTTP)، `scan-secrets` ✅ نظيف، **smoke test** ✅ (إقلاع الخادم في وضع الذاكرة: `/health`→200، `POST /identity/resolve`→201 بجسم مطابق، `GET` لمستخدم غير موجود→404 `{code, message, trace_id}`).
5. **ما الخطوة التالية؟** MR 4 — خدمة postgres في CI + تشغيل اختبارات التكامل، ثم MR 5 (Exit Gate E2E).
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` + `HANDOFF_NEXT_STEPS.md` (قائمة [3]).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف. استخدام Fastify موثّق في ADR-005. مسار `/health` ليس جزءاً من سطح عقد API المُصدَر (probe تشغيلي فقط) — موثّق في الكود.
9. **هل يكسر backward compatibility؟** لا — إضافة طبقة جديدة فقط؛ حالات الاستخدام والمنافذ دون تغيير.
10. **هل migration؟** لا.
11. **هل توجد مخاطر؟** نعم: (أ) التحقق من صيغة المدخلات مُفوّض إلى حالات الاستخدام (ترمي الأكواد المستقرة) بدل schema validation في Fastify — مقصود للحفاظ على أكواد الأخطاء المستقرة. (ب) JSON مشوّه / أخطاء غير مُصنّفة تُرجَع 503 `IDENTITY_INTERNAL_ERROR` (catch-all التعاقدي). (ج) التحقق التكاملي الكامل ضد Postgres عبر HTTP مؤجّل إلى MR 4.
12. **هل security؟** لا أسرار؛ `DATABASE_URL` عبر البيئة فقط؛ `trace_id` = معرّف طلب Fastify (لا بيانات حساسة).
13. **هل performance؟** مصنع تطبيق واحد لكل عملية؛ تجمّع اتصالات pg في طبقة Postgres (MR 2)؛ سجلّ pino مهيكلي (يُفعّل عند الإقلاع الفعلي).
14. **هل monitoring؟** سجلّ pino المهيكلي فعّال عند الإقلاع (`logger:true`)؛ `/health` كـliveness probe؛ metrics/tracing مؤجّلة.

**Related:** [MR !13](https://gitlab.com/uxxxu/wasla/-/merge_requests/13)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، MR 1 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11))، MR 2 ([!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12))

---

## 2026-08-20 · MR 2 — Drizzle/Postgres persistence layer (محوّلات Postgres)

**Task:** إضافة طبقة استمرارية Postgres لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — Drizzle schema مطابق للـDDL التعاقدي (schema.sql)، مستودع Postgres، تسلسل Public ID، إعداد اتصال، واختبارات تكامل منفصلة. **Status:** Completed (مُتحقَّق محلياً؛ [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12) مُدمج، CI أخضر) · **MR:** [!12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12)

### الأسئلة الـ14 (Documentation Law)

1. **ماذا تغيّر؟** أُضيفت محوّلات Postgres لحزمة `@wasla/identity-service`: Drizzle schema (`schema.ts`) مطابق لـ`schema.sql` (5 جداول: identity_users/links/history/recovery_requests/outbox مع CHECK وUNIQUE وFK ON DELETE RESTRICT والفهارس)، مستودع `PostgresIdentityRepository`، `PostgresOutbox`، `PostgresPublicIdSequence` (يسلسل `wasla_public_id_seq`)، إعداد اتصال `createDb` + `ensurePublicIdSequence`، إعداد `drizzle.config.ts`، إعدادات vitest (افتراضي يستثني `*.integration.test.ts`؛ `vitest.integration.config.ts` للاختبارات التكاملية)، واختبار تكامل `postgres-repository.integration.test.ts` (مُسيّج عبر `DATABASE_URL`، يُطبّق schema.sql + التسلسل). أُضيفت اعتماديات: drizzle-orm، pg، drizzle-kit، @types/pg.
2. **لماذا؟** MR 2 في خطّة تنفيذ Phase 01 — طبقة الاستمرارية. النواة المجردة (MR 1) تعمل على الذاكرة؛ هذه الطبقة تربطها بـPostgres الحقيقي. اختيار Drizzle (بدل Prisma) موثّق في [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md): ترابط أنواع TS مع النموذج، SQL صريح، أداء عالٍ، ودعم صريح لـJSONB (حمولات الأحداث).
3. **أين؟** `services/identity/src/infrastructure/drizzle/{schema,db,repository,public-id-sequence}.ts`، `services/identity/{drizzle.config,vitest.config,vitest.integration.config}.ts`، `services/identity/src/__tests__/postgres-repository.integration.test.ts`، `services/identity/package.json` (deps + scripts)، `services/identity/src/index.ts` (تصدير المحوّلات)، `.gitignore` (تجاهل نتاج drizzle-kit)، `pnpm-lock.yaml`.
4. **كيف تم اختباره؟** `pnpm -r typecheck` ✅ (3 حزم)، `pnpm -r test` ✅ (31 اختباراً: 13+3+15؛ التكامل مستثنى من التشغيل الافتراضي)، `drizzle-kit generate` ✅ (ولّد هجرة صالحة لـ5 جداول مطابقة لـschema.sql)، `scan-secrets` ✅ نظيف. اختبار التكامل مكتوب ومُدقّق أنواعياً لكن لا يُشغّل دون Postgres (مؤجّل إلى MR 4 مع خدمة postgres في CI).
5. **ما الخطوة التالية؟** MR 3 — طبقة Fastify HTTP (مسارات resolve/getUser/addLink/recovery/history) مع تحويل الأخطاء إلى رموز HTTP وفق `errors.md`.
6. **هل مستند؟** نعم — هذا الإدخال (14 سؤالاً) + تحديث `MASTER_PROGRESS.md` (Phase 01 blockers/evidence) + تحديث `HANDOFF_NEXT_STEPS.md` (قائمة [2]).
7. **هل مراجَع؟** مُراجعة ذاتياً + [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12) مفتوح للمراجعة.
8. **هل ADR مطلوب؟** لا — لا انحراف عن القرارات القائمة. اختيار Drizzle موثّق مسبقاً في ADR-005. schema.sql يبقى مصدر DDL الحقيقي (ADR-004)؛ Drizzle schema طبقة استعلام آمنة أنواعياً مطابقة له.
9. **هل يكسر backward compatibility؟** لا — إضافة طبقة جديدة فقط؛ المنافذ (ports) والنواة المجردة وحالات الاستخدام دون تغيير. المحوّلات الجديدة تُختار عند تكوين الجذر (composition root).
10. **هل migration؟** لا migration ملتزم. DDL التعاقدي = `schema.sql` (يُطبّق مباشرة، يشمل تريغر `updated_at`). هجر drizzle-kit نتاج عند الطلب (`db:generate`)؛ تُتجاهل في git لأنها تختلف عن schema.sql في تريغر `updated_at` (المستودع يضبط `updatedAt` صراحةً في `updateUserStatus`).
11. **هل توجد مخاطر؟** نعم: (أ) اختبار التكامل لا يُشغّل في CI بعد (لا Postgres في node:20-alpine) — يُحلّ في MR 4 عبر خدمة postgres. (ب) تريغر `updated_at` من schema.sql غير مُمثّل في Drizzle schema — معالج بضبط `updatedAt` صراحةً في المستودع (defense-in-depth). (ج) `onConflictDoNothing` يعتمد على قيد UNIQUE على (provider, external_id) — موجود في schema.sql.
12. **هل security؟** لا أسرار؛ DATABASE_URL يُحقن عبر البيئة فقط؛ لا embedding لـTelegram IDs في Public ID (ADR-001).
13. **هل performance؟** تجمع اتصالات pg (افتراضي 10)؛ فهارس على (user_internal_uuid, provider) و(user_internal_uuid, field) وoccurred_at للـoutbox.
14. **هل monitoring؟** لا في هذا الـMR؛ السجلّ المهيكلي (pino) يُضاف في طبقة Fastify (MR 3).

**Related:** [MR !12](https://gitlab.com/uxxxu/wasla/-/merge_requests/12)، [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)، [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)، MR 1 ([!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11))

---

## 2026-08-20 · MR 1 — Identity scaffold + pure core (النطاق والمنافذ وحالات الاستخدام)

**Task:** تنفيذ النواة المجردة لخدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) — نماذج النطاق، المنافذ (ports)، محوّلات في الذاكرة، حالات الاستخدام، والاختبارات. **Status:** Completed (مُتحقَّق محلياً؛ [MR !11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11) مُدمج، CI أخضر) · **MR:** [!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11)

**ماذا تم إنجازه (1):** إنشاء حزمة `@wasla/identity-service` (services/identity) بنماذج النطاق (User/IdentityLink/HistoryEntry/RecoveryRequest مطابقة لـschema.sql)، أخطاء ثابتة (errors.ts مطابق لكتالوج errors.md)، مولّد/متحقّق Wasla Public ID (`WS-[0-9]{10}`)، مصانع أحداث المجال (identity.created / link.added / telegram_username.changed / recovery.started) وفق events.json، المنافذ (Clock/IdGenerator/PublicIdSequence/IdentityRepository/Outbox)، محوّلات في الذاكرة للاختبارات، وحالات الاستخدام: `resolveTelegramIdentity` (idempotent حسب telegram_user_id + تسجيل تغيير Username في History دون إنشاء مستخدم جديد) و`getUser` و`addIdentityLink` و`startRecovery` و`getIdentityHistory`. 15 اختباراً تجتاز.

**لماذا تم اختياره (2):** وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) وخطّة المستشار (MR 1 = scaffold + pure core). البدء بالنواة المجردة (hexagonal) قبل HTTP/Postgres يسمح باختبار سلوكيات الـExit Gate (استقرار الهوية عبر تغيير Username) دون اعتماد على Docker/Postgres (Testcontainers مؤجّل — لا Docker في بيئة CI الحالية node:20-alpine). Contract-First: أنواع API/الأحداث مستوردة من `@wasla/contracts-identity`.

**أين تم التغيير (3):** `services/identity/` (package.json، tsconfig.json، src/domain/{model,errors,public-id,events}.ts، src/ports.ts، src/infrastructure/in-memory.ts، src/use-cases/*.ts، src/index.ts، src/__tests__/*.test.ts)، `packages/contracts/identity/src/index.ts` (إضافة تصديرات `RecoveryStarted`/`IdentityHistoryEntry`/`AddIdentityLinkRequest`)، `packages/contracts/identity/package.json` (exports → src/index.ts للاستهلاك دون build)، `pnpm-lock.yaml`، `docs/16-progress/{TASK_LOG,MASTER_PROGRESS,HANDOFF_NEXT_STEPS}.md`.

**الملفات/الخدمات المتأثرة (4):** حزمة جديدة `@wasla/identity-service` (النواة المجردة)؛ حزمة `@wasla/contracts-identity` (تصديرات أنواع إضافية + exports source).

**ما الـAPI/Event/Schema الذي تغير (5):** لا تغيير في العقود (OpenAPI/events.json/schema.sql/errors.md). أُضيفت تصديرات أنواع من العقد الموجودة فقط (RecoveryStarted، IdentityHistoryEntry) — لا تغيير دلالي.

**كيف تم الاختبار (6):** `pnpm -r typecheck` ✅ (3 حزم: contracts/identity، errors، services/identity)، `pnpm -r test` ✅ (31 اختباراً: 13 + 3 + 15)، `bash scripts/checks/scan-secrets.sh` ✅ نظيف. اختبارات الـExit Gate: إنشاء مستخدم من Telegram (created:true، WS-XXX صالح، حدثان identity.created + link.added)؛ idempotent (نفس telegram_user_id → created:false، لا أحداث جديدة)؛ استقرار الهوية عبر تغيير Username (نفس public_id/internal_uuid، تسجيل history بقيم old/new، حدث telegram_username.changed)؛ استقرار عبر تغييرات متعددة (سجل كامل u1→u2→u3→u4)؛ رفض resolve بلا telegram_user_id (IDENTITY_MISSING_TELEGRAM_ID)؛ تعارض رابط (IDENTITY_LINK_ALREADY_LINKED)؛ مزوّد غير صالح (IDENTITY_LINK_INVALID_PROVIDER)؛ recovery (recovery.started)؛ history مُرشّح بحقل.

**ما المشاكل التي ظهرت (7):** (1) مسارات استيراد نسبية خاطئة في حالات الاستخدام (`../../domain/` بدل `../domain/`) — صُلحت. (2) حزمة contracts كانت تُصدِّر `dist/` غير المبنيّ → tsc لا يجد الأنواع؛ صُلح بجعل exports تشير إلى `src/index.ts` (استهلاك دون build). (3) نوع `IdentityHistoryEntry.field` في OpenAPI يقيّد على telegram_username/phone/link (بدون status) بينما DDL يشمل status؛ عُولج بترشيح إدخالات status من استجابة history endpoint. (4) `res.links` اختياري في نوع العقد؛ عُولج في الاختبار.

**ما الذي لم يكتمل (8):** طبقة HTTP (Fastify) — MR 3. طبقة Postgres/Drizzle — MR 2. اختبارات تكامل مع Postgres حقيقي — MR 4. هذه النواة تستعمل in-memory repository فقط (كافٍ لمنطق الـExit Gate).

**الخطوة التالية (9):** دمج MR !11 → اجتياز CI → MR 2 (Drizzle/Postgres persistence) ثم MR 3 (Fastify HTTP) ثم MR 4 (CI DB integration) ثم MR 5 (Exit Gate E2E).

**ما الذي يعتمد عليه العمل التالي (10):** اجتياز CI على MR !11 (shared runners مُفعّلة). لا يعتمد على Docker (النواة مجردة).

**Migration/Deployment/Config (11):** لا — نواة مجردة بلا runtime/DB. لا deployment.

**مخاطر/قرارات تحتاج مراجعة (12):** (1) جعل contracts exports تشير إلى src/index.ts بدل dist — قرار تطويري (استهلاك دون build في monorepo خاص)؛ يُراجع عند الحاجة لتغليف/dist منشور. (2) استراتيجية Wasla Public ID موثّقة في public-id.ts (WS- + 10 أرقام صفرية من سلسلة تسلسلية) — مطابقة لـschema.sql (Postgres sequence)؛ التوليد الفعلي بالـsequence في MR 2. (3) Testcontainers مؤجّل (لا Docker في CI) — مُوثّق في ADR-005. (4) لا embedding لـTelegram IDs في Public ID (ADR-001).

**الروابط (13):** MR [!11](https://gitlab.com/uxxxu/wasla/-/merge_requests/11) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · العقود `services/identity/contracts/` · حزمة `@wasla/contracts-identity` · [MASTER_PROGRESS](MASTER_PROGRESS.md) Phase 01

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (دمج MR !11 + مراجعة CODEOWNERS) · Team 01 — Identity & Auth (متابعة التنفيذ MR 2/3/4/5)

---

## 2026-08-20 · إصلاح فشل job `build-test` في CI: إضافة @types/node لعقد Identity

**Task:** إصلاح فشل job `build-test` (typecheck) على GitLab CI بعد تفعيل shared runners — أخطاء `Cannot find module 'node:fs'` / `node:path` / `Cannot find name '__dirname'` في `packages/contracts/identity/src/__tests__/events.test.ts`. **Status:** Completed (الإصلاح مُتحقَّق محلياً بتثبيت مُجمّد نظيف مُطابق لـCI؛ [MR !9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) مُدمج، CI أخضر) · **MR:** [!9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9)

**ماذا تم إنجازه (1):** إضافة `@types/node@^20.0.0` كاعتماد تطوير صريح في `packages/contracts/identity/package.json`، وإعادة توليد `pnpm-lock.yaml`. هذا يجعل `node:fs` / `node:path` / `__dirname` (المستعملة في اختبار حماية انحراف الأحداث `events.test.ts`) قابلة للتحليل بواسطة `tsc` دون الاعتماد على `@types/node` عام خارج المستودع.

**لماذا تم اختياره (2):** السبب الجذري: `events.test.ts` يستعمل واجهات Node.js (`node:fs`/`node:path`/`__dirname`) لكن `@types/node` لم يكن مُعلَناً في أي `package.json`. كان `@types/node` مُشاراً إليه في الـlockfile كـpeer dependency اختياري فقط (غير مُثبّت فعلياً). محلياً كان typecheck يجتاز صدفةً بسبب وجود `@types/node` عام في `/home/user/node_modules/@types/node` (خارج المستودع) يحلّه `tsc` عبر تسلّق الأدلة — لكن CI (`node:20-alpine` نظيف) لا يملكه، ففشل. الإصلاح الصحيح: جعل `@types/node` اعتماداً صريحاً للحزمة التي تستعمله، وفق مبدأ «لا اعتماد غير مُعلَن».

**أين تم التغيير (3):** `packages/contracts/identity/package.json` (إضافة `@types/node` إلى devDependencies)، `pnpm-lock.yaml` (إعادة توليد)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)، `docs/16-progress/MASTER_PROGRESS.md` (تحديث Open Blockers لـ Phase 00).

**الملفات/الخدمات المتأثرة (4):** حزمة `@wasla/contracts-identity` (devDependency + lockfile)؛ job `build-test` في CI (Phase 00).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — لم تُغيَّر العقود. تغيير اعتماديات تطوير فقط.

**كيف تم الاختبار (6):** إعادة إنتاج بيئة CI بدقّة: `rm -rf node_modules packages/*/node_modules` → `pnpm install --frozen-lockfile` (مُطابق لأمر CI تماماً) → `pnpm -r typecheck` ✅ (حزمتان)، `pnpm -r test` ✅ (16 اختباراً: 3 + 13)، `bash scripts/checks/scan-secrets.sh` ✅ نظيف. تأكد أن `@types/node` أصبح في نطاق الحزمة: `packages/contracts/identity/node_modules/@types/node` موجود. قبل الإصلاح، التثبيت المُجمّد النظيف كان يُنتج نفس الفشل (لا `@types/node` في نطاق الحزمة).

**ما المشاكل التي ظهرت (7):** (1) التضليل الأولي: typecheck كان يجتاز محلياً رغم أن `@types/node` غير مُعلَن — بسبب `@types/node` عام خارج المستودع. كُشف عبر `tsc --traceResolution` الذي أظهر أن `node:fs` يُحلّ من `/home/user/node_modules/@types/node/fs.d.ts` (خارج المستودع). (2) إعادة إنتاج الفشل محلياً تطلّب مسح `node_modules` والتثبيت المُجمّد النظيف (مُطابق CI) — قبل ذلك بدا أن كل شيء سليم.

**ما الذي لم يكتمل (8):** اجتياز pipeline فعلياً على GitLab لـ MR !9 (بعد دمجه) — يتطلب تشغيل shared runners (الآن مُفعّلة بعد تحقق المالك من namespace). عند اجتيازه: Phase 00 = Completed (W0).

**الخطوة التالية (9):** دمج MR !9 → اجتياز pipeline على `main` (job `build-test`) → اعتماد Phase 00 = Completed (W0) → بدء تنفيذ خدمة Identity وفق [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) (إضافة الاعتماديات عبر MR مستقل + تنفيذ ضد العقود/الأنواع + Contract tests).

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على اجتياز CI على MR !9 (shared runners الآن مُفعّلة). لا يعتمد على شيء آخر — الإصلاح مكتمل ومُتحقَّق محلياً.

**Migration/Deployment/Config (11):** لا — تغيير اعتماديات تطوير فقط (devDependency + lockfile). لا migration ولا deployment.

**مخاطر/قرارات تحتاج مراجعة (12):** إضافة `@types/node` كاعتماد تطوير — مبرّر ومُوثّق (الاختبار يستعمل واجهات Node.js). لا مخاطر أمنية. راجع [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) — هذا التغيير يمسّ `packages/` لذا رافقه تحديث `docs/` (هذا الإدخال).

**الروابط (13):** MR [!9](https://gitlab.com/uxxxu/wasla/-/merge_requests/9) · job `build-test` في `.gitlab-ci.yml` · حزمة `@wasla/contracts-identity` · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) (أساس البناء) · [MASTER_PROGRESS](MASTER_PROGRESS.md) Phase 00

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (دمج MR !9 + التحقق من اجتياز CI) · Team 10 — DevOps (مراقبة job build-test) · Team 01 — Identity (التنفيذ بعد W0 وفق ADR-005)

---

## 2026-08-20 · اختيار مكدّس تنفيذ خدمة Identity (ADR-005)

**Task:** توثيق قرار اختيار المكدّس التقني لتنفيذ خدمة Identity — الخطوة الموثّقة التالية نحو Phase 01 Exit Gate. **Status:** Completed (قرار توثيقي مكتوب ومُدمج؛ [MR !8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) أُغلق/استُبدل، ودخل ADR-005 إلى main عبر [MR !10](https://gitlab.com/uxxxu/wasla/-/merge_requests/10) المُدمج، CI أخضر) · **MR:** [!8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) (مُغلق) → [!10](https://gitlab.com/uxxxu/wasla/-/merge_requests/10) (مُدمج) · **ADR:** [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md)

**ماذا تم إنجازه (1):** إنشاء [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) الذي يُحدّد مكدّس تنفيذ خدمة Identity: Node.js 20 (LTS) + TypeScript 5 (strict) + Fastify (HTTP runtime + ajv للتحقق من مخططات OpenAPI) + PostgreSQL 15+ (وفق عقد البيانات) + Drizzle ORM (schema-first، ترحيلات عكوسة) + Drizzle Kit + Vitest + Testcontainers + pino. لا يُضيف اعتماديات أو كوداً تنفيذياً في هذا الـ MR — قرار توثيقي فقط.

**لماذا تم اختياره (2):** الخطوة الموثّقة التالية في [MASTER_PROGRESS](MASTER_PROGRESS.md) و[HANDOFF_NEXT_STEPS](HANDOFF_NEXT_STEPS.md) صراحةً هي «اختيار المكدّ التقني (ADR منفصل)» قبل التنفيذ. تسجيل الاختيار مسبقاً يزيل القرار المعلّق (Open Blocker 1 لـ Phase 01) ويجعل التنفيذ جاهزاً للبدء فور رفع عائق CI. المكدّس متوافق مع أساس البناء المعتمد في [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) (Node 20 + TS + Vitest)، ويحترم مبدأ «مصدر الحقيقة الواحد» في [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) (العقود كمصدر، الأنواع المُولّدة كجسر). يتوافق مع نهج MRs السابقة (التحقق محلياً دون shared runners).

**أين تم التغيير (3):** `docs/15-decisions/ADR-005-identity-service-implementation-stack.md` (جديد)، `docs/16-progress/MASTER_PROGRESS.md` (Phase 01: Open Blocker 1 → محلول عبر ADR-005؛ Next Step محدّث)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)، `docs/16-progress/HANDOFF_NEXT_STEPS.md` (ملاحظة اختيار المكدّ + بقاء التنفيذ معلّقاً).

**الملفات/الخدمات المتأثرة (4):** خدمة Identity (Phase 01) — قرار معماري يمسّ اختيار مكدّها التنفيذي. لا تغيير برمجي (لا packages/ ولا services/ ولا apps/).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — لم تُغيَّر العقود (OpenAPI / JSON Schema / DDL / errors.md). هذا قرار اختيار مكدّ تنفيذ فقط.

**كيف تم الاختبار (6):** (أ) التحقق من سلسلة البناء محلياً لإثبات أن المكدّس الحالي يعمل: `pnpm install` ✅، `pnpm -r typecheck` ✅ (حزمتان)، `pnpm -r test` ✅ (16 اختباراً: 3 في @wasla/errors + 13 في @wasla/contracts-identity)، `bash scripts/checks/scan-secrets.sh` ✅ نظيف. (ب) التحقق من اتساق ADR-005 مع ADR-001..004 (مراجع متبادلة صحيحة). (ج) التحقق من أن MR وثائق فقط → يجتاز قاعدة `doc-coverage` (التغييرات كلها في `docs/` وهي معفاة).

**ما المشاكل التي ظهرت (7):** لا مشاكل. قرار توثيقي بحت.

**ما الذي لم يكتمل (8):** تنفيذ خدمة Identity الفعلي (resolve/getUser/addLink/recovery/history + outbox + توليد Wasla Public ID + سجل تغيير Username) — **معلّق على اجتياز Phase 00 Exit Gate (CI passes)**، وهو محجوب خارجياً بـ shared runners. اختيار المكدّ هنا لا يُجتاز Exit Gate ولا يبدأ التنفيذ.

**الخطوة التالية (9):** (خارجي — إجراء مالك الحساب) حلّ عائق CI (verify namespace أو runner خاص دائم) وفق [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md) → اجتياز CI على `main` → اعتماد Phase 00 = Completed (W0) → بدء تنفيذ خدمة Identity وفق ADR-005 (إضافة الاعتماديات عبر MR مستقل + تنفيذ ضد العقود/الأنواع + Contract tests). بديل: إن رغب المالك بالبدء قبل رفع عائق CI، يتطلب ذلك تفويضاً صريحاً بتنفيذ قبل البوابة عبر ADR منفصل (على غرار نمط ADR-002/004).

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد التنفيذ على اجتياز Phase 00 Exit Gate (CI passes) — أو على تفويض صريح بتنفيذ قبل البوابة. يعتمد كذلك على العقود المُنتَجة ([MR !2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2)) والأنواع المُولّدة ([MR !6](https://gitlab.com/uxxxu/wasla/-/merge_requests/6)/[!7](https://gitlab.com/uxxxu/wasla/-/merge_requests/7)) واختيار المكدّ (هذا ADR-005).

**Migration/Deployment/Config (11):** لا — قرار توثيقي فقط. عند بدء التنفيذ لاحقاً: إعداد Testcontainers/Postgres محلي + `corepack enable` (مُوثّق في CONTRIBUTING) + ترحيل DDL عبر Drizzle Kit.

**مخاطر/قرارات تحتاج مراجعة (12):** اختيار مكدّ قد يتغيّر لاحقاً — مُخفّف بالاتساق مع ADR-003 وأي تبديل موثّق بـ ADR. خطر الانحراف بين Drizzle schema وعقد DDL — مُدار عبر اشتقاق schema من العقد + اختبار حماية انحراف. كل اعتمادية تُضاف لاحقاً عبر MR مستقل مع تبرير مرجعي لهذا الـ ADR. راجع [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md).

**الروابط (13):** MR [!8](https://gitlab.com/uxxxu/wasla/-/merge_requests/8) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) · [MASTER_PROGRESS](MASTER_PROGRESS.md) · [HANDOFF_NEXT_STEPS](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI / أو تفويض تنفيذ قبل البوابة) · Team 01 — Identity & Auth (التنفيذ بعد W0 وفق ADR-005) · Team 10 — DevOps (إعداد Testcontainers/Postgres عند بدء التنفيذ)

---

### [2026-08-20] إنشاء وثيقة تسليم (Handoff) واضحة للجهة التالية
- **Files:** `docs/16-progress/HANDOFF_NEXT_STEPS.md` (جديد)، `docs/16-progress/MASTER_PROGRESS.md` (إشارة)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)
- **Services:** — (وثائق فقط)
- **Why:** القاعدة الحاكمة تُلزم بإبقاء خارطة الطريق واضحة لكل من سيعمل في المستودع بعد هذه الجلسة: ماذا تمّ، ماذا بقي، والخطوات الدقيقة. كانت هذه المعلومة موزّعة بين MASTER_PROGRESS/TASK_LOG/ROADMAP، فجُمعت في وثيقة تسليم واحدة قابلة للتنفيذ.
- **Decision:** إنشاء `HANDOFF_NEXT_STEPS.md` يلخّص: (1) Snapshot للحالة الحالية وPhase 00 = Exit Gate Pending، (2) العائق الوحيد المتبقي (shared runners — إجراء خارجي من مالك الحساب) مع حلّين دقيقين، (3) المسار الكامل Phase 00→24 حتى 100%، (4) Checklist فوري لمن يأتي بعدي، (5) ملاحظات أمنية (تدوير الرمز، تشديد حماية main).
- **Tests:** التحقق من صحة الروابط النسبية داخل الوثيقة، واتساق الحالة مع MASTER_PROGRESS (Phase 00 = Exit Gate Pending).
- **Next:** بعد تفعيل shared runners من مالك الحساب واجتياز pipeline على MR !1 ودمجه، يُحدّث Phase 00 → Completed ويُبدأ Phase 01.
- **Related:** [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) · [HANDOFF](HANDOFF_NEXT_STEPS.md)

### [2026-08-20] إصلاح فحص الأسرار في CI وإكمال متطلبات Phase 00 Exit Gate
- **Files:** `scripts/checks/scan-secrets.sh` (جديد)، `scripts/hooks/pre-push` (تعديل — ربط فحص الأسرار بالـ hook)، `.gitlab-ci.yml` (تعديل job `repo-structure`)، `docs/16-progress/MASTER_PROGRESS.md` (تحديث حالة Phase 00)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)
- **Services:** — (بنية المستودع و CI فقط)
- **Why:** فحص الأسرار القديم في `.gitlab-ci.yml` كان يستعمل `grep -rE '...' .` فيطابق ملف `.gitlab-ci.yml` نفسه (يحتوي على أنماط الكشف كنص حرفي مثل `glpat-` و`ghp_`) فيفشل job الـ `repo-structure` دائماً. هذا يكسر شرط «CI passes» في Phase 00 Exit Gate.
- **Decision:** استبدال الفحص المضمّن بـسكربت منفصل `scripts/checks/scan-secrets.sh` يستعمل `git grep` (يتجاهل `.git` تلقائياً ويفحص الملفات المتتبعة فقط)، مع استثناء ملفات «الكاشف» نفسها (`.gitlab-ci.yml` و`scan-secrets.sh`) لأنها تحتوي على توقيعات الكشف لا أسراراً.
- **Tests:** (1) المستودع النظيف يمر (exit 0). (2) ملف متتبع يحوي `AKIA...`/`glpat-...`/`ghp_...` يُرفض (exit 1) ويلتقط الثلاثة. (3) بعد الحذف يمر مجدداً. (4) `bash -n` للسكربتات الثلاثة + صحة YAML للـ `.gitlab-ci.yml`. (5) doc-coverage E2E: تغيير كود فقط → FAIL، تغيير كود+توثيق → PASS. (6) فحص بنية المستودع كاملة نجحت محلياً. (7) التحقق من حماية فرع main عبر GitLab API (محمي، Maintainers فقط، لا force push). (8) محاكاة pre-push hook: ملف يحوي سر → exit 1 (يُحجب)، نظيف → exit 0.
- **Next:** دفع هذا الإصلاح عبر MR (لا دفع مباشر إلى main)، اجتياز pipeline فعلياً على GitLab، ثم اعتماد Phase 00 = Completed وبدء Phase 01 (Identity Foundation). كما يجب تفعيل `core.hooksPath scripts/hooks` على نسخ المطورين (`git config core.hooksPath scripts/hooks`).
- **Related:** جزء من Phase 00 Exit Gate؛ راجع [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md) و[MASTER_PROGRESS](MASTER_PROGRESS.md) صف Phase 00.

### [2026-08-19] إضافة خارطة الطريق وقاعدة التوثيق مع الدفع
- **Files:** `docs/16-progress/ROADMAP.md`، `docs/16-progress/TASK_LOG.md`، `docs/00-rules/PUSH_DOCUMENTATION_RULE.md`، `scripts/checks/require-doc-update.sh`، `scripts/hooks/pre-push`، `.gitlab/merge_request_templates/Default.md`، `.gitlab-ci.yml` (تعديل)، `docs/16-progress/MASTER_PROGRESS.md` (تعديل)، `CONTRIBUTING.md` (تعديل)، `README.md` (تعديل)
- **Services:** — (بنية المستودع والوثائق فقط)
- **Why:** المشروع يحتاج ترتيباً زمنياً ملزماً للمراحل (لم يكن موجوداً)، وقاعدة ميكانيكية تُلزم كل دفع بأن يرافقه توثيق يدخل شجرة المستودع. الترتيب سابقاً كان قائماً على Exit Gates فقط دون تخطيط زمني واضح.
- **Decision:** اعتماد أسابيع نسبية (W0 = اجتياز Phase 00 Exit Gate) لمنع تقادم الوثيقة. الانتقال الفعلي يتم بالـ Exit Gate لا بالوقت. الإلزام خادمياً عبر CI job `doc-coverage` (الفشل يمنع الدمج) + hook محلي كتنبيه مبكر.
- **Tests:** فحص bash syntax للسكربتات (`bash -n`)، فحص صحة YAML للـ `.gitlab-ci.yml`، التحقق من روابط الوثائق النسبية.
- **Next:** تفعيل `core.hooksPath` على نسخ المطورين، وإثبات أن job الـ `doc-coverage` يعمل عند أول MR (جزء من Phase 00 Exit Gate).
- **Related:** ADR-001 (Identity) — لا تعارض؛ الخارطة تضع 01 ضمن W1–W3.

---

## 2026-08-20 · Phase 01 — Identity Foundation: عقود Contract First (الخطوة الأولى)

**Task:** إنتاج عقود خدمة Identity بمنهجية Contract First (مستقلة عن المكدّ التقني) كأول خطوة نحو Phase 01 Exit Gate. **Status:** Completed (Contract First stage) · **MR:** [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2)

**ماذا تم إنجازه (1):** إنتاج أربعة عقود لخدمة Identity — API Contract (OpenAPI 3.0.3)، Event Contract (JSON Schema 2020-12)، Data Contract (PostgreSQL DDL)، Error Contract (كتالوج أخطاء) — بالإضافة إلى فهرس المستهلك في `packages/contracts/identity/`.

**لماذا تم اختياره (2):** منهجية Contract First الموثّقة في README §7 تسمح بالإنتاج المتوازي للعقود قبل التنفيذ؛ العقود مستقلة عن المكدّ التقني فلا تتطلب اختيار TS/Go الآن؛ العمل لا يعتمد على تشغيل CI (متجاوزةً عائق shared runners المؤقت).

**أين تم التغيير (3):** `services/identity/contracts/` (جديد: api.openapi.yml, events.json, schema.sql, errors.md, README.md)، `packages/contracts/identity/README.md` (جديد)، `docs/15-decisions/ADR-002-*.md` (جديد)، `docs/16-progress/MASTER_PROGRESS.md` (Phase 01 → In Progress)، `docs/16-progress/TASK_LOG.md` (هذا الإدخال).

**الملفات/الخدمات المتأثرة (4):** خدمة Identity (Phase 01)؛ الحزم المستهلكة: packages/contracts, packages/events (مرجعية فقط).

**ما الـAPI/Event/Schema الذي تغير (5):** جديد بالكامل (لا تنفيذ سابق). API: resolve/getUser/addLink/recovery/history. Events v1: identity.created / link.added / telegram_username.changed / recovery.started. Schema: identity_users, identity_links, identity_history, identity_recovery_requests, identity_outbox.

**كيف تم الاختبار (6):** `yaml.safe_load` + `openapi-spec-validator` → OpenAPI 3.0.3 صالح؛ `Draft202012Validator.check_schema` → JSON Schema صحيح؛ فحص عبارات DDL؛ مراجعة يدوية لاتساق العقود مع ADR-001.

**ما المشاكل التي ظهرت (7):** خطأ صياغة YAML (علامة `: ` داخل قيمة description) — صُلح بالتضمين بعلامات اقتباس. تكرار أعمدة عند تعديل سطر Phase 01 — صُلح.

**ما الذي لم يكتمل (8):** تنفيذ فعلي للعقود (يتطلب اختيار المكدّ بـADR منفصل)؛ اختبارات Contract (consumer/provider)؛ اجتياز Phase 01 Exit Gate فعلياً.

**الخطوة التالية (9):** اختيار المكدّ التقني لخدمة Identity (ADR مستقبلي) → تنفيذ ضد العقود → كتابة Contract tests → اجتياز Exit Gate «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username». لكن قبل ذلك: تفعيل shared runners ودمج MR !1 لاعتماد Phase 00 = Completed.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على العقود المُنتَجة هنا؛ ويعتمد على حلّ عائق shared runners (إجراء مالك الحساب) لاجتياز Phase 00 Exit Gate والانتقال الكامل لتنفيذ Phase 01.

**Migration/Deployment/Config (11):** لا — العقود تعريفات فقط، لا migration ولا deployment.

**مخاطر/قرارات تحتاج مراجعة (12):** انحراف عن تسلسل Exit Gates موثّق في [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) — يجب مراجعته وقبوله. اختيار المكدّ التقني معلّق.

**الروابط (13):** MR [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) · [ADR-001](../15-decisions/ADR-001-identity-decoupled-from-telegram.md) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md) · [HANDOFF_NEXT_STEPS.md](HANDOFF_NEXT_STEPS.md)

**الشخص/الفريق الذي يتابع (14):** Team 01 — Identity & Auth (التنفيذ بعد اختيار المكدّ) · Team 12 — Integration (الاستهلاك عبر العقود).

---

## 2026-08-20 · تحديث خارطة الطريق بعد دمج MR !1 وMR !2

**Task:** تحديث وثائق التقدم والخارطة لتعكس دمج MR !1 (Phase 00 CI fix) وMR !2 (Phase 01 Identity contracts) إلى main. **Status:** Completed · **MR:** [!3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3)

**ماذا تم إنجازه (1):** تأكد من دمج MR !1 (commit `cba9a75`) وMR !2 (commit `a15985d`) إلى `main`. حدّثت MASTER_PROGRESS (Phase 00 → Merged to main / Exit Gate Pending للتحقق من CI؛ Phase 01 → عقود مدمجة إلى main، In Progress) وROADMAP (آخر تحديث + ملاحظة حالة: W0 لم يبدأ بعد) وHANDOFF.

**لماذا تم اختياره (2):** يجب أن تعكس وثائق التقدم الحالة الفعلية للمستودع بعد الدمج — كي يعرف من يأتي بعدي أن الكود على main، وأن العائق الوحيد المتبقي للـ Exit Gate هو التحقق من CI (shared runners).

**أين تم التغيير (3):** `docs/16-progress/MASTER_PROGRESS.md`، `docs/16-progress/ROADMAP.md`، `docs/16-progress/TASK_LOG.md` (هذا الإدخال)، `docs/16-progress/HANDOFF_NEXT_STEPS.md`.

**الملفات/الخدمات المتأثرة (4):** وثائق التقدم فقط (لا تغيير برمجي).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — فقط توثيق حالة الدمج.

**كيف تم الاختبار (6):** `git fetch` + `git pull` للتأكد من تطابق main المحلي مع البعيد؛ التحقق من حالة الدمج عبر GitLab API (state: merged لـ !1 و!2)؛ فحص أن العقود والسكربت موجودة على main (`git ls-files`).

**ما المشاكل التي ظهرت (7):** لا مشاكل. كلا الـ MR دُمجا دون تعارضات.

**ما الذي لم يكتمل (8):** **التحقق الفعلي من اجتياز CI على main** — لم يحدث بعد لأن shared runners غير متاحة. Phase 00 Exit Gate لا يُعتبر مجتازاً بمجرد الدمج.

**الخطوة التالية (9):** (أ) تفعيل shared runners (إجراء مالك الحساب) ثم تشغيل pipeline على main للتحقق من اجتياز CI → اعتماد Phase 00 = Completed = بداية W0. (ب) اختيار المكدّ التقني لـ Identity (ADR) → تنفيذ ضد العقود → Contract tests → اجتياز Phase 01 Exit Gate.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على حلّ عائق shared runners (إجراء خارجي) لاجتياز Phase 00 Exit Gate وبدء W0.

**Migration/Deployment/Config (11):** لا.

**مخاطر/قرارات تحتاج مراجعة (12):** الدمج تم دون اجتياز CI فعلي (بسبب shared runners) — مخالفة محتملة لقاعدة «CI passes» في Exit Gate. يُخفّف: الكود تم التحقق منه محلياً (scan-secrets + doc-coverage + OpenAPI/JSON Schema validation) قبل الدمج، والعائق بيئي وليس خطأ كود. **يُنصح بشدّ حماية main لمنع الدفع/الدمج دون CI ناجح مستقبلاً.**

**الروابط (13):** MR [!1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) · MR [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) · MR [!3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3) · [ADR-002](../15-decisions/ADR-002-begin-phase01-contracts-despite-shared-runners-blocker.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (تفعيل shared runners) · Team 01 — Identity & Auth (تنفيذ بعد اختيار المكدّ).

---

## 2026-08-20 · Phase 00 — أساس بناء المستودع (Monorepo Tooling Foundation)

**Task:** إعداد أساس بناء Monorepo (pnpm + TypeScript + Vitest) لخدمة معيار Exit Gate «جميع الفرق clone/build/test». **Status:** Completed · **MR:** [!4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4)

**ماذا تم إنجازه (1):** إعداد أساس بناء كامل: `package.json` جذري + `pnpm-workspace.yaml` + `tsconfig.json` (strict) + حزمة `@wasla/errors` فعليّة (وحدة + اختبار دخان بـ3 اختبارات) + job `build-test` في `.gitlab-ci.yml` + `pnpm-lock.yaml` مُلتزم. توثيق الاختيار في [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md).

**لماذا تم اختياره (2):** معيار Exit Gate «clone/build/test» غير مُلبّى بدون إعداد بناء؛ البنية و`.gitignore` توحيان بـNode/TS؛ العمل محلي ولا يحتاج shared runners؛ لا يتجاوز Phase 01 (أساس بناء، ليس تنفيذ Identity).

**أين تم التغيير (3):** الجذر (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `pnpm-lock.yaml`, `.gitlab-ci.yml`)، `packages/errors/` (`package.json`, `tsconfig.json`, `src/index.ts`, `src/__tests__/errors.test.ts`)، `docs/15-decisions/ADR-003-*.md`، `docs/16-progress/{MASTER_PROGRESS,TASK_LOG,HANDOFF}.md`، `CONTRIBUTING.md`.

**الملفات/الخدمات المتأثرة (4):** البنية التحتية للمستودع (Phase 00)؛ حزمة `@wasla/errors` (مشتركة).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — أساس بناء فقط. حزمة `@wasla/errors` تقدّم صنف `WaslaError` يتوافق مع عقد الأخطاء (code ثابت + traceId).

**كيف تم الاختبار (6):** `pnpm --filter @wasla/errors typecheck` → نجح؛ `pnpm --filter @wasla/errors test` → 3 اختبارات اجتازت؛ `scan-secrets.sh` → نظيف؛ CI lint خادمي → صالح (True، بلا أخطاء/تحذيرات)؛ code paths مصحوبة بـdocs/ (اجتاز قاعدة doc-coverage).

**ما المشاكل التي ظهرت (7):** مسار استيراد خاطئ في الاختبار (`../src/index.js` بدل `../index`) — صُلح. pnpm latest يتطلب Node 22+ — صُلح باعتماد pnpm 9 (متوافق Node 20).

**ما الذي لم يكتمل (8):** job `build-test` في CI لا تنفّذ فعلياً (shared runners غير متاحة) — جاهزة للعمل عند تفعيلها. ESLint/Next.js/Turbo مؤجلة (ADR منفصل عند الحاجة).

**الخطوة التالية (9):** تفعيل shared runners → تشغيل pipeline على `main` (job `build-test`) للتحقق من اجتياز CI → اعتماد Phase 00 = Completed (W0). ثم اختيار مكدّ تنفيذ Identity (ADR) → تنفيذ ضد العقود → Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد على حلّ عائق shared runners لاجتياز Phase 00 Exit Gate وبدء W0.

**Migration/Deployment/Config (11):** إعداد بيئة: `corepack enable` + `corepack prepare pnpm@9 --activate` مطلوب على بيئات المطورين (مُوثّق في CONTRIBUTING).

**مخاطر/قرارات تحتاج مراجعة (12):** اعتماد pnpm 9 مع Node 20 — يحتاج ترقية pnpm لاحقاً عند الانتقال إلى Node 22+. تأجيل ESLint/Next/Turbo مقصود (تضخّم نطاق مبكّر). راجع [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md).

**الروابط (13):** MR [!4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · MR [!1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) · MR [!2](https://gitlab.com/uxxxu/wasla/-/merge_requests/2) · MR [!3](https://gitlab.com/uxxxu/wasla/-/merge_requests/3)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (تفعيل shared runners) · Team 10 — DevOps (إعداد بيئات المطورين) · Team 01 — Identity & Auth (التنفيذ بعد اختيار المكدّ).

---

## 2026-08-20 · التوفيق بعد دمج MR !4 + محاولة فكّ عائق CI

**Task:** توفيق وثائق التقدم بعد دمج MR !4 (أساس البناء)، وتوثيق محاولة فكّ عائق CI عبر runner خاص. **Status:** Completed · **MR:** [!5](https://gitlab.com/uxxxu/wasla/-/merge_requests/5)

**ماذا تم إنجازه (1):** تأكد من دمج MR !4 (commit `052d3ff`) إلى main. حدّثت MASTER_PROGRESS (Phase 00 → «Engineering work complete — Exit Gate Pending للتحقق من CI فقط») وROADMAP وHANDOFF. أنشأت [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md) بمساري الحلّ الدائمين.

**لماذا تم اختياره (2):** يجب أن تعكس الوثائق أن جميع المعايير الهندسية لـ Phase 00 مكتملة، وأن العائق الوحيد المتبقّي خارجي (CI). توثيق محاولة runner يمنع تكرارها عبثاً.

**أين تم التغيير (3):** `docs/16-progress/{MASTER_PROGRESS,ROADMAP,HANDOFF_NEXT_STEPS,TASK_LOG}.md`، `docs/14-runbooks/CI_RUNNER_UNBLOCK.md` (جديد).

**الملفات/الخدمات المتأثرة (4):** وثائق فقط.

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء.

**كيف تم الاختبار (6):** التحقق من دمج MR !4 عبر GitLab API (state: merged). محاولة تجريبية لتثبيت Docker وتشغيل الـ daemon (نجح البدء بـ`--bridge=none` لكن الـ daemon لا يستمر بين الأوامر وbridge/iptables غير مدعوم).

**ما المشاكل التي ظهرت (7):** استضافة runner خاص من بيئة التنفيذ **غير مجدية**: (1) العمليات الخلفية تُنهى بين الأوامر، (2) bridge networking/iptables غير مدعوم. مؤكد أن الحلّ يتطلب جهازاً مستمراً.

**ما الذي لم يكتمل (8):** اجتياز CI فعلياً على GitLab — لا يزال معلّقاً على إجراء مالك الحساب (verify namespace أو runner دائم على جهاز مستمر).

**الخطوة التالية (9):** إجراء مالك الحساب: حلّ عائق CI وفق [Runbook](../14-runbooks/CI_RUNNER_UNBLOCK.md) → تشغيل pipeline على `main` → اعتماد Phase 00 = Completed (W0) → اختيار مكدّ تنفيذ Identity (ADR) → تنفيذ ضد العقود → Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد كلياً على حلّ عائق shared runners الخارجي.

**Migration/Deployment/Config (11):** لا.

**مخاطر/قرارات تحتاج مراجعة (12):** لا مخاطر هندسية متبقّية. العائق خارجي بحت. يُنصح بشدّ حماية main لمنع الدمج دون CI ناجح مستقبلاً.

**الروابط (13):** MR [!5](https://gitlab.com/uxxxu/wasla/-/merge_requests/5) · [Runbook فكّ عائق CI](../14-runbooks/CI_RUNNER_UNBLOCK.md) · MR [!4](https://gitlab.com/uxxxu/wasla/-/merge_requests/4) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI) · Team 10 — DevOps (إعداد runner دائم إن اختير المسار 2) · Team 01 — Identity (التنفيذ بعد W0).

---

## 2026-08-20 · توليد أنواع TypeScript من عقود Identity (ADR-004)

**Task:** توليد أنواع TypeScript من عقد OpenAPI لخدمة Identity في حزمة `@wasla/contracts-identity`. **Status:** Completed · **MR:** [!6](https://gitlab.com/uxxxu/wasla/-/merge_requests/6) · **ADR:** [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

**ماذا تم إنجازه (1):** أنشأت حزمة `packages/contracts/identity` كهيكل pnpm workspace، ثبّتت `openapi-typescript@7.13.0`، ولدّت `src/api-types.ts` من `services/identity/contracts/api.openapi.yml`. أضفت `src/index.ts` (إعادة تصدير الأنواع الرئيسية: ResolveIdentityRequest/Response, IdentityUser, IdentityLink, paths, components) + 6 اختبارات دخان (typecheck + runtime).

**لماذا تم اختياره (2):** توجيه مالك المشروع المتكرر بمتابعة العمل؛ العمل غير محجوب بـ shared runners (توليد محلي). توسيع نطاق العمل المسموح قبل البوابة موثّق في ADR-004 (يشترط المستشار: «بعد CI ناجح أو بعد ADR جديد يوسّع العمل المسموح قبل البوابة»). ليست تنفيذاً للخدمة (أداة Contract First فقط).

**أين تم التغيير (3):** `packages/contracts/identity/` (package.json, tsconfig.json, src/index.ts, src/api-types.ts [مولّد], src/__tests__/contracts.test.ts)؛ `packages/contracts/identity/README.md`؛ `pnpm-workspace.yaml` (إضافة `packages/contracts/*`)؛ `package.json` (root، openapi-typescript devDep)؛ `pnpm-lock.yaml`؛ `docs/15-decisions/ADR-004-*.md`؛ `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`.

**الملفات/الخدمات المتأثرة (4):** حزمة @wasla/contracts-identity فقط (نوع + اختبار، لا منطق تشغيلي).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — العقد (OpenAPI) لم يُغيَّر؛ الأنواع مولّدة منه فقط.

**كيف تم الاختبار (6):** typecheck (2 حزم) ✅ + test (9 اختبارات: 6+3) ✅ + scan-secrets ✅ + CI lint صالح (server-side) ✅.

**ما المشاكل التي ظهرت (7):** (1) مسار tsconfig خاطئ (2 مستويات بدل 3) → صُحّح إلى `../../../tsconfig.json`. (2) اختبار @ts-expect-error كان حسّاساً لموضع التوجيه → استُبدل باختبار enum إيجابي. (3) حزمة متداخلة لم تطابق glob `packages/*` → أضيف `packages/contracts/*` لـ pnpm-workspace.

**ما الذي لم يكتمل (8):** أنواع أحداث events.json (JSON Schema → TS) — مؤجلة كعمل لاحق عند الحاجة (موثّقة كـ future في ADR-004). تنفيذ خدمة Identity — يتطلب اجتياز Phase 00 Exit Gate أولاً.

**الخطوة التالية (9):** (خارجي) حلّ عائق CI (verify namespace) → اجتياز CI على main → Phase 00 = Completed (W0) → اختيار مكدّ تنفيذ Identity (ADR منفصل) → تنفيذ ضد العقود/الأنواع المولّدة + Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد كلياً على حلّ عائق shared runners الخارجي.

**Migration/Deployment/Config (11):** أضيف `packages/contracts/*` إلى pnpm-workspace.yaml (تهيئة monorepo).

**مخاطر/قرارات تحتاج مراجعة (12):** إضافة `openapi-typescript` كاعتماد تطوير — مبرّر وموثّق في ADR-004. الأنواع مولّدة من عقد قد يتغير (العقد مقبول عبر ADR-001/002)؛ أي تغيير مستقبلي يتطلب إعادة التوليد + تحديث docs/.

**الروابط (13):** MR [!6](https://gitlab.com/uxxxu/wasla/-/merge_requests/6) · [ADR-004](../15-decisions/ADR-004-typed-contracts-from-openapi.md) · حزمة `@wasla/contracts-identity`

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI) · Team 01 — Identity (التنفيذ بعد W0) · المستهلكون (استخدام الأنواع المولّدة).

---

## 2026-08-20 · أنواع أحداث Identity مشتقّة من events.json (ADR-004 Addendum)

**Task:** إضافة أنواع TypeScript لأحداث Identity مشتقّة من عقد `events.json` (JSON Schema) إلى حزمة `@wasla/contracts-identity`. **Status:** Completed · **MR:** [!7](https://gitlab.com/uxxxu/wasla/-/merge_requests/7) · **ADR:** [ADR-004 Addendum](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

**ماذا تم إنجازه (1):** أنشأت `src/events-types.ts` (EventEnvelope + 4 أحداث v1: IdentityCreated/LinkAdded/TelegramUsernameChanged/RecoveryStarted + union IdentityEvent + IdentityEventByType map) مشتقّة يدوياً من `events.json`. أضفت `src/__tests__/events.test.ts` (7 اختبارات) منها **اختبار حماية انحراف** يقرأ `events.json` ويتحقق أن أنواع `event_type` الحرفية + بنى الـ payload متوافقة مع الأنواع اليدوية.

**لماذا تم اختياره (2):** إكمال قصة العقود المُكتبة (API + أحداث) — آخر جزء Contract First متبقٍ غير محجوب. توجيه مالك المشروع بمتابعة العمل.

**أين تم التغيير (3):** `packages/contracts/identity/src/{events-types.ts, __tests__/events.test.ts}`؛ `src/index.ts` (إعادة تصدير أنواع الأحداث)؛ `package.json` (root، json-schema-to-typescript devDep للتحقيق)؛ `pnpm-lock.yaml`؛ `docs/15-decisions/ADR-004-*.md` (ملحق توسيع النطاق للأحداث)؛ `docs/16-progress/{MASTER_PROGRESS,HANDOFF_NEXT_STEPS,TASK_LOG}.md`؛ `packages/contracts/identity/README.md`.

**الملفات/الخدمات المتأثرة (4):** حزمة @wasla/contracts-identity فقط (أنواع + اختبارات، لا منطق تشغيلي).

**ما الـAPI/Event/Schema الذي تغير (5):** لا شيء — عقود events.json/OpenAPI لم تُغيَّر؛ الأنواع مشتقّة منها فقط.

**كيف تم الاختبار (6):** typecheck (2 حزم) ✅ + test (16 اختبار: 13+3) ✅ + scan-secrets ✅. اختبار حماية الانحراف يقرأ events.json فعلياً ويتحقق التوافق.

**ما المشاكل التي ظهرت (7):** (1) `json-schema-to-typescript` أنتج نوعاً عاماً غير صالح (جذر `$defs` فقط) → استُبدل بالاشتقاق اليدوي مع اختبار حماية انحراف. (2) مسار قراءة events.json في الاختبار كان خاطئاً (4 مستويات بدل 5) → صُحّح. (3) تأكيد `in` على كائن فارغ كان منطقاً خاطئاً → استُبدل بفحص نوعي.

**ما الذي لم يكتمل (8):** تنفيذ خدمة Identity — يتطلب اجتياز Phase 00 Exit Gate أولاً.

**الخطوة التالية (9):** (خارجي) حلّ عائق CI (verify namespace) → اجتياز CI على main → Phase 00 = Completed (W0) → اختيار مكدّ تنفيذ Identity (ADR منفصل) → تنفيذ ضد العقود/الأنواع + Contract tests.

**ما الذي يعتمد عليه العمل التالي (10):** يعتمد كلياً على حلّ عائق shared runners الخارجي.

**Migration/Deployment/Config (11):** لا تغيير (json-schema-to-typescript للتحقيق فقط).

**مخاطر/قرارات تحتاج مراجعة (12):** أنواع الأحداث مشتقّة يدوياً (ليست مولّدة آلياً) — مخاطرة الانحراف مُدارة باختبار حماية يقرأ المصدر الكنسي. العقد مُصدّر v1 (أي تغيير غير متوافق يتطلب v2 + ADR).

**الروابط (13):** MR [!7](https://gitlab.com/uxxxu/wasla/-/merge_requests/7) · [ADR-004 Addendum](../15-decisions/ADR-004-typed-contracts-from-openapi.md)

**الشخص/الفريق الذي يتابع (14):** مالك المشروع (حلّ عائق CI) · Team 01 — Identity (التنفيذ بعد W0).
