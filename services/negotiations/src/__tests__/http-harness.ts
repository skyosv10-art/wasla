/**
 * تطبيقٌ واحد فوق البيئة الذاكرية، لمجموعات `app.inject`.
 *
 * `inject` لا مقبس يستمع: يُشغّل **نفس** المُوجّه والخطّافات ومعالج الخطأ الذي تخدمه
 * العمليّة، بلا منفذ. مجموعةٌ تربط منفذاً كانت ستجعل الاختبارات مرهونة بتوفّر منفذٍ حرّ
 * وتفحص كومة الشبكة بدل الطبقة المقصودة.
 *
 * والتبعيات هي التي يبنيها `makeDeps()` نفسه — السياسة المزروعة نفسها وعرض الإرسال
 * المعروف نفسه الذي تستعمله اختبارات حالات الاستخدام النقيّة — فأيّ فرقٍ بين جواب HTTP
 * وجواب حالة استخدام هو فرقٌ صنعته طبقة HTTP.
 *
 * والساعة `MutableClock` تُمرَّر ولا تُخفى: انتهاءُ الصلاحية يُختبر بتحريك الزمن لا
 * بانتظاره، وذاك هو سببُ وجود النبضة أصلاً (ADR-013 قرار 5).
 */

import type { FastifyInstance } from "fastify";

import { createNegotiationApp, type NegotiationTickState } from "../http/app.js";
import type { InMemoryNegotiationDependencies } from "../infrastructure/in-memory.js";
import { createDirectNegotiationRunner } from "../runner.js";

import { makeDeps } from "./helpers.js";

export { CUSTOMER_ID, DRIVER_ID, OFFER_ID, ORDER_ID, START, key, openInput } from "./helpers.js";

export interface HttpHarness {
  readonly deps: InMemoryNegotiationDependencies;
  readonly app: FastifyInstance;
  readonly tickState: NegotiationTickState;
}

export function httpHarness(): HttpHarness {
  const deps = makeDeps();
  const tickState: NegotiationTickState = { lastTickAt: null };
  const app = createNegotiationApp({ runner: createDirectNegotiationRunner(deps), tickState });
  return { deps, app, tickState };
}

/** ترويسات كتابةٍ كاملة: مفتاح تفرّد بطول مشروع، ونوع محتوى JSON. */
export function writeHeaders(idempotencyKey: string): Record<string, string> {
  return { "idempotency-key": idempotencyKey, "content-type": "application/json" };
}
