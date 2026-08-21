# اختبارات تكامل قاعدة البيانات في CI

> **Scope:** كيف تُشغَّل اختبارات التكامل ضد Postgres حقيقي في GitLab CI، ولماذا هي منفصلة عن `pnpm -r test`، وكيف تُضاف خدمة جديدة.
>
> **Last Updated:** 2026-08-21 · **Status:** Active · **Related:** [.gitlab-ci.yml](../../.gitlab-ci.yml) · [ADR-005](../15-decisions/ADR-005-identity-service-implementation-stack.md) · [ADR-006](../15-decisions/ADR-006-geography-localization-stack-and-model.md) · [DEFINITION_OF_DONE](../00-rules/DEFINITION_OF_DONE.md)

---

## 1. طبقتا الاختبار

| الطبقة | الأمر | تحتاج قاعدة بيانات؟ | تعمل في |
|---|---|---|---|
| وحدة/عقد (نواة مجردة، in-memory، `app.inject`) | `pnpm -r run test` | لا | وظيفة `build-test` |
| تكامل (محوّلات Postgres ضد قاعدة حقيقية) | `pnpm --filter <pkg> test:integration` | نعم (`DATABASE_URL`) | وظائف `*-db-integration` |

الفصل مقصود: `vitest.config.ts` لكل خدمة يستثني `*.{integration,e2e}.test.ts`، و`vitest.integration.config.ts` يشملها فقط. وكل ملف تكامل مُلفَّف بـ`describe.skipIf(!DATABASE_URL)` — فالمساهم بلا قاعدة بيانات محلية يبقى الاختبار الافتراضي أخضر لديه، ولا يمرّ كسر صامت في CI لأن المتغيّر مضبوط هناك دائماً.

**حالة واحدة خارجة عن هذا الفصل بقصد:** حزمة بوابة الخروج `@wasla/channel-e2e` تملك إعداداً واحداً **يشمل** ملف الـE2E ولا سكربت `test:integration` لها، لأن الملف يعمل بمخازن الذاكرة بلا قاعدة بيانات، ووجود `DATABASE_URL` يرفعه إلى Postgres بلا تغيير في الملف. المبرّر في [PHASE03_EXIT_GATE_E2E.md](PHASE03_EXIT_GATE_E2E.md): بوابة يمكن تخطيّها ليست بوابة.

---

## 2. شكل الوظائف

قاعدة مشتركة `.db-integration-base` (وظيفة مخفية) تحمل الصورة `node:20-alpine` وتهيئة pnpm 9 عبر corepack وقواعد التشغيل (على أحداث MR وعلى `main`). ثم لكل خدمة وظيفة تُوسّعها بـ`extends`:

| الوظيفة | الخدمة | قاعدة البيانات | ما تتحقّق منه |
|---|---|---|---|
| `db-integration` | `@wasla/identity-service` | `wasla_test` | بوابة خروج Phase 01: إنشاء مستخدم Telegram، ثبات الهوية/Public ID عبر تغيير Username، التاريخ، الـoutbox |
| `geography-db-integration` | `@wasla/geography-service` | `wasla_geo_test` | Phase 02: تحميل بيانات السعودية الأولية، التسلسل الهرمي المُترجم، fallback إلى `ar`، تعيين/تغيير الموقع + `history` + `outbox` + idempotency |
| `channel-exit-gate-e2e` | `@wasla/channel-e2e` | `wasla_channel_e2e` | Phase 03 · MR 7 (**بوابة خروج المرحلة**): البوتات الثلاثة معاً أمام خدمة هوية واحدة تستمع فعلياً على HTTP ومخازن مشتركة — كل بوت يفتح Mini App الخاصة به، هوية واحدة لشخص واحد عبر البوتات الثلاثة، منع التكرار مقيَّد بالبوت، واستبدال `TelegramChannelAdapter` بـ`MockChannelAdapter` تجاوزاً لمقبس واحد ([تفصيل](PHASE03_EXIT_GATE_E2E.md)) |
| `channel-db-integration` | `@wasla/channel-postgres` | `wasla_channel_test` | Phase 03 · MR 5: مُهيّئات Postgres للمنافذ الثلاثة — منع التكرار الذرّي وبقاؤه بعد إعادة الإقلاع، idempotency التسليم وتقدّم المحاولات وترتيب طابور الاستحقاق (أولوية ثم زمن)، إلحاق صندوق الصادر مرّة واحدة، و**مطابقة المنافذ**: حالات استخدام النواة نفسها تُشاهَد متطابقة على مُهيّئات الذاكرة وعلى Postgres |
| `customer-db-integration` | `@wasla/customers-service` | `wasla_customer_test` | Phase 04 · MR 3/6: مستودع العملاء وصندوق صادره أمام قاعدة حقيقية — `NUMERIC` أرقاماً، الحقل الغائب يبقى غائباً (فبصمة idempotency لا تتغيّر بمصدر القراءة)، ترتيب الأماكن، التقييد بالمالك، معاملة واحدة للطلب ونقاطه وتراجعها، رسائل التكرار نفسها التي يرفعها مُهيّئ الذاكرة، قيود CHECK؛ و**مطابقة المنافذ**: 16 سيناريو تُكتَب مرّة وتُنفَّذ مرّتين (ذاكرة/Postgres) عبر حالات الاستخدام نفسها ([تفصيل](../02-architecture/CUSTOMER_PERSISTENCE.md)) |

