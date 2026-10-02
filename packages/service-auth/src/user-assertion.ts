/**
 * تأكيدُ المستخدمِ النهائيِّ `wua1` (ADR-060 · RISK-0042 · CLM-0440).
 *
 * لماذا لا يكفي `obo` في رمزِ الخدمةِ: رمزُ الخدمةِ (`wsvc3`) موقَّعٌ بـHMAC بمفاتيحَ
 * متماثلةٍ، فكلُّ مَن يتحقّقُ منهُ يستطيعُ أن يصكَّهُ بأيِّ `obo`. أمّا هذا التأكيدُ فموقَّعٌ
 * بـ**Ed25519**: المفتاحُ الخاصُّ عندَ `identity` وحدَها، والمُستقبِلونَ يحملونَ العامَّ فقط —
 * فمَن يتحقّقُ لا يصكُّ.
 *
 * الشكلُ: `wua1.<base64url(JSON الحمولة)>.<base64url(توقيع Ed25519 على "wua1.<الحمولة>")>`.
 *
 * **قواعدُ لا تُكسَر هنا:**
 *   - لا يظهرُ مفتاحٌ خاصٌّ في رسالةِ خطأٍ ولا في `toString` ولا في سجلٍّ.
 *   - التحقُّقُ يُعيدُ سبباً مُسمّىً؛ والسببُ للسجلِّ الداخليِّ، والسلكُ يرى كوداً عامّاً.
 *   - الوقتُ يُمرَّرُ (ADR-018)، ولا يُقرأُ من الساعةِ داخلَ الحكمِ.
 */
import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

export const USER_ASSERTION_SCHEME = "wua1";
export const USER_ASSERTION_HEADER = "x-wasla-user-assertion";
export const USER_ASSERTION_ISSUER = "identity";
export const DEFAULT_USER_ASSERTION_TTL_SECONDS = 60;
export const MAX_USER_ASSERTION_TTL_SECONDS = 300;
export const DEFAULT_USER_ASSERTION_SKEW_SECONDS = 30;

export const USER_ASSERTION_ACTORS = ["customer", "driver", "store_staff"] as const;
export type UserAssertionActor = (typeof USER_ASSERTION_ACTORS)[number];

export const USER_ASSERTION_CHANNELS = ["telegram"] as const;
export type UserAssertionChannel = (typeof USER_ASSERTION_CHANNELS)[number];

/** متغيّراتُ البيئةِ — مُسجَّلةٌ في `packages/config/env-registry.json` (M2-04). */
export const USER_ASSERTION_SIGNING_KEY_ENV = "WASLA_USER_ASSERTION_SIGNING_KEY";
export const USER_ASSERTION_PUBLIC_KEYS_ENV = "WASLA_USER_ASSERTION_PUBLIC_KEYS";
export const USER_ASSERTION_MODE_ENV = "WASLA_USER_ASSERTION_MODE";

const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SERVICE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_TOKEN_LENGTH = 4096;

export interface UserAssertionPayload {
  readonly kid: string;
  readonly iss: typeof USER_ASSERTION_ISSUER;
  readonly sub: string;
  readonly act: UserAssertionActor;
  readonly chn: UserAssertionChannel;
  readonly via: string;
  readonly aud: readonly string[];
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

/** مفتاحُ توقيعٍ — لا يُطبَعُ: `toString`/`toJSON`/`inspect` تُخفي المادّةَ. */
export interface UserAssertionSigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
}

export type UserAssertionPublicKeys = ReadonlyMap<string, KeyObject>;

export class UserAssertionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAssertionConfigError";
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  return Buffer.from(text, "base64url");
}

function redactedKey(kid: string, privateKey: KeyObject): UserAssertionSigningKey {
  const key = { kid, privateKey };
  const label = `[UserAssertionSigningKey kid=${kid} redacted]`;
  Object.defineProperties(key, {
    toString: { value: () => label, enumerable: false },
    toJSON: { value: () => label, enumerable: false },
    [Symbol.for("nodejs.util.inspect.custom")]: { value: () => label, enumerable: false },
  });
  return Object.freeze(key);
}

/**
 * يقرأُ مفتاحَ التوقيعِ من `WASLA_USER_ASSERTION_SIGNING_KEY` بصيغةِ
 * `<kid>:<base64 لِـ PKCS#8 DER لمفتاح Ed25519>`. يُعيدُ `null` إن كانَ غائباً (لا تصدير)،
 * ويرمي إن كانَ مُشوَّهاً — ورسالةُ الرمي لا تحملُ شيئاً من القيمة.
 */
