/**
 * فرضُ هويّةِ الخدمةِ على حدِّ المطابقةِ.
 *
 * ── ما تغيّرَ هنا في `M1-04`، وما لم يتغيّرْ ───────────────────────────────
 * كان هذا الملفُّ يحملُ **الربطَ بـFastify** كلَّه: حاجزَ التصنيفِ عندَ
 * `onRoute`، والفرضَ عندَ `onRequest`، وقواعدَ التسجيلِ ومستوياتِه. وكانت
 * تلك حُجَجاً صحيحةً **لكلِّ حدٍّ لا لحدِّ المطابقةِ وحدَه**، فنُقلت إلى الوسيطِ
 * المركزيِّ [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts)
 * — وهو ما كانت `packages/service-auth/src/index.ts` تنتظرُه بنصِّها.
 *
 * والذي بقيَ هنا هو **مفرداتُ هذا الحدِّ وحدَها**: جمهورُه، وصلاحيّاتُه،
 * ومغلَّفُ خطئِه. فلا يخترعُ الوسيطُ المركزيُّ شيئاً من هذه الثلاثةِ:
 * `audience` و`denialBody` **إلزاميّانِ عندَه بلا قيمةٍ افتراضيّةٍ**، لأنَّ
 * جمهوراً افتراضيّاً يجعلُ خدمتَينِ تقبلانِ رمزَ بعضِهما، ومغلَّفاً افتراضيّاً
 * يُخرِجُ من الحدِّ شكلَ خطأٍ لا يعرفُه عقدُه.
 *
 * **والسلوكُ المفروضُ لم يتغيّرْ بحرفٍ**: المصفوفةُ الأربعُ (لا هويّةَ · هويّةٌ
 * منتحلةٌ · هويّةٌ صحيحةٌ · صلاحيّةٌ ناقصةٌ)، والطزاجةُ و`503` عندَ تعذُّرِ
 * المخزنِ، وحدودُ الربطِ والتصنيفِ — كلُّها يحرسُها
 * [`http-service-identity.test.ts`](../__tests__/http-service-identity.test.ts)
 * الذي **لم يُمَسَّ في هذه الدفعةِ بقصدٍ**: اختبارٌ يُعدَّلُ مع الشفرةِ التي
 * يحرسُها لا يحرسُها. والتغطيةُ الكاملةُ لبقيّةِ الحدودِ ما زالت **غيرَ
 * مُدَّعاةٍ** هنا: الخريطةُ في
 * [`SERVICE_AUTH_ENFORCEMENT.md`](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)،
 * وحارسُها `scripts/checks/validate-service-auth-coverage.sh`.
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

import type { MatchingErrorBody } from "./errors.js";

/** جمهور الرمز الذي تقبله هذه الخدمة. يطابق aud عند المنادي. */
export const MATCHING_SERVICE_AUDIENCE = "matching";

/**
 * تصنيف المسار. `"open"` يعني «لا هوية خدمة مطلوبة» ولا يجوز إلا لمسار لا يقرأ
 * ولا يكتب بيانات مجالية — وهو `/health` وحده اليوم.
 */
export type MatchingRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفردات الصلاحيات على هذا الحد. **ليست مصفوفة أدوار**: الحد يعلن ما يطلبه،
 * ومن يمنح الصلاحية لأي خدمة قرار M1-05 عند مُصدر الرمز.
 */
export const MATCHING_SCOPES = {
  candidatesEvaluate: "matching:candidates:evaluate",
  candidacyRead: "matching:candidacy:read",
  candidacyWrite: "matching:candidacy:write",
  rulesetsRead: "matching:rulesets:read",
  decisionsRead: "matching:decisions:read",
} as const;

export type MatchingRouteConfig = ServiceIdentityRouteConfig;

export interface MatchingServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/** الرد الذي يراه المنادي المرفوض: كود ورسالة عامة ومُعرّف تتبع، لا سبب. */
function denialBody(decision: ServiceIdentityDenial, traceId: string): MatchingErrorBody {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يركّب الفرض على التطبيق. يُستدعى مرة واحدة **قبل** تسجيل المسارات كي يرى
 * حاجز التصنيف كل مسار يُسجّل بعده.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: MatchingServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? MATCHING_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد المطابقة",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
