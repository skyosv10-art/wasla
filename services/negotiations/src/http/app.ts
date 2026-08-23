/**
 * طبقة HTTP لخدمة التفاوض — المنفذ 8091 (Phase 08 · MR 4/6).
 *
 * ## القاعدة البنيوية الوحيدة في هذا الملف
 *
 * المعالج يستقبل `NegotiationRunner` **ولا شيء غيره**. لا `Db` ولا بركة اتصال ولا مستودع
 * في نطاقه، فلا مسارَ يستطيع أن يفتح معاملة أو يلمس جدولاً — الخطأ غير متاح لا مكروه
 * فقط (`src/runner.ts` يقول ذلك، وهذا الملف هو موضع الوفاء به أو فقدانه). كل كتابة تمرّ
 * بـ`runner.write` وهي معاملة واحدة على Postgres ونداءٌ عادي في الذاكرة.
 *
 * ## من أين يأتي رمز الحالة
 *
 * أبداً من رأي معالج. `2xx` يُختار هنا لأنّ النقل وحده يعرف هل أعادت المحاولةُ جواباً
 * محفوظاً (`200`) أم أنشأت (`201`)، وكل `4xx`/`5xx` يأتي من `NegotiationError` مرفوعٍ صنفُه
 * في `@wasla/contracts-negotiation` (انظر `http/errors.ts`). ولذلك **لا `try`/`catch` في أي
 * معالج**: معالجٌ يلتقط خطأه يستطيع أن يُخفيه، ومعالج الخطأ الواحد لا يستطيع.
 *
 * ## `replay` يأتي من حالة الاستخدام لا من هذه الطبقة
 *
 * التفرّد محسومٌ **داخل** حالات الاستخدام بـ`guardIdempotency`، وكل نتيجة تحمل
 * `replay: boolean`. فلا `http/idempotency.ts` في هذه الخدمة ولا بحثٌ مسبق عن صفٍّ هنا
 * يُقرّر الجواب: دورُ النقل أن يترجم علماً يملكه المجالُ أصلاً إلى `200` أو `201`. والبديل —
 * أن يقرأ المعالج المخزن قبل النداء — هو الذي يجعل مفتاحاً مُعاد استخدامه بحمولةٍ
 * **مختلفة** يجيب `200` بينما العقد يقول `409 IDEMPOTENCY_KEY_REUSED`.
 *
 * ## `POST /negotiations/tick`: كتابة، بلا جسم، و`200` دائماً
 *
 * الزمن نبضةٌ لا مؤقّت (ADR-013 قرار 5)، والنبضة كتابةٌ جماعية. لا `traceId` يُمرَّر إلى
 * `runTick` كما يُمرَّر في كل كتابة أخرى: بصمُ مُعرّف طلبٍ واحد على خيوطٍ انتهت صلاحيتها
 * لأسبابها الخاصة يقول إنّ ذلك الطلب سبَّبها. و`handoff_failures > 0` يبقى `200`، لأنّ
 * عدّاداً في الجسم أصدقُ من رمز حالة يُلغي بقيّة العمل.
 *
 * ## المسارات التي تُعيد `404` تُعيده من حالة الاستخدام
 *
 * `readNegotiation` تملك فحصَ الوجود (المستودعات تُجيب `[]` لخيطٍ مجهول)، ولذلك تُبنى
 * `GET …/rounds` و`GET …/messages` عليها لا على قراءةٍ مباشرة: قائمةٌ فارغة لمُعرّفٍ مكتوب
 * خطأً تقول للمُتَّصل «تفاوضٌ بلا أدوار» وهي أسوأ من خطأ، لأنّها جوابٌ يُصدَّق.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { NEGOTIATION_SERVICE_PORT } from "@wasla/contracts-negotiation";

import {
  agreementToWire,
  healthToWire,
  messageToWire,
  roundToWire,
  threadToWire,
  tickResultToWire,
} from "../mappers.js";
import type { NegotiationRunner } from "../runner.js";
import { acceptRound } from "../use-cases/accept-round.js";
import { cancelThread } from "../use-cases/cancel-thread.js";
import { openThread } from "../use-cases/open-thread.js";
import { postMessage } from "../use-cases/post-message.js";
import { proposeRound } from "../use-cases/propose-round.js";
import {
  listNegotiations,
  readAgreement,
  readNegotiation,
} from "../use-cases/read-negotiation.js";
import { rejectRound } from "../use-cases/reject-round.js";
import { runTick } from "../use-cases/run-tick.js";

import { sendNegotiationError } from "./errors.js";
import {
  assertNoBody,
  assertRequestIdLength,
  requireIdempotencyKey,
  toMessageSubmissionBody,
  toPathRoundNo,
  toPathUuid,
  toRoundDecisionBody,
  toRoundProposalBody,
  toRoundRejectionBody,
  toThreadCancelBody,
  toThreadListQuery,
  toThreadOpenBody,
} from "./requests.js";

/** المنفذ المُعلَن، مُصدَّر كي لا يقرأ `server.ts` رقماً مكتوباً بيد. */
export { NEGOTIATION_SERVICE_PORT };

