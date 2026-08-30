/**
 * جلسةُ البشرِ — نواةُ المجالِ النقيّةُ (عنصرُ العمل **M1-02** · **ADR-019**).
 *
 * لا شيءَ في هذا الملفِّ يعرف تلغرامَ ولا Postgres ولا HTTP. هو يعرف شيئاً
 * واحداً: **متى تكون الجلسةُ صالحةً**. وسببُ عزلِه أنّ هذا الحكمَ هو ما
 * يُحتَجُّ به في كلِّ طلبٍ في النظام، فيجب أن يكون قابلاً للفحصِ بلا قاعدةِ
 * بياناتٍ وبلا شبكة.
 *
 * والوقتُ يُمرَّر دائماً ولا يُقرأ من `Date.now()` — كما في `auth-sdk`
 * (ADR-018). دالّةٌ تقرأ الساعةَ بنفسِها لا يمكن اختبارُ حدودِها.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** نوعُ الفاعلِ في الجلسة — يطابق `CHECK` في `schema.sql`. */
export const SESSION_ACTOR_TYPES = ["customer", "driver", "admin", "support"] as const;
export type SessionActorType = (typeof SESSION_ACTOR_TYPES)[number];

/** القناةُ التي أصدرت الجلسة — يطابق `CHECK` في `schema.sql`. */
export const SESSION_CHANNELS = ["telegram", "web", "mobile"] as const;
export type SessionChannel = (typeof SESSION_CHANNELS)[number];

/** عمرُ الجلسةِ الافتراضيُّ: أربعُ ساعاتٍ (قرارُ ADR-019 §العمر). */
export const DEFAULT_SESSION_TTL_SECONDS = 4 * 60 * 60;

/** طولُ الرمزِ العشوائيِّ بالبايت — 32 بايتاً = 256 بتَ عشوائيّةٍ. */
export const SESSION_TOKEN_BYTES = 32;

/**
 * الجلسةُ كما تُحفَظ. لاحِظ أنّ **الرمزَ ليس فيها**: ما يُحفَظ بصمتُه فقط،
 * والرمزُ الصريحُ يعيش لحظةَ الإصدارِ ثمّ لا يعود موجوداً في أيِّ مكانٍ
 * عندَنا. فمن نسيَ رمزَه لا نستطيع تذكيرَه — وذلك مقصودٌ لا نقص.
 */
export interface Session {
  readonly id: string;
  readonly userInternalUuid: string;
  readonly actorType: SessionActorType;
  readonly channel: SessionChannel;
  readonly tokenHash: string;
  readonly initDataHash: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
}

/** أسبابُ عدمِ صلاحيّةِ جلسةٍ موجودة. */
export const SessionInvalidity = {
  Revoked: "REVOKED",
  Expired: "EXPIRED",
} as const;
export type SessionInvalidityValue =
  (typeof SessionInvalidity)[keyof typeof SessionInvalidity];

/**
 * حكمُ الصلاحيّة. `null` تعني صالحةً.
 *
 * ترتيبُ الفحصِ: **الإلغاءُ قبلَ الانتهاء**. جلسةٌ أُلغيت لأنّ صاحبَها أبلغ
 * عن سرقةِ جهازِه ثمّ انتهت مدّتُها يجب أن تُروى بأنّها «مُلغاة» لا
 * «منتهية»، لأنّ الإلغاءَ حدثٌ أمنيٌّ يُحقَّق فيه والانتهاءَ روتين.
 */
export function sessionInvalidity(
  session: Session,
  now: Date,
): SessionInvalidityValue | null {
  if (session.revokedAt !== null) return SessionInvalidity.Revoked;
  // الحدُّ **غيرُ شاملٍ** — كما في `auth-sdk` (ADR-018): اللحظةُ المساويةُ
  // لوقتِ الانتهاءِ منتهيةٌ. الاتّساقُ بين الطبقتَينِ أهمُّ من أيِّ الحدَّينِ
  // «أصحُّ»، فاختلافُهما بثانيةٍ يُنتج عيباً لا يُعاد إنتاجُه.
  if (now.getTime() >= Date.parse(session.expiresAt)) return SessionInvalidity.Expired;
  return null;
}

/** هل الجلسةُ صالحةٌ الآن؟ */
export function isSessionValid(session: Session, now: Date): boolean {
  return sessionInvalidity(session, now) === null;
}

/**
 * يُولّد رمزَ جلسةٍ **مُعتِماً** (opaque): بايتاتٌ عشوائيّةٌ بلا أيِّ معنى.
 *
 * ولم نستعمل JWT هنا بقرارِ ADR-019: الرمزُ المُعتِمُ يُلغى فوراً بحذفِ
 * سطرٍ، وJWT لا يُلغى إلّا بقائمةِ إلغاءٍ تُقرأ في كلِّ طلبٍ — وهي نفسُها
 * قراءةُ قاعدةِ بياناتٍ كانت JWT تدّعي توفيرَها.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/** بصمةُ الرمزِ التي تُحفَظ — sha256 بصيغةِ hex صغيرةِ الأحرف. */
export function hashSessionToken(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("hashSessionToken: رمزٌ فارغٌ — خطأُ برمجةٍ لا مُدخَلُ مستخدم.");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * مقارنةُ بصمتَينِ بزمنٍ ثابت.
 *
 * والبصمةُ ليست سرّاً بحدِّ ذاتِها، لكنّ المقارنةَ المُبكّرةَ الخروجِ تكشف
 * عن بادئةٍ مُطابِقةٍ، فيصير التخمينُ تدريجيّاً بدلاً من أن يكون شاملاً.
 */
export function sessionHashEquals(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** يحسب وقتَ انتهاءِ جلسةٍ تبدأ الآن. */
export function sessionExpiryFrom(
  issuedAt: Date,
  ttlSeconds: number = DEFAULT_SESSION_TTL_SECONDS,
): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError("sessionExpiryFrom: مدّةُ الجلسةِ يجب أن تكون ثانيةً واحدةً على الأقل.");
  }
  return new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString();
}
