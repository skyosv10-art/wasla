/**
 * رمزُ هويّةِ الخدمةِ — المِنتاجُ والتحقُّق (M1-03).
 *
 * القرارُ الحاكم: [ADR-020](../../../docs/15-decisions/ADR-020-service-to-service-identity.md).
 * ونموذجُ المُخرَجِ من [ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md):
 * لا يُصنَع هنا شكلٌ جديدٌ لـ«مَن يُنادي»، بل يُسلَّم `ServicePrincipal` نفسُه.
 *
 * ── الصيغةُ ولماذا ليست JWT ──────────────────────────────────────────────
 *
 *     wsvc2.<base64url(JSON الحِمْل)>.<base64url(HMAC-SHA256)>
 *
 * **لا ترويسةَ خوارزميّةٍ في الرمز، وهذا أهمُّ سطرٍ في الملفّ.** JWT تجعل
 * المُهاجمَ يُخبِر المُتحقِّقَ **بأيِّ خوارزميّةٍ يتحقَّق** (`alg`)، وتاريخُ ذلك
 * الحقلِ هو تاريخُ `alg: none` وخلطِ `HS256` بـ`RS256`. فالخوارزميّةُ هنا
 * **ثابتةٌ في الكودِ**، والنسخةُ وحدَها في البادئةِ `wsvc2`، وأيُّ بادئةٍ أخرى
 * تُرفَض قبلَ أن يُفَكَّ ترميزُ حرفٍ واحد.
 *
 * والتوقيعُ يُحسَب على **النصِّ المُرسَلِ حرفيّاً** (`wsvc2.<payload>`) لا على
 * إعادةِ تسلسلِ الحِمْلِ بعدَ تحليلِه — فلا فرجةَ بين «ما وُقِّع» و«ما قُرِئ»،
 * وهي الفرجةُ التي تُستغَلُّ في هجماتِ التسلسلِ المُتباعِد.
 *
 * ── الربطُ بالطلبِ إلزاميٌّ ────────────────────────────────────────────────
 * كلُّ رمزٍ مربوطٌ بـ`<METHOD> <path>` واحدٍ. فالرمزُ المُلتقَطُ من نداءِ قراءةٍ
 * لا يُعاد استخدامُه على نداءِ حذفٍ. ولا يُقبَل رمزٌ بلا ربطٍ: خيارُ «بلا ربط»
 * كان سيُنتِج حاملَ سلطةٍ عامّاً بعمرِ دقيقةٍ، وهذا ما كان يُفترَض منعُه.
 *
 * ── لِمَ `wsvc2` ولمَ اليومَ ─────────────────────────────────────────────────
 * أُضيفَ `jti` **حقلاً إلزاميّاً** كي يكون لكلِّ رمزٍ أثرٌ يُحفَظ فيُعرَف المُعاد
 * (ADR-021). وحقلٌ إلزاميٌّ جديدٌ **تغييرُ صيغةٍ لا إعدادٍ**، فبُدِّلت البادئةُ:
 * رمزُ `wsvc1` يُرفَض اليومَ بـ`unsupported_scheme` قبلَ فكِّ ترميزِ حرفٍ.
 * والوقتُ هو اليومَ لأنّه آخرُ يومٍ يكون فيه التبديلُ مجّانيّاً: لا حدَّ مفروضاً
 * في الإنتاجِ بعدُ، فلا مِنتاجَ قائماً يُكسَر. وتوافقٌ خَلفيٌّ مع صيغةٍ بلا `jti`
 * كان سيعني حارسَ إعادةٍ يُتخطّى بحذفِ حقلٍ — أي حارساً اسمُه حارسٌ فقط.
 *
 * ── ما لا يفعله هذا الملفُّ (يُقال ولا يُدَّعى خلافُه) ──────────────────────
 * - **لا يسأل مخزنَ الآثارِ بنفسِه.** يُنتِج `jti` ويُسلِّمه في
 *   `verifyServiceTokenDetailed`، ومَن يسأل الحارسَ هو نقطةُ الفرضِ (`enforce.ts`)
 *   — كي تبقى هذه الدالّةُ نقيّةً بلا حالةٍ ولا انتظارٍ، ويبقى الحارسُ قراراً واحداً
 *   في موضعٍ واحدٍ لا فحصاً مبثوثاً.
 * - **لا يُشتَقُّ تفويضٌ.** الصلاحيّاتُ تُمرَّر وتُقرَأ، ومصفوفةُ الأدوارِ `M1-05`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ServicePrincipal } from "@wasla/auth-sdk";

import { ServiceAuthError } from "./errors.js";
import type { ServiceAuthKeyRegistry } from "./keys.js";

/** بادئةُ النسخةِ. تغييرُها تغييرُ صيغةٍ لا إعدادٍ. */
export const SERVICE_TOKEN_SCHEME = "wsvc2";

