/**
 * HttpMarketplaceCatalogReadPort — the SANCTIONED, SIGNED read port from
 * search to marketplace (ADR-025 §2.3 · §6.2 · CLM-0649).
 *
 *  - `GET /products/{productId}` — the catalog datum (title/price/sku/category)
 *    the relay needs when a product becomes visible (events carry no title or
 *    price — ADR-016 decisions 4 & 10).
 *  - `GET /stores/{storeSlug}` — the store's names (ar/en/ur) when a store is
 *    approved (G-S9.7). Only `store_id`, `store_slug` and the three titles are
 *    read; owner, review history, staff and timestamps never enter search.
 *
 * Both marketplace routes are guarded (`scoped(productRead)` /
 * `scoped(storeRead)`) and marketplace is `enforced` for service identity, so
 * every call carries a token from `@wasla/service-auth` bound to this method
 * and path (ADR-021 §4). The predecessor (`catalog-read-port.ts`) sent no
 * identity at all and was invisible to the coverage guard (it called
 * `this.fetchImpl(`, not `fetch(`); under enforcement every product fetch
 * would have been a 401 that left the event pending forever (G-S9.19).
 *
 * Failure semantics are the relay's: `null` only on 404; any other non-200,
 * network error, timeout or contract drift THROWS, so the event stays pending
 * and the projection is not mutated (retry-safety, ADR-025 §2.3).
 */

import { createServiceRequestSigner, type ServiceAuthKeyRegistry, type ServiceRequestSigner } from "@wasla/service-auth";

import type { CatalogReadPort, CatalogStore, StoreCatalogReadPort } from "../ports.js";
import type { CatalogProduct } from "../domain/consumed-events.js";

/** Exactly the scopes this client needs on marketplace — no more. */
export const SEARCH_MARKETPLACE_SCOPES: readonly string[] = [
  "marketplace:product:read",
  "marketplace:store:read",
];

export interface HttpMarketplaceCatalogOptions {
  /** Base URL of the marketplace service, e.g. http://marketplace:8090 */
  readonly baseUrl: string;
  /** Signer from `createServiceRequestSigner({ serviceName: "search", audience: "marketplace", scopes: SEARCH_MARKETPLACE_SCOPES, … })`. */
  readonly signRequest: ServiceRequestSigner;
  readonly timeoutMs?: number;
  /** Injected for tests only; defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class MarketplaceCatalogError extends Error {
  constructor(
    readonly reason:
      | "marketplace_unreachable"
      | "marketplace_timeout"
      | "marketplace_denied_identity"
      | "marketplace_error_status"
      | "marketplace_unreadable_body"
      | "marketplace_contract_drift",
    readonly path: string,
  ) {
    super(`marketplace catalog read failed (${reason}): ${path}`);
    this.name = "MarketplaceCatalogError";
  }
}

const nullableString = (v: unknown): v is string | null | undefined =>
  v === null || v === undefined || typeof v === "string";

export class HttpMarketplaceCatalogReadPort implements CatalogReadPort, StoreCatalogReadPort {
  private readonly baseUrl: string;
  private readonly signRequest: ServiceRequestSigner;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpMarketplaceCatalogOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signRequest = options.signRequest;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    const path = `/products/${encodeURIComponent(productId)}`;
    const body = await this.getJson(path);
    if (body === null) return null;
    const ok =
      typeof body.product_id === "string" &&
      typeof body.store_id === "string" &&
      typeof body.store_slug === "string" &&
      typeof body.sku === "string" &&
      typeof body.category_slug === "string" &&
      typeof body.title_ar === "string" &&
      nullableString(body.title_en) &&
      typeof body.price_minor_units === "number" &&
      Number.isInteger(body.price_minor_units);
    if (!ok) throw new MarketplaceCatalogError("marketplace_contract_drift", path);
    return {
      product_id: body.product_id as string,
      store_id: body.store_id as string,
      store_slug: body.store_slug as string,
      sku: body.sku as string,
      category_slug: body.category_slug as string,
      title_ar: body.title_ar as string,
      title_en: (body.title_en as string | null | undefined) ?? null,
      price_minor_units: body.price_minor_units as number,
      currency_code: "SAR",
    };
  }

  async getStore(storeSlug: string): Promise<CatalogStore | null> {
    const path = `/stores/${encodeURIComponent(storeSlug)}`;
    const body = await this.getJson(path);
    if (body === null) return null;
    const ok =
      typeof body.store_id === "string" &&
      typeof body.store_slug === "string" &&
      typeof body.title_ar === "string" &&
      body.title_ar.trim().length > 0 &&
      nullableString(body.title_en) &&
      nullableString(body.title_ur);
    if (!ok) throw new MarketplaceCatalogError("marketplace_contract_drift", path);
    // Read only the names — nothing else from StoreResource crosses into search.
    return {
      store_id: body.store_id as string,
      store_slug: body.store_slug as string,
      title_ar: body.title_ar as string,
      title_en: (body.title_en as string | null | undefined) ?? null,
      title_ur: (body.title_ur as string | null | undefined) ?? null,
    };
  }

  /** `null` ⇔ 404 only; everything else that is not a 200 object throws. */
  private async getJson(path: string): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        signal: controller.signal,
        // The token is bound to this method and this path (ADR-021 §4).
        headers: { accept: "application/json", ...this.signRequest("GET", path) },
      });
    } catch (error) {
      const aborted = (error as Error | undefined)?.name === "AbortError";
      throw new MarketplaceCatalogError(aborted ? "marketplace_timeout" : "marketplace_unreachable", path);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw new MarketplaceCatalogError("marketplace_denied_identity", path);
    }
    if (response.status !== 200) throw new MarketplaceCatalogError("marketplace_error_status", path);
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new MarketplaceCatalogError("marketplace_unreadable_body", path);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MarketplaceCatalogError("marketplace_unreadable_body", path);
    }
    return parsed as Record<string, unknown>;
  }
}

/**
 * The production composition of this port: identity `search`, audience
 * `marketplace`, exactly `SEARCH_MARKETPLACE_SCOPES` (PRODUCTION_GRANTS[search]).
 * The caller passes the base URL and the key registry it already loaded — this
 * module reads no environment (the reader belongs to the relay worker's root,
 * which does not exist yet: CLM-0649 records that the relay runs in tests and in
 * `packages/search-e2e` only, so nothing is deployed).
 */
export function composeMarketplaceCatalogReadPort(options: {
  readonly baseUrl: string;
  readonly keys: ServiceAuthKeyRegistry;
  readonly fetchImpl?: typeof fetch;
}): HttpMarketplaceCatalogReadPort {
  return new HttpMarketplaceCatalogReadPort({
    baseUrl: options.baseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    signRequest: createServiceRequestSigner({
      serviceName: "search",
      audience: "marketplace",
      keys: options.keys,
      scopes: SEARCH_MARKETPLACE_SCOPES,
    }),
  });
}
