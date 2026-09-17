/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ البحث** (`M1-04` · الموجةُ الثانيةَ عشرةَ · `CLM-0200`).
 *
 * ── لماذا هذا الحدُّ رابعَ الخمسةِ ─────────────────────────────────────────
 * الموجةُ الحاديةَ عشرةَ (`CLM-0199`) فرضَتْ حدَّ السمعة، وهذا الحدُّ يليه في الجردِ:
 * **3 مساراتٍ** بلا ترويسةِ هويّةٍ واحدةٍ.
 *
 * والقياسُ الذي يُبرِّرُ الترتيبَ هوَ عينُهُ الذي قاسَهُ حدُّ السمعة: لا مُناديَ
 * إنتاجيٍّ عبرَ HTTP — فمستهلكُ الأحداثِ يُنادي **حالاتِ الاستعمالِ في العمليّةِ
 * نفسِها**، ولا مُتغيِّرَ بيئةٍ واحدٌ في `packages/config/env-registry.json` يحملُ
 * عنوانَ هذا الحدِّ. فمُنادُوهُ الفعليّونَ اليومَ هم **بوّابةُ الخروجِ** وحدَها،
 * وهيَ تُوقِّعُ في الدفعةِ نفسِها — فلا مُنادٍ يُكسَرُ بلا استشارةٍ.
 *
 * ── لماذا لا مُنتَفِعَ إنسانٍ هنا ────────────────────────────────────────────
 * المسارانِ المفروضانِ (`/search/ready` و`/search/products`) يقرآنِ الفهرسَ
 * المُشتقَّ من أحداثِ السوقِ — لا يُلامسانِ مَورِداً مملوكاً لإنسانٍ بعينِهِ.
 * فالصلاحيّةُ وحدَها تكفي: حاملُ `search:products:read` يقرأُ ما يُسمَحُ له بهِ
 * في الرمزِ، لا ما يختارُهُ من مسارٍ. ولا `beneficiary` على أيِّ مسارٍ هنا.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً** ولا يُقفِلُ `RISK-0051`: حدٌّ
 * باقٍ واحدٌ (`subscriptions` = 12 مساراً) وهوَ مُعلَنٌ في
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

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ البحث. يطابقُ `aud` عندَ المنادي. */
export const SEARCH_SERVICE_AUDIENCE = "search";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/search/health` وحدَهُ على هذا الحدِّ.
 */
export type SearchRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ البحث. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ
 * ما يطلبُهُ كلُّ مسارٍ، ومَن يُمنَحُ أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ مُصدِرِ
 * الرمزِ (`packages/authz-policy/src/grants.ts`).
 */
export const SEARCH_SCOPES = {
  readyRead: "search:ready:read",
  productsRead: "search:products:read",
} as const;

export type SearchRouteConfig = ServiceIdentityRouteConfig;

export interface SearchServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المُنادي المرفوضُ: كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ —
 * **لا سببَ**. السببُ يُسجَّلُ ولا يُعادُ. والشكلُ هوَ `SearchErrorBody` نفسُهُ
 * الذي يعرفُهُ عقدُ هذا الحدِّ.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): { code: string; message: string; trace_id: string } {
  return {
    code: decision.code,
    message: decision.message,
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
  options: SearchServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? SEARCH_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد البحث",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
