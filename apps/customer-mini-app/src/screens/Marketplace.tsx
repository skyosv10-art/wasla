import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

interface Store {
  store_id: string;
  slug: string;
  display_name: string;
  description?: string;
  category_id?: string;
}

interface Product {
  product_id: string;
  store_slug: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  status: string;
}

export function Marketplace() {
  const { t } = useTranslation();
  const { token } = useSessionStore();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadStores = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<{ items: Store[]; limit: number }>("/stores");
      setStores(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadProducts = useCallback(async (slug: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<{ items: Product[]; limit: number }>(`/stores/${slug}/products`);
      setProducts(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadStores();
  }, [loadStores]);

  const handleStoreClick = useCallback((slug: string) => {
    setSelectedStore(slug);
    setProducts([]);
    loadProducts(slug);
  }, [loadProducts]);

  const handleBack = useCallback(() => {
    setSelectedStore(null);
    setProducts([]);
  }, []);

  if (loading && stores.length === 0 && !selectedStore) {
    return (
      <div className="screen marketplace-screen">
        <h1>{t("marketplace.title")}</h1>
        <div className="loading-indicator" data-testid="marketplace-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (error && stores.length === 0) {
    return (
      <div className="screen marketplace-screen">
        <h1>{t("marketplace.title")}</h1>
        <div className="error-message" role="alert" data-testid="marketplace-error">
          {t(`errors.${error}`)}
        </div>
        <button type="button" onClick={loadStores} data-testid="marketplace-retry">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="screen marketplace-screen">
      <h1>{t("marketplace.title")}</h1>

      {selectedStore ? (
        <div data-testid="store-products-view">
          <button type="button" onClick={handleBack} data-testid="back-to-stores">
            {t("marketplace.back_to_stores")}
          </button>
          <h2 data-testid="selected-store-name">{selectedStore}</h2>

          {loading && (
            <div className="loading-indicator" data-testid="products-loading">
              {t("common.loading")}
            </div>
          )}

          {error && (
            <div className="error-message" role="alert" data-testid="products-error">
              {t(`errors.${error}`)}
            </div>
          )}

          {!loading && !error && products.length === 0 && (
            <div className="empty-state" data-testid="products-empty">
              {t("marketplace.no_products")}
            </div>
          )}

          {!loading && products.length > 0 && (
            <ul className="products-list" data-testid="products-list">
              {products.map((product) => (
                <li key={product.product_id} className="product-item" data-testid={`product-${product.product_id}`}>
                  <span className="product-name">{product.name}</span>
                  <span className="product-price">{product.price} {product.currency}</span>
                  <span className="product-status">{product.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {stores.length === 0 && !loading && (
            <div className="empty-state" data-testid="stores-empty">
              {t("marketplace.no_stores")}
            </div>
          )}

          {stores.length > 0 && (
            <ul className="stores-list" data-testid="stores-list">
              {stores.map((store) => (
                <li
                  key={store.store_id}
                  className="store-item"
                  data-testid={`store-${store.slug}`}
                  onClick={() => handleStoreClick(store.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleStoreClick(store.slug);
                  }}
                >
                  <span className="store-name">{store.display_name}</span>
                  {store.description && (
                    <span className="store-description">{store.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
