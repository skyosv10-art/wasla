/**
 * فرضُ هويّةِ الخدمةِ على **حدِّ التوصيلِ** (`M1-04`، الموجةُ السادسةُ ·
 * المراجعةُ 17/N · رفعُ دَينِ [ADR-026 §4](../../../../docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md)
 * المُعلَنِ في §4.18: «لا مُصادقةَ داخلةً على أيِّ مسارٍ»).
 *
 * ── لماذا هذا الملفُّ قصيرٌ ────────────────────────────────────────────────
 * الربطُ بـFastify — حاجزُ التصنيفِ عندَ `onRoute`، والفرضُ **المُغلَقُ افتراضاً**
 * عندَ `onRequest`، و`503` عندَ تعذُّرِ مخزنِ آثارِ الإعادةِ، وقواعدُ التسجيلِ —
 * كلُّه في الوسيطِ المركزيِّ
 * [`@wasla/service-auth/fastify`](../../../../packages/service-auth/src/fastify.ts).
 * والذي يخصُّ هذا الحدَّ وحدَه ثلاثةٌ: **جمهورُه** و**صلاحيّاتُه**
 * و**مغلَّفُ خطئِه**. وهو نمطُ الموجاتِ الخمسِ قبلَه حرفاً
 * (`matching` · `orders` · `identity` · `dispatch` · `geography`) لا اختراعٌ.
 *
 * ── ما الذي يحرسُه هذا الحدُّ ──────────────────────────────────────────────
 * حدُّ التوصيلِ هوَ **دورةُ الطلبِ التجاريِّ كلُّها** في MARKET: يُنشئُ الطلبَ
 * ويحجزُ المخزونَ ويُلغي ويُثبِّتُ حالةَ الدفعِ ويُؤكِّدُ ويُقدِّمُ التنفيذَ.
 * وأخطرُ ما فيه أربعةٌ:
 *
 *   - `PUT …/payment-mirror` — **إعلانُ أنَّ طلباً صارَ مدفوعاً**. مَن نادَاه بلا
 *     هويّةٍ يقدرُ على تحريكِ طلبٍ إلى التنفيذِ بلا دفعٍ. ولذلكَ تُفرَدُ لهُ
 *     صلاحيّةٌ **لا يحملُها أيُّ منادٍ آخرَ**: المرآةُ تنعكسُ من CORE وحدَه.
 *   - `POST /store-orders` — **إنشاءُ طلبٍ يحجزُ مخزوناً حقيقيّاً** في السوقِ
 *     (فرقٌ سالبٌ في دفترِ المخزونِ · §2.3). منادٍ بلا هويّةٍ يُفرِغُ رفَّ متجرٍ.
 *   - `POST …/cancellation` — **قطعُ طلبٍ حيٍّ** وإفراجُ حجزِه.
 *   - `POST …/fulfillment-transition` — **تقديمُ التنفيذِ**، وعندَ التسليمِ
 *     **خصمٌ نهائيٌّ** `reserved ⇒ consumed` لا يُستردُّ.
 *
 * ── ولماذا هذا الحدُّ يُفرَضُ الآنَ ────────────────────────────────────────
 * القاعدةُ الحاكمةُ في [السجلِّ](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md) §2.0:
 * **«لا يُفرَضُ حدٌّ ما لم يُوقَّعْ كلُّ منادٍ لهُ في الدفعةِ نفسِها»** — وحدٌّ
 * يُفرَضُ قبلَ ذلكَ يعني `401` في الإنتاجِ لا أمناً. وقد **قِيسَ** هذا الشرطُ لا
 * وُصِفَ: `rg` على المستودعِ كلِّه خارجَ `services/delivery/` لا يُظهِرُ **أيَّ
 * منادٍ عبرَ HTTP** لأيٍّ من مساراتِهِ (كانت أحدَ عشرَ يومَ الموجةِ السادسةِ،
 * وصارت **ثلاثةَ عشرَ** بعدَ 18/N و21/N، والقياسُ أُعيدَ في 22/N فبقيَ الحكمُ
 * نفسَهُ) — لا `http-*.ts` في خدمةٍ ولا في
 * `packages/` ولا في `bots/`. المُنادي الوحيدُ **بوّابةُ خروجِ الطورِ 13**
 * (`@wasla/delivery-e2e`)، وهيَ في هذهِ الدفعةِ نفسِها **تُوقِّعُ نداءاتِها**.
 *
 * وهذا يجعلُ حدَّ التوصيلِ **الحدَّ الأوّلَ الذي يُفرَضُ قبلَ أن يوجدَ لهُ منادٍ
 * إنتاجيٌّ**، وهوَ أرخصُ وقتٍ ممكنٍ: أوّلُ منادٍ سيُولَدُ موقَّعاً بالضرورةِ لا
 * بالتذكُّرِ. والعكسُ — تأجيلُ الفرضِ حتّى يوجدَ المنادي — هوَ بالضبطِ ما جعلَ
 * حدَّ `geography` آخرَ الموجاتِ وأصعبَها (§2.6).
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 *   - **لا تفويضَ هنا**: هذا الملفُّ يُعلِنُ ما **يطلبُهُ** كلُّ مسارٍ، ومَن
 *     يستحقُّ صلاحيّةً قرارُ `M1-05` عندَ مُصدِرِ الرمزِ.
 *   - **`api.openapi.yml` لم يُمَسَّ**، فالعقدُ المنشورُ لا يُعلِنُ 401/403 —
 *     وهيَ سابقةُ الموجاتِ الخمسِ كلِّها (لا `securitySchemes` في عقدِ
 *     `dispatch` ولا `orders`). وهوَ **نقصٌ حقيقيٌّ مُعلَنٌ** في السجلِّ §2.7 لا
 *     مسكوتٌ عنهُ، وعلاجُهُ عقدٌ لكلِّ الحدودِ معاً لا لحدٍّ واحدٍ.
 *   - **`services/marketplace` غيرُ مفروضٍ** بعدُ (خارجَ سطورِ `enforced:`)،
 *     فتوقيعُ التوصيلِ الصادرُ إليهِ **يُقبَلُ لأنَّهُ لا يُفحَصُ**. هذهِ الدفعةُ
 *     لا تُصلِحُ ذلكَ ولا تدَّعي إصلاحَهُ.
 *   - أساسُ الثقةِ **سرٌّ مشتركٌ HMAC لا mTLS** ([ADR-020](../../../../docs/15-decisions/ADR-020-service-to-service-identity.md) §6)،
 *     و`RISK-0026` (مُعامِلاتُ الاستعلامِ غيرُ مربوطةٍ بالرمزِ) مفتوحٌ — ويمسُّ
 *     هذا الحدَّ فعلاً في `GET /delivery/inventory-conflicts` (`limit` ·
 *     `unacknowledged_only`)، فالرمزُ يربطُ المسارَ والطريقةَ لا الاستعلامَ.
 *   - `RISK-0015` باقٍ: مخزنُ آثارِ الإعادةِ في الذاكرةِ لا يمنعُ إعادةً على
 *     نسخةٍ ثانيةٍ.
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

import type { DeliveryErrorBody } from "./errors.js";

/** جمهورُ الرمزِ الذي يقبلُهُ حدُّ التوصيلِ. يطابقُ `aud` عندَ المنادي. */
export const DELIVERY_SERVICE_AUDIENCE = "delivery";

