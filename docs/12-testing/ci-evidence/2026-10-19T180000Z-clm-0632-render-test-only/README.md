# CLM-0632 — Render للاختباراتِ فقط: إيقافُ النشرِ التلقائيِّ، تجميدُ هدفٍ غيرِ معزولٍ، فحصُ عزلٍ

**الحجزُ:** CLM-0632 · **العنصرُ:** M6-18B · **القرارُ:** [ADR-073](../../../15-decisions/ADR-073-render-test-environment-only.md) (قرارُ المالكِ 2026-10-19) · **main المرجعيُّ:** `f64d4228`

## 1. قرارُ المالك (مقتبسٌ)

«Render للاختبارات فقط — لا إنفاق ولا نشر إنتاجي … أوقف النشر التلقائي إلى بيئة Render الحالية بوصفه مسارًا للإنتاج، مع إبقاء الاختبارات البرمجية والحوكمة فعالة … لا تصف البيئة بأنها اختبارية آمنة قبل إثبات العزل.»

## 2. قياسُ العزلِ (بلا قيمٍ سرّيّةٍ — [raw/isolation-render-2026-10-19.json](raw/isolation-render-2026-10-19.json))

| البند | المقيس |
|---|---|
| مجموعةُ متغيّراتٍ | `wasla-prod-db` مربوطةٌ بـ17 خدمةً (كلُّ خدماتِ الويبِ المجاليّةِ والبوتاتِ الثلاثة)؛ غيرُ مربوطةٍ: 3 مواقعَ ثابتةٍ + 4 خدماتِ رصدٍ |
| قاعدةُ البيانات | `DATABASE_URL` و`CUSTOMER_DATABASE_URL` ← Supabase pooler ap-south-1 · المشروعُ `wasla` (`ppixaauyqoykrogwdxtv`) — **«production» في HA_CAPACITY_DR.md** · الدورُ `postgres` نفسُه للجميع |
| محتواها | 120 جدولًا، 13 غيرُ فارغٍ، **41 صفًّا حيًّا**: إعداداتٌ/بذورٌ + `audit_events` 10 + قنواتٌ 7 + `wasla_service_token_replay` 1 — لا عميلَ ولا طلبَ ولا سائقَ (`pg_stat_user_tables`) |
| مشروعُ الاستعادة | `wasla-dr-replacement` (`pvyuhjadrygqqdoczmnd`) INACTIVE، غيرُ مربوطٍ |
| رموزُ البوتات | الأربعةُ تطابقُ رموزَ الاختبارِ التي زوّدَ بها المالكُ (مقارنةُ بصمةٍ في الذاكرة) |
| `NODE_ENV` | `staging` × 17 · `production` × 1 (`wasla-observability`) |
| مفاتيحُ التوقيع | `WASLA_USER_ASSERTION_*` و`WASLA_SERVICE_AUTH_*` — المجموعةُ الوحيدةُ الموجودةُ؛ لا مجموعةَ إنتاجٍ يُقارَنُ بها |
| الخطط | 21 `free` + 3 مواقعَ ثابتةٍ · `autoDeploy=no` × 24 |

**الحكم:** غيرُ معزولةٍ → لا تُوصَفُ «اختباريّةً آمنةً» → [RISK-0069](../../../07-security/RISK_REGISTER.md) مفتوحٌ.

## 3. التغيير

| الملفّ | التغيير |
|---|---|
| `.github/workflows/render-deploy.yml` | لا `push`؛ `workflow_dispatch` فقط بـ`sha` و`purpose` و`confirm` إلزاميّةٍ؛ خطوةٌ ترفضُ ما لم يكن `confirm=test-only`، وتمرّرُ `RENDER_DEPLOY_INTENT`؛ لا قيمةَ افتراضيّةَ `github.sha` |
| `infra/render/deploy-target.json` | `mode=frozen` · `owner_id=null` · `environment=test` · `production_database_refs=[ppixaauyqoykrogwdxtv]` · `test_workspace` للمرجع |
| `scripts/deploy/render-sync.py` | وضعُ deploy يشترطُ `environment=test` و`production_database_refs`؛ النشرُ يشترطُ `RENDER_DEPLOY_INTENT=test-only` و`RENDER_DEPLOY_PURPOSE` **قبلَ أيِّ نداءٍ**؛ فحصُ عزلٍ على المساحةِ كلِّها قبلَ التخطيطِ: مجموعةٌ مربوطةٌ اسمُها يحوي `prod`، أو مفتاحُ `*DATABASE_URL` (مقروءٌ **بالاسمِ**) يشيرُ إلى مشروعِ إنتاجٍ ← رفضٌ؛ القيمُ لا تُطبَعُ ولا تُكتَب؛ `environment` و`isolation_findings` في `render-sync.json` |
| `scripts/checks/validate-render-deploy-target.sh` | القواعدُ 5–7 + 15 طفرةً جديدةً (المجموعُ 21) |
| `scripts/checks/validate-render-deploy-plan.sh` | قاعدةُ «كلِّ push» (CLM-0626) استُبدلت بـ«لا push/schedule/PR/workflow_run»، والطفرةُ المقابلةُ |
| `scripts/checks/validate-workflow-supply-chain.sh` | وصفُ `render-deploy.yml` في الجرد — تحتَ حجزٍ ثانٍ **CLM-0633**: الملفُّ عُدِّلَ قبلَ حجزِه ورفضَه فحصُ الحجوزات (خارجَ نطاقِ CLM-0632)، فسُجِّلَ الحجزُ الثاني قبلَ الدفعِ بدلَ توسيعِ الأوّلِ (WORK_CLAIM_RULE §6) |

