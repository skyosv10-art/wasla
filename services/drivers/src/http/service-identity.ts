/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ السائقين** (`M1-04` · الموجةُ العاشرةُ · `CLM-0198`).
 *
 * ── لماذا هذا الحدُّ ثانيَ الخمسةِ ─────────────────────────────────────────
 * الموجةُ الثامنةُ (`CLM-0196` · [`ADR-034`](../../../../docs/15-decisions/ADR-034-ingress-boundary-inventory-closure.md))
 * قاستْ خمسةَ حدودِ دخولٍ إنتاجيّةٍ **لا تفرضُ شيئاً** (53 مساراً) وأغلقتْ
 * جردَها بالبابِ 10. والموجةُ التاسعةُ (`CLM-0197`) فرضَتْ حدَّ العميلِ.
 * وهذا الحدُّ يليه في الجردِ: **17 مساراً** بلا ترويسةِ هويّةٍ واحدةٍ.
 *
 * والقياسُ الذي يُبرِّرُ الترتيبَ هوَ عينُهُ الذي قاسَهُ حدُّ العميلِ: لا مُناديَ
 * إنتاجيٍّ عبرَ HTTP — فبوتُ السائقِ يُنادي **حالاتِ الاستعمالِ في العمليّةِ
 * نفسِها** (`bots/driver-bot/src/driver-core.ts`)، ولا مُتغيِّرَ بيئةٍ واحدٌ في
 * `packages/config/env-registry.json` يحملُ عنوانَ هذا الحدِّ. فمُنادُوهُ
 * الفعليّونَ اليومَ هم **بوّاباتُ الخروجِ** وحدَها، وهيَ تُوقِّعُ في الدفعةِ
 * نفسِها — فلا مُنادٍ يُكسَرُ بلا استشارةٍ.
 *
 * ── لماذا كلُّ مسارٍ هنا مربوطٌ بالمُنتَفِعِ ────────────────────────────────
 * كلُّ مسارٍ في هذا العقدِ يبدأُ بـ`/drivers/:waslaPublicId/…` ما خلا
 * `/health` و`POST /drivers` و`POST /drivers/eligibility/tick`. والمَورِدُ
 * مملوكٌ لإنسانٍ بعينِهِ ومُعنوَنٌ في المسارِ. والصلاحيّةُ وحدَها لا تقولُ
 * **أيَّ سائقٍ**: حاملُ `drivers:profile:read` كانَ — لو فُرِضَتِ الصلاحيّةُ
 * وحدَها — يقرأُ ملفَّ كلِّ سائقٍ بتبديلِ حرفٍ في المسارِ. فلذلكَ كلُّ مسارٍ
 * يملكُ `:waslaPublicId` هنا `beneficiary: \"required\"` ومعَهُ مقارنةٌ في
 * `app.ts` بينَ `:waslaPublicId` و`obo` المُوَقَّعِ.
 *
 * ومسارُ `POST /drivers` يقرأُ `wasla_public_id` من **الجسمِ** لا من المسارِ،
 * وهوَ مُنتَفِعٌ مملوكٌ كذلك: حاملُ `drivers:profile:write` يُسجِّلُ سائقاً
 * باسمِ أيِّ مُعرِّفٍ. فالمُنتَفِعُ المُوَقَّعُ يُقابَلُ بـ`wasla_public_id` في
 * الجسمِ، ومخالفتُهُ تُرَدُّ `409` (`DRIVER_ALREADY_REGISTERED`) لا 403 —
 * فلا يُفصَحُ لمن لا يملكُ عن وجودِ المعرِّفِ.
 *
 * و`POST /drivers/eligibility/tick` مسارُ عمليّاتٍ داخليٌّ لا مُنتَفِعَ إنسانٍ
 * له: يُفرَضُ عليه الصلاحيّةُ (`drivers:eligibility:tick`) بلا مُنتَفِعٍ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً** ولا يُقفِلُ `RISK-0051`: ثلاثةُ
 * حدودٍ باقيةٌ (`reputation` · `search` · `subscriptions` = 26 مساراً) وهيَ
 * مُعلَنةٌ في
 * [`SERVICE_AUTH_ENFORCEMENT.md` §5.10](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)،
 * والبابُ 10 هوَ الذي يقولُ كم بقيَ — لا هذا الملفُّ.
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

import type { DriverErrorBody } from "./errors.js";

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ السائقين. يطابقُ `aud` عندَ المنادي. */
export const DRIVERS_SERVICE_AUDIENCE = "drivers";

/**
 * تصنيفُ المسارِ. `\"open\"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/health` وحدَهُ على هذا الحدِّ.
 */
export type DriverRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ السائقين. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ
 * ما يطلبُهُ كلُّ مسارٍ، ومَن يُمنَحُ أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ مُصدِرِ
 * الرمزِ (`packages/authz-policy/src/grants.ts`).
 *
 * والتقسيمُ يتبعُ المَورِدَ لا الطريقةَ: الملفُّ · المناطقُ · المركباتُ ·
 * الوثائقُ · التوفّرُ · الأهليّةُ.
 */
export const DRIVER_SCOPES = {
  profileRead: "drivers:profile:read",
  profileWrite: "drivers:profile:write",
  zoneRead: "drivers:zone:read",
  zoneWrite: "drivers:zone:write",
  vehicleRead: "drivers:vehicle:read",
  vehicleWrite: "drivers:vehicle:write",
  documentRead: "drivers:document:read",
  documentWrite: "drivers:document:write",
  documentReview: "drivers:document:review",
  availabilityWrite: "drivers:availability:write",
  profileSuspend: "drivers:profile:suspend",
  profileReinstate: "drivers:profile:reinstate",
  eligibilityRead: "drivers:eligibility:read",
  eligibilityTick: "drivers:eligibility:tick",
  adminRead: "drivers:admin:read",
} as const;

export type DriverRouteConfig = ServiceIdentityRouteConfig;

export interface DriverServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المُنادي المرفوضُ: كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ —
 * **لا سببَ**. السببُ يُسجَّلُ ولا يُعادُ. والشكلُ هوَ `DriverErrorBody` نفسُهُ
 * الذي يعرفُهُ عقدُ هذا الحدِّ.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): DriverErrorBody {
  return {
    error: { code: decision.code, message: decision.message },
    trace_id: traceId,
  };
}

/**
 * يُركِّبُ الفرضَ على التطبيقِ. يُستدعى مرّةً واحدةً **قبلَ** تسجيلِ المساراتِ
 * كي يرى حاجزُ التصنيفِ كلَّ مسارٍ يُسجَّلُ بعدَهُ — ومسارٌ بلا تصنيفٍ يُسقِطُ
 * الإقلاعَ، فلا يمرُّ مسارٌ جديدٌ بلا قرارٍ مكتوبٍ.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: DriverServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? DRIVERS_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد السائقين",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
