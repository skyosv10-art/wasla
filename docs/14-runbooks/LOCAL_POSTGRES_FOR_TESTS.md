# محرّك PostgreSQL محلّيّ لاختبارات التكامل (بلا root وبلا Docker)

> **النوع:** Runbook · **Scope:** إحضار محرّك Postgres حقيقي على جهازٍ لا تملك فيه صلاحية `root` ولا Docker، لتشغيل كلّ مجموعات `test:integration` وبوابات الخروج E2E قبل الدمج.
>
> **Status:** Active · **Last Updated:** 2026-08-23 · **Related Team:** كلّ الفرق
>
> **Related Docs:** [HANDOFF_NEXT_STEPS §2-أ — سياسة الدمج بأنبوب أحمر](../16-progress/HANDOFF_NEXT_STEPS.md) · [CI_RUNNER_UNBLOCK.md](CI_RUNNER_UNBLOCK.md) · [TESTING_STRATEGY.md](../12-testing/TESTING_STRATEGY.md)

---

## 1. لماذا هذه الوثيقة موجودة

حصّة دقائق CI منتهية ولن تُجدَّد، والدمج بأنبوب أحمر مأذونٌ فيه بشرطٍ صريح: **ما يحتاج محرّكاً يُشغَّل على Postgres حقيقي محلّيّاً قبل الدمج**. فبقيت عقدةٌ واحدة: بيئات العمل بلا `root` — `apt-get install postgresql` يُرفض، و`pg_isready` غير موجود، وDocker غير متاح. ونتيجتها أنّ **أكثر من 140 اختبار تكامل** كانت تتخطّى نفسها بصمت (كلّ مجموعة تتخطّى نفسها بلا `DATABASE_URL`)، فتظهر «خضراء» وهي لم تُشغَّل.

الحلّ: ثنائيّات Postgres تُنزَّل من npm كحزمة عادية، وتعمل في فضاء المستخدم بلا تثبيتٍ للنظام.

## 2. الوصفة (خمس دقائق)

```bash
# 1) أحضر الثنائيّات خارج المستودع كي لا تدخل في pnpm-lock.yaml
mkdir -p /tmp/pg && cd /tmp/pg
npm i @embedded-postgres/linux-x64 --no-audit --no-fund

export PGBIN=/tmp/pg/node_modules/@embedded-postgres/linux-x64/native/bin
export PGDATA=/tmp/pgdata

# 2) هيّئ العنقود: مستخدم postgres وثقة محلّية (بيئة اختبار محلّية فقط)
"$PGBIN/initdb" -U postgres -A trust -D "$PGDATA"

# 3) شغّله على منفذ لا يزاحم شيئاً
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 55432 -k /tmp" -l /tmp/pg.log start
tail -3 /tmp/pg.log   # يجب أن يظهر: database system is ready to accept connections

# 4) العنوان الذي تقرأه كل مهيّئات الاختبار
export DATABASE_URL="postgres://postgres@127.0.0.1:55432/postgres"
```

الإيقاف: `"$PGBIN/pg_ctl" -D "$PGDATA" stop`.

**ملاحظتان تُوفّران وقتاً:**

- الحزمة تشحن `initdb` و`pg_ctl` و`postgres` **ولا تشحن `psql`**. وهذا لا يضرّ: الاختبارات تتصل بعميل `pg` من Node، لا بصدفة. وإن احتجت استعلاماً يدويّاً فاكتب سطراً بـ`pg` بدل البحث عن `psql`.
- المعمار غير x64 يحتاج حزمته: `@embedded-postgres/linux-arm64` أو `darwin-arm64`.

## 3. تشغيل المجموعات

كلّ مهيّئ (`pg-harness.ts`) يُطبّق `contracts/schema.sql` من القرص — **العقد هو المصدر، لا ترحيلات Drizzle ولا حالةٌ متروكة من تشغيلٍ سابق**. فيمكن تشغيل الخدمات على نفس القاعدة تِباعاً؛ ولا تُشغَّل مجموعتان **معاً** على نفس القاعدة (`fileParallelism: false` يحمي داخل الخدمة لا بينها).

```bash
export DATABASE_URL="postgres://postgres@127.0.0.1:55432/postgres"
pnpm --filter @wasla/negotiations-service test:integration
pnpm --filter @wasla/orders-service      test:integration
pnpm --filter @wasla/dispatch-service    test:integration
# … وهكذا لكل خدمة تُعلن السكربت
```

## 4. أرقام مُقاسة على هذا المحرّك (2026-08-23 · Postgres 17)

| المجموعة | النتيجة |
| --- | --- |
| `@wasla/negotiations-service test:integration` | 3 ملفات · **62 اختباراً ناجحاً** |
| `@wasla/orders-service test:integration` | 3 ملفات · **32 اختباراً ناجحاً** (منها قيود أعمدة الاتفاق الجديدة) |
| `@wasla/dispatch-service test:integration` | 3 ملفات · **48 اختباراً ناجحاً** |
| `@wasla/drivers-service test:integration` | 3 ملفات · **27 فاشلاً · 52 ناجحاً** — عطبٌ **سابق ومُعلَن** في التوكيدات لا في السلوك، بنطاق Phase 05 ([التفصيل](../16-progress/HANDOFF_NEXT_STEPS.md)) |

السطر الأخير هو فائدة هذه الوثيقة الحقيقية: مجموعةٌ كانت تُعلن نفسها خضراء بالتخطّي، صار عطبها **رقماً مقروءاً** قبل الدمج لا بعده.

## 5. الحدود

- **بيئة اختبار فقط.** `-A trust` تعني لا كلمة سرّ، ومكانها `/tmp` يعني قاعدةً تُفقد بإعادة التشغيل. لا يُبنى على هذا شيء إلّا الاختبار.
- **ليست بديلاً عن CI.** الحلّ الدائم عدّاءٌ ذاتيّ الاستضافة ([CI_RUNNER_UNBLOCK.md](CI_RUNNER_UNBLOCK.md))؛ هذه الوثيقة تُنقذ **بوابة ما قبل الدمج** فقط، ويبقى إثبات كلّ من يدفع على عاتقه.
- **لا تدخل الحزمة في المستودع.** تُثبَّت في `/tmp` قصداً كي لا تُضاف تبعية ثنائيّات إلى `pnpm-lock.yaml`.
