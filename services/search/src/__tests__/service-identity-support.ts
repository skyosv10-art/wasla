/**
 * أدواتٌ مشتركةٌ لاختباراتِ **حدِّ البحث** بعدَ فرضِ هويّةِ الخدمةِ
 * (`M1-04` · الموجةُ الثانيةَ عشرةَ · `CLM-0200`).
 *
 * نفسُ نمطِ حدِّ السمعة: `inject` مُلَفَّفٌ بتوقيعٍ في اختباراتِ العقدِ،
 * و`rawInject` بلا توقيعٍ أو بتوقيعٍ مُخالِفٍ في اختبارِ الفرضِ.
 */

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { buildSearchHttpApp } from "../http/app.js";
import { SEARCH_SCOPES, SEARCH_SERVICE_AUDIENCE } from "../http/service-identity.js";
import type { SearchProductsReadPort, SearchIndexHealthPort } from "../ports.js";

/** سرٌّ اختباريٌّ بطولٍ مقبولٍ؛ لا صلةَ لهُ بأيِّ سرٍّ تشغيليٍّ. */
export const TEST_SERVICE_SECRET = "search-test-secret-0123456789abcdef";
export const TEST_ACTIVE_KID = "test-active";
/** سرٌّ مزوَّفٌ: يُثبتُ أنَّ التوقيعَ يُفحَصُ فعلاً، لا أنَّ الترويسةَ موجودةٌ. */
export const TEST_FORGED_SECRET = "search-forged-secret-0123456789abcdef";

/** كلُّ صلاحيّاتِ هذا الحدِّ. */
export const ALL_SEARCH_SCOPES: readonly string[] = Object.values(SEARCH_SCOPES);

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
 */
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
    serviceName: options.serviceName ?? "search-ingress",
    audience: SEARCH_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: separator < 0 ? url : url.slice(0, separator),
    keys: options.keys ?? createTestKeyRegistry(),
    now: options.now ?? new Date(),
    scopes: options.scopes ?? ALL_SEARCH_SCOPES,
  });
}

/**
 * يبني التطبيقَ بحدٍّ مُفرَضٍ وميناءِ قراءةٍ وهميٍّ.
 */
export function buildEnforcedApp(options: {
  readonly searchReadPort: SearchProductsReadPort;
  readonly indexHealthPort?: SearchIndexHealthPort;
  readonly keys?: ServiceAuthKeyRegistry;
} = {
  searchReadPort: fakeEmptyReadPort(),
}) {
  const keys = options.keys ?? createTestKeyRegistry();
  const { fastify, close } = buildSearchHttpApp({
    searchReadPort: options.searchReadPort,
    ...(options.indexHealthPort === undefined ? {} : { indexHealthPort: options.indexHealthPort }),
    serviceIdentity: {
      keys,
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
  });
  return { fastify, close };
}

/**
 * `inject` مُلَفَّفٌ بتوقيعٍ افتراضيٍّ صحيحٍ — لاختباراتِ العقدِ التي تُثبتُ
 * السلكَ لا الفرضَ.
 */
export async function inject(
  fastify: ReturnType<typeof buildEnforcedApp>["fastify"],
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  const method = (options.method ?? "GET").toUpperCase();
  const rawUrl = options.url ?? "/";
  const url = typeof rawUrl === "string" ? rawUrl : (rawUrl.pathname ?? "/");
  return fastify.inject({
    ...options,
    headers: {
      ...signFor(method, url),
      ...(options.headers ?? {}),
    },
  });
}

/** `inject` بلا توقيعٍ — يُثبتُ أنَّ الحدَّ يرفضُ النداءَ الأعزلَ. */
export async function rawInject(
  fastify: ReturnType<typeof buildEnforcedApp>["fastify"],
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return fastify.inject(options);
}

/** ميناءُ قراءةٍ وهميٌّ يُعيدُ صفحةً فارغةً. */
function fakeEmptyReadPort(): SearchProductsReadPort {
  return {
    async search() {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
      };
    },
  };
}
