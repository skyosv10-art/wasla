/**
 * مصفوفةُ المنحِ: **مَن يحقُّ لهُ أن يحملَ أيَّ صلاحيّةٍ على أيِّ حدٍّ** (`M1-05`).
 *
 * ── العيبُ الذي أنشأَ هذا الملفَّ — مقيسٌ لا مُستنتَجٌ ─────────────────────
 * `packages/service-auth/src/token.ts` يُصدِرُ رمزاً يحملُ `scp` **كما وردَ**:
 * لا يُشتَقُّ تفويضٌ ولا يُراجَعُ طلبٌ. و`enforce.ts` عندَ الحدِّ يسألُ سؤالاً
 * واحداً: «أفي الرمزِ الصلاحيّاتُ التي يطلبُها هذا المسارُ؟» — ولا يسألُ أبداً
 * «**أيحقُّ لحاملِ الرمزِ أن يحملَها؟**». فأيُّ مُنادٍ يملكُ مفتاحَ التوقيعِ
 * المشترَكَ كانَ يستطيعُ أن يُصدِرَ لنفسِهِ رمزاً بأيِّ جمهورٍ وأيِّ صلاحيّةٍ.
 *
 * **والقياسُ يُثبِتُ أنَّ هذا ليسَ احتمالاً نظريّاً:** بوّاباتُ الخروجِ في
 * `packages/*-e2e/` تُصدِرُ رموزاً بـ`Object.values(X_SCOPES)` — أي **كاملَ**
 * مجموعةِ صلاحيّاتِ الحدِّ — ولا شيءَ في المستودعِ يُفرِّقُ ذلكَ عن خدمةِ
 * إنتاجٍ تفعلُ الأمرَ نفسَه. فغيابُ المصفوفةِ جعلَ **أوسعَ منحٍ ممكنٍ** هوَ
 * النمطَ العاديَّ لا الاستثناءَ المُعلَن.
 *
 * ── ولِمَ المصفوفةُ عندَ مُصدِرِ الرمزِ لا عندَ الحدِّ ───────────────────────
 * قرارٌ مكتوبٌ في الشفرةِ قبلَ هذهِ الدفعةِ بثلاثةِ مواضعَ (`enforce.ts` ·
 * `index.ts` · `services/orders/src/http/service-identity.ts`): الحدُّ لا يعرفُ
 * مُنادِيهِ إلّا **بعدَ** قبولِ التوقيعِ، فلو سُئلَ «أيحقُّ لكَ؟» هناكَ لَوجبَ
 * أن تحملَ كلُّ الحدودِ الثمانيةِ نسخةً من المصفوفةِ — ثمانيةُ مصادرِ حقيقةٍ
 * تتباعدُ، وأوّلُ نسخةٍ تتأخّرُ تصيرُ باباً. وموضعُ الإصدارِ **واحدٌ**
 * (`createServiceRequestSigner` في جذرِ التركيبِ)، فالمصفوفةُ فيهِ مصدرٌ واحدٌ.
 *
 * ── حدُّ الإنفاذِ في هذهِ الدفعةِ — مُعلَنٌ لا مُخفىً ──────────────────────
 * الإنفاذُ هنا **ساكنٌ في البوّابةِ** (`scripts/checks/validate-authz-policy.sh`
 * · الفحصُ 16): كلُّ ثلاثيّةِ (دورٌ · جمهورٌ · ثابتُ صلاحيّاتٍ) في جذرِ تركيبٍ
 * **إنتاجيٍّ** تُقابَلُ بهذهِ المصفوفةِ، ويُسقِطُ الفحصُ الدفعةَ عندَ أوّلِ
 * منحٍ غيرِ مُعلَنٍ أو إعلانٍ بلا منحٍ في الشفرةِ. **ولا إنفاذَ في زمنِ التشغيلِ
 * بعدُ**: ذاكَ يقتضي أن يرفضَ `createServiceRequestSigner` التركيبَ نفسَه، وهوَ
 * يمسُّ أسطولَ بوّاباتِ الخروجِ كلَّهُ (تسعُ حزمِ `*-e2e` تُوقِّعُ بأدوارٍ
 * أوسعَ من منحِها بقصدٍ) — فهوَ عنصرُ عملٍ مستقلٌّ (`M1-05B`) لا أثرٌ جانبيٌّ
 * لهذهِ الدفعةِ. **فالأخضرُ هنا يعني «لا انحرافَ في الإعدادِ»، ولا يعني
 * «يستحيلُ إصدارُ رمزٍ زائدِ الصلاحيّاتِ».**
 *
 * المرجع: ADR-027 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md
 */

