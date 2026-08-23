/**
 * تطبيقٌ واحد فوق البيئة الذاكرية، لمجموعات `app.inject`.
 *
 * `inject` لا مقبسَ يستمع: يُشغّل **نفسَ** المُوجّه والخطّافات ومعالجِ الخطأ الذي تخدمه
 * العمليّة، بلا منفذ. ومجموعةٌ تربط منفذاً كانت ستجعل الاختبارات مرهونةً بتوفّر منفذٍ حرّ
 * وتفحص كومةَ الشبكة بدل الطبقة المقصودة.
 *
 * والتبعياتُ هي التي يبنيها `deps()` نفسه — نسخةُ القواعد المزروعة نفسها والساعةُ التي
 * تُدفَع بيد — فأيُّ فرقٍ بين جواب HTTP وجواب حالةِ استخدامٍ هو فرقٌ صنعته طبقةُ HTTP.
 */

import type { FastifyInstance } from "fastify";

import { createReputationApp, type ReputationTickState } from "../http/app.js";
import type { InMemoryReputationDependencies } from "../infrastructure/in-memory.js";
import { createDirectReputationRunner } from "../runner.js";

import { deps, T0 } from "./helpers.js";

export { CUSTOMER, DRIVER, OTHER_DRIVER, T0, factDraft, order } from "./helpers.js";

export interface HttpHarness {
  readonly deps: InMemoryReputationDependencies;
  readonly app: FastifyInstance;
  readonly tickState: ReputationTickState;
}

export function httpHarness(startAt: string = T0): HttpHarness {
  const dependencies = deps(startAt);
  const tickState: ReputationTickState = { lastTickAt: null };
  const app = createReputationApp({
    runner: createDirectReputationRunner(dependencies),
    tickState,
  });
  return { deps: dependencies, app, tickState };
}

/** ترويساتُ كتابةٍ كاملة: مفتاحُ معالجةٍ بطولٍ مشروع، ونوعُ محتوى JSON. */
export function writeHeaders(idempotencyKey: string): Record<string, string> {
  return { "idempotency-key": idempotencyKey, "content-type": "application/json" };
}

/**
 * جسمُ `POST /reputation/facts` بمفاتيح العقد (`snake_case`).
 *
 * مكتوبٌ بمفاتيح السلك لا بتحويلٍ آليٍّ من `factDraft()`: محوّلٌ آليّ كان سيُصلح خطأَ
 * تسميةٍ في `http/requests.ts` بنفسه، فينجح الاختبارُ على شيءٍ لا يفعله أيُّ عميل.
 */
export function factBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_type: "customer",
    subject_public_id: "WS-1000000001",
    fact_kind: "order_completed",
    order_public_id: "ORD-0000000001",
    source_event_type: "order.completed",
    source_event_id: "11111111-1111-4111-8111-111111111111",
    source_sequence: 1,
    actor_type: "system",
    reason_code: null,
    occurred_at: T0,
    ...overrides,
  };
}

/** جسمُ `POST /reputation/ratings` بمفاتيح العقد. */
export function ratingBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_public_id: "ORD-0000000001",
    rater_type: "customer",
    rater_public_id: "WS-1000000001",
    subject_public_id: "WS-2000000002",
    stars: 5,
    reason_code: null,
    ...overrides,
  };
}
