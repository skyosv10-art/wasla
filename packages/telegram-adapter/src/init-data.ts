/**
 * التحقُّقُ من `init-data` الوارِدِ من تطبيقِ تلغرام المُصغَّر (Mini App).
 *
 * عنصرُ العمل: **M1-02** · القرارُ الحاكم:
 * docs/15-decisions/ADR-019-human-session-lifecycle-and-init-data-verification.md
 *
 * لِمَ هنا لا في `auth-sdk`؟ لأنّ [ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md)
 * يُلزِم أنّ `auth-sdk` **لا تتحقَّق من توقيعٍ ولا تُصدِر رموزاً**، ولأنّ صيغةَ
 * `init-data` مفرداتُ تلغرامَ لا مفرداتُ المجال — وهو عينُ السببِ الذي وضع
 * `webhook-auth.ts` في هذه الحزمةِ.
 *
 * وحدُّ هذا الملفِّ **التحقُّقُ وحدَه**: لا قاعدةَ بياناتٍ، ولا جلسةً، ولا
 * `Principal`. من يُصدِر الجلسةَ هو `services/identity` (ADR-018 §2)، ومنعُ
 * إعادةِ الاستعمالِ (replay) قيدٌ فريدٌ في قاعدتِه — لأنّ الذاكرةَ لا تمنع
 * إعادةَ استعمالٍ عبرَ نسختَينِ من الخدمة، وقاعدةُ البياناتِ تمنع.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * حقلُ التوقيعِ الذي يُستثنى من نصِّ التحقُّق.
 * تلغرام يحسب التوقيعَ على بقيّةِ الحقولِ مرتَّبةً، لا على نفسِه.
 */
const HASH_FIELD = "hash";

/**
 * الحقلُ الذي أدخلته تلغرام لتوقيعِ Ed25519 المستقبليّ (`signature`).
 * يُستثنى من نصِّ التحقُّقِ في حسابِ HMAC لأنّه ليس جزءاً منه، ووجودُه
 * وحدَه لا يُبطِل التحقُّق — وإلّا لَكَسر تغييرٌ في منصّةِ تلغرام كلَّ جلسةٍ.
 */
const ED25519_SIGNATURE_FIELD = "signature";

/** المِلحُ الثابتُ الذي يُشتقُّ به مفتاحُ التوقيعِ من رمزِ الروبوت. */
const KEY_SALT = "WebAppData";

/** أطولُ عمرٍ مقبولٍ لِـ`init-data` بالثواني، حين لا يُمرَّر غيرُه. */
export const DEFAULT_INIT_DATA_MAX_AGE_SECONDS = 900;

/** أقصرُ رمزِ روبوتٍ مقبولٌ — رمزٌ فارغٌ أو قصيرٌ خطأُ تهيئةٍ لا حالةُ رفضٍ. */
const MIN_BOT_TOKEN_LENGTH = 20;

/** أسبابُ الرفضِ — للسجلِّ والمقاييسِ لا للردِّ على العميل. */
export const InitDataRejection = {
  /** بنيةٌ غيرُ مقروءةٍ: نصٌّ فارغٌ، أو حقلٌ بلا `=`، أو حقلٌ مكرَّرٌ. */
  Malformed: "INIT_DATA_MALFORMED",
  /** لا حقلَ `hash` أصلاً. */
  MissingHash: "INIT_DATA_MISSING_HASH",
  /** التوقيعُ لا يُطابق. */
  BadSignature: "INIT_DATA_BAD_SIGNATURE",
  /** لا `auth_date`، أو ليس عدداً صحيحاً موجباً. */
  MissingAuthDate: "INIT_DATA_MISSING_AUTH_DATE",
  /** `auth_date` أقدمُ من أطولِ عمرٍ مقبول. */
  Expired: "INIT_DATA_EXPIRED",
  /** `auth_date` في المستقبلِ أكثرَ من السماحِ المقبول. */
  FromTheFuture: "INIT_DATA_FROM_THE_FUTURE",
  /** لا حقلَ `user`، أو ليس JSON، أو بلا `id` رقميٍّ. */
  MissingUser: "INIT_DATA_MISSING_USER",
} as const;