/**
 * تصنيفُ المسارِ. `"open"` يعني «لا هويّةَ خدمةٍ مطلوبةٌ»، ولا يجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهُما مسارَا الرصدِ وحدَهما على هذا الحدِّ.
 */
export type DeliveryRouteIdentity = ServiceIdentityRouteIdentity;

export type DeliveryRouteConfig = ServiceIdentityRouteConfig;

/**
 * مفرداتُ الصلاحيّاتِ على حدِّ التوصيلِ — **صلاحيّةٌ واحدةٌ لكلِّ مسارٍ مُغلَقٍ**
 * (ولا يُكتَبُ العددُ هنا رقماً: بقيَ «تسعةٌ لتسعةِ مساراتٍ» مكتوباً بعدَ إضافةِ
 * العاشرةِ والحاديةَ عشرةَ، فصارَ التعليقُ يكذبُ على قارئِهِ. والعددُ المقيسُ
 * يُقرأُ من `DELIVERY_SCOPES` نفسِها، ويُطابِقُهُ بوثيقتَي الحدِّ حرسٌ في
 * `__tests__/service-auth-docs-drift.test.ts` · المراجعةُ 22/N).
 *
 * والتقسيمُ **بخطرِ المسارِ لا باسمِ الخدمةِ**: صلاحيّةٌ واحدةٌ لـ«التوصيلِ»
 * كانت ستُعطي مَن يحتاجُ قراءةَ طلبٍ القدرةَ على إعلانِهِ مدفوعاً وإلغائِهِ
 * وتقديمِ تنفيذِهِ. فأُفرِدَت:
 *
 *   - **مرآةُ الدفعِ** وحدَها — أخطرُ فعلٍ على هذا الحدِّ (انظرَ ترويسةَ الملفِّ).
 *   - **الإلغاءُ** وحدَهُ — قاطعُ طلبٍ حيٍّ، ومُفرِجُ حجزٍ.
 *   - **التأكيدُ** وحدَهُ — بوّابةُ الخروجِ من `pending` إلى التنفيذِ.
 *   - **انتقالُ التنفيذِ** وحدَهُ — وعندَ التسليمِ خصمٌ نهائيٌّ لا يُستردُّ.
 *   - **الإنشاءُ** و**القراءةُ** منفصلانِ، ومَن يقرأُ طلباً لا يُنشِئُ.
 *   - **قراءةُ مهمّةِ التوصيلِ** منفصلةٌ عن قراءةِ الطلبِ: هذا هوَ الوجهُ الذي
 *     يراهُ MOVE عبرَ CORE، ولا يلزمُ مَن يقرأُهُ أن يرى الطلبَ التجاريَّ كلَّهُ.
 *   - **مسارَا التشغيلِ** بصلاحيّتَي `ops:` مستقلّتَينِ **لأنَّهما خارجَ العقدِ
 *     المنشورِ**: مَن يملكُ دورةَ الطلبِ ليسَ بالضرورةِ مَن يملكُ مِكنسةً تحذفُ
 *     صفوفاً أو قائمةَ رايَاتِ تضاربٍ فيها مُعرِّفاتُ طلباتٍ.
 */
