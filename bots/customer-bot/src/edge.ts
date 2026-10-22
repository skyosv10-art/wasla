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
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  type ServiceRequestSigner,
} from "@wasla/service-auth";

import { fileURLToPath } from "node:url";

import { BOT } from "./server.js";
import { CUSTOMERS_GEOGRAPHY_SCOPES } from "@wasla/customers-service";

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
function customerServiceUrlFor(
  service: string,
  env: Record<string, string | undefined>,
): string {
  const byService: Record<string, string> = {
    customers: env.CUSTOMERS_SERVICE_URL ?? "",
    search: env.SEARCH_SERVICE_URL ?? "",
    marketplace: env.MARKETPLACE_SERVICE_URL ?? "",
    reputation: env.REPUTATION_SERVICE_URL ?? "",
    geography: env.GEOGRAPHY_SERVICE_URL ?? "",
  };
  return byService[service] ?? "";
}

/** سجلُّ مفاتيحِ توقيعِ الخدمةِ من ترتيبِ التركيبِ — لا من الطلبِ. */
function customerEdgeKeys(env: Record<string, string | undefined>) {
  return keyRegistryFromEnv({
    WASLA_SERVICE_AUTH_KEYS: env.WASLA_SERVICE_AUTH_KEYS,
    WASLA_SERVICE_AUTH_ACTIVE_KID: env.WASLA_SERVICE_AUTH_ACTIVE_KID,
  });
}

/**
 * مصنعُ موقِّعٍ لكلِّ خدمةٍ (D5 · ADR-069 §2.1): التوقيعُ بجمهورٍ حرفيٍّ
 * وصلاحياتِ ثابتٍ مسمّىً موثقٍ في دليلِ منحِ M1-05 — والجمهورُ الحرفيُّ هو
 * ما يُقيسُهُ حارسُ المصفوفةِ ساكنًا (فشلٌ مغلقٌ للمجهولِ). ما ليسَ لهُ
 * مصنعٌ هنا لا يُوقِّعُهُ أحدٌ: تركيبُ مسارٍ مفتوحٍ لهُ يفشلُ قبلَ الاستماعِ.
 */
function customerRequestSignerFor(
  service: string,
  env: Record<string, string | undefined>,
): ServiceRequestSigner {
  if (service === "geography") {
    return createServiceRequestSigner({
      serviceName: "customer-bot",
      audience: "geography",
      keys: customerEdgeKeys(env),
      scopes: CUSTOMERS_GEOGRAPHY_SCOPES,
    });
  }
  throw new Error(
    `EDGE_SIGNER_UNGRANTED: لا موقِّعَ معروفًا للخدمةِ ${service} — منحُ M1-05 ناقصةٌ أو قرارُها لم يصدرْ بعدُ`,
  );
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
    // D2/D5: خريطةُ الوجهاتِ والموقِّعاتِ تُغلقُ على `env` التركيبِ (تجاوزاتِ
    // الاختبارِ أو ترتيبَ الإقلاعِ) لا على `process.env` مباشرةً — مصدرٌ واحدٌ
    // للحقيقةِ داخلَ الجذرِ الواحدِ، والاختبارُ يميّزُ المسارَ المغلقَ هذا.
    serviceUrlFor: (service: string) => customerServiceUrlFor(service, env),
    requestSignerFor: (service: string) => customerRequestSignerFor(service, env),
    // مسارُ القائمةِ يُحَلُّ من موقعِ الوحدةِ لا من `cwd` — فلا يصيرُ التركيبُ
    // رهينَ دليلِ التشغيلِ (قياسٌ حيٌّ في اختبارِ التركيبِ لا افتراضَ نشرٍ).
    allowlistUrl: fileURLToPath(
      new URL("../../../packages/channel-edge/allowlist/customer-mini-app.json", import.meta.url),
    ),
    enabled: true,
    allowedOrigins: [],
  });
  edge.apply(app.app);
  return app;
}
