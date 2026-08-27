# فهرس ملكية العمل (Work Index)

**الحالة:** إلزامي · **آخر تحديث:** `2026-08-25` (مبني على فحص فعلي لشجرة المستودع)
**المرجع الحاكم:** [`LAUNCH_TO_100_ROADMAP.md`](LAUNCH_TO_100_ROADMAP.md) · [`README.md`](README.md)

> **الغرض:** جواب فوري لسؤال «هل هذا مبني أصلًا، ومن يملكه؟» قبل أن يفتح أحد عملًا مكررًا.
>
> **حد هذه الوثيقة:** تعكس ما هو **موجود في الشجرة**، لا ما هو **مُثبَت بالتشغيل**. إثبات التشغيل مسؤولية بوابات M0-08 و`docs/12-testing/`.
>
> **إلزامي:** يُحدَّث هذا الفهرس في نفس المراجعة التي تُنشئ منطقة كود جديدة أو تنقل حالتها.

## مفتاح الحالة

| الحالة | المعنى |
|---|---|
| `Implemented` | كود حقيقي موجود ومغطى ببوابة خروج موثقة |
| `In Progress` | يوجد حجز نشط أو عنصر لوحة جارٍ |
| `Placeholder` | المجلد موجود بـ `.gitkeep` فقط — **لا كود** |
| `Missing` | لا يوجد أصلًا |

---

## 1. الخدمات (`services/`)

| منطقة الكود | الحالة | العنصر المالك | المرحلة | ملاحظة |
|---|---|---|---|---|
| `services/identity/` | Implemented | M1-01 … M1-09 (دَين أمني) | Phase 01 | المصادقة على الحدود غير مكتملة (AUD-004) |
| `services/geography/` | Implemented | — | Phase 02 | |
| `services/customers/` | Implemented | — | Phase 04 | |
| `services/drivers/` | Implemented | — | Phase 05 | |
| `services/orders/` | Implemented | — | Phase 06 | |
| `services/matching/` | Implemented | — | Phase 07 | |
| `services/dispatch/` | Implemented | — | Phase 07 | |
| `services/negotiations/` | Implemented | — | Phase 08 | |
| `services/reputation/` | Implemented | M0-08 (دليل تشغيل) | Phase 09 | |
| `services/subscriptions/` | Implemented | M0-01 (حارس تركيب) | Phase 10 | بوابة الخروج اجتازت · `__tests__/composition.test.ts` يحرس حقنَ الساعةِ والمُوَلِّدِ في `http/server.ts` |
| `services/marketplace/` | **In Progress** | **M5-11** | **Phase 11** | **العمل الجاري حاليًا — 4/6 مراجعات** · الحدُّ HTTP قائمٌ (`docs/04-api/MARKETPLACE_HTTP.md`) |
| `services/search/` | Placeholder | M5-12 | Phase 12 | |
| `services/delivery/` | Placeholder | M5-13 | Phase 13 | |
| `services/partners/` | Placeholder | M5-14 | Phase 14 | |
| `services/rides/` | Placeholder | M5-15 | Phase 15 | |
| `services/referrals/` | Placeholder | M5-16 | Phase 16 | |
| `services/billing/` | Placeholder | M5-17 | Phase 17 | |
| `services/auth/` | Placeholder | M1 | — | يُحسم أولًا: خدمة مستقلة أم توسيع `identity`؟ (قرار M1-01) |
| `services/notifications/` | Placeholder | M3 | — | |
| `services/chat/` | Placeholder | M5 | Phase 08 | جزء من التفاوض حاليًا |
| `services/fraud/` | Placeholder | M6-19 | Phase 09 | |
| `services/compliance/` | Placeholder | M7 | Phase 20 | |
| `services/audit/` | Placeholder | M2 | Phase 18 | |
| `services/analytics/` | Placeholder | M8 | Phase 21+ | ما بعد الإطلاق |
| `services/support/` | Placeholder | M8 | Phase 21+ | ما بعد الإطلاق |
| `services/translation/` | Placeholder | M8 | Phase 21+ | ما بعد الإطلاق |

**الإجمالي المتحقق: 11 خدمة تحوي كودًا · 15 خدمة placeholder.**

---

## 2. الواجهات (`apps/`) — كلها Placeholder