export interface NegotiationHealthDescriptor {
  readonly persistence: "postgres" | "memory";
}

/**
 * مؤشّر النبضة، مُحتفظٌ به في الذاكرة **عن قصد**.
 *
 * يُجيب سؤال «هل ينادي أحدٌ النبضةَ على هذه العمليّة؟» وهو سؤالُ حياةٍ عن المُنادي لا عن
 * البيانات (المُجدول شأن Phase 09). تخزينُه كان سيُجيب سؤالاً آخر — «هل نُبض يوماً في
 * التاريخ؟» — وذاك له جوابٌ أصلاً في `next_tick_at` على الخيوط.
 */
export interface NegotiationTickState {
  lastTickAt: string | null;
}

export interface CreateNegotiationAppOptions {
  readonly runner: NegotiationRunner;
  readonly health?: NegotiationHealthDescriptor;
  readonly tickState?: NegotiationTickState;
  readonly logger?: boolean;
}

const DEFAULT_HEALTH: NegotiationHealthDescriptor = { persistence: "memory" };

function threadIdOf(params: unknown): string {
  return toPathUuid((params as { threadId?: unknown }).threadId, "threadId");
}

function roundNoOf(params: unknown): number {
  return toPathRoundNo((params as { roundNo?: unknown }).roundNo);
}

