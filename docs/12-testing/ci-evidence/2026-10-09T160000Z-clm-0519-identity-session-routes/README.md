# CLM-0519 · ADR-069 المرحلة الأولى — مسارات جلسات الهوية (إصدار/استبدال/سحب)

**التاريخ:** 2026-10-09 · **الفرع:** `feat/clm-0519-identity-session-routes` · **الأساس:** `main` `d3fb79fe` (PR #676 · ADR-069 r2)
**الحالة:** مُنفَّذ محليًا؛ حكم CI على `main` بعد الدمج هو المرجع النهائي (يُحدَّد بعد الدمج)

## الحقائق المُقيسة

### ما أُضيف في هذه المطالبة

| الملف | التغيير |
|---|---|
| `services/identity/src/http/service-identity.ts` | نطاقاتٌ جديدةٌ في `IDENTITY_SCOPES`: `identity:session:issue` / `identity:session:exchange` / `identity:session:revoke` |
| `services/identity/src/use-cases/issue-user-assertion.ts` | توسيع `ASSERTION_AUDIENCES_BY_ACTOR` لجمهور `wua1`: customer += customers/orders/dispatch/reputation/search؛ driver += customers/orders/dispatch (ADR-069 §2.2) |
| `services/identity/src/http/app.ts` | ثلاثة مساراتٍ جديدة: `POST /identity/sessions` (إصدار)، `POST /identity/sessions/exchange` (استبدال)، `POST /identity/sessions/revoke` (سحب). الفاعلُ مشتقٌّ من `serviceIdentity.caller` لا من جسم الطلب (I-03)؛ الإصدارُ من هويةٍ قائمةٍ فقط (لا يُنشئُ مستخدماً)؛ الاستبدالُ يولّدُ `wua1` بعمرٍ ≤ 60 ثانية |
| `services/identity/src/http/errors.ts` | `AuthenticationError` → 401 `UNAUTHENTICATED` / `EXPIRED` / 403 (قبل سقوطِ 503 الاحتياطي) — I-07/I-08 |
| `services/identity/src/domain/errors.ts` | `IDENTITY_USER_SUSPENDED` يُصنَّفُ `forbidden` (403) لا `conflict` (409) — I-11 |
| `services/identity/contracts/errors.md` | تحديثُ صنفِ `IDENTITY_USER_SUSPENDED` إلى `forbidden` |
| `services/identity/src/http/server.ts` | `buildDeps` يُرجعُ `{deps, sessionDeps}`؛ التوصيلُ عبر `createIdentityApp({session})` |
| `services/identity/contracts/api.openapi.yml` | عقد OpenAPI للمسارات الثلاثة + المخططات (`IssueSessionRequest`، `IssueSessionResponse`، `ExchangeSessionRequest`، `ExchangeSessionResponse`، `RevokeSessionRequest`، `RevokeSessionResponse`) |
| `packages/contracts/identity/src/api-types.ts` | مُولَّدٌ من `api.openapi.yml` |
| `packages/contracts/identity/src/index.ts` | 6 أنواعٍ مُصدَّرةٍ جديدة |
| `packages/authz-policy/src/operations.ts` | 3 عملياتٍ جديدة: `identity.session.issue` / `identity.session.exchange` / `identity.session.revoke` |
| `packages/authz-policy/src/grants.ts` | `customer-bot` و`driver-bot` يُمنحانِ النطاقات الثلاثة (`identity:session:issue/exchange/revoke`) — PRODUCTION_GRANTS |
| `packages/authz-policy/src/bindings.ts` | 3 صفوفٍ جديدة (dimension: owner، strength: none) بمسارِ الملفِ إلى `app.ts` + ملاحظةِ حدِّ الثقة للمفتاحِ المشترك |
| `docs/07-security/AUTHORIZATION_POLICY_MATRIX.md` | مصفوفةُ التفويض: `ENFORCED_OPERATIONS = 169`، `ENFORCED_SCOPES = 136`، مساراتٌ مسجَّلةٌ = 148، مصنَّفة = 114، غير مصنَّفة = 169−169 |
| `services/identity/src/__tests__/http/support.ts` | توصيلُ `sessionDeps` في الاختبارِ الوحديِّ (in-memory) |
| `packages/channel-e2e/src/__tests__/clm-0519-identity-sessions.e2e.test.ts` | **بوابةٌ جديدة**: `I-01..I-13` على منفِّذَي الذاكرةِ وPostgresِ حقيقيّ |

### المساراتُ المحجوبةُ (تُوثَّقُ ولا تُفتحُ في هذه المطالبة)

حسبَ تعليمات المالك (قرار المرحلة الأولى)، لم تُغيَّر المساراتُ المصنَّفةُ `conditional` أو `blocked_until_G-ENF` أو `blocked_until_owner_guard` أو `blocked_until_phase_4`. تغييراتُ المصفوفةِ و`grants.ts` تخصُّ النطاقاتِ الثلاثةِ الجديدةِ فقط.

### حدُّ الثقة للمفتاحِ المشترك (توثيقٌ مطلوبٌ من المالك)

`wsvc3` هي **مفاتيحُ خدمةٍ مشتركةٌ عبرَ أسطولِ البوتات** (`WEBAPP_SHARED_FLEET_KEY`): أيُّ حائزٍ على المفتاحِ يوقّعُ بِاسمِ أيِّ بوتٍ في الأسطول. هذا **نفسُ حدِّ الثقةِ** الذي كانت عليهِ مساراتُ `resolve` و`assertions` قبلَ هذه المطالبة — لا يُوسَّعُ ولا يُضيَّق. الدفاعُ الوحيدُ هو تفتيشُ النطاقاتِ (scope) في الرمزِ: `customer-bot` يحملُ `identity:session:*` و`driver-bot` يحملُها أيضاً؛ لكنّ `admin-bot` (أو أيَّ خدمةٍ أخرى) **لا تحملُها**. المسارُ المصادقُ عليه يُشتقُّ الفاعلَ من `serviceIdentity.caller` (اسمُ الخدمةِ الموقِّعة)، لا من جسمِ الطلب.

### الأوامرُ المُنفَّذةُ والنتائجُ

| الأمر | النتيجة |
|---|---|
| `pnpm --filter @wasla/identity-service typecheck` | PASS |
| `pnpm --filter @wasla/identity-service test` | **88/88 PASS** |
| `pnpm --filter @wasla/channel-e2e test` (مع `DATABASE_URL` حقيقي) | **52/52 PASS** — `clm-0519-identity-sessions.e2e.test.ts` = 27 اختباراً (I-01..I-13 على منفِّذَي الذاكرةِ وPostgres) + `phase03-exit-gate` 8/8 + `m1-02-session-gate` 17/17 |
| `bash scripts/checks/validate-authz-policy.sh` | **GREEN** — 169 عمليةً مُصنَّفةً |
| `bash scripts/checks/validate-state-sync.sh origin/main HEAD` | يُنفَّذ قبل الدفع |
| `bash scripts/checks/verify-governance.sh origin/main HEAD` | يُنفَّذ قبل الدفع |
| `bash scripts/verify.sh` (مع `DATABASE_URL`) | يُنفَّذ قبل الدفع |
| `pnpm -r typecheck` | يُنفَّذ قبل الدفع |
| `pnpm -r test` | يُنفَّذ قبل الدفع |

### حالاتُ الاختبارِ I-01..I-13 (الملف: `clm-0519-identity-sessions.e2e.test.ts`)

| الحالة | الوصف | النتيجة المتوقعة |
|---|---|---|
| I-01 | إصدارٌ من `customer-bot` ببصمةٍ صالحة | 201 + رمزٌ لا يُقرأُ إلا مرّةً |
| I-02 | إعادةُ نفسِ البصمة | 409 `IDENTITY_SESSION_REPLAY` (قيدُ المحرّكِ على Postgres) |
| I-03 | `actor_type: "admin"` في الجسمِ يُهجَرُ | 201 والفاعلُ `customer` |
| I-04 | إصدارٌ من خدمةٍ بلا `identity:session:issue` (dispatch) | 403 `IDENTITY_ASSERTION_FORBIDDEN` |
| I-05 | نداءٌ بلا `x-wasla-service-auth` | 401 |
| I-06 | استبدالُ جلسةٍ صالحةٍ لجمهورٍ مسموح | 200 + تأكيدُ `wua1` بعمرٍ ≤ 60 ثانية |
| I-07 | استبدالُ جلسةٍ منتهية | 401 `AUTHN_EXPIRED` |
| I-08 | استبدالُ جلسةٍ مسحوبة / مجهولة | 401 `AUTHN_UNAUTHENTICATED` (نفسُ الرمزِ والنص) |
| I-09 | جمهورٌ غير مسموح | 403 |
| I-10 | `driver-bot` يبدّلُ جلسةَ `customer` | 403 (عدمُ تطابقِ الفاعل) |
| I-11 | مستخدمٌ موقوف | 403 `IDENTITY_USER_SUSPENDED` — لا جلسةَ ولا تأكيد |
| I-12 | لا مفتاحَ توقيع `wua1` | الإصدار 201 + الاستبدال 503 `IDENTITY_ASSERTION_UNAVAILABLE` |
| I-13 | السجلُّ لا يُفصِحُ عن أسرار | `session_token` / `init_data_fingerprint` / `internal_uuid` غير موجودةٍ في `log.info` |

### اختبارات الصلاحيات ورفض إعادة initData وانتهاء الجلسة وسحبها

مُغطّاةٌ في `m1-02-session-gate.e2e.test.ts` (17/17 PASS — انتهاءُ الجلسة، السحب، إعادةُ الاستعمال، الصلاحيات). `I-02` و`I-07` و`I-08` تُعيدُ تأكيدَ ذلكَ في بوابةِ CLM-0519 على Postgresِ حقيقيّ.

### ما لم يُغيَّر (التزامٌ بحكمِ المالك)

- **لا تغيير في الإنتاج أو Render** — لا `deploy`، لا `migration`، لا `secret`، لا `config`.
- **لا ترحيل جديد** — `identity_sessions` موجودةٌ منذ M1-02 (`schema.sql` بلا `ALTER`).
- **المرحلة الثانية** (قائمة السماح، حماية المسارات، توصيل التطبيقات) **لم تُبدأ** — تبقى مطالبةً مستقلة.

## مصادر

- [ADR-069 — human-authentication edge](../../15-decisions/ADR-069-human-authentication-edge-for-apps.md)
- [ENGINEERING_COMPLETION_MATRIX.md](../ENGINEERING_COMPLETION_MATRIX.md) — P-03
- [LAUNCH_EXECUTION_BOARD.md](../../16-progress/LAUNCH_EXECUTION_BOARD.md) — M3-09
- [TASK_LOG.md](../../16-progress/TASK_LOG.md) — CLM-0519
- [WORK_CLAIMS.md](../../16-progress/WORK_CLAIMS.md) — CLM-0519
- [ROADMAP.md](../../../ROADMAP.md) — In-progress CLM-0519
