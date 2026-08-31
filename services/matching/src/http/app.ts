/**
 * مصنع تطبيق Fastify لخدمة المطابقة.
 *
 * يربط هذا الملف العمليات السبع المنشورة فقط. يستقبل Runner بدلاً من الاعتمادات
 * كي تظل حدود المعاملة قرار تركيب واحد، وتستطيع الاختبارات حقن الذاكرة عبر
 * app.inject بلا فتح منفذ أو قاعدة بيانات.
 */

import Fastify, { type FastifyInstance } from "fastify";

import {
  toCandidateResult,
  toCandidacy,
  toDecision,
  toRuleset,
} from "../mappers.js";
import { evaluateCandidates } from "../use-cases/evaluate-candidates.js";
import {
  changeAvailability,
  readCandidacy,
  upsertCandidacy,
} from "../use-cases/manage-candidacy.js";
import { listRulesets, readDecision } from "../use-cases/read-audit.js";
import type { MatchingRunner } from "../runner.js";

import { sendMatchingError } from "./errors.js";
import {
  MATCHING_SCOPES,
  registerServiceIdentity,
  type MatchingRouteConfig,
  type MatchingServiceIdentityOptions,
} from "./service-identity.js";
import {
  assertRequestIdLength,
  requireIdempotencyKey,
  toCandidateQuery,
  toChangeAvailabilityRequest,
  toUpsertCandidacyRequest,
} from "./requests.js";

/** حالة التخزين التي يعلنها جذر التركيب صراحة. */
export interface MatchingHealthDescriptor {
  persistence: "postgres" | "memory";
}

export interface CreateMatchingAppOptions {
  runner: MatchingRunner;
  logger?: boolean;
  health?: MatchingHealthDescriptor;
  /**
   * فرض هوية الخدمة. **إلزامي بلا قيمة افتراضية بقصد**: القيمة الافتراضية كانت
   * ستجعل نسيان التركيب في جذر ما خدمةً مفتوحة تمر كل اختباراتها، وهي بذاتها
   * الثغرة التي تسدها هذه الدفعة. فمن أراد حداً بلا فرض عليه أن يكتب ذلك صراحة
   * في جذر تركيبه، ولا موضع في المستودع يكتبه.
   */
  serviceIdentity: MatchingServiceIdentityOptions;
}

/** الصلاحيات المعلنة على مسارات المطابقة (domain:resource:action). */
export const MATCHING_ROUTE_SCOPES = MATCHING_SCOPES;

const OPEN: MatchingRouteConfig = { serviceIdentity: "open" };

function scoped(...scopes: readonly string[]): MatchingRouteConfig {
  return { serviceIdentity: { scopes } };
}

const DEFAULT_HEALTH: MatchingHealthDescriptor = { persistence: "memory" };

/** يبني التطبيق من دون الاستماع للشبكة. */
export function createMatchingApp(options: CreateMatchingAppOptions): FastifyInstance {
  const { runner } = options;
  const health = options.health ?? DEFAULT_HEALTH;
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error, request, reply) => {
    sendMatchingError(reply, error, request.id);
  });

  // قبل المسارات: كي يرى حاجز التصنيف كل مسار يُسجّل بعده.
  registerServiceIdentity(app, options.serviceIdentity);

  app.get("/health", { config: OPEN }, async (_request, reply) => {
    // تعذر قراءة النسخة لا يجعل العملية سليمة؛ نعلن degraded بدلاً من إخفاء عطل
    // سيظهر حتماً في أول تقييم حقيقي.
    let activeRulesetVersion: number | null = null;
    try {
      const active = await runner.read((deps) => deps.rulesets.findActive());
      activeRulesetVersion = active?.version ?? null;
    } catch {
      activeRulesetVersion = null;
    }
    const status = health.persistence === "postgres" && activeRulesetVersion !== null ? "ok" : "degraded";
    return reply.status(200).send({
      status,
      service: "matching-service",
      persistence: health.persistence,
      active_ruleset_version: activeRulesetVersion,
    });
  });

  app.post("/matching/candidates", { config: scoped(MATCHING_SCOPES.candidatesEvaluate) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const input = toCandidateQuery(request.body, traceId);
    // التقييم يكتب قرار التدقيق وحدثاً، ولذلك يعبر حد الكتابة رغم أنه لا يغير
    // ترشيحاً ولا يعرف عرضاً أو موجة.
    const result = await runner.write((deps) => evaluateCandidates(deps, input));
    return reply.status(200).send(toCandidateResult(result));
  });

  app.put("/candidacy/:driverPublicId", { config: scoped(MATCHING_SCOPES.candidacyWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const driverPublicId = (request.params as { driverPublicId?: unknown }).driverPublicId;
    const command = toUpsertCandidacyRequest(driverPublicId, request.body, idempotencyKey, traceId);

    const candidacy = await runner.write(async (deps) => {
      await upsertCandidacy(deps, command);
      // الكتابتان تعيدان Candidacy بلا isFresh؛ إعادة القراءة داخل المعاملة تمنع
      // اختراع قيمة زمنية في HTTP وتستعمل الحساب الكنسي نفسه لمسار GET.
      return readCandidacy(deps, command.driverPublicId, traceId);
    });
    return reply.status(200).send(toCandidacy(candidacy));
  });

  app.get("/candidacy/:driverPublicId", { config: scoped(MATCHING_SCOPES.candidacyRead) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const driverPublicId = (request.params as { driverPublicId?: unknown }).driverPublicId;
    const candidacy = await runner.read((deps) => readCandidacy(deps, driverPublicId as string, traceId));
    return reply.status(200).send(toCandidacy(candidacy));
  });

  app.post("/candidacy/:driverPublicId/availability", { config: scoped(MATCHING_SCOPES.candidacyWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const driverPublicId = (request.params as { driverPublicId?: unknown }).driverPublicId;
    const command = toChangeAvailabilityRequest(driverPublicId, request.body, idempotencyKey, traceId);

    const candidacy = await runner.write(async (deps) => {
      await changeAvailability(deps, command);
      // سبب القراءة اللاحقة هو نفسه في PUT: isFresh خاصية محسوبة لا يجوز للحد
      // النقلـي تخمينها من صف لا يحملها.
      return readCandidacy(deps, command.driverPublicId, traceId);
    });
    return reply.status(200).send(toCandidacy(candidacy));
  });

  app.get("/matching/rulesets", { config: scoped(MATCHING_SCOPES.rulesetsRead) }, async (request, reply) => {
    // يُفحص مُعرّف التتبع على كل مسار بلا استثناء؛ مسار واحد معفٌ يكفي لإدخال مُعرّف
    // متجاوز إلى السجلات، وحينها يصير الحد حدّاً في الورق لا في التشغيل.
    assertRequestIdLength(request.headers, request.id);
    const rulesets = await runner.read((deps) => listRulesets(deps));
    return reply.status(200).send({ rulesets: rulesets.map(toRuleset) });
  });

  app.get("/matching/decisions/:decisionId", { config: scoped(MATCHING_SCOPES.decisionsRead) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const decisionId = (request.params as { decisionId?: unknown }).decisionId;
    const decision = await runner.read((deps) => readDecision(deps, decisionId as string, traceId));
    return reply.status(200).send(toDecision(decision));
  });

  return app;
}
