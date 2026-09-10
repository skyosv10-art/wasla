/**
 * HTTP adapter for `StoreOrderCatalogPort` — المراجعةُ 8/N، ورفعُ دَينِ
 * ADR-026 §4.9-2 بعدَ سبعِ مراجعاتٍ.
 *
 * ## العلّةُ التي أقفلتِ المسارَ، وكيف رُفِعت
 *
 * كانَ عقدُ هذه الخدمةِ يطلبُ مرجعَ متجرٍ بصيغةِ `WS-##########`، والسوقُ لا
 * يُصدِرُ شيئاً بهذه الصيغةِ للمتجرِ: يُعرِّفُ متجرَهُ بـ`store_id` (UUID داخليٌّ)
 * وينشُرُ `store_slug` في **كلِّ** مسارٍ عامٍّ. فكانَ كلُّ محوّلٍ يُكتَبُ سيبدأُ
 * باختراعِ مِعجمِ تحويلٍ لا يملأُهُ أحدٌ — ولذلك لم يُكتَبْ، وأُعلِنَ الدَّينُ.
 * والمراجعةُ 8/N تحسِمُ بالوجهةِ الصحيحةِ: **الخدمةُ تستعملُ المرجعَ الذي ينشرُهُ
 * مالكُ المجموعةِ** (§4.11)، فلا مِعجمَ ولا عمودَ يُملأُ بالنّيّةِ.
 *
 * ## ما يقرأُهُ هذا المحوّلُ، ومن أين
 *
 *   `GET /stores/{storeSlug}`     → StoreResource  (الحالةُ + `store_id`)
 *   `GET /products/{productId}`   → ProductResource (السعرُ + الحالةُ + المتجرُ)
 *
 * والأنواعُ مأخوذةٌ من `@wasla/contracts-marketplace` لا مُعادةَ الكتابةِ هنا:
 * حقلٌ يُحذَفُ أو يُعادُ تسميتُهُ في عقدِ السوقِ يُسقِطُ الترجمةَ في هذه الخدمةِ
 * وقتَ البناءِ، بدلَ أن يُسقِطَ طلباً في الإنتاجِ (ADR-004).
 *
 * ## الفرقُ الذي يجبُ أن يبقى: «لا متجرَ» ≠ «لا نعلمُ»
 *
 * `404` جوابٌ: المتجرُ/المنتجُ غيرُ موجودٍ ⇒ `null` أو سطرٌ غائبٌ، فيرفضُ
 * المجالُ الطلبَ رفضاً دائماً (400-class). وأيُّ شيءٍ آخرَ — انقطاعٌ، مَهَلٌ،
 * جسمٌ غيرُ مقروءٍ، `5xx`، رفضُ هويّةٍ — ليسَ جواباً، فيَصعدُ
 * `DELIVERY_MARKETPLACE_UNAVAILABLE` (503) ويقرِّرُ المنادي. خلطُ الاثنَينِ كانَ
 * سيَحوّلُ انقطاعاً عابراً إلى «متجرُكَ غيرُ موجودٍ» في وجهِ العميلِ.
 *
 * ## لماذا لا لقطةَ جزئيّةٌ أبداً
 *
 * لو فشلَ نداءُ منتجٍ واحدٍ وأعادَ المحوّلُ بقيّةَ اللقطاتِ، لَرفضَ المجالُ
 * السطرَ الغائبَ بـ«منتجٌ غيرُ معروفٍ» — خطأٌ دائمٌ عن عطلٍ عابرٍ. فأيُّ إخفاقٍ
 * في أيِّ نداءٍ يُسقِطُ الدفعةَ كلَّها إلى 503.
 *
 * ## ما لا يفعلُهُ هذا المحوّلُ (إعلانٌ لا إغفال)
 *
 *  - **لا يحجزُ مخزوناً.** يقرأُ `is_visible` (وهي تشملُ `quantity_on_hand > 0`)
 *    فيمنعُ طلبَ ما لا يُعرَضُ، لكنّ الحجزَ الذرّيَّ بينَ اللقطةِ والتنفيذِ ما
 *    زالَ مؤجَّلاً — بندُ ADR-026 §4 (بوّابةُ E2E) ووثيقةُ §4.11-4.
 *  - **لا يُعيدُ المحاولةَ.** المفتاحُ التماثُليُّ يجعلُ إعادةَ المنادي آمنةً
 *    (§4.10)، وحلقةُ إعادةٍ هنا كانت ستُحوّلُ عطلاً عابراً إلى 409.
 *  - **لا يقرأُ قوائمَ.** `GET /stores/{slug}/products` مُصفَّحٌ وقد يُخفي منتجاً
 *    خارجَ الصفحةِ الأولى، فيُقرأُ الغيابُ «لا منتجَ» كذباً.
 */

