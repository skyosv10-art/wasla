/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ الهويّةِ** (`M1-04`، الموجةُ الثالثةُ).
 *
 * ── لماذا هذا الملفُّ قصيرٌ ────────────────────────────────────────────────
 * الربطُ بـFastify — حاجزُ التصنيفِ عندَ `onRoute`، والفرضُ المُغلَقُ افتراضاً
 * عندَ `onRequest`، و`503` عندَ تعذُّرِ مخزنِ آثارِ الإعادةِ، وقواعدُ التسجيلِ —
 * كلُّه في الوسيطِ المركزيِّ
 * [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts).
 * والذي يخصُّ هذا الحدَّ وحدَه ثلاثةٌ: **جمهورُه** و**صلاحيّاتُه**
 * و**مغلَّفُ خطئِه**.
 *
 * ── لماذا هذا الحدُّ أخطرُ ما بقيَ ─────────────────────────────────────────
 * حدُّ الهويّةِ يُصدِرُ `wasla_public_id` ويربطُ هويّاتٍ خارجيّةً **ويبدأُ
 * استعادةَ الحسابِ**. فـ`POST /identity/users/:id/links` كانَ يقبلُ من أيِّ
 * منادٍ ربطَ مُعرِّفٍ خارجيٍّ بحسابٍ قائمٍ، و`POST …/recovery` يبدأُ استعادةً —
 * **وهذانِ أقربُ طريقٍ إلى استيلاءٍ على حسابٍ** لو نُودِيَ الحدُّ من داخلِ
 * الشبكةِ بلا هويّةِ خدمةٍ. ولذلك قُدِّمَ على حدِّ التوزيعِ.
 *
 * ── ولماذا يُفرَضُ الآنَ لا قبلَ ذلكَ ──────────────────────────────────────
 * لأنّ عميلَيهِ — `customers` و`geography` — كلاهما خارجَ الحجزِ البشريِّ
 * (`CLM-0004` يحجزُ `services/drivers/`)، **فأمكنَ توقيعُهما في الدفعةِ نفسِها**.
 * وحدٌّ يُفرَضُ قبلَ توقيعِ كلِّ منادٍ له يعني `401` في الإنتاجِ لا أمناً.
 * وحدُّ **الجغرافيا نفسِه** يبقى غيرَ مفروضٍ لهذا السببِ بعينِه: أحدُ عملائِه
 * في `services/drivers/`.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً**، ولا يُنشئُ تفويضاً: من يستحقُّ
 * أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ مُصدِرِ الرمزِ. والخريطةُ الصادقةُ في
 * [`SERVICE_AUTH_ENFORCEMENT.md`](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)
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

import type { IdentityErrorBody } from "./errors.js";

/** جمهور الرمز الذي يقبله حدّ الهويّة. يطابق `aud` عند المنادي. */
export const IDENTITY_SERVICE_AUDIENCE = "identity";

/**
 * تصنيف المسار. `"open"` يعني «لا هوية خدمة مطلوبة» ولا يجوز إلا لمسار لا يقرأ
 * ولا يكتب بيانات مجالية — وهو `/health` وحده على هذا الحد.
 */
export type IdentityRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفردات الصلاحيات على حد الهويّة. **ليست مصفوفة أدوار**: الحد يعلن ما يطلبه
 * كل مسار، ومن يمنح أي صلاحية لأي خدمة قرار `M1-05`.
 *
 * والتقسيم يفصل **القراءة** عن **الكتابة** ويفصل الكتابتين الخطيرتين (الربط
 * والاستعادة) عن حلّ الهويّة: عميل يحتاج «هل هذا المستخدم موجود» لا يجوز أن
 * يحمل رمزاً يقدر به على بدء استعادة حساب.
 */
export const IDENTITY_SCOPES = {
  resolveWrite: "identity:resolve:write",
  userRead: "identity:user:read",
  linkWrite: "identity:link:write",
  recoveryWrite: "identity:recovery:write",
  historyRead: "identity:history:read",
} as const;

export type IdentityRouteConfig = ServiceIdentityRouteConfig;

export interface IdentityServiceIdentityOptions {
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
 * والشكل هو `IdentityErrorBody` نفسه الذي يعرفه عقد هذا الحد.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): IdentityErrorBody {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يركّب الفرض على التطبيق. يُستدعى مرة واحدة **قبل** تسجيل المسارات كي يرى
 * حاجز التصنيف كل مسار يُسجّل بعده — ومسار بلا تصنيف يُسقط الإقلاع، فلا يمر
 * مسار جديد بلا قرار مكتوب.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: IdentityServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? IDENTITY_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد الهويّة",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
