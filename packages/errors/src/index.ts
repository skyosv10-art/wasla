/**
 * @wasla/errors — أنواع الأخطاء الأساسية المشتركة بين خدمات WASLA.
 *
 * كل خطأ يحمل `code` ثابت (stable) — راجع عقد الأخطاء لكل خدمة
 * (مثلاً services/identity/contracts/errors.md). لا تُغيَّر دلالة الكود
 * بعد الإصدار؛ الأكواد الجديدة تُضاف فقط.
 */

export interface WaslaErrorOptions {
  code: string;
  message: string;
  cause?: unknown;
  traceId?: string;
}

/**
 * الصنف الأساسي لكل أخطاء WASLA. يُورَث منه لكل خدمة.
 */
export class WaslaError extends Error {
  readonly code: string;
  readonly traceId?: string;

  constructor(options: WaslaErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.traceId = options.traceId;
  }

  /** تمثيل JSON آمن للتسجيل (لا يُسرب بيانات حساسة). */
  toJSON(): WaslaErrorOptions {
    return { code: this.code, message: this.message, traceId: this.traceId };
  }
}

/**
 * يتحقق أن القيمة مثال WaslaError. مفيد في حدود الأخطاء (error boundaries)
 * وفي اختبارات Contract.
 */
export function isWaslaError(value: unknown): value is WaslaError {
  return value instanceof WaslaError;
}
