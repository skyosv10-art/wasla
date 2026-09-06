/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ الطلباتِ** (`M1-04`، الموجةُ الثانيةُ).
 *
 * ── لماذا هذا الملفُّ قصيرٌ ────────────────────────────────────────────────
 * الربطُ بـFastify — حاجزُ التصنيفِ عندَ `onRoute`، والفرضُ المُغلَقُ افتراضاً
 * عندَ `onRequest`، و`503` عندَ تعذُّرِ مخزنِ آثارِ الإعادةِ، وقواعدُ التسجيلِ —
 * كلُّه في الوسيطِ المركزيِّ
 * [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts).
 * والذي يخصُّ هذا الحدَّ وحدَه ثلاثةٌ: **جمهورُه** و**صلاحيّاتُه**
 * و**مغلَّفُ خطئِه** — وهي التي يكتبُها هذا الملفُّ، ولا يخترعُ الوسيطُ منها
 * شيئاً (`audience` و`denialBody` إلزاميّانِ عندَه بلا قيمةٍ افتراضيّةٍ).
 *
 * ── لماذا الطلباتُ قبلَ الجغرافيا ─────────────────────────────────────────
 * حدُّ الجغرافيا له ثلاثةُ عملاءَ أحدُهم في `services/drivers/`، وهي محجوزةٌ
 * لمالكٍ بشريٍّ (`CLM-0004`)، **وفرضُ حدٍّ قبلَ توقيعِ كلِّ عملائِه يعني `401`
 * في الإنتاجِ** — فلا يُفرَضُ حدٌّ ما لم يُوقَّعْ كلُّ منادٍ له في الدفعةِ
 * نفسِها. وعملاءُ الطلباتِ الثلاثةُ (`customers` · `dispatch` · `negotiations`)
 * كلُّهم خارجَ الحجزِ البشريِّ، فكانَ هذا الحدُّ هو الممكنَ لا الأسهلَ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً**: الخريطةُ الصادقةُ في
 * [`SERVICE_AUTH_ENFORCEMENT.md`](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)
 * وحارسُها `scripts/checks/validate-service-auth-coverage.sh`، وهما وحدَهما
 * يقولانِ كم حدّاً فُرِضَ وكم عميلاً وُقِّعَ.
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

import type { OrderErrorBody } from "./errors.js";

/** جمهور الرمز الذي يقبله محرّك الطلبات. يطابق `aud` عند المنادي. */
export const ORDERS_SERVICE_AUDIENCE = "orders";

/**
 * تصنيف المسار. `"open"` يعني «لا هوية خدمة مطلوبة» ولا يجوز إلا لمسار لا يقرأ
 * ولا يكتب بيانات مجالية — وهو `/health` وحده على هذا الحد.
 */
export type OrderRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفردات الصلاحيات على حد الطلبات. **ليست مصفوفة أدوار**: الحد يعلن ما يطلبه
 * كل مسار، ومن يمنح أي صلاحية لأي خدمة قرار `M1-05` عند مُصدر الرمز.
 *
 * والتقسيم يتبع من ينادي: القبول (customers)، والسعر المتفق (negotiations)،
 * والانتقالات والإسنادات (dispatch)، والقراءة (بوابات الخروج والقارئون).
 */
export const ORDER_SCOPES = {
  intakeWrite: "orders:intake:write",
  agreedPriceWrite: "orders:agreed-price:write",
  orderRead: "orders:order:read",
  historyRead: "orders:history:read",
  transitionWrite: "orders:transition:write",
  assignmentWrite: "orders:assignment:write",
} as const;

export type OrderRouteConfig = ServiceIdentityRouteConfig;

export interface OrderServiceIdentityOptions {
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
 * والشكل هو `OrderErrorBody` نفسه الذي يعرفه عقد هذا الحد، فلا يخرج منه شكلُ
 * خطأٍ لا يعرفه المنادي.
 */
function denialBody(decision: ServiceIdentityDenial, traceId: string): OrderErrorBody {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يركّب الفرض على التطبيق. يُستدعى مرة واحدة **قبل** تسجيل المسارات كي يرى
 * حاجز التصنيف كل مسار يُسجّل بعده — ومسار بلا تصنيف يُسقط الإقلاع، فلا يمر
 * مسار جديد بلا قرار مكتوب.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: OrderServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? ORDERS_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد الطلبات",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
