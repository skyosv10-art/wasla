/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ السوقِ** (`M1-04` · المراجعةُ 29/N).
 *
 * ── لماذا هذا الحدُّ أخيراً، وما معنى «أخيراً» ─────────────────────────────
 * الموجاتُ الستُّ فرضت: المطابقةَ والطلباتِ والهويّةَ والتوزيعَ والتوصيلَ
 * والجغرافيا. ثمَّ فُرِضَ حدُّ المفاوضاتِ (المراجعةُ 26/N). **وحدُّ السوقِ هوَ
 * الثامنُ والأخيرُ** من حدودِ HTTP في المستودعِ. وقبلَ هذا الملفِّ كانَ **أسوأَ
 * الحدودِ حالاً**: ثلاثةُ عملاءَ موقَّعينَ يُنادونَهُ من خدمةِ التسليمِ
 * (`http-marketplace-catalog.ts` · `http-marketplace-probe.ts` ·
 * `http-marketplace-reservation.ts`)، وكلُّهم يُعلِنُ صلاحيّاتٍ بأسمائها
 * (`marketplace:store:read` · `marketplace:product:read` ·
 * `marketplace:inventory:reserve` · `marketplace:inventory:release`)، **ولا
 * أحدَ في الطرفِ الآخرِ يقرأُها**. فكانَ التوقيعُ طمأنينةً بلا فائدةٍ: نداءٌ
 * بلا ترويسةٍ أصلاً كانَ يمرُّ كما يمرُّ الموقَّعُ.
 *
 * **ولهذا لم تُخترَعْ هنا مفرداتٌ جديدةٌ للصلاحيّاتِ الأربعِ المذكورةِ**:
 * أسماؤها مكتوبةٌ في شفرةِ مُنادِيها وفي [`ADR-026 §6`](../../../../docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md)
 * منذُ قبلِ هذا الفرضِ، **فالحدُّ يقرأُ ما أُعلِنَ لا ما يستحسنُهُ**. واختراعُ
 * اسمٍ أنظفَ هنا كانَ سيجعلُ كلَّ نداءٍ موقَّعٍ قائمٍ يُرَدُّ `403` — وهوَ
 * انكسارٌ يُنسَبُ إلى «الفرضِ» فيُطالَبُ بتعطيلِهِ.
 *
 * ── لماذا هو قصيرٌ ─────────────────────────────────────────────────────────
 * الربطُ بـFastify — حاجزُ التصنيفِ عندَ `onRoute`، والفرضُ المُغلَقُ افتراضاً
 * عندَ `onRequest`، و`503` عندَ تعذُّرِ مخزنِ آثارِ الإعادةِ — كلُّهُ في الوسيطِ
 * المركزيِّ [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts).
 * والذي يخصُّ هذا الحدَّ ثلاثةٌ: **جمهورُه** و**صلاحيّاتُه** و**مغلَّفُ خطئِه**.
 *
 * ── ولمَ هذا التقسيمُ للصلاحيّاتِ ──────────────────────────────────────────
 * التقسيمُ يتبعُ **الأفعالَ لا الجداولَ**، وأهمُّ ثلاثةِ فروقٍ فيهِ:
 *
 * 1. **طلبُ المراجعةِ ليسَ البتَّ فيها.** `store:review:request` يقولُ «انظُرْ
 *    في متجري»، و`store:review:decide` **يُغيِّرُ حالةَ متجرٍ فيُظهِرُهُ للناسِ
 *    أو يُخفيهِ**. فرمزٌ طُلِبَ لتقديمِ طلبٍ لا ينبغي أن يبلغَ الموافقةَ على
 *    نفسِهِ. وهذا الفرقُ بعينِهِ هوَ ما يفصلُ المتجرَ عنِ الإدارةِ.
 * 2. **نشرُ المنتجِ وأرشفتُهُ ليسا كتابةً فيهِ.** `product:write` يُنشئُ
 *    مسوَّدةً، و`product:lifecycle` **يُبدِّلُ الظهورَ**: منشورٌ يُرى ويُشترى،
 *    ومؤرشفٌ يختفي من كلِّ كتالوجٍ. وخدمةُ التسليمِ تقرأُ الكتالوجَ، فمن يملكُ
 *    النشرَ يملكُ ما تراهُ خدمةٌ أخرى.
 * 3. **الحجزُ والإفراجُ صلاحيّتانِ لا واحدةٌ.** هذا **ليسَ تفصيلاً**: الحجزُ
 *    يأخذُ مخزوناً، والإفراجُ يردُّهُ — وهوَ **تعويضٌ** في مسارِ فشلٍ
 *    (`ADR-026 §2.3`). فمن يملكُ الإفراجَ وحدَهُ لا يستطيعُ أن يستنزفَ مخزوناً،
 *    ومن يملكُ الحجزَ وحدَهُ لا يستطيعُ أن يُفرِجَ عن حجزِ غيرِهِ. وجمعُهُما في
 *    صلاحيّةٍ واحدةٍ كانَ سيُلغي هذا الفصلَ بلا قرارٍ مكتوبٍ.
 *
 * و**من يمنحُ أيَّ صلاحيّةٍ لأيِّ خدمةٍ قرارُ `M1-05`** عندَ مُصدِرِ الرمزِ، لا
 * قرارُ هذا الملفِّ: الحدُّ يُعلِنُ ما يطلبُهُ كلُّ مسارٍ ولا يشتقُّ صلاحيّةً من
 * دورٍ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * فرضُ هذا الحدِّ **يُكمِلُ حدودَ HTTP الثمانيةَ** ولا يُنجِزُ `M1-04` بنفسِهِ:
 * البوّابةُ لها وثيقتُها ([`M1-04_GATE.md`](../../../../docs/12-testing/M1-04_GATE.md))
 * وترقيتُها سلطةُ مالكِ البرنامجِ. ويبقى **`RISK-0026`** قائماً (الربطُ لا يشملُ
 * سلسلةَ الاستعلامِ · `ADR-021 §4`) و**`RISK-0015`** قائماً (مخزنُ آثارِ
 * الإعادةِ في الذاكرةِ). والخريطةُ الصادقةُ في
 * [`SERVICE_AUTH_ENFORCEMENT.md`](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)
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