export type InitDataRejectionValue =
  (typeof InitDataRejection)[keyof typeof InitDataRejection];

/** خطأُ رفضٍ يحمل سبباً مقروءاً آليّاً ولا يحمل شيئاً من المُدخَل. */
export class InitDataError extends Error {
  readonly reason: InitDataRejectionValue;

  constructor(reason: InitDataRejectionValue) {
    // الرسالةُ واحدةٌ لكلِّ الأسبابِ بقصد: الردُّ على العميلِ لا يكون
    // عرّافاً يُخبره أيُّ بابٍ أخفق. والسببُ الدقيقُ في `reason` للسجلِّ.
    super("init-data غير صالح");
    this.name = "InitDataError";
    this.reason = reason;
  }
}

/** مستخدمُ تلغرامَ كما وُقِّع عليه — لا أكثرَ مما نستعمله. */
export interface TelegramInitDataUser {
  readonly id: number;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly languageCode?: string;
  readonly isPremium?: boolean;
  readonly isBot?: boolean;
}

/** ناتجُ تحقُّقٍ ناجحٍ. */
export interface VerifiedInitData {
  readonly user: TelegramInitDataUser;
  /** `auth_date` بالثواني كما وقّعته تلغرام. */
  readonly authDateSeconds: number;
  /** `auth_date` ISO-8601 — ليقارنه من لا يعرف ثوانيَ يونكس. */
  readonly authDate: string;
  /**
   * بصمةُ `init-data` **كلِّه** (sha256 hex) — هي مفتاحُ منعِ إعادةِ الاستعمالِ
   * عندَ إصدارِ الجلسة. ليست `hash` الواردةَ من تلغرام: تلك توقيعٌ يُثبت
   * الأصالةَ، وهذه هويّةُ الرسالةِ التي تمنع صرفَها مرّتَين.
   */
  readonly fingerprint: string;
  /** `start_param` إن وُجد — يحمل رابطَ الدخولِ العميق. */
  readonly startParam?: string;
  /** `chat_instance` إن وُجد. */
  readonly chatInstance?: string;
  /** `query_id` إن وُجد. */
  readonly queryId?: string;
}

/** خياراتُ التحقُّق. الوقتُ يُمرَّر دائماً ولا يُقرأ من الساعةِ داخلَ الدالّة. */
export interface VerifyInitDataOptions {
  /** الآنَ — يُمرَّر صريحاً كي يكون الاختبارُ حتميّاً (ADR-018 §6). */
  readonly now: Date;
  /** أطولُ عمرٍ مقبولٌ بالثواني. */
  readonly maxAgeSeconds?: number;
  /**
   * سماحُ انحرافِ الساعةِ للأمامِ بالثواني. ساعةُ خادمٍ متأخّرةٌ بثانيتَينِ
   * تجعل كلَّ `init-data` «من المستقبل» — فالسماحُ الصغيرُ يمنع انقطاعاً
   * كاملاً، والسماحُ الكبيرُ يُلغي فائدةَ فحصِ العمرِ.
   */
  readonly clockSkewSeconds?: number;
}

/** سماحُ الانحرافِ الافتراضيُّ للأمام. */
export const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/**
 * يُفكِّك `init-data` إلى أزواجٍ **بلا فقدانِ ترتيبٍ ولا تجاهلِ تكرار**.
 *
 * لا يُستعمل `URLSearchParams` هنا لأنّه يقبل الحقلَ المكرَّرَ صامتاً
 * (`getAll`) بينما `get` يُعيد الأوّلَ — وهذا بابُ تلبيسٍ (parameter
 * pollution): يوقِّع المهاجمُ على `user` سليمٍ ثمّ يُضيف `user` ثانياً،
 * فيقرأ التحقُّقُ أحدَهما ويقرأ التطبيقُ الآخر. فالتكرارُ يُرفَض صراحةً.
 */
