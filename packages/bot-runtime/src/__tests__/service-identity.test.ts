/**
 * Ingress proof for M1-07: bot internal routes enforce service identity.
 *
 * The acceptance criterion is «service auth + ingress proof». This file is the
 * ingress proof — it exercises the three internal routes with raw `app.inject`
 * (no pre-signed harness wrapper) to prove the middleware bites on the wire:
 *
 *   1. Internal route with no token ⇒ 401
 *   2. Internal route with valid token but wrong scope ⇒ 403
 *   3. Internal route with valid token + correct scope ⇒ current behaviour
 *   4. Webhook works with its secret alone (no service token)
 *   5. /health is open
 *
 * The signed-harness tests in the other files prove the routes still work when
 * authenticated; this file proves they fail when not.
 */

import { describe, expect, it } from "vitest";

import { serviceAuthHeaders } from "@wasla/service-auth";

import { CHANNEL_SCOPES, CHANNEL_SERVICE_AUDIENCE } from "../http/service-identity.js";
import { authHeaders, createTestKeyRegistry, harnessFor, startUpdate } from "./harness.js";

/** A token signed for a different audience (not `channel`). */
function signForWrongAudience(method: string, url: string): Record<string, string> {
  const sep = url.indexOf("?");
  return serviceAuthHeaders({
    serviceName: "customer-bot",
    audience: "matching",
    method: method.toUpperCase(),
    path: sep < 0 ? url : url.slice(0, sep),
    keys: createTestKeyRegistry(),
    scopes: Object.values(CHANNEL_SCOPES),
    now: new Date(),
  });
}

/** A token signed with the right audience but a wrong scope. */
function signWithWrongScope(method: string, url: string): Record<string, string> {
  const sep = url.indexOf("?");
  return serviceAuthHeaders({
    serviceName: "customer-bot",
    audience: CHANNEL_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: sep < 0 ? url : url.slice(0, sep),
    keys: createTestKeyRegistry(),
    scopes: ["channel:nonexistent:scope"],
    now: new Date(),
  });
}

describe("M1-07 ingress proof", () => {
  describe("POST /channel/messages", () => {
    it("rejects a request with no service token (401)", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "POST",
        url: "/channel/messages",
        // No signed headers — raw inject, bypassing the harness wrapper.
        headers: {},
        payload: {
          channel: "telegram",
          chat_ref: "123",
          kind: "text",
          text: "test",
          idempotency_key: "key-12345678",
        },
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it("rejects a request with a valid token but wrong scope (403)", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "POST",
        url: "/channel/messages",
        headers: signWithWrongScope("POST", "/channel/messages"),
        payload: {
          channel: "telegram",
          chat_ref: "123",
          kind: "text",
          text: "test",
          idempotency_key: "key-12345678",
        },
      });
      expect(response.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("GET /channel/:bot/mini-app", () => {
    it("rejects a request with no service token (401)", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "GET",
        url: "/channel/customer/mini-app",
        headers: {},
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it("rejects a request with a valid token but wrong scope (403)", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "GET",
        url: "/channel/customer/mini-app",
        headers: signWithWrongScope("GET", "/channel/customer/mini-app"),
      });
      expect(response.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("POST /channel/:bot/deep-links", () => {
    it("rejects a request with no service token (401)", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "POST",
        url: "/channel/customer/deep-links",
        headers: {},
        payload: { action: "open_app" },
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it("rejects a request with a valid token but wrong scope (403)", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "POST",
        url: "/channel/customer/deep-links",
        headers: signWithWrongScope("POST", "/channel/customer/deep-links"),
        payload: { action: "open_app" },
      });
      expect(response.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("token signed for wrong audience is rejected (401)", () => {
    it("rejects a token whose aud is not `channel`", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "GET",
        url: "/channel/customer/mini-app",
        headers: signForWrongAudience("GET", "/channel/customer/mini-app"),
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("webhook stays protected by its secret (not service-auth)", () => {
    it("accepts a webhook call with the correct secret and no service token", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "POST",
        url: "/channel/customer/webhook",
        headers: authHeaders(),
        payload: startUpdate(1),
      });
      expect(response.statusCode).toBe(202);
      await app.close();
    });

    it("rejects a webhook call with the wrong secret", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "POST",
        url: "/channel/customer/webhook",
        headers: authHeaders("wrong-secret"),
        payload: startUpdate(2),
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("/health stays open", () => {
    it("returns 200 with no service token", async () => {
      const { app, rawInject } = harnessFor("customer");
      const response = await rawInject({
        method: "GET",
        url: "/health",
        headers: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("ok");
      await app.close();
    });
  });
});
