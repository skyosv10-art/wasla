/**
 * طبقةُ HTTP لخدمة السمعة — المنفذ 8092 (Phase 09 · المراجعة 4/6).
 *
 * ## القاعدةُ البنيوية الوحيدة في هذا الملف
 *
 * المعالجُ يستقبل `ReputationRunner` **ولا شيءَ غيره**. لا `Db` ولا بركةَ اتصال ولا مستودعَ
 * في نطاقه، فلا مسارَ يستطيع أن يفتح معاملةً أو يلمس جدولاً — الخطأُ غيرُ متاحٍ لا مكروهٌ
 * فقط (`src/runner.ts` يقول ذلك، وهذا الملفُ هو موضعُ الوفاء به أو فقدانه). وكلُّ كتابةٍ
 * تمرّ بـ`runner.write` وهي معاملةٌ واحدة على Postgres ونداءٌ عاديّ في الذاكرة.
 *
 * ## من أين يأتي رمزُ الحالة
 *
 * أبداً من رأي معالج. `2xx` يُختار هنا لأنّ النقلَ وحده يعرف هل أعادت المحاولةُ جواباً
 * محفوظاً (`200`) أم أنشأت (`201`)، وكلُّ `4xx`/`5xx` يأتي من `ReputationError` مرفوعٍ
 * صنفُه في `@wasla/contracts-reputation` (انظر `http/errors.ts`). ولذلك **لا `try`/`catch`
 * في أيّ معالج**: معالجٌ يلتقط خطأَه يستطيع أن يُخفيه، ومعالجُ الخطأ الواحد لا يستطيع.
 *
 * ## التكرارُ جوابٌ لا اعتراض
 *
 * إعادةُ نفس الواقعة أو نفس مفتاح المعالجة تُجيب `200` وتُعيد الصفَّ نفسه، ولا تُجيب `409`
 * أبداً. الفرقُ ليس ذوقاً: مستهلكُ أحداثٍ يُعيد التسليم مرّتين حالةٌ **طبيعية** في ناقلٍ
 * يضمن «مرّةً على الأقل»، ورمزُ تعارضٍ عليها يجعل المستهلكَ يُوقف خيطَه أو يُسقط الحدث.
 * و`409` محفوظٌ لحالةٍ أخرى تماماً: **نفسُ المفتاح بحمولةٍ مختلفة**
 * (`REPUTATION_IDEMPOTENCY_KEY_REUSED`)، وهو خطأُ مُتَّصلٍ حقيقيّ يجب أن يعرفه.
 *
 * وقرارُ التكرار محسومٌ **داخل** حالات الاستخدام (`checkIdempotency`)، فدورُ النقل أن
 * يترجم علماً يملكه المجالُ أصلاً. والبديل — أن يقرأ المعالجُ مخزنَ المفاتيح قبل النداء —
 * هو الذي يجعل مفتاحاً مُعادَ استخدامه بحمولةٍ مختلفة يجيب `200`.
 *
 * ## ولماذا يُحفَظ «جوابُ الإعادة» لا «الجوابُ الأوّل»
 *
 * كلُّ كتابةٍ تُمرّر `recordedResponse` تبني الجسمَ الذي سيأخذه **المُعيد**: `200` وحمولةٌ
 * تقول `duplicate: true`. أي أنّ المحفوظَ هو ما ندينُ به لمن يُعيد، لا ما أعطيناه لأوّل
 * مُنادٍ — فذاك أخذ جوابَه ومضى.
 *
 * والبديلُ كان حفظَ `201` كما هو ثمّ تعديلَه عند الإعادة (`{...stored, duplicate: true}`)،
 * وهو الأسوأ في موضعين: يُبقي رمزَ إنشاءٍ محفوظاً في صفٍّ لن يُستعمل أبداً كما هو، ويجعل
 * الجوابَ المُعاد **مبنيّاً** لا محفوظاً — فتضيع الفائدةُ الوحيدة من حفظه، أن يكون حرفياً
 * ولو تغيّر شكلُ المُحوّل بعد نشرٍ.
 *
 * ## القوائمُ تُقلب هنا لا في المنافذ
 *
 * منافذُ القراءة تُعيد **تصاعدياً** لأنّ الحسابَ يحتاج الدفترَ بترتيب وقوعه، والعقدُ يُعيد
 * «أحدثَها أولاً» لأنّ سؤالَ القارئ «ماذا جرى أخيراً؟». والقلبُ والسقفُ (200 صفّاً، و100
 * لنسخ القواعد) قرارُ عرضٍ يملكه النقل: منفذٌ يُعيد مقلوباً كان سيُجبر الحسابَ على قلبِه
 * ثانيةً، وسقفٌ في المنفذ كان سيُخفي وقائعَ عن الحساب نفسه فتصير النتيجةُ كاذبة.
 *
 * ## `POST /reputation/tick`: كتابةٌ، بلا جسم، و`200` دائماً
 *
 * الزمنُ نبضةٌ لا مؤقّت، والنبضةُ كتابةٌ جماعية. و`failures > 0` يبقى `200` لأنّ عدّاداً في
 * الجسم أصدقُ من رمزِ حالةٍ يُلغي بقيّةَ العمل الذي نجح فعلاً.
 *
 * والعقدُ يشترط `Idempotency-Key` على النبضة **ولا تُسجّل** هي صفَّ إعادةٍ، وذاك متّسقٌ لا
 * متهاون: تفرّدُ النبضة من حالتها نفسها — تشغيلٌ ثانٍ لا يجد شيئاً مستحقّاً فلا يُغيّر
 * شيئاً — وحفظُ جوابها كان كذباً صريحاً، لأنّ `ran_at` لحظةُ التشغيل وإعادةُ جوابٍ قديم
 * تقول إنّ نبضةً جرت في لحظةٍ لم تجرِ فيها.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { REPUTATION_SERVICE_PORT } from "@wasla/contracts-reputation";

import {
  factToWire,
  fraudSignalToWire,
  healthToWire,
  ratingToWire,
  rulesetToWire,
  scoreToWire,
  tickResultToWire,
} from "../mappers.js";
import type { ReputationRunner } from "../runner.js";
import { recomputeScore } from "../use-cases/recompute-score.js";
import { recordFact } from "../use-cases/record-fact.js";
import {
  listFacts,
  listFraudSignals,
  listRatings,
  listRulesets,
  readRuleset,
  readScore,
} from "../use-cases/reads.js";
import { runTick } from "../use-cases/run-tick.js";
import { submitRating } from "../use-cases/submit-rating.js";

import { sendReputationError } from "./errors.js";
import {
  assertNoBody,
  assertRequestIdLength,
  requireIdempotencyKey,
  toFactListFilter,
  toFactRecordDraft,
  toFraudSignalListQuery,
  toPathRulesetVersion,
  toPathSubjectPublicId,
  toPathSubjectType,
  toRatingListFilter,
  toRatingSubmitDraft,
} from "./requests.js";

/** المنفذُ المُعلَن، مُصدَّرٌ كي لا يقرأ `server.ts` رقماً مكتوباً بيد. */
export { REPUTATION_SERVICE_PORT };

