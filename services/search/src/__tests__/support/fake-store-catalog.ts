/**
 * Test double for the signed store read port (G-S9.7 · ADR-025 §6.2).
 * Returns names only for stores explicitly set; anything else is a 404 (null),
 * which the relay turns into a pending event — never a silent fabricated name.
 */
import type { CatalogStore, StoreCatalogReadPort } from "../../ports.js";

export class FakeStoreCatalog implements StoreCatalogReadPort {
  private readonly data = new Map<string, CatalogStore>();
  readonly calls: string[] = [];
  failNext = 0;

  set(store: CatalogStore): this {
    this.data.set(store.store_slug, store);
    return this;
  }

  async getStore(storeSlug: string): Promise<CatalogStore | null> {
    this.calls.push(storeSlug);
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("marketplace unreachable (fake)");
    }
    return this.data.get(storeSlug) ?? null;
  }
}

/** The "acme" store every legacy relay fixture approves. */
export function acmeStoreCatalog(storeId = "11111111-1111-1111-1111-111111111111"): FakeStoreCatalog {
  return new FakeStoreCatalog().set({
    store_id: storeId,
    store_slug: "acme",
    title_ar: "متجر أكمي",
    title_en: "Acme Store",
    title_ur: null,
  });
}