## 4. الاختبارات — كلُّ حالةٍ بنتيجتِها الفعليّة

[raw/validate-render-deploy-target.txt](raw/validate-render-deploy-target.txt) — **21/21** طفرةً ملتقطةً، كلٌّ بقاعدتِه. الجديدةُ:

| الطفرة | التقطَها |
|---|---|
| الهدفُ يفقدُ `environment=test` | قاعدةُ 5 (الملفّ) |
| الهدفُ يفقدُ `production_database_refs` | قاعدةُ 5 |
| عودةُ `push` | قاعدةُ 6 — `got ['push', 'workflow_dispatch']` |
| إضافةُ `schedule` | قاعدةُ 6 |
| إزالةُ بوّابةِ `confirm` | قاعدةُ 6 |
| `purpose` اختياريٌّ | قاعدةُ 6 |
| الهدفُ يعودُ افتراضيًّا إلى الالتزامِ المدفوع | قاعدةُ 6 |
| `render-sync` يقبلُ `environment=production` | قاعدةُ 5 (سلوكيٌّ: الاستيرادُ يجبُ أن يرفض) |
| إزالةُ فحصِ النيّة | قاعدةُ 6 (سلوكيٌّ بـAPI مزيّفٍ: 12 نداءً بدلَ 0) |
| العزلُ يتجاهلُ المجموعاتِ المسمّاةَ إنتاجًا | قاعدةُ 7 (حالةُ وحدةٍ) |
| العزلُ يتجاهلُ `DATABASE_URL` الخدمة | قاعدةُ 7 |
| النتيجةُ تطبعُ القيمة | قاعدةُ 7 (تسرُّبٌ) |
| النتائجُ لا توقفُ النشر | قاعدةُ 7 (API مزيّفٌ: التشغيلُ تجاوزَ الحارس) |
| حذفُ الفحصِ من مسارِ النشر | قاعدةُ 7 |
| العزلُ يقرأُ قائمةَ المتغيّرات | قاعدةُ 7 |

حالاتُ الوحدةِ (الخمس): مجموعةٌ إنتاجيّةُ الاسمِ مربوطةٌ ← نتيجة؛ `DATABASE_URL` مجموعةٍ على الإنتاجِ ← نتيجة؛ `ORDER_DATABASE_URL` خدمةٍ على الإنتاجِ ← نتيجة؛ مشروعُ اختبارٍ منفصلٌ ← لا نتيجة؛ مجموعةٌ إنتاجيّةُ الاسمِ غيرُ مربوطةٍ ← لا نتيجة.

[raw/validate-render-deploy-plan.txt](raw/validate-render-deploy-plan.txt) — حالاتُ الخطّةِ الانتقائيّةِ كما في CLM-0630 + الطفرةُ «workflow deploys on every push again» ملتقطةٌ بالربط.

## 4b. قرارٌ مكتوبٌ: إعادةُ توليدِ الأساسِ (M0-08)

فتحُ RISK-0069 غيّرَ `risks_not_closed` من 24 إلى 25 فأخفقَ الفحصُ 11. أُعيدَ توليدُ `docs/12-testing/BASELINE.json/txt` بـ`scripts/baseline.sh --log` على سجلِّ التحقّقِ نفسِه الذي استعملَه CLM-0624 (العدّاداتُ الحركيّةُ مصدرُها مُسمّى في الملفِّ، لم تُقَس من جديد). الفرقُ المقيسُ: `risks_not_closed` 24→25 والبصمةُ والالتزامُ والفرعُ و`tracked_files` و`generated_at` فقط.

## 5. حدودٌ مصرَّحٌ بها

- فحصُ العزلِ يرى مفاتيحَ `*DATABASE_URL` المعروفةَ بالاسمِ ومجموعاتِ Render المربوطة؛ لا يرى اتصالًا تحتَ اسمٍ آخرَ ولا ملفّاتٍ سرّيّةً (0 اليوم) ولا إعادةَ استعمالِ أسرارٍ (لا مجموعةَ إنتاجٍ بعد).
- اسمُ المجموعةِ قاعدةٌ اصطلاحيّةٌ (`prod`)؛ الحكمُ الجوهريُّ مقارنةُ مرجعِ المشروع.
- `service-health.yml` المجدولُ يقرأُ `/health` بلا مفتاحٍ ولا بناء — لم يُغيَّر.

## 6. الحالاتُ — دون تغيير

G-S9 مفتوحةٌ · M0-53 In Progress · M6-18B Blocked · CLM-0622 غيرُ منشورٍ · RISK-0068 `open` (أُعيدَ تأطيرُه) · RISK-0066 `open` (شرطُه القديمُ لم يَعُد مسارًا) · RISK-0069 `open` (جديد) · حكمُ الإطلاقِ دونَ تغيير. لا إنفاقَ ولا تغييرَ خطّةٍ ولا حسابَ جديدٌ ولا نشرَ. [تقريرُ حالةِ المنتج](../../../16-progress/PRODUCT_STATUS_2026-10-19.md) · [خطّةُ موارد الاختبار](../../../08-infrastructure/RENDER_TEST_ENVIRONMENT_PLAN.md).
