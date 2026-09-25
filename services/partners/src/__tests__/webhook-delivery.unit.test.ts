/**
 * Unit tests for webhook delivery engine.
 *
 * Tests:
 * - Signature generation and verification (HMAC-SHA256)
 * - Exponential backoff computation
 * - Successful delivery (first attempt)
 * - Failed delivery with retries
 * - Max attempts → dead-letter
 * - Signature header format
 */

import { describe, it, expect, vi } from "vitest";
import {
  signPayload,
  verifySignature,
  computeBackoff,
  deliverWebhook,
  MAX_DELIVERY_ATTEMPTS,
  type HttpClientPort,
  type WebhookPayload,
} from "../domain/webhook-delivery";

describe("signPayload", () => {
  it("produces a deterministic HMAC-SHA256 hex signature", () => {
    const sig1 = signPayload('{"event":"test"}', "secret123");
    const sig2 = signPayload('{"event":"test"}', "secret123");
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signPayload('{"event":"test1"}', "secret123");
    const sig2 = signPayload('{"event":"test2"}', "secret123");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = signPayload('{"event":"test"}', "secret1");
    const sig2 = signPayload('{"event":"test"}', "secret2");
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  it("verifies a valid signature", () => {
    const payload = '{"event":"test"}';
    const secret = "secret123";
    const signature = signPayload(payload, secret);
    expect(verifySignature(payload, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const payload = '{"event":"test"}';
    const secret = "secret123";
    expect(verifySignature(payload, "invalid", secret)).toBe(false);
  });

  it("rejects signature with wrong secret", () => {
    const payload = '{"event":"test"}';
    const signature = signPayload(payload, "correct-secret");
    expect(verifySignature(payload, signature, "wrong-secret")).toBe(false);
  });
});

describe("computeBackoff", () => {
  it("returns exponential backoff: 1s, 2s, 4s, 8s, 16s", () => {
    expect(computeBackoff(1)).toBe(1000);
    expect(computeBackoff(2)).toBe(2000);
    expect(computeBackoff(3)).toBe(4000);
    expect(computeBackoff(4)).toBe(8000);
    expect(computeBackoff(5)).toBe(16000);
  });

  it("caps backoff at 30 seconds", () => {
    expect(computeBackoff(10)).toBe(30000);
  });
});

describe("deliverWebhook", () => {
  const mockClient: HttpClientPort = {
    async post() {
      return { statusCode: 200, ok: true };
    },
  };

  const webhook = {
    webhookId: "wh-1",
    url: "https://example.com/hook",
    secretHash: "hash",
    eventTypes: ["credential.issued"],
  };

  const payload: WebhookPayload = {
    eventId: "evt-1",
    eventType: "credential.issued",
    tenantStoreId: "store-1",
    timestamp: "2026-01-01T00:00:00Z",
    data: { credentialId: "cred-1" },
  };

  it("delivers successfully on first attempt", async () => {
    const result = await deliverWebhook(mockClient, webhook, payload, "secret123");
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.attempt).toBe(1);
  });

  it("retries on failure and succeeds on retry", async () => {
    let attempts = 0;
    const retryClient: HttpClientPort = {
      async post() {
        attempts++;
        if (attempts < 3) return { statusCode: 500, ok: false };
        return { statusCode: 200, ok: true };
      },
    };

    vi.useFakeTimers();
    const result = deliverWebhook(retryClient, webhook, payload, "secret123");

    // Advance through backoffs
    await vi.advanceTimersByTimeAsync(1000); // first backoff
    await vi.advanceTimersByTimeAsync(2000); // second backoff

    const final = await result;
    expect(final.success).toBe(true);
    expect(final.attempt).toBe(3);
    vi.useRealTimers();
  });

  it("dead-letters after max attempts", async () => {
    const failClient: HttpClientPort = {
      async post() {
        return { statusCode: 500, ok: false };
      },
    };

    vi.useFakeTimers();
    const result = deliverWebhook(failClient, webhook, payload, "secret123");

    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS - 1; i++) {
      await vi.advanceTimersByTimeAsync(30000);
    }

    const final = await result;
    expect(final.success).toBe(false);
    expect(final.attempt).toBe(MAX_DELIVERY_ATTEMPTS);
    vi.useRealTimers();
  });

  it("sends HMAC-SHA256 signature header", async () => {
    let capturedHeaders: Record<string, string> = {};
    const captureClient: HttpClientPort = {
      async post(_url, _body, headers) {
        capturedHeaders = headers;
        return { statusCode: 200, ok: true };
      },
    };

    await deliverWebhook(captureClient, webhook, payload, "secret123");
    expect(capturedHeaders["X-Wasla-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(capturedHeaders["X-Wasla-Event-Id"]).toBe("evt-1");
    expect(capturedHeaders["X-Wasla-Event-Type"]).toBe("credential.issued");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });
});
