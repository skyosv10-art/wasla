# `@wasla/drivers-service` — نواة السائق

> **الحالة:** طبقة المجال مُنجَزة (Phase 05 · MR 2/6). **الخدمة لا تُقلَع بعد** —
> بلا قاعدة بيانات وبلا HTTP، وهذا حدٌّ مُعلَن لا نقص. راجع
> [`DRIVER_CORE_DOMAIN.md` §1](../../docs/02-architecture/DRIVER_CORE_DOMAIN.md).

## لماذا توجد هذه الحزمة (قاعدة التوثيق §7)

أهليّة السائق كانت حتى هذه المرحلة **رأياً تُشكّله كلّ خدمة لنفسها**: المطابقة تقرأ
إسقاطاً لا تملكه، والتوزيع يفترض ما قالته المطابقة، ولا أحد يستطيع أن يجيب من موضع واحد
عن «لماذا لا يستلم هذا السائق طلبات؟». هذه الحزمة هي ذلك الموضع الواحد: الملفّ،
والمركبات، والوثائق، والدالّة الواحدة التي تُحوّلها إلى حكم — ومعها السجلّ الذي يقول متى
تغيّر الحكم وبأيّ مُحرّك.

## القاعدة الحاكمة

**لا تغيّر حالة بلا إعادة قرار.** كلّ حالة استخدام كتابيّة تنتهي عند
`recomputeEligibility`، وهي المُقرِّر والمُقيِّد والناشر الوحيد.

## البنية

| المسار | المسؤوليّة |
|---|---|
| `src/domain/model.ts` | النموذج، ومجموعات القيم المُقفلة مُعاد تصديرها من `@wasla/contracts-driver` لا مُعاد كتابتها |
| `src/domain/eligibility.ts` | `evaluateEligibility(snapshot, policy, now)` — دالّة نقيّة، و`now` مُمرَّر لا مقروء |
| `src/domain/documents.ts` · `vehicles.ts` | آلات الحالات كجداول، و`deriveVerificationStatus` |
| `src/domain/policy.ts` | سياسة الإطلاق `saudi-launch-v1` مُقفلة |
| `src/domain/errors.ts` · `validation.ts` · `events.ts` | 21 كوداً · حرّاس الحدود · مصانع الأحداث |
| `src/ports.ts` | المنافذ التي تُنجزها MR 3/6 على Postgres |
| `src/infrastructure/in-memory.ts` | مُهيّئات تُحاكي 12 قيداً **بأسمائها الحرفيّة** |
| `src/use-cases/*.ts` | سطح الكتابة كلّه |
| `src/mappers.ts` | حدّ `camelCase ⇄ snake_case` الوحيد |

## التشغيل

```bash
pnpm --filter @wasla/drivers-service test        # 69 اختباراً، ~1s، بلا قاعدة
pnpm --filter @wasla/drivers-service typecheck
```

## ما بقي

MR 3/6 قاعدة البيانات · 4/6 الـHTTP · 5/6 التشغيل والنبضة · 6/6 تكامل المطابقة.
خارطة الطريق في [`docs/16-progress/ROADMAP.md`](../../docs/16-progress/ROADMAP.md).
