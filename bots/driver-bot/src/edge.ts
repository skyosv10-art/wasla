/**
 * `edge.ts` — تركيبُ `@wasla/channel-edge` في جذرِ تركيبِ البوتِ (driver-bot).
 *
 * **لماذا ملفٌّ منفصلٌ لا تعديلٌ في `server.ts`؟** جذرُ التركيبِ يحملُ كلَّ
 * الطبقاتِ معًا — وهذا الملفُّ يحملُ الحدَّ وحدهُ. فمراجعُ التركيبِ يقرأُ عقدَ
 * الحدِّ بلا قراءةِ ترتيبِ القناةِ كاملًا.
 *
 * **مُعطَّلٌ افتراضيًّا في الإنتاجِ:** `WASLA_EDGE_ENABLED` غيرُ مسجَّلٍ في
 * `env-registry` ولا يُقرأُ من جسمِ الطلبِ — فالتركيبُ بلا تفويضٍ صريحٍ
 * لا يُسجِّلُ مسارًا حيًّا (fail-closed · ADR-069 §2.6-9).
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";
import { createChannelEdge } from "@wasla/channel-edge";
import { CHANNEL_SESSION_EDGE_SCOPES } from "@wasla/bot-runtime";
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  type ServiceRequestSigner,
} from "@wasla/service-auth";

import { BOT } from "./server.js";

/** إضافاتُ التركيبِ لحزمةِ الحدِّ — تُمرَّرُ إلى `buildBotApp` لا إلى الشفرةِ. */
export interface DriverBotEdgeOverrides extends BotRuntimeOverrides {
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
 * ترتيبِ التركيبِ لا من الطلبِ — وكلُّ المساراتِ الحاليةِ مغلقةٌ.
 */
function driverServiceUrlFor(service: string): string {
  const env = process.env as Record<string, string | undefined>;
  const byService: Record<string, string> = {
    drivers: env.DRIVERS_SERVICE_URL ?? "",
    orders: env.ORDERS_SERVICE_URL ?? "",
    dispatch: env.DISPATCH_SERVICE_URL ?? "",
  };
  return byService[service] ?? "";
}

/**
 * مصنعُ موقِّعٍ لكلِّ خدمةٍ (D5 · ADR-069 §2.1): لا تمنحُ مصفوفةُ M1-05
 * دورَ السائقِ اليومَ أيَّ جمهورٍ من خدماتِ التوجيهِ (drivers · orders ·
 * dispatch) — فلا مصنعَ حرفيًّا هنا، وكلُّ مسارٍ يُفتحُ منها يفشلُ تركيبُهُ
 * قبلَ الاستماعِ (فشلٌ مغلقٌ) حتى يصدرَ قرارُ المنحِ.
 */
function driverRequestSignerFor(service: string): ServiceRequestSigner {
  throw new Error(
    `EDGE_SIGNER_UNGRANTED: لا منحَ في M1-05 لـdriver-bot على ${service} — قرارُ المنحِ للمالكِ`,
  );
}

export function buildAppWithEdge(overrides?: DriverBotEdgeOverrides): BotApp {
  const app = buildBotApp(BOT, overrides);
  const env = (overrides?.env ?? process.env) as Record<string, string | undefined>;
  const identityUrl = overrides?.identityServiceUrl ?? env.IDENTITY_SERVICE_URL;
  const edgeEnabled = overrides?.edgeEnabled ?? env.WASLA_EDGE_ENABLED === "true";
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
      actorType: "driver",
      botToken: env.DRIVER_BOT_TOKEN ?? "",
      requestSigner: createServiceRequestSigner({
        serviceName: "driver-bot",
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
    serviceUrlFor: driverServiceUrlFor,
    requestSignerFor: driverRequestSignerFor,
    allowlistUrl: "packages/channel-edge/allowlist/driver-mini-app.json",
    enabled: true,
    allowedOrigins: [],
  });
  edge.apply(app.app);
  return app;
}
