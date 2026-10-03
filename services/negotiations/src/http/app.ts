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
  registerServiceIdentity,
  NEGOTIATIONS_SCOPES,
  type NegotiationsRouteConfig,
  type NegotiationsServiceIdentityOptions,
} from "./service-identity.js";
import type { UserAssertionMode, UserAssertionPublicKeys } from "@wasla/service-auth";
import type { VerifiedEndUser } from "@wasla/service-auth/fastify";
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
import { canonicalJson } from "./canonical-json.js";

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
  /**
   * فرضُ هويّةِ الخدمةِ — **إلزاميٌّ** (`M1-04`). ولا قيمةَ افتراضيّةَ لهُ عن
   * قصدٍ: حدٌّ يُقلِعُ بلا مفاتيحَ حدٌّ مفتوحٌ، والافتراضُ الصامتُ هوَ الذي
   * يجعلُ حدّاً يُظَنُّ مفروضاً وهوَ مكشوفٌ.
   */
  readonly serviceIdentity: NegotiationsServiceIdentityOptions;
  /** ADR-060 P2 (CLM-0441): user assertion config for `beneficiary: "asserted"` routes. */
  readonly userAssertion?: {
    readonly mode: UserAssertionMode;
    readonly publicKeys: UserAssertionPublicKeys;
    readonly skewSeconds?: number;
  };
}

/**
 * `/health` وحدَهُ مفتوحٌ: لا يقرأُ بياناتٍ مجاليّةً ولا يكتبُها، ومِسبارُ
 * حياةٍ لا يستطيعُ أن يحملَ رمزاً.
 */
const OPEN: NegotiationsRouteConfig = { serviceIdentity: "open" };

function scoped(...scopes: readonly string[]): NegotiationsRouteConfig {
  return { serviceIdentity: { scopes } };
}

/** ADR-060 P2 (CLM-0441): route with `beneficiary: "asserted"` — the end-user identity is verified by the middleware, and the handler compares resource ownership. */
function asserted(
  ...scopes: readonly string[]
): NegotiationsRouteConfig {
  return {
    serviceIdentity: {
      scopes,
      beneficiary: "asserted",
      actors: ["customer", "driver"],
    },
  };
}

/** ADR-060 P2: route where only the customer may act (accept/reject/list). */
function assertedCustomer(
  ...scopes: readonly string[]
): NegotiationsRouteConfig {
  return {
    serviceIdentity: {
      scopes,
      beneficiary: "asserted",
      actors: ["customer"],
    },
  };
}

