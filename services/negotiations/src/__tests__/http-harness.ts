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

import type {
  FastifyInstance,
  InjectOptions,
  LightMyRequestResponse,
} from "fastify";

import type {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
} from "@wasla/service-auth";

import { type NegotiationTickState } from "../http/app.js";
import type { InMemoryNegotiationDependencies } from "../infrastructure/in-memory.js";
import { createDirectNegotiationRunner } from "../runner.js";

import { makeDeps } from "./helpers.js";
import { buildSignedNegotiationApp } from "./service-identity-support.js";

export { CUSTOMER_ID, DRIVER_ID, OFFER_ID, ORDER_ID, START, key, openInput } from "./helpers.js";

export interface HttpHarness {
  readonly deps: InMemoryNegotiationDependencies;
  readonly app: FastifyInstance;
  readonly tickState: NegotiationTickState;
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِهِ. */
  readonly rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

export function httpHarness(): HttpHarness {
  const deps = makeDeps();
  const tickState: NegotiationTickState = { lastTickAt: null };
  // M1-04 (26/N): الحدُّ مفروضٌ، فالمِعْوانُ يبني تطبيقاً **موقَّعاً** ويلفُّ
  // `inject` — واللَّفُّ لا يُخفي الفرضَ: إثباتُهُ في `service-identity.test.ts`
  // بـ`rawInject` بلا توقيعٍ.
  const { app, keys, replayGuard, rawInject } = buildSignedNegotiationApp({
    runner: createDirectNegotiationRunner(deps),
    tickState,
  });
  return { deps, app, tickState, keys, replayGuard, rawInject };
}

/** ترويسات كتابةٍ كاملة: مفتاح تفرّد بطول مشروع، ونوع محتوى JSON. */
export function writeHeaders(idempotencyKey: string): Record<string, string> {
  return { "idempotency-key": idempotencyKey, "content-type": "application/json" };
}
