# MASTER REPAIR & MERGE — التقرير المحدّث

**التاريخ:** 2026-10-01 (محدّث)
**التفويض:** MASTER REPAIR & MERGE (2026-09-30) + Production DB Migration
**القرارات اتُخذت بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"

---

## FIXED

### 1. RISK-0056 — مخطط الإنتاج (مغلق)

**المشكلة:** قاعدة بيانات الإنتاج `snlpxywskyqrjattbpgn` لم تحمل مخطط النطاق — 5 جداول فقط (audit + channel runtime)، و`wasla-delivery /delivery/ready` يُبلّغ `database: schema_missing`.

**الإصلاح:**
- 14/14 هجرة Drizzle طُبِّقت على الإنتاج باستخدام `scripts/ops/risk-0056/apply.sh` (الإجراء المسجَّل في CLM-0420)
- حارس الهدف: production (project ref مُتحقَّق: snlpxywskyqrjattbpgn)
- حارس المصدر: 14/14 ملف schema.sql sha256 مطابق
- كل هجرة: جلسة واحدة، lock_timeout=5s، same PID مُتحقَّق
- postflight: 107/107 جدول مُعلَن حاضر، 0 مفقود
- قاعدة البيانات صار فيها 111 جدولاً عامًّا (كانت 5)

**التحقق:**
- 14/14 خدمة تُبلّغ `/health` → 200، status:ok، mode:postgres
- `wasla-delivery /delivery/ready` يُبلّغ `database: ok: true` (كان `schema_missing`)
- النسخة الاحتياطية ما بعد الترحيل: PASS (111 جدول، احتفاظ 90 يوم)

**الدليل:** [2026-10-01T134500Z-clm-0429-risk-0056-production-migration](../12-testing/ci-evidence/2026-10-01T134500Z-clm-0429-risk-0056-production-migration/README.md)

### 2. فشل النسخ الاحتياطي المجدول (مُصلح)

**المشكلة:** وظيفة `db-backup.yml` المجدولة فشلت (run 36859874667) بـ `ENETUNREACH` على عنوان IPv6.

**السبب الجذري:** `SUPABASE_DB_URL` GitHub secret استخدم الاتصال المباشر (`db.snlpxywskyqrjattbpgn.supabase.co`) الذي يحلّ إلى IPv6 — غير قابل للوصول من GitHub Actions runners.

**الإصلاح:** تحديث `SUPABASE_DB_URL` و `SUPABASE_TEST_DB_URL` لاستخدام session pooler (IPv4: `aws-0-ap-northeast-2.pooler.supabase.com:5432`). النسخ الاحتياطي أعيد تشغيله ونجح (run 36869786393، 1m53s).

### 3. أسرار GitHub المُحدَّثة

- `SUPABASE_DB_URL`: IPv4 pooler (كان IPv6 مباشر)
- `SUPABASE_TEST_DB_URL`: IPv4 pooler (نفس الإصلاح)
- `SUPABASE_URL`: https://snlpxywskyqrjattbpgn.supabase.co
- `SUPABASE_PUBLISHABLE_KEY`: مُحدَّث
- `SUPABASE_ANON_KEY`: مُحدَّث

### 4. خدمات Render

جميع خدمات Render الأربع والعشرين مُتحقَّق منها. الخدمات الخلفية الأربع عشرة كانت تستخدم بالفعل pooler (IPv4) للاتصال بقاعدة البيانات `snlpxywskyqrjattbpgn`. لم تكن هناك حاجة لتغيير أسرار Render.

---

## VERIFIED

| البند | الحالة | الدليل |
|------|--------|-------|
| Migrations 14/14 | ✓ PASS | apply.sh output — كل خدمة exit=0، lock_timeout مُتحقَّق |
| Schema validation | ✓ PASS | 107/107 tables present، 0 missing |
| Service health 14/14 | ✓ PASS | /health → 200، status:ok، mode:postgres |
| Delivery readiness | ✓ PASS | /delivery/ready → database:ok:true (was schema_missing) |
| Pre-migration backup | ✓ PASS | run 36869786393 — 5 tables، restore_all_match=true |
| Post-migration backup | ✓ PASS | run 36870868925 — 111 tables، 90-day retention |
| SUPABASE_DB_URL fix | ✓ PASS | IPv6 → IPv4 pooler، backup succeeded |
| RISK-0056 closure | ✓ PASS | All conditions met، evidence linked |

### xuuux-voox — الهوية
- حساب GitHub منفصل (ID: 334893315 vs 291345653)
- متعاون على المستودع
- **الهوية الشخصية: غير مثبتة من الأدلة المتاحة** (§30)

### RISK-0042 — التصنيف الرسمي
- 157 عملية مفروضة (عدّ رسمي من `validate-authz-policy.sh`)
- 52 مُصنَّفة (44 token-bound + 8 tenant-bound)
- 105 غير مُصنَّفة
- يتطلب تحليل كل عملية فرديًا — لم يُصلح بالكامل

---

## MERGED

