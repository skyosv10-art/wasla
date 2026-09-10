/**
 * Idempotency + readiness unit tests (review 7/N · ADR-026 §4.10).
 *
 * The two mechanisms this review adds are both "invisible when correct": a
 * retry that changes nothing, and a route that answers 503 before traffic
 * arrives. Neither shows up in a manual click-through, so the guarantees are
 * asserted here as arithmetic:
 *
 *   - a fingerprint is stable across key order and unstable across values;
 *   - the same key on a different route or a different target is a REUSE;
 *   - a failure reason never carries the driver's message (it carries the DSN);
 *   - readiness is never green because nothing was measured.
 */

import { describe, expect, it } from "vitest";

import {
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENT_ROUTES,
  assertIdempotencyKey,
  canonicalJson,
  deriveRequestFingerprint,
} from "../domain/idempotency.js";
import { isDeliveryError } from "../domain/errors.js";
import { readinessFailureReason } from "../infrastructure/readiness-probe.js";
import { buildReadinessResponse } from "../http/readiness.js";

const PLACEMENT = IDEMPOTENT_ROUTES[0];
const CANCELLATION = IDEMPOTENT_ROUTES[1];

describe("idempotency key validation", () => {
  it("accepts a uuid v4 and a ULID — the generators clients actually have", () => {
    expect(assertIdempotencyKey("2f1c9c8e-4a1b-4f7d-9c3e-8b6d5a4f3e2d")).toBeTypeOf("string");
    expect(assertIdempotencyKey("01J8ZC4Q9T3RMF7YV2K5N6P8QA")).toBeTypeOf("string");
  });

  it("refuses a key shorter than 16 characters", () => {
    // A short key from a weak generator collides across clients, and a
    // collision here hands one client another client's order.
    expect(IDEMPOTENCY_KEY_PATTERN.test("abc123")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("0123456789abcde")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("0123456789abcdef")).toBe(true);
  });

  it("refuses a key longer than 128 characters", () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test("a".repeat(128))).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test("a".repeat(129))).toBe(false);
  });

  it("refuses whitespace, control characters, and non-ASCII", () => {
    for (const bad of ["key with spaces 12345", "key\twith\ttabs\t1234", "مفتاحٌ-عربيٌّ-طويلٌ-جدًّا", "-starts-with-dash1"]) {
      expect(IDEMPOTENCY_KEY_PATTERN.test(bad)).toBe(false);
    }
  });

  it("throws DELIVERY_VALIDATION_FAILED naming the header, not a body field", () => {
    try {
      assertIdempotencyKey(undefined);
      expect.unreachable("a missing header must not pass validation");
    } catch (error) {
      if (!isDeliveryError(error)) throw error;
      expect(error.code).toBe("DELIVERY_VALIDATION_FAILED");
      // The client must be told WHERE to fix it; "validation failed" alone
      // sends them hunting through the payload.
      expect(error.details?.field).toBe("Idempotency-Key");
    }
  });
});

describe("canonicalJson", () => {
  it("is independent of key insertion order at every depth", () => {
    const a = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } };
    const b = { a: { b: [3, { c: 5, d: 4 }], y: 2 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("keeps array order — [A, B] is not the same order as [B, A]", () => {
    // Item order is meaningful in a placement body; sorting arrays would make
    // two genuinely different requests share one fingerprint.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("refuses undefined fields instead of silently dropping them", () => {
    // `JSON.stringify({a: undefined})` is `{}`: two different requests would
    // hash identically and one would be replayed as the other.
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });

  it("refuses non-finite numbers and functions", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow();
  });
});

describe("deriveRequestFingerprint", () => {
  const body = { reason_code: "CUSTOMER_CHANGED_MIND" };

  it("is a lowercase sha256 hex digest", () => {
    expect(deriveRequestFingerprint(PLACEMENT, null, body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same route, target, and payload", () => {
    expect(deriveRequestFingerprint(CANCELLATION, "WS-0000000001", body)).toBe(
      deriveRequestFingerprint(CANCELLATION, "WS-0000000001", { ...body }),
    );
  });

  it("differs by route — one key cannot serve a placement and a cancellation", () => {
    expect(deriveRequestFingerprint(PLACEMENT, null, body)).not.toBe(
      deriveRequestFingerprint(CANCELLATION, null, body),
    );
  });

  it("differs by target — cancelling A then B with one key is a reuse", () => {
    // Both bodies are `{reason_code}`. Without the target in the hash, the
    // second call would replay A's response and leave B untouched.
    expect(deriveRequestFingerprint(CANCELLATION, "WS-0000000001", body)).not.toBe(
      deriveRequestFingerprint(CANCELLATION, "WS-0000000002", body),
    );
  });

  it("differs by payload value, however small the change", () => {
    expect(deriveRequestFingerprint(PLACEMENT, null, { quantity: 1 })).not.toBe(
      deriveRequestFingerprint(PLACEMENT, null, { quantity: 2 }),
    );
  });
});

describe("readinessFailureReason", () => {
  it("maps the pg codes that mean something operational", () => {
    expect(readinessFailureReason({ code: "57014" })).toBe("statement_timeout");
    expect(readinessFailureReason({ code: "42P01" })).toBe("schema_missing");
    expect(readinessFailureReason({ code: "28P01" })).toBe("authentication_failed");
    expect(readinessFailureReason({ code: "3D000" })).toBe("database_missing");
  });

  it("keeps an unknown pg code visible instead of flattening it to unreachable", () => {
    expect(readinessFailureReason({ code: "53300" })).toBe("pg_53300");
  });

  it("never leaks the driver's message — a connection error quotes the DSN", () => {
    const leaky = new Error("connect ECONNREFUSED postgresql://postgres:hunter2@db.example.co:5432");
    const reason = readinessFailureReason(leaky);
    expect(reason).toBe("unreachable");
    expect(reason).not.toContain("hunter2");
    expect(reason).not.toContain("db.example.co");
  });

  it("names a client-side timeout distinctly from a server-side one", () => {
    // `probe_timeout` (we gave up) and `statement_timeout` (Postgres gave up)
    // point at different causes: the network versus the query.
    expect(readinessFailureReason(new Error("readiness probe exceeded 1500ms"))).toBe("probe_timeout");
  });
});

describe("buildReadinessResponse", () => {
  it("is ready only when every performed check passed", () => {
    expect(buildReadinessResponse([{ name: "database", ok: true }], true).status).toBe("ready");
    expect(buildReadinessResponse([{ name: "database", ok: false }], true).status).toBe("unavailable");
  });

  it("is NOT ready when no check was performed", () => {
    // RISK-0030 in a helper: "nothing failed" must not be reachable by
    // measuring nothing.
    expect(buildReadinessResponse([], true).status).toBe("unavailable");
  });

  it("reports the unwired catalog in not_claimed rather than as a failed check", () => {
    const body = buildReadinessResponse([{ name: "database", ok: true }], false);
    // If the unwireable catalog (§4.9-2) counted as a check, readiness could
    // never be green and the deployment gate would be deleted within a week.
    expect(body.status).toBe("ready");
    expect(body.not_claimed).toEqual(["marketplace_catalog_not_wired"]);
  });
});
