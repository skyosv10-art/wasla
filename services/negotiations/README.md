# `@wasla/negotiations-service` — نواة التفاوض

> **الحالة (مقيسةٌ 2026-10-18 · CLM-0607):** المجالُ والاستمراريةُ و**HTTP على 8091** قائمةٌ —
> 13 مسارًا في [`src/http/app.ts`](src/http/app.ts) (جدولُ «HTTP» أدناه) يُقلِعها
> [`src/http/server.ts`](src/http/server.ts). *(الصيغةُ السابقةُ «الخدمة لا تُقلَع بعد — بلا HTTP»
> كانت صحيحةً عندَ Phase 08 · MR 3/6 وتقادمتْ؛ قيسَ التقادمُ في CLM-0601 وسُجِّلَ G-S6.)* راجع
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
| `src/domain/errors.ts` · `validation.ts` · `events.ts` | 29 كوداً (`NEGOTIATION_ERROR_CODES`) · حرّاس الحدود · مصانع الأحداث التسعة (`NEGOTIATION_EVENT_TYPES`) |
| `src/ports.ts` | المنافذ — تُنجزها الذاكرة وPostgres معاً |
| `src/infrastructure/http-agreed-price.ts` · `http-dispatch-offer.ts` · `outbound-wiring.ts` | المنفذانِ الصادرانِ الحقيقيّانِ (`AgreedPricePort` → orders 8087 · عروضُ التوزيعِ → dispatch 8089) — يُختارانِ من `ORDERS_SERVICE_URL`/`DISPATCH_SERVICE_URL`، وغيابُ أحدِهما منفذٌ يرفضُ بالاسمِ لا يتظاهرُ بالنجاحِ |
| `src/http/app.ts` · `server.ts` · `service-identity.ts` | HTTP على 8091 · هويّةُ خدمةٍ موقَّعةٌ على كلِّ مسارٍ عدا `/health` · `DATABASE_URL` غائبٌ → مخازنُ ذاكريةٌ و`/health` = `degraded` |
| `src/infrastructure/in-memory.ts` | مُهيّئات تُحاكي القيودَ والفهارسَ **بأسمائها الحرفيّة** (`constraints.test.ts` يرفعُ 24 اسمًا) |
| `src/use-cases/*.ts` | سطح الكتابة كلّه: فتح · اقتراح · قبول · رفض · رسالة · إلغاء · نبضة · قراءة |
| `src/infrastructure/drizzle/schema.ts` | مرآة Drizzle لجداول العقد الثمانية — **لا تُنشئ مخطّطاً**، والعقد `contracts/schema.sql` وحده مصدر الحقيقة |
| `src/infrastructure/drizzle/repository.ts` | ثمانية مستودعات Postgres — حدّ التحويل الوحيد، وتفكّ سلسلة `cause` لتقرأ اسم القيد الحقيقي |
| `src/infrastructure/drizzle/transaction.ts` | `PostgresNegotiationUnitOfWork` يملك حدّ المعاملة **حصراً**: `run()` معاملة واحدة لكل عمليّة · `read()` بلا معاملة |

## HTTP (مقيسٌ من `src/http/app.ts` · الصلاحيّاتُ من [`SERVICE_AUTH_ENFORCEMENT.md`](../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md))

| المسار | الصلاحيّة |
|---|---|
| `GET /health` | مفتوحٌ بتصنيفٍ صريحٍ |
| `POST /negotiations` | `negotiations:thread:write` |
| `GET /negotiations` | `negotiations:thread:read` |
| `GET /negotiations/{threadId}` | `negotiations:thread:read` |
| `POST /negotiations/{threadId}/cancel` | `negotiations:thread:write` |
| `GET /negotiations/{threadId}/rounds` | `negotiations:round:read` |
| `POST /negotiations/{threadId}/rounds` | `negotiations:round:write` |
| `POST /negotiations/{threadId}/rounds/{roundNo}/accept` | `negotiations:round:decide` |
| `POST /negotiations/{threadId}/rounds/{roundNo}/reject` | `negotiations:round:decide` |
| `GET /negotiations/{threadId}/messages` | `negotiations:message:read` |
| `POST /negotiations/{threadId}/messages` | `negotiations:message:write` |
| `GET /negotiations/{threadId}/agreement` | `negotiations:agreement:read` |
| `POST /negotiations/tick` | `negotiations:tick:run` |

العقدُ المنشورُ: [`contracts/api.openapi.yml`](contracts/api.openapi.yml). الحافّةُ تُعيدُ كتابةَ `/negotiations` إلى الخدمةِ ([`infra/render/app-rewrites.json`](../../infra/render/app-rewrites.json)).

## التشغيل

```bash
pnpm --filter @wasla/negotiations-service test        # 260 اختباراً في 15 ملفّاً (مقيسٌ 2026-10-18)، بلا قاعدة ولا شبكة
pnpm --filter @wasla/negotiations-service typecheck

# اختباراتُ تكاملٍ على قاعدةٍ حقيقيّةٍ في 6 ملفّاتٍ `*.integration.test.ts` (تتخطّى نفسها إن لم يُضبَط DATABASE_URL)
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
- **القاعدة الحقيقيّة تُسأل لا تُفترض:** اختباراتُ التكاملِ تُعيد إنجاح الـ24 قاعدة على محرّك حقيقي، وتُثبت أنّ عمليّة فاشلة لا تترك أثراً جزئيّاً، وأنّ **عشرة سيناريوهات** تُنتج الأثر نفسه على الذاكرة وعلى Postgres — فالتخزين هو المتغيّر الوحيد.

## ما بقي

*(إضافةٌ مؤرَّخةٌ 2026-10-18 · CLM-0607 — قائمةُ Phase 08 السابقةُ «4/6 HTTP · 5/6 AgreedPricePort ومساراتُ البوت وترحيلُ orders · 6/6 بوّابةُ الخروج E2E» قِيسَتْ: HTTP قائمٌ (أعلاه) · المنفذانِ الصادرانِ قائمانِ · بوّابةُ الخروجِ في [`packages/negotiation-e2e`](../../packages/negotiation-e2e/src/__tests__/phase08-exit-gate.e2e.test.ts).)*
هذا الملفُّ لا يحكمُ بجاهزيّةِ إنتاجٍ؛ حالةُ الإطلاقِ في
[`docs/16-progress/LAUNCH_EXECUTION_BOARD.md`](../../docs/16-progress/LAUNCH_EXECUTION_BOARD.md)
وخارطة الطريق في [`docs/16-progress/ROADMAP.md`](../../docs/16-progress/ROADMAP.md).