/** سقفُ صفوف القائمة كما يُعلنه `maxItems` في العقد. */
const ROW_LIMIT = 200;
const RULESET_LIMIT = 100;

export interface ReputationHealthDescriptor {
  readonly persistence: "postgres" | "memory";
}

/**
 * مؤشّرُ النبضة، مُحتفظٌ به في الذاكرة **عن قصد**.
 *
 * يُجيب سؤالَ «هل ينادي أحدٌ النبضةَ على هذه العمليّة؟» وهو سؤالُ حياةٍ عن المُنادي لا عن
 * البيانات. وتخزينُه كان سيُجيب سؤالاً آخر — «هل نُبض يوماً في التاريخ؟» — وذاك له جوابٌ
 * أصلاً في `next_recompute_at` على النتائج.
 */
export interface ReputationTickState {
  lastTickAt: string | null;
}

export interface CreateReputationAppOptions {
  readonly runner: ReputationRunner;
  readonly health?: ReputationHealthDescriptor;
  readonly tickState?: ReputationTickState;
  readonly logger?: boolean;
}

const DEFAULT_HEALTH: ReputationHealthDescriptor = { persistence: "memory" };

/** أحدثُ أولاً وبسقف: المنافذُ تُعيد تصاعدياً، والعرضُ شأنُ هذه الطبقة. */
function newestFirst<T>(rows: readonly T[], limit: number): T[] {
  return rows.slice(-limit).reverse();
}

function subjectOf(params: unknown): {
  readonly subjectType: ReturnType<typeof toPathSubjectType>;
  readonly subjectPublicId: string;
} {
  return {
    subjectType: toPathSubjectType(params),
    subjectPublicId: toPathSubjectPublicId(params),
  };
}