export function userAssertionSigningKeyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): UserAssertionSigningKey | null {
  const raw = env[USER_ASSERTION_SIGNING_KEY_ENV];
  if (raw === undefined || raw.trim() === "") return null;
  const sep = raw.indexOf(":");
  const kid = sep > 0 ? raw.slice(0, sep) : "";
  if (!KID_PATTERN.test(kid)) {
    throw new UserAssertionConfigError(`${USER_ASSERTION_SIGNING_KEY_ENV}: expected <kid>:<base64 pkcs8>; kid is invalid`);
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: Buffer.from(raw.slice(sep + 1).trim(), "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new UserAssertionConfigError(`${USER_ASSERTION_SIGNING_KEY_ENV}: key material for kid ${kid} is not a valid PKCS#8 key`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new UserAssertionConfigError(`${USER_ASSERTION_SIGNING_KEY_ENV}: kid ${kid} is not an Ed25519 key`);
  }
  return redactedKey(kid, privateKey);
}

/** يبني مفتاحَ توقيعٍ من `KeyObject` (للاختباراتِ وللمُركِّبِ). */
export function userAssertionSigningKey(kid: string, privateKey: KeyObject): UserAssertionSigningKey {
  if (!KID_PATTERN.test(kid)) throw new UserAssertionConfigError("user assertion kid is invalid");
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new UserAssertionConfigError("user assertion signing key must be a private Ed25519 key");
  }
  return redactedKey(kid, privateKey);
}

/**
 * يقرأُ المفاتيحَ العامّةَ من `WASLA_USER_ASSERTION_PUBLIC_KEYS`: كائنُ JSON
 * `{ "<kid>": "<base64 لِـ SPKI DER>" }`. الغيابُ ⇒ خريطةٌ فارغةٌ (كلُّ تأكيدٍ `unknown_kid`).
 * التدويرُ = إضافةُ `kid` جديدٍ هنا قبلَ تبديلِ مفتاحِ التوقيعِ؛ والإبطالُ = حذفُ `kid`.
 */