import type { Audience } from "./operations.js";

/** الدورُ: اسمُ الخدمةِ المُنادِيةِ كما يظهرُ في `sub` من الرمزِ المُصدَر. */
export type Role = string;

export interface Grant {
  /** الجمهورُ المسموحُ بمُنادَاتِه. */
  readonly audience: Audience;
  /** الصلاحيّاتُ التي يحقُّ لهذا الدورِ أن يحملَها على هذا الجمهورِ — **سقفٌ** لا أمرٌ. */
  readonly scopes: readonly string[];
  /** لِمَ يحتاجُها — جملةٌ واحدةٌ تُقرأُ في مراجعةٍ بلا فتحِ الشفرة. */
  readonly reason: string;
  /** ثابتُ الصلاحيّاتِ في الشفرةِ الذي يُقابِلُ هذا المنحَ — يُقاسُ بهِ الانحرافُ. */
  readonly evidence: readonly string[];
}

/**
 * منحُ الإنتاجِ — مقيسةٌ من جذورِ التركيبِ في 2026-09-15.
 * كلُّ سطرٍ هنا يُقابِلُ `createServiceRequestSigner({ serviceName, audience, scopes })`
 * واحداً أو أكثرَ في ملفٍّ **غيرِ اختباريٍّ**؛ والسقفُ اتّحادُ ما تطلبُهُ تلكَ المواضعُ.
 */