/**
 * الصيغةُ السابقةُ — بلا `jti` فبلا حارسِ إعادةٍ. تُذكَر هنا **لتُرفَض باسمِها**
 * لا لتُقبَل: بقاؤها في القراءةِ يُبطِل الحارسَ كلَّه.
 */
export const SUPERSEDED_TOKEN_SCHEMES: readonly string[] = ["wsvc1"];

/** العمرُ الافتراضيُّ للرمز: 60 ثانيةً — نداءٌ داخليٌّ لا جلسةٌ. */
export const DEFAULT_SERVICE_TOKEN_TTL_SECONDS = 60;

/**
 * أقصى عمرٍ مقبولٍ: 300 ثانيةً. رمزٌ أطولُ من ذلك حاملُ سلطةٍ لا إثباتُ نداءٍ،
 * ويُرفَض عندَ المِنتاجِ **وعندَ التحقُّقِ** كليهما — فلا يكفي أن يكون المِنتاجُ
 * مؤدَّباً، لأنّ الرمزَ قد يُصنَع بمِنتاجٍ آخرَ يملك المفتاحَ نفسَه.
 */
export const MAX_SERVICE_TOKEN_TTL_SECONDS = 300;

/** هامشُ انحرافِ الساعاتِ المسموحُ به: 60 ثانيةً. */
export const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/** صيغةُ اسمِ الخدمةِ: كما في `services/<name>` — لا اسمٌ حرٌّ. */
const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * صيغةُ `jti`: حروفُ base64url، 22..64. والحدُّ الأدنى ليس ذوقاً: 22 حرفاً هي
 * ترميزُ 16 بايتاً عشوائيّةً (128 بتاً)، وما دونَها يجعل التخمينَ ممكناً —
 * ومُهاجمٌ يُخمِّن `jti` رمزٍ لم يُرسَل بعدُ يستطيع **حَرْقَه** فيمنع نداءً شريفاً.
 */
const JTI_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** عددُ بايتاتِ العشوائيّةِ في `jti` المُنتَج. */
const JTI_RANDOM_BYTES = 16;

/** حِمْلُ الرمزِ كما يُسلسَل. أسماءٌ قصيرةٌ لأنّه يعبر في ترويسةٍ. */
interface ServiceTokenPayload {
  /** معرِّفُ المفتاح. */
  kid: string;
  /** الخدمةُ المُنادية. */
  svc: string;
  /** الخدمةُ المقصودة. */
  aud: string;
  /** الصلاحيّاتُ المطلوبة. */
  scp: string[];
  /** لحظةُ الإصدارِ (ثوانٍ من الحَتِّ). */
  iat: number;
  /** لحظةُ الانتهاءِ (ثوانٍ من الحَتِّ) — الحدُّ غيرُ شاملٍ. */
  exp: number;
  /** الربطُ بالطلبِ: `<METHOD> <path>`. */
  req: string;
  /** المعرِّفُ الفريدُ للرمزِ — أثرُ منعِ الإعادةِ (ADR-021). */
  jti: string;
  /** المعرِّفُ العامُّ لمَن يُنفَّذ الطلبُ نيابةً عنه (اختياريٌّ). */
  obo?: string;
}

