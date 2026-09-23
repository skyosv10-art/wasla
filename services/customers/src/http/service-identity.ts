/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ العميلِ** (`M1-04` · الموجةُ التاسعةُ · `CLM-0197`).
 *
 * ── لماذا هذا الحدُّ أوّلُ الخمسةِ ─────────────────────────────────────────
 * الموجةُ الثامنةُ (`CLM-0196` · [`ADR-034`](../../../../docs/15-decisions/ADR-034-ingress-boundary-inventory-closure.md))
 * قاستْ خمسةَ حدودِ دخولٍ إنتاجيّةٍ **لا تفرضُ شيئاً** (53 مساراً) وأغلقتْ
 * جردَها بالبابِ 10. وهذا الحدُّ اختيرَ أوّلاً **بقياسٍ لا بذوقٍ**: القاعدةُ
 * المكتوبةُ في `services/orders/src/http/service-identity.ts` أنَّ حدّاً
 * **لا يُفرَضُ ما لم يُوقَّعْ كلُّ منادٍ لهُ في الدفعةِ نفسِها**، وإلّا كانَ
 * الفرضُ `401` في الإنتاجِ لا حمايةً. وقياسُ مُنادي هذا الحدِّ أعطى **صفرَ
 * منادٍ إنتاجيٍّ عبرَ HTTP**: بوتُ العميلِ يُنادي **حالاتِ الاستعمالِ في
 * العمليّةِ نفسِها** (`bots/customer-bot/src/customer-core.ts` — «Why in-process
 * and not over HTTP»)، ولا مُتغيِّرَ بيئةٍ واحدٌ في
 * `packages/config/env-registry.json` يحملُ عنوانَ هذا الحدِّ. فمُنادُوهُ
 * الفعليّونَ اليومَ هم **بوّاباتُ الخروجِ** وحدَها، وهيَ تُوقِّعُ في الدفعةِ
 * نفسِها — فلا مُنادٍ يُكسَرُ بلا استشارةٍ.
 *
 * ── لماذا كلُّ مسارٍ هنا مربوطٌ بالمُنتَفِعِ ────────────────────────────────
 * كلُّ مسارٍ في هذا العقدِ يبدأُ بـ`/customers/:waslaPublicId/…`، أي أنَّ
 * **المَورِدَ مملوكٌ لإنسانٍ بعينِهِ ومُعنوَنٌ في المسارِ**. والصلاحيّةُ وحدَها
 * لا تقولُ **أيَّ عميلٍ**: حاملُ `customers:profile:read` كانَ — لو فُرِضَتِ
 * الصلاحيّةُ وحدَها — يقرأُ ملفَّ كلِّ عميلٍ بتبديلِ حرفٍ في المسارِ. فلذلكَ
 * كلُّ مسارٍ هنا `beneficiary: "required"` ومعَهُ مقارنةٌ في `app.ts`
 * (`requireBeneficiary`) بينَ `:waslaPublicId` و`obo` المُوَقَّعِ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **لا يجعلُ `M1-04` منجَزاً** ولا يُقفِلُ `RISK-0051`: أربعةُ
 * حدودٍ باقيةٌ (`drivers` · `reputation` · `search` · `subscriptions` = 43
 * مساراً) وهيَ مُعلَنةٌ في
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

import type { CustomerErrorBody } from "./errors.js";

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ العميلِ. يطابقُ `aud` عندَ المنادي. */
export const CUSTOMERS_SERVICE_AUDIENCE = "customers";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/health` وحدَهُ على هذا الحدِّ.
 */
export type CustomerRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ العميلِ. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ
 * ما يطلبُهُ كلُّ مسارٍ، ومَن يُمنَحُ أيَّ صلاحيّةٍ قرارُ `M1-05` عندَ مُصدِرِ
 * الرمزِ (`packages/authz-policy/src/grants.ts`).
 *
 * والتقسيمُ يتبعُ المَورِدَ لا الطريقةَ: الملفُّ · الأماكنُ المحفوظةُ · طلباتُ
 * العميلِ. و**المعاينةُ صلاحيّةٌ ثالثةٌ مستقلّةٌ** لأنَّها لا تكتبُ شيئاً ولا
 * تُنادي محرّكاً: فمن يحتاجُ تسعيرةً تقديريّةً لا يلزمُهُ حقُّ إيداعِ طلبٍ.
 */
export const CUSTOMER_SCOPES = {
  profileRead: "customers:profile:read",
  profileWrite: "customers:profile:write",
  placeRead: "customers:place:read",
  placeWrite: "customers:place:write",
  orderRequestRead: "customers:order-request:read",
  orderRequestWrite: "customers:order-request:write",
  orderRequestPreview: "customers:order-request:preview",
  adminRead: "customers:admin:read",
  adminSuspend: "customers:admin:suspend",
  adminReinstate: "customers:admin:reinstate",
} as const;

export type CustomerRouteConfig = ServiceIdentityRouteConfig;

export interface CustomerServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المُنادي المرفوضُ: كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ —
 * **لا سببَ**. السببُ يُسجَّلُ ولا يُعادُ: «رمزٌ منتهٍ» و«توقيعٌ خاطئٌ» فرقٌ
 * يفيدُ المهاجمَ وحدَهُ. والشكلُ هوَ `CustomerErrorBody` نفسُهُ الذي يعرفُهُ
 * عقدُ هذا الحدِّ، فلا يخرجُ منهُ شكلُ خطأٍ لا يعرفُهُ المُنادي.
 */
function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): CustomerErrorBody {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يُركِّبُ الفرضَ على التطبيقِ. يُستدعى مرّةً واحدةً **قبلَ** تسجيلِ المساراتِ
 * كي يرى حاجزُ التصنيفِ كلَّ مسارٍ يُسجَّلُ بعدَهُ — ومسارٌ بلا تصنيفٍ يُسقِطُ
 * الإقلاعَ، فلا يمرُّ مسارٌ جديدٌ بلا قرارٍ مكتوبٍ.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: CustomerServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? CUSTOMERS_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد العميل",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined
      ? {}
      : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
