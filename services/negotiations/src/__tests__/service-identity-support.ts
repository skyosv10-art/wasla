/**
 * أدواتٌ مشتركةٌ لاختباراتِ حدِّ المفاوضاتِ بعدَ فرضِ هويّةِ الخدمةِ
 * (`M1-04` · المراجعةُ 26/N).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفّاتِ العقدِ:**
 * اختباراتُ العقدِ تُثبتُ العقدَ — رموزَ الحالةِ وحدودَ الحالاتِ والتفرُّدَ —
 * وإغراقُها بترويسةِ هويّةٍ في كلِّ موضعٍ كانَ سيجعلُ تغييرَ صيغةِ الرمزِ
 * تغييراً في عشراتِ المواضعِ، وهوَ ما يدفعُ الناسَ إلى **تعطيلِ الفرضِ** بدلاً
 * من تحديثِهِ. أمّا **إثباتُ الفرضِ نفسِهِ** فلهُ ملفٌّ مستقلٌّ
 * (`service-identity.test.ts`) يستعملُ `rawInject` **بلا توقيعٍ**، فلا يُخفي
 * اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * وهذا هوَ النمطُ نفسُهُ الذي أثبتَتهُ الحدودُ الستُّ السابقةُ، لا اختراعٌ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createNegotiationApp, type CreateNegotiationAppOptions } from "../http/app.js";
import {
  NEGOTIATIONS_SCOPES,
  NEGOTIATIONS_SERVICE_AUDIENCE,
} from "../http/service-identity.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ لهُ بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "negotiations-test-secret-0123456789";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنَّ التوقيعَ يُفحَصُ فعلاً، لا أنَّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "negotiations-forged-secret-012345678";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختباراتُ العقدِ تُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_NEGOTIATIONS_SCOPES: readonly string[] = Object.values(NEGOTIATIONS_SCOPES);

export function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/** ترويساتُ نداءٍ موقَّعٍ مربوطٍ بهذهِ الطريقةِ وهذا المسارِ. */
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
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "customer-bot",
    audience: NEGOTIATIONS_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: url,
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_NEGOTIATIONS_SCOPES,
  });
}

/**
 * يلفُّ `inject` لتطبيقٍ قائمٍ كي يوقِّعَ كلَّ نداءٍ، ويعيدُ `inject` الأصليَّ
 * **بلا توقيعٍ** لمَن أرادَ إثباتَ الرفضِ.
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

export interface NegotiationAppHarness {
  app: ReturnType<typeof createNegotiationApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِهِ. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/** يبني تطبيقَ المفاوضاتِ **مفروضاً** ويلفُّ `inject` بالتوقيعِ. */
export function buildSignedNegotiationApp(
  options: Omit<CreateNegotiationAppOptions, "serviceIdentity">,
): NegotiationAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createNegotiationApp({ ...options, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app, keys);
  return { app, keys, replayGuard, rawInject };
}

/** الشكلُ الشائعُ في اختباراتِ العقدِ: تطبيقٌ موقَّعٌ بلا حاجةٍ إلى بقيّةِ السندِ. */
export function createSignedNegotiationApp(
  options: Omit<CreateNegotiationAppOptions, "serviceIdentity">,
): ReturnType<typeof createNegotiationApp> {
  return buildSignedNegotiationApp(options).app;
}
