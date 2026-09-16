/**
 * فرضُ هويّةِ الخدمةِ على حدِّ القناةِ (البوت) — عنصرُ العمل **M1-07**.
 *
 * يتبعُ النمطَ نفسَهُ المُثبَتَ في الحدودِ الثمانيةِ
 * (`services/{delivery,dispatch,geography,identity,marketplace,matching,negotiations,orders}/src/http/service-identity.ts`):
 * `registerServiceIdentityOnFastify` من `@wasla/service-auth/fastify` يُركَّبُ **مرّةً قبلَ
 * المساراتِ**، وكلُّ مسارٍ يُصنَّفُ بصريحِ `serviceIdentity: "open"` أو `{ scopes: [...] }`،
 * والجمهورُ ومغلَّفُ الخطأِ يخصّانِ هذا الحدَّ وحدَهُ.
 *
 * **والحدُّ هنا مختلفٌ عن الحدودِ الثمانيةِ في نقطتَينِ لا يُلغيهما التشابهُ:**
 *
 * 1. **المسارُ الداخليُّ لا الموزَّعُ:** مساراتُ البوتِ تُنادى **داخليّاً** من `bots/*` عبرَ
 *    `fetch` موقَّعٍ بـ`createServiceRequestSigner` — لا تُستقبَلُ من الإنترنتِ العامِّ.
 *    فالحمايةُ هنا ليست بابَ دُخولٍ برّانيٌّ، بل **حاجزُ ثقةٍ داخليٍّ**: نداءٌ غيرُ موقَّعٍ
 *    من حزمةٍ شقيقةٍ لا ينبغي أن يمرَّ بحجّةِ «الداخلُ أمينٌ».
 *
 * 2. **الـwebhook محميٌّ بسرٍّ لا برمز:** `POST /channel/:bot/webhook` يُصنَّفُ `"open"` هنا
 *    لأنَّ حمايتَهُ تتبعُ ADR-007 (سرُّ Telegram webhook)، لا `service-auth`. فلو فُرضَ عليه
 *    `service-auth` لَصارَ كلُّ تحديثٍ واردٍ من Telegram مرفوضاً بـ401.
 *
 * ── الصلاحيّاتُ المُعلنةُ ─────────────────────────────────────────────────
 * ثلاثٌ فقط، لكلِّ مسارٍ داخليٍّ غيرِ الـwebhook وغيرِ `/health`:
 *   `channel:message:send`    — `POST /channel/messages`
 *   `channel:mini-app:read`   — `GET /channel/:bot/mini-app`
 *   `channel:deep-link:create` — `POST /channel/:bot/deep-links`
 *
 * و`/health` مفتوحٌ بتصنيفٍ صريحٍ كما في كلِّ حدٍّ.
 *
 * ── ما لا يفعلُهُ هذا الملفُّ بقصدٍ ────────────────────────────────────────
 * - **لا يقرأُ البيئةَ ولا يبني المفاتيحَ:** مفاتيحُ التحقُّقِ ومخزنُ الإعادةِ يُحقَنانِ
 *   من الجذرِ (`runtime.ts`) عبرَ `CreateBotAppOptions.serviceIdentity` — فالمصنعُ `createBotApp`
 *   بلا تهيئةٍ يبقى **عطلَ بناءٍ** لا خادماً بلا حمايةٍ.
 * - **لا يخترعُ جمهوراً افتراضيّاً:** `audience` إلزاميٌّ بلا قيمةٍ افتراضيّةٍ — كما في
 *   الوسيطِ المركزيِّ نفسِهِ.
 */

import type { FastifyInstance } from "fastify";

import {
  registerServiceIdentityOnFastify,
  type ServiceIdentityDenial,
  type ServiceIdentityRouteConfig,
  type ServiceIdentityRouteIdentity,
} from "@wasla/service-auth/fastify";
import type {
  ServiceAuthKeyRegistry,
  ServiceTokenReplayGuard,
} from "@wasla/service-auth";

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ القناةِ. يطابقُ `aud` عندَ المنادي. */
export const CHANNEL_SERVICE_AUDIENCE = "channel";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ لا يقرأُ
 * ولا يكتبُ بياناتٍ مجاليّةً — وهو `/health` وحدَهُ اليومَ. أمّا الـwebhook فمفتوحٌ هنا
 * لأنَّ حمايتَهُ بسرِّ Telegram (ADR-007) لا بـ`service-auth`.
 */
export type ChannelRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ القناةِ. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ ما
 * يطلبهُ، ومن يمنحُ الصلاحيّةَ لأيِّ خدمةٍ قرارُ `M1-05` عندَ مُصدِرِ الرمزِ.
 */
export const CHANNEL_SCOPES = {
  messageSend: "channel:message:send",
  miniAppRead: "channel:mini-app:read",
  deepLinkCreate: "channel:deep-link:create",
} as const;

export type ChannelRouteConfig = ServiceIdentityRouteConfig;

export interface ChannelServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المنادي المرفوضُ: كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ — لا سبب.
 * يتبعُ شكلَ `ChannelErrorResponse` (`{ code, message, details? }`) لا شكلَ الخدماتِ
 * (`{ code, message, trace_id }`) لأنَّ حدَّ القناةِ عقدُهُ لا يحملُ `trace_id`.
 */
function denialBody(decision: ServiceIdentityDenial, traceId: string) {
  return {
    code: decision.code,
    message: decision.message,
    details: { trace_id: traceId },
  };
}

/**
 * يُركِّبُ الفرضَ على التطبيقِ. يُستدعى مرّةً واحدةً **قبلَ** تسجيلِ المساراتِ كي يرى
 * حاجزُ التصنيفِ كلَّ مسارٍ يُسجَّلُ بعدَهُ.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: ChannelServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? CHANNEL_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد القناة",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
