# RISK-0056 · CLM-0413 r2 — إغلاق ملاحظات المالك على تقرير الجاهزية

**العنصر:** M6-18B (يبقى Blocked) · **الخطر:** RISK-0056 (يبقى مفتوحاً) · **الفرع:** `ops/risk-0056-readiness-report` · **PR:** #550 (غير مدموج)
**الإنتاج:** لم يُلمس. لا ترحيل، لا DDL، لا DML، لا تغيير في Render، لا تغيير في إعدادات Supabase.
**التشغيل الوحيد:** run [36665158123](https://github.com/skyosv10-art/wasla/actions/runs/36665158123) على قاعدة **الاختبار** `obeptvwpvqbduwkahorq` فقط، بإذن المالك الصريح في 2026-09-30 06:36 +03. المقتطف: [`run-36665158123-excerpt.txt`](run-36665158123-excerpt.txt).

هذه الوثيقة **تُصحّح بالإضافة** تقرير r1 ([`../2026-09-30T023500Z-risk-0056-readiness-report/README.md`](../2026-09-30T023500Z-risk-0056-readiness-report/README.md)). حيث يتعارضان فالحكم لـ r2. الأقسام التي أُبطلت في r1: §1.1 (SHA مختصر)، §1.7 (lock_timeout عبر psql منفصل أو PGOPTIONS — **كان خطأ**)، §2.2 البند 5 (الاعتماد على `restore_all_match` في الـmanifest — **لا يعمل**)، §3 (اختبارات بلا مصادقة ولا جدول)، §5.4 (RPO ≈ 0 وRTO < 1 دقيقة — **صياغة خاطئة**)، §6.1 و§6.2 و§6.4 و§6.5 (التشغيل من فرع دون main، وأن governance-guard لا يعني workflow_dispatch — **خطأ**)، وجدول §10.

---

## 1. المصدر: SHA كامل وبصمات schema.sql

- **الالتزام المستهدف:** `bc5de79e8901523ae400187f95c1824a3c7a013d` (رأس `main` عند كتابة هذا، ولم يتحرك منذ #548).
- **ما اختُبر على قاعدة الاختبار:** run 36652155317 على `383eb8ee364c89995259c2084dfe5e49274883af` (CLM-0410).
- **مقارنة sha256** للملفات الأربعة عشر بين الالتزامين: متطابقة 14/14. البصمات مثبّتة في [`scripts/ops/risk-0056/schema-sha256.txt`](../../../../scripts/ops/risk-0056/schema-sha256.txt)، وفُحصت في run 36665158123 (الخطوة A: `sha256sum -c --quiet` → «14/14 identical»).
- **الحارس في سير التطبيق المستقبلي** (لم يُنشأ):
  1. `actions/checkout` مع `ref: bc5de79e8901523ae400187f95c1824a3c7a013d`.
  2. `test "$(git rev-parse HEAD)" = "bc5de79e8901523ae400187f95c1824a3c7a013d"` وإلا يتوقف.
  3. `grep -v '^#' scripts/ops/risk-0056/schema-sha256.txt | sha256sum -c --quiet` وإلا يتوقف. عند الفشل لا يطبع `sha256sum` إلا اسم الملف المختلف.
  4. لا يُطبع في السجلات إلا: SHA، ومعرّف المشروع `snlpxywskyqrjattbpgn`، وأسماء الملفات، وحالة كل مرحلة.

## 2. lock_timeout — التصميم النهائي والإثبات

### 2.1 الآلية

الملف: [`scripts/ops/risk-0056/lock-timeout-preload.mjs`](../../../../scripts/ops/risk-0056/lock-timeout-preload.mjs). يُحمَّل هكذا من مجلد كل خدمة:

```
pnpm --filter @wasla/<svc>-service exec \
  node --import <repo>/scripts/ops/risk-0056/lock-timeout-preload.mjs --import tsx src/db/migrate-cli.ts
```

- يشغّل **`migrate-cli.ts` الحقيقي دون أي تعديل**، ولا يغيّر أي `schema.sql`.
- كل خدمات الأربعة عشر تنشئ اتصالها بـ `new pg.Pool(...)` من نسخة واحدة هي `pg@8.23.0` (ملف القفل). الـpreload يستبدل `pg.Pool` قبل تحميل الغلاف `esm/index.mjs`، فيأخذ `import { Pool } from "pg"` و`import pg from "pg"` الصنف المعدَّل (تحقّقتُ محلياً: `Pool.name = LockTimeoutPool`، و`max` المطلوب 10 صار 1).
- المقطع الحاسم:

```js
super({ ...config, max: 1, idleTimeoutMillis: 0 });          // جلسة واحدة، لا إعادة اتصال صامتة
…
await client.query(`SET lock_timeout = '${WANT}'`);          // على نفس العميل الذي سيُعطى للترحيل
const { rows } = await client.query(
  "SELECT current_setting('lock_timeout') AS lock_timeout, pg_backend_pid() AS pid");
if (normalise(got) !== WANT_NORMALISED) { … throw … }      // يفشل مغلقاً: لا يُسلَّم العميل
```

- `connect()` مُعاد تعريفه، ويمرّ منه أيضاً `pool.query()` في pg-pool. فلا يصل أي SQL من الترحيل (بما فيه BEGIN…COMMIT في schema.sql وبذور Drizzle في marketplace وsubscriptions) إلى جلسة لم يُتحقق فيها من `lock_timeout`.
- قبل `pool.end()` يُقرأ `(pid, lock_timeout)` مرة أخرى عبر الـpool نفسه.
- **لا PGOPTIONS ولا `options=-c`**: `SET` جملة SQL عادية على جلسة مفتوحة، فلا يستطيع الـpooler حذفها. الحارس يرفض منفذ transaction pooler ‏6543، لأن `SET` على مستوى الجلسة غير مثبّت هناك. قاعدة الاختبار على session pooler ‏5432.
- الدليل: سطر JSON لكل حدث في `$RISK0056_LT_EVIDENCE`، يحوي `service` و`pid` و`lock_timeout` فقط.

### 2.2 كيف نعرف أن القيمة دخلت جلسة الترحيل (run 36665158123، TEST فقط)

**B1 — اختبار سلبي سلوكي:** [`lock-timeout-proof.mjs`](../../../../scripts/ops/risk-0056/lock-timeout-proof.mjs)

| القياس | النتيجة |
|---|---|
| `lock_timeout` لجلسة جديدة بلا preload | `0` (أي الانتظار بلا حد) |
| جلسة ممسكة: `LOCK TABLE public.search_product_index IN ACCESS EXCLUSIVE MODE` | pid 37320 |
| جلسة ترحيل search الحقيقي (من دليل الـpreload) | pid 37322، `lock_timeout = 2s` |
| `pg_stat_activity` لـ pid 37322 أثناء التنفيذ | `wait_event_type = Lock`، `state = active` بعد 1906 ms |
| نهاية الترحيل | exit 1، SQLSTATE **55P03** (lock_not_available)، بعد 4842 ms إجمالاً تشمل إقلاع pnpm/tsx |
| فهارس الجدول قبل وبعد | 6 → 6 (تراجُع كامل، لا أثر) |

الجلسة التي كانت تنتظر القفل هي نفسها (pid 37322) التي قرأ فيها الـpreload `2s`، وألغاها Postgres بـ55P03 بدل الانتظار. هذا يثبت أن القيمة كانت فعّالة داخل جلسة DDL.

**B2 — الترحيلات الأربعة عشر الحقيقية بالـpreload** (على قاعدة اختبار مرحّلة أصلاً، أي idempotent): 14/14 PASS. لكل خدمة: exit 0، وجلسة واحدة فقط، و`lock_timeout` = `2s` في البداية والنهاية، ونفس الـpid في البداية والنهاية. المدة لكل خدمة 1.66–2.60 ث.

**ملاحظة مكشوفة:** على قاعدة الاختبار يوجد إعداد واحد في `pg_db_role_setting` يذكر `lock_timeout`، والأرجح أنه لدور منصّة Supabase لا لدور الترحيل، لأن الجلسة الجديدة قرأت `0`. لم أعرض اسم الدور. هذا لا يغيّر الإثبات، فالـpreload يضبط القيمة صراحة ويتحقق منها. لكن preflight الإنتاج يجب أن يسجّل القيمة الأساسية لجلسة الترحيل قبل `SET`.

**لماذا 2s:** الجدول الوحيد الموجود في الإنتاج الذي يلمسه DDL هو `audit_events` (ثلاثة `CREATE INDEX IF NOT EXISTS`). B1 يثبت أن `CREATE INDEX IF NOT EXISTS` يطلب قفل SHARE على الجدول قبل التحقق من وجود الفهرس. فإن تعارض مع كتابة طويلة فشل بعد ثانيتين بدل أن يحبس كتابات audit خلفه في طابور الأقفال. الفشل = STOP (§6)، بلا إعادة محاولة تلقائية.

## 3. النسخة الاحتياطية — العيوب المؤكَّدة والحارس الذي يفشل مغلقاً

### 3.1 العيوب في `db-backup.yml` عند `bc5de79e8901523ae400187f95c1824a3c7a013d` (أرقام الأسطر من الملف)

| # | السطر | النص | الأثر |
|---|---|---|---|
| أ | 289 مقابل 317 | `echo "restore_all_match=${ALL_MATCH}" >> "$GITHUB_ENV"` ثم في خطوة الـmanifest: `"restore_all_match": ${RESTORE_ALL_MATCH:-false}` | متغيرات البيئة حساسة لحالة الأحرف. `RESTORE_ALL_MATCH` لا يُعرَّف أبداً، فالـmanifest يكتب `false` دائماً مهما كانت النتيجة. **ملاحظتك صحيحة.** ونفس العيب في 287/315 (`restore_duration` مقابل `RESTORE_DURATION:-0`) و288/316 (`restored_tables` مقابل `RESTORED_TABLES:-0`)، فهي دائماً 0. |
| ب | 279–280، 291–292 | `echo "::warning::Table ${TABLE}: … — MISMATCH"` ثم `ALL_MATCH=false` ثم `echo "::warning::Some table row counts do not match…"` | اختلاف الصفوف **تحذير لا فشل**. الخطوة تنجح. **ملاحظتك صحيحة.** |
| ج | 268 | `echo "::warning::Restored table count … differs from source …"` | اختلاف عدد الجداول تحذير أيضاً. |
| د | 252–256 | `pg_restore … "${{ steps.dump.outputs.dump_file }}" 2>&1 \|\| true` | أي خطأ استعادة يُبتلع. |
| هـ | 275–276 | `… 2>/dev/null \|\| echo "ERROR"` للمصدر وللمستعاد | إن فشل الاستعلامان معاً صار `"ERROR" = "ERROR"` → يُحسب «match». |
| و | 272–276 | عدّ صفوف المصدر من الإنتاج الحي **بعد** انتهاء الـdump | على قاعدة تستقبل كتابات قد يختلف العدد اختلافاً مشروعاً. لذلك لا يمكن تحويل التحذير إلى فشل دون لقطة موحّدة. |
| ز | 40–44، 225–226 | مدخل `skip_restore_test` يتخطى خطوة الاستعادة كلها | تشغيل يدوي قد يمر بلا استعادة. |

الخلاصة: `db-backup.yml` كما هو **لا يصلح بوابةً للترحيل**، والـmanifest غير موثوق. لم أعدّله، فهو ملك RISK-0055 / CLM-0405 وخارج نطاق هذه المهمة. إصلاح الأسطر أعلاه قرار مستقل للمالك.

### 3.2 الحارس (لا يقرأ أي manifest)

- **المرحلة 1** [`snapshot-dump.mjs`](../../../../scripts/ops/risk-0056/snapshot-dump.mjs): معاملة `REPEATABLE READ READ ONLY` تصدّر لقطة بـ `pg_export_snapshot()`، وتعدّ صفوف كل جدول `public` بالضبط (`count(*)`)، وتسجّل امتدادات `public`، ثم تشغّل `pg_dump --format=custom --no-owner --no-privileges --snapshot=<id>`. الـdump والأعداد يصفان اللحظة نفسها، فأي اختلاف بعد الاستعادة عيب حقيقي. لا يكتب شيئاً في المصدر.
- **المراحل 2–6** [`verify-backup.sh`](../../../../scripts/ops/risk-0056/verify-backup.sh) مع `set -euo pipefail`. أول فشل يعني exit ≠ 0، والنتيجة «لا ترحيل». لا توجد حالة «تحذير»:

| المرحلة | الشرط |
|---|---|
| 2 nonempty | الملف موجود وحجمه > 0، واللقطة فيها ≥ 1 جدول |
| 3 list | `pg_restore --list` ينجح، وكل جدول في اللقطة له مدخل `TABLE public <name>` في الـTOC |
| 4 gpg | تشفير AES256 ثم فك التشفير ثم `cmp` بايتاً ببايت ثم مطابقة sha256 |
| 5 restore | استعادة **الملف المفكوك تشفيره** في postgres:17 جديد بـ `--exit-on-error --single-transaction --schema=public`، بعد إنشاء امتدادات `public` المسجّلة. امتداد غير متاح يعني فشلاً. |
| 6 compare | مجموعة جداول `public` المستعادة = مجموعة اللقطة، وكل عدد صفوف مساوٍ تماماً |

**النطاق المكشوف:** يتحقق الحارس من مخطط `public` وحده، وهو المخطط الوحيد الذي تكتبه الخدمات الأربع عشرة. مخططات منصّة Supabase (auth، storage، vault…) لا تُستعاد في postgres عادي ولا يتحقق منها الحارس.

### 3.3 الإثبات (run 36665158123، TEST فقط)

- **C1:** اللقطة: 107 جداول `public` وامتداد واحد في `public` (pg_trgm). النتائج: nonempty PASS، وlist PASS (107/107 في الـTOC)، وgpg PASS، وrestore PASS، وcompare PASS (107/107، كل الأعداد متساوية) → `BACKUP-GUARD RESULT PASS`.
- **C2 — أعطال مقصودة، فشل كلٌّ منها مغلقاً في مرحلته:**
  - ملف 0 بايت → `stage=nonempty`
  - ملف مبتور إلى النصف → `stage=list` (فشل `pg_restore --list`)
  - عبارة مرور فارغة → `stage=gpg`
  - عدد صفوف مزوَّر (+1) → `stage=compare` (جدول واحد مختلف)
  - جدول في اللقطة غائب عن الـdump → `stage=list`

### 3.4 كيف يُستخدم قبل ترحيل الإنتاج (مقترح، لم يُنشأ)

وظيفة في سير التطبيق نفسه، قبل أي DDL: المرحلة 1 على الإنتاج (قراءة فقط)، ثم المراحل 2–6، ثم رفع الملف **المشفّر** وحده كـartifact. الاحتفاظ 30 يوماً غير كافٍ لنسخة ما قبل الترحيل: أقترح 90 يوماً أو نسخة إضافية يحفظها المالك. أي فشل يعني أن وظيفة الترحيل لا تبدأ (`needs:`). لا يُعاد التشغيل تلقائياً.

## 4. RPO / RTO — صياغة مصحّحة وإجراء استعادة الإنتاج

**تصحيح r1 §5.4:** عبارة «RPO ≈ 0» خاطئة، وعبارة «RTO < 1 دقيقة» ليست قياساً للإنتاج.

- **RPO:** النسخة لقطة عند اللحظة T₀ (لحظة `pg_export_snapshot`). الاستعادة منها تُفقد **كل كتابة مؤكَّدة بعد T₀**: ما كُتب بين اللقطة وبدء الترحيل (مثل audit_events وجداول القنوات)، وكل ما كُتب بعد الترحيل. هذا ليس صفراً. حجمه يساوي حجم الكتابات منذ T₀، ويمكن تقليله بتقصير الفاصل بين اللقطة والترحيل (نفس سير العمل، بفارق دقائق) وبالتنفيذ في وقت هادئ. لا ندّعي PITR: لم يُتحقق من خطة Supabase أو من تفعيله.
- **RTO:** **غير مقيس للإنتاج.** قياس CLM-0405 كان استعادة قاعدة صغيرة إلى Docker محلي على GitHub runner، ولا يشمل: تنزيل الـartifact، وفك التشفير، والاستعادة عبر الشبكة إلى Supabase، وتغيير `DATABASE_URL` في Render، وإعادة نشر الخدمات، والتحقق. أي رقم للإنتاج يحتاج تمريناً فعلياً على مشروع غير الإنتاج.

**إجراء استعادة الإنتاج** (يدوي، بقرار المالك في كل خطوة، ولا شيء منه تلقائي):

1. **قرار أولاً:** إن كان العطل في المخطط ولا توجد بيانات تشغيلية حقيقية، فالمسار المفضّل إصلاح للأمام (forward fix) عبر PR جديد، لا استعادة (انظر r1 §5.1–5.3).
2. **تجميد الكتابة:** إيقاف الخدمات الكاتبة على Render (الأربع عشرة والبوتات الثلاثة) بـ suspend. هذا تغيير في Render يحتاج أمرك.
3. **الحصول على النسخة:** artifact مشفّر ضمن مدة الاحتفاظ، ثم فك التشفير بـ `BACKUP_PASSPHRASE`، ثم إعادة `verify-backup.sh` (المراحل 2–6) قبل الاستخدام.
4. **مكان الاستعادة، المفضّل (أ):** مشروع Supabase **جديد** (PG 17). يبقى الإنتاج التالف كما هو للتحقيق، ولا حاجة إلى DROP. الأوامر: `CREATE EXTENSION` لامتدادات `public` المسجّلة، ثم `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --schema=public`، ثم مقارنة الأعداد.
   **البديل (ب):** الاستعادة في المشروع نفسه تتطلب إزالة كائنات موجودة، أي DROP في الإنتاج. لا تُنفَّذ إلا يدوياً وبأمر صريح منك، ولا يوصى بها.
5. **توجيه الخدمات:** تحديث `DATABASE_URL` لكل خدمة في Render (مصدره `var.supabase_database_url` في `infra/terraform/render.tf`) إلى المشروع الجديد، ثم إعادة النشر، ثم تحديث سر GitHub `SUPABASE_DB_URL` حتى تنسخ `db-backup.yml` المشروع الجديد.
6. **التحقق:** جدول الاختبارات في §5 كاملاً، ثم رفع التجميد.

## 5. اختبارات الإنتاج بعد التطبيق (تصميم فقط، لم تُنفَّذ)

### 5.1 المصادقة

- المسارات المفتوحة (`config: OPEN`) هي `/health` في كل الخدمات الأربع عشرة، و`/delivery/ready` و`/search/health`. كل ما عداها محمي بهوية الخدمة: رمز موقَّع بمفاتيح `WASLA_SERVICE_AUTH_KEYS`، مع تحقق من الدور والنطاق وسجل منع الإعادة.
- المفاتيح موجودة في بيئة Render فقط، وليست في أسرار GitHub (الموجود في GitHub: `BACKUP_PASSPHRASE` و`GEMINI_API_KEY` و`RENDER_API_KEY` و`SUPABASE_DB_URL` و`SUPABASE_TEST_DB_URL`). ولا توجد هوية «smoke» مسجّلة.
- **لذلك لا أقترح أي طلب HTTP مصادَق الآن.** يحتاج ذلك إلى: (1) سحب مفتاح توقيع إنتاجي من Render، (2) انتحال دور خدمة حقيقية أو إضافة دور smoke بتعديل كود، (3) كل رمز يكتب صفاً في سجل منع الإعادة، أي كتابة حقيقية في الإنتاج. هذا قرار منك إن أردته لاحقاً.
- **البديل المقترح:** قراءات HTTP على المسارات المفتوحة، وتحقق المجال على مستوى SQL داخل معاملة تُلغى، على جلسة محروسة (معرّف المشروع + `lock_timeout` + `statement_timeout`)، بنفس نمط `schema-rw-smoke.mjs` المثبت على الاختبار في CLM-0410.

### 5.2 الجدول

العلامة: `risk0056-prod-smoke-<run_id>`. «الإلغاء» يعني `ROLLBACK`، ولا يبقى صف. **أثر جانبي مكشوف:** الإدراج المُلغى يستهلك قيماً من التسلسلات (BIGSERIAL/identity) في جداول الـoutbox، فتبقى فجوات أرقام. الترتيب يبقى رتيباً. لا كتابة حقيقية في أي اختبار.

| # | الخدمة/النطاق | endpoint / أداة | method | payload / marker | أين يُكتب | read-back | cleanup | PASS | STOP |
|---|---|---|---|---|---|---|---|---|---|
| P0 | الأربع عشرة (قبل الترحيل) | `https://wasla-<svc>.onrender.com/health` | GET | — | لا شيء | رمز الحالة والجسم كخط أساس | — | يُسجَّل فقط | — |
| P1 | الأربع عشرة | `https://wasla-<svc>.onrender.com/health` | GET | — | لا شيء | `status` في الجسم | — | 14/14 ‏200، و`status=ok` (لا `schema_missing` ولا `degraded` ولا `unavailable`)، خلال 10 دقائق بفحص كل 30 ث ودون افتراض إعادة نشر | أي خدمة ليست 200/ok بعد 10 دقائق |
| P2 | delivery | `/delivery/ready` | GET | — | لا شيء | `checks[database].ok` | — | ‏200 و`database ok` | ‏503 أو `database` غير ok |
| P3 | marketplace، matching | `/health` (يقرأ `store_categories` / الـruleset النشط) | GET | — | لا شيء | `status`، `active_ruleset_version` | — | `ok`، و`active_ruleset_version` ليس null | `degraded` أو null |
| S1 | الأربع عشرة | SQL: الكتالوج (قراءة) | SELECT | — | لا شيء | كل جدول في كل schema.sql موجود بنفس الأعمدة (الاسم، النوع، القابلية للقيمة الفارغة) كما على الاختبار | — | 107/107 جداول، ولا فرق أعمدة | أي جدول مفقود أو عمود مختلف |
| S2 | ‏13 خدمة جديدة | SQL: `<svc>_outbox` | INSERT ثم SELECT داخل `BEGIN…ROLLBACK` | نص = العلامة، `event_type` حسب CHECK | الجدول نفسه، داخل المعاملة فقط | SELECT بالمفتاح الأساسي داخل المعاملة = 1، والعلامة تُقرأ كما هي | `ROLLBACK` ثم عدّ العلامة = 0 | 13/13 | فشل إدراج أو قراءة، أو بقاء صف بعد ROLLBACK |
| S3 | audit | SQL: `audit_events` | SELECT فقط | — | لا شيء (فيه بيانات حقيقية، فلا إدراج ولو مُلغى) | العدد ≥ عدد ما قبل الترحيل، والفهارس الثلاثة موجودة | — | موجود ومقروء | عدد أقل أو فهرس مفقود |
| S4 | search / pg_trgm | SQL | `BEGIN`، ثم INSERT في `search_product_index` بـ `title_ar` = العلامة، ثم `SET LOCAL enable_seqscan=off`، ثم `EXPLAIN SELECT … WHERE title_ar % <marker>`، ثم نفس الاستعلام، ثم `ROLLBACK` | العلامة | داخل المعاملة فقط | ‏`pg_extension` فيه pg_trgm، و`pg_operator` فيه `%` لـ text، والخطة تستخدم `ix_search_products_trgm_ar`، والاستعلام يعيد الصف المُدرج | `ROLLBACK` ثم عدّ العلامة = 0 | الشروط الأربعة | أي شرط لا يتحقق |
| S5 | subscriptions (البذرة) | SQL (قراءة) | SELECT | — | لا شيء | نسخة خطة واحدة و4 استحقاقات، و`frozen_at` داخل نافذة التشغيل | — | 1 + 4 | عدد مختلف (انظر §5.3) |
| S6 | marketplace / matching / البذور المضمّنة في schema.sql | SQL (قراءة) | SELECT | — | لا شيء | عدد التصنيفات = طول `MARKETPLACE_CATEGORY_SEED`، والـruleset النشط = 1، وصفوف الإعداد = المتوقع من الاختبار | — | مطابق | مختلف |
| S7 | الأمان | SQL (قراءة) | SELECT `has_table_privilege` | — | لا شيء | لا امتيازات لـ `anon` و`authenticated` على الجداول الجديدة، ولا USAGE على `public` (كما في preflight CLM-0411) | — | صفر امتيازات | أي امتياز ظاهر (تعرّض عبر PostgREST) |

- **PASS الإجمالي** = P1 (14/14) وP2 وP3 وS1 (14 خدمة) وS2 (13) وS3 وS4 وS5 وS6 وS7، **جميعها معاً**. تيليجرام وPrometheus وAlertmanager **ليست دليل نجاح**. إن أُطلق تنبيه فهو إشارة STOP إضافية لا أكثر.
- **STOP** يعني: لا خطوة تالية، ولا إعادة محاولة، ولا DROP أو TRUNCATE. يُسجَّل الدليل، وتنتقل إليك الحالة لقرار §4.
- **ترتيب الخدمات في البوابة:** الترحيلات بالترتيب المثبت في r1 §1.2 (search أخيراً)، والتوقف عند أول خطأ.

### 5.3 بذرة subscriptions (تذكير من r1 §4)

`migrateSubscriptions` يطبّق schema.sql بـ BEGIN/COMMIT، **ثم** يستدعي `seedPlanCatalog` منفصلاً بعد COMMIT. إن فشلت البذرة بقي المخطط مطبّقاً، ولا تراجع آلياً. إعادة التشغيل آمنة (`onConflictDoNothing`)، والتحقق عبر S5.

## 6. بوابة التشغيل

### 6.1 ما تقوله توثيق GitHub

- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): «This event will only trigger a workflow run if the workflow file exists on the default branch.» وأيضاً: «Once a workflow has run at least once, you can dispatch it against any branch or tag via the GitHub API or GitHub CLI.»
- [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow): «To trigger the `workflow_dispatch` event, your workflow must be in the default branch.»

**النتيجة:** سير عمل موجود على فرع فقط وغير موجود على `main` **لا يمكن تشغيله بـ workflow_dispatch**. ما كتبته في r1 §6.1–6.2 بأنه يعمل من فرع **كان خطأ**. سير التطبيق يجب أن يُدمج في `main` أولاً، والدمج يمرّ بـ governance-guard (§7). حتى مع `--ref`، الصفحتان لا تحددان صراحة أي نسخة من الملف تُستخدم. لذلك يُثبَّت `ref` في `actions/checkout` ويُفحص `git rev-parse HEAD` (§1) بصرف النظر عن ذلك.

### 6.2 المقترح (لم يُنشأ شيء منه)

- **المشغّل:** `workflow_dispatch` فقط. **لا `push` ولا `schedule` ولا `pull_request`**. مدخلات إلزامية: `confirm_project_ref` يجب أن يساوي `snlpxywskyqrjattbpgn`، و`confirm_sha` يجب أن يساوي الـSHA الكامل ذا الأربعين حرفاً.
- **Environment باسم `production-migration`:**
  - Required reviewers: **@skyosv10-art** وحده. الوثيقة ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)): «Use required reviewers to require a specific person or team to approve workflow jobs that reference the environment.» وهي متاحة لأن المستودع عام: «If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, required reviewers are only available for public repositories.»
  - Deployment branches: «Selected branches and tags» = `main` فقط.
  - سر البيئة: رابط الإنتاج يُخزَّن **سرَّ بيئة**: «If the environment requires approval, a job cannot access environment secrets until one of the required reviewers approves it.» سر المستودع `SUPABASE_DB_URL` يبقى لـ `db-backup.yml`، ونقله أو تدويره قرارك.