function parsePairs(raw: string): Map<string, string> {
  if (raw.length === 0) throw new InitDataError(InitDataRejection.Malformed);

  const out = new Map<string, string>();
  for (const chunk of raw.split("&")) {
    if (chunk.length === 0) throw new InitDataError(InitDataRejection.Malformed);
    const eq = chunk.indexOf("=");
    // مفتاحٌ بلا `=` أو مفتاحٌ فارغٌ (`=v`) بنيةٌ غيرُ صالحة.
    if (eq <= 0) throw new InitDataError(InitDataRejection.Malformed);
    const key = chunk.slice(0, eq);
    if (out.has(key)) throw new InitDataError(InitDataRejection.Malformed);
    let value: string;
    try {
      value = decodeURIComponent(chunk.slice(eq + 1));
    } catch {
      // `%zz` يُلقي `URIError` — يُترجَم رفضاً لا انفجاراً.
      throw new InitDataError(InitDataRejection.Malformed);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * نصُّ التحقُّق: كلُّ الحقولِ ما عدا `hash` و`signature`، مرتَّبةً
 * بالمفتاحِ تصاعديّاً ومفصولةً بسطرٍ جديد.
 *
 * الترتيبُ بمقارنةِ الوحداتِ الرمزيّةِ (`<`) لا بـ`localeCompare`: الأخيرُ
 * يتبع محليّةَ النظامِ فيُنتج ترتيباً مختلفاً على خادمٍ بمحليّةٍ أخرى،
 * فيُخفِق التحقُّقُ في الإنتاجِ وينجح في الاختبار.
 */
function dataCheckString(pairs: Map<string, string>): string {
  return [...pairs.entries()]
    .filter(([k]) => k !== HASH_FIELD && k !== ED25519_SIGNATURE_FIELD)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** مقارنةٌ ثابتةُ الزمنِ على البايتات — لا تُفشي طولاً ولا موضعَ اختلاف. */
function hexEquals(candidate: string, expected: string): boolean {
  // `Buffer.from(x, "hex")` يتجاهل ما ليس hex صامتاً، فيُقارَن ناتجٌ مبتورٌ
  // بناتجٍ كامل؛ ولذلك يُتحقَّق من الصيغةِ أوّلاً ثمّ يُقارَن.
  if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
  const a = Buffer.from(candidate.toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** يقرأ `user` المُوقَّعَ ويُسقِط ما لا نستعمله. */
function parseUser(rawUser: string | undefined): TelegramInitDataUser {
  if (!rawUser) throw new InitDataError(InitDataRejection.MissingUser);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    throw new InitDataError(InitDataRejection.MissingUser);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new InitDataError(InitDataRejection.MissingUser);
  }
  const o = parsed as Record<string, unknown>;
  const id = o["id"];
  // `Number.isSafeInteger` لا `typeof number`: معرّفُ تلغرامَ يُقارَب في
  // العائمِ الكبيرِ فيصير معرّفاً آخرَ، وذلك خلطُ هويّاتٍ لا خطأُ صيغة.
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new InitDataError(InitDataRejection.MissingUser);
  }
  const str = (key: string): string | undefined =>
    typeof o[key] === "string" ? (o[key] as string) : undefined;
  const bool = (key: string): boolean | undefined =>
    typeof o[key] === "boolean" ? (o[key] as boolean) : undefined;

  return {
    id,
    ...(str("first_name") !== undefined ? { firstName: str("first_name") } : {}),
    ...(str("last_name") !== undefined ? { lastName: str("last_name") } : {}),
    ...(str("username") !== undefined ? { username: str("username") } : {}),
    ...(str("language_code") !== undefined
      ? { languageCode: str("language_code") }
      : {}),
    ...(bool("is_premium") !== undefined ? { isPremium: bool("is_premium") } : {}),
    ...(bool("is_bot") !== undefined ? { isBot: bool("is_bot") } : {}),
  };
}

/** بصمةُ الرسالةِ كلِّها — مفتاحُ منعِ إعادةِ الاستعمال. */
export function fingerprintInitData(raw: string): string {
  return createHmac("sha256", KEY_SALT).update(raw).digest("hex");
}

/**
 * يتحقَّق من `init-data` ويُعيد ما وُقِّع عليه.
 *
 * الترتيبُ مقصودٌ: البنيةُ، ثمّ **التوقيعُ**، ثمّ العمرُ، ثمّ المستخدم.
 * لا يُقرأ حقلٌ ولا يُبنى قرارٌ على مُدخَلٍ قبلَ إثباتِ أنّ تلغرامَ وقّعته —
 * وإلّا صار الفحصُ الأرخصُ بابَ عملٍ على بياناتٍ مجهولةِ الأصل.
 *
 * @throws InitDataError دائماً برسالةٍ واحدةٍ وسببٍ في `reason`.
 */
export function verifyTelegramInitData(
  raw: string,
  botToken: string,
  options: VerifyInitDataOptions,
): VerifiedInitData {
  if (!botToken || botToken.length < MIN_BOT_TOKEN_LENGTH) {
    // خطأُ تهيئةٍ لا رفضُ مُدخَلٍ: نشرةٌ نسيت الرمزَ يجب أن تتوقّفَ لا أن
    // تردَّ 401 على كلِّ مستخدمٍ وتُخفيَ سببَها في سجلِّ الرفض.
    throw new TypeError("رمزُ الروبوتِ غيرُ مُهيَّأٍ أو أقصرُ من المقبول");
  }

  const pairs = parsePairs(raw);

  const providedHash = pairs.get(HASH_FIELD);
  if (!providedHash) throw new InitDataError(InitDataRejection.MissingHash);

  const secretKey = createHmac("sha256", KEY_SALT).update(botToken).digest();
  const expected = createHmac("sha256", secretKey)
    .update(dataCheckString(pairs))
    .digest("hex");
  if (!hexEquals(providedHash, expected)) {
    throw new InitDataError(InitDataRejection.BadSignature);
  }

  const rawAuthDate = pairs.get("auth_date");
  if (rawAuthDate === undefined || !/^\d+$/.test(rawAuthDate)) {
    throw new InitDataError(InitDataRejection.MissingAuthDate);
  }
  const authDateSeconds = Number(rawAuthDate);
  if (!Number.isSafeInteger(authDateSeconds) || authDateSeconds <= 0) {
    throw new InitDataError(InitDataRejection.MissingAuthDate);
  }

  const maxAge = options.maxAgeSeconds ?? DEFAULT_INIT_DATA_MAX_AGE_SECONDS;
  const skew = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  const ageSeconds = nowSeconds - authDateSeconds;

  // الحدُّ **شاملٌ**: عمرٌ يساوي أقصى العمرِ مقبولٌ، وأكبرُ منه مرفوضٌ.
  // اتّفاقٌ معلَنٌ لأنّ الحدَّ يجب أن يُختبَر عندَ نقطتِه لا حولَها.
  if (ageSeconds > maxAge) throw new InitDataError(InitDataRejection.Expired);
  if (ageSeconds < -skew) throw new InitDataError(InitDataRejection.FromTheFuture);

  const user = parseUser(pairs.get("user"));
  const optional = (key: string): string | undefined => {
    const v = pairs.get(key);
    return v !== undefined && v.length > 0 ? v : undefined;
  };

  return {
    user,
    authDateSeconds,
    authDate: new Date(authDateSeconds * 1000).toISOString(),
    fingerprint: fingerprintInitData(raw),
    ...(optional("start_param") !== undefined
      ? { startParam: optional("start_param") }
      : {}),
    ...(optional("chat_instance") !== undefined
      ? { chatInstance: optional("chat_instance") }
      : {}),
    ...(optional("query_id") !== undefined ? { queryId: optional("query_id") } : {}),
  };
}

/**
 * يبني `init-data` مُوقَّعاً — **للاختبارِ ولوحدةِ التطويرِ المحليّةِ فقط**.
 *
 * يُصدَّر بقصدٍ لا سهواً: بلا مُوقِّعٍ حقيقيٍّ يصير اختبارُ التوقيعِ محاكاةً
 * لدالّةِ التحقُّقِ نفسِها، فتمرُّ الاختباراتُ على خطأٍ مشترَك. واسمُه يُعلن
 * أنّه ليس طريقَ إنتاج.
 */
export function signInitDataForTests(
  fields: Readonly<Record<string, string>>,
  botToken: string,
): string {
  const pairs = new Map(Object.entries(fields));
  const secretKey = createHmac("sha256", KEY_SALT).update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString(pairs))
    .digest("hex");
  const encoded = [...pairs.entries()]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${encoded}&${HASH_FIELD}=${hash}`;
}
