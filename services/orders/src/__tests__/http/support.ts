/**
 * أدواتٌ مشتركةٌ لاختباراتِ حدِّ الطلباتِ بعدَ فرضِ هويّةِ الخدمةِ (`M1-04`).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفِّ العقدِ:** اختباراتُ
 * العقدِ تُثبتُ العقدَ — ترجمةَ السلكِ ورموزَ الحالةِ وقواعدَ الترويساتِ ونطاقَ
 * المالكِ — وإغراقُها بترويسةِ هويّةٍ في كلِّ موضعٍ كان سيجعلُ تغييرَ صيغةِ الرمزِ
 * تغييراً في عشراتِ المواضعِ، وهو ما يدفعُ الناسَ إلى **تعطيلِ الفرضِ** بدلاً من
 * تحديثِه. أمّا **إثباتُ الفرضِ نفسِه** فله ملفٌّ مستقلٌّ
 * (`service-identity.test.ts`) يستعملُ `rawInject` **بلا توقيعٍ**، فلا يُخفي
 * اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * وهذا هو النمطُ نفسُه الذي أثبتَه حدُّ المطابقةِ في `M1-03`
 * (`services/matching/src/__tests__/http-support.ts`)، لا اختراعٌ جديدٌ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createOrderApp, type OrderHealthDescriptor } from "../../http/app.js";
import { ORDER_SCOPES, ORDERS_SERVICE_AUDIENCE } from "../../http/service-identity.js";
import { createDirectRunner } from "../../runner.js";

import { makeHarness, type Harness } from "../harness.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ له بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "orders-test-secret-0123456789abcdef";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنّ التوقيعَ يُفحَصُ فعلاً، لا أنّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "orders-forged-secret-0123456789ab";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختباراتُ العقدِ تُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_ORDER_SCOPES: readonly string[] = Object.values(ORDER_SCOPES);

export function createTestKeyRegistry(secret: string = TEST_SERVICE_SECRET): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/** ترويساتُ نداءٍ موقَّعٍ مربوطٍ بهذه الطريقةِ وهذا المسارِ. */
export function signFor(
  method: string,
  url: string,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    now?: Date;
  } = {},
): Record<string, string> {
  const separator = url.indexOf("?");
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "dispatch",
    audience: ORDERS_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_ORDER_SCOPES,
  });
}

export interface OrderHttpHarness {
  harness: Harness;
  app: ReturnType<typeof createOrderApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِه. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/** السندُ يوقِّعُ كلَّ نداءٍ تلقائيّاً؛ و`rawInject` يبقى متاحاً بلا توقيعٍ. */
export function createOrderHttpHarness(health?: OrderHealthDescriptor): OrderHttpHarness {
  const harness = makeHarness();
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createOrderApp({
    runner: createDirectRunner(harness),
    serviceIdentity: { keys, replayGuard },
    ...(health === undefined ? {} : { health }),
  });

  const rawInject = app.inject.bind(app) as (options: InjectOptions) => Promise<LightMyRequestResponse>;
  app.inject = ((options: InjectOptions) =>
    rawInject({
      ...options,
      headers: {
        ...signFor(String(options.method ?? "GET"), String(options.url ?? "/"), { keys }),
        ...(options.headers ?? {}),
      },
    })) as typeof app.inject;

  return { harness, app, keys, replayGuard, rawInject };
}
