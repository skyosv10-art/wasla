/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ الاشتراك** (`M1-04` · الموجةُ الثالثةَ عشرةَ · `CLM-0201`).
 *
 * ── لماذا هذا الحدُّ أخيرَ الخمسةِ ─────────────────────────────────────────
 * الموجةُ الثانيةَ عشرةَ (`CLM-0200`) فرضَتْ حدَّ البحث، وهذا الحدُّ يليه في الجردِ:
 * **اثنا عشرَ مساراً** بلا ترويسةِ هويّةٍ واحدةٍ — وهوَ آخرُ حدٍّ صامتٌ في `RISK-0051`.
 *
 * والقياسُ الذي يُبرِّرُ الترتيبَ هوَ عينُهُ الذي قاسَهُ ما قبله: لا مُناديَ إنتاجيٍّ
 * عبرَ HTTP — فمستهلكُ الأحداثِ يُنادي **حالاتِ الاستعمالِ في العمليّةِ نفسِها**، ولا
 * مُتغيِّرَ بيئةٍ واحدٌ في `packages/config/env-registry.json` يحملُ عنوانَ هذا الحدِّ.
 * فمُنادُوهُ الفعليّونَ اليومَ هم **بوّاباتُ الخروجِ** وحدَها، وهيَ تُوقِّعُ في الدفعةِ
 * نفسِها — فلا مُنادٍ يُكسَرُ بلا استشارةٍ.
 *
 * ── لماذا بعضُ المساراتِ هنا مربوطٌ بالمُنتَفِعِ ────────────────────────────
 * أربعةُ مساراتٍ تحملُ `:driverPublicId` في المسارِ، وواحدٌ يحملُ `:ownerPublicId`:
 * المَورِدُ مملوكٌ ومُعنوَنٌ. والصلاحيّةُ وحدَها لا تقولُ **أيَّ سائقٍ**: حاملُ
 * `subscriptions:state:read` كانَ — لو فُرِضَتِ الصلاحيّةُ وحدَها — يقرأُ حالةَ كلِّ
 * سائقٍ بتبديلِ حرفٍ في المسارِ. فلذلكَ يملكُ `beneficiary: "required"` ومعَهُ مقارنةٌ
 * في `app.ts` بينَ المُعرِّفِ في المسارِ و`obo` المُوَقَّعِ.
 *
 * ومسارُ `POST /subscriptions` يقرأُ `driver_public_id` من **الجسمِ** لا من المسارِ،
 * وهوَ مُنتَفِعٌ مملوكٌ كذلك. ومسارُ `POST /referrals` يقرأُ `referee_public_id` من
 * الجسمِ. فالمُنتَفِعُ المُوَقَّعُ يُقابَلُ بهما، ومخالفتُهُ تُرَدُّ `404` لا 403 —
 * فلا يُفصَحُ لمن لا يملكُ عن وجودِ المعرِّفِ.
 *
 * وبقيّةُ المساراتِ الخمسةِ داخليّةٌ/منصّةيّةٌ لا مُنتَفِعَ إنسانٍ لها: تُفرَضُ
 * عليها الصلاحيّةُ بلا مُنتَفِعٍ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً** — ترقيتُهُ إلى `Completed` لمالكِ
 * البرنامجِ وحدَهُ (§9). لكنّ `RISK-0051` يصيرُ بلا حدودٍ صامتةٍ: صفرُ مساراتٍ
 * بلا هويّةٍ.
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

import type { SubscriptionErrorEnvelope } from "./errors.js";

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ الاشتراك. يطابقُ `aud` عندَ المنادي. */
export const SUBSCRIPTIONS_SERVICE_AUDIENCE = "subscriptions";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/health` وحدَهُ على هذا الحدِّ.
 */
export type SubscriptionsRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ الاشتراك. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ
 * ما يطلبُهُ كلُّ مسارٍ، ومَن يُمنَحُ أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ مُصدِرِ
 * الرمزِ (`packages/authz-policy/src/grants.ts`).
 *
 * والتقسيمُ يتبعُ المَورِدَ لا الطريقةَ: الخططُ · الاشتراكاتُ · الحالةُ ·
 * التنشيطُ · إعادةُ الحسابِ · المُددُ · النبضةُ · الإحالاتُ.
 */
export const SUBSCRIPTIONS_SCOPES = {
  plansRead: "subscriptions:plans:read",
  subscriptionsWrite: "subscriptions:subscriptions:write",
  stateRead: "subscriptions:state:read",
  activateWrite: "subscriptions:activate:write",
  recomputeWrite: "subscriptions:recompute:write",
  periodsRead: "subscriptions:periods:read",
  tickRun: "subscriptions:tick:run",
  referralsWrite: "subscriptions:referrals:write",
  referralsRead: "subscriptions:referrals:read",
} as const;

export type SubscriptionsRouteConfig = ServiceIdentityRouteConfig;

export interface SubscriptionsServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المُنادي المرفوضُ: كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ —
 * **لا سببَ**. السببُ يُسجَّلُ ولا يُعادُ. والشكلُ هوَ `SubscriptionErrorEnvelope` نفسُهُ
 * الذي يعرفُهُ عقدُ هذا الحدِّ.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): SubscriptionErrorEnvelope {
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
  options: SubscriptionsServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? SUBSCRIPTIONS_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد الاشتراك",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
