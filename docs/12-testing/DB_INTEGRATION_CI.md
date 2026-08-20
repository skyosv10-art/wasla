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

---

## 2. شكل الوظائف

قاعدة مشتركة `.db-integration-base` (وظيفة مخفية) تحمل الصورة `node:20-alpine` وتهيئة pnpm 9 عبر corepack وقواعد التشغيل (على أحداث MR وعلى `main`). ثم لكل خدمة وظيفة تُوسّعها بـ`extends`:

| الوظيفة | الخدمة | قاعدة البيانات | ما تتحقّق منه |
|---|---|---|---|
| `db-integration` | `@wasla/identity-service` | `wasla_test` | بوابة خروج Phase 01: إنشاء مستخدم Telegram، ثبات الهوية/Public ID عبر تغيير Username، التاريخ، الـoutbox |
| `geography-db-integration` | `@wasla/geography-service` | `wasla_geo_test` | Phase 02: تحميل بيانات السعودية الأولية، التسلسل الهرمي المُترجم، fallback إلى `ar`، تعيين/تغيير الموقع + `history` + `outbox` + idempotency |
| `channel-db-integration` | `@wasla/channel-postgres` | `wasla_channel_test` | Phase 03 · MR 5: مُهيّئات Postgres للمنافذ الثلاثة — منع التكرار الذرّي وبقاؤه بعد إعادة الإقلاع، idempotency التسليم وتقدّم المحاولات وترتيب طابور الاستحقاق (أولوية ثم زمن)، إلحاق صندوق الصادر مرّة واحدة، و**مطابقة المنافذ**: حالات استخدام النواة نفسها تُشاهَد متطابقة على مُهيّئات الذاكرة وعلى Postgres |

**ملاحظة:** الوظيفة الثالثة تُوسِّع نفس القاعدة وإن كان هدفها **حزمة** لا خدمة — القناة طبقة توصيل لا خدمة ([ADR-007](../15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md))، فجداولها لا يملكها خادم واحد بل تتشاركها البوتات الثلاثة عبر `@wasla/channel-postgres`. تفاصيل الحزمة في [CHANNEL_PERSISTENCE.md](../02-architecture/CHANNEL_PERSISTENCE.md).

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
- **اختبارات القناة متسلسلة:** `vitest.integration.config.ts` في `channel-postgres` يضبط `fileParallelism: false` لأن الملفين يتشاركان قاعدة واحدة ويُفرغان جداولها؛ التوازي كان سيجعل ملفاً يمحو صفوف الآخر.
- **لا اختبار E2E متعدّد الخدمات بعد:** بوابة خروج Phase 02 (Identity + Geography في مسار واحد) هي نطاق MR 7 وستحتاج وظيفة أو قاعدة تجمع المخططين.