/**
 * ما يحتاجه حارسُ الإعادةِ من رمزٍ **أُثبِت توقيعُه**: لا أكثرَ ولا سرَّ فيه.
 * ويُخرَج منفصلاً عن `ServicePrincipal` لأنّ شكلَ الـ`Principal` مِلكُ ADR-018
 * ولا يُضاف إليه حقلُ نقلٍ خاصٌّ بصيغةِ رمزٍ واحدةٍ.
 */
export interface VerifiedServiceTokenTrace {
  readonly kid: string;
  readonly jti: string;
  readonly expiresAtMs: number;
}

export interface VerifiedServiceToken {
  readonly principal: ServicePrincipal;
  readonly trace: VerifiedServiceTokenTrace;
}

export interface MintServiceTokenOptions {
  /** اسمُ الخدمةِ المُنادية كما في `services/<name>`. */
  readonly serviceName: string;
  /** اسمُ الخدمةِ المقصودةِ. */
  readonly audience: string;
  /** الصلاحيّاتُ المطلوبةُ لهذا النداء. */
  readonly scopes?: readonly string[];
  /** طريقةُ الطلبِ ومساره — الربطُ إلزاميٌّ. */
  readonly method: string;
  readonly path: string;
  /** سجلُّ المفاتيح. يُوقَّع بالمفتاحِ النشط. */
  readonly keys: ServiceAuthKeyRegistry;
  /** اللحظةُ الحاضرةُ — تُمرَّر ولا تُقرأ من الساعةِ العامّة. */
  readonly now: Date;
  readonly ttlSeconds?: number;
  readonly onBehalfOfPublicId?: string;
  /**
   * معرِّفٌ فريدٌ صريحٌ. **للاختبارِ الحتميِّ وحدَه**: يُمرَّر كي يُثبَت أنّ
   * الرمزَ نفسَه يُرفَض مرّتَينِ. وفي الإنتاجِ يُولَّد من عشوائيّةٍ معتمَدةٍ،
   * ولا يُشتَقُّ من الطلبِ ولا من الوقتِ — معرِّفٌ مُشتَقٌّ معرِّفٌ مُتوقَّعٌ.
   */
  readonly jti?: string;
}

export interface VerifyServiceTokenOptions {
  /** اسمُ الخدمةِ المُتحقِّقةِ — الرمزُ يجب أن يكون موجَّهاً إليها. */
  readonly audience: string;
  /** الطلبُ الفعليُّ الذي وصلَ — يُقارَن بالربطِ المُوقَّع. */
  readonly method: string;
  readonly path: string;
  readonly keys: ServiceAuthKeyRegistry;
  readonly now: Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

// ─────────────────────────────── أدواتٌ صغيرةٌ ───────────────────────────────

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64url");
}

/** يُطبِّع الربطَ: الطريقةُ كبيرةٌ، والمسارُ بلا سلسلةِ استعلامٍ ولا شرطةٍ أخيرة. */
export function canonicalRequestBinding(method: string, path: string): string {
  const upperMethod = method.trim().toUpperCase();
  const withoutQuery = path.split("?")[0] ?? "";
  const trimmed =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
  const normalized = trimmed === "" ? "/" : trimmed;
  return `${upperMethod} ${normalized}`;
}

function signingInput(encodedPayload: string): string {
  return `${SERVICE_TOKEN_SCHEME}.${encodedPayload}`;
}

function mac(secret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", secret).update(signingInput(encodedPayload)).digest();
}

/**
 * مقارنةٌ بزمنٍ ثابتٍ. الطولُ يُقارَن أوّلاً لأنّ `timingSafeEqual` يرمي على
 * اختلافِ الطولِ — والرميُ نفسُه تسريبٌ زمنيٌّ، فيُمنَع قبلَ وقوعِه.
 */