export const PRODUCTION_GRANTS: Readonly<Record<Role, readonly Grant[]>> = {
  customers: [
    {
      audience: "identity",
      scopes: ["identity:user:read"],
      reason: "قراءةُ هويّةِ العميلِ عندَ ربطِ طلبٍ بصاحبِه.",
      evidence: ["CUSTOMERS_IDENTITY_SCOPES"],
    },
    {
      audience: "orders",
      scopes: ["orders:intake:write"],
      reason: "إيداعُ طلبٍ جديدٍ نيابةً عن العميلِ — إيداعٌ فقط، لا قراءةَ ولا انتقالَ.",
      evidence: ["CUSTOMERS_ORDERS_SCOPES"],
    },
    {
      audience: "geography",
      scopes: ["geography:zone:read"],
      reason: "قراءةُ نطاقٍ جغرافيٍّ للتحقُّقِ من عنوانِ التسليم.",
      evidence: ["CUSTOMERS_GEOGRAPHY_SCOPES"],
    },
  ],
  delivery: [
    {
      audience: "marketplace",
      scopes: [
        "marketplace:store:read",
        "marketplace:product:read",
        "marketplace:inventory:reserve",
        "marketplace:inventory:release",
      ],
      reason:
        "قراءةُ الفهرسِ لبناءِ طلبِ متجرٍ، وحجزُ المخزونِ وإطلاقُه — والاتّحادُ هنا لثلاثةِ مُوقِّعينَ مُنفصلينَ في جذرِ التركيبِ (فهرسٌ · مِجَسٌّ · حجزٌ).",
      evidence: [
        "DELIVERY_MARKETPLACE_SCOPES",
        "DELIVERY_MARKETPLACE_PROBE_SCOPES",
        "DELIVERY_MARKETPLACE_RESERVATION_SCOPES",
      ],
    },
  ],
  dispatch: [
    {
      audience: "matching",
      scopes: ["matching:candidates:evaluate", "matching:candidacy:write"],
      reason: "تقييمُ المُرشَّحينَ وكتابةُ نتيجةِ الترشيحِ عندَ توزيعِ مهمّةٍ.",
      evidence: ["DISPATCH_MATCHING_SCOPES"],
    },
    {
      audience: "orders",
      scopes: ["orders:assignment:write", "orders:transition:write"],
      reason: "إسنادُ الطلبِ لسائقٍ ونقلُ حالتِه — ولا قراءةَ لطلبٍ ولا لتاريخِه.",
      evidence: ["DISPATCH_ORDERS_SCOPES"],
    },
  ],
  drivers: [
    {
      audience: "matching",
      scopes: ["matching:candidacy:read", "matching:candidacy:write"],
      reason: "قراءةُ ترشيحِ السائقِ وتحديثُ جهوزيّتِه.",
      evidence: ["DRIVERS_MATCHING_SCOPES"],
    },
    {
      audience: "geography",
      scopes: ["geography:zone:read"],
      reason: "قراءةُ فهرسِ النطاقاتِ لعرضِ ما يخدمُهُ السائقُ.",
      evidence: ["DRIVERS_GEOGRAPHY_SCOPES"],
    },
  ],
  geography: [
    {
      audience: "identity",
      scopes: ["identity:user:read"],
      reason: "التحقُّقُ من وجودِ مستخدمٍ قبلَ تسجيلِ موقعِه.",
      evidence: ["GEOGRAPHY_IDENTITY_SCOPES"],
    },
  ],
  matching: [
    {
      audience: "geography",
      scopes: ["geography:zone:read"],
      reason: "قراءةُ النطاقِ لتقييمِ قُربِ المُرشَّح.",
      evidence: ["MATCHING_GEOGRAPHY_SCOPES"],
    },
  ],
  negotiations: [
    {
      audience: "orders",
      scopes: ["orders:order:read", "orders:agreed-price:write"],
      reason:
        "قراءةُ الطلبِ المُتفاوَضِ عليهِ وكتابةُ السعرِ المُتَّفَقِ — واتّحادُ مُوقِّعَينِ في جذرِ التركيبِ (بحثٌ · سعرٌ).",
      evidence: ["NEGOTIATIONS_ORDER_LOOKUP_SCOPES", "NEGOTIATIONS_ORDERS_SCOPES"],
    },
    {
      audience: "dispatch",
      scopes: ["dispatch:offer:read"],
      reason: "قراءةُ العرضِ المرتبطِ بالمفاوضةِ — قراءةٌ فقط، ولا قبولَ ولا رفضَ.",
      evidence: ["NEGOTIATIONS_DISPATCH_OFFER_SCOPES"],
    },
  ],
  "customer-bot": [
    {
      audience: "identity",
      scopes: ["identity:resolve:write", "identity:user:read"],
      reason:
        "إنشاءُ هويّةِ قناةٍ عندَ أوّلِ رسالةٍ ثمَّ قراءتُها — واتّحادُ مُوقِّعَينِ (تمهيدُ الهويّةِ في `bot-runtime` · بحثُ العميلِ في نواةِ البوت).",
      evidence: ["CHANNEL_IDENTITY_SCOPES", "CUSTOMERS_IDENTITY_SCOPES"],
    },
    {
      audience: "geography",
      scopes: ["geography:zone:read"],
      reason: "التحقُّقُ من نطاقِ العنوانِ الذي يكتبُهُ العميلُ في المحادثةِ.",
      evidence: ["CUSTOMERS_GEOGRAPHY_SCOPES"],
    },
    {
      audience: "negotiations",
      scopes: ["negotiations:thread:read", "negotiations:round:read", "negotiations:round:decide"],
      reason:
        "عرضُ المفاوضةِ على العميلِ وقبولُ جولةٍ أو رفضُها — ولا فتحَ خيطٍ ولا كتابةَ جولةٍ ولا تشغيلَ نبضةٍ.",
      evidence: ["CUSTOMER_BOT_NEGOTIATIONS_SCOPES"],
    },
  ],
  "driver-bot": [
    {
      audience: "identity",
      scopes: ["identity:resolve:write"],
      reason: "إنشاءُ هويّةِ قناةٍ للسائقِ عندَ أوّلِ رسالةٍ.",
      evidence: ["CHANNEL_IDENTITY_SCOPES"],
    },
    {
      audience: "negotiations",
      scopes: ["negotiations:thread:read", "negotiations:round:read", "negotiations:round:decide"],
      reason: "عرضُ المفاوضةِ على السائقِ وقبولُ جولةٍ أو رفضُها.",
      evidence: ["DRIVER_BOT_NEGOTIATIONS_SCOPES"],
    },
  ],
  "partner-bot": [
    {
      audience: "identity",
      scopes: ["identity:resolve:write"],
      reason: "إنشاءُ هويّةِ قناةٍ للشريكِ عندَ أوّلِ رسالةٍ.",
      evidence: ["CHANNEL_IDENTITY_SCOPES"],
    },
  ],
} as const;