- **حدٌّ صريح:** أعمل عبر حساب **@skyosv10-art** نفسه. خيار «prevent self-reviews» سيمنعك أنت من الموافقة إن كان التشغيل باسمك، وبدونه تقنياً يمكن لأي عملية تحمل رمز الحساب أن توافق عبر API. لذلك الضمان هنا **التزام إجرائي**: لن أستدعي أبداً واجهة الموافقة (`pending_deployments`)، والموافقة تكون بنقرتك في واجهة GitHub. إن أردت ضماناً تقنياً فالحل مراجع ثانٍ بحساب مستقل.

## 7. أسباب فشل CI في PR #550 — ما سببه الـPR وما هو موجود على main

الدليل: **إعادة تشغيل CI على `main` نفسه** (run 36645750718، المحاولة 2، على `bc5de79e8901523ae400187f95c1824a3c7a013d`، بتاريخ 2026-09-30 03:16Z)، مقارنةً بـ PR #550 (run 36661129620).

| الوظيفة | على main (المحاولة 2) | على PR #550 | الحكم |
|---|---|---|---|
| doc-coverage | **نجحت** | فشلت: «TASK_LOG لم يحو إدخالاً مضافاً بصيغة `**Work Item(s):** <ID>`» | **سببه PR #550**: إدخال TASK_LOG في r1 لم يستخدم الصيغة المطلوبة. صُحّح بإضافة إدخال r2 بـ `**Work Item(s):** M6-18B`. |
| image-supply-chain | فشلت: `brace-expansion@2.1.4` ‏CVE-2026-102276 وCVE-2026-102278 (HIGH، مُصلَحة في 2.1.5/2.1.6) | فشلت: نفس الثغرتين | **موجود على main**: قاعدة ثغرات trivy تحدّثت بعد نجاح المحاولة 1. PR #550 لا يغيّر ملف القفل ولا الصورة (docs وscripts/ops فقط). |
| governance-guard / verify | فشلت: (1) RISK-0012 وRISK-0013 وRISK-0042 انقضى تاريخ مراجعتها (2026-09-29 < 2026-09-30)، (2) حجز بائت CLM-0409 على فرع محذوف، (3) فرعان بائتان `ops/risk-0056-pgtrgm-readonly` و`ops/risk-0056-prod-preflight` | نفس الأسباب الثلاثة | **موجود على main**. لم أعدّل المخاطر الثلاثة ولم أتجاوز البوابة. |

