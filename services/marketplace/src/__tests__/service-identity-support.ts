/**
 * أدواتٌ مشتركةٌ لاختباراتِ حدِّ السوقِ بعدَ فرضِ هويّةِ الخدمةِ (`M1-04` ·
 * المراجعةُ 29/N).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفّاتِ العقدِ:**
 * اختباراتُ العقدِ تُثبتُ العقدَ — ترجمةَ السلكِ ورموزَ الحالةِ وحدودَ الحالاتِ
 * ودفترَ المخزونِ — وإغراقُها بترويسةِ هويّةٍ في مئاتِ المواضعِ كانَ سيجعلُ
 * تغييرَ صيغةِ الرمزِ تغييراً في مئاتِ المواضعِ، وهوَ ما يدفعُ الناسَ إلى
 * **تعطيلِ الفرضِ** بدلاً من تحديثِهِ.
 *
 * أمّا **إثباتُ الفرضِ نفسِهِ** فلهُ ملفٌّ مستقلٌّ (`service-identity.test.ts`)
 * يستعملُ `rawInject` **بلا توقيعٍ**، فلا يُخفي اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * وهذا هوَ النمطُ نفسُهُ الذي أثبتَتْهُ حدودُ المطابقةِ والطلباتِ والهويّةِ
 * والتوزيعِ والتوصيلِ والجغرافيا في `M1-03` والموجاتِ 2–6، لا اختراعٌ جديدٌ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import {
  createMarketplaceApp,
  MARKETPLACE_SCOPES,
  MARKETPLACE_SERVICE_AUDIENCE,
  type MarketplaceAppOptions,
} from "../http/app.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ لهُ بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "marketplace-test-secret-0123456789";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنَّ التوقيعَ يُفحَصُ فعلاً، لا أنَّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "marketplace-forged-secret-0123456";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختباراتُ العقدِ تُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_MARKETPLACE_SCOPES: readonly string[] = Object.values(MARKETPLACE_SCOPES);

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
 * — وهوَ `RISK-0026` المفتوحُ، ويمسُّ على هذا الحدِّ مساراتِ القراءةِ المُصفّاةَ
 * فعلاً (`GET /stores?…` · `GET /products/:id/inventory?…`).
 */
export function signFor(
  method: string,
  url: string,
  options: {
    keys?: ServiceAuthKeyRegistry;
    scopes?: readonly string[];
    serviceName?: string;
    now?: Date;
    onBehalfOfPublicId?: string;
  } = {},
): Record<string, string> {
  return serviceAuthHeaders({
    serviceName: options.serviceName ?? "core",
    audience: MARKETPLACE_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: url,
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_MARKETPLACE_SCOPES,
    ...(options.onBehalfOfPublicId === undefined
      ? {}
      : { onBehalfOfPublicId: options.onBehalfOfPublicId }),
  });
}

/**
 * حقولُ الفاعلِ في أجسامِ هذا الحدِّ — **ثمانيةُ حقولٍ في خمسةِ أسماءٍ**
 * (`services/marketplace/src/http/requests.ts`)، مرتَّبةً بأخصِّها.
 *
 * والقائمةُ مكتوبةٌ **مسطَّحةً** لا مُشتقّةً: حقلٌ جديدٌ يُضافُ للعقدِ ولا
 * يُضافُ هنا يجعلُ اختبارَ عقدِهِ يسقطُ بـ`403`، وهوَ الجرسُ المقصودُ.
 */
const BODY_ACTOR_FIELDS: readonly string[] = [
  "added_by_public_id",
  "removed_by_public_id",
  "created_by_public_id",
  "requested_by_public_id",
  "actor_public_id",
];

/** أوّلُ حقلِ فاعلٍ حاضرٍ في الجسمِ — أو `undefined` لجسمٍ لا يُسمّي فاعلاً. */
export function beneficiaryFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const body = payload as Record<string, unknown>;
  for (const field of BODY_ACTOR_FIELDS) {
    const value = body[field];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * يلفُّ `inject` لتطبيقٍ قائمٍ كي يوقِّعَ كلَّ نداءٍ، ويعيدُ `inject` الأصليَّ
 * **بلا توقيعٍ** لمن أرادَ إثباتَ الرفضِ.
 *
 * ── والمُنتَفِعُ يُشتَقُّ من **جسمِ الطلبِ** الذي يكتبُهُ الاختبارُ نفسُهُ ─────
 * وهذا نظيرُ ما فُعِلَ في حدِّ الطلباتِ في الموجةِ الأولى، حيثُ اشتُقَّ من
 * ترويسةِ `X-Customer-Public-Id` (`M1-05B` · `support.ts`) — والفرقُ أنَّ
 * فاعلَ هذا الحدِّ في الجسمِ لا في ترويسةٍ.
 *
 * **وهوَ يُريحُ اختبارَ العقدِ ويُعميهِ عنِ الحاجزِ في الوقتِ نفسِهِ** — يُقالُ
 * ولا يُدّعى خلافُهُ. ولذلكَ **إثباتُ الحاجزِ ممنوعٌ في ملفّاتِ العقدِ
 * ومكانُهُ `service-identity.test.ts`** بتوقيعٍ صريحٍ: رمزٌ بلا `obo`، ورمزٌ
 * بـ`obo` يخالفُ الجسمَ، ورمزٌ بـ`obo` لغيرِ عضوٍ في المتجرِ. ولو كانَ
 * اللَّفُ وحدَهُ لما كشفَ أحدٌ إزالةَ `beneficiary: "required"`.
 *
 * وقراءةُ الطاقمِ (`GET .../staff`) لا جسمَ لها: اختبارُها يُمرِّرُ ترويساتَهُ
 * الموقَّعةَ صراحةً، وهيَ تَغلِبُ لأنَّها تُنشَرُ بعدَ التوقيعِ أدناهُ.
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
    const beneficiary = beneficiaryFromPayload(options.payload);
    return rawInject({
      ...options,
      headers: {
        ...signFor(String(options.method ?? "GET"), String(options.url ?? "/"), {
          keys,
          ...(beneficiary === undefined ? {} : { onBehalfOfPublicId: beneficiary }),
        }),
        ...(options.headers ?? {}),
      },
    });
  };
  return rawInject;
}

export interface MarketplaceAppHarness {
  app: ReturnType<typeof createMarketplaceApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِهِ. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/**
 * يبني تطبيقَ السوقِ **مفروضاً** ويلفُّ `inject` بالتوقيعِ. تأخذُ الدالّةُ بقيّةَ
 * الخياراتِ كما هيَ كي لا تفقدَ اختباراتُ العقدِ ما تُعِدُّهُ.
 */
export function buildSignedMarketplaceApp(
  options: Omit<MarketplaceAppOptions, "serviceIdentity"> = {},
): MarketplaceAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createMarketplaceApp({ ...options, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app, keys);
  return { app, keys, replayGuard, rawInject };
}

/** الشكلُ الشائعُ في اختباراتِ العقدِ: تطبيقٌ موقَّعٌ بلا حاجةٍ إلى بقيّةِ السندِ. */
export function createSignedMarketplaceApp(
  options: Omit<MarketplaceAppOptions, "serviceIdentity"> = {},
): ReturnType<typeof createMarketplaceApp> {
  return buildSignedMarketplaceApp(options).app;
}
