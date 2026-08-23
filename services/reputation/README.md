# `@wasla/reputation-service` — خدمة السمعة وإشارات الاحتيال

> **السمعة نتيجةٌ مُشتقّة من دفتر وقائع، والاحتيال إشاراتٌ مُسمّاة لا حُكم، والخدمة لا تعاقب أحداً.**
>
> — عبارة Phase 09 الحاكمة · [ADR-014](../../docs/15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md) · [REPUTATION_FRAUD](../../docs/03-domain/REPUTATION_FRAUD.md) · [REPUTATION_CORE_DOMAIN](../../docs/02-architecture/REPUTATION_CORE_DOMAIN.md)

هذه الحزمة **المجالُ والاستمراريّةُ وطبقةُ HTTP**: حسابٌ نقيٌّ وحالاتُ استخدامٍ ومنافذُ (ports)
و**مُهيئان** لها — الذاكرةُ وPostgres — ووحدةُ عملٍ تجعل كلَّ كتابةٍ معاملةً واحدة، وخادمُ
Fastify على المنفذ **8092** ينادي **نفس** هذه الحالات عبر `ReputationRunner` بلا تعديلٍ فيها
([REPUTATION_HTTP.md](../../docs/04-api/REPUTATION_HTTP.md)). **وما لم يُبنَ بعد**: مستهلكُ
أحداثِ الطلب وناشرُ صندوق الصادر (5/6) وبوّابةُ الخروج (6/6) — انظر
[خارطة المراجعات](#خارطة-مراجعات-الطور).

```bash
pnpm --filter @wasla/reputation-service dev    # بلا DATABASE_URL ⇒ ذاكرة و status=degraded
curl -s localhost:8092/health
```

> **الاستمراريّةُ لا تُستورَد من سطح الحزمة بقصد:** `import { … } from "@wasla/reputation-service"`
> يُعطيك المجالَ ومُهيئَ الذاكرة ولا يُحمّل سائقَ قاعدةٍ معك. مقبضُ Postgres والمُشغّل
> يُستورَدان بمسارهما الصريح (`.../src/infrastructure/drizzle/db.js` · `.../src/runner.js`)،
> فيكون الاعتمادُ على القاعدة **خياراً مكتوباً في سطر الاستيراد**. التفصيل الكامل في
> [REPUTATION_PERSISTENCE.md](../../docs/02-architecture/REPUTATION_PERSISTENCE.md).

---

## ما تفعله الخدمة

| المدخل | ما يحدث | المخرج |
| --- | --- | --- |
| واقعةٌ من حدثٍ منشور (`order.completed` …) | تُقيَّد في دفترٍ لا يُعدَّل، ثم تُعاد حسبةُ النتيجة من الدفتر كلِّه | `reputation.fact_recorded` + `reputation.score_recomputed` (+ `tier_changed` عند التغيّر فعلاً) |
| تقييمٌ من طرفٍ في طلبٍ مكتمل | يُخزَّن، ثم تُشتقّ منه واقعةُ `rating_received` في الدفتر | `reputation.rating_submitted` + `fact_recorded` |
| نبضةٌ دوريّة | تُعاد حسبةُ المستحقّين (تلاشي الزمن)، وتُقيَّم القواعدُ الخمس على نافذةٍ محسوبة | `score_recomputed` + `reputation.fraud_signal_raised` |

**وما لا تفعله:** لا تُوقف أحداً، ولا تحظر، ولا تُصدر «احتمالَ احتيالٍ»، ولا تقرأ جدولَ
طلباتٍ ولا سائقين، ولا تكتب في بيانات خدمةٍ أخرى. الإيقافُ يملكه `services/drivers`
(ADR-012 القرار 3)، والقرارُ الإداريّ يملكه Phase 15.

---

## المبادئ التي يفرضها الكود

1. **الواقعة تُخزَّن والنقطة تُشتقّ.** لا عدّادَ يُزاد. كلُّ نتيجةٍ حسبةٌ كاملةٌ من الدفتر،
   فواقعةٌ سُلّمت مرّتين لا تُضاعف نقطةً، وخطأٌ حسابيٌّ يُصحَّح بإعادة تشغيل لا بترحيل بيانات.
2. **الأرقام بياناتٌ لا كود.** الأوزانُ والحدودُ والعتباتُ والنوافذُ في نسخةِ قواعدٍ
   **مجمّدة**، وكلُّ نتيجةٍ وإشارةٍ تحمل `rulesetVersion`. فيبقى «لماذا نقاطي 62؟» سؤالاً له
   جوابٌ بعد سنة. ووزنٌ غيرُ مُعلَنٍ يُردّ `RULE_WEIGHT_MISSING` (422) ولا يُعالج بـ`?? 0`
   الصامت.
3. **الزمن يدخل ولا يُقرأ.** لا `Date.now()` ولا `setTimeout` ولا `sleep` في الحزمة كلِّها
   (يفرضه `src/__tests__/purity.test.ts` على الكود بعد حذف التعليقات). اللحظةُ تأتي من
   `Clock` المحقون، والاستحقاقُ صفٌّ مخزّن (`nextRecomputeAt`) لا مؤقّتٌ في الذاكرة — فإعادةُ
   تشغيل الخدمة لا تُفقِد حساباً.
4. **إعادةُ التسليم ليست خطأً.** نفسُ مفتاح المصدر بنفس الحمولة ⇒ `duplicate: true` بلا
   نقطةٍ ثانيةٍ وبلا حدثٍ ثانٍ. بحمولةٍ مختلفة ⇒ `FACT_ALREADY_RECORDED` (409).
   ([`errors.md` القاعدة 4](contracts/errors.md))
5. **الإشارةُ تشرح نفسها.** قاعدةٌ مُسمّاة، ونافذةٌ بحدَّيها، وعددٌ مرصود، وعتبةٌ مُعلَنة،
   ونسخةُ قواعد. لا احتمالٌ إحصائيّ: من يُراجَع بـ«احتمال 0.87» لا يستطيع الردّ.
6. **القيودُ مفروضةٌ بأسمائها.** مُهيئُ الذاكرة يرفض ما ترفضه Postgres وبنفس اسم القيد،
   ويُحرَس ذلك بحارسٍ يقرأ `contracts/schema.sql` نفسه.

---

## الشكل الداخليّ

```
src/
├── domain/            ← لا تبعيّةَ على شيء: أرقامٌ ودوالُّ وأخطاءٌ مُسمّاة
│   ├── contract-sets.ts   القوائمُ المُقفلة من حزمة العقود (مصدرٌ واحد)
│   ├── model.ts           الصفوفُ والمسوّدات وأنماطُ المُعرّفات
│   ├── errors.ts          17 رمزَ خطأٍ بمصانعها — ولا رمزَ عقابيّ
│   ├── time.ts            تحويلاتٌ نقيّة + نافذةُ الاحتيال + التلاشي
│   ├── validation.ts      حرّاسُ المدخلات (400 قبل أي قراءة)
│   ├── ruleset.ts         نسخةُ القواعد وثوابتُها وأوزانُها
│   ├── score.ts           الحسبة: تلاشٍ بنصف عمرٍ 180 يوماً ⇒ رقمٌ ورتبة
│   ├── fraud.ts           القواعدُ الخمس، كلُّ واحدةٍ تُعيد إشارةً أو لا شيء
│   └── events.ts          خمسةُ أحداثٍ بمظروفٍ واحد
├── ports.ts           ← ما تحتاجه الخدمة من العالم، موصوفاً بلا مُهيّئ
├── use-cases/         ← ترتيبُ الحرّاس والكتابةُ والأحداث
│   ├── record-fact.ts · submit-rating.ts · recompute-score.ts
│   ├── run-tick.ts · reads.ts · shared.ts
├── runner.ts          ← `ReputationRunner {write, read}`: يُخفي «معاملةٌ أو لا معاملة»
└── infrastructure/
    ├── constraints.ts     15 قيداً مفروضاً **بأسمائها** كما في الـDDL
    ├── in-memory.ts       مخازنُ للاختبار: ساعةٌ يدويّة ومُعرّفاتٌ متتالية
    └── drizzle/           ← **الموضعُ الوحيد الذي يعرف SQL في الحزمة**
        ├── schema.ts          مرآةُ `contracts/schema.sql` (تسعةُ جداول) بحارس انحراف
        ├── db.ts              المسبحُ والمقبض — ولا استعلامَ فيه
        ├── repository.ts      سبعةُ مستودعاتٍ + مترجمُ أخطاءٍ يحمل **اسمَ القيد**
        └── transaction.ts     **حدُّ المعاملة**: لا شيءَ غيره ينادي `db.transaction`
```

**اتجاه التبعيّة واحد:** `domain → ports → use-cases → infrastructure`. لا شيءَ في
`domain/` ولا في `use-cases/` يعرف أنّ هناك مخزناً — **ولا أنّ هناك معاملة**. ولذلك سكن
`runner.ts` خارج `use-cases/`: مُساعدٌ يُركّب المعاملات شأنٌ بنيويّ، ولو جاورها لصار المجالُ
على بعد `import` واحدٍ من معرفة القاعدة.

---

## القواعدُ الخمس (النسخة 1)

| الرمز | الجانب | العتبة | الشدّة |
| --- | --- | --- | --- |
| `repeated_customer_cancellation` | عميل | 5 | medium |
| `repeated_driver_cancellation` | سائق | 4 | medium |
| `accept_then_abandon` | سائق | 3 | high |
| `offer_timeout_streak` | سائق | 10 | low |
| `rating_extremity_burst` | عميل | 8 | low |

النافذةُ سلّةٌ يوميّةٌ محسوبة: `endedAt = بدايةُ يوم(الآن) + يوم` (غيرُ شاملة)، و
`startedAt = endedAt − fraudWindowDays`. فكلُّ نبضاتِ اليومِ الواحد تُنتج نفسَ النافذة،
وقيدُ `ux_fraud_signals_rule_window` يجعل الإشارةَ **واحدةً** لكل قاعدةٍ × شخصٍ × نافذة —
ولو رُكضت النبضةُ عشرَ مرّاتٍ في اليوم.

`accept_then_abandon` تعدّ **الطلبات** التي فيها قبولٌ وإلغاءُ سائقٍ معاً، لا عددَ الوقائع:
عدُّ الوقائع كان سيبلغ العتبةَ بنصف نمط.

---

## الحساب

```
النتيجة = البداية (60) + Σ ( وزنُ الواقعة × 2^(−عمرُ الواقعة بالأيام / 180) )
```

ثمّ تقريبٌ نصفيٌّ لأعلى، ثمّ حصرٌ في [0, 100]. والرتبةُ من الرقم **وعددِ الوقائع**:
دون 5 وقائع تبقى `new` مهما كان الرقم — نتيجةٌ من واقعةٍ واحدة رأيٌ لا قياس.

| الشرط | الرتبة |
| --- | --- |
| وقائع < 5 | `new` |
| نقاط < 35 | `under_watch` |
| نقاط ≥ 80 | `trusted` |
| غير ذلك | `standard` |

`under_watch` **تسميةٌ تُقرأ ولا تُنفَّذ**: لا شيءَ في المنصّة يمنع صاحبَها من شيء.

---

## الاستخدام

```ts
import {
  createInMemoryReputationDependencies,
  recordFact,
  runTick,
  submitRating,
} from "@wasla/reputation-service";

const deps = createInMemoryReputationDependencies({ startAt: "2026-03-01T12:00:00.000Z" });

await recordFact(deps, {
  draft: {
    subjectType: "driver",
    subjectPublicId: "WS-2000000002",
    factKind: "order_completed",
    orderPublicId: "ORD-0000000001",
    sourceEventType: "order.completed",
    sourceEventId: "evt-1",
    sourceSequence: 7,
    actorType: "system",
    reasonCode: null,
    occurredAt: "2026-03-01T11:00:00.000Z",
  },
});

deps.clock.advanceHours(24);       // ساعةٌ تُدفَع بيد، لا انتظارَ زمنٍ حقيقيّ
const tick = await runTick(deps);  // { scoresRecomputed, tiersChanged, fraudSignalsRaised, failures }
```

`InMemoryOutbox` يُراكم الأحداثَ في `deps.outbox.appended`. وعلى Postgres تُكتب الأحداثُ في
جدول `reputation_outbox` **في نفس معاملة** الواقعةِ والنتيجة — أمّا **الناشرُ** الذي يقرأ
الجدولَ ويُرسل فدَينٌ مُعلَنٌ في 5/6 (كما في الأطوار 06 · 07 · 08).

ونفسُ النداء يعمل على المخزنَين إذا كُتب على `ReputationRunner`. وسطحُ الحزمة يُصدّر `"."`
وحده، فالمُشغّلُ ومقبضُ القاعدة يُستورَدان **بمسارٍ نسبيّ من داخل الخدمة** — وهو ما تفعله
حزمةُ التكامل فعلاً وما ستفعله طبقةُ HTTP في 4/6:

```ts
import { recordFact } from "./index.js";
import { createDirectReputationRunner, PostgresReputationRunner } from "./runner.js";
import { createReputationDb } from "./infrastructure/drizzle/db.js";

// ذاكرة: لا معاملةَ تُفتَح، والصدقُ في ذلك مقصودٌ لا تهاون
const memory = createDirectReputationRunner(deps);

// Postgres: معاملةٌ واحدة لكل كتابة، والساعةُ والمُعرّفات تُحقَنان مرّةً واحدة
const { pool, db } = createReputationDb({ connectionString: process.env.DATABASE_URL! });
const postgres = new PostgresReputationRunner(db, { clock, ids });

// نفسُ السطر على المُشغّلَين — وهو بعينه ما تقيسه حزمةُ المطابقة
const out = await postgres.write((deps) => recordFact(deps, { draft }));
```

---

## التشغيل

```bash
pnpm --filter @wasla/reputation-service typecheck
pnpm --filter @wasla/reputation-service test
```

**166 اختباراً في 9 ملفات بلا قاعدةٍ أصلاً**، كلُّها بساعةٍ مدفوعةٍ بيدٍ ومُعرّفاتٍ متتالية: لا
`sleep` ولا `new Date()` ولا `Math.random()` في أي اختبار، فتُعطي الحزمةُ نفسَ النتيجة اليوم
وبعد سنة وعند منتصف الليل أيضاً.

ومعها **52 اختبارَ تكاملٍ على محرّكٍ حقيقيّ** (قيست محلّيّاً على PostgreSQL 18.4):

```bash
export DATABASE_URL="postgres://…"   # وصفةٌ بلا root في docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md
pnpm --filter @wasla/reputation-service test:integration
```

**وبلا `DATABASE_URL` تتخطّى الحزمةُ الثلاثةَ ملفّاتٍ بكاملها** (`skipIf`) ولا تُخضِّر شيئاً
بـ`expect(true)` — تفادياً للعيب الذي ظهر في الطور 08 حيث كانت مئةٌ وأربعون اختباراً تتخطّى
نفسها بصمتٍ وهي تبدو ناجحة.

| الملف | ما يحرسه |
| --- | --- |
| `score.test.ts` | التلاشي عند نصف العمر وضِعفه، سلّمُ الرتب، الترتيبُ لا يُغيّر الرقم |
| `fraud.test.ts` | القواعدُ الخمس: دون العتبة، عندها، خارج النافذة، الجانبُ الخطأ |
| `record-fact.test.ts` | إعادةُ التسليم لا تُضاعف ولا تُنتج حدثاً ولا تُردّ خطأً |
| `submit-rating.test.ts` | الطرفيّة والنافذةُ والمعالجةُ الواحدة والواقعةُ المُشتقّة |
| `run-tick.test.ts` | النبضةُ قابلةٌ للتكرار، وفشلُ صفٍّ يُعَدّ ولا يُرمى |
| `reads.test.ts` | المُرشِّحُ إلزاميّ، وحرسُ التزامن المتفائل |
| `constraints.test.ts` | **حارسٌ سلبيّ**: كلُّ `CONSTRAINT` في الـDDL مفروضٌ بنفس الاسم |
| `purity.test.ts` | **حارسٌ سلبيّ**: لا ساعةَ ولا شبكةَ ولا قاعدةَ ولا حقلَ عقوبةٍ في الكود — والسائقُ محصورٌ في `infrastructure/drizzle/` بطبقتَي سماحٍ صريحتَين |
| `schema-drift.test.ts` | **حارسٌ سلبيّ**: مرآةُ Drizzle ↔ `schema.sql` في **الاتجاهين** (أعمدةٌ وأنواعٌ وقيودٌ وفهارس) |
| `repository.integration.test.ts` | كلُّ منفذٍ على صفوفٍ حقيقيّة · نسخةُ القواعد **من البذرة** · أسماءُ القيود · الترتيبُ والمُرشِّحات |
| `port-conformance.integration.test.ts` | **مطابقةُ المُهيئَين**: 15 قيداً باسمٍ واحدٍ في المخزنَين + سيناريوٌ كاملٌ يُنفَّذ مرّتين فتُقارَن الصفوفُ حرفياً |
| `atomicity.integration.test.ts` | الجداولُ الثلاثة معاملةً واحدة: فشلٌ بعد الكتابة يُرجِع كلَّ شيء |

الحارسان السلبيّان يقرآن **سطحاً آليّاً** (الـDDL بعد حذف التعليقات، والكودُ بعد حذفها) لا
نثراً: حارسٌ يقرأ شرحاً يجعل أرخصَ طريقةٍ لتخضيره حذفَ الشرح.

---

## خارطة مراجعات الطور

| # | المحتوى | الحالة |
| --- | --- | --- |
| 1/6 | العقود المجمّدة + ADR-014 + `@wasla/contracts-reputation` | ✅ مدموجة |
| 2/6 | طبقة المجال النقيّة | ✅ مدموجة |
| 3/6 | مستودعات Drizzle/Postgres + وحدةُ عمل + ترحيلٌ عكوس + مطابقةُ المُهيئَين | ✅ مدموجة |
| **4/6** | **خادم HTTP على المنفذ 8092 وفق `contracts/api.openapi.yml`** (تسعةُ مسارات · إحدى عشرة عمليّة · `/health` بحالتيه) | ✅ **هذه المراجعة** |
| 5/6 | مستهلكُ أحداثِ الطلبات + ناشرُ `reputation_outbox` | ⬜ التالي |
| 6/6 | بوّابةُ خروج الطور: `packages/reputation-e2e` — طلبٌ مكتملٌ واحدٌ عبر HTTP ⇒ **حدثٌ واحدٌ بالضبط**، وإعادةُ التسليم لا تُضاعف | ⬜ |

**الطورُ لا يُعَدّ مكتملاً قبل 6/6.** التفاصيلُ ومَن يعمل على ماذا في
[`docs/16-progress/HANDOFF_NEXT_STEPS.md` §16](../../docs/16-progress/HANDOFF_NEXT_STEPS.md).

## الدَّين المعروف

- **لا ناشرَ للـoutbox بعد.** الجدولُ موجودٌ ويُكتب فيه في نفس المعاملة، والناشرُ في 5/6.
- **لا مستهلكَ لأحداث الطلبات.** الوقائعُ تُقيَّد بنداءٍ مباشرٍ الآن؛ الاشتراكُ في 5/6.
- ~~`response_status = 200` و`response_body = {}` قيمتان محفوظتان مؤقّتاً~~ ⇒ **سُدّ في 4/6**:
  العمودان يحملان الآن **الجوابَ المستحقَّ لمن يُعيد المفتاح**، ويُعاد كما هو بلا إعادة بناء
  ([REPUTATION_HTTP.md §3](../../docs/04-api/REPUTATION_HTTP.md)).
- **`source_event_id` من نوع `UUID`** في العقد، فمُعرّفٌ مُركّبٌ مثل `c-ORD-1` يمرّ في الذاكرة
  ويُرفَض من Postgres بـ`22P02` **بلا اسمِ قيد** — انحرافٌ موثَّقٌ باختبارٍ لا مكتوم
  ([REPUTATION_PERSISTENCE §8](../../docs/02-architecture/REPUTATION_PERSISTENCE.md)).