import type { ProductResource, StoreResource } from "@wasla/contracts-marketplace";
import type { ServiceRequestSigner } from "@wasla/service-auth";
import type { StoreSlug } from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import type { CatalogProductSnapshot, StoreOrderCatalogPort } from "../ports.js";

/** الصلاحيّاتُ التي يحتاجُها هذا العميلُ على حدِّ السوقِ، لا أكثر. */
export const DELIVERY_MARKETPLACE_SCOPES: readonly string[] = [
  "marketplace:store:read",
  "marketplace:product:read",
];

/**
 * أسبابُ التعذُّرِ — قائمةٌ **مغلقةٌ** تدخلُ `details.actual`.
 *
 * سلسلةٌ حرّةٌ كانت ستُسرِّبُ نصَّ استثناءٍ (وربّما عنواناً أو رمزاً) إلى جسمِ
 * الجوابِ، والفرقُ بين «رُفِضَتْ هويّتُنا» و«الحدُّ منقطعٌ» يهمُّ التشغيلَ:
 * الأولُ نقصُ إعدادٍ عندَنا، والثاني عطلٌ هناك.
 */
export const MARKETPLACE_FAILURE_REASONS = [
  "marketplace_unreachable",
  "marketplace_timeout",
  "marketplace_denied_identity",
  "marketplace_rejected_request",
  "marketplace_error_status",
  "marketplace_unreadable_body",
  "marketplace_contract_drift",
] as const;
export type MarketplaceFailureReason = (typeof MARKETPLACE_FAILURE_REASONS)[number];

