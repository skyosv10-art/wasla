/**
 * أدواتٌ مشتركةٌ لاختباراتِ حدِّ التوصيلِ بعدَ فرضِ هويّةِ الخدمةِ (`M1-04`،
 * الموجةُ السادسةُ · المراجعةُ 17/N).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفّاتِ العقدِ:**
 * اختباراتُ العقدِ تُثبتُ العقدَ — ترجمةَ السلكِ ورموزَ الحالةِ وحدودَ الحالاتِ
 * والتماثُلَ — وإغراقُها بترويسةِ هويّةٍ في مئاتِ المواضعِ كانَ سيجعلُ تغييرَ
 * صيغةِ الرمزِ تغييراً في مئاتِ المواضعِ، وهوَ ما يدفعُ الناسَ إلى **تعطيلِ
 * الفرضِ** بدلاً من تحديثِهِ.
 *
 * أمّا **إثباتُ الفرضِ نفسِهِ** فلهُ ملفٌّ مستقلٌّ (`service-identity.test.ts`)
 * يستعملُ `rawInject` **بلا توقيعٍ**، فلا يُخفي اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * وهذا هوَ النمطُ نفسُهُ الذي أثبتَهُ حدُّ المطابقةِ في `M1-03` وحدودُ الطلباتِ
 * والهويّةِ والتوزيعِ والجغرافيا في الموجاتِ 2–5، لا اختراعٌ جديدٌ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { buildDeliveryHttpApp, type DeliveryHttpApp, type DeliveryHttpDeps } from "../http/app.js";
import { DELIVERY_SCOPES, DELIVERY_SERVICE_AUDIENCE } from "../http/service-identity.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ لهُ بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "delivery-test-secret-0123456789abc";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنَّ التوقيعَ يُفحَصُ فعلاً، لا أنَّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "delivery-forged-secret-0123456789";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختباراتُ العقدِ تُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_DELIVERY_SCOPES: readonly string[] = Object.values(DELIVERY_SCOPES);

export function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/**
 * ترويساتُ نداءٍ موقَّعٍ مربوطٍ بهذهِ الطريقةِ وهذا المسارِ.
 *
 * والاستعلامُ يُقطَعُ قبلَ التوقيعِ لأنَّ المسارَ الموقَّعَ **لا يشملُ الاستعلامَ**
 * ([ADR-021](../../../../docs/15-decisions/ADR-021-service-token-replay-policy.md) §4)
 * — وهوَ `RISK-0026` المفتوحُ، ويمسُّ `GET /delivery/inventory-conflicts` فعلاً.
 */
export function signFor(
  method: string,
  url: string,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    now?: Date;
    /**
     * الفاعلُ البشريُّ في السلسلةِ (`obo` في الرمزِ) — أُضيفَ في المراجعةِ 18/N
     * لأنَّ مسارَ الإقرارِ يكتبُهُ في دفترِ مسؤوليّةٍ، فوجودُهُ في الرمزِ يجبُ أن
     * يُثبَتَ **من التوقيعِ إلى العمودِ** لا أن يُفترَضَ.
     */
    onBehalfOfPublicId?: string;
  } = {},
): Record<string, string> {
  const separator = url.indexOf("?");
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "core",
    audience: DELIVERY_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_DELIVERY_SCOPES,
    ...(options.onBehalfOfPublicId === undefined
      ? {}
      : { onBehalfOfPublicId: options.onBehalfOfPublicId }),
  });
}

/**
 * يلفُّ `inject` لتطبيقٍ قائمٍ كي يوقِّعَ كلَّ نداءٍ، ويعيدُ `inject` الأصليَّ
 * **بلا توقيعٍ** لمن أرادَ إثباتَ الرفضِ.
 */
export function attachSigningInject(
  app: { inject: unknown },
  keys: ServiceAuthKeyRegistry,
): (options: InjectOptions) => Promise<LightMyRequestResponse> {
  const target = app as {
    inject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  };
  const rawInject = target.inject.bind(target);
  target.inject = (options: InjectOptions) =>
    rawInject({
      ...options,
      headers: {
        ...signFor(String(options.method ?? "GET"), String(options.url ?? "/"), { keys }),
        ...(options.headers ?? {}),
      },
    });
  return rawInject;
}

export interface DeliveryAppHarness {
  app: DeliveryHttpApp;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِهِ. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/**
 * يبني تطبيقَ التوصيلِ **مفروضاً** ويلفُّ `inject` بالتوقيعِ. تأخذُ الدالّةُ
 * بقيّةَ المنافذِ كما هيَ كي لا تفقدَ اختباراتُ العقدِ ما تُعِدُّهُ.
 */
export function buildSignedDeliveryApp(
  deps: Omit<DeliveryHttpDeps, "serviceIdentity">,
): DeliveryAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = buildDeliveryHttpApp({ ...deps, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app.fastify, keys);
  return { app, keys, replayGuard, rawInject };
}

/** الشكلُ الشائعُ في اختباراتِ العقدِ: تطبيقٌ موقَّعٌ بلا حاجةٍ إلى بقيّةِ السندِ. */
export function createSignedDeliveryApp(
  deps: Omit<DeliveryHttpDeps, "serviceIdentity">,
): DeliveryHttpApp {
  return buildSignedDeliveryApp(deps).app;
}
