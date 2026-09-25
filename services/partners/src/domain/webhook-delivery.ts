/**
 * Webhook delivery engine — HMAC-SHA256 signed event delivery.
 *
 * (ADR-048 §4):
 * - Webhooks are event-driven via outbox, not polled.
 * - HMAC-SHA256 signature with `X-Wasla-Signature` header.
 * - Exponential backoff on failure (1s, 2s, 4s, 8s, 16s, max 5 attempts).
 * - Dead-letter after max retries.
 *
 * This module implements the delivery logic. The actual outbox consumer
 * and HTTP client are injected as ports for testability.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookPayload {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantStoreId: string;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface WebhookDeliveryResult {
  readonly webhookId: string;
  readonly success: boolean;
  readonly statusCode: number;
  readonly attempt: number;
  readonly error?: string;
}

export interface HttpClientPort {
  post(url: string, body: string, headers: Record<string, string>): Promise<{
    statusCode: number;
    ok: boolean;
    body?: string;
  }>;
}

export const MAX_DELIVERY_ATTEMPTS = 5;
export const INITIAL_BACKOFF_MS = 1000;

export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}

export function computeBackoff(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1), 30000);
}

export async function deliverWebhook(
  client: HttpClientPort,
  webhook: {
    webhookId: string;
    url: string;
    secretHash: string;
    eventTypes: readonly string[];
  },
  payload: WebhookPayload,
  secret: string,
  onAttempt?: (result: WebhookDeliveryResult) => Promise<void>,
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);
  const headers = {
    "Content-Type": "application/json",
    "X-Wasla-Signature": `sha256=${signature}`,
    "X-Wasla-Event-Id": payload.eventId,
    "X-Wasla-Event-Type": payload.eventType,
  };

  let lastResult: WebhookDeliveryResult | null = null;

  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    try {
      const response = await client.post(webhook.url, body, headers);
      const success = response.ok;
      lastResult = {
        webhookId: webhook.webhookId,
        success,
        statusCode: response.statusCode,
        attempt,
      };

      if (onAttempt) await onAttempt(lastResult);

      if (success) return lastResult;

      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        const backoff = computeBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    } catch (error) {
      lastResult = {
        webhookId: webhook.webhookId,
        success: false,
        statusCode: 0,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      };

      if (onAttempt) await onAttempt(lastResult);

      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        const backoff = computeBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  return lastResult!;
}
