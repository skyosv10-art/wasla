/**
 * `DispatchOfferPort` الحقيقي: العرض من التوزيع (8089) ووضعُ السعر من محرّك الطلب (8087)
 * — Phase 08 · MR 5/6.
 *
 * ## لماذا نداءان لا نداء واحد
 *
 * اللقطة التي يحتاجها فتحُ الخيط مركّبةٌ من ملكيّتين مختلفتين:
 *
 *   - **من التوزيع:** هل العرض قائم؟ ولمن؟ وعلى أيّ طلب؟ العرض يملكه التوزيع، و«قائم»
 *     (`standing`) يحسبه هو من حالة العرض وحالة وظيفته — لا من مقارنة موعدٍ بساعة حائط،
 *     فالزمن هناك نبضة لا مؤقّت.
 *   - **من محرّك الطلب:** هل هذا الطلب يقبل سعراً متفاوضاً أصلاً؟ ذاك `price_mode` في
 *     جدول `orders`، ولا يعرفه التوزيع ولا يجوز أن يُخزّنه: قيمةٌ منسوخةٌ عن جدولِ غيرها
 *     تصير كذبةً في اللحظة التي تتغيّر فيها الأصل.
 *
 * فدمجُهما في نداءٍ واحد كان يستلزم أن تحمل إحدى الخدمتين حقلَ الأخرى. والثمن المقبول
 * هو نداءان قبل الكتابة، وهما على مسار **الفتح** لا على مسار كل دور.
 *
 * ## `null` ليس فشلاً، والفشل ليس `null`
 *
 * `describe` يُعيد `null` لـ«لا عرض بهذا المعرّف» أو «لا طلب بهذا المعرّف العام» — مُدخَلٌ
 * لا سند له، وجوابُه `422` عند المتَّصل. ويرمي `NEGOTIATION_UNAVAILABLE` لكل ما هو
 * «لا أستطيع أن أُجيب»: مهلة، انقطاع، `5xx`، أو جسمٌ لا يوافق العقد. والخلط بينهما هو
 * العطل الذي يجعل عميلاً يكفّ عن إعادة محاولةٍ كانت صحيحة، أو يُعيد أبداً محاولةً باطلة.
 *
 * وجسمٌ مشوّه يُرمى ولا يُعَدّ `null` عن قصد: «التوزيع أجاب بما لا أفهم» حالةُ عطلٍ في
 * أحدنا، لا خبرٌ عن عرضٍ غير موجود.
 *
 * ## لا عنوان افتراضيّ
 *
 * لا `localhost` مُخمَّن هنا ولا في التوصيل: متغيّرٌ ناقص عندنا يجب أن يُقرأ متغيّراً
 * ناقصاً، لا انقطاعاً يُنسب إلى خدمةٍ أخرى في كل سجلٍّ يقرؤه مُشغّل بعد ذلك.
 */

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { negotiationUnavailable } from "../domain/errors.js";
import type { NegotiationServiceKind } from "../domain/model.js";
import type { DispatchOfferPort, DispatchOfferSnapshot } from "../ports.js";

/** مسار قراءة عرضٍ واحد في التوزيع (MR 5/6 · `GET /dispatch/offers/{offer_id}`). */
export const DISPATCH_OFFER_PATH = (offerId: string): string => `/dispatch/offers/${offerId}`;

/** مسار القراءة الخدميّة في محرّك الطلب بالمعرّف العام (MR 5/6). */
export const ORDER_LOOKUP_PATH = (orderPublicId: string): string =>
  `/orders/lookup?order_public_id=${encodeURIComponent(orderPublicId)}`;

/**
 * ما يطلبه هذا المنفذ من حدِّ الطلبات: قراءةُ طلبٍ واحدٍ لا غير (M1-04).
 * **تُعلَن ولا تُستنبَط**: منادٍ يطلب أكثرَ ممّا يحتاج يُوسّع أثرَ سرقةِ رمزٍ بلا سبب.
 */