export function userAssertionPublicKeysFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): UserAssertionPublicKeys {
  const raw = env[USER_ASSERTION_PUBLIC_KEYS_ENV];
  const keys = new Map<string, KeyObject>();
  if (raw === undefined || raw.trim() === "") return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserAssertionConfigError(`${USER_ASSERTION_PUBLIC_KEYS_ENV}: expected a JSON object {kid: base64 spki}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserAssertionConfigError(`${USER_ASSERTION_PUBLIC_KEYS_ENV}: expected a JSON object {kid: base64 spki}`);
  }
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KID_PATTERN.test(kid) || typeof value !== "string") {
      throw new UserAssertionConfigError(`${USER_ASSERTION_PUBLIC_KEYS_ENV}: entry ${JSON.stringify(kid)} is invalid`);
    }
    let key: KeyObject;
    try {
      key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
    } catch {
      throw new UserAssertionConfigError(`${USER_ASSERTION_PUBLIC_KEYS_ENV}: kid ${kid} is not a valid SPKI key`);
    }
    if (key.asymmetricKeyType !== "ed25519") {
      throw new UserAssertionConfigError(`${USER_ASSERTION_PUBLIC_KEYS_ENV}: kid ${kid} is not an Ed25519 key`);
    }
    keys.set(kid, key);
  }
  return keys;
}

export type UserAssertionMode = "off" | "observe" | "enforce";

/**
 * وضعُ المُستقبِلِ. **الافتراضيُّ `off`**: في المرحلةِ P1 لا يُرفَضُ طلبٌ ولا يتغيّرُ سلوكٌ.
 * `observe` و`enforce` لا يُضبطانِ على Render إلّا بقرارِ مالكٍ مكتوبٍ (P3، ADR-060 §2.7).
 */
export function userAssertionModeFromEnv(env: Readonly<Record<string, string | undefined>>): UserAssertionMode {
  const raw = env[USER_ASSERTION_MODE_ENV];
  if (raw === undefined || raw.trim() === "") return "off";
  const value = raw.trim();
  if (value === "off" || value === "observe" || value === "enforce") return value;
  throw new UserAssertionConfigError(`${USER_ASSERTION_MODE_ENV}: expected off | observe | enforce`);
}

export interface MintUserAssertionOptions {
  readonly key: UserAssertionSigningKey;
  readonly sub: string;
  readonly act: UserAssertionActor;
  readonly chn: UserAssertionChannel;
  readonly via: string;
  readonly aud: readonly string[];
  readonly now: Date;
  readonly ttlSeconds?: number;
  readonly jti?: string;
}

/** يصكُّ تأكيداً. **لا يُستدعى إلّا في `services/identity`** (حارسٌ في اختبارِ المصفوفة). */
export function mintUserAssertion(options: MintUserAssertionOptions): { assertion: string; payload: UserAssertionPayload } {
  const ttl = options.ttlSeconds ?? DEFAULT_USER_ASSERTION_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_USER_ASSERTION_TTL_SECONDS) {
    throw new UserAssertionConfigError(`user assertion ttl must be 1..${MAX_USER_ASSERTION_TTL_SECONDS} s`);
  }
  if (!PUBLIC_ID_PATTERN.test(options.sub)) throw new UserAssertionConfigError("user assertion sub is invalid");
  if (!SERVICE_PATTERN.test(options.via)) throw new UserAssertionConfigError("user assertion via is invalid");
  if (options.aud.length === 0 || !options.aud.every((a) => SERVICE_PATTERN.test(a))) {
    throw new UserAssertionConfigError("user assertion aud is invalid");
  }
  const iat = Math.floor(options.now.getTime() / 1000);
  const payload: UserAssertionPayload = {
    kid: options.key.kid,
    iss: USER_ASSERTION_ISSUER,
    sub: options.sub,
    act: options.act,
    chn: options.chn,
    via: options.via,
    aud: [...new Set(options.aud)].sort(),
    iat,
    exp: iat + ttl,
    jti: options.jti ?? b64url(randomBytes(16)),
  };
  const body = `${USER_ASSERTION_SCHEME}.${b64url(Buffer.from(JSON.stringify(payload), "utf8"))}`;
  const signature = edSign(null, Buffer.from(body, "utf8"), options.key.privateKey);
  return { assertion: `${body}.${b64url(signature)}`, payload };
}

export type UserAssertionFailure =
  | "missing"
  | "malformed"
  | "unknown_kid"
  | "bad_signature"
  | "bad_issuer"
  | "expired"
  | "not_yet_valid"
  | "ttl_too_long"
  | "wrong_audience"
  | "obo_mismatch"
  | "via_not_allowed"
  | "actor_not_allowed";

export interface VerifyUserAssertionOptions {
  readonly publicKeys: UserAssertionPublicKeys;
  /** اسمُ هذه الخدمةِ — يجبُ أن يكونَ في `aud`. */
  readonly audience: string;
  /** `obo` من رمزِ الخدمةِ المُتحقَّقِ منهُ — يجبُ أن يساويَ `sub`. */
  readonly onBehalfOfPublicId: string | undefined;
  /** `svc` من رمزِ الخدمةِ المُتحقَّقِ منهُ — يجبُ أن يساويَ `via` أو يكونَ مُمرِّراً مُعلَناً. */
  readonly callerService: string;
  readonly forwarders?: readonly string[];
  readonly actors?: readonly UserAssertionActor[];
  readonly now: Date;
  readonly skewSeconds?: number;
}

export type UserAssertionVerdict =
  | { readonly ok: true; readonly payload: UserAssertionPayload }
  | { readonly ok: false; readonly reason: UserAssertionFailure };

function decodePayload(segment: string): UserAssertionPayload | null {
  const buf = fromB64url(segment);
  if (buf === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, re: RegExp) => typeof v === "string" && re.test(v);
  const int = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
  if (!str(p.kid, KID_PATTERN) || typeof p.iss !== "string" || !str(p.sub, PUBLIC_ID_PATTERN)) return null;
  if (typeof p.act !== "string" || !(USER_ASSERTION_ACTORS as readonly string[]).includes(p.act)) return null;
  if (typeof p.chn !== "string" || !(USER_ASSERTION_CHANNELS as readonly string[]).includes(p.chn)) return null;
  if (!str(p.via, SERVICE_PATTERN) || !int(p.iat) || !int(p.exp) || !str(p.jti, JTI_PATTERN)) return null;
  if (!Array.isArray(p.aud) || p.aud.length === 0 || !p.aud.every((a) => str(a, SERVICE_PATTERN))) return null;
  return p as unknown as UserAssertionPayload;
}

/**
 * يتحقّقُ من تأكيدٍ بالترتيبِ الثابتِ في ADR-060 §2.3 (الخطواتُ 2–11؛ الخطوةُ 1 — رمزُ
 * الخدمةِ — سابقةٌ له عندَ المُنادي). البنيةُ ثمَّ `kid` ثمَّ **التوقيعُ قبلَ أيِّ قراءةٍ دلاليّةٍ**:
 * لا يُحكَمُ على `aud` أو `sub` لحمولةٍ لم يُثبَتْ توقيعُها.
 */
export function verifyUserAssertion(
  assertion: string | undefined,
  options: VerifyUserAssertionOptions,
): UserAssertionVerdict {
  if (assertion === undefined || assertion === "") return { ok: false, reason: "missing" };
  if (assertion.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = assertion.split(".");
  if (parts.length !== 3 || parts[0] !== USER_ASSERTION_SCHEME) return { ok: false, reason: "malformed" };
  const payload = decodePayload(parts[1]!);
  const signature = fromB64url(parts[2]!);
  if (payload === null || signature === null || signature.length !== 64) return { ok: false, reason: "malformed" };
  const key = options.publicKeys.get(payload.kid);
  if (key === undefined) return { ok: false, reason: "unknown_kid" };
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  let valid = false;
  try {
    valid = edVerify(null, signed, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  if (payload.iss !== USER_ASSERTION_ISSUER) return { ok: false, reason: "bad_issuer" };
  const now = Math.floor(options.now.getTime() / 1000);
  const skew = options.skewSeconds ?? DEFAULT_USER_ASSERTION_SKEW_SECONDS;
  if (payload.exp - payload.iat > MAX_USER_ASSERTION_TTL_SECONDS || payload.exp <= payload.iat) {
    return { ok: false, reason: "ttl_too_long" };
  }
  if (payload.iat > now + skew) return { ok: false, reason: "not_yet_valid" };
  if (now >= payload.exp) return { ok: false, reason: "expired" };
  if (!payload.aud.includes(options.audience)) return { ok: false, reason: "wrong_audience" };
  if (options.onBehalfOfPublicId === undefined || options.onBehalfOfPublicId !== payload.sub) {
    return { ok: false, reason: "obo_mismatch" };
  }
  const forwarders = options.forwarders ?? [];
  if (options.callerService !== payload.via && !forwarders.includes(options.callerService)) {
    return { ok: false, reason: "via_not_allowed" };
  }
  if (options.actors !== undefined && !options.actors.includes(payload.act)) {
    return { ok: false, reason: "actor_not_allowed" };
  }
  return { ok: true, payload };
}

/** الجوابُ على السلكِ في وضعِ `enforce` (ADR-060 §2.6). السببُ الدقيقُ للسجلِّ وحدَه. */
export function userAssertionDenialOf(reason: UserAssertionFailure): {
  readonly status: 401 | 403;
  readonly code:
    | "AUTHN_USER_ASSERTION_REQUIRED"
    | "AUTHN_USER_ASSERTION_INVALID"
    | "AUTHN_USER_ASSERTION_EXPIRED"
    | "AUTHZ_USER_ASSERTION_MISMATCH";
} {
  switch (reason) {
    case "missing":
      return { status: 401, code: "AUTHN_USER_ASSERTION_REQUIRED" };
    case "malformed":
    case "unknown_kid":
    case "bad_signature":
    case "bad_issuer":
    case "ttl_too_long":
      return { status: 401, code: "AUTHN_USER_ASSERTION_INVALID" };
    case "expired":
    case "not_yet_valid":
      return { status: 401, code: "AUTHN_USER_ASSERTION_EXPIRED" };
    case "wrong_audience":
    case "obo_mismatch":
    case "via_not_allowed":
    case "actor_not_allowed":
      return { status: 403, code: "AUTHZ_USER_ASSERTION_MISMATCH" };
  }
}

/** يقرأُ الرأسَ من ترويساتِ طلبٍ (Node يجعلُ الأسماءَ صغيرةً). */
export function userAssertionFromHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  const value = headers[USER_ASSERTION_HEADER];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

/**
 * التفويضُ الذي يُمرِّرُهُ حدٌّ أو مُمرِّرٌ: المعرّفُ العامُّ + التأكيدُ كما صدرَ. **المُمرِّرُ لا
 * يصنعُهُ ولا يُعدِّلُهُ** — يأخذُهُ من `identity` (حدٌّ) أو من طلبٍ واردٍ (مُمرِّرٌ).
 */
export interface UserDelegation {
  readonly publicId: string;
  readonly assertion: string;
}

export function userAssertionHeaders(delegation: UserDelegation | undefined): Record<string, string> {
  return delegation === undefined ? {} : { [USER_ASSERTION_HEADER]: delegation.assertion };
}