**استثناء مقصود في `channel-exit-gate-e2e`:** هو الوظيفة الوحيدة التي تُشغّل ملفاً **يعمل أيضاً** داخل `build-test`. السبب: بوابة يمكن تخطيّها ليست بوابة، فمجموعة `@wasla/channel-e2e` غير ملفّفة بـ`describe.skipIf` وتعمل بمخازن الذاكرة على كل MR دون قاعدة بيانات؛ ووجود `DATABASE_URL` يُبدّل المخازن إلى Postgres ويُفعّل **اختبار الصفوف** وحده (`it.skipIf`). ولا تحتاج الوظيفة مخطّط `identity_*` لأن خدمة الهوية تعمل داخل الاختبار بمحوّلات in-memory — محلّ الفحص العقد بين الطبقتين، واستمرارية الهوية مغطّاة في `db-integration`.

**ملاحظة:** الوظيفتان الأخيرتان تُوسِّعان نفس القاعدة وإن كان هدفهما **حزمة** لا خدمة — القناة طبقة توصيل لا خدمة ([ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md))، فجداولها لا يملكها خادم واحد بل تتشاركها البوتات الثلاثة عبر `@wasla/channel-postgres`. تفاصيل الحزمة في [CHANNEL_PERSISTENCE.md](../02-architecture/CHANNEL_PERSISTENCE.md).

**لماذا قاعدة بيانات مستقلّة لكل خدمة؟** كل خدمة تُطبّق `contracts/schema.sql` الخاص بها وتُفرغ جداولها في `beforeAll`؛ فصل القواعد يجعل الفشل مُنسَباً لخدمة واحدة، ويمنع أي تداخل أو ترتيب ضمني بين الخدمتين، ويحترم قاعدة أن كل خدمة تملك جداولها وحدها (Geography تُخزّن `wasla_public_id` كمرجع opaque بلا FK إلى `identity_users` وفق ADR-006). خدمة `postgres:15` تعمل داخل كل وظيفة عبر `services:` ويُشار إليها بـ`alias: postgres`.

---

## 3. تشغيلها محلياً

```bash
# قاعدة اختبار محلية (أي Postgres 15+)
createdb wasla_geo_test
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasla_geo_test \
  pnpm --filter @wasla/geography-service test:integration

# طبقة القنوات
createdb wasla_channel_test
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasla_channel_test \
  pnpm --filter @wasla/channel-postgres test:integration

# خدمة العملاء
createdb wasla_customer_test
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasla_customer_test \
  pnpm --filter @wasla/customers-service test:integration
```

الاختبار يُطبّق الـDDL والبيانات الأولية بنفسه، فلا حاجة لتهيئة يدوية. بيانات السعودية الأولية idempotent (`ON CONFLICT DO NOTHING`) فإعادة التشغيل آمنة.

---

## 4. إضافة خدمة جديدة

1. أضف `vitest.integration.config.ts` + سكربت `test:integration` في `package.json` الخدمة.
2. لُفّ ملف الاختبار بـ`describe.skipIf(!process.env.DATABASE_URL)` وطبّق `contracts/schema.sql` داخله. (طبقة القنوات تُطبّق `packages/channel-core/contracts/schema.sql` — العقد يبقى في النواة والمُهيّئ يستهلكه.)
3. أضف وظيفة `<service>-db-integration` في `.gitlab-ci.yml` بـ`extends: .db-integration-base` وقاعدة بيانات باسم مستقل.
4. وثّق الوظيفة في الجدول أعلاه (إلزامي حسب [PUSH_DOCUMENTATION_RULE](../00-rules/PUSH_DOCUMENTATION_RULE.md)).

---

## 5. حدود حالية

- **Testcontainers مؤجّل:** خدمات GitLab كافية لهذه المرحلة (موثّق في ADR-005/006). يُعاد النظر عند الحاجة لتشغيل موحّد محلي/CI.
- **لا هجرات مُولَّدة في CI:** `contracts/schema.sql` اليدوي هو مصدر الـDDL؛ `drizzle-kit generate` أداة محلية فقط.
- **بيانات أولية للسعودية فقط:** أي بلد إضافي يحتاج ملف seed جديد + توسيع الاختبار.
- **اختبارات العملاء متسلسلة كذلك:** `vitest.integration.config.ts` في `services/customers` يضبط `fileParallelism: false` لنفس السبب — ملفّا التكامل يتشاركان `wasla_customer_test` ويُفرغان جداولها.
- **تحقّق العملاء المحلي جرى على Postgres 18.4 لا 15:** بيئة التطوير المستعملة في MR 3/6 لم تُتِح `postgres:15`، والاختبارات لا تستعمل أي ميزة تخصّ إصداراً؛ ومع ذلك **مصدر الحقيقة هو ما يشغّله CI** (`postgres:15`).
- **اختبارات القناة متسلسلة:** `vitest.integration.config.ts` في `channel-postgres` يضبط `fileParallelism: false` لأن الملفين يتشاركان قاعدة واحدة ويُفرغان جداولها؛ التوازي كان سيجعل ملفاً يمحو صفوف الآخر.
- **اختبارات E2E متعدّدة الخدمات قائمة الآن:** بوابة Phase 02 (Identity + Geography بمخططين في قاعدة واحدة داخل `geography-db-integration`) وبوابة Phase 03 (البوتات الثلاثة + الهوية داخل `channel-exit-gate-e2e`). ولا توجد بعد بوابة تجمع أكثر من خدمتين في عملية واحدة؛ وتشغيل خدمتين في حاويتين منفصلتين داخل CI مؤجَّل حتّى تُوجد حاجة فعلية له.
- **لا تقارير تغطية:** لا يوجد حدّ تغطية مفروض في CI؛ الحراسة الفعلية هي اختبارات الحراسة المعمارية وبوابات الخروج.