function macEquals(expected: Buffer, actual: Buffer): boolean {
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function secondsFrom(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// ─────────────────────────────── المِنتاج ───────────────────────────────

/**
 * يُنتِج رمزَ هويّةِ خدمةٍ مربوطاً بطلبٍ واحدٍ.
 *
 * ويرفض ما لا يجوز إنتاجُه أصلاً: اسمٌ غيرُ مطابقٍ للصيغةِ، أو عمرٌ فوقَ الحدِّ،
 * أو `now` غيرُ صالحٍ. **والرفضُ عندَ المِنتاجِ ليس تجميلاً:** رمزٌ مشوَّهٌ
 * يُنتَج بنجاحٍ ثمّ يُرفَض عندَ الطرفِ الآخرِ يُنتِج عطباً يُشخَّص في الخدمةِ الخطأ.
 */
export function mintServiceToken(options: MintServiceTokenOptions): string {
  const {
    serviceName,
    audience,
    scopes = [],
    method,
    path,
    keys,
    now,
    ttlSeconds = DEFAULT_SERVICE_TOKEN_TTL_SECONDS,
    onBehalfOfPublicId,
  } = options;

  if (!SERVICE_NAME_PATTERN.test(serviceName)) {
    throw new TypeError(`اسمُ الخدمةِ المُنادية «${serviceName}» غيرُ صالح.`);
  }
  if (!SERVICE_NAME_PATTERN.test(audience)) {
    throw new TypeError(`اسمُ الخدمةِ المقصودة «${audience}» غيرُ صالح.`);
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError("عمرُ الرمزِ يجب أن يكون عدداً صحيحاً موجباً.");
  }
  if (ttlSeconds > MAX_SERVICE_TOKEN_TTL_SECONDS) {
    throw new TypeError(
      `عمرُ الرمزِ ${ttlSeconds}ث يتجاوز الحدَّ ${MAX_SERVICE_TOKEN_TTL_SECONDS}ث.`,
    );
  }
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("اللحظةُ الحاضرةُ غيرُ صالحة.");
  }

  const jti = options.jti ?? base64UrlEncode(randomBytes(JTI_RANDOM_BYTES));
  if (!JTI_PATTERN.test(jti)) {
    throw new TypeError("معرِّفُ الرمزِ jti لا يطابق الصيغةَ المسموحة.");
  }

  const issuedAt = secondsFrom(now);
  const payload: ServiceTokenPayload = {
    kid: keys.activeKid,
    svc: serviceName,
    aud: audience,
    scp: [...scopes],
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    req: canonicalRequestBinding(method, path),
    jti,
    ...(onBehalfOfPublicId === undefined ? {} : { obo: onBehalfOfPublicId }),
  };

  const encodedPayload = base64UrlEncode(
    Buffer.from(JSON.stringify(payload), "utf8"),
  );
  const signature = base64UrlEncode(mac(keys.activeSecret(), encodedPayload));
  return `${signingInput(encodedPayload)}.${signature}`;
}

// ─────────────────────────────── التحقُّق ───────────────────────────────

/**
 * يتحقَّق من رمزٍ ويُسلِّم `ServicePrincipal`، أو يرمي `ServiceAuthError`.
 *
 * **ترتيبُ الأبوابِ مقصودٌ ومكتوبٌ:** بنيةٌ ← مفتاحٌ ← **توقيعٌ** ← زمنٌ ← عمرٌ
 * ← جمهورٌ ← ربطٌ بالطلب. فلا يُنطَق بسببٍ دلاليٍّ قبلَ إثباتِ التوقيعِ، وإلّا
 * صارَ الردُّ أداةَ استكشافٍ: مَن لا يملك المفتاحَ لا يستحقُّ أن يعرف أنّ
 * رمزَه «كان سينجح لولا الجمهور».
 */
export function verifyServiceToken(
  token: string,
  options: VerifyServiceTokenOptions,
): ServicePrincipal {
  return verifyServiceTokenDetailed(token, options).principal;
}

/**
 * نفسُ التحقُّقِ، ويُسلَّم معَ الـ`Principal` **أثرُ الرمزِ** (`kid` · `jti` ·
 * لحظةُ الانتهاءِ) كي يسألَ به حارسُ الإعادةِ **بعدَ إثباتِ التوقيعِ لا
 * قبلَه** — والترتيبُ شرطٌ أمنيٌّ لا ترتيبٌ إنشائيٌّ (ADR-021 §4).
 */
export function verifyServiceTokenDetailed(
  token: string,
  options: VerifyServiceTokenOptions,
): VerifiedServiceToken {
  const {
    audience,
    method,
    path,
    keys,
    now,
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
    maxTtlSeconds = MAX_SERVICE_TOKEN_TTL_SECONDS,
  } = options;

  if (Number.isNaN(now.getTime())) {
    throw new TypeError("اللحظةُ الحاضرةُ غيرُ صالحة.");
  }

  // ── 1) البنيةُ والنسخة ──
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ServiceAuthError("malformed_token", "عددُ أقسامِ الرمزِ غيرُ صالح.");
  }
  const [scheme, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  if (scheme !== SERVICE_TOKEN_SCHEME) {
    throw new ServiceAuthError(
      "unsupported_scheme",
      "بادئةُ الرمزِ غيرُ مدعومة.",
    );
  }
  if (encodedPayload === "" || encodedSignature === "") {
    throw new ServiceAuthError("malformed_token", "قسمٌ فارغٌ في الرمز.");
  }

  const payload = decodePayload(encodedPayload);

  // ── 2) المفتاحُ وحالُه في دورةِ الحياة ──
  // المفتاحُ المسحوبُ (`revoked`) **لا يُحذَف من السجلِّ بل يُرفَض باسمِه**:
  // حذفُه يجعل السحبَ والخطأَ المطبعيَّ حادثةً واحدةً في السجلِّ (`unknown_key`)،
  // ومَن يُحقّق حادثَ سرقةِ مفتاحٍ يحتاج أن يرى فرقًا (ADR-022 §5).
  const resolved = keys.resolveVerificationKey(payload.kid);
  if (resolved.status === "unknown") {
    throw new ServiceAuthError("unknown_key", "معرِّفُ المفتاحِ غيرُ معروف.");
  }
  if (resolved.status === "revoked") {
    throw new ServiceAuthError("revoked_key", "مفتاحُ الرمزِ مسحوبٌ.");
  }
  const secret = resolved.secret;

  // ── 3) التوقيعُ — قبلَ أيِّ حكمٍ دلاليّ ──
  const expected = mac(secret, encodedPayload);
  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new ServiceAuthError("malformed_token", "ترميزُ التوقيعِ غيرُ صالح.");
  }
  if (!macEquals(expected, actual)) {
    throw new ServiceAuthError("bad_signature", "توقيعُ الرمزِ لا يُطابق.");
  }

  // ── 4) الزمن ──
  const nowSeconds = secondsFrom(now);
  if (payload.iat > nowSeconds + clockSkewSeconds) {
    throw new ServiceAuthError("issued_in_future", "الرمزُ صادرٌ في المستقبل.");
  }
  // الحدُّ **غيرُ شاملٍ**: `exp === now` منتهٍ — مطابقةً لـ`isExpired` في auth-sdk.
  if (nowSeconds >= payload.exp) {
    throw new ServiceAuthError("expired", "انتهت مدّةُ الرمز.");
  }

  // ── 5) العمرُ المُعلَن — يُفحَص عندَ المُتحقِّقِ لا عندَ المِنتاجِ وحدَه ──
  if (payload.exp - payload.iat > maxTtlSeconds) {
    throw new ServiceAuthError(
      "lifetime_too_long",
      "عمرُ الرمزِ المُعلَنُ يتجاوز الحدَّ المقبول.",
    );
  }

  // ── 6) الجمهور ──
  if (payload.aud !== audience) {
    throw new ServiceAuthError(
      "audience_mismatch",
      "الرمزُ موجَّهٌ إلى خدمةٍ أخرى.",
    );
  }

  // ── 7) الربطُ بالطلب ──
  if (payload.req !== canonicalRequestBinding(method, path)) {
    throw new ServiceAuthError(
      "request_binding_mismatch",
      "الرمزُ مربوطٌ بطلبٍ آخر.",
    );
  }

  return {
    principal: {
      kind: "service",
      serviceName: payload.svc,
      audience: payload.aud,
      scopes: Object.freeze([...payload.scp]),
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      ...(payload.obo === undefined ? {} : { onBehalfOfPublicId: payload.obo }),
    },
    trace: {
      kid: payload.kid,
      jti: payload.jti,
      expiresAtMs: payload.exp * 1000,
    },
  };
}

