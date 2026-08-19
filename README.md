# وَصْلة / WASLA — Global Logistics OS

> **النوع:** منصة لوجستية وتشغيلية عالمية — Monorepo
>
> **الهدف:** تحويل رؤية «وَصْلة» إلى نظام برمجي قابل للبناء والصيانة والتوسع عالميًا، بحيث يستطيع فريق من 12 مبرمجًا العمل على أجزاء مختلفة دون فقدان السياق أو كسر أجزاء أخرى من النظام.
>
> **الحالة:** Baseline Architecture — v1.0

![status](https://img.shields.io/badge/status-baseline-blue)
![phase](https://img.shields.io/badge/phase-00%20Repository%20Foundation-orange)
![repo](https://img.shields.io/badge/repo-monorepo-black)
![language](https://img.shields.io/badge/i18n-AR%20%7C%20EN%20%7C%20UR-green)

---

## 1. الاسم والوصف

**وَصْلة / WASLA** — منصة لوجستية وتشغيلية عالمية، تبدأ من Telegram، وتجمع النقل، التوصيل، الإسناد، المتاجر، البحث، السمعة، الثقة، التشغيل، ودعم الشركاء في Core واحد قابل للتوسع إلى دول وقنوات أخرى.

الاسم الرسمي: **WASLA — Global Logistics OS**.

---

## 2. الرؤية

الهدف بعيد المدى هو أن تصبح WASLA قابلة للاستخدام في كل دولة يتوفر فيها Telegram، مع إمكانية إضافة قنوات بديلة لاحقًا دون إعادة بناء الـCore.

```text
Telegram
    ↓
Adapters
    ↓
WASLA Core
    ↓
Identity · Orders · Matching · Dispatch · Marketplace · Reputation · Trust · Referral · Chat · Search · Partners · Billing · Support · Admin
    ↓
Data + Events + Observability
    ↓
Country / Regional Expansion
    ↓
Future Channel Independence
```

---

## 3. المبدأ الجوهري

> **Telegram قناة، وليس قلب النظام.**

يجب ألا يعرف Order Engine أو Reputation Engine تفاصيل Telegram. لا نضع `telegram.sendMessage()` داخل Business Logic. المسار الصحيح:

```text
NotificationService
      ↓
Channel Router
      ↓
Telegram Adapter
```

بحيث يمكن لاحقًا إضافة `Web Adapter` و`Mobile Adapter` و`WhatsApp Adapter` دون تعديل Core Domain.

سوق الإطلاق:

```text
Initial Country: Saudi Arabia
Initial Geographic Scope: All Saudi Cities
Year 1 Target Expansion: Gulf + Egypt + Jordan
Long-Term: Global
Base Currency: SAR
Languages: Arabic, English, Urdu
Future Search / Localization: Turkish, Persian and additional locales
```

التوسع الجغرافي لا يعني أن جميع الدول تشترك في نفس قواعد التسعير أو التشغيل أو الامتثال — الدولة كيان Configuration مستقل.

---

## 4. خريطة المستودع

المستودع Monorepo:

```text
wasla/
├── README.md                # هذا الملف — نظرة عامة
├── CONTRIBUTING.md          # سير العمل وقواعد المساهمة
├── SECURITY.md              # قواعد الأمان والإبلاغ عن الثغرات
├── CODEOWNERS              # ملكية المجلدات حسب الفرق
├── CHANGELOG.md             # سجل التعديلات (يُحدث لاحقًا)
├── .gitlab-ci.yml           # pipeline التحقق
├── .gitignore
├── apps/                    # تطبيقات الواجهة (Mini Apps + Admin Web)
│   ├── customer-mini-app/
│   ├── driver-mini-app/
│   ├── partner-mini-app/
│   └── admin-web/
├── bots/                    # بوتات Telegram
│   ├── customer-bot/
│   ├── driver-bot/
│   └── partner-bot/
├── services/                # 24 خدمة (Bounded Contexts)
│   ├── identity/  auth/  geography/  orders/  rides/  delivery/
│   ├── matching/  dispatch/  drivers/  subscriptions/  reputation/
│   ├── fraud/  referrals/  marketplace/  search/  chat/  translation/
│   ├── notifications/  support/  partners/  billing/  compliance/
│   └── audit/  analytics/
├── packages/                # مكتبات مشتركة (contracts, events, ui, i18n, ...)
│   ├── contracts/  events/  ui/  i18n/  auth-sdk/  telemetry/
│   └── errors/  config/  date-time/  test-utils/
├── infra/                   # البنية التحتية
│   ├── terraform/  docker/  kubernetes/  environments/
├── scripts/                 # سكربتات تشغيل ومساعدة
└── docs/                     # الوثائق (17 قسمًا)
    ├── 00-rules/             # القوانين الإلزامية
    ├── 01-product/           # الرؤية، الخدمات، تدفقات المستخدم
    ├── 02-architecture/      # السياق، الحاويات، التوسع
    ├── 03-domain/ ... 17-launch/
```

انظر: [`docs/00-rules/`](docs/00-rules/) للقوانين الإلزامية، و[`docs/16-progress/MASTER_PROGRESS.md`](docs/16-progress/MASTER_PROGRESS.md) لحالة المراحل.

---

## 5. الفرق الـ12

لا يتم توزيع الفريق حسب «ملفات صغيرة»، بل حسب **Bounded Areas** مع عقود واضحة (Contract First).

| الفريق | المجال (Bounded Area) |
|---|---|
| Team 01 | Identity & Auth |
| Team 02 | Customer |
| Team 03 | Driver |
| Team 04 | Matching |
| Team 05 | Dispatch |
| Team 06 | Marketplace |
| Team 07 | Partner |
| Team 08 | Admin |
| Team 09 | Data |
| Team 10 | DevOps |
| Team 11 | Security / QA |
| Team 12 | Integration |

تفاصيل مسؤوليات كل فريق في [`docs/00-rules/`](docs/00-rules/) وملف [`CODEOWNERS`](CODEOWNERS).

---

## 6. مراحل التنفيذ (Phase 00 → 103)

الانتقال بين المراحل يتم فقط بعد اجتياز **Exit Gate** الخاصة بالمرحلة (اختبارات + وثائق + أمان + تكامل). لا يتم الانتقال لمجرد انتهاء البرمجة.

| Phase | الوصف | Exit Gate (مختصر) |
|---|---|---|
| 00 | Repository Foundation | CI يعمل، لا أسرار، main محمي |
| 01 | Identity Foundation | مستخدم من Telegram بهوية مستقرة عبر تغيير Username |
| 02 | Geography & Localization | المستخدم يغيّر موقعه دون حساب جديد، Geo IDs |
| 03 | Telegram Channel Foundation | كل بوت يفتح Mini App، Adapter قابل للاستبدال بـMock |
| 04 | Customer Core | عميل ينشئ Order صالحًا يصل Order Engine |
| 05 | Driver Core | Driver profile مكتمل قابل للإدخال في Candidate pool |
| 06 | Order Engine | إنشاء Order وتغيير حالاته دون حالات مستحيلة |
| 07 | Dispatch & Matching MVP | Request كامل من Customer إلى Driver assignment |
| 08 | Negotiation & Chat | تفاوض وتوافق على السعر مسجّل في Order |
| 09 | Reputation + Fraud Foundation | كل Completed Order ينتج Reputation events |
| 10 | Driver Subscription & Referral | Trial → Active → Expired → Community |
| 11 | Marketplace Foundation | مستخدم ينشئ Store من هويته الحالية |
| 12 | Marketplace Search | منتج منشور يُعثر عليه بالعربي والإنجليزي |
| 13 | Store Orders + Delivery | شراء → تجهيز → إسناد → Pickup → Delivery |
| 14 | Partner / Enterprise | Partner ينشئ طلبًا عبر Portal أو API |
| 15 | Admin Operations | الإدارة تشغّل الحالات اليومية دون SQL يدوي |
| 16 | Support & Escalation | نزاع كامل حتى Resolution وReputation |
| 17 | Billing & Store Platform Fees | Billing قابل للتدقيق منفصل عن Trip Settlement |
| 18 | Observability & Resilience | تعطيل خدمة ثانوية دون إسقاط Core، Restore drill |
| 19 | Security Hardening | لا ثغرات حرجة، لا أسرار في Git، Production access مضبوط |
| 20 | Saudi Launch Readiness | E2E + Load + DR + Runbooks + Docs |
| 21 | Gulf / Egypt / Jordan Expansion | Configuration لكل دولة دون تعديل Core |
| 22 | Global Expansion | Country Packs + adapters محلية |
| 23 | Channel Independence | Core يعمل عبر Telegram/Web/Mobile/Future |
| 24 | Service Extraction | فصل Microservices عند سبب واضح + ADR |

الجدول الكامل بحالة كل مرحلة في [`docs/16-progress/MASTER_PROGRESS.md`](docs/16-progress/MASTER_PROGRESS.md).

---

## 7. كيف يعمل الفريق

- **Contract First:** الفريق المنتج لخدمة يكتب `API Contract` + `Event Contract` + `Data Contract` + `Error Contract`، ثم الفريق المستهلك يطور Mock/Contract Client. هذا يسمح بتوازي العمل دون انتظار اكتمال الخدمة.
- **مهمتان متوازيتان لكل فريق:** `Build` + `Document`.
- **لا تعتمد مرحلة على Team آخر** قبل توفر Contract المطلوب؛ لكن يمكن للفريق العمل على Interfaces / Schemas / Mock services / Contract tests بالتوازي.
- **أي Task بلا توثيق تعتبر غير مكتملة.**

التفاصيل الكاملة في [`CONTRIBUTING.md`](CONTRIBUTING.md) و[`docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md`](docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md).

---

## 8. أول يوم للمطور الجديد

1. اقرأ [`CONTRIBUTING.md`](CONTRIBUTING.md) و[`SECURITY.md`](SECURITY.md).
2. اقرأ القوانين في [`docs/00-rules/`](docs/00-rules/).
3. حدد فريقك في [`CODEOWNERS`](CODEOWNERS).
4. استنسخ المستودع، تأكد أن `CI passes` و`All teams can clone/build/test`.
5. ابدأ من Contract المسؤول عنه فريقك، وليس من الكود مباشرة.

---

## 9. الوثيقة الأم المرجعية

المرجع التنفيذي الكامل (207 قسم) هو الدليل الأم المسمى *Master Execution & Engineering Handbook*. كل قرار جديد يجب أن يدخل سجل القرارات ([`docs/15-decisions/`](docs/15-decisions/)) قبل اعتباره جزءًا من النظام.

القاعدة الأهم:

> **نحن لا نبني Features منفصلة. نحن نبني نظامًا تراكميًا؛ كل مرحلة تجعل المرحلة التالية أسهل، وكل قرار يجب أن يخدم الاستمرارية والتوسع والسمعة والأمان.**

---

## روابط سريعة

- [CONTRIBUTING.md](CONTRIBUTING.md) — سير العمل وقواعد المساهمة
- [SECURITY.md](SECURITY.md) — الأمان والإبلاغ
- [CODEOWNERS](CODEOWNERS) — ملكية المجلدات
- [docs/00-rules/](docs/00-rules/) — القوانين الإلزامية
- [docs/01-product/VISION.md](docs/01-product/VISION.md) — الرؤية والمبادئ
- [docs/02-architecture/SYSTEM_CONTEXT.md](docs/02-architecture/SYSTEM_CONTEXT.md) — المعمار
- [docs/16-progress/MASTER_PROGRESS.md](docs/16-progress/MASTER_PROGRESS.md) — حالة المراحل
- [docs/15-decisions/](docs/15-decisions/) — سجل القرارات (ADR)

## مراجع تقنية خارجية

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Web Apps / Mini Apps: https://core.telegram.org/bots/webapps
- Telegram Web Events: https://core.telegram.org/api/web-events

تُستخدم هذه المراجع للتحقق من قدرات Telegram الحالية، ولا تجعل Telegram جزءًا من Core Domain.
