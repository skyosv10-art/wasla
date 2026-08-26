# لوحة تنفيذ الإطلاق إلى 100%

**النسخة:** `v1.1`  
**آخر تحقق:** `2026-08-25`  
**حالة البرنامج:** `Blocked — لا إطلاق خارجي`  
**قاعدة التحديث:** كل دفع ذي معنى يجب أن يحدّث هذه اللوحة و`TASK_LOG.md` في نفس النطاق. لا يغير أحد حالة عنصر إلى `Completed` دون رابط دليل قابل لإعادة التشغيل.

> حالات مسموحة فقط: `Not Started`، `In Progress`، `Blocked`، `Ready for Gate`، `Completed`، `Cancelled`.  
> الرمز `—` في الدليل يعني أن العمل لم يثبت بعد؛ لذلك لا يجوز أن تكون حالة السطر `Completed`.

> **قاعدة الحجز (إلزامية):** لا يُنقل عنصر إلى `In Progress` إلا وله سطر حجز نشط في [`WORK_CLAIMS.md`](WORK_CLAIMS.md)، ولا يجوز أن يكون للعنصر حجزان نشطان. قبل إنشاء أي عنصر جديد شغّل `bash scripts/checks/find-existing-work.sh "<المجال>"` لمنع التكرار.  
> **قاعدة الترقيم:** معرّفات `Mx-yy` هي المعتمدة في كل commit وMR وسجل؛ وتطابقها مع محور `Phase 00–24` موضح في [الخارطة §0.14](LAUNCH_TO_100_ROADMAP.md).  
> **فهرس الملكية:** لمعرفة حالة أي منطقة كود (مبنية / placeholder / من يملكها) راجع [`WORK_INDEX.md`](WORK_INDEX.md).

## حالة الإصدار

| الحقل | القيمة |
|---|---|
| قرار الإصدار | **NO-GO** |
| أول بوابة مفتوحة | M0 — استعادة الثقة وحوكمة الإصدار |
| عوائق التدقيق المفتوحة | AUD-001 إلى AUD-008 |
| المراجعة التالية | عند إغلاق M0-01..M0-08 أو قبل أي بدء لنطاق جديد |
| مالك البرنامج | `@uxxxu` |
| **حالة إنفاذ CI** | ⚠ **معطّل** — حصّة دقائق CI منتهية، فتفشل الوظائف كلّها بـ`ci_quota_exceeded` قبل أن تبدأ (يشمل `build-test` وكل `db-integration` وكل `exit-gate-e2e` على `main` نفسها). **حتى تُجدَّد الحصّة أو يُسجَّل runner خاص: التحقق يدوي إلزامي** عبر `pnpm governance:verify` و`pnpm governance:test`، ويُرفَق خرجهما في كل MR كدليل مؤقت. |
| **أول تحقّق فعلي منذ توقّف CI** | 2026-08-25 — شُغّلت **وظائفُ قاعدةِ البيانات الثمانَ عشرةَ كلُّها** محليّاً مقابل PostgreSQL 15.6 (ثنائيّاتٌ محمولةٌ تعمل بلا صلاحيّاتِ root، قاعدةٌ مستهلَكةٌ منفصلةٌ لكلِّ وظيفة، مصادقةٌ محليّة — **بلا أيِّ سرٍّ ولا أيِّ قاعدةٍ مُستضافة**). النتيجة: **17/18 خضراء، 450 اختباراً**، والفاشلةُ الوحيدةُ `drivers-db-integration`. بعد `M0-02`: 27 فشلاً ← **7**، وكلُّها مُشخَّصةٌ ومُسجَّلةٌ في `M0-09` و`M0-10`. |
| المرحلة الجارية فعلًا | `Phase 11 — Marketplace Foundation` (يقابل `M5-11`) — **4/6 مراجعات** (طبقةُ التطبيقِ والحدُّ HTTP على المنفذ 8094) |
| رابط خارطة الطريق | [LAUNCH_TO_100_ROADMAP.md](LAUNCH_TO_100_ROADMAP.md) |
| سجل الحجز | [WORK_CLAIMS.md](WORK_CLAIMS.md) |
| فهرس الملكية | [WORK_INDEX.md](WORK_INDEX.md) |

## سجل عناصر التنفيذ