export const NEGOTIATIONS_ORDER_LOOKUP_SCOPES: readonly string[] = ["orders:order:read"];

/**
 * ما يطلبه هذا المنفذ من حدِّ التوزيع: قراءةُ عرضٍ واحدٍ لا غير (M1-04، الموجةُ
 * الرابعة). **ولا يحمل `dispatch:offer:accept` ولا `dispatch:job:cancel` ولا
 * `dispatch:tick:write`**: سؤالُ «هل هذا العرض قائم» لا يجوز أن يُحمَل برمزٍ
 * يقدر به على قبول العرض نيابةً عن سائقٍ أو على دفع نبضة المحرّك.
 */
export const NEGOTIATIONS_DISPATCH_OFFER_SCOPES: readonly string[] = ["dispatch:offer:read"];

/** وضعُ السعر الذي يسمح بالتفاوض. أيّ قيمةٍ أخرى تعني «هذا الطلب ليس محلَّ تفاوض». */
const NEGOTIABLE_PRICE_MODE = "negotiable";

const SERVICE_KINDS = new Set<string>(["ride", "delivery"]);

export interface HttpDispatchOfferOptions {
  /** أصلُ خدمة التوزيع (8089). بلا مسار ولا شرطة أخيرة. */
  readonly dispatchBaseUrl: string;
  /** أصلُ محرّك الطلب (8087). */
  readonly ordersBaseUrl: string;
  /**
   * موقّعُ النداءِ إلى حدِّ الطلبات (M1-04). **إلزاميٌّ ولا قيمةَ افتراضيّةَ له**:
   * حدُّ الطلبات يفرض الهويّة، ونداءٌ بلا توقيعٍ يُرَدُّ `401` فيُقرأ في السجلِّ
   * «محرّكُ الطلبِ لا يجيب» لا «جذرُ التركيبِ نسيَ الموقّع».
   */
  readonly signOrdersRequest: ServiceRequestSigner;
  /**
   * موقّعُ النداءِ إلى حدِّ التوزيعِ (M1-04، الموجةُ الرابعة). **إلزاميٌّ ولا
   * قيمةَ افتراضيّةَ له** للسببِ نفسِه — وقد صارَ الاسمانِ صريحَينِ لكلِّ وجهةٍ
   * كما وُعِدَ في الموجةِ الثانيةِ، لأنّ **الجمهورَينِ مختلفانِ**: رمزٌ جمهورُه
   * `orders` يُرفَض عند التوزيعِ وبالعكس، وموقّعٌ واحدٌ لوجهتَينِ كانَ سيجعلُ
   * ذلكَ الرفضَ خطأً في التركيبِ لا يُرى إلّا في الإنتاجِ.
   */
  readonly signDispatchRequest: ServiceRequestSigner;
  readonly timeoutMs?: number;
}

export class HttpDispatchOfferPort implements DispatchOfferPort {
  private readonly dispatchBaseUrl: string;
  private readonly ordersBaseUrl: string;
  private readonly signOrdersRequest: ServiceRequestSigner;
  private readonly signDispatchRequest: ServiceRequestSigner;
  private readonly timeoutMs: number;

  constructor(options: HttpDispatchOfferOptions) {
    this.dispatchBaseUrl = options.dispatchBaseUrl.replace(/\/+$/, "");
    this.ordersBaseUrl = options.ordersBaseUrl.replace(/\/+$/, "");
    this.signOrdersRequest = options.signOrdersRequest;
    this.signDispatchRequest = options.signDispatchRequest;
    // ٢٠٠٠ms هي المهلة نفسها التي تستعملها بقيّة المنافذ الصادرة في المستودع
    // (`services/dispatch/src/infrastructure/http-order-engine.ts`). التوحيد مقصود:
    // مهلةٌ تختلف من محوّلٍ لآخر تجعل «الخدمة بطيئة» تظهر عطلاً في نصف المسارات فقط.
    this.timeoutMs = options.timeoutMs ?? 2000;
  }

