# CLM-0605 — UAT-08: رفضُ تعديلِ سجلِّ التدقيقِ بـ405 + `Allow` (ADR-072 D2)

**الحجزُ:** CLM-0605 (`Active` قبلَ أيِّ تعديلٍ) · **العنصرُ:** M0-53 · **الأساسُ:** `343cf8a20bd4584f036fd4001c29f533defe0f99` (main بعدَ دمجِ #755) · **القرارُ:** [ADR-072](../../../15-decisions/ADR-072-owner-decisions-gs7-uat08.md) D2 — إجابةُ المالكِ «أعتمد 405».

## §1 القياسُ على الأساسِ (قبلَ التغييرِ)

- `services/audit/src/http/app.ts` يسجّلُ ثلاثةَ مساراتٍ فقط: `GET /health` · `POST /audit/events` · `GET /audit/events`.
- PUT/PATCH/DELETE على `/audit/events/1` كانت تُرجعُ **404** (موجِّهُ Fastify الافتراضيُّ) — والاختباراتُ الثلاثةُ «does not expose …» تؤكّدُ 404 حرفيًّا (`audit-routes.test.ts` L216-233 على الأساسِ).
- الحكمُ في CLM-0602: RQ-ADM-28 = CONFLICT (المواصفةُ «405 أو 403» · التنفيذُ 404).

## §2 التصميمُ ولماذا

| الخيارُ | الحكمُ |
|---|---|
| تسجيلُ مساراتِ `app.put/patch/delete` تُرجعُ 405 | **مرفوضٌ**: حارسُ مصفوفةِ التفويضِ (M1-05 · `validate-authz-policy.sh`) يطلبُ لكلِّ مسارٍ مسجَّلٍ صلاحيّةً من `AUDIT_SCOPES` أو `OPEN`؛ إمّا اختراعُ صلاحيّةٍ لعمليّةٍ لا وجودَ لها، أو فتحُ مسارٍ بلا هويّةٍ. كلاهما يُضعفُ الحدَّ. |
| `app.route({ method: [...] })` لتفادي نمطِ الحارسِ | **مرفوضٌ**: نقلٌ للمشكلةِ — يُعمي الحارسَ لا يُرضيه. |
| **خطّافُ `onRequest` على الطلبِ غيرِ المطابِقِ (`request.is404`) فقط** | **المعتمدُ**: لا مسارَ يُسجَّلُ ولا صلاحيّةَ تُخترعُ؛ يُسجَّلُ **بعدَ** خطّافِ هويّةِ الخدمةِ، وذاك يفرضُ هويّةً مثبتةً على كلِّ مسارٍ غيرِ مسجَّلٍ (`packages/service-auth/src/fastify.ts` «مغلقٌ افتراضيًّا») — فالطلبُ غيرُ الموقَّعِ **401** قبلَ أن يعرفَ شيئًا. الخطّافُ لا يلمسُ المستودعَ. |

القيمُ: `/audit/events` ← `Allow: GET, HEAD, POST` (HEAD تلقائيٌّ من Fastify — مقيسٌ 200) · `/audit/events/:id` ← `Allow` **فارغٌ** (لا طريقةَ مخدومةً على حدثٍ مفردٍ؛ RFC 9110 §10.2.1 يجيزُه) وPOST عليه رفضٌ أيضًا (كتابةٌ موجّهةٌ إلى سجلٍّ قائمٍ). الجسمُ: `{ code: "AUDIT_METHOD_NOT_ALLOWED", message, trace_id }` (شكلُ الأخطاءِ الموحَّدُ). ما ليسَ تعديلًا يبقى 404 (`GET /audit/events/1` · `PUT /audit/other`).

## §3 الاختباراتُ (اختبارُ خدمةٍ فعليٌّ — Fastify `inject` على التطبيقِ الحقيقيِّ بهويّةِ خدمةٍ موقَّعةٍ)

| الحكمُ المطلوبُ | الاختبارُ | التوكيدُ |
|---|---|---|
| الحالةُ 405 + `Allow` على المجموعةِ (PUT/PATCH/DELETE) | [`audit-routes.test.ts`](../../../../services/audit/src/__tests__/http/audit-routes.test.ts) L220 (3 حالاتٍ) | `statusCode`=405 · `headers.allow`=`GET, HEAD, POST` · `code`=`AUDIT_METHOD_NOT_ALLOWED` · `trace_id` |
| الحالةُ 405 + `Allow` فارغٌ على الحدثِ (PUT/PATCH/DELETE/POST) | L231 (4 حالاتٍ) | 405 · `allow`=`""` · `code` |
| صدقُ `Allow` | L240 | GET 200 · HEAD 200 · POST 201 |
| **عدمُ تغيّرِ البياناتِ** | L250 | حدثانِ مزروعانِ · 7 محاولاتٍ بجسمِ تلاعبٍ كلُّها 405 · `repo.list` بعدَها `toEqual` نسخةً عميقةً قبلَها (`structuredClone` — لأنَّ المستودعَ في الذاكرةِ يُعيدُ كائناتٍ حيّةً) · الطولُ 2 · جسمُ `GET` مطابقٌ |
| الهويّةُ قبلَ الإفصاحِ | L284 | غيرُ موقَّعٍ → 401 · لا `Allow` |
| لا توسيعَ للرفضِ | L291 | `GET /audit/events/1` و`PUT /audit/other` → 404 بلا `Allow` |

النتيجةُ المحليةُ: **26/26** ([raw/unit-services-audit.txt](raw/unit-services-audit.txt)) — كانت 18 على الأساسِ: حُذفتْ 3 توكيداتِ 404 (السلوكُ تغيّرَ بقرارٍ، لا إضعافٌ) وأُضيفتْ 11.

**طفراتٌ مقيسةٌ (أُعيدَ الملفُّ بعدَها):** (أ) تعطيلُ الخطّافِ → 3+ إخفاقاتٍ · (ب) `Allow` خاطئٌ (`GET, POST, PUT`) → إخفاقٌ · (ج) خطّافٌ يُعدِّلُ حدثًا قبلَ الرفضِ → يُخفقُ «modification attempts leave the stored events unchanged». الاختبارُ يقبضُ على الانحرافِ لا على الاسمِ.

## §4 العقدُ والسجلّاتُ

- `services/audit/contracts/api.openapi.yml`: `put/patch/delete` على `/audit/events` و`/audit/events/{id}` (+`post`) بـ401/405 وترويسةِ `Allow` (`const`). تحقَّقَ التحليلُ بـ`openapi-typescript` 7.13.0.
- `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md` (جدولُ audit): صفُّ «لا مسارَ مسجَّلٌ — هويّةٌ مثبتةٌ ثمَّ 405». `validate-service-auth-coverage.sh`: جدولُ الصلاحيّاتِ مطابقٌ (2) · `validate-authz-policy.sh`: كلُّ الأبوابِ نجحت.
- `docs/12-testing/M3-04_GATE.md` UAT-08: إضافةٌ مؤرَّخةٌ (النصُّ القديمُ محفوظٌ).

## §5 حدودُ الدليلِ (لا يُدَّعى أوسعُ منها)

- المستودعُ المختبَرُ في الذاكرةِ؛ مستودعُ Drizzle/Postgres لا يُمارَسُ هنا — والخطّافُ لا يستدعي المستودعَ أصلًا، والمنفذُ `AuditRepository` لا يملكُ `update`/`delete`.
- اختبارُ Playwright `admin-portal/e2e/audit-rbac.spec.ts` محاكًى ويؤكّدُ غيابَ أزرارِ التعديلِ في الواجهةِ — **ليس** دليلَ تكاملٍ حيٍّ على 405 (اسمُه موضوعُ G-T1).
- لا نشرَ حيٌّ ولا قياسَ على staging (G6/G7 باقيانِ).
- RQ-ADM-28 يُحدَّثُ حكمُه بعدَ الدمجِ ونجاحِ CI على main فقط.

## §6 الحوكمةُ المحليةُ

على الأساسِ `343cf8a2` (pnpm 9.15.9 على PATH): `validate-state-sync.sh` PASS (بعدَ تصحيحِ حقلِ Risk إلى `none` بسببِه — أوّلُ تشغيلٍ رفضَ صيغةً غيرَ معتمدةٍ؛ عولجَ بالصيغةِ لا بإسكاتِ الفحصِ) · `validate-work-claims.sh` نجح · `require-doc-update.sh` OK · `verify-governance.sh` exit 0 + **تخطٍّ معلَنٌ واحدٌ: الفحصُ 8** (لقطةٌ مؤرَّخةٌ 2026-09-28T06:48:00Z). `tsc --noEmit` لـservices/audit: 0.

## §7 سندُ CI

يُسجَّلُ في تعليقاتِ PR ثمَّ في إغلاقٍ مؤرَّخٍ لاحقٍ.