## 8. الموانع الباقية

1. **الحوكمة (قرار المالك):** RISK-0012/0013/0042 منقضية المراجعة، وحجز CLM-0409 بائت، وفرعان بائتان. طالما هي قائمة، لا يُدمج أي PR، ومنها سير التطبيق.
2. **image-supply-chain:** ثغرتا `brace-expansion` الجديدتان على main. تحتاجان ترقية أو استثناءً مُعلَناً بقرار (RISK-0047/0050).
3. **سير التطبيق غير موجود:** يجب كتابته (تصميم §1 و§2 و§3.4 و§5 و§6.2) في PR، وإثباته أولاً على قاعدة الاختبار، ثم دمجه في `main` بعد حل (1) و(2). بدون ذلك لا يعمل `workflow_dispatch`.
4. **Environment `production-migration`:** لم يُنشأ. إنشاؤه تغيير في إعدادات المستودع يحتاج أمرك.
5. **HTTP مصادق:** غير متاح دون مفاتيح إنتاج ودور smoke. §5.1 يستبدله بـ SQL مُلغى، وإن أردت HTTP مصادقاً فهو قرار منك.
6. **RTO الإنتاج:** غير مقيس. يحتاج تمرين استعادة فعلياً على مشروع غير الإنتاج.
7. **`db-backup.yml`:** العيوب (أ)–(ز) قائمة. الحارس الجديد لا يعتمد عليها، لكن النسخ المجدولة تبقى بـ manifest غير موثوق حتى تقرر إصلاحها.

**الحالة:** جاهزية التصميم مكتملة ومثبتة على قاعدة الاختبار. **التطبيق على الإنتاج لم يبدأ، وينتظر أمرك الصريح** بعد حل الموانع 1–4.
