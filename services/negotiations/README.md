# `@wasla/negotiations-service` — نواة التفاوض

> **الحالة:** المجال + الاستمرارية مُنجَزان (Phase 08 · MR 3/6). **الخدمة لا تُقلَع بعد** —
> بلا HTTP، وهذا حدٌّ مُعلَن لا نقص. راجع
> [`NEGOTIATION_CORE_DOMAIN.md` §1](../../docs/03-domain/NEGOTIATION_CORE_DOMAIN.md) و
> [`NEGOTIATION_PERSISTENCE.md`](../../docs/02-architecture/NEGOTIATION_PERSISTENCE.md).

## لماذا توجد هذه الحزمة (قاعدة التوثيق §7)

السعر قبل هذه المرحلة كان **رقماً يُفرَض**: التوزيع يعرض، والسائق يقبل أو يرفض، ولا موضع
واحد يستطيع أن يجيب عن «على كم اتفقا، ومتى، وأيّ جولة بالتحديد». هذه الحزمة هي ذلك
الموضع: الخيط بين طرفين، وجولات مُرقّمة، وقبول صريح لجولةٍ **بعينها**، والاتفاق الذي
يبقى صحيحاً حتى لو تعذّر تسليمه إلى محرّك الطلبات (ADR-013 قرار 2).

## القاعدة الحاكمة

**لا اتفاق بلا جولة مُسمّاة.** كلّ قبول يذكر `expected_round_no`، ويُسجّل الاتفاق رقم
الجولة، وقاعدة البيانات تمنع أن يقبل صاحب العرض عرضه
(`ck_negotiation_rounds_no_self_resolution`). «قَبِل» وحدها ليست جواباً عن «قَبِل ماذا».

## البنية

| المسار | المسؤوليّة |
|---|---|
| `src/domain/model.ts` | النموذج، ومجموعات القيم المُقفلة مُعاد تصديرها من `@wasla/contracts-negotiation` لا مُعاد كتابتها |
| `src/domain/state-machine.ts` | آلتا حالة الخيط والجولة كجدولين، والدور الإلزامي `turnBelongsTo` |
| `src/domain/policy.ts` | سياسة الإطلاق `saudi-launch-v1` مُقفلة (`is_frozen`) |
| `src/domain/money.ts` · `expiry.ts` | وحدات صغرى صحيحة بعملة صريحة · حساب الوقت الوحيد في الخدمة |
| `src/domain/errors.ts` · `validation.ts` · `events.ts` | 29 كوداً · حرّاس الحدود · مصانع الأحداث التسعة |
| `src/ports.ts` | المنافذ — تُنجزها الذاكرة وPostgres معاً، و`AgreedPricePort` الحقيقي تُنجزه 5/6 |
| `src/infrastructure/in-memory.ts` | مُهيّئات تُحاكي 24 قيداً وفهرساً **بأسمائها الحرفيّة** |
| `src/use-cases/*.ts` | سطح الكتابة كلّه: فتح · اقتراح · قبول · رفض · رسالة · إلغاء · نبضة · قراءة |
| `src/infrastructure/drizzle/schema.ts` | مرآة Drizzle لجداول العقد الثمانية — **لا تُنشئ مخطّطاً**، والعقد `contracts/schema.sql` وحده مصدر الحقيقة |
| `src/infrastructure/drizzle/repository.ts` | ثمانية مستودعات Postgres — حدّ التحويل الوحيد، وتفكّ سلسلة `cause` لتقرأ اسم القيد الحقيقي |
| `src/infrastructure/drizzle/transaction.ts` | `PostgresNegotiationUnitOfWork` يملك حدّ المعاملة **حصراً**: `run()` معاملة واحدة لكل عمليّة · `read()` بلا معاملة |

## التشغيل

```bash
pnpm --filter @wasla/negotiations-service test        # 158 اختباراً، ~2s، بلا قاعدة ولا شبكة
pnpm --filter @wasla/negotiations-service typecheck

# 62 اختبار تكامل على قاعدة حقيقيّة (تتخطّى نفسها إن لم يُضبَط DATABASE_URL)
createdb wasla_negotiations_test
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasla_negotiations_test \
  pnpm --filter @wasla/negotiations-service test:integration
```

## ما تضمنه الاختبارات صراحةً

- **الخصوصيّة آليّاً:** `privacy.test.ts` يمشي على **كلّ مفتاح وكلّ نصّ** في كلّ حِمل حدث
  ويسقط عند أيّ حقل من `NEGOTIATION_EVENT_FORBIDDEN_FIELDS`؛ المبلغ يعبر، والنصّ لا.
- **القيود بأسمائها:** `constraints.test.ts` يرفع كلّ قيد من الـ24 باسمه، ويتحقّق أنّ
  قيود التماسك ترفع `NegotiationConstraintViolation` **بلا كود منشور** — فلا يمكن للطبقة
  الـHTTP أن تترجم خطأً برمجيّاً إلى 4xx يُطلب من العميل إعادة المحاولة عليه.
- **الاتفاق يصمد:** فشل تسليم السعر لا يُبطل الاتفاق، ولا يوجد 502 ولا صنف `bad_gateway`.
- **الوقت بلا انتظار:** كلّ المواعيد تُختبر بتحريك ساعة مُحقونة، ولا `sleep` واحدة.
- **القاعدة الحقيقيّة تُسأل لا تُفترض:** 62 اختبار تكامل تُعيد إنجاح الـ24 قاعدة على محرّك حقيقي، وتُثبت أنّ عمليّة فاشلة لا تترك أثراً جزئيّاً، وأنّ **عشرة سيناريوهات** تُنتج الأثر نفسه على الذاكرة وعلى Postgres — فالتخزين هو المتغيّر الوحيد.

## ما بقي

4/6 الـHTTP على 8091 (مقبس معاملة يستعمل وحدة العمل) ·
5/6 `AgreedPricePort` الحقيقي ومسارات البوت وترحيل `orders` · 6/6 بوّابة الخروج E2E.
خارطة الطريق في [`docs/16-progress/ROADMAP.md`](../../docs/16-progress/ROADMAP.md).