/**
 * أدوارُ أسطولِ الاختبارِ — **جردٌ منتهٍ مُعلَنٌ**، لا منحُ إنتاجٍ.
 *
 * هذهِ أسماءٌ تُوقِّعُ بها بوّاباتُ الخروجِ ومجموعاتُ الاختبارِ، وبعضُها يُوقِّعُ
 * بقصدٍ بصلاحيّاتٍ **أوسعَ** من أيِّ منحٍ مشروعٍ (أو بصلاحيّةِ حدٍّ آخرَ) كي
 * يُقاسَ رفضُ الحدِّ نفسِه. فلا تُمنَحُ هنا شيئاً، وإنّما تُسمّى كي لا تُقرأَ
 * أدوارَ إنتاجٍ غيرَ مُعلَنةٍ في الفحصِ 16. **والبابُ الذي يحميها**: الفحصُ 16
 * يرفضُ ظهورَ أيِّ اسمٍ منها في ملفٍّ إنتاجيٍّ، ويرفضُ ظهورَ دورِ إنتاجٍ لا
 * إعلانَ لهُ في `PRODUCTION_GRANTS`.
 */
export const TEST_FLEET_ROLES: Readonly<Record<string, string>> = {
  "e2e-harness": "بوّابةُ خروجٍ عامّةٌ تُوقِّعُ بكاملِ مجموعةِ صلاحيّاتِ الحدِّ لتُثبِتَ سلوكَ الحدِّ لا سلوكَ المُنادي.",
  "order-exit-gate": "بوّابةُ خروجِ مرحلةِ الطلباتِ — `Object.values(ORDER_SCOPES)`.",
  "dispatch-exit-gate": "بوّابةُ خروجِ مرحلةِ الإرسالِ — `Object.values(ORDER_SCOPES)`.",
  "reputation-exit-gate": "بوّابةُ خروجِ مرحلةِ السُّمعةِ — `Object.values(ORDER_SCOPES)`.",
  "channel-exit-gate": "بوّابةُ خروجِ مرحلةِ القنواتِ — `Object.values(CHANNEL_SCOPES)` + `Object.values(IDENTITY_SCOPES)`.",
  "phase02-exit-gate": "بوّابةُ خروجِ المرحلةِ الثانيةِ (الجغرافيا والهويّةُ).",
  attacker: "دورٌ سلبيٌّ: يحملُ صلاحيّةً صحيحةً بمفتاحٍ غيرِ معروفٍ ليُقاسَ رفضُ الحدِّ — لا منحَ لهُ أصلاً.",
  caller: "دورٌ في اختبارِ وحدةٍ داخلَ `packages/service-auth` — لا وجودَ لهُ خارجَ الاختبار.",
  "driver-exit-gate":
    "بوّابةُ خروجِ مرحلةِ السائقِ على حدِّ الطلباتِ — اسمٌ يُمرَّرُ وسيطاً إلى مصنعِ توقيعٍ، فلم يكنْ يراهُ الحارسُ الساكنُ أصلاً.",
  "negotiation-exit-gate":
    "بوّابةُ خروجِ مرحلةِ المفاوضاتِ على حدِّ الطلباتِ — اسمٌ يُمرَّرُ وسيطاً كذلك.",
  "dispatch-matching-exit-gate":
    "بوّابةُ خروجٍ تُوقِّعُ بمجموعةِ صلاحيّاتِ حدِّ المطابقةِ الواسعةِ (`GATE_MATCHING_SCOPES`) — وكانَتْ تُوقِّعُ بدورِ الإنتاجِ «dispatch» فوقَ سقفِهِ حتّى الموجةِ 3 من `M1-05B`.",
} as const;

