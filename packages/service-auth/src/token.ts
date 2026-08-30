/**
 * رمزُ هويّةِ الخدمةِ — المِنتاجُ والتحقُّق (M1-03).
 *
 * القرارُ الحاكم: [ADR-020](../../../docs/15-decisions/ADR-020-service-to-service-identity.md).
 * ونموذجُ المُخرَجِ من [ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md):
 * لا يُصنَع هنا شكلٌ جديدٌ لـ«مَن يُنادي»، بل يُسلَّم `ServicePrincipal` نفسُه.
 *
 * ── الصيغةُ ولماذا ليست JWT ──────────────────────────────────────────────
 *
 *     wsvc1.<base64url(JSON الحِمْل)>.<base64url(HMAC-SHA256)>
 *
 * **لا ترويسةَ خوارزميّةٍ في الرمز، وهذا أهمُّ سطرٍ في الملفّ.** JWT تجعل
 * المُهاجمَ يُخبِر المُتحقِّقَ **بأيِّ خوارزميّةٍ يتحقَّق** (`alg`)، وتاريخُ ذلك
 * الحقلِ هو تاريخُ `alg: none` وخلطِ `HS256` بـ`RS256`. فالخوارزميّةُ هنا
 * **ثابتةٌ في الكودِ**، والنسخةُ وحدَها في البادئةِ `wsvc1`، وأيُّ بادئةٍ أخرى
 * تُرفَض قبلَ أن يُفَكَّ ترميزُ حرفٍ واحد.
 *
 * والتوقيعُ يُحسَب على **النصِّ المُرسَلِ حرفيّاً** (`wsvc1.<payload>`) لا على
 * إعادةِ تسلسلِ الحِمْلِ بعدَ تحليلِه — فلا فرجةَ بين «ما وُقِّع» و«ما قُرِئ»،
 * وهي الفرجةُ التي تُستغَلُّ في هجماتِ التسلسلِ المُتباعِد.
 *
 * ── الربطُ بالطلبِ إلزاميٌّ ────────────────────────────────────────────────
 * كلُّ رمزٍ مربوطٌ بـ`<METHOD> <path>` واحدٍ. فالرمزُ المُلتقَطُ من نداءِ قراءةٍ
 * لا يُعاد استخدامُه على نداءِ حذفٍ. ولا يُقبَل رمزٌ بلا ربطٍ: خيارُ «بلا ربط»
 * كان سيُنتِج حاملَ سلطةٍ عامّاً بعمرِ دقيقةٍ، وهذا ما كان يُفترَض منعُه.
 *
 * ── ما لا يفعله هذا الملفُّ (يُقال ولا يُدَّعى خلافُه) ──────────────────────
 * - **لا يمنع الإعادةَ داخلَ نافذةِ العمر.** لا مخزنَ `jti` هنا؛ الحمايةُ هي
 *   قِصَرُ العمرِ + الربطُ بالطلبِ. وهذا دَينٌ مُعلَنٌ في ADR-020 §3 لا نقصٌ مُخفى.
 * - **لا يُفرَض على أيِّ حدٍّ HTTP.** الفرضُ على حدودِ الخدماتِ عنصرُ `M1-04`.
 * - **لا يُشتَقُّ تفويضٌ.** الصلاحيّاتُ تُمرَّر وتُقرَأ، ومصفوفةُ الأدوارِ `M1-05`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ServicePrincipal } from "@wasla/auth-sdk";

import { ServiceAuthError } from "./errors.js";
import type { ServiceAuthKeyRegistry } from "./keys.js";

/** بادئةُ النسخةِ. تغييرُها تغييرُ صيغةٍ لا إعدادٍ. */
export const SERVICE_TOKEN_SCHEME = "wsvc1";

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
  /** المعرِّفُ العامُّ لمَن يُنفَّذ الطلبُ نيابةً عنه (اختياريٌّ). */
  obo?: string;
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

  const issuedAt = secondsFrom(now);
  const payload: ServiceTokenPayload = {
    kid: keys.activeKid,
    svc: serviceName,
    aud: audience,
    scp: [...scopes],
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    req: canonicalRequestBinding(method, path),
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

  // ── 2) المفتاح ──
  const secret = keys.secretFor(payload.kid);
  if (secret === undefined) {
    throw new ServiceAuthError("unknown_key", "معرِّفُ المفتاحِ غيرُ معروف.");
  }

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
    kind: "service",
    serviceName: payload.svc,
    audience: payload.aud,
    scopes: Object.freeze([...payload.scp]),
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    ...(payload.obo === undefined ? {} : { onBehalfOfPublicId: payload.obo }),
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
  const { kid, svc, aud, scp, iat, exp, req, obo } = candidate;

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
    ...(obo === undefined ? {} : { obo: obo as string }),
  };
}
