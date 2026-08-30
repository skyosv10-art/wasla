/**
 * أخطاءُ حدِّ المصادقةِ والتفويض. أكوادٌ ثابتةٌ لا تُغيَّر دلالتُها بعدَ الإصدار
 * (docs/00-rules — عقدُ الأخطاء)، وتُقابِلها رموزُ HTTP في الوسيطِ المركزيِّ (M1-04).
 */

import { WaslaError } from "@wasla/errors";

/** أكوادُ أخطاءِ الحدِّ الأمنيِّ. `AUTHN_*` = من أنتَ، `AUTHZ_*` = ما يُسمح لك. */
export const AuthErrorCode = {
  /** الإثباتُ مفقودٌ أو غيرُ متحقَّقٍ منه → 401. */
  UNAUTHENTICATED: "AUTHN_UNAUTHENTICATED",
  /** شكلُ الـ`Principal` غيرُ صالحٍ بنيويّاً → 401 (لا 400: هو فشلُ إثبات). */
  INVALID_PRINCIPAL: "AUTHN_INVALID_PRINCIPAL",
  /** الإثباتُ انتهت مدّتُه → 401. */
  EXPIRED: "AUTHN_EXPIRED",
  /** الرمزُ مُوجَّهٌ إلى خدمةٍ أخرى → 401. يمنع إعادةَ الاستخدامِ عبرَ الحدود. */
  AUDIENCE_MISMATCH: "AUTHN_AUDIENCE_MISMATCH",
  /** الهويّةُ صحيحةٌ والصلاحيّةُ ناقصةٌ → 403. */
  FORBIDDEN: "AUTHZ_FORBIDDEN",
  /** الهويّةُ صحيحةٌ والكائنُ ليس لها (منعُ IDOR) → 404 لا 403 عندَ الحدِّ العام. */
  NOT_OWNER: "AUTHZ_NOT_OWNER",
} as const;

export type AuthErrorCodeValue =
  (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

/** فشلُ إثباتِ الهويّة (401). */
export class AuthenticationError extends WaslaError {
  constructor(
    code: AuthErrorCodeValue,
    message: string,
    options?: { cause?: unknown; traceId?: string },
  ) {
    super({ code, message, ...options });
  }
}

/** فشلُ التفويض (403/404). */
export class AuthorizationError extends WaslaError {
  constructor(
    code: AuthErrorCodeValue,
    message: string,
    options?: { cause?: unknown; traceId?: string },
  ) {
    super({ code, message, ...options });
  }
}
