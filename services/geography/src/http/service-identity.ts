/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ الجغرافيا** (`M1-04`، الموجةُ الخامسةُ).
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
 * ── لماذا الجغرافيا أخيراً ─────────────────────────────────────────────────
 * هذا آخرُ الحدودِ الخمسةِ: كانَ فرضُهُ قبلَ توقيعِ كلِّ مُنادِيه يعني `401`
 * في الإنتاجِ، وأحدُ عملائِه الثلاثةِ (`http-zone-catalog.ts`) داخلَ
 * `services/drivers/` المحجوزةِ سابقاً لمالكٍ بشريٍّ (`CLM-0004`). وقد أذنَ
 * المالكُ بتحريرِ الحجزِ في 2026-09-07، فاستُؤنفَتِ الموجةُ — **بقرارِهِ لا
 * قبلهُ**.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ الحدودِ الخمسةِ **لا يُنجِزُ `M1-04`**: بوّابةُ `M1-04_GATE.md` لم
 * تُكتَبْ بعدُ، و`AUD-004`/`AUD-005` مفتوحانِ، و`RISK-0027` (مُنادو
 * `packages/bot-runtime`) مفتوحٌ. الخريطةُ الصادقةُ في
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

import type { GeographyErrorBody } from "./errors.js";

/** جمهور الرمز الذي يقبله محرّك الجغرافيا. يطابق `aud` عند المنادي. */
export const GEOGRAPHY_SERVICE_AUDIENCE = "geography";

/**
 * تصنيف المسار. `"open"` يعني «لا هوية خدمة مطلوبة» ولا يجوز إلا لمسار لا يقرأ
 * ولا يكتب بيانات مجالية — وهو `/health` وحده على هذا الحد.
 */
export type GeographyRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفردات الصلاحيات على حد الجغرافيا. **ليست مصفوفة أدوار**: الحد يعلن ما
 * يطلبه كل مسار، ومن يمنح أي صلاحية لأي خدمة قرار `M1-05` عند مُصدر الرمز.
 *
 * والتقسيم يتبع الأفعالَ لا الجداول: قراءة الهرم (القوائم) وقراءة منطقة
 * بعينها (ما يستعمله العملاءُ والمطابقةُ والسائقونَ في `GET /geo/zones/:id`)
 * فعلانِ مختلفانِ لأنّ الثاني يقعُ **داخلَ طلباتِ كتابةٍ** عند المنادي، فلا
 * ينبغي أن يبلغَه رمزٌ طُلِبَ لتصفُّحِ القوائمِ. وقراءةُ الموقعِ وكتابتُهُ
 * فعلانِ مفترقانِ لأنّ الكتابةَ تُنشئُ حدثاً وتُغيِّرُ إجابةَ المطابقةِ.
 */
export const GEO_SCOPES = {
  hierarchyRead: "geography:hierarchy:read",
  zoneRead: "geography:zone:read",
  locationRead: "geography:location:read",
  locationWrite: "geography:location:write",
} as const;

export type GeographyRouteConfig = ServiceIdentityRouteConfig;

export interface GeographyServiceIdentityOptions {
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
 * والشكل هو `GeographyErrorBody` نفسه الذي يعرفه عقد هذا الحد، فلا يخرج منه
 * شكلُ خطأٍ لا يعرفه المنادي.
 */
function denialBody(decision: ServiceIdentityDenial, traceId: string): GeographyErrorBody {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يركّب الفرض على التطبيق. يُستدعى مرة واحدة **قبل** تسجيل المسارات كي يرى
 * حاجز التصنيف كل مسار يُسجّل بعده — ومسار بلا تصنيف يُسقط الإقلاع، فلا يمر
 * مسار جديد بلا قرار مكتوب.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: GeographyServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? GEOGRAPHY_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد الجغرافيا",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