/** ADR-060 P2: route where only the driver may act (propose). */
function assertedDriver(
  ...scopes: readonly string[]
): NegotiationsRouteConfig {
  return {
    serviceIdentity: {
      scopes,
      beneficiary: "asserted",
      actors: ["driver"],
    },
  };
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

  // RISK-0013 (CLM-0417): one canonical serializer for every reply, so an idempotent
  // replay (read back from JSONB) is byte-identical to the first answer.
  app.setReplySerializer((payload) => canonicalJson(payload));

  app.setErrorHandler((error, request, reply) => {
    sendNegotiationError(reply, error, request.id);
  });

  // قبلَ أوّلِ مسارٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَهُ لا ما قبلَهُ.
  registerServiceIdentity(app, {
    ...options.serviceIdentity,
    ...(options.userAssertion === undefined
      ? {}
      : { userAssertion: options.userAssertion }),
  });

  app.get("/health", { config: OPEN }, async (_request, reply) => {
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

  app.post("/negotiations", { config: asserted(NEGOTIATIONS_SCOPES.threadWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const body = toThreadOpenBody(request.body);
    // ADR-060 P2: `opened_by` must match `endUser` when assertion is verified.
    assertOpenedBy(request.endUser, body.opened_by);

    const result = await runner.write((deps) =>
      openThread(deps, body, { idempotencyKey, traceId }),
    );
    return reply.status(result.replay ? 200 : 201).send(threadToWire(result.thread));
  });

  app.get("/negotiations", { config: asserted(NEGOTIATIONS_SCOPES.threadRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const filter = toThreadListQuery(request.query);
    // ADR-060 P2: the list filter must match the asserted end-user.
    assertListFilter(request.endUser, filter);
    // `NEGOTIATION_FILTER_REQUIRED` يُرفع من `listNegotiations` لا من هنا: «قراءةٌ بلا حدّ»
    // قاعدةُ حِمْلٍ على المخزن، ومَن ينادي حالةَ الاستخدام من داخل العمليّة يخضع لها أيضاً.
    const threads = await runner.read((deps) => listNegotiations(deps, filter));
    return reply.status(200).send({ threads: threads.map(threadToWire) });
  });

  app.post("/negotiations/tick", { config: scoped(NEGOTIATIONS_SCOPES.tickRun) }, async (request, reply) => {
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

  app.get("/negotiations/:threadId", { config: asserted(NEGOTIATIONS_SCOPES.threadRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const view = await runner.read((deps) => readNegotiation(deps, threadId));
    // ADR-060 P2: thread read requires party membership.
    assertThreadMembership(request.endUser, view.thread);
    return reply.status(200).send(threadToWire(view.thread));
  });

  app.post("/negotiations/:threadId/cancel", { config: asserted(NEGOTIATIONS_SCOPES.threadWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const body = toThreadCancelBody(request.body);

    const result = await runner.write((deps) =>
      cancelThread(deps, threadId, body, { idempotencyKey, traceId }),
    );
    // ADR-060 P2: cancel requires party membership.
    assertThreadMembership(request.endUser, result.thread);
    // `200` وليس `201` على إعادة المحاولة وعلى الأصل معاً: الإلغاء لا يُنشئ مورداً، وخيطٌ
    // مُلغى مرّتين هو خيطٌ مُلغى واحد.
    return reply.status(200).send(threadToWire(result.thread));
  });

  app.get("/negotiations/:threadId/rounds", { config: asserted(NEGOTIATIONS_SCOPES.roundRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const view = await runner.read((deps) => readNegotiation(deps, threadId));
    // ADR-060 P2: round read requires party membership.
    assertThreadMembership(request.endUser, view.thread);
    return reply.status(200).send({ rounds: view.rounds.map(roundToWire) });
  });

  app.post("/negotiations/:threadId/rounds", { config: assertedDriver(NEGOTIATIONS_SCOPES.roundWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const body = toRoundProposalBody(request.body);
    // ADR-060 P2: `proposed_by` must match `endUser` when assertion is verified.
    assertProposedBy(request.endUser, body.proposed_by);

    const result = await runner.write((deps) =>
      proposeRound(deps, threadId, body, { idempotencyKey, traceId }),
    );
    return reply.status(result.replay ? 200 : 201).send(roundToWire(result.round));
  });

  app.post("/negotiations/:threadId/rounds/:roundNo/accept", { config: assertedCustomer(NEGOTIATIONS_SCOPES.roundDecide) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const roundNo = roundNoOf(request.params);
    const body = toRoundDecisionBody(request.body);
    // ADR-060 P2: `acting_party` must match `endUser` when assertion is verified.
    assertActingParty(request.endUser, body.acting_party);

    const result = await runner.write((deps) =>
      acceptRound(deps, threadId, roundNo, body, { idempotencyKey, traceId }),
    );
    // الجسم هو **الاتفاق** لا الدور: القبول يُنشئ الاتفاق، وهو المورد الذي يسأل عنه
    // المُتَّصل بعدها. ويحمل معه `handoff_state` — فلو فشل التسليم إلى محرّك الطلب فالجواب
    // `201` ومعه «اتُّفق ولم يُسجَّل بعد»، لا خطأٌ يُنكر اتفاقاً وقع (ADR-013 قرار 2).
    return reply.status(result.replay ? 200 : 201).send(agreementToWire(result.agreement));
  });

  app.post("/negotiations/:threadId/rounds/:roundNo/reject", { config: assertedCustomer(NEGOTIATIONS_SCOPES.roundDecide) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const roundNo = roundNoOf(request.params);
    const body = toRoundRejectionBody(request.body);
    // ADR-060 P2: `acting_party` must match `endUser` when assertion is verified.
    assertActingParty(request.endUser, body.acting_party);

    const result = await runner.write((deps) =>
      rejectRound(deps, threadId, roundNo, body, { idempotencyKey, traceId }),
    );
    // الجسم هو **الخيط** لا الدور المرفوض: السؤال بعد الرفض هو «وماذا الآن؟»، وجوابه في
    // `state` و`current_round_no` و`round_count` — أي هل بقي في الميزانية دورٌ آخر أم أُغلق.
    return reply.status(200).send(threadToWire(result.thread));
  });

  app.get("/negotiations/:threadId/messages", { config: asserted(NEGOTIATIONS_SCOPES.messageRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const view = await runner.read((deps) => readNegotiation(deps, threadId));
    // ADR-060 P2: message read requires party membership.
    assertThreadMembership(request.endUser, view.thread);
    return reply.status(200).send({ messages: view.messages.map(messageToWire) });
  });

  app.post("/negotiations/:threadId/messages", { config: asserted(NEGOTIATIONS_SCOPES.messageWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const threadId = threadIdOf(request.params);
    const body = toMessageSubmissionBody(request.body);
    // ADR-060 P2: `author_role` must match `endUser` when assertion is verified.
    assertAuthorRole(request.endUser, body.author_role);

    const result = await runner.write((deps) =>
      postMessage(deps, threadId, body, { idempotencyKey, traceId }),
    );
    return reply.status(result.replay ? 200 : 201).send(messageToWire(result.message));
  });

  app.get("/negotiations/:threadId/agreement", { config: asserted(NEGOTIATIONS_SCOPES.agreementRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const threadId = threadIdOf(request.params);
    const agreement = await runner.read((deps) => readAgreement(deps, threadId));
    // ADR-060 P2: agreement read requires party membership (verified via thread).
    // The agreement is derived from a thread; without the thread we cannot check membership.
    // In `off`/`observe` mode (no endUser), the behavior is unchanged.
    if (request.endUser !== undefined) {
      const view = await runner.read((deps) => readNegotiation(deps, threadId));
      assertThreadMembership(request.endUser, view.thread);
    }
    return reply.status(200).send(agreementToWire(agreement));
  });

  return app;
}

// ── ADR-060 P2 (CLM-0441): ownership comparison helpers ─────────────────────
// These are no-ops when `endUser` is undefined (off mode, or observe without a
// valid assertion). In `enforce` mode, the middleware populates `endUser` and
// the handler compares the resource with the asserted identity.
// A mismatch returns 404 (not 403) per ADR-060 §2.6 — to avoid leaking existence.

import type { NegotiationThread } from "../domain/model.js";
import { threadNotFound as notFound } from "../domain/errors.js";

/** `opened_by` is a party role (`customer` | `driver`). It must match `endUser.actorType`. */
function assertOpenedBy(endUser: VerifiedEndUser | undefined, openedBy: unknown): void {
  if (endUser === undefined) return;
  if (openedBy !== endUser.actorType) throw notFound();
}

/** `proposed_by` is a party role. It must match `endUser.actorType`. */
function assertProposedBy(endUser: VerifiedEndUser | undefined, proposedBy: unknown): void {
  if (endUser === undefined) return;
  if (proposedBy !== endUser.actorType) throw notFound();
}

/** `acting_party` is a party role in accept/reject. It must match `endUser.actorType`. */
function assertActingParty(endUser: VerifiedEndUser | undefined, actingParty: unknown): void {
  if (endUser === undefined) return;
  if (actingParty !== endUser.actorType) throw notFound();
}

/** `author_role` is a party role in messages. It must match `endUser.actorType`. */
function assertAuthorRole(endUser: VerifiedEndUser | undefined, authorRole: unknown): void {
  if (endUser === undefined) return;
  if (authorRole !== endUser.actorType) throw notFound();
}

/** Thread read requires party membership: the user must be the customer or the driver. */
function assertThreadMembership(endUser: VerifiedEndUser | undefined, thread: NegotiationThread): void {
  if (endUser === undefined) return;
  if (thread.customerPublicId !== endUser.publicId && thread.driverPublicId !== endUser.publicId) {
    throw notFound();
  }
}

/** The list filter must match the asserted end-user. */
function assertListFilter(endUser: VerifiedEndUser | undefined, filter: { readonly order_public_id?: unknown; readonly driver_public_id?: unknown }): void {
  if (endUser === undefined) return;
  // The filter carries `driver_public_id` (a public ID) not an actor type.
  // If the driver filter is set, it must match the asserted user.
  if (filter.driver_public_id !== undefined && filter.driver_public_id !== null) {
    if (filter.driver_public_id !== endUser.publicId) throw notFound();
  }
}