### M0 — استعادة الثقة والحوكمة

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M0-01 | إصلاح تركيب الاشتراكات واختبار الجذر | Subscriptions / QA | — | Ready for Gate | typecheck أخضر + composition test + MR | العيبُ المُدقَّق **مُصلَحٌ سلفاً في الكود** (المواقعُ الستّةُ كلُّها تُمرِّر المُوَلِّد)، والفجوةُ الباقيةُ كانت **غيابَ حارسٍ**: لا اختبارَ واحداً يستورد `http/server.ts`. أُضيف `composition.test.ts` (10 تأكيدات) — typecheck أخضر على المستودع كلِّه، 215/215 اختباراً في الخدمة، و3 طفراتٍ مقصودةٍ رُفضت. ينتقل إلى `Completed` بعد إجازة المالك الثانوي. |
| M0-02 | إصلاح fixture مطابقة السائقين | Drivers / QA | M0-01 | Ready for Gate | Postgres conformance أخضر مرتين | **مُستوفى محليّاً: 23/23 مرّتين.** فرضيّةُ اللوحةِ صحيحةٌ حرفيّاً، لكنّ الموضعَ غيرُ المتوقَّع: `pg-harness.ts:178` يبذر النطاقينِ سلفاً، والفجوةُ في `port-conformance.integration.test.ts:535` حيث `createInMemoryEnvironment` يبني `InMemoryZoneCatalogPort` **فارغاً** — فكان جانبُ الذاكرةِ وحدَه يرمي «نطاق غير معروف في شجرة الجغرافيا» في 20 سيناريو من 23. أُصلح بأربعةِ أسطرٍ في ملفِ اختبارٍ واحد، بلا لمسِ كودِ إنتاج. ينتقل إلى `Completed` بعد إجازةِ المالكِ الثانوي. |
| M0-03 | عزل DDL لاختبارات الهوية | Identity / QA | M0-01 | Not Started | 10 تشغيلات integration بلا سباق | اختيار schema-per-worker أو serialization. |
| M0-04 | أمر verify موحد وCI مانع | DevEx / QA | M0-01..03 | Not Started | أمر موثق + artifact + CI mandatory | تحديد tools وcoverage policy. |
| M0-05 | تفعيل بروتوكول/لوحة الحوكمة + نظام منع تكرار العمل | @uxxxu / Program | — | Ready for Gate | وظيفة `governance-guard` خضراء على MR الدمج + ADR-017 | **الدليل غير مستوفى: البوابة لم تُنفَّذ في MR !81 لنقص رصيد CI (`ci_quota_exceeded`، 0/21 وظيفة بدأت) لا لعيب في التغيير.** التحقق محلي: 5/5 بوابات و14/14 حالة إثبات. يبقى `Ready for Gate` حتى تركض البوابة فعلاً. |
| M0-06 | تحديث الاعتماديات والثغرات | DevEx / Security | M0-04 | Not Started | audit أخضر أو قبول خطر منتهٍ | تحديد نسخ الإصلاح واختبارها. |
| M0-07 | سجل المخاطر والاستثناءات | Security / Program | M0-05 | Not Started | risk register مع مالك/تاريخ | إضافة السجل وربطه باللوحة. |
| M0-08 | baseline آلي للبيئة والاختبارات | QA / DevEx | M0-04 | Not Started | artifacts قابلة للتكرار | تعريف metadata/artifact format. |
| M0-11 | إصلاح تقلّبِ بوّابةِ الحوكمة (SIGPIPE في `validate-launch-board.sh`) | Program / DevEx | — | Ready for Gate | 40 تشغيلاً بلا تقلّب + حالةُ انحدار | **مُكتشَفٌ بالتشغيل، والبوّابةُ نفسُها هي المصاب.** السطرُ 74 كان `printf … | grep -Fxq`: تحت `pipefail` يخرج `grep -q` عند أوّلِ تطابقٍ فيُغلقُ الأنبوب، فيموتُ `printf` بـSIGPIPE، فتصيرُ حالةُ الأنبوبِ 141 وتُقرأ «لا تطابق» — فيُرفَض معرِّفٌ **موجودٌ** على اللوحة. مُثبَتٌ تجريبيّاً: **66 نتيجةً خاطئةً من 300** قبل العلاج، **0 من 300** بعده. عُولج بـ`<<<` بلا أنبوب، وأُضيفت الحالةُ 15 (40 تشغيلاً متعاقباً يجب أن تنجح كلُّها) لأنّ عيباً احتماليّاً لا تكفيه حالةٌ واحدة. | **تحديث 2026-08-26 (`M0-12`):** حارسُ الانحدارِ المُعلَنُ هنا كان **يفشل لسببٍ غيرِ ما يحرسه** — يُشغَّل على فرعٍ بلا حجزٍ نشط، فيُرفض عند فحصِ الحجزِ قبلَ أن يبلغَ مصيدةَ SIGPIPE. أي أنّ دليلَ الإغلاقِ لم يكن قائماً. عُولج في `M0-12`، والحارسُ الآن يُشغَّل على فرعٍ محجوزٍ في سجلٍّ صناعيٍّ ويمرُّ فعلاً. **وتبيَّن أنّ العلاجَ نفسَه كان ناقصاً:** موضعٌ ثانٍ للمصيدةِ بقيَ في `require-doc-update.sh` (فحصُ قائمةِ الملفّات) يرفض ~3% من الدفعاتِ الصحيحة؛ عولِج في `M0-12` أيضاً. تبقى الحالةُ `Ready for Gate`: البوّابةُ لم تُنفَّذ في CI (`ci_quota_exceeded`)، والقياسُ محليٌّ.
| M0-12 | فكُّ ارتباطِ حزمةِ إثباتِ الحوكمة بصفٍّ بعينِه | Program / DevEx | M0-11 | Ready for Gate | 15/15 على أيِّ فرعٍ وبأيِّ حالةِ سجل | **عُولج 2026-08-26 · `CLM-0006` · الفرع `fix/m0-12-governance-proof-isolation`.** الحزمةُ صارت تبني سجلَّ حجزٍ **صناعيّاً كاملاً** في نسخةِ `/tmp` لكلِّ حالة، ولا تقرأ ولا تُشوِّه صفّاً حقيقيّاً؛ ومعرِّفاتُ عناصرِ العملِ تُقرأ من اللوحةِ وقتَ التشغيل، والتواريخُ تُحسب من تاريخِ اليوم. الحالاتُ **15 ← 26، وكلُّها خضراء** (كانت 11 ناجحةً و4 فاشلة). وأُثبت فكُّ الارتباطِ بمحاكاةِ تحريرِ حجزٍ حيٍّ (`CLM-0002`) وإعادةِ التشغيل: **25/25 كما هي**. وكشفَتِ الحزمةُ المُصلَحةُ **عيباً ثالثاً**: مصيدةُ SIGPIPE باقيةٌ في `require-doc-update.sh` ترفض ~3% من الدفعاتِ الصحيحة (4 فشلاً من 120 قبلَ العلاج · 0 من 120 بعده) — عولِج وأُضيف له حارسُ تكرارٍ 40 تشغيلاً. وأُصلح معها انحرافُ قائمةِ السجلاتِ المشتركةِ في مواضعها الثلاثةِ بقرارِ مالكِ البرنامج (خمسةٌ لا أربعة)، وأُضيف حارسٌ يمنع عودتَه. **قياسٌ محليٌّ** — حصّةُ CI منتهية. |
| M0-09 | تصحيح تأكيدات القيود بعد ترقية Drizzle | Drivers / QA | M0-02 | Not Started | `drivers-db-integration` بلا فشلٍ من هذا السبب | **مُكتشَفٌ بالتشغيلِ الفعلي، لم يكن على اللوحة.** `drizzle-orm@0.45` يلفّ خطأَ Postgres في `DrizzleQueryError` بمفاتيحٍ `query,params,cause` فقط، فصار `constraint` على `cause` لا على الخطأِ نفسِه؛ وستّةُ اختباراتٍ تؤكّد `rejects.toMatchObject({ constraint })` فتفشل رغمَ أنّ القيدَ **رفضَ فعلاً** (مُثبَتٌ بسبرٍ طبعَ الكائن). تغييرٌ في الاختباراتِ وحدَها. ويشمل خطأً حسابيّاً: `expect(key.length).toBe(151)` والصحيحُ **150** (`8+13+1+128`)، وحدُّ العمودِ 192. |
| M0-10 | إصلاح `ck_eligibility_log_reasons` — مصيدةُ `array_length` | Drivers / DB | M0-02 | Not Started | الصفُّ المخالفُ يُرفَض + ترحيلٌ عكوس | **عيبُ إنتاجٍ حقيقيٌّ مُثبَتٌ بالتجربة، لم يكن على اللوحة.** القيدُ `to_state = 'eligible' OR array_length(reasons,1) >= 1` **لا يرفض شيئاً** للمصفوفةِ الفارغة: `array_length('{}',1)` = `NULL`، و`NULL >= 1` = `NULL`، وPostgres يعدُّ نتيجةَ `NULL` في `CHECK` **ناجحةً**. فيُقبَل حكمُ `ineligible` بلا سببٍ واحد — وهو الشيءُ الوحيدُ الذي كُتب القيدُ لمنعِه. العلاجُ `cardinality(reasons) >= 1` (تُعطي `0` للفارغة). يحتاج تعديلَ `contracts/schema.sql` + ترحيلاً، فبندٌ مستقلٌّ لا توسيعُ نطاق. |