export function createReputationApp(options: CreateReputationAppOptions): FastifyInstance {
  const health = options.health ?? DEFAULT_HEALTH;
  const tickState = options.tickState ?? { lastTickAt: null };
  const runner = options.runner;
  // `requestIdHeader` يجعل `x-request-id` القادمَ من المُتَّصل هو `request.id`، فيسري
  // مُعرّفٌ واحد في سجلّاته وسجلّاتنا و`trace_id` في الجواب. ويُولّد Fastify واحداً حين
  // تغيب الترويسة، فلا يكون `trace_id` فارغاً أبداً.
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: "x-request-id" });

  // جسمٌ فارغ مع `content-type: application/json` **ليس** خطأً في هذه الخدمة.
  //
  // ثلاثةٌ من مساراتها لا `requestBody` لها في العقد (إعادةُ الحساب والنبضة)، وأكثرُ
  // العملاء يضع الترويسةَ افتراضياً على كل `POST` ولو بلا جسم. و`FST_ERR_CTP_EMPTY_JSON_BODY`
  // كان سيردّ `400` على طلبٍ **مطابقٍ للعقد تماماً**، فيصير أوّلُ ما يجرّبه المُتكامِل
  // فاشلاً برسالةٍ عن نوع المحتوى لا عن شيءٍ فعله خطأً.
  //
  // والفراغُ يُحوَّل إلى `undefined` لا إلى `{}`: `assertNoBody` يقبل الاثنين، لكن
  // `toFactRecordDraft` يرفض `undefined` بـ«كائن JSON» ويرفض `{}` بأسماءِ الحقول الناقصة —
  // والأوّل هو الجوابُ الصحيح لمن نسي الجسمَ كلَّه.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, payload, done) => {
      const raw = typeof payload === "string" ? payload.trim() : "";
      if (raw === "") {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch (error) {
        // `statusCode` هو ما يقرؤه `http/errors.ts` ليقول «جسمُ الطلب غير صالح»؛ ورميُ خطأٍ
        // بلا رمزٍ كان سيسقط في فرع `503` فيُقال للمُتَّصل «أعد المحاولة» على JSON مكسور.
        done(Object.assign(error as Error, { statusCode: 400 }), undefined);
      }
    },
  );

  app.setErrorHandler((error, request, reply) => {
    sendReputationError(reply, error, request.id);
  });

  app.get("/health", async (_request, reply) => {
    return reply.status(200).send(
      healthToWire({
        persistence: health.persistence,
        lastTickAt: tickState.lastTickAt,
      }),
    );
  });

  app.post("/reputation/facts", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const draft = toFactRecordDraft(request.body);

    const result = await runner.write((deps) =>
      recordFact(deps, {
        draft,
        traceId,
        idempotencyKey,
        // جوابُ المُعيد: `200` و`duplicate: true`. انظر شرحَ الرأس.
        recordedResponse: (fresh) => ({
          status: 200,
          payload: {
            fact: factToWire(fresh.fact),
            score: scoreToWire(fresh.score),
            duplicate: true,
          },
        }),
      }),
    );

    // الجوابُ المحفوظ يُعاد **حرفياً** إن وُجد. وإن كانت الواقعةُ مكرّرةً بلا جوابٍ محفوظ
    // (إعادةُ تسليمٍ من مُرسِلٍ بلا مفتاحٍ في المرّة الأولى) يُبنى الجسمُ من الصفوف نفسها،
    // وهو صحيحٌ لأنّ الصفَّ المُعاد هو الصفُّ الأوّل بعينه لا نسخةٌ منه.
    if (result.replayedResponse !== undefined) {
      return reply.status(result.replayedResponse.status).send(result.replayedResponse.payload);
    }
    return reply.status(result.duplicate ? 200 : 201).send({
      fact: factToWire(result.fact),
      score: scoreToWire(result.score),
      duplicate: result.duplicate,
    });
  });

  app.get("/reputation/facts", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const filter = toFactListFilter(request.query);
    // `REPUTATION_FILTER_REQUIRED` يُرفع من `listFacts` لا من هنا: «قراءةٌ بلا حدّ» قاعدةُ
    // حِمْلٍ على المخزن وعلى خصوصية الناس، ومن ينادي حالةَ الاستخدام من داخل العمليّة
    // يخضع لها أيضاً.
    const facts = await runner.read((deps) => listFacts(deps, filter));
    return reply.status(200).send({ facts: newestFirst(facts, ROW_LIMIT).map(factToWire) });
  });

  app.get("/reputation/scores/:subjectType/:subjectPublicId", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const subject = subjectOf(request.params);
    // `404` يأتي من `readScore`: المستودعُ يُجيب `null` لمن لا نتيجةَ له، ونتيجةٌ افتراضية
    // هنا كانت ستقول لمستهلكٍ «60» عن غريبٍ لم يعمل معنا شيئاً.
    const score = await runner.read((deps) => readScore(deps, subject));
    return reply.status(200).send(scoreToWire(score));
  });

  app.post("/reputation/scores/:subjectType/:subjectPublicId/recompute", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const subject = subjectOf(request.params);
    assertNoBody(request.body);

    const result = await runner.write((deps) =>
      recomputeScore(deps, {
        ...subject,
        traceId,
        idempotencyKey,
        recordedResponse: (fresh) => ({ status: 200, payload: scoreToWire(fresh.score) }),
      }),
    );

    if (result.replayedResponse !== undefined) {
      return reply.status(result.replayedResponse.status).send(result.replayedResponse.payload);
    }
    // `200` لا `201` على الأصل أيضاً: إعادةُ الحساب لا تُنشئ مورداً، والنتيجةُ التي تُعاد
    // قد تكون مطابقةً للسابقة تماماً — وذاك نجاحٌ لا لاشيء.
    return reply.status(200).send(scoreToWire(result.score));
  });

  app.post("/reputation/ratings", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const draft = toRatingSubmitDraft(request.body);

    const result = await runner.write((deps) =>
      submitRating(deps, {
        draft,
        traceId,
        idempotencyKey,
        recordedResponse: (fresh) => ({
          status: 200,
          payload: {
            rating: ratingToWire(fresh.rating),
            fact: factToWire(fresh.fact),
            score: scoreToWire(fresh.score),
          },
        }),
      }),
    );

    if (result.replayedResponse !== undefined) {
      return reply.status(result.replayedResponse.status).send(result.replayedResponse.payload);
    }
    return reply.status(201).send({
      rating: ratingToWire(result.rating),
      fact: factToWire(result.fact),
      score: scoreToWire(result.score),
    });
  });

  app.get("/reputation/ratings", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const filter = toRatingListFilter(request.query);
    const ratings = await runner.read((deps) => listRatings(deps, filter));
    return reply
      .status(200)
      .send({ ratings: newestFirst(ratings, ROW_LIMIT).map(ratingToWire) });
  });

  app.get("/reputation/fraud-signals", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const { filter, severity } = toFraudSignalListQuery(request.query);
    const signals = await runner.read((deps) => listFraudSignals(deps, filter));
    // ترشيحُ الشِدّة بعد المخزن — `requests.ts` يشرح لماذا لا يدخل منفذَ القراءة.
    const matching =
      severity === undefined ? signals : signals.filter((signal) => signal.severity === severity);
    return reply
      .status(200)
      .send({ signals: newestFirst(matching, ROW_LIMIT).map(fraudSignalToWire) });
  });

  app.get("/reputation/rulesets", async (request, reply) => {
    assertRequestIdLength(request.headers);
    // بلا مُرشِّحٍ إلزاميّ، وهو الاستثناءُ الوحيد: مجموعةٌ تنمو بإصدارٍ لا بحركة مستخدمين.
    const rulesets = await runner.read((deps) => listRulesets(deps));
    return reply
      .status(200)
      .send({ rulesets: newestFirst(rulesets, RULESET_LIMIT).map(rulesetToWire) });
  });

  app.get("/reputation/rulesets/:rulesetVersion", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const rulesetVersion = toPathRulesetVersion(request.params);
    // `readRuleset` لا `readUsableRuleset`: من يقرأ نسخةً للمراجعة يحتاج أن يرى ما فيها
    // بما فيه `is_frozen: false`؛ والتجميدُ شرطُ الحساب بها لا شرطُ النظر إليها.
    const ruleset = await runner.read((deps) => readRuleset(deps, rulesetVersion));
    return reply.status(200).send(rulesetToWire(ruleset));
  });

  app.post("/reputation/tick", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    requireIdempotencyKey(request.headers);
    assertNoBody(request.body);

    const result = await runner.write((deps) => runTick(deps, { traceId }));
    tickState.lastTickAt = result.ranAt;
    return reply.status(200).send(tickResultToWire(result));
  });

  return app;
}