| منطقة الكود | الحالة | العنصر المالك | ملاحظة |
|---|---|---|---|
| `apps/customer-mini-app/` | Placeholder | M3 | حاجز إطلاق |
| `apps/driver-mini-app/` | Placeholder | M3 | حاجز إطلاق |
| `apps/partner-mini-app/` | Placeholder | M3 | حاجز إطلاق |
| `apps/admin-web/` | Placeholder | M3 | حاجز إطلاق |

> **لا يوجد أي منتج قابل للاستخدام في هذا المستودع حتى الآن.** أي وثيقة تدّعي غير ذلك باطلة.

---

## 3. البنية التحتية (`infra/`) — كلها Placeholder

| منطقة الكود | الحالة | العنصر المالك |
|---|---|---|
| `infra/terraform/` | Placeholder | M2 |
| `infra/kubernetes/` | Placeholder | M2 |
| `infra/docker/` | Placeholder | M2 |
| `infra/environments/` | Placeholder | M2 |

---

## 4. القنوات (`bots/`)

| منطقة الكود | الحالة | ملاحظة |
|---|---|---|
| `bots/customer-bot/` | Implemented | Phase 03 |
| `bots/driver-bot/` | Implemented | Phase 03 |
| `bots/partner-bot/` | Implemented | جزئي — يتبع M5-14 |

---

## 5. الحزم المشتركة (`packages/`)

| المجموعة | الحزم | ملاحظة الملكية |
|---|---|---|
| نواة | `config` · `contracts` · `errors` · `events` · `telemetry` · `date-time` · `i18n` · `ui` | **مشتركة عالية الخطورة** — أي تعديل يحتاج حجزًا صريحًا للمسار الفرعي |
| قنوات | `channel-core` · `channel-postgres` · `telegram-adapter` · `bot-runtime` | |
| أمن | `auth-sdk` | يتبع M1 |
| اختبار | `test-utils` · `channel-e2e` · `customer-e2e` · `driver-e2e` · `order-e2e` · `dispatch-e2e` · `negotiation-e2e` · `reputation-e2e` · `subscription-e2e` | كل حزمة `*-e2e` مربوطة ببوابة خروج مرحلتها |

> **تحذير التكرار:** `packages/contracts/` أكثر مسار يتصادم عليه العمل. احجز المسار الفرعي المحدد (مثل `packages/contracts/src/marketplace/`) لا الحزمة كاملة.

---

## 6. الحوكمة والفحوصات

| منطقة الكود | الحالة | العنصر المالك |
|---|---|---|
| `docs/16-progress/` (نظام السجلات) | Implemented | M0-05 |
| `scripts/checks/` | Implemented | M0-05 |
| `scripts/hooks/pre-push` | Implemented | M0-05 |
| `.gitlab-ci.yml` — `governance-guard` | Implemented | M0-05 |
| `scripts/checks/test-governance.sh` | Implemented | M0-12 |
| `scripts/checks/lib/check-shared-ledgers.py` | Implemented | M0-12 |
| `scripts/checks/require-doc-update.sh` | Implemented | M0-11, M0-12 |
| `scripts/checks/validate-work-claims.sh` | Implemented | M0-05, M0-12, M0-13 |
| `scripts/checks/validate-launch-board.sh` | Implemented | M0-05, M0-11 |
| `scripts/checks/lib/meaningful-paths.sh` | Implemented | M0-14, M0-15 |
| `scripts/checks/validate-claim-freshness.sh` | Implemented | M0-16 |
| `scripts/checks/validate-mr-target.sh` | Implemented | M0-17 |
| `scripts/checks/validate-integration-isolation.sh` | Implemented | M0-03 |
| `docs/00-rules/TESTING_RULES.md` §1 (عزلُ اختباراتِ التكامل) | Implemented | M0-03 |
| `services/identity/vitest.integration.config.ts` (تسلسلُ الملفّات) | Implemented | M0-03 |
| `docs/00-rules/GIT_RULES.md` §3.1 (هدفُ الطلب) | Implemented | M0-17 |
| `docs/00-rules/WORK_CLAIM_RULE.md` | Implemented | M0-05, M0-13 |
| `.gitlab-ci.yml` — بوابات E2E حتى Phase 10 | Implemented | M0-08 |
| `.gitlab-ci.yml` — `marketplace-db-integration` | Implemented | M5-11 |
| CI: Load / Chaos / DR / DAST | Missing | M6 |
