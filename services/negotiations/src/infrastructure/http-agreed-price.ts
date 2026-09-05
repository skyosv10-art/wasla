/**
 * `AgreedPricePort` الحقيقي: تسليم المبلغ المتَّفق عليه إلى محرّك الطلب (8087)
 * — Phase 08 · MR 5/6، وهو **الكتابة الصادرة الوحيدة** في هذه الخدمة.
 *
 * ## القاعدة التي يحرسها هذا الملف (ADR-013 القرار 2)
 *
 * فشلُ التسليم **لا يُبطل اتفاقاً**. القبول أجاب `2xx` باتفاقه قبل أن يُنادى هذا المنفذ
 * أصلاً؛ فما يقع هنا يُحرّك `handoff_state` ولا شيء غيره. ولذلك لا يرمي هذا المحوّل
 * خطأً يحمل رمزاً منشوراً، ولا يعرف شيئاً عن `502`.
 *
 * ## ثلاثة أجوبة، وحدُّ ما بينها هو كل شيء
 *
 *   - **`accepted`** — `2xx`. و`201` و`200` كلاهما قبول: الأولى تسجيلٌ أوّل، والثانية
 *     إعادةٌ بمفتاح التفرّد نفسه. من يفرّق بينهما هنا يُحوّل إعادةَ محاولةٍ ناجحة إلى عطل.
 *   - **`rejected`** — `409` أو `422`: محرّك الطلب **قرّر**. القرار نهائيٌّ على الاتفاق
 *     ولا يُعاد سؤاله (`use-cases/handoff.ts`)، والرمز يُسجَّل كما جاء في `code` ليُقرأ
 *     لاحقاً بلا تخمين.
 *   - **رميٌ** — مهلة، انقطاع، `5xx`، جسمٌ مشوّه، **و`404` كذلك**. والرمي يُسجَّل
 *     `unavailable` فتُعيد النبضةُ المحاولة حتى `MAX_HANDOFF_ATTEMPTS` ثمّ `abandoned`.
 *
 * ### لماذا `404` رميٌ لا `rejected`
 *
 * الخيط لم يُفتح إلّا لأنّ عرض توزيعٍ أشار إلى ذلك الطلب، ولقطةُ الفتح قرأت الطلب من
 * محرّك الطلب نفسه. فـ«لا أعرف هذا الطلب» يناقض واقعةً تحقّقنا منها، وهو حادثةُ تكاملٍ
 * في البيانات لا قراراً عن سعر. و`rejected` تُغلق الملفّ نهائياً؛ أمّا الرمي فيُبقي أثر
 * المحاولات ويُنهيها إلى `abandoned` — وهي حالةٌ تعني «على إنسانٍ أن ينظر»، وهذا بعينه
 * ما يجب أن يحدث.
 *
 * ## مفتاح التفرّد ثابت عبر المحاولات
 *
 * `negotiation-{threadId}` — لا رقم المحاولة فيه. الاتفاق واحدٌ على الخيط، فمحاولةٌ
 * ثانية بمفتاحٍ ثانٍ كانت تسمح بتسجيل سعرٍ مرّتين على طلبٍ واحد لو أنّ المحاولة الأولى
 * نجحت وسقط جوابها في الطريق. وبالمفتاح الثابت يُجيب المحرّك `200` فيُقرأ ذاك قبولاً.
 */

import type { ServiceRequestSigner } from "@wasla/service-auth";

import type { AgreedPriceHandoffResult, AgreedPricePort } from "../ports.js";

/** مسار تسجيل السعر المتَّفق عليه في محرّك الطلب (MR 5/6). */
export const ORDER_AGREED_PRICES_PATH = "/orders/agreed-prices";

/** الصلاحيات التي يحتاجها هذا العميل على حد الطلبات، لا أكثر. */
export const NEGOTIATIONS_ORDERS_SCOPES: readonly string[] = ["orders:agreed-price:write"];

/** مفتاح التفرّد: خيطٌ واحد ⇒ مفتاحٌ واحد، مهما تكرّرت المحاولات. */
export const agreedPriceIdempotencyKey = (threadId: string): string =>
  `negotiation-${threadId}`;

export interface HttpAgreedPriceOptions {
  /** أصلُ محرّك الطلب (8087). بلا مسار ولا شرطة أخيرة. */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /**
   * موقّع النداء الصادر. **إلزامي بلا قيمة افتراضية بقصد** (M1-04): القيمة
   * الافتراضية «بلا توقيع» كانت ستجعل نداءً يُنسى توقيعه ينجح في كل اختبار
   * ويُرَدّ 401 في الإنتاج وحده، وهو أسوأ موضع لاكتشاف نسيان.
   */
  readonly signRequest: ServiceRequestSigner;
}

export class HttpAgreedPricePort implements AgreedPricePort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpAgreedPriceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async handOff(
    input: {
      readonly orderPublicId: string;
      readonly threadId: string;
      readonly driverPublicId: string;
      readonly amountMinor: number;
      readonly currency: string;
      readonly agreedAt: string;
      readonly attemptNo: number;
    },
    options?: { readonly traceId?: string | null },
  ): Promise<AgreedPriceHandoffResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${ORDER_AGREED_PRICES_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": agreedPriceIdempotencyKey(input.threadId),
          // الرمز مربوط بهذه الطريقة وهذا المسار ويُحرق عند أول استعمال.
          ...this.signRequest("POST", ORDER_AGREED_PRICES_PATH),
          ...(options?.traceId ? { "x-request-id": options.traceId } : {}),
        },
        body: JSON.stringify({
          order_public_id: input.orderPublicId,
          negotiation_id: input.threadId,
          driver_public_id: input.driverPublicId,
          amount_minor: input.amountMinor,
          currency: input.currency,
          agreed_at: input.agreedAt,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // رقمُ المحاولة يدخل نصّ الخطأ ولا يدخل المفتاح: مفيدٌ في السجلّ، وكارثيٌّ في
      // مفتاح التفرّد (انظر ترويسة الملف).
      const reason = (error as Error).name === "AbortError" ? "مهلة" : "انقطاع";
      throw new Error(
        `agreed price hand-off failed (${reason}, attempt ${String(input.attemptNo)})`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 200 && response.status < 300) {
      return { outcome: "accepted", responseStatus: response.status, errorCode: null };
    }
    if (response.status === 409 || response.status === 422) {
      return {
        outcome: "rejected",
        responseStatus: response.status,
        errorCode: await errorCodeFrom(response),
      };
    }
    throw new Error(
      `agreed price hand-off refused transport (${String(response.status)}, attempt ${String(input.attemptNo)})`,
    );
  }
}

/**
 * الرمز من جسم الخطأ، أو `null` إن لم يحمله.
 *
 * `null` هنا مقبول وليس عطلاً: القرار وقع، ورمزه تفصيلٌ يُسجَّل. أمّا رميُ خطأٍ لأنّ
 * الجسم مشوّه فكان سيُحوّل قراراً نهائياً إلى إعادةِ محاولةٍ أبديّة على قرارٍ لن يتغيّر.
 */
async function errorCodeFrom(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === "string" && body.code.length > 0 ? body.code : null;
  } catch {
    return null;
  }
}
