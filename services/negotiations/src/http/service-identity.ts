/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ المفاوضاتِ** (`M1-04` · المراجعةُ 26/N).
 *
 * ── لماذا هذا الحدُّ الآنَ، ولماذا لم يكنْ ضمنَ الموجاتِ الستِّ ──────────────
 * الموجاتُ الستُّ فرضت: المطابقةَ والطلباتِ والهويّةَ والتوزيعَ والتوصيلَ
 * والجغرافيا. وبقيَ حدُّ المفاوضاتِ **مفتوحاً** لا بقرارٍ مكتوبٍ بل لأنَّ
 * مُنادِيهِ لم يكونا مرئيَّينِ: حارسُ التغطيةِ كانَ أعمى عن `bots/`
 * (`RISK-0027`). فلمّا أُبصِرَ الحارسُ في المراجعةِ 24/N ظهرَ عميلانِ حقيقيّانِ
 * بلا موقِّعٍ — `bots/{customer,driver}-bot/src/infrastructure/http-negotiations.ts`
 * — فأُدرِجا «مؤجَّلَينِ» بسببٍ صادقٍ: **توقيعُ نداءٍ إلى حدٍّ لا يتحقَّقُ
 * طمأنينةٌ بلا فائدةٍ**. وهذا الملفُّ يرفعُ ذلكَ السببَ: يُفرَضُ الحدُّ أوّلاً،
 * فيصيرُ التوقيعُ نافعاً لا تجميليّاً.
 *
 * ── لماذا هو قصيرٌ ─────────────────────────────────────────────────────────
 * الربطُ بـFastify — حاجزُ التصنيفِ عندَ `onRoute`، والفرضُ المُغلَقُ افتراضاً
 * عندَ `onRequest`، و`503` عندَ تعذُّرِ مخزنِ آثارِ الإعادةِ — كلُّهُ في الوسيطِ
 * المركزيِّ [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts).
 * والذي يخصُّ هذا الحدَّ ثلاثةٌ: **جمهورُه** و**صلاحيّاتُه** و**مغلَّفُ خطئِه**.
 *
 * ── ولمَ هذا التقسيمُ للصلاحيّاتِ ──────────────────────────────────────────
 * التقسيمُ يتبعُ **الأفعالَ لا الجداولَ**، وأهمُّ فرقٍ فيهِ أنَّ **القبولَ
 * والرفضَ** (`round:decide`) ليسا كـ**الاقتراحِ** (`round:write`): القبولُ
 * يُنشئُ اتّفاقاً ويُحرِّكُ سعراً في محرّكِ الطلبِ، فرمزٌ طُلِبَ لاقتراحِ دورٍ
 * لا ينبغي أن يبلغَ إنهاءَ التفاوضِ. و**النبضةُ** (`tick:run`) صلاحيّةٌ
 * مستقلّةٌ لأنَّها كتابةٌ جماعيّةٌ على خيوطِ كلِّ المستعملينَ، ومُنادِيها
 * مُجدولٌ تشغيليٌّ لا بوتُ مستعملٍ. ومَن يمنحُ أيَّ صلاحيّةٍ لأيِّ خدمةٍ قرارُ
 * `M1-05` عندَ مُصدِرِ الرمزِ، لا قرارُ هذا الملفِّ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يُنجِزُ `M1-04`** ولا يُغلِقُ `RISK-0027`: يبقى حدُّ
 * `services/marketplace` غيرَ مفروضٍ، ويبقى الخطرُ بعهدةِ مالكِهِ (§9).
 * الخريطةُ الصادقةُ في [`SERVICE_AUTH_ENFORCEMENT.md`](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)
 * وحارسُها `scripts/checks/validate-service-auth-coverage.sh`.
 */

import type { FastifyInstance } from "fastify";

import type {
  ServiceAuthKeyRegistry,
  ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import {
  registerServiceIdentityOnFastify,
  type ServiceIdentityDenial,
  type ServiceIdentityRouteConfig,
  type ServiceIdentityRouteIdentity,
} from "@wasla/service-auth/fastify";

import type { NegotiationErrorBody } from "./errors.js";

/** جمهورُ الرمزِ الذي يقبلُهُ محرّكُ المفاوضاتِ. يطابقُ `aud` عندَ المُنادي. */
export const NEGOTIATIONS_SERVICE_AUDIENCE = "negotiations";

/**
 * تصنيفُ المسارِ. `"open"` يعني «لا هويّةَ خدمةٍ مطلوبةٌ» ولا يجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/health` وحدَهُ على هذا الحدِّ.
 */
export type NegotiationsRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ المفاوضاتِ. **ليست مصفوفةَ أدوارٍ**: الحدُّ
 * يُعلِنُ ما يطلبُهُ كلُّ مسارٍ، والمنحُ قرارُ `M1-05` عندَ مُصدِرِ الرمزِ.
 */
export const NEGOTIATIONS_SCOPES = {
  threadWrite: "negotiations:thread:write",
  threadRead: "negotiations:thread:read",
  roundWrite: "negotiations:round:write",
  roundDecide: "negotiations:round:decide",
  roundRead: "negotiations:round:read",
  messageWrite: "negotiations:message:write",
  messageRead: "negotiations:message:read",
  agreementRead: "negotiations:agreement:read",
  tickRun: "negotiations:tick:run",
} as const;

export type NegotiationsRouteConfig = ServiceIdentityRouteConfig;

export interface NegotiationsServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المُنادي المرفوضُ: رمزٌ ورسالةٌ عامّةٌ ومُعرّفُ تتبُّعٍ —
 * **لا سببَ**. فالسببُ يُسجَّلُ ولا يُعادُ: «رمزٌ منتهٍ» و«توقيعٌ خاطئٌ» فرقٌ
 * يفيدُ المهاجمَ وحدَهُ. والشكلُ هوَ `NegotiationErrorBody` نفسُهُ الذي يعرفُهُ
 * عقدُ هذا الحدِّ، فلا يخرجُ منهُ شكلُ خطأٍ لا يعرفُهُ المُنادي.
 */
function denialBody(decision: ServiceIdentityDenial, traceId: string): NegotiationErrorBody {
  // والشكلُ مُعشَّشٌ (`error.code`) لأنَّ عقدَ هذا الحدِّ هكذا كُتِبَ، ولو
  // سُطِّحَ هنا لأخرجَ الرفضُ شكلَ خطأٍ لا يعرفُهُ مُنادٍ يُحلِّلُ `error.code`.
  return { error: { code: decision.code, message: decision.message }, trace_id: traceId };
}

/**
 * يُركِّبُ الفرضَ على التطبيقِ. يُستدعى مرّةً واحدةً **قبلَ** تسجيلِ المساراتِ
 * كي يرى حاجزُ التصنيفِ كلَّ مسارٍ يُسجَّلُ بعدَهُ — ومسارٌ بلا تصنيفٍ يُسقِطُ
 * الإقلاعَ، فلا يمرُّ مسارٌ جديدٌ بلا قرارٍ مكتوبٍ.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: NegotiationsServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? NEGOTIATIONS_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد المفاوضات",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined ? {} : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
