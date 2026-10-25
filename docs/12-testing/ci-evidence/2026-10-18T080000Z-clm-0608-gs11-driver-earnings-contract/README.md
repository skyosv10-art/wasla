# CLM-0608 — G-S11: عقدُ أرباحِ السائقِ — القياسُ ثمَّ تحديثُ المواصفةِ

**الحجزُ:** CLM-0608 · **العنصرُ:** M0-53 · **الأساسُ:** `dd5eb7efa91bbdd4a61c16221cbc88847b7cd96c` (main بعدَ دمجِ #758 / CLM-0607 — أُعيدَ التأسيسُ عليه) · **التفويضُ:** «افحص عقد GET /orders/drivers/:driverPublicId/jobs … إذا تأكد أنه عقد التنفيذ المعتمد، حدّث مواصفة السائق وإحالات السجل بدل استبدال المسار في الكود بلا مبرر.» — لا كودَ يتغيّرُ هنا.

## §1 القياسُ — هل هو العقدُ المعتمدُ؟

| السؤالُ | القياسُ | المصدرُ |
|---|---|---|
| منشورٌ في العقدِ؟ | نعم — `operationId: listDriverJobs` · `period` required enum `[today, week, month]` · `security: orders:driver-jobs:read` | `services/orders/contracts/api.openapi.yml` L178-215 |
| في مصفوفةِ التفويضِ؟ | نعم — `{ audience: "orders", method: "GET", path: "/orders/drivers/:driverPublicId/jobs", scopes: ["orders:driver-jobs:read"] }` | `packages/authz-policy/src/operations.ts` L227 |
| في سجلِّ فرضِ المصادقةِ؟ | نعم — المُنادي: driver-mini-app | `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md` L868 |
| الصلاحيّةُ والملكيّةُ | `ownerScoped(ORDER_SCOPES.driverJobsRead)` · `obo` في الرمزِ يجبُ أن يساويَ `:driverPublicId` وإلا **404** (لا كاشفَ وجودٍ) · شكلُ `WS-##########` يُتحقَّقُ | `services/orders/src/http/app.ts` L416-476 |
| التطبيقُ يناديه؟ | نعم — `/orders/drivers/${driverId}/jobs?status=completed&period=…` | `apps/driver-mini-app/src/store/earnings.ts` L73 |
| اختباراتُ الخدمةِ | 5: قائمةٌ فارغةٌ · مُنتفِعٌ آخرُ → 404 · غيرُ موقَّعٍ → 401 · شكلُ المعرّفِ · مهمّةٌ مكتملةٌ (`status`=completed · `completed_at`) | `services/orders/src/__tests__/http/driver-jobs.test.ts` L41 · L53 · L66 · L75 · L87 |
| هل يصلحُ `/orders/lookup` بديلًا؟ | **لا** — يقبلُ `order_public_id` فقط (L363 · العقدُ L160)؛ لا فلترةَ بالسائقِ ولا قائمةَ | `app.ts` L16 · L363 |

**الحكمُ:** المسارُ المنفَّذُ هو العقدُ المعتمدُ (منشورٌ · محروسٌ · مقيَّدٌ بالمالكِ · مُختبَرٌ). نصُّ DMS هو المتقادمُ → حُدِّثَ DMS §4.5 L149 و§5 L236 **بإضافةٍ مؤرَّخةٍ تحفظُ النصَّ السابقَ**، ولم يُستبدلِ المسارُ في الكودِ.

## §2 التغييراتُ

- `docs/01-product/DRIVER_MINI_APP_SPEC.md` §4.5 و§5 (جدولُ الطلباتِ): المسارُ والصلاحيّةُ `orders:driver-jobs:read` (كان `orders:read`).
- `REQUIREMENTS_REGISTRY.md`: ملاحظةٌ مؤرَّخةٌ على RQ-DMA-33 وG-S11 (لا إغلاقَ) · **G-S13** جديدةٌ.

## §3 انحرافٌ مقيسٌ جديدٌ — G-S13 (لا يُصلَحُ هنا)

مِسبارٌ مؤقّتٌ على harness الخدمةِ الحقيقيِّ ([raw/probe-driver-jobs.txt](raw/probe-driver-jobs.txt) — حُذفَ الملفُّ بعدَ التشغيلِ):

1. `?status=completed` **يُتجاهَلُ**: سائقٌ بمهمّةٍ `driver_cancelled` يتلقّاها (200). العقدُ لا يعلنُ `status` ويصفُ «مكتملًا أو ملغى» — فالخدمةُ تطابقُ عقدَها، **والتطبيقُ** يفترضُ فلترًا غيرَ موجودٍ.
2. `computeSummary` (`earnings.ts` L31-51) يعدُّ كلَّ المهامِّ في `job_count` ويجمعُ `agreed_price` لكلِّها — فقد تدخلُ أسعارُ الملغاةِ في «أرباحي» (المِسبارُ لم يُثبتْ مبلغًا: `agreed_price` = null في harness؛ الأثرُ في العدِّ مثبتٌ منطقيًّا من الشفرةِ).
3. `period=decade` → **200** (يُعامَلُ `today`) بينما العقدُ `required enum` — لا 400.
4. لا اختبارَ لاستبعادِ الملغى ولا لحدودِ `week`/`month`/`today`.

القرارُ التقنيُّ (أين يُفلتَرُ: في التطبيقِ أم بإعلانِ `status` في العقدِ والخدمةِ) يُتّخذُ في شريحةِ G-S13 المستقلةِ.

## §4 الحوكمةُ (الأساسُ `dd5eb7ef` · pnpm على PATH)

الفحوصُ الأربعةُ exit 0 · `verify-governance.sh` + **تخطٍّ معلَنٌ: الفحصُ 8** (لقطةٌ مؤرَّخةٌ 2026-09-28T06:48:00Z). وثائقُ فقط ← لا نشرَ.

## §5 الإغلاقُ

G-S11 وRQ-DMA-33 مفتوحانِ حتى الدمجِ ونجاحِ CI على main.