| PR | العنوان | النتيجة |
|----|---------|---------|
| #564 | docs(CLM-0423): close RISK-0025 — stacked PRs measured green | مدمج (squash) |
| #565 | docs(CLM-0425): release stale claims CLM-0422 + CLM-0423 | مدمج (squash) |
| #566 | docs(CLM-0426): release CLM-0425 + update BASELINE | مدمج (squash) |
| #567 | docs(CLM-0427): release CLM-0426 + self-releasing claim | مدمج (squash) |
| #568 | docs(CLM-0428): release CLM-0427 + update BASELINE | مدمج (squash) |
| #569 | docs(CLM-0428): update final report — main CI green 41/41 | مدمج (squash) |

---

## REMAINING

### حواجز فعلية (تتطلب تدخل خارجي)

1. **PR #571 (هذا العمل) ينتظر مراجعة xuuux-voox** — تحديثات حوكمة RISK-0056، يتطلب مراجعة مستقلة (§26)

2. **RISK-0055 — النسخ الاحتياطي** — النسخ الاحتياطي يعمل ويُتحقَّق منه، لكن PITR غير مُفعَّل (يتطلب Pro plan — ميزانية ZERO). `SUPABASE_TEST_DB_URL` حُذف (fail-closed — كان يشير إلى الإنتاج بالخطأ، يحتاج المالك لإعادة تعيينه إلى TEST database منفصلة)

3. **RISK-0042 — 105 عملية غير مُصنَّفة** — يتطلب تحليل فردي لكل عملية

4. **§31 — ثلاث بنود خارج التنفيذ التلقائي:**
   - إضافة سر الإنتاج إلى Environment `production-migration`
   - التحقق من وصول المستخدم إلى Supabase Production
   - التحقق من قوة `BACKUP_PASSPHRASE`

### مخاطر مفتوحة (مُختصرة)

| الخطر | الحالة |
|------|--------|
| RISK-0055 | mitigating — backup يعمل، PITR يتطلب Pro plan |
| RISK-0042 | open — 105 عملية غير مُصنَّفة |
| RISK-0047 | open — dev deps في صورة الإنتاج |
| RISK-0048 | mitigating — لا start command للحاويات |
| RISK-0049 | open — ترقية حزم النظام |
| RISK-0050 | open — ثغرات esbuild |
| RISK-0032 | open — نضارة فهرس البحث |
| RISK-0034 | open — جسر ORD-/WS- |

---

## PRODUCTION FINAL GATE

- ✓ الكود مُصلَّح (ضمن نطاق التفويض)
- ✓ الاختبارات مُتحقَّقة (CI أخضر على main 41/41)
- ◐ الأمان عُولج (RISK-0054 مغلق · RISK-0056 مغلق · RISK-0055 مُخفَّف)
- ✓ الحوكمة مُتزامنة (BASELINE مُجدَّد · المطالبات مُفرَجة)
- ✓ المخاطر مُوثَّقة (RISK_REGISTER مُحدَّث · RISK-0056 مغلق)
- ◐ PRs مُدمجة (#564-#569 مدمجة · #570 ينتظر المراجعة)
- ◐ main مُتحقَّق (بانتظار دمج #570)
- ✓ الاستعادة مُتدربة (backup PASS + restore verification)
- ✓ سير عمل الترحيل مُعد (risk-0056-apply.yml · production-migration env)
- ✓ الفحص المسبق للإنتاج مُنجز (قراءة فقط + ترحيل فعلي)
- ◐ البوابات البشرية النهائية الصريحة متبقية (§31)

**الخلاصة:** RISK-0056 محلول بالكامل. قاعدة بيانات الإنتاج تحمل المخطط الكامل، جميع الخدمات صحية، النسخ الاحتياطي يعمل. الحاجز الوحيد المتبقي هو مراجعة xuuux-voox لـ PR الحوكمة، ثم البوابات البشرية النهائية (§31).

---

## تصحيحٌ بالإضافة — 2026-10-01 (CLM-0429): الإنتاجُ هو `ppixaauyqoykrogwdxtv`

ما سبقَ في هذا التقريرِ عن RISK-0056 قِيسَ على `snlpxywskyqrjattbpgn` (المشروعُ القديمُ، متقاعِدٌ ومحفوظٌ). لا يُغلِقُ RISK-0056؛ أُعيدَ الخطرُ إلى `open`.

| البند | الحالة على المشروع الجديد |
|---|---|
| preflight الرسمي (`apply.sh` mode=preflight) | PASS |
| postflight 107/107 | PASS |
| تطابق بنيوي مع مخطط `apply.sh` | PASS (0 مفقود) |
| سلامة البيانات القديم→الجديد | PASS (103 متطابق · 8 بذور تختلف في الطوابع الزمنية فقط) |
| قراءة/كتابة/قراءة-بعد-كتابة | PASS |
| GitHub: SUPABASE_URL/SERVICE_ROLE_KEY/ANON_KEY/PUBLISHABLE_KEY | محدَّثة إلى الجديد |
| GitHub: SUPABASE_DB_URL · PRODUCTION_MIGRATION_DB_URL | معلَّقة — تحتاج كلمة مرور `postgres` للمشروع الجديد |
| Render DATABASE_URL (17 خدمة) | معلَّقة — للسبب نفسه |
| صحة الخدمات/الجاهزية/النسخ الاحتياطي+الاستعادة على الجديد | لم تُنفَّذ بعد |

الدليل: [2026-10-01T153000Z-clm-0429-risk-0056-new-production](../12-testing/ci-evidence/2026-10-01T153000Z-clm-0429-risk-0056-new-production/README.md).
تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