### M1 — الهوية والأمن

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M1-01 | نموذج principal موحد | Identity / Security | M0 | Not Started | ADR + types + tests | كتابة ADR وحدود user/service. |
| M1-02 | تحقق Telegram session/init-data | Channel / Identity | M1-01 | Not Started | signature/replay/expiry E2E | تحديد lifecycle للجلسة. |
| M1-03 | هوية خدمة إلى خدمة | Platform / Security | M1-01 | Not Started | unauthenticated rejection E2E | اختيار mTLS أو workload JWT في ADR. |
| M1-04 | auth middleware مركزي | Platform / All | M1-02,M1-03 | Not Started | architecture guard + integration tests | تحديد request context. |
| M1-05 | policy matrix للتفويض | Security / Service owners | M1-04 | Not Started | owner/role/tenant negative tests | جرد 107 operations. |
| M1-06 | OpenAPI security schemes/scopes | API / Service owners | M1-05 | Not Started | contract drift green | تحديث العقود والاختبارات. |
| M1-07 | حماية bot outbound/internal routes | Channel / Platform | M1-03,M1-04 | Not Started | service auth + ingress proof | إغلاق AUD-005. |
| M1-08 | edge abuse/error/audit controls | Edge / Security | M1-04 | Not Started | rate-limit and redaction tests | تحديد gateway policy. |
| M1-09 | threat model وsecurity testing policy | Security / Platform | M1-01..08 | Not Started | signed review | بناء backlog المخاطر. |