export interface HttpMarketplaceCatalogOptions {
  /** Base URL of the marketplace service, e.g. http://marketplace:8090 */
  readonly baseUrl: string;
  /**
   * موقّعُ النداءِ الصادرِ — **إلزاميٌّ بلا قيمةٍ افتراضيّةٍ بقصدٍ** (ADR-020):
   * قيمةٌ افتراضيّةٌ «بلا توقيعٍ» كانت ستجعلُ نداءً يُنسى توقيعُهُ ينجحُ في كلِّ
   * اختبارٍ ويُرَدُّ 401 في الإنتاجِ وحدَه. وحدُّ السوقِ لا يفرضُ الهويّةَ اليومَ
   * (سجلُّ docs/07-security/SERVICE_AUTH_ENFORCEMENT.md)، والتوقيعُ صفةُ
   * المنادي لا رخصةٌ من المُنادى: نُوقِّعُ اليومَ فلا يبقى «سنُوقِّعُ لاحقاً».
   */
  readonly signRequest: ServiceRequestSigner;
  /** مَهَلُ كلِّ نداءٍ بالمللي ثانية (الافتراضُ 2000). */
  readonly timeoutMs?: number;
  /** أقصى نداءاتِ منتجاتٍ متوازيةٍ (الافتراضُ 4). */
  readonly maxConcurrency?: number;
  /** يُحقَنُ للاختبارِ فقط؛ الافتراضُ `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const storePath = (slug: string): string => `/stores/${encodeURIComponent(slug)}`;
const productPath = (productId: string): string => `/products/${encodeURIComponent(productId)}`;

function unavailable(reason: MarketplaceFailureReason, field: string): DeliveryError {
  return new DeliveryError(
    "DELIVERY_MARKETPLACE_UNAVAILABLE",
    "حدُّ السوقِ لا يُجيبُ الآنَ — تعذّرَ أخذُ لقطةِ الكتالوجِ",
    { details: { field, actual: reason } },
  );
}

export class HttpMarketplaceCatalogPort implements StoreOrderCatalogPort {
  private readonly baseUrl: string;
  private readonly signRequest: ServiceRequestSigner;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpMarketplaceCatalogOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signRequest = options.signRequest;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 2000;
    this.maxConcurrency =
      options.maxConcurrency && options.maxConcurrency > 0 ? options.maxConcurrency : 4;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getStoreBySlug(
    storeSlug: StoreSlug,
  ): Promise<{ storeId: string; orderable: boolean } | null> {
    const path = storePath(storeSlug);
    const body = await this.getJson<StoreResource>(path, "store_slug");
    if (body === null) return null;

    if (typeof body.store_id !== "string" || body.store_id.length === 0) {
      throw unavailable("marketplace_contract_drift", "store_slug");
    }
    // لو أجابَ الحدُّ بمتجرٍ آخرَ لَربَطنا الطلبَ بمتجرٍ لم يطلبْهُ العميلُ.
    if (body.store_slug !== storeSlug) {
      throw unavailable("marketplace_contract_drift", "store_slug");
    }

    /*
     * `orderable` = موافَقٌ عليه **و**مقفولُ الـslug.
     *
     * الشرطُ الثاني ليس تزيّداً: العمودُ في هذا الدفترِ يحفظُ الـslug نصّاً، فلو
     * قُبِلَ متجرٌ قابلُ التغييرِ لَصارَ الطلبُ المحفوظُ يشيرُ إلى اسمٍ قد يختفي.
     * وعقدُ السوقِ يقفلُ الـslug عندَ أوّلِ موافقةٍ، فالشرطانِ يتلازمانِ عندَه؛
     * وإن انفكّا يوماً فالجوابُ «لا يستقبلُ طلباتٍ» لا طلبٌ بمرجعٍ زائلٍ.
     */
    const orderable = body.state === "approved" && body.is_slug_locked === true;
    return { storeId: body.store_id, orderable };
  }

  async getProductSnapshots(
    storeId: string,
    productIds: readonly string[],
  ): Promise<readonly CatalogProductSnapshot[]> {
    // مُعرِّفٌ مكرَّرٌ في السلّةِ = نداءٌ واحدٌ: التكرارُ شأنُ المجالِ لا الشبكةِ.
    const unique = [...new Set(productIds)];
    const found = new Map<string, CatalogProductSnapshot>();

    for (let offset = 0; offset < unique.length; offset += this.maxConcurrency) {
      const batch = unique.slice(offset, offset + this.maxConcurrency);
      const results = await Promise.all(batch.map((id) => this.getProduct(storeId, id)));
      for (const snapshot of results) {
        if (snapshot !== null) found.set(snapshot.productId, snapshot);
      }
    }

    // الترتيبُ ترتيبُ الطلبِ: المجالُ يقارنُ سطراً بسطرٍ، وترتيبُ الشبكةِ لا شأنَ له.
    return unique.map((id) => found.get(id)).filter((s): s is CatalogProductSnapshot => s !== undefined);
  }

  private async getProduct(
    storeId: string,
    productId: string,
  ): Promise<CatalogProductSnapshot | null> {
    const body = await this.getJson<ProductResource>(productPath(productId), "items");
    if (body === null) return null;

    /*
     * منتجٌ من متجرٍ آخرَ يُقرأُ «غيرَ موجودٍ» في سياقِ **هذا** المتجرِ: لو
     * قُبِلَ، لَاستطاعَ منادٍ أن يبني طلباً من كتالوجِ متجرٍ ويُلحِقَهُ بآخرَ.
     */
    if (body.store_id !== storeId) return null;

    // غيرُ معروضٍ = لا يُطلَبُ. و`is_visible` مُشتقّةٌ عندَ السوقِ من الحالةِ
    // والاعتدالِ والمخزونِ، فقراءةُ الرأيِ الواحدِ أصدقُ من إعادةِ حسابِهِ هنا.
    if (body.is_visible !== true) return null;

    if (
      body.currency_code !== "SAR" ||
      !Number.isInteger(body.price_minor_units) ||
      body.price_minor_units <= 0 ||
      typeof body.sku !== "string" ||
      body.sku.length === 0
    ) {
      // سعرٌ غيرُ مقروءٍ ليسَ «لا منتجَ»: الصمتُ عنه كانَ سيرفضُ سطراً صالحاً
      // رفضاً دائماً، أو أسوأُ — يُمرِّرَ سعراً بعملةٍ أخرى.
      throw unavailable("marketplace_contract_drift", "items");
    }

    return {
      productId: body.product_id,
      sku: body.sku,
      unitPriceMinorUnits: body.price_minor_units,
    };
  }

  /** `null` ⇔ 404 فقط؛ وكلُّ ما ليسَ جواباً يَصعدُ 503. */
  private async getJson<T>(path: string, field: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        signal: controller.signal,
        // الرمزُ مربوطٌ بهذه الطريقةِ وهذا المسارِ (ADR-021 §4).
        headers: this.signRequest("GET", path),
      });
    } catch (error) {
      const aborted = (error as Error | undefined)?.name === "AbortError";
      throw unavailable(aborted ? "marketplace_timeout" : "marketplace_unreachable", field);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      // نقصُ إعدادٍ عندَنا لا عطلٌ هناك — والسببُ المغلقُ يفصلُهما في السجلِّ.
      throw unavailable("marketplace_denied_identity", field);
    }
    if (response.status === 400 || response.status === 422) {
      // طلبٌ رفضَهُ الحدُّ بعدَ أن أجزناهُ نحنُ: خللٌ في هذه الخدمةِ يجبُ أن
      // يُقرأَ في السجلِّ خللاً لا انقطاعاً، والمنادي لا يملكُ إلّا الانتظارَ.
      throw unavailable("marketplace_rejected_request", field);
    }
    if (response.status !== 200) {
      throw unavailable("marketplace_error_status", field);
    }

    try {
      const parsed: unknown = await response.json();
      if (parsed === null || typeof parsed !== "object") {
        throw unavailable("marketplace_unreadable_body", field);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      throw unavailable("marketplace_unreadable_body", field);
    }
  }
}
