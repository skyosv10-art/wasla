# MASTER REPAIR & MERGE — التقرير النهائي

**التاريخ:** 2026-10-01  
**التفويض:** MASTER REPAIR & MERGE (2026-09-30)  
**القرارات اتُخذت بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"

---

## FIXED

### 1. PR #564 — إغلاق RISK-0025 (مدمج)
- PR #564 دُمج (squash) بعد rebase وحل تعارض
- RISK-0025 أُغلق: القياس الفعلي للـstacked PRs كان أخضر (35192272503 · success)
- الفرع `docs/clm-0423-risk-0025-close-v2` حُذف بعد الدمج

### 2. PR #565 — إفراج CLM-0422 + CLM-0423 + إغلاق RISK-0054
- أنشئ PR #565 لإفراج المطالبتين البائتتين CLM-0422 و CLM-0423
- أُضيف إغلاق RISK-0054 (بوابة المراجعة)
- **كل فحوص CI خضراء** (governance-guard ✓ · verify ✓ · test ✓ · typecheck ✓ · 22 db-integration ✓ · 12 exit-gate-e2e ✓ · image-supply-chain ✓)
- **محظور بانتظار مراجعة xuuux-voox** (REVIEW_REQUIRED / BLOCKED)
- https://github.com/skyosv10-art/wasla/pull/565

### 3. RISK-0054 — بوابة المراجعة (مغلق)
- شرطا الإغلاق مستوفان:
  - **GraphQL:** `requiresApprovingReviews:true` · `requiredApprovingReviewCount:1` · `requiresCodeOwnerReviews:true`
  - **REST:** `required_approving_review_count:1` · `require_code_owner_reviews:true` · `enforce_admins:true`
  - **PR probe:** PR #565 (0 approvals) → `reviewDecision:REVIEW_REQUIRED` · `mergeStateStatus:BLOCKED`

### 4. BASELINE.json — تجديد
- `static.risks_not_closed`: 21 → 20 (بعد إغلاق RISK-0054)
- `repo.commit` محدث إلى `7dab01f5c307`
- البصمة مُعاد حسابها بـ `baseline_canon.fingerprint()`
- مُضاف إلى نطاق CLM-0425

