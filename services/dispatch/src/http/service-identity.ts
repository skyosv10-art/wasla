/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ التوزيعِ** (`M1-04`، الموجةُ الرابعةُ).
 *
 * ── لماذا هذا الملفُّ قصيرٌ ────────────────────────────────────────────────
 * الربطُ بـFastify — حاجزُ التصنيفِ عندَ `onRoute`، والفرضُ المُغلَقُ افتراضاً
 * عندَ `onRequest`، و`503` عندَ تعذُّرِ مخزنِ آثارِ الإعادةِ، وقواعدُ التسجيلِ —
 * كلُّه في الوسيطِ المركزيِّ
 * [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts).
 * والذي يخصُّ هذا الحدَّ وحدَه ثلاثةٌ: **جمهورُه** و**صلاحيّاتُه**
 * و**مغلَّفُ خطئِه**.
 *
 * ── ما الذي يحرسُه هذا الحدُّ ──────────────────────────────────────────────
 * حدُّ التوزيعِ يُنشئُ وظائفَ توزيعٍ ويقبلُ العروضَ ويرفضُها ويُلغي الوظائفَ
 * **ويدفعُ النبضةَ**. وأخطرُ ما فيه ليسَ القراءةَ بل ثلاثةٌ:
 *
 *   - `POST /dispatch/offers/:id/accept` — **قبولُ عرضٍ نيابةً عن سائقٍ**.
 *     منادٍ بلا هويّةٍ يقدرُ به على إسنادِ رحلةٍ إلى سائقٍ لم يقبلْها.
 *   - `POST /dispatch/jobs/:id/cancel` — **إلغاءُ وظيفةِ توزيعٍ قائمةٍ**، أي
 *     قطعُ مسارِ طلبٍ حيٍّ.
 *   - `POST /dispatch/tick` — **دفعُ النبضةِ**. الزمنُ في التوزيعِ نبضةٌ لا
 *     ساعةُ حائطٍ، فمن يملكُ دفعَها يملكُ تسريعَ انتهاءِ العروضِ وإعادةَ
 *     التوزيعِ. ولذلك تُفرَدُ له صلاحيّةٌ **لا يحملُها أيُّ قارئٍ**.
 *
 * ── ولماذا هذا الحدُّ يُفرَضُ الآنَ ────────────────────────────────────────
 * لأنّ مُنادِيَه الوحيدَ عبرَ HTTP — `services/negotiations` — خارجَ الحجزِ
 * البشريِّ، **فأمكنَ توقيعُه في الدفعةِ نفسِها**. وحدٌّ يُفرَضُ قبلَ توقيعِ
 * كلِّ منادٍ له يعني `401` في الإنتاجِ لا أمناً. وقد فُرِضَ بعدَ حدِّ الهويّةِ
 * لا قبلَه: الهويّةُ تُصدِرُ الحسابَ **وتبدأُ استعادتَه**، والاستيلاءُ على
 * حسابٍ أشدُّ من الاستيلاءِ على عرضٍ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً**: يبقى حدُّ `geography` غيرَ
 * مفروضٍ لأنّ أحدَ عملائِه في `services/drivers/` المحجوزةِ (`CLM-0004`).
 * ولا يُنشئُ هذا الملفُّ تفويضاً: من يستحقُّ أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ
 * مُصدِرِ الرمزِ. والخريطةُ الصادقةُ في
 * [`SERVICE_AUTH_ENFORCEMENT.md`](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)
 * وحارسُها `scripts/checks/validate-service-auth-coverage.sh` — وهو حارسٌ
 * ناقصٌ بنيويّاً بنصِّ `RISK-0027`.
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

/** جمهور الرمز الذي يقبله حدّ التوزيع. يطابق `aud` عند المنادي. */
export const DISPATCH_SERVICE_AUDIENCE = "dispatch";

/**
 * تصنيف المسار. `"open"` يعني «لا هوية خدمة مطلوبة» ولا يجوز إلا لمسار لا يقرأ
 * ولا يكتب بيانات مجالية — وهو `/health` وحده على هذا الحد.
 */
export type DispatchRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفردات الصلاحيات على حد التوزيع. **ليست مصفوفة أدوار**: الحد يعلن ما يطلبه
 * كل مسار، ومن يمنح أي صلاحية لأي خدمة قرار `M1-05`.
 *
 * والتقسيم يفصل القراءة عن الكتابة، **ويفرد النبضة والقبول والإلغاء** كلاً
 * بصلاحيّته: منادٍ يحتاج قراءةَ عرضٍ لا يجوز أن يحمل رمزاً يقدر به على قبول
 * ذلك العرض نيابةً عن سائق، ولا على دفع نبضة المحرّك كلّه.
 */
export const DISPATCH_SCOPES = {
  jobWrite: "dispatch:job:write",
  jobRead: "dispatch:job:read",
  offerRead: "dispatch:offer:read",
  offerAccept: "dispatch:offer:accept",
  offerReject: "dispatch:offer:reject",
  jobCancel: "dispatch:job:cancel",
  tickWrite: "dispatch:tick:write",
} as const;

export type DispatchRouteConfig = ServiceIdentityRouteConfig;

export interface DispatchServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الرد الذي يراه المنادي المرفوض: كود ورسالة عامة ومُعرّف تتبع — **لا سببَ**.
 * السبب يُسجَّل ولا يُعاد: «رمز منتهٍ» و«توقيع خاطئ» فرقٌ يفيد المهاجم وحده.
 * والشكل هو شكل خطأ هذا الحد نفسه (`code` · `message` · `trace_id`) كما يبنيه
 * `sendDispatchError`، فلا يتعلّم المنادي شكلاً ثانياً ليقرأ رفضاً.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): { code: string; message: string; trace_id: string } {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يركّب الفرض على التطبيق. يُستدعى مرة واحدة **قبل** تسجيل المسارات كي يرى
 * حاجز التصنيف كل مسار يُسجّل بعده — ومسار بلا تصنيف يُسقط الإقلاع، فلا يمر
 * مسار جديد بلا قرار مكتوب.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: DispatchServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? DISPATCH_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد التوزيع",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
