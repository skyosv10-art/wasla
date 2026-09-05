/**
 * أدواتٌ مشتركةٌ لاختباراتِ حدِّ الهويّةِ بعدَ فرضِ هويّةِ الخدمةِ (`M1-04`).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفِّ العقدِ:** اختباراتُ
 * العقدِ تُثبتُ العقدَ — ترجمةَ السلكِ ورموزَ الحالةِ وثباتَ المُعرِّفِ العامِّ —
 * وإغراقُها بترويسةِ هويّةٍ في كلِّ موضعٍ كان سيجعلُ تغييرَ صيغةِ الرمزِ تغييراً
 * في عشراتِ المواضعِ، وهو ما يدفعُ الناسَ إلى **تعطيلِ الفرضِ** بدلاً من
 * تحديثِه. أمّا **إثباتُ الفرضِ نفسِه** فله ملفٌّ مستقلٌّ
 * (`service-identity.test.ts`) يستعملُ `rawInject` **بلا توقيعٍ**، فلا يُخفي
 * اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * وهذا هو النمطُ نفسُه الذي أثبتَه حدُّ المطابقةِ في `M1-03` وحدُّ الطلباتِ في
 * الموجةِ الثانيةِ، لا اختراعٌ جديدٌ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import {
  CryptoIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  SystemClock,
} from "../../infrastructure/in-memory.js";
import { createIdentityApp } from "../../http/app.js";
import {
  IDENTITY_SCOPES,
  IDENTITY_SERVICE_AUDIENCE,
} from "../../http/service-identity.js";
import type { UseCaseDeps } from "../../use-cases/resolve-telegram-identity.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ له بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "identity-test-secret-0123456789ab";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنّ التوقيعَ يُفحَصُ فعلاً، لا أنّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "identity-forged-secret-0123456789";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختباراتُ العقدِ تُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_IDENTITY_SCOPES: readonly string[] = Object.values(IDENTITY_SCOPES);

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
    audience: IDENTITY_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_IDENTITY_SCOPES,
  });
}

export function buildInMemoryDeps(): UseCaseDeps {
  return {
    repo: new InMemoryIdentityRepository(),
    outbox: new InMemoryOutbox(),
    publicIdSeq: new InMemoryPublicIdSequence(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
  };
}

/**
 * يلفُّ `inject` لتطبيقٍ قائمٍ كي يوقِّعَ كلَّ نداءٍ، ويعيدُ `inject` الأصليَّ
 * **بلا توقيعٍ** لمن أراد إثباتَ الرفضِ. مُستخرَجٌ كي لا يُكرَّرَ اللَّفُّ في
 * بوّابةِ الخروجِ وفي السندِ معاً.
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

export interface IdentityHttpHarness {
  app: ReturnType<typeof createIdentityApp>;
  deps: UseCaseDeps;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِه. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/** السندُ يوقِّعُ كلَّ نداءٍ تلقائيّاً؛ و`rawInject` يبقى متاحاً بلا توقيعٍ. */
export function createIdentityHttpHarness(
  deps: UseCaseDeps = buildInMemoryDeps(),
): IdentityHttpHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createIdentityApp({
    deps,
    logger: false,
    serviceIdentity: { keys, replayGuard },
  });

  const rawInject = attachSigningInject(app, keys);

  return { app, deps, keys, replayGuard, rawInject };
}
