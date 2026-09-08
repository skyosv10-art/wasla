/**
 * Domain → wire mapping for search results (ADR-025 §5).
 *
 * The domain `SearchPage` (domain/model.ts) and the contract `SearchPage`
 * (@wasla/contracts-search, from api.openapi.yml) carry the same fields, but
 * they are SEPARATE types: the domain is the service's own model, the contract
 * is the public wire shape. Mapping them explicitly (rather than `as`-casting)
 * means a field added to one but not the other is a typecheck failure, not a
 * silent shape drift — the same discipline the marketplace service follows.
 */

import type { components } from "@wasla/contracts-search";
import type { SearchPage as DomainSearchPage } from "../domain/model.js";

type ContractSearchPage = components["schemas"]["SearchPage"];
type ContractProductResult = components["schemas"]["ProductSearchResult"];

export function toProductSearchResult(
  result: DomainSearchPage["items"][number],
): ContractProductResult {
  return {
    product_id: result.product_id,
    store_id: result.store_id,
    store_slug: result.store_slug,
    sku: result.sku,
    title_ar: result.title_ar,
    title_en: result.title_en,
    price_minor_units: result.price_minor_units,
    currency_code: result.currency_code,
    category_slug: result.category_slug,
    score: result.score,
  };
}

export function toSearchPage(page: DomainSearchPage): ContractSearchPage {
  return {
    items: page.items.map(toProductSearchResult),
    page: page.page,
    page_size: page.page_size,
    total: page.total,
  };
}