export const DELIVERY_SCOPES = {
  storeOrderWrite: "delivery:store-order:write",
  storeOrderRead: "delivery:store-order:read",
  storeOrderCancel: "delivery:store-order:cancel",
  storeOrderConfirm: "delivery:store-order:confirm",
  paymentMirrorWrite: "delivery:payment-mirror:write",
  fulfillmentTransition: "delivery:fulfillment:transition",
  deliveryTaskRead: "delivery:delivery-task:read",
  idempotencySweep: "delivery:ops:idempotency-sweep",
  inventoryConflictsRead: "delivery:ops:inventory-conflicts:read",
  /**
   * الصلاحيّةُ العاشرةُ (المراجعةُ 18/N · §4.20) — **مفصولةٌ عن `:read` بقصدٍ**.
   *
   * لوحةُ مُشغِّلٍ تسردُ الرياتِ تحتاجُ القراءةَ وحدَها؛ ومَن يقرأُ لا يجوزُ أن
   * يستطيعَ **إغلاقَ** حادثةٍ باسمِهِ بالبناءِ. والإقرارُ ليسَ قراءةً أعلى: هوَ
   * كتابةُ مسؤوليّةٍ في دفترٍ يُقرأُ في تحقيقٍ — ودمجُهُ في `:read` كانَ سيجعلَ
   * كلَّ رمزِ لوحةٍ مسروقٍ قادراً على تصفيرِ قائمةِ ما لم يُنظَرْ فيهِ.
   */
  inventoryConflictAcknowledge: "delivery:ops:inventory-conflicts:acknowledge",
  /**
   * الصلاحيّةُ الحاديةَ عشرةَ (المراجعةُ 21/N · ADR-026 §4.23) — **صلاحيّةٌ
   * رابعةٌ في عائلةِ `ops:` لا توسيعٌ لواحدةٍ قائمةٍ**.
   *
   * ولمَ لا تُضَمُّ إلى `inventoryConflictsRead`؟ لأنَّ نطاقَ المقروءِ مختلفٌ لا
   * مُشابِهٌ: تلكَ تقرأُ راياتَ **مخزونِ السوقِ** وحدَها، وهذهِ تقرأُ دفترَ
   * `dispatch` معَهُ — فمَن يملكُ لوحةَ تضارُبِ مخزونٍ يصيرُ بالضمِّ قادراً على
   * سردِ أنواعِ أحداثِ التوزيعِ الفاسدةِ، وهيَ معلومةُ حدٍّ آخرَ. والفصلُ هوَ
   * نفسُ تعليلِ §4.20 حينَ فُصِلَ الإقرارُ عن القراءةِ.
   */
  relayDeadLettersRead: "delivery:ops:relay-dead-letters:read",
  /**
   * الصلاحيّةُ الثانيةَ عشرةَ (المراجعةُ 22/N · `M5-13R` · ADR-026 §4.24) —
   * **مفصولةٌ عن `relayDeadLettersRead` بنفسِ تعليلِ §4.20 حرفاً**.
   *
   * القراءةُ تسردُ الفقدَ؛ وهذهِ **تُحرِّكُ طابوراً**: تُعيدُ صفّاً إلى مسارِ
   * الاستهلاكِ وتُرجِعُ نقطةَ تقدُّمِ مُرحِّلٍ إلى الصفرِ. ودمجُها في `:read`
   * كانَ سيجعلَ كلَّ رمزِ لوحةِ رصدٍ مسروقٍ قادراً على إرجاعِ مُرحِّلَي التوصيلِ
   * إلى أوّلِ الصندوقِ الصادرِ مِراراً — إغراقُ قراءةٍ بصلاحيّةِ **نظرٍ**.
   */
  relayDeadLettersRequeue: "delivery:ops:relay-dead-letters:requeue",
} as const;