  async describe(dispatchOfferId: string): Promise<DispatchOfferSnapshot | null> {
    // الربطُ هنا **كامل**: مُعرِّفُ العرضِ جزءٌ من المسارِ لا من سلسلةِ
    // الاستفسارِ، فرمزٌ وُقِّعَ لقراءةِ عرضٍ لا يصلحُ لقراءةِ غيرِه — بخلافِ
    // `/orders/lookup` أدناه (`RISK-0026`).
    const offerPath = DISPATCH_OFFER_PATH(dispatchOfferId);
    const offer = await this.readJson(
      `${this.dispatchBaseUrl}${offerPath}`,
      "عرض الإرسال",
      this.signDispatchRequest("GET", offerPath),
    );
    if (offer === null) return null;

    const driverPublicId = stringField(offer, "driver_public_id");
    const orderPublicId = stringField(offer, "order_public_id");
    const serviceKind = stringField(offer, "order_type");
    const standing = offer.standing;
    if (
      driverPublicId === null ||
      orderPublicId === null ||
      serviceKind === null ||
      !SERVICE_KINDS.has(serviceKind) ||
      typeof standing !== "boolean"
    ) {
      throw negotiationUnavailable("جواب التوزيع عن العرض لا يوافق العقد");
    }

    // ترتيبُ النداءين مقصود: لا نسأل محرّك الطلب عن طلبٍ حتى نعرف أنّ عرضاً يشير إليه.
    // الربطُ لا يشمل سلسلةَ الاستعلامِ (ADR-021 §4)، والمعرّفُ العامُّ هنا في
    // الاستعلامِ لا في المسارِ — فالتوقيعُ يربطُ `GET /orders/lookup` ولا يربطُ
    // **أيَّ** طلبٍ يُسأل عنه. هذا أوّلُ موضعٍ ماديٍّ لهذا الدَّينِ المُعلَنِ،
    // وهو مسجَّلٌ RISK-0026، ويُخفَّف اليومَ بعمرٍ قصيرٍ للرمزِ وحارسِ إعادةٍ.
    const order = await this.readJson(
      `${this.ordersBaseUrl}${ORDER_LOOKUP_PATH(orderPublicId)}`,
      "الطلب",
      this.signOrdersRequest("GET", "/orders/lookup"),
    );
    if (order === null) return null;

    const priceMode = stringField(order, "price_mode");
    if (priceMode === null) {
      throw negotiationUnavailable("جواب محرّك الطلب لا يحمل وضع السعر");
    }

    return {
      dispatchOfferId,
      orderPublicId,
      driverPublicId,
      serviceKind: serviceKind as NegotiationServiceKind,
      active: standing,
      negotiable: priceMode === NEGOTIABLE_PRICE_MODE,
    };
  }

  /**
   * قراءةٌ واحدة: جسمٌ عند `200`، و`null` عند `404`، ورميٌ في كل ما سواهما.
   *
   * `subject` يدخل نصّ الخطأ ليعرف المُشغّل **أيّ** نداءٍ من النداءين سقط: رسالةٌ واحدة
   * لكلٍّ منهما كانت ستجعل تشخيص العطل تخميناً بين خدمتين.
   */
  private async readJson(
    url: string,
    subject: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", ...extraHeaders },
        signal: controller.signal,
      });
    } catch (error) {
      const reason = (error as Error).name === "AbortError" ? "مهلة" : "انقطاع";
      throw negotiationUnavailable(`تعذّر قراءة ${subject} (${reason})`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw negotiationUnavailable(`تعذّر قراءة ${subject} (${response.status})`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw negotiationUnavailable(`جواب ${subject} ليس JSON`);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw negotiationUnavailable(`جواب ${subject} ليس كائناً`);
    }
    return body as Record<string, unknown>;
  }
}

function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
