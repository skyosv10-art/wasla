/**
 * أدواتٌ مشتركةٌ لاختباراتِ **حدِّ العميلِ** بعدَ فرضِ هويّةِ الخدمةِ
 * (`M1-04` · الموجةُ التاسعةُ · `CLM-0197`).
 *
 * **لماذا يُلَفُّ `inject` بدلاً من تعديلِ كلِّ نداءٍ في ملفِّ العقدِ:**
 * `__tests__/http/app.test.ts` يُثبتُ العقدَ — ترجمةَ السلكِ ورموزَ الحالةِ
 * ومغلَّفَ الخطأِ — وإغراقُهُ بترويسةِ هويّةٍ في عشراتِ المواضعِ كانَ سيجعلُ
 * تغييرَ صيغةِ الرمزِ تغييراً في عشراتِ المواضعِ، وهوَ ما يدفعُ الناسَ إلى
 * **تعطيلِ الفرضِ** بدلاً من تحديثِهِ. وهذا هوَ النمطُ نفسُهُ في حدودِ السوقِ
 * والطلباتِ والتوصيلِ والمطابقةِ، لا اختراعٌ جديدٌ.
 *
 * أمّا **إثباتُ الفرضِ نفسِهِ** فلهُ ملفٌّ مستقلٌّ (`service-identity.test.ts`)
 * يستعملُ `rawInject` **بلا توقيعٍ** أو بتوقيعٍ صريحٍ مُخالِفٍ، فلا يُخفي
 * اللَّفُّ ما يجبُ أن يُثبَتَ.
 *
 * ── والمُنتَفِعُ يُشتَقُّ من **المسارِ** في هذا الحدِّ ──────────────────────
 * كلُّ مَورِدٍ هنا مُعنوَنٌ بـ`/customers/:waslaPublicId/…`، فالمالكُ مكتوبٌ في
 * المسارِ الذي يكتبُهُ الاختبارُ. واشتقاقُهُ منهُ يجعلُ اختبارَ العقدِ يُوقِّعُ
 * **لصاحبِ المَوردِ** بلا تعديلٍ، ويجعلُ إثباتَ الحاجزِ ممكناً وحدَهُ بتوقيعٍ
 * صريحٍ لمُنتَفِعٍ آخرَ. وهوَ نظيرُ اشتقاقِ حدِّ الطلباتِ من ترويسةِ
 * `X-Customer-Public-Id` (`M1-05B`) واشتقاقِ حدِّ السوقِ من جسمِ الطلبِ.
 *
 * **وهوَ يُريحُ اختبارَ العقدِ ويُعميهِ عنِ الحاجزِ في الوقتِ نفسِهِ** — يُقالُ
 * ولا يُدّعى خلافُهُ: لو أُزيلَ `beneficiary: "required"` من مسارٍ لما كشفَهُ
 * اللَّفُّ. ولذلكَ إثباتُ الحاجزِ **ممنوعٌ** في ملفِّ العقدِ ومكانُهُ
 * `service-identity.test.ts`.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createCustomerApp, type CreateCustomerAppOptions } from "../http/app.js";
import { CUSTOMER_SCOPES, CUSTOMERS_SERVICE_AUDIENCE } from "../http/service-identity.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ لهُ بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "customers-test-secret-0123456789";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّرٌ: يُثبتُ أنَّ التوقيعَ يُفحَصُ فعلاً، لا أنَّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "customers-forged-secret-0123456789";

/** كلُّ صلاحيّاتِ هذا الحدِّ: اختبارُ العقدِ يُثبتُ العقدَ لا نقصَ الصلاحيّةِ. */
export const ALL_CUSTOMER_SCOPES: readonly string[] = Object.values(CUSTOMER_SCOPES);

export function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/**
 * المُنتَفِعُ كما كتبَهُ المسارُ: أوّلُ مقطعٍ بعدَ `/customers/`.
 *
 * والقراءةُ نصّيّةٌ بلا تحقّقٍ من الصيغةِ **بقصدٍ**: اختبارُ العقدِ يُنادي
 * بمعرِّفٍ مُشوَّهٍ (`WS-123`) ليُثبتَ 400، فلو رفضَ الاشتقاقُ الصيغةَ لَمَا
 * وُقِّعَ ذلكَ النداءُ ولَصارَ جوابُهُ 401 — أي لَتَبدَّلَ ما يقيسُهُ الاختبارُ.
 */
export function beneficiaryFromUrl(url: string): string | undefined {
  const path = url.split("?")[0] ?? url;
  const match = /^\/customers\/([^/]+)/u.exec(path);
  const value = match?.[1];
  return value === undefined || value === "" ? undefined : decodeURIComponent(value);
}

/**
 * ترويساتُ نداءٍ موقَّعٍ مربوطٍ بهذهِ الطريقةِ وهذا المسارِ وهذا المُنتَفِعِ.
 *
 * والاستعلامُ يُقطَعُ قبلَ التوقيعِ لأنَّ المسارَ الموقَّعَ **لا يشملُ الاستعلامَ**
 * ([ADR-021](../../../../docs/15-decisions/ADR-021-service-token-replay-policy.md) §4)
 * — وهوَ `RISK-0026` المفتوحُ، ويمسُّ على هذا الحدِّ قراءةَ الطلباتِ المُصفّاةَ
 * (`GET /customers/:id/order-requests?status=…`).
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
    serviceName: options.serviceName ?? "customer-bot",
    audience: CUSTOMERS_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_CUSTOMER_SCOPES,
    ...(beneficiary === undefined ? {} : { onBehalfOfPublicId: beneficiary }),
  });
}

/**
 * يلفُّ `inject` لتطبيقٍ قائمٍ كي يوقِّعَ كلَّ نداءٍ، ويعيدُ `inject` الأصليَّ
 * **بلا توقيعٍ** لمن أرادَ إثباتَ الرفضِ.
 *
 * وترويساتُ المُنادي تَغلِبُ التوقيعَ (تُنشَرُ بعدَهُ) كي يستطيعَ اختبارٌ أن
 * يُوقِّعَ لمُنتَفِعٍ آخرَ أو بصلاحيّةٍ ناقصةٍ صراحةً.
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

export interface CustomerAppHarness {
  app: ReturnType<typeof createCustomerApp>;
  keys: ServiceAuthKeyRegistry;
  replayGuard: InMemoryServiceTokenReplayGuard;
  /** `inject` بلا توقيعٍ — لإثباتِ الرفضِ لا لتجاوزِهِ. */
  rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

/**
 * يبني تطبيقَ العميلِ **مفروضاً** ويلفُّ `inject` بالتوقيعِ. تأخذُ الدالّةُ
 * بقيّةَ الخياراتِ كما هيَ كي لا يفقدَ اختبارُ العقدِ ما يُعِدُّهُ.
 */
export function buildSignedCustomerApp(
  options: Omit<CreateCustomerAppOptions, "serviceIdentity">,
): CustomerAppHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const app = createCustomerApp({ ...options, serviceIdentity: { keys, replayGuard } });
  const rawInject = attachSigningInject(app, keys);
  return { app, keys, replayGuard, rawInject };
}

/** الشكلُ الشائعُ في اختبارِ العقدِ: تطبيقٌ موقَّعٌ بلا حاجةٍ إلى بقيّةِ السندِ. */
export function createSignedCustomerApp(
  options: Omit<CreateCustomerAppOptions, "serviceIdentity">,
): ReturnType<typeof createCustomerApp> {
  return buildSignedCustomerApp(options).app;
}