export interface DeliveryServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

/**
 * الردُّ الذي يراهُ المنادي المرفوضُ: رمزٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ —
 * **بلا سببٍ في النصِّ**. تفصيلُ السببِ يُسجَّلُ ولا يُعادُ: «توقيعٌ خاطئٌ» و«kid
 * مسحوبٌ» و«رمزٌ معادٌ» كلُّها `AUTHN_UNAUTHENTICATED` واحدٌ، فالتمييزُ بينَها
 * خريطةٌ للمهاجمِ.
 *
 * **ويُستثنى بابانِ، وهذا مقيسٌ لا مُدَّعى** (انظرْ الدعوى في
 * `__tests__/service-identity.test.ts`): الوسيطُ المشتركُ يُعيدُ
 * `AUTHN_EXPIRED` عندَ انتهاءِ المدّةِ و`AUTHN_AUDIENCE_MISMATCH` عندَ اختلافِ
 * الجمهورِ — بقصدٍ مكتوبٍ في
 * [`service-auth/errors.ts`](../../../../packages/service-auth/src/errors.ts):
 * كلاهما لا يُنطَقُ بهِ إلّا **بعدَ** إثباتِ التوقيعِ، فلا يفيدُ مَن لا يملكُ
 * مفتاحاً، وإخفاؤهما يُكلِّفُ المُشغِّلَ الشريفَ ساعاتِ تشخيصٍ. وحدُّ التوصيلِ
 * **يورِثُ** هذا السلوكَ ولا يُخصِّصُهُ، فأكوادُ الرفضِ عندَهُ **ثلاثةٌ**.
 *
 * والشكلُ هوَ شكلُ خطأِ هذا الحدِّ نفسِهِ — **`error_code` لا `code`** — كما
 * يبنيهِ `sendDeliveryError`. والفرقُ عن حدِّ التوزيعِ مقصودٌ لا سهوٌ: اسمُ
 * الحقلِ جزءٌ من عقدِ التوصيلِ المنشورِ (`ErrorResponse.required: [error_code,
 * message, trace_id]`)، ومنادٍ يقرأُ `error_code` في كلِّ خطأٍ ثمَّ يجدُ `code`
 * في الرفضِ **لن يقرأَ رفضَهُ**. ولا `details` هنا لأنَّ التوصيلَ لا ينشرُهُ
 * أصلاً (`http/errors.ts`).
 *
 * ورمزَا الرفضِ (`AUTHN_UNAUTHENTICATED` · `AUTHZ_FORBIDDEN`) **بلا سابقةِ
 * `DELIVERY_`** عن قصدٍ: هُما مفرداتُ حدودِ المنظومةِ كلِّها في
 * [ADR-020](../../../../docs/15-decisions/ADR-020-service-to-service-identity.md)،
 * ورفضُ توثيقٍ يجبُ أن يُقرأَ واحداً عندَ كلِّ حدٍّ لا أن يُترجَمَ لكلِّ خدمةٍ.
 */
function denialBody(decision: ServiceIdentityDenial, traceId: string): DeliveryErrorBody {
  return { error_code: decision.code, message: decision.message, trace_id: traceId };
}

/**
 * يُركِّبُ الفرضَ على التطبيقِ. يُستدعى مرّةً واحدةً **قبلَ** تسجيلِ المساراتِ كي
 * يرى حاجزُ التصنيفِ كلَّ مسارٍ يُسجَّلُ بعدَهُ — ومسارٌ بلا تصنيفٍ **يُسقِطُ
 * الإقلاعَ**، فلا يمرُّ مسارٌ جديدٌ بلا قرارٍ مكتوبٍ.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: DeliveryServiceIdentityOptions,
): void {
  registerServiceIdentityOnFastify(app, {
    audience: options.audience ?? DELIVERY_SERVICE_AUDIENCE,
    keys: options.keys,
    replayGuard: options.replayGuard,
    denialBody,
    boundaryLabel: "حد التوصيل",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
    ...(options.maxTtlSeconds === undefined ? {} : { maxTtlSeconds: options.maxTtlSeconds }),
  });
}
