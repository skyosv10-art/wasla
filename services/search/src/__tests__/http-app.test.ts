/**
 * Unit tests for the search HTTP app (ADR-025 §5).
 *
 * No DB — the app depends on an injected `SearchProductsReadPort`, so a fake
 * port stands in for the real `SearchIndexReader`. These tests pin the HTTP
 * contract: status codes, the flat `{ code, message, trace_id }` error shape, and
 * the single-error-handler translation (no 500 ever returned).
 */

import { describe, expect, it } from "vitest";

import {
  buildEnforcedApp,
  inject,
  type buildEnforcedApp as _buildEnforcedApp,
} from "./service-identity-support.js";
import type {
  SearchIndexHealth,
  SearchIndexHealthPort,
  SearchProductsQuery,
  SearchProductsReadPort,
} from "../ports.js";
import type { SearchPage } from "../domain/model.js";
import { SearchUnavailableError } from "../http/errors.js";

/** A controllable fake read port: returns a canned page, or throws on demand. */
function fakeReadPort(
  behavior: {
    page?: SearchPage;
    throw?: SearchUnavailableError;
    captureQuery?: (q: SearchProductsQuery) => void;
  } = {},
): SearchProductsReadPort {
  return {
    async search(query: SearchProductsQuery): Promise<SearchPage> {
      behavior.captureQuery?.(query);
      if (behavior.throw) throw behavior.throw;
      return (
        behavior.page ?? {
          items: [],
          page: query.page,
          page_size: query.pageSize,
          total: 0,
        }
      );
    },
  };
}

/** A fake readiness probe: reports exactly the state the test declares. */
function fakeHealthPort(health: SearchIndexHealth): SearchIndexHealthPort {
  return {
    async probe(): Promise<SearchIndexHealth> {
      return health;
    },
  };
}

function samplePage(): SearchPage {
  return {
    items: [
      {
        product_id: "p-1",
        store_id: "s-1",
        store_slug: "acme",
        sku: "SKU-1",
        title_ar: "سماعة",
        title_en: "Headphones",
        price_minor_units: 15000,
        currency_code: "SAR",
        category_slug: "electronics",
        score: 1.0,
      },
    ],
    page: 1,
    page_size: 20,
    total: 1,
  };
}

