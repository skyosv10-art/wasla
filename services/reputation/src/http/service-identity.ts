/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ السمعة** (`M1-04` · الموجةُ الحاديةَ عشرةَ · `CLM-0199`).
 *
 * ── لماذا هذا الحدُّ ثالثَ الخمسةِ ─────────────────────────────────────────
 * الموجةُ العاشرةُ (`CLM-0198`) فرضَتْ حدَّ السائقين، وهذا الحدُّ يليه في الجردِ:
 * **11 مساراً** بلا ترويسةِ هويّةٍ واحدةٍ.
 *
 * والقياسُ الذي يُبرِّرُ الترتيبَ هوَ عينُهُ الذي قاسَهُ حدُّ السائقين: لا مُناديَ
 * إنتاجيٍّ عبرَ HTTP — فمستهلكُ الأحداثِ يُنادي **حالاتِ الاستعمالِ في العمليّةِ
 * نفسِها**، ولا مُتغيِّرَ بيئةٍ واحدٌ في `packages/config/env-registry.json` يحملُ
 * عنوانَ هذا الحدِّ. فمُنادُوهُ الفعليّونَ اليومَ هم **بوّاباتُ الخروجِ** وحدَها،
 * وهيَ تُوقِّعُ في الدفعةِ نفسِها — فلا مُنادٍ يُكسَرُ بلا استشارةٍ.
 *
 * ── لماذا بعضُ المساراتِ هنا مربوطٌ بالمُنتَفِعِ ────────────────────────────
 * مسارُ `GET /reputation/scores/:subjectType/:subjectPublicId` يقرأُ نتيجةَ إنسانٍ
 * بعينِهِ، والمَورِدُ مملوكٌ ومُعنوَنٌ في المسارِ. والصلاحيّةُ وحدَها لا تقولُ
 * **أيَّ شخصٍ**: حاملُ `reputation:score:read` كانَ — لو فُرِضَتِ الصلاحيّةُ وحدَها —
 * يقرأُ نتيجةَ كلِّ شخصٍ بتبديلِ حرفٍ في المسارِ. فلذلكَ يملكُ `beneficiary:
 * "required"` ومعَهُ مقارنةٌ في `app.ts` بينَ `:subjectPublicId` و`obo` المُوَقَّعِ.
 *
 * ومسارُ `POST /reputation/ratings` يقرأُ `rater_public_id` من **الجسمِ** لا من
 * المسارِ، وهوَ مُنتَفِعٌ مملوكٌ كذلك: حاملُ `reputation:rating:write` يُقيِّمُ
 * باسمِ أيِّ مُعرِّفٍ. فالمُنتَفِعُ المُوَقَّعُ يُقابَلُ بـ`rater_public_id` في
 * الجسمِ، ومخالفتُهُ تُرَدُّ `404` (`REPUTATION_SCORE_NOT_FOUND`) لا 403 —
 * فلا يُفصَحُ لمن لا يملكُ عن وجودِ المعرِّفِ.
 *
 * وبقيّةُ المساراتِ الثمانيةِ داخليّةٌ/منصّةيّةٌ لا مُنتَفِعَ إنسانٍ لها: تُفرَضُ
 * عليها الصلاحيّةُ بلا مُنتَفِعٍ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً** ولا يُقفِلُ `RISK-0051`: حدودانِ
 * باقيّتانِ (`search` · `subscriptions` = 15 مساراً) وهيَ مُعلَنةٌ في
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

import type { ReputationErrorBody } from "./errors.js";

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ السمعة. يطابقُ `aud` عندَ المنادي. */
export const REPUTATION_SERVICE_AUDIENCE = "reputation";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/health` وحدَهُ على هذا الحدِّ.
 */
export type ReputationRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ السمعة. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ
 * ما يطلبُهُ كلُّ مسارٍ، ومَن يُمنَحُ أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ مُصدِرِ
 * الرمزِ (`packages/authz-policy/src/grants.ts`).
 *
 * والتقسيمُ يتبعُ المَورِدَ لا الطريقةَ: الوقائعُ · النتائجُ · التقييماتُ ·
 * الإشاراتُ · القواعدُ · النبضةُ.
 */
export const REPUTATION_SCOPES = {
  factWrite: "reputation:fact:write",
  factRead: "reputation:fact:read",
  scoreRead: "reputation:score:read",
  scoreRecompute: "reputation:score:recompute",
  ratingWrite: "reputation:rating:write",
  ratingRead: "reputation:rating:read",
  fraudSignalRead: "reputation:fraud-signal:read",
  rulesetRead: "reputation:ruleset:read",
  tickRun: "reputation:tick:run",
} as const;

export type ReputationRouteConfig = ServiceIdentityRouteConfig;

export interface ReputationServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المُنادي المرفوضُ: كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ —
 * **لا سببَ**. السببُ يُسجَّلُ ولا يُعادُ. والشكلُ هوَ `ReputationErrorBody` نفسُهُ
 * الذي يعرفُهُ عقدُ هذا الحدِّ.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): ReputationErrorBody {
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
  options: ReputationServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? REPUTATION_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد السمعة",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
