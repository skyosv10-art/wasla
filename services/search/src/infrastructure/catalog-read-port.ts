/**
 * HttpCatalogReadPort — the SANCTIONED read port for catalog data
 * (GET /products/{productId}) per ADR-025 §2.3. Events carry no title/price
 * (ADR-016 decisions 4 & 10); the relay fetches them here when a product
 * becomes visible. The ProductResource returns sku + category_slug (not
 * fabricated ids), which the relay writes verbatim into the index.
 */

import type { CatalogReadPort } from "../ports.js";
import type { CatalogProduct } from "../domain/consumed-events.js";

export interface HttpCatalogReadPortOptions {
  /** Base URL of the marketplace service, e.g. http://localhost:8010. */
  readonly baseUrl: string;
  /** Optional fetch override (for tests / retries). */
  readonly fetchImpl?: typeof fetch;
}

export class HttpCatalogReadPort implements CatalogReadPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpCatalogReadPortOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/products/${productId}`, {
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`catalog read failed: ${productId} -> ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return {
      product_id: body.product_id as string,
      store_id: body.store_id as string,
      store_slug: body.store_slug as string,
      sku: body.sku as string,
      category_slug: body.category_slug as string,
      title_ar: body.title_ar as string,
      title_en: (body.title_en as string | null) ?? null,
      price_minor_units: body.price_minor_units as number,
      currency_code: "SAR",
    };
  }
}