/**
 * يفكُّ الحِمْلَ ويتحقَّق من صيغتِه **بلا ثقةٍ به**. الفحصُ هنا بنيويٌّ محضٌ:
 * ما بعدَه من أحكامٍ لا يُنطَق به قبلَ التوقيع.
 */
function decodePayload(encodedPayload: string): ServiceTokenPayload {
  let json: string;
  try {
    json = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    throw new ServiceAuthError("malformed_token", "ترميزُ الحِمْلِ غيرُ صالح.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ServiceAuthError("malformed_token", "حِمْلُ الرمزِ ليس JSON صالحاً.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ServiceAuthError("invalid_claims", "حِمْلُ الرمزِ ليس كائناً.");
  }

  const candidate = parsed as Record<string, unknown>;
  const { kid, svc, aud, scp, iat, exp, req, jti, obo } = candidate;

  if (typeof kid !== "string" || kid === "") {
    throw new ServiceAuthError("invalid_claims", "الحقلُ kid غيرُ صالح.");
  }
  if (typeof svc !== "string" || !SERVICE_NAME_PATTERN.test(svc)) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ svc غيرُ صالح.");
  }
  if (typeof aud !== "string" || !SERVICE_NAME_PATTERN.test(aud)) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ aud غيرُ صالح.");
  }
  if (
    !Array.isArray(scp) ||
    scp.some((scope) => typeof scope !== "string" || scope === "")
  ) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ scp غيرُ صالح.");
  }
  if (!Number.isSafeInteger(iat) || (iat as number) < 0) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ iat غيرُ صالح.");
  }
  if (!Number.isSafeInteger(exp) || (exp as number) < 0) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ exp غيرُ صالح.");
  }
  if ((exp as number) <= (iat as number)) {
    throw new ServiceAuthError("invalid_claims", "exp ليس بعدَ iat.");
  }
  if (typeof req !== "string" || req === "") {
    throw new ServiceAuthError("invalid_claims", "الحقلُ req غيرُ صالح.");
  }
  // غيابُ `jti` **ليس تسامحاً**: رمزٌ بلا أثرٍ لا يستطيع الحارسُ أن يعرفَ
  // أنّه مُعادٌ، فقبولُه يفتحُ النافذةَ التي أُغلقت بإسقاطِ حقلٍ واحدٍ.
  if (typeof jti !== "string" || !JTI_PATTERN.test(jti)) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ jti غيرُ صالح.");
  }
  if (obo !== undefined && (typeof obo !== "string" || obo === "")) {
    throw new ServiceAuthError("invalid_claims", "الحقلُ obo غيرُ صالح.");
  }

  return {
    kid,
    svc,
    aud,
    scp: scp as string[],
    iat: iat as number,
    exp: exp as number,
    req,
    jti,
    ...(obo === undefined ? {} : { obo: obo as string }),
  };
}