### M2 — التشغيل والبيانات

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M2-01 | images/containers/SBOM | Platform / Security | M0 | Not Started | reproducible build + scan | توحيد base images. |
| M2-02 | IaC وبيئات وشبكات وTLS | Platform / SRE | M1 | Not Started | fresh plan/apply | اختيار platform/provider وADR. |
| M2-03 | secrets/KMS/rotation | Security / Platform | M2-02 | Not Started | rotation drill | تعريف secret inventory. |
| M2-04 | config schema وenv examples | DevEx / All | M0 | Not Started | config tests and docs | جرد 20 variables الحالية. |
| M2-05 | migrations موحدة | Data / Service owners | M2-02 | Not Started | upgrade/repair drill | تعيين migration owner لكل schema. |
| M2-06 | backup/restore/RPO-RTO | Data / SRE | M2-05 | Not Started | timed restore evidence | تحديد targets. |
| M2-07 | workers/outbox/ticks/DLQ | Platform / Service owners | M2-02,M2-05 | Not Started | crash/retry/dedupe proof | جرد كل outbox/tick. |
| M2-08 | logs/metrics/traces/alerts | SRE / Platform | M2-01..07 | Not Started | synthetic trace/dashboard | تحديد SLI baseline. |
| M2-09 | staging parity/deploy/rollback | Platform / QA | M2-01..08 | Not Started | successful staged deploy/rollback | إنشاء environment. |

### M3 — التطبيقات والعمليات

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M3-01 | Customer Mini App | Product/Customer / UI | M1,M2 | Not Started | secure UI E2E + accessibility | product spec and ADR. |
| M3-02 | Driver Mini App | Product/Drivers / UI | M1,M2 | Not Started | secure UI E2E + accessibility | product spec and ADR. |
| M3-03 | Partner surface أو ADR تأجيل | Product/Partners / UI | M1,M2 | Not Started | scope evidence | قرار product. |
| M3-04 | Admin MVP | Ops / UI | M1,M2 | Not Started | RBAC + audit + UAT | operations workflow spec. |
| M3-05 | Bot role restricted to notification/deep-links | Channel / Product | M1,M3-01..04 | Not Started | journey and abuse tests | define allowed commands. |
| M3-06 | i18n/accessibility/error/offline UX | Product/UI / QA | M3-01..04 | Not Started | UAT result | acceptance matrix. |
| M3-07 | Supportable operations without DB edits | Ops / SRE | M3-04 | Not Started | runbook drill | define operational actions. |

