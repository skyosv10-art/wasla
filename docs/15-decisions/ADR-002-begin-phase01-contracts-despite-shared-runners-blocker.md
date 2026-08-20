# ADR-002 — بدء عمل عقود Phase 01 (Identity) رغم عائق shared runners

> **Title:** السماح ببدء Contract First لـ Phase 01 — Identity Foundation رغم أن Phase 00 Exit Gate لم يُجتز بالكامل
>
> **Status:** Accepted
>
> **Date:** 2026-08-20
>
> **Decision Owners:** مالك المشروع · Team 01 — Identity & Auth · Team 12 — Integration
>
> **Supersedes:** — (لا يُلغي أي قرار سابق)
>
> **Related:** [ADR-001](ADR-001-identity-decoupled-from-telegram.md) · [ROADMAP.md §2, §7](../16-progress/ROADMAP.md) · [ENGINEERING_DOCUMENTATION_LAW.md §4](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) · [HANDOFF_NEXT_STEPS.md](../16-progress/HANDOFF_NEXT_STEPS.md)

---

## Context

قاعدة عدم تجاوز المراحل ([ENGINEERING_DOCUMENTATION_LAW.md §4](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) و[ROADMAP.md §2](../16-progress/ROADMAP.md)) تنص على عدم بدء مرحلة قبل اجتياز Exit Gate للمرحلة السابقة. Phase 00 Exit Gate يتضمن شرط **«CI passes»**.

الوضع الحالي (موثّق في [HANDOFF_NEXT_STEPS.md](../16-progress/HANDOFF_NEXT_STEPS.md)):

1. العمل الهندسي لـ Phase 00 مكتمل 100%: إصلاح فحص الأسرار في CI (`scripts/checks/scan-secrets.sh`)، ربطه بـ`pre-push`، تحديث `.gitlab-ci.yml`، التحقق من حماية main، قالب MR، doc-coverage مُختبَر E2E، CI config صالح (server-side lint valid).
2. الشرط الوحيد المتبقي «CI passes» **محجوب بعائق خارجي**: GitLab shared runners غير متاحة للـ namespace المجاني غير المُتحقَّق منه. تعذّر حلّه من بيئة التنفيذ (لا Docker لتشغيل `image: alpine`، ولا يمكن التحقق من namespace لحساب المستخدم برمجياً). مؤكد: pipelines على main فشلت فوراً بـ0 وظائف منذ 2026-08-19 (قبل أي تعديل).
3. حلّ هذا العائق هو إجراء واحد من مالك الحساب (التحقق من namespace في GitLab User Settings → Billing، بدون رسوم) أو تشغيل runner خاص.

## Decision

**السماح ببدء عمل Contract First لـ Phase 01 — Identity Foundation الآن**، مع القيود التالية:

1. **نطاق العمل المسموح:** عقد API + عقد Event + عقد Data + عقد Error لخدمة Identity **فقط** (Contract First). صيغ مستقلة عن المكدّ التقني (OpenAPI / JSON Schema / PostgreSQL DDL / كتالوج أخطاء نصّي) — لا اختيار لمكدّ تطبيقي (TS/Go/…) في هذه الخطوة.
2. **لا يُعتبر Phase 00 = Completed.** تبقى حالتها **Exit Gate Pending** حتى اجتياز CI فعلياً على GitLab بعد تفعيل shared runners ودمج [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1).
3. **لا يُعتبر Phase 01 Exit Gate مجتازاً** بمجرد وجود العقود. Exit Gate لـ Phase 01 هو: «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username» — وهذا يتطلب تنفيذاً فعلياً واختبارات، وليس عقوداً فقط.
4. العقود تُنتج وفق [ADR-001](ADR-001-identity-decoupled-from-telegram.md): Wasla User ID هو الهوية الأساسية، وTelegram IDs/الهاتف روابط Identity.

## Rationale

- منعج **Contract First** ([README §7](../../README.md)) صراحةً بإمكانية العمل على Interfaces/Schemas/Mock services/Contract tests بالتوازي قبل اكتمال الخدمة. عقود Identity لا تعتمد على تشغيل CI.
- العائق المتبقي لـ Phase 00 هو إجراء حساب/عمليات (verification) وليس فجوة هندسية. تعطيل كل التقدم الهندسي بانتظار إجراء خارجي خارج عن سيطرة الفريق يتعارض مع مبدأ «نحن نبني نظامًا تراكميًا».
- توثيق الانحراف عبر ADR (بدل التخطّي الصامت) يحفظ شفافية خارطة الطريق لأي جهة تالية — وهذا جوهر القاعدة الحاكمة.

## Consequences

### إيجابية
- تقدّم فعلي موثّق نحو Phase 01 دون انتظار إجراء خارجي.
- العقود المستقلة عن المكدّ تسمح للفرق باختيار تقنية التنفيذ لاحقاً بقرار موثّق منفصل (ADR مستقبلي).
- يثبت قابلية Contract First للتطبيق على بنية المستودع الحالية.

### سلبية / تكاليف
- مؤقتاً: وجود عقود بلا تنفيذ قد يُعطي انطباعاً زائفاً بأن Phase 01 قيد التشغيل — يُخفَّف بإبقاء MASTER_PROGRESS دقيقاً (Phase 01 = In Progress / Contract First فقط).
- عند تفعيل shared runners، يجب اجتياز CI على [MR !1](https://gitlab.com/uxxxu/wasla/-/merge_requests/1) ودمجه **قبل** اعتماد Phase 00 = Completed والانتقال الكامل لتنفيذ Phase 01.

### مخاطر مُدارة
- خطر تطابق العقود لاحقاً مع التنفيذ: يُدار عبر CI job `doc-coverage` (أي تعديل على العقود يجب أن يرافقه تحديث docs/) واختبارات Contract عند ظهور المكدّ.

## Alternatives

### بديل 1: الانتظار حتى تفعيل shared runners قبل أي عمل على Phase 01
- **مرفوض:** يُجمّد التقدم الهندسي بانتظار إجراء خارجي خارج سيطرة الفريق، ويتعارض مع توجيه مالك المشروع بالمتابعة حسب الوثائق. العقد لا يحتاج CI.

### بديل 2: اعتبار Phase 00 = Completed الآن
- **مرفوض:** يخالف [ENGINEERING_DOCUMENTATION_LAW.md §4](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md) («لا يسمح بعبارة Done بدون Evidence»). CI لم يجتز فعلياً على GitLab بعد.

---

## Compliance Notes

- هذا القرار يُسجَّل في سجل القرارات ويُشار إليه في [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md) (Phase 01) و[TASK_LOG.md](../16-progress/TASK_LOG.md).
- لا يُغيّر ترتيب ROADMAP: Phase 01 يبقى بعد Phase 00 في التسلسل؛ هذا ADR استثنائي مؤقت لبدء العقود فقط.
- عند اجتياز Phase 00 Exit Gate فعلياً، يُغلق هذا الاستثناء (يُحدَّث هذا ADR إلى Status: Superseded) ويُتابع تنفيذ Phase 01 وفق التدفق الطبيعي.
