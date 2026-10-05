/**
 * ADR-060 P2 (CLM-0474): user assertion ownership on delivery store-order routes.
 *
 * Tests the three modes for D1 and D3:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched `customer_ref` returns 404.
 *
 * D1: `POST /store-orders` — `customer_ref` in body must match `endUser.publicId`.
 * D3: `POST /store-orders/:orderPublicId/cancellation` — `order.customerRef` must match `endUser.publicId`.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { InjectOptions, LightMyRequestResponse } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
  userAssertionPublicKeysFromEnv,
  USER_ASSERTION_HEADER,
  type UserAssertionPublicKeys,
} from "@wasla/service-auth";
import {
  userAssertionSigningKey,
  mintUserAssertion,
  type UserAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";

import { buildDeliveryHttpApp, type DeliveryHttpDeps } from "../http/app.js";
import { DELIVERY_SCOPES, DELIVERY_SERVICE_AUDIENCE } from "../http/service-identity.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  PRODUCT_A,
  STORE_SLUG,
  uuidSequence,
} from "./store-order-fakes.js";

const TEST_SERVICE_SECRET = "delivery-test-secret-0123456789abc";
const TEST_ACTIVE_KID = "test-active";
const ALL_SCOPES = Object.values(DELIVERY_SCOPES);
const OTHER_CUSTOMER = "WS-0000000099" as typeof CUSTOMER_REF;

const NOW = "2026-10-05T18:00:00.000Z";

let idempotencyCounter = 0;
function idempotencyKey(): string {
  idempotencyCounter += 1;
  return `asserted-test-key-${String(idempotencyCounter).padStart(6, "0")}`;
}

function createTestKeyRegistry(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret: TEST_SERVICE_SECRET, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

function generateTestKeys(): { signingKey: UserAssertionSigningKey; publicKeys: UserAssertionPublicKeys } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingKey = userAssertionSigningKey("ua-test", privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const publicKeys = userAssertionPublicKeysFromEnv({
    WASLA_USER_ASSERTION_PUBLIC_KEYS: JSON.stringify({ "ua-test": spki }),
  });
  return { signingKey, publicKeys };
}

function buildDeps(): Omit<DeliveryHttpDeps, "serviceIdentity" | "userAssertion"> {
  const store = new FakeStoreOrderStore();
  return {
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    readinessProbe: new FakeReadinessProbe(),
    newUuid: uuidSequence(),
    now: () => NOW,
  };
}

interface AssertedHarness {
  readonly app: ReturnType<typeof buildDeliveryHttpApp>;
  readonly keys: ServiceAuthKeyRegistry;
  readonly signingKey: UserAssertionSigningKey;
  readonly store: FakeStoreOrderStore;
}

function buildAssertedApp(mode: "off" | "observe" | "enforce"): AssertedHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const { signingKey, publicKeys } = generateTestKeys();
  const deps = buildDeps();

  const app = buildDeliveryHttpApp({
    ...deps,
    serviceIdentity: { keys, replayGuard },
    userAssertion: { mode, publicKeys },
  });

  return { app, keys, signingKey, store: deps.writePort as FakeStoreOrderStore };
}

function signedRequest(
  harness: AssertedHarness,
  method: string,
  url: string,
  options: {
    obo?: string;
    assertion?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): InjectOptions {
  const headers = serviceAuthHeaders({
    serviceName: "customer-bot",
    audience: DELIVERY_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: url,
    keys: harness.keys,
    now: new Date(),
    scopes: ALL_SCOPES,
    ...(options.obo !== undefined ? { onBehalfOfPublicId: options.obo } : {}),
  });

  const result: InjectOptions = {
    method: method as InjectOptions["method"],
    url,
    headers: {
      ...headers,
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      ...(options.assertion ? { [USER_ASSERTION_HEADER]: options.assertion } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
  };

  if (options.body !== undefined) {
    result.payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return result;
}

function mintAssertion(harness: AssertedHarness, publicId: string): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act: "customer",
    chn: "telegram",
    via: "customer-bot",
    aud: ["delivery"],
    now: new Date(),
  }).assertion;
}

function placementBody(customerRef: string = CUSTOMER_REF): Record<string, unknown> {
  return {
    customer_ref: customerRef,
    store_slug: STORE_SLUG,
    items: [{ product_id: PRODUCT_A, quantity: 1 }],
    delivery_fee_minor_units: 500,
  };
}

describe("Delivery ADR-060 P2 (CLM-0474): user assertion ownership", () => {
  describe("D1 — POST /store-orders", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      const res = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(),
        idempotencyKey: idempotencyKey(),
      }));
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });

    it("enforce mode: matching customer_ref creates order", async () => {
      const h = buildAssertedApp("enforce");
      const res = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: CUSTOMER_REF,
        assertion: mintAssertion(h, CUSTOMER_REF),
        idempotencyKey: idempotencyKey(),
      }));
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });

    it("enforce mode: mismatched customer_ref returns 404", async () => {
      const h = buildAssertedApp("enforce");
      // Customer A creates an order with their own ref
      await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: CUSTOMER_REF,
        assertion: mintAssertion(h, CUSTOMER_REF),
        idempotencyKey: idempotencyKey(),
      }));
      // Customer B tries to create an order with Customer A's ref
      const res = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: OTHER_CUSTOMER,
        assertion: mintAssertion(h, OTHER_CUSTOMER),
        idempotencyKey: idempotencyKey(),
      }));
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched customer_ref still succeeds (would_reject logged)", async () => {
      const h = buildAssertedApp("observe");
      const res = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: OTHER_CUSTOMER,
        assertion: mintAssertion(h, OTHER_CUSTOMER),
        idempotencyKey: idempotencyKey(),
      }));
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });
  });

  describe("D3 — POST /store-orders/:orderPublicId/cancellation", () => {
    it("enforce mode: matching customer cancels own order", async () => {
      const h = buildAssertedApp("enforce");
      // Create an order first
      const createRes = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: CUSTOMER_REF,
        assertion: mintAssertion(h, CUSTOMER_REF),
        idempotencyKey: idempotencyKey(),
      }));
      expect(createRes.statusCode).toBe(201);
      const orderPublicId = createRes.json().public_id as string;

      // Cancel the order
      const cancelRes = await h.app.fastify.inject(signedRequest(h, "POST", `/store-orders/${orderPublicId}/cancellation`, {
        body: { reason_code: "CUSTOMER_CHANGED_MIND" },
        obo: CUSTOMER_REF,
        assertion: mintAssertion(h, CUSTOMER_REF),
        idempotencyKey: idempotencyKey(),
      }));
      expect(cancelRes.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: mismatched customer gets 404 on cancellation", async () => {
      const h = buildAssertedApp("enforce");
      // Create an order as Customer A
      const createRes = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: CUSTOMER_REF,
        assertion: mintAssertion(h, CUSTOMER_REF),
        idempotencyKey: idempotencyKey(),
      }));
      expect(createRes.statusCode).toBe(201);
      const orderPublicId = createRes.json().public_id as string;

      // Customer B tries to cancel Customer A's order
      const cancelRes = await h.app.fastify.inject(signedRequest(h, "POST", `/store-orders/${orderPublicId}/cancellation`, {
        body: { reason_code: "CUSTOMER_CHANGED_MIND" },
        obo: OTHER_CUSTOMER,
        assertion: mintAssertion(h, OTHER_CUSTOMER),
        idempotencyKey: idempotencyKey(),
      }));
      expect(cancelRes.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched customer still succeeds (would_reject logged)", async () => {
      const h = buildAssertedApp("observe");
      // Create an order as Customer A
      const createRes = await h.app.fastify.inject(signedRequest(h, "POST", "/store-orders", {
        body: placementBody(CUSTOMER_REF),
        obo: CUSTOMER_REF,
        assertion: mintAssertion(h, CUSTOMER_REF),
        idempotencyKey: idempotencyKey(),
      }));
      expect(createRes.statusCode).toBe(201);
      const orderPublicId = createRes.json().public_id as string;

      // Customer B tries to cancel — observe mode logs but doesn't reject
      const cancelRes = await h.app.fastify.inject(signedRequest(h, "POST", `/store-orders/${orderPublicId}/cancellation`, {
        body: { reason_code: "CUSTOMER_CHANGED_MIND" },
        obo: OTHER_CUSTOMER,
        assertion: mintAssertion(h, OTHER_CUSTOMER),
        idempotencyKey: idempotencyKey(),
      }));
      expect(cancelRes.statusCode).toBe(200);
      await h.app.close();
    });
  });
});