### M4 — Beta

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M4-01 | beta scope and success/stop metrics | Product/Ops / Program | M3 | Not Started | signed beta charter | choose pilot constraints. |
| M4-02 | golden cross-service E2E journeys | QA / All | M1..M3 | Not Started | staging artifacts | enumerate critical paths. |
| M4-03 | load/capacity/chaos testing | SRE/QA / Platform | M2 | Not Started | SLO comparison | define workloads. |
| M4-04 | incident/on-call/rollback operations | SRE/Ops / Platform | M2 | Not Started | tabletop and live rollback | assign rotations. |
| M4-05 | privacy/compliance review | Legal/Security / Product | M1..M3 | Not Started | review record | identify applicable law. |
| M4-06 | controlled pilot and feedback triage | Product/Ops / QA | M4-01..05 | Not Started | beta decision report | open pilot only after gate. |

### M5 — النطاقات الموعودة

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M5-11 | Marketplace Foundation | Marketplace / Data | M4 | In Progress | phase exit gate | 4/6 مكتملة (حدُّ HTTP · المنفذ 8094). التالي 5/6: صادرٌ وتزامنُ مخزون. الحجز CLM-0005. |
| M5-12 | Marketplace Search | Search / Marketplace | M5-11 | Not Started | relevance/load gate | search ADR. |
| M5-13 | Store Orders & Delivery | Delivery / Orders | M5-11,M5-12 | Not Started | inventory/payment E2E | workflow contract. |
| M5-14 | Partner / Enterprise | Partners / Security | M5-13 | Not Started | tenant/SLA gate | identity/tenancy ADR. |
| M5-15 | Admin Operations full | Ops / UI | M5-11..14 | Not Started | privileged workflow gate | expand M3 admin. |
| M5-16 | Support & Escalation | Support / Reputation | M5-15 | Not Started | dispute evidence gate | ticket model ADR. |
| M5-17 | Billing & Fees | Billing / Data | M5-13..16 | Not Started | financial reconciliation gate | money boundary ADR. |

### M6–M7 — المرونة والأمن والإطلاق

| ID | عنصر العمل | Primary / Secondary | يعتمد على | الحالة | دليل الإغلاق المطلوب | الخطوة التالية |
|---|---|---|---|---|---|---|
| M6-18A | resilience controls and SLOs | SRE / Platform | M5 | Not Started | chaos/load evidence | set SLOs. |
| M6-18B | HA/capacity/DR | SRE/Data / Platform | M6-18A | Not Started | RTO/RPO drill | architecture review. |
| M6-18C | observability operating model | SRE / Ops | M6-18A | Not Started | alert/live-fire evidence | runbook review. |
| M6-19A | independent pentest/remediation | Security / All | M5,M6 | Not Started | no critical/high open | procure/plan review. |
| M6-19B | access/secret/audit review | Security / Platform | M6-19A | Not Started | periodic evidence | schedule controls. |
| M6-19C | supply-chain hardening | DevEx/Security / Platform | M6-19A | Not Started | provenance/SBOM attestations | pipeline design. |
| M7-01 | tagged release candidate and dossier | Program / DevEx | M6 | Not Started | release dossier | assemble evidence. |
| M7-02 | final pre-prod validation | QA/SRE/Security / All | M7-01 | Not Started | full artifacts | execute gates. |
| M7-03 | formal Go/No-Go | Program / Leadership | M7-02 | Not Started | signed record | review evidence. |
| M7-04 | canary and rollback | SRE/Platform / Ops | M7-03 | Not Started | canary metrics | execute release plan. |
| M7-05 | progressive rollout | SRE/Ops / Product | M7-04 | Not Started | stable SLOs | expand cohorts. |
| M7-06 | 24h/7d/30d verification | Program/SRE / Product | M7-05 | Not Started | post-launch reports | decide program closure. |

## دليل التحديث السريع

عند البدء: حدّث صفاً واحداً على الأقل إلى `In Progress` واكتب رابط خطة العمل في `TASK_LOG.md`.  
عند اكتشاف فشل: غيّر الصف إلى `Blocked` واكتب العائق والمالك وتاريخ المراجعة.  
عند تسليم الكود: استخدم `Ready for Gate` واربط MR ونتائج الاختبارات.  
عند عبور البوابة: استخدم `Completed` فقط بعد الدليل ومراجعة المالك الثانوي.  
عند تغيير الترتيب: لا تعدل الصف فقط؛ أنشئ ADR ثم حدّث `ROADMAP.md` وهذه اللوحة.