/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ السوقِ. يطابقُ `aud` عندَ المُنادي. */
export const MARKETPLACE_SERVICE_AUDIENCE = "marketplace";

/**
 * تصنيفُ المسارِ. `"open"` يعني «لا هويّةَ خدمةٍ مطلوبةٌ» ولا يجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهوَ `/health` وحدَهُ على هذا الحدِّ.
 */
export type MarketplaceRouteIdentity = ServiceIdentityRouteIdentity;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ السوقِ. **ليست مصفوفةَ أدوارٍ**: الحدُّ يُعلِنُ ما
 * يطلبُهُ كلُّ مسارٍ، والمنحُ قرارُ `M1-05` عندَ مُصدِرِ الرمزِ.
 *
 * والأربعةُ المُعلَّمةُ أدناهُ بـ«مُعلَنةٌ سابقاً» **أسماؤها ملتزَمٌ بها**: هيَ
 * مكتوبةٌ في شفرةِ مُنادِيها في `services/delivery` وفي `ADR-026`، فتغييرُها
 * ليسَ تنظيفاً بل كسرُ عقدٍ قائمٍ.
 */
export const MARKETPLACE_SCOPES = {
  categoryRead: "marketplace:category:read",
  /** مُعلَنةٌ سابقاً — `DELIVERY_MARKETPLACE_SCOPES`. */
  storeRead: "marketplace:store:read",
  storeWrite: "marketplace:store:write",
  storeReviewRequest: "marketplace:store:review:request",
  storeReviewDecide: "marketplace:store:review:decide",
  storeReviewRead: "marketplace:store:review:read",
  staffRead: "marketplace:staff:read",
  staffWrite: "marketplace:staff:write",
  /** مُعلَنةٌ سابقاً — `DELIVERY_MARKETPLACE_SCOPES`. */
  productRead: "marketplace:product:read",
  productWrite: "marketplace:product:write",
  productLifecycle: "marketplace:product:lifecycle",
  productReviewDecide: "marketplace:product:review:decide",
  inventoryRead: "marketplace:inventory:read",
  inventoryAdjust: "marketplace:inventory:adjust",
  /** مُعلَنةٌ سابقاً — `DELIVERY_RESERVATION_SCOPES`. */
  inventoryReserve: "marketplace:inventory:reserve",
  /** مُعلَنةٌ سابقاً — `DELIVERY_RESERVATION_SCOPES`. */
  inventoryRelease: "marketplace:inventory:release",
} as const;

export type MarketplaceRouteConfig = ServiceIdentityRouteConfig;

export interface MarketplaceServiceIdentityOptions {
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
 * يفيدُ المهاجمَ وحدَهُ.
 *
 * والشكلُ **شكلُ `ErrorResponse` نفسُهُ** الذي يعرفُهُ عقدُ هذا الحدِّ: مُعشَّشٌ
 * (`error.code` · `error.message` · `trace_id`) بلا `details` — فلا يخرجُ من
 * الحدِّ هيكلُ خطأٍ لا يعرفُهُ مُنادٍ يُحلِّلُ `error.code`. و`details`
 * **متروكةٌ** عن قصدٍ: مفاتيحُها في العقدِ وصفُ خطأٍ مجاليٍّ، ورفضُ هويّةٍ ليسَ
 * خطأً مجاليّاً.
 *
 * ولمَ **نوعٌ خاصٌّ** لا `ErrorResponse` حرفاً: `error.code` في العقدِ **قائمةٌ
 * مغلقةٌ** من رموزِ أخطاءِ السوقِ (`STORE_NOT_FOUND` وأشباهُها)، ورموزُ رفضِ
 * الهويّةِ ليست منها ولا ينبغي أن تُحشَرَ فيها: حشرُها يُوسِّعُ عقدَ المجالِ
 * برمزٍ ليسَ مجاليّاً، و`as ErrorResponse` كانَ سيُسكِتَ المُدقِّقَ عن هذا
 * التوسيعِ بلا أن يُصلِحَهُ — **إسكاتُ حاجزٍ لا إصلاحُ حدٍّ**. فالشكلُ مُطابَقٌ
 * والرمزُ مُعلَنٌ حرّاً، ومطابقةُ الشكلِ مُثبَتةٌ في الاختبارِ لا في تعليقٍ.
 */
export interface MarketplaceServiceDenialBody {
  readonly error: { readonly code: string; readonly message: string };
  readonly trace_id: string;
}

function denialBody(
  decision: ServiceIdentityDenial,
  traceId: string,
): MarketplaceServiceDenialBody {
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
  options: MarketplaceServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? MARKETPLACE_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد السوق",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined ? {} : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
