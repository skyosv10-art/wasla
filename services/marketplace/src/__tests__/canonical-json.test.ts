/**
 * RISK-0013 (CLM-0417): the reply serializer is canonical and agrees with
 * `JSON.stringify` on everything except key order.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../app/idempotency.js";
import { createSignedMarketplaceApp } from "./service-identity-support.js";

describe("canonicalJson", () => {
  it("sorts keys at every depth — two insertion orders give one text", () => {
    const a = { state: "approved", store_id: "s", nested: { z: 1, a: [{ y: 2, b: 3 }] } };
    const b = { nested: { a: [{ b: 3, y: 2 }], z: 1 }, store_id: "s", state: "approved" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"nested":{"a":[{"b":3,"y":2}],"z":1},"state":"approved","store_id":"s"}');
  });

  it("means what JSON.stringify means: toJSON, undefined, non-finite, arrays", () => {
    const v = { d: new Date("2026-09-30T00:00:00.000Z"), u: undefined, n: Number.NaN, arr: [undefined, 1], s: "ع\"x" };
    expect(JSON.parse(canonicalJson(v))).toEqual(JSON.parse(JSON.stringify(v)));
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(null)).toBe("null");
  });

  it("is the service's reply serializer (health reply comes back key-sorted)", async () => {
    const app = createSignedMarketplaceApp({ mode: "memory" });
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      const keys = Object.keys(JSON.parse(res.body) as Record<string, unknown>);
      expect(keys).toEqual([...keys].sort());
      expect(res.body).toBe(canonicalJson(JSON.parse(res.body)));
    } finally {
      await app.close();
    }
  });
});
