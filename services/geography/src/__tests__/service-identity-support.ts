/**
 * أدواتٌ مشتركةٌ لاختباراتِ حدِّ الجغرافيا بعدَ فرضِ هويّةِ الخدمةِ (`M1-04`،
 * الموجةُ الخامسة).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفّاتِ العقدِ:**
 * اختباراتُ العقدِ تُثبتُ العقدَ — الترجمةَ واللغاتِ ورموزَ الحالةِ وحدودَ
 * الحالاتِ — وإغراقُها بترويسةِ هويّةٍ في كلِّ موضعٍ كان سيجعلُ تغييرَ صيغةِ
 * الرمزِ تغييراً في عشراتِ المواضعِ، وهو ما يدفعُ الناسَ إلى **تعطيلِ الفرضِ**
 * بدلاً من تحديثِه. أمّا **إثباتُ الفرضِ نفسِه** فله ملفٌّ مستقلٌّ
 * (`service-identity.test.ts`) يستعملُ `rawInject` **بلا توقيعٍ**، فلا يُخفي
 * اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * وهذا هو النمطُ نفسُه الذي أثبتَته الحدودُ الأربعُ السابقةُ في `M1-03`
 * و`M1-04`، لا اختراعٌ جديدٌ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createGeographyApp, type CreateGeographyAppOptions } from "../http/app.js";
import {
  GEO_SCOPES,
  GEOGRAPHY_SERVICE_AUDIENCE,
} from "../http/service-identity.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ له بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "geography-test-secret-0123456789ab";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنّ التوقيعَ يُفحَصُ فعلاً، لا أنّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "geography-forged-secret-0123456789";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختباراتُ العقدِ تُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_GEO_SCOPES: readonly string[] = Object.values(GEO_SCOPES);

export function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
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
    serviceName: options.serviceName ?? "customers",
    audience: GEOGRAPHY_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_GEO_SCOPES,
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
        ...signFor(String(options.method ?? "GET"), String(options.url ?? "/"), {
          keys,
        }),
        ...(options.headers ?? {}),
      },
    });
  return rawInject;
}

export interface GeographyAppHarness {
  app: ReturnType<typeof createGeographyApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِه. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/**
 * يبني تطبيقَ الجغرافيا **مفروضاً** ويلفُّ `inject` بالتوقيعِ. تأخذُ الدالّةُ
 * بقيّةَ الخيارَاتِ كما هي كي لا تفقدَ اختباراتُ العقدِ ما تُعِدُّه.
 */
export function buildSignedGeographyApp(
  options: Omit<CreateGeographyAppOptions, "serviceIdentity">,
): GeographyAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createGeographyApp({ ...options, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app, keys);
  return { app, keys, replayGuard, rawInject };
}

/** الشكلُ الشائعُ في اختباراتِ العقدِ: تطبيقٌ موقَّعٌ بلا حاجةٍ إلى بقيّةِ السندِ. */
export function createSignedGeographyApp(
  options: Omit<CreateGeographyAppOptions, "serviceIdentity">,
): ReturnType<typeof createGeographyApp> {
  return buildSignedGeographyApp(options).app;
}