/**
 * سقفُ أدوارِ أسطولِ الاختبارِ — **جمهورٌ مُعلَنٌ لا صلاحيّةٌ مُعلَنةٌ** (الموجةُ 3 · `M1-05B`).
 *
 * ── لِمَ سقفٌ لأدوارِ اختبارٍ أصلاً ────────────────────────────────────────
 * حينَ صارَ الإصدارُ يُنفِذُ المصفوفةَ في **زمنِ التشغيلِ** (لا في البوّابةِ
 * وحدَها) صارَ كلُّ موضعِ توقيعٍ — إنتاجيّاً كانَ أو اختباريّاً — يمرُّ على
 * قرارٍ واحدٍ. ودورٌ لا إعلانَ لهُ يُرفَضُ؛ فلو تُرِكَتْ أدوارُ الأسطولِ بلا
 * سقفٍ لَسقطَتْ تسعُ حزمِ `*-e2e` عندَ أوّلِ توقيعٍ، ولَكانَ العلاجُ الكاذبُ
 * **استثناءَ بيئةٍ أو اسمٍ** في المُوقِّعِ — وهوَ البديلُ المرفوضُ صراحةً في
 * صفِّ `M1-05B`، إذ حاجزٌ لهُ بابٌ خلفيٌّ يُقاسُ بأوسعِ ما يسمحُ بهِ.
 *
 * ── ولِمَ `"any-scope"` ولا تُعَدُّ الصلاحيّاتُ ───────────────────────────
 * لأنَّ **وظيفةَ** هذهِ الأدوارِ توقيعٌ خارجَ أيِّ منحٍ مشروعٍ: بوّابةُ خروجٍ
 * تُوقِّعُ بكاملِ مجموعةِ صلاحيّاتِ الحدِّ لتقيسَ سلوكَ الحدِّ، ودورٌ مهاجِمٌ
 * يُوقِّعُ بصلاحيّةِ حدٍّ آخرَ ليُقاسَ الرفضُ. فعَدُّ صلاحيّاتِها كانَ سيصيرُ
 * نسخةً ثانيةً من مجموعاتِ الصلاحيّاتِ تشيخُ بلا أن تشتكيَ.
 *
 * **وما يبقى مقيساً هنا هوَ الجمهورُ**: دورُ أسطولٍ يُوقِّعُ على حدٍّ لم
 * يُعلَنْ لهُ يُرفَضُ في زمنِ التشغيلِ. وقوّةُ الحاجزِ على الإنتاجِ لا تُستقى
 * من هذا الجدولِ بل من أمرَينِ مقيسَينِ: (1) `PRODUCTION_GRANTS` سقفٌ مُحصىً
 * بالصلاحيّةِ، و(2) البابُ 5 في الفحصِ 16 يرفضُ ظهورَ أيِّ اسمٍ من أسماءِ
 * الأسطولِ في ملفٍّ إنتاجيٍّ.
 */
export interface FleetGrant {
  /** الأجمهرةُ المسموحةُ — أو `"any-audience"` لدورٍ لا يخرجُ من اختبارِ وحدةٍ. */
  readonly audiences: readonly string[] | "any-audience";
  /** `"any-scope"`: التوقيعُ خارجَ المنحِ هوَ وظيفةُ الدورِ نفسِها. */
  readonly scopes: readonly string[] | "any-scope";
  /** سببٌ مكتوبٌ — لا صفَّ بلا سببٍ، والفحصُ 16 يرفضُ الفراغَ. */
  readonly reason: string;
}

