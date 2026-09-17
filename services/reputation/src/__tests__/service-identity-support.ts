/**
 * أدواتٌ مشتركةٌ لاختباراتِ **حدِّ السمعة** بعدَ فرضِ هويّةِ الخدمةِ
 * (`M1-04` · الموجةُ الحاديةَ عشرةَ · `CLM-0199`).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفِّ العقدِ:**
 * `__tests__/http-*.test.ts` يُثبتُ العقدَ — ترجمةَ السلكِ ورموزَ الحالةِ
 * ومغلَّفَ الخطأِ — وإغراقُهُ بترويسةِ هويّةٍ في عشراتِ المواضعِ كانَ سيجعلُ
 * تغييرَ صيغةِ الرمزِ تغييراً في عشراتِ المواضعِ، وهوَ ما يدفعُ الناسَ إلى
 * **تعطيلِ الفرضِ** بدلاً من تحديثِهِ. وهذا هوَ النمطُ نفسُهُ في حدودِ السائقين
 * والعميلِ والسوقِ والطلباتِ والتوصيلِ والمطابقةِ.
 *
 * أمّا **إثباتُ الفرضِ نفسِهِ** فلهُ ملفٌّ مستقلٌّ (`service-identity.test.ts`)
 * يستعملُ `rawInject` **بلا توقيعٍ** أو بتوقيعٍ صريحٍ مُخالِفٍ، فلا يُخفي
 * اللَّفُّ ما يجبُ أن يُثبَتَ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createReputationApp, type CreateReputationAppOptions } from "../http/app.js";
import { REPUTATION_SCOPES, REPUTATION_SERVICE_AUDIENCE } from "../http/service-identity.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ لهُ بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "reputation-test-secret-0123456789abcdef";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنَّ التوقيعَ يُفحَصُ فعلاً، لا أنَّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "reputation-forged-secret-0123456789abcdef";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختبارُ العقدِ يُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_REPUTATION_SCOPES: readonly string[] = Object.values(REPUTATION_SCOPES);

export function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/**
 * المُنتَفِعُ كما كتبَهُ المسارُ: `:subjectPublicId` في
 * `/reputation/scores/:subjectType/:subjectPublicId`.
 */
export function beneficiaryFromUrl(url: string): string | undefined {
  const path = url.split("?")[0] ?? url;
  const match = /^\/reputation\/scores\/[^/]+\/([^/]+)/u.exec(path);
  const value = match?.[1];
  return value === undefined || value === "" ? undefined : decodeURIComponent(value);
}

/**
 * ترويساتُ نداءٍ موقَّعٍ مربوطٍ بهذهِ الطريقةِ وهذا المسارِ وهذا المُنتَفِعِ.
 */
export function signFor(
  method: string,
  url: string,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    now?: Date;
    onBehalfOfPublicId?: string | null;
  } = {},
): Record<string, string> {
  const separator = url.indexOf("?");
  const beneficiary =
    options.onBehalfOfPublicId === undefined
      ? beneficiaryFromUrl(url)
      : (options.onBehalfOfPublicId ?? undefined);
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "reputation-ingress",
    audience: REPUTATION_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_REPUTATION_SCOPES,
    ...(beneficiary === undefined ? {} : { onBehalfOfPublicId: beneficiary }),
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
  target.inject = (options: InjectOptions) => {
    const url = String(options.url ?? "/");
    const method = String(options.method ?? "GET");
    // `POST /reputation/ratings` يحملُ المُنتَفِعَ في الجسمِ لا في المسارِ؛ فاستخراجُهُ
    // من الجسمِ قبلَ التوقيعِ يُتيحُ للسندِ أن يوقِّعَ نداءاتِ التقييمِ تلقائيّاً.
    let onBehalfOfPublicId: string | undefined;
    if (method.toUpperCase() === "POST" && url.split("?")[0] === "/reputation/ratings") {
      const body = options.payload as Record<string, unknown> | undefined;
      const wpid = body?.rater_public_id;
      if (typeof wpid === "string" && wpid.trim() !== "") {
        onBehalfOfPublicId = wpid;
      }
    }
    return rawInject({
      ...options,
      headers: {
        ...signFor(method, url, { keys, onBehalfOfPublicId }),
        ...(options.headers ?? {}),
      },
    });
  };
  return rawInject;
}

export interface ReputationAppHarness {
  app: ReturnType<typeof createReputationApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِهِ. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/**
 * يبني تطبيقَ السمعةِ **مفروضاً** ويلفُّ `inject` بالتوقيعِ.
 */
export function buildSignedReputationApp(
  options: Omit<CreateReputationAppOptions, "serviceIdentity">,
): ReputationAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createReputationApp({ ...options, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app, keys);
  return { app, keys, replayGuard, rawInject };
}