describe("search HTTP app", () => {
  it("GET /search/health returns 200 {status:'ok'}", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
    });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    } finally {
      await close();
    }
  });

  /*
   * Readiness (RISK-0030). The bug these tests pin: with a degraded index the
   * service answered `health: ok` while every search returned 503. So the
   * assertions below are deliberately PAIRED — each readiness state is checked
   * together with liveness, because the defect was the two answers agreeing when
   * they should have disagreed.
   */
  it("GET /search/ready returns 200 {status:'ready'} when the probe reaches the index", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
      indexHealthPort: fakeHealthPort({
        index_reachable: true,
        indexed_documents: 42,
      }),
    });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/ready" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        status: "ready",
        index_reachable: true,
        indexed_documents: 42,
      });
    } finally {
      await close();
    }
  });

  it("GET /search/ready returns 503 SEARCH_INDEX_DEGRADED while /search/health stays 200", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort({
        throw: new SearchUnavailableError("SEARCH_INDEX_DEGRADED", "degraded"),
      }),
      indexHealthPort: fakeHealthPort({
        index_reachable: false,
        indexed_documents: null,
      }),
    });
    try {
      const ready = await inject(fastify, { method: "GET", url: "/search/ready" });
      expect(ready.statusCode).toBe(503);
      expect(ready.json().code).toBe("SEARCH_INDEX_DEGRADED");

      // Liveness must NOT follow readiness: the process is alive and must not
      // be restarted just because its read model is unreachable.
      const health = await inject(fastify, {
        method: "GET",
        url: "/search/health",
      });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok" });
    } finally {
      await close();
    }
  });

  it("GET /search/ready returns 503 when no probe is wired (never ready by default)", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
    });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("SEARCH_INDEX_DEGRADED");
    } finally {
      await close();
    }
  });

  it("an empty index is READY, not degraded (cold start must not deadlock)", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
      indexHealthPort: fakeHealthPort({
        index_reachable: true,
        indexed_documents: 0,
      }),
    });
    try {
      const res = await inject(fastify, { method: "GET", url: "/search/ready" });
      expect(res.statusCode).toBe(200);
      expect(res.json().indexed_documents).toBe(0);
    } finally {
      await close();
    }
  });

  it("GET /search/products returns 200 with a mapped page", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort({ page: samplePage() }),
    });
    try {
      const res = await inject(fastify, {
        method: "GET",
        url: "/search/products",
        query: {
          q: "سماعة",
          locale: "en",
          page: "1",
          page_size: "20",
          sort: "relevance",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({
        items: [
          {
            product_id: "p-1",
            store_id: "s-1",
            store_slug: "acme",
            sku: "SKU-1",
            title_ar: "سماعة",
            title_en: "Headphones",
            price_minor_units: 15000,
            currency_code: "SAR",
            category_slug: "electronics",
            score: 1.0,
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
      });
    } finally {
      await close();
    }
  });

  it("passes parsed query params to the read port", async () => {
    let captured: SearchProductsQuery | null = null;
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort({
        page: samplePage(),
        captureQuery: (q) => {
          captured = q;
        },
      }),
    });
    try {
      await inject(fastify, {
        method: "GET",
        url: "/search/products",
        query: {
          q: "سماعة",
          category_slug: "electronics",
          page: "2",
          page_size: "10",
          sort: "price_desc",
        },
      });
      expect(captured).not.toBeNull();
      expect(captured).toMatchObject({
        q: "سماعة",
        locale: "ar",
        categorySlug: "electronics",
        page: 2,
        pageSize: 10,
        sort: "price_desc",
      });
    } finally {
      await close();
    }
  });

  it("returns 400 with the flat error shape for an empty query", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
    });
    try {
      const res = await inject(fastify, {
        method: "GET",
        url: "/search/products?q=",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("SEARCH_QUERY_EMPTY");
      expect(typeof body.message).toBe("string");
      expect(typeof body.trace_id).toBe("string");
    } finally {
      await close();
    }
  });

  it("returns 400 for repeated query keys (array value)", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
    });
    try {
      const res = await inject(fastify, {
        method: "GET",
        url: "/search/products",
        query: { q: ["a", "b"] },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await close();
    }
  });

  it("returns 400 for an unknown sort", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort(),
    });
    try {
      const res = await inject(fastify, {
        method: "GET",
        url: "/search/products?q=x&sort=popular",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("SEARCH_SORT_INVALID");
    } finally {
      await close();
    }
  });

  it("returns 503 with SEARCH_INDEX_DEGRADED when the read port is unavailable", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: fakeReadPort({
        throw: new SearchUnavailableError(
          "SEARCH_INDEX_DEGRADED",
          "الفهرس غير متاح",
        ),
      }),
    });
    try {
      const res = await inject(fastify, {
        method: "GET",
        url: "/search/products?q=سماعة",
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.code).toBe("SEARCH_INDEX_DEGRADED");
      expect(body.message).toBe("الفهرس غير متاح");
      expect(typeof body.trace_id).toBe("string");
    } finally {
      await close();
    }
  });

  it("never returns 500 — an unexpected error becomes 503 SEARCH_INTERNAL_ERROR", async () => {
    const { fastify, close } = buildEnforcedApp({
      searchReadPort: {
        async search() {
          throw new Error("boom");
        },
      },
    });
    try {
      const res = await inject(fastify, {
        method: "GET",
        url: "/search/products?q=سماعة",
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("SEARCH_INTERNAL_ERROR");
    } finally {
      await close();
    }
  });
});
