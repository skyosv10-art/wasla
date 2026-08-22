# @wasla/contracts-driver

> **Scope:** سطح TypeScript مُنمَّط لعقود نواة السائق الكنسية. قطعة **Contract First** ([ADR-004](../../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md)) لا تنفيذ: لا حاسب أهليّة ولا وصول قاعدة ولا HTTP.
>
> **Last Updated:** 2026-08-22 · **Status:** Active — Phase 05 · MR 1/6 · **Related Code:** [عقود نواة السائق](../../../services/drivers/contracts/README.md) · [نموذج المجال](../../../docs/03-domain/DRIVER_CORE.md) · [ADR-012](../../../docs/15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) · **Related Team:** Team 03 — Driver

## تبرير وجود الحزمة (قانون التوثيق §7)

المستهلك الأول هو **بوت السائق** (MR 5/6 من هذه المرحلة)، والثاني هو الاختبارات وبوابة الخروج،
والثالث لوحة الإدارة التي تُراجع الوثائق. وثمّة مستهلك رابع أخطر: **ناشر الترشيح** الذي ينادي خدمة
المطابقة بقيمتين لا ثالثة لهما (`driver_core`). بلا سطح مُنمَّط واحد يُشتَقّ من العقد نفسه، ينسخ كل
مستهلك الأنواع فينشأ **عقد موازٍ** ينحرف بصمت. الحزمة تجعل الانحراف **فشلَ بناء** لا مفاجأةَ تشغيل.

## ما فيها

- `src/api-types.ts` — **مُولَّد** من العقد الكنسي: `pnpm --filter @wasla/contracts-driver generate`. لا يُحرَّر يدوياً.
- `src/events-types.ts` — أنواع الأحداث الأحد عشر مُشتقّة من [`events.json`](../../../services/drivers/contracts/events.json)، وكتالوج أسباب عدم الأهليّة.
- `src/index.ts` — الأنواع المُصدَّرة + كتالوجات ثابتة: أكواد الأخطاء وأصنافها · أنواع الوثائق · فئات المركبات · مفردات التوافر المُعلَن · مسارات الواجهة · **منفذ الخدمة 8090** · قيمتا النشر إلى الترشيح.
- `src/__tests__/` — **حرّاس انحراف** يقرأون العقود من القرص وقت التشغيل.

## الحدود التي تفرضها الاختبارات لا المراجعة البشرية

- **لا عمود أهليّة** في المخطّط: `eligibility_state` و`is_eligible` ممنوعان في `driver_profiles` ([ADR-012](../../../docs/15-decisions/ADR-012-driver-core-eligibility-derivation-and-candidacy-publication.md) القرار 2).
- **لا حالة غير مؤهَّلة بلا سبب**: كتالوج الأسباب مُقفل ومطابَق حرفياً بين `errors.md` و`events.json` والحزمة.
- **لا مسار ترشيح ولا عرض ولا موجة ولا كتابة في محرّك الطلبات** في هذا السطح (القرار 3).
- **`busy` غائبة** من مفردات التوافر المُعلَن، ولا حقل `availability_state` في أي حمولة (القرار 4).
- **لا حالة `expired`** على الوثيقة — الانتهاء بيانٌ يُقارَن بساعة (القرار 5).
- **لا مفتاح أجنبي** خارج جداول هذه الخدمة، ولا FK إلى الهوية (القرار 1).
- **لا اشتراك ولا تقييم ولا سمعة ولا حساب بنكي** كعمود أو مسار: مالكوها مراحل أخرى (القرار 7).
- **حارس خصوصية** يبحث في كل حمولة حدث عن قائمة حقول ممنوعة (اسم · هاتف · رقم هوية · لوحة · `storage_ref` · إحداثية · `chat_id`) ويُفشل البناء عند وجودها (القرار 8).
- التأكيدات على **الأكواد الثابتة** لا على النصّ العربي، فتغيير الصياغة لا يُكسر بناءً.

## الاستعمال

```ts
import {
  DRIVER_SERVICE_PORT, DRIVER_ERROR_CODES, httpStatusForDriverError,
  ELIGIBILITY_REASON_CODES, DRIVER_CANDIDACY_ELIGIBILITY_SOURCE,
  type DriverProfile, type EligibilityView, type DriverEligibilityChangedV1,
} from "@wasla/contracts-driver";
```

## أوامر

```bash
pnpm --filter @wasla/contracts-driver generate    # يُولّد api-types.ts من api.openapi.yml
pnpm --filter @wasla/contracts-driver typecheck
pnpm --filter @wasla/contracts-driver test        # حرّاس الانحراف
```

## ما ليس فيها بقرار

لا تنفيذ لحاسب الأهليّة (MR 2/6) · لا عميل HTTP للمطابقة (MR 3/6) · لا استمرارية (MR 3/6) · لا واجهة سائق (MR 5/6).