export function createNegotiationApp(options: CreateNegotiationAppOptions): FastifyInstance {
  const health = options.health ?? DEFAULT_HEALTH;
  const tickState = options.tickState ?? { lastTickAt: null };
  const runner = options.runner;
  // `requestIdHeader` يجعل `x-request-id` القادم من المُتَّصل هو `request.id`، فيسري مُعرّفٌ
  // واحد في سجلّاته وسجلّاتنا و`trace_id` في الجواب. ويُولّد Fastify واحداً حين تغيب
  // الترويسة، فلا يكون `trace_id` فارغاً أبداً.
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: "x-request-id" });

  app.setErrorHandler((error, request, reply) => {
    sendNegotiationError(reply, error, request.id);
  });

  app.get("/health", async (_request, reply) => {
    return reply.status(200).send(
      healthToWire({
        // `degraded` على الذاكرة ليس تشاؤماً: خدمةٌ تحفظ أسعاراً متفاوضاً عليها في الذاكرة
        // ستفقدها، وعلامةٌ خضراء على هذه الحالة هي الطريق الذي تصل به إلى الإنتاج.
        status: health.persistence === "postgres" ? "ok" : "degraded",
        persistence: health.persistence,
        lastTickAt: tickState.lastTickAt,
      }),
    );
  });

  app.post("/negotiations", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const body = toThreadOpenBody(request.body);

    const result = await runner.write((deps) =>
      openThread(deps, body, { idempotencyKey, traceId }),
    );
    return reply.status(result.replay ? 200 : 201).send(threadToWire(result.thread));
  });

  app.get("/negotiations", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const filter = toThreadListQuery(request.query);
    // `NEGOTIATION_FILTER_REQUIRED` يُرفع من `listNegotiations` لا من هنا: «قراءةٌ بلا حدّ»
    // قاعدةُ حِمْلٍ على المخزن، ومَن ينادي حالةَ الاستخدام من داخل العمليّة يخضع لها أيضاً.
    const threads = await runner.read((deps) => listNegotiations(deps, filter));
    return reply.status(200).send({ threads: threads.map(threadToWire) });
  });

  app.post("/negotiations/tick", async (request, reply) => {
    assertRequestIdLength(request.headers);
    // العقد يشترط الترويسة والنبضةُ لا تُسجّل أثر إعادة: وذاك متّسق لا متهاون. تفرّدُ
    // النبضة من حالتها نفسها — تشغيلٌ ثانٍ لا يجد شيئاً مستحقاً فلا يُغيّر شيئاً — وتبقى
    // شكلَ كل كتابة قابلة لإعادة المحاولة ينادي بها مُجدول.
    requireIdempotencyKey(request.headers);
    assertNoBody(request.body);

    const result = await runner.write((deps) => runTick(deps));
    tickState.lastTickAt = result.tickedAt;
    return reply.status(200).send(tickResultToWire(result));
  });

  app.get("/negotiations/:threadId", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const view = await runner.read((deps) => readNegotiation(deps, threadId));
    return reply.status(200).send(threadToWire(view.thread));
  });

  app.post("/negotiations/:threadId/cancel", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const body = toThreadCancelBody(request.body);

    const result = await runner.write((deps) =>
      cancelThread(deps, threadId, body, { idempotencyKey, traceId }),
    );
    // `200` وليس `201` على إعادة المحاولة وعلى الأصل معاً: الإلغاء لا يُنشئ مورداً، وخيطٌ
    // مُلغى مرّتين هو خيطٌ مُلغى واحد.
    return reply.status(200).send(threadToWire(result.thread));
  });

  app.get("/negotiations/:threadId/rounds", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const view = await runner.read((deps) => readNegotiation(deps, threadId));
    return reply.status(200).send({ rounds: view.rounds.map(roundToWire) });
  });

  app.post("/negotiations/:threadId/rounds", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const body = toRoundProposalBody(request.body);

    const result = await runner.write((deps) =>
      proposeRound(deps, threadId, body, { idempotencyKey, traceId }),
    );
    return reply.status(result.replay ? 200 : 201).send(roundToWire(result.round));
  });

  app.post("/negotiations/:threadId/rounds/:roundNo/accept", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const roundNo = roundNoOf(request.params);
    const body = toRoundDecisionBody(request.body);

    const result = await runner.write((deps) =>
      acceptRound(deps, threadId, roundNo, body, { idempotencyKey, traceId }),
    );
    // الجسم هو **الاتفاق** لا الدور: القبول يُنشئ الاتفاق، وهو المورد الذي يسأل عنه
    // المُتَّصل بعدها. ويحمل معه `handoff_state` — فلو فشل التسليم إلى محرّك الطلب فالجواب
    // `201` ومعه «اتُّفق ولم يُسجَّل بعد»، لا خطأٌ يُنكر اتفاقاً وقع (ADR-013 قرار 2).
    return reply.status(result.replay ? 200 : 201).send(agreementToWire(result.agreement));
  });

  app.post("/negotiations/:threadId/rounds/:roundNo/reject", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const roundNo = roundNoOf(request.params);
    const body = toRoundRejectionBody(request.body);

    const result = await runner.write((deps) =>
      rejectRound(deps, threadId, roundNo, body, { idempotencyKey, traceId }),
    );
    // الجسم هو **الخيط** لا الدور المرفوض: السؤال بعد الرفض هو «وماذا الآن؟»، وجوابه في
    // `state` و`current_round_no` و`round_count` — أي هل بقي في الميزانية دورٌ آخر أم أُغلق.
    return reply.status(200).send(threadToWire(result.thread));
  });

  app.get("/negotiations/:threadId/messages", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const view = await runner.read((deps) => readNegotiation(deps, threadId));
    return reply.status(200).send({ messages: view.messages.map(messageToWire) });
  });

  app.post("/negotiations/:threadId/messages", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const body = toMessageSubmissionBody(request.body);

    const result = await runner.write((deps) =>
      postMessage(deps, threadId, body, { idempotencyKey, traceId }),
    );
    return reply.status(result.replay ? 200 : 201).send(messageToWire(result.message));
  });

  app.get("/negotiations/:threadId/agreement", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const agreement = await runner.read((deps) => readAgreement(deps, threadId));
    return reply.status(200).send(agreementToWire(agreement));
  });

  return app;
}
