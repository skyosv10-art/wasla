/** أدوات مشتركة لاختبارات HTTP كي يبقى كل اختبار متعلقاً بعقده لا بتجهيز الذاكرة. */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createMatchingApp } from "../http/app.js";
import { MATCHING_SCOPES } from "../http/service-identity.js";
import { createDirectRunner } from "../runner.js";

import { createHarness, ORDER_ID, ORDER_PUBLIC_ID, ZONE_PICKUP } from "./harness.js";

export { ORDER_ID, ORDER_PUBLIC_ID, ZONE_PICKUP };

/** سر اختباري بطول مقبول؛ لا صلة له بأي سر تشغيلي. */
export const TEST_SERVICE_SECRET = "matching-test-secret-0123456789abcdef";
export const TEST_ACTIVE_KID = "test-active";

/** كل صلاحيات هذا الحد: اختبارات العقد تُثبت العقد لا نقص الصلاحية. */
export const ALL_MATCHING_SCOPES = Object.values(MATCHING_SCOPES);

export function createTestKeyRegistry(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret: TEST_SERVICE_SECRET, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/** ترويسات نداء موقّع مربوط بهذه الطريقة وهذا المسار. */
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
    audience: "matching",
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_MATCHING_SCOPES,
  });
}

/**
 * السند يوقّع كل نداء تلقائياً.
 *
 * **لماذا يُلَفّ `inject` بدلاً من تعديل تسعةٍ وعشرين موضعاً:** اختبارات العقد
 * تُثبت العقد، وإغراقها بترويسة هوية في كل موضع كان سيجعل تغيير صيغة الرمز
 * تغييراً في تسعة وعشرين ملفاً — وهو ما يدفع الناس إلى تعطيل الفرض بدلاً من
 * تحديثه. أما إثبات الفرض نفسه فله ملف مستقل يستعمل `rawInject` بلا توقيع،
 * فلا يُخفي اللف ما يجب أن يُثبَت.
 */
export function createHttpHarness() {
  const deps = createHarness();
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createMatchingApp({
    runner: createDirectRunner(deps),
    serviceIdentity: { keys, replayGuard },
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

  return { app, deps, keys, replayGuard, rawInject };
}

export function candidatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: ORDER_ID,
    order_public_id: ORDER_PUBLIC_ID,
    order_type: "ride",
    vehicle_class: "sedan",
    pickup_zone_id: ZONE_PICKUP,
    ...overrides,
  };
}

export function candidacyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    availability_state: "available",
    eligibility_state: "eligible",
    service_kinds: ["ride"],
    vehicle_class: "sedan",
    zone_ids: [ZONE_PICKUP],
    ...overrides,
  };
}

export const DRIVER_ID = "WS-0000000001";
export const IDEMPOTENCY_KEY = "matching-test-key";
