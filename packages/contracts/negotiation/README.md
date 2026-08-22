# @wasla/contracts-negotiation

> **Scope:** سطح TypeScript مُنمَّط لعقود التفاوض والمحادثة الكنسية. قطعة **Contract First** ([ADR-004](../../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md)) لا تنفيذ: لا آلة حالة ولا وصول قاعدة ولا HTTP.
>
> **Last Updated:** 2026-08-23 · **Status:** Active — Phase 08 · MR 1/6 · **Related Code:** [عقود التفاوض](../../../services/negotiations/contracts/README.md) · [نموذج المجال](../../../docs/03-domain/NEGOTIATION_CHAT.md) · [ADR-013](../../../docs/15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md)

## تبرير وجود الحزمة (قانون التوثيق §7)

المستهلك الأول **بوتا العميل والسائق** (MR 5/6)، والثاني الاختبارات وبوابة الخروج. وثمّة مستهلك ثالث
أخطر: **مُسلِّم السعر المتَّفق عليه** إلى محرّك الطلب — نداءٌ يعبر حدّ خدمة بمبلغ مال. بلا سطح مُنمَّط
واحد يُشتَقّ من العقد نفسه، ينسخ كل مستهلك الأنواع فينشأ **عقد موازٍ** ينحرف بصمت، وانحرافُ عقدٍ
يحمل مبلغاً ليس خطأ عرض. الحزمة تجعل الانحراف **فشلَ بناء** لا مفاجأةَ تشغيل.

## ما فيها

- `src/api-types.ts` — **مُولَّد** من العقد الكنسي: `pnpm --filter @wasla/contracts-negotiation generate`. لا يُحرَّر يدوياً.
- `src/events-types.ts` — أنواع الأحداث التسعة مُشتقّة من [`events.json`](../../../services/negotiations/contracts/events.json)، وقائمة الحقول الممنوعة في الحمولات.
- `src/index.ts` — الأنواع المُصدَّرة + كتالوجات ثابتة: **29 كود خطأ** وأصنافها ودالّة `httpStatusForNegotiationError()` · الأطراف والأدوار · حالات الخيط والدور · أسباب الإغلاق والإلغاء · حالات التسليم ونتائجه · المسارات العشرة · **منفذ الخدمة 8091** · اسم السياسة المُقفَلة ورقمها.
- `src/__tests__/` — **70 حارس انحراف** يقرأون العقود من القرص وقت التشغيل.

## الحدود التي تفرضها الاختبارات لا المراجعة البشرية

- **لا كتابة في `orders`**: لا `REFERENCES orders`، ولا عمود يعكس حالة الطلب، ولا مسارٌ يكتبه ([ADR-013](../../../docs/15-decisions/ADR-013-negotiation-chat-agreement-boundary-and-tick-driven-expiry.md) القرار 2).
- **لا رمزَ يقول «فشل التسليم فبطل الاتفاق»**: لا `502` ولا صنف `bad_gateway` في الكتالوج أصلاً.
- **لا قبولاً ذاتياً ولا دورين معلّقين**: القيود مُسمّاة في `schema.sql` والحرّاس تتحقّق من وجودها بالاسم (القرار 3).
- **لا مبلغ عائم ولا مبلغ بلا عملة**: كل عمود مبلغ ينتهي بـ`_minor`، والحدود من سياسة مُرقّمة (القرار 4).
- **لا `is_expired` مخزّن**: الزمن نبضة لا مؤقّت (القرار 5).
- **حارس خصوصية** ينفي من **كل** حمولة حدث نصّ المحادثة والاسم والهاتف والإحداثية و`chat_id` — و`body_length` عددٌ لا نصّ (القرار 6).
- **لا جدول ترجمات ولا نصّ مترجَم مخزّن**: `source_locale` وحده (القرار 7).
- **لا دفع ولا سمعة ولا تسعير ولا مرفقات** كعمود أو مسار: مالكوها مراحل أخرى (القرار 8).
- الحرّاس السالبة تقرأ **سطح الآلة وحده** (المخطّط بعد تجريد تعليقات `--`، وأسماء مفاتيح YAML وقيَم التعدادات)، مع توكيدٍ **موجب** أنّ الشرح ما زال موجوداً — فالكلمة المحرَّمة تظهر شرعاً في تعليقٍ ينفيها.
- التأكيدات على **الأكواد الثابتة** لا على النصّ العربي، فتغيير الصياغة لا يُكسر بناءً.

## الاستعمال

```ts
import {
  NEGOTIATION_SERVICE_PORT, NEGOTIATION_ERROR_CODES, httpStatusForNegotiationError,
  NEGOTIATION_THREAD_STATES, NEGOTIATION_ROUND_STATES, NEGOTIATION_API_PATHS,
  NEGOTIATION_LAUNCH_POLICY_LABEL, NEGOTIATION_EVENT_TYPES,
} from "@wasla/contracts-negotiation";
```

## أوامر

```bash
pnpm --filter @wasla/contracts-negotiation generate    # يُولّد api-types.ts من api.openapi.yml
pnpm --filter @wasla/contracts-negotiation typecheck
pnpm --filter @wasla/contracts-negotiation test        # 70 حارس انحراف
```

## ما ليس فيها بقرار

لا آلة حالة مُنفَّذة (MR 2/6) · لا استمرارية (MR 3/6) · لا خادم HTTP (MR 4/6) · لا `AgreedPricePort` ولا واجهة بوت (MR 5/6).