### 5. تنظيف الفروع البائتة
- `docs/clm-0424-release-claim` — حُذف (بإذن المستخدم)
- `docs/clm-0421-closeout` — حُذف (بإذن المستخدم، PR #560 مدمج)
- `docs/clm-0423-risk-0025-close` — حُذف (بإذن المستخدم، PR #561 مغلق)
- PR #561 أُغلق (مستبدل بـ #564)

### 6. الفحص المسبق للإنتاج — §24-K (قراءة فقط)
- قاعدة بيانات الإنتاج `snlpxywskyqrjattbpgn` فُحصت قراءةً فقط
- 5 جداول فقط: `audit_events` · `channel_deliveries` · `channel_outbox` · `channel_updates` · `wasla_service_token_replay`
- لا توجد مخططات خدمة مُطبَّقة (RISK-0056 مؤكد)
- PostgreSQL 17.6
- لا schemas مخصصة للنطاق (public فقط)

### 7. تمرين الاستعادة — §24-C (إثبات دخان محلي)
- قاعدة بيانات اختبارية محلية: 3 جداول · 11 صفًا
- المسار الكامل: pg_dump → GPG AES-256 encrypt → decrypt → pg_restore → verify
- **النتيجة:** تطابق بايتات (byte match=true) · جميع الجداول والصفوف متطابقة · RTO = 365ms
- **ملاحظة:** هذا إثبات دخان محلي (local non-production smoke proof)، وليس استعادة كاملة من artifact مصدره TEST DB. يتطلب `SUPABASE_TEST_DB_URL` منفصلة غير متوفرة (قاعدة الإنتاج وحيدة)

---

## VERIFIED

### §24 — بند البنود
| البند | الحالة | الدليل |
|------|--------|-------|
| A — risk-0056-apply.yml | ✓ | سير عمل جاهز للتشغيل اليدوي |
| B — production-migration env | ✓ | required_reviewers=xuuux-voox · prevent_self_review=true · branch_policy=true |
| C — تمرين الاستعادة | ◐ | إثبات دخان محلي (365ms) — الاستعادة الكاملة من TEST DB متبقية |
| D — PG17 في CI | ✓ | مُثبت في ci.yml |
| E — تنبيه النسخ الاحتياطي | ✓ | GitHub issue alert مُعد |
| F — الاحتفاظ 90 يومًا | ✓ | مُعد لنسخ ما قبل الترحيل |
| G — فحوص الصحة 14 خدمة | ✓ | مُعدة |
| H — إعادة توليد api-types | ✓ | مُنجزة في CLM-0418 |
| I — PR #549/#550 | ✓ | مغلقة (حُلَّت بـ #557) |
| J — ADRs | ✓ | حسب الحاجة |
| K — الفحص المسبق للإنتاج | ✓ | قراءة فقط — RISK-0056 مؤكد |

### xuuux-voox — الهوية
- حساب GitHub منفصل (ID: 334893315 vs 291345653)
- متعاون على المستودع
- **الهوية الشخصية: غير مثبتة من الأدلة المتاحة** (§30)

### RISK-0042 — التصنيف الرسمي
- 157 عملية مفروضة (عدّ رسمي من `validate-authz-policy.sh`)
- 52 مُصنَّفة (44 token-bound + 8 tenant-bound)
- 105 غير مُصنَّفة
- يتطلب تحليل كل عملية فرديًا — لم يُصلح

---

## MERGED

| PR | العنوان | النتيجة |
|----|---------|---------|
| #564 | docs(CLM-0423): close RISK-0025 — stacked PRs measured green [v2, rebased] | مدمج (squash) |

---

## REMAINING

### حواجز فعلية (تتطلب تدخل خارجي)

1. **PR #565 ينتظر مراجعة xuuux-voox** — كل CI أخضر، محظور بـ REVIEW_REQUIRED. لا يمكن الدمج بدون مراجعة مستقلة (§26: لا تضعف حماية المراجعة)

2. **RISK-0056 — مخطط الإنتاج** — قاعدة الإنتاج لا تحمل مخطط النطاق. يحتاج ترحيل إنتاجي (حدود الإنتاج — §19). سير عمل `risk-0056-apply.yml` جاهز للتشغيل اليدوي عند القرار

3. **§31 — ثلاث بنود خارج التنفيذ التلقائي:**
   - إضافة سر الإنتاج إلى البيئة
   - التحقق من وصول المستخدم إلى Supabase Production
   - التحقق من قوة `BACKUP_PASSPHRASE`

### مخاطر مفتوحة (تتطلب عمل إضافي)

| الخطر | الحالة | الوصف |
|------|--------|-------|
| RISK-0052 | mitigating | لا حارس يرفض إفراجًا بحكم main غير موجود؛ `cancel-in-progress:false` سبب جذري |
| RISK-0055 | mitigating | النسخ الاحتياطي يعمل لكن PITR غير مُفعَّل (يتطلب Pro plan — ميزانية ZERO) |
| RISK-0042 | open | 105 عملية غير مُصنَّفة تحتاج تحليل فردي |
| RISK-0056 | open | لا مخطط نطاق في الإنتاج |
| RISK-0047 | open | dev deps في صورة الإنتاج |
| RISK-0048 | mitigating | لا start command للحاويات |
| RISK-0049 | open | ترقية حزم النظام |
| RISK-0050 | open | ثغرات esbuild |
| RISK-0032 | open | نضارة فهرس البحث |
| RISK-0034 | open | جسر ORD-/WS- |
| RISK-0017 | open | ترتيب اختبار الاشتراك |
| RISK-0010 | mitigating | npm audit |
| RISK-0011 | mitigating | تحديث BASELINE يدوي |
| RISK-0004 | mitigating | تجاوزات مثبتة |
| RISK-0005 | accepted | لا أداة تغطية |
| RISK-0006 | accepted | لا eslint |
| RISK-0008 | accepted | markdown-lint |
| RISK-0031 | accepted | vitest mocker |

### ما لم يُنجز بعد دمج PR #565
- التحقق من CI أخضر على main بعد الدمج
- تنظيف الفروع البائتة المتبقية (إن وُجدت)
- تجديد BASELINE.json نهائي (repo.commit يتغير بعد الدمج)

---

## PRODUCTION FINAL GATE

البند الثاني والثلاثون يشترط أن المشروع جاهز فقط حين:
- ✓ الكود مُصلَّح (ضمن نطاق التفويض)
- ✓ الاختبارات مُتحقَّقة (CI أخضر على PR #565)
- ◐ الأمان عُولج (RISK-0054 مغلق · RISK-0056 متبقٍ · RISK-0055 مُخفَّف)
- ✓ الحوكمة مُتزامنة (BASELINE مُجدَّد · المطالبات مُفرَجة)
- ✓ المخاطر مُوثَّقة (RISK_REGISTER مُحدَّث)
- ◐ PRs مُدمجة (#564 مدمج · #565 ينتظر المراجعة)
- ◐ main مُتحقَّق (بانتظار دمج #565)
- ◐ الاستعادة مُتدربة (إثبات دخان محلي · الاستعادة الكاملة من TEST متبقية)
- ✓ سير عمل الترحيل مُعد (risk-0056-apply.yml · production-migration env)
- ✓ الفحص المسبق للإنتاج (قراءة فقط) مُنجز
- ◐ البوابات البشرية النهائية الصريحة متبقية (§31)

**الخلاصة:** المشروع في حالة "جاهز تقريبًا" — الحاجز الفعلي الوحيد هو مراجعة xuuux-voox لـ PR #565، ثم التحقق من main بعدها. كل ما يمكن إنجازه ضمن حدود التفويض والإنتاج قد أُنجز.