export const FLEET_GRANTS: Readonly<Record<string, FleetGrant>> = {
  "e2e-harness": {
    audiences: [
      "identity",
      "dispatch",
      "marketplace",
      "negotiations",
      "delivery",
      "matching",
      // الموجةُ التاسعةُ من `M1-04` (`CLM-0197`): حدُّ العميلِ صارَ يفرضُ الهويّةَ،
      // ومُنادوهُ الفعليّونَ اليومَ بوّاباتُ الخروجِ وحدَها — لا مُنادي إنتاجٍ عبرَ
      // HTTP لهُ (بوتُ العميلِ يُنادي حالاتِ الاستعمالِ في العمليّةِ نفسِها).
      "customers",
      // الموجةُ العاشرةُ من `M1-04` (`CLM-0198`): حدُّ السائقين صارَ يفرضُ الهويّةَ،
      // ومُنادوهُ الفعليّونَ اليومَ بوّابةُ خروجِ السائقِ وحدَها.
      "drivers",
    ],
    scopes: "any-scope",
    reason:
      "بوّابةُ خروجٍ عامّةٌ في خمسِ حزمِ `*-e2e` — تُوقِّعُ بكاملِ مجموعةِ الحدِّ، وعلى «delivery» بصلاحيّةِ سوقٍ بقصدٍ ليُقاسَ رفضُ الحدِّ.",
  },
  "negotiation-exit-gate": {
    audiences: ["orders"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ مرحلةِ المفاوضاتِ على حدِّ الطلباتِ — `Object.values(ORDER_SCOPES)`.",
  },
  "driver-exit-gate": {
    audiences: ["orders"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ مرحلةِ السائقِ على حدِّ الطلباتِ — `Object.values(ORDER_SCOPES)`.",
  },
  "order-exit-gate": {
    audiences: ["orders"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ مرحلةِ الطلباتِ — `Object.values(ORDER_SCOPES)`.",
  },
  "dispatch-exit-gate": {
    audiences: ["orders"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ مرحلةِ الإرسالِ على حدِّ الطلباتِ.",
  },
  "dispatch-matching-exit-gate": {
    audiences: ["matching"],
    scopes: "any-scope",
    reason:
      "بوّابةُ خروجِ الإرسالِ على حدِّ المطابقةِ — بديلُ توقيعٍ كانَ يجري بدورِ الإنتاجِ «dispatch» فوقَ سقفِهِ.",
  },
  "reputation-exit-gate": {
    audiences: ["orders"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ مرحلةِ السُّمعةِ على حدِّ الطلباتِ.",
  },
  "channel-exit-gate": {
    audiences: ["channel", "identity"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ مرحلةِ القنواتِ — `Object.values(CHANNEL_SCOPES)` + `Object.values(IDENTITY_SCOPES)`.",
  },
  "phase02-exit-gate": {
    audiences: ["identity", "geography"],
    scopes: "any-scope",
    reason: "بوّابةُ خروجِ المرحلةِ الثانيةِ — الجغرافيا والهويّةُ.",
  },
  attacker: {
    audiences: ["marketplace"],
    scopes: "any-scope",
    reason: "دورٌ سلبيٌّ يحملُ صلاحيّةً صحيحةً بمفتاحٍ غيرِ معروفٍ ليُقاسَ رفضُ الحدِّ.",
  },
  caller: {
    audiences: "any-audience",
    scopes: "any-scope",
    reason:
      "اختبارُ وحدةٍ داخلَ `packages/service-auth` يُنشِئُ حدوداً وهميّةً («alpha» · «beta») لا وجودَ لها في `AUDIENCES` — فحصرُ جمهورِهِ كانَ سيُثبِّتَ أسماءَ اختبارٍ في المصفوفةِ.",
  },
} as const;

/** السقفُ المُعلَنُ لدورِ أسطولٍ — `undefined` إذا لم يُعلَنْ. */
export function fleetGrantFor(role: string): FleetGrant | undefined {
  return FLEET_GRANTS[role];
}

/** السقفُ المُعلَنُ لدورٍ على جمهورٍ — `undefined` إذا لا منحَ. */
export function grantFor(role: Role, audience: Audience): Grant | undefined {
  return PRODUCTION_GRANTS[role]?.find((g) => g.audience === audience);
}

/** الأجمهرةُ التي يحقُّ لهذا الدورِ مُنادَاتُها. */
export function grantedAudiences(role: Role): readonly Audience[] {
  return (PRODUCTION_GRANTS[role] ?? []).map((g) => g.audience);
}

/** الأدوارُ التي مُنِحت هذهِ الصلاحيّةَ — لقراءةِ «مَن يحملُها اليومَ». */
export function holdersOf(scope: string): readonly Role[] {
  const out: Role[] = [];
  for (const [role, grants] of Object.entries(PRODUCTION_GRANTS)) {
    if (grants.some((g) => g.scopes.includes(scope))) out.push(role);
  }
  return out.sort();
}
