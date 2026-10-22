/**
 * `edge.ts` — تركيبُ `@wasla/channel-edge` في جذرِ تركيبِ البوتِ (customer-bot).
 *
 * **لماذا ملفٌّ منفصلٌ لا تعديلٌ في `server.ts`؟** جذرُ التركيبِ يحملُ كلَّ
 * الطبقاتِ معًا (القناةُ · النواةُ · الهويةُ) — وهذا الملفُّ يحملُ الحدَّ
 * وحدهُ. فمراجعُ التركيبِ يقرأُ عقدَ الحدِّ بلا قراءةِ ترتيبِ القناةِ كاملًا.
 *
 * **مُعطَّلٌ افتراضيًّا في الإنتاجِ:** `WASLA_EDGE_ENABLED` غيرُ مسجَّلٍ في
 * `env-registry` ولا يُقرأُ من جسمِ الطلبِ — فالتركيبُ بلا تفويضٍ صريحٍ
 * لا يُسجِّلُ مسارًا حيًّا (fail-closed · ADR-069 §2.6-9).
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";
import { createChannelEdge } from "@wasla/channel-edge";
import { CHANNEL_SESSION_EDGE_SCOPES } from "@wasla/bot-runtime";
import { createServiceRequestSigner, keyRegistryFromEnv } from "@wasla/service-auth";

import { BOT } from "./server.js";

/** إضافاتُ التركيبِ لحزمةِ الحدِّ — تُمرَّرُ إلى `buildBotApp` لا إلى الشفرةِ. */
export interface CustomerBotEdgeOverrides extends BotRuntimeOverrides {
  /** عنوانُ استماعِ identity — لا يُقرأُ من جسمِ الطلبِ. */
  readonly identityServiceUrl?: string;
  /** مفتاحُ التفعيلِ — لا يُقرأُ من جسمِ الطلبِ ولا الترويساتِ. */
  readonly edgeEnabled?: boolean;
}

/**
 * تركيبُ الحدِّ على تطبيقِ البوتِ القائمِ.
 *
 * **لا يُفعِّلُ التركيبُ شيئًا حيًّا:** `WASLA_EDGE_ENABLED` غيرُ مضبوطٍ في
 * الإنتاجِ، وقائمةُ السماحِ الحاليةُ كلُّها `production_open=false` عمدًا
 * (CLM-0521). فالتركيبُ هنا يُسجِّلُ العقدَ لا الفتحَ.
 */
/**
 * خريطةُ عناوينِ وجهاتِ التوجيهِ (D2 · ADR-069 §2.1): عنوانُ كلِّ خدمةٍ من
 * ترتيبِ التركيبِ لا من الطلبِ — وكلُّ المساراتِ الحاليةِ مغلقةٌ فلا يُستعملُ
 * في الإنتاجِ حتى الفتحِ.
 */
function customerServiceUrlFor(service: string): string {
  const env = process.env as Record<string, string | undefined>;
  const byService: Record<string, string> = {
    customers: env.CUSTOMERS_SERVICE_URL ?? "",
    search: env.SEARCH_SERVICE_URL ?? "",
    marketplace: env.MARKETPLACE_SERVICE_URL ?? "",
    reputation: env.REPUTATION_SERVICE_URL ?? "",
    geography: env.GEOGRAPHY_SERVICE_URL ?? "",
  };
  return byService[service] ?? "";
}

/**
 * مصنعُ موقِّعٍ لكلِّ (خدمةٍ · صلاحياتِ مسارٍ) (D5 · ADR-069 §2.1): التوقيعُ
 * بجمهورِ الخدمةِ الوجهةِ — وتركيبُهُ يفشلُ مغلقًا إن لم يمنحْ مصفوفةُ M1-05
 * الدورَ الجمهورَ والصلاحياتِ، فلا مسارَ مفتوحًا نصفَ مُركَّبٍ.
 */
function customerRequestSignerFor(service: string, scopes: readonly string[]) {
  const env = process.env as Record<string, string | undefined>;
  const keys = keyRegistryFromEnv({
    WASLA_SERVICE_AUTH_KEYS: env.WASLA_SERVICE_AUTH_KEYS,
    WASLA_SERVICE_AUTH_ACTIVE_KID: env.WASLA_SERVICE_AUTH_ACTIVE_KID,
  });
  return createServiceRequestSigner({
    serviceName: "customer-bot",
    audience: service,
    keys,
    scopes,
  });
}

export function buildAppWithEdge(overrides?: CustomerBotEdgeOverrides): BotApp {
  const app = buildBotApp(BOT, overrides);
  const env = (overrides?.env ?? process.env) as Record<string, string | undefined>;
  const identityUrl = overrides?.identityServiceUrl ?? env.IDENTITY_SERVICE_URL;
  const edgeEnabled =
    overrides?.edgeEnabled ?? env.WASLA_EDGE_ENABLED === "true";
  if (!edgeEnabled || !identityUrl) {
    // معطَّلٌ افتراضيًّا — ولا مسارَ يُسجَّلُ أصلاً (fail-closed).
    return app;
  }
  const keys = keyRegistryFromEnv({
    WASLA_SERVICE_AUTH_KEYS: env.WASLA_SERVICE_AUTH_KEYS,
    WASLA_SERVICE_AUTH_ACTIVE_KID: env.WASLA_SERVICE_AUTH_ACTIVE_KID,
  });
  const edge = createChannelEdge({
    surface: {
      actorType: "customer",
      botToken: env.CUSTOMER_BOT_TOKEN ?? "",
      requestSigner: createServiceRequestSigner({
        serviceName: "customer-bot",
        audience: "identity",
        keys,
        scopes: CHANNEL_SESSION_EDGE_SCOPES,
      }),
      waslaPublicIdOf: async () => "",
    },
    issueSession: async () => {
      throw new Error("لا يُستدعى في هذا التركيبِ");
    },
    exchangeSession: async () => {
      throw new Error("لا يُستدعى في هذا التركيبِ");
    },
    revokeSession: async () => {
      throw new Error("لا يُستدعى في هذا التركيبِ");
    },
    serviceUrlFor: customerServiceUrlFor,
    requestSignerFor: customerRequestSignerFor,
    allowlistUrl: "packages/channel-edge/allowlist/customer-mini-app.json",
    enabled: true,
    allowedOrigins: [],
  });
  edge.apply(app.app);
  return app;
}
