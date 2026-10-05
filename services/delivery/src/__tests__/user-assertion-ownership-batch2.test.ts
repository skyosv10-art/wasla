/**
 * ADR-060 P2 (CLM-0475): user assertion ownership on delivery routes — Batch 2.
 *
 * Tests the three modes for D2 and D6:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched ownership returns 404.
 *
 * D2: `GET /store-orders/:orderPublicId` — `order.customerRef` must match `endUser.publicId`.
 * D6: `GET /store-orders/:orderPublicId/delivery-task` — actor-aware: customer → `order.customerRef`, driver → `task.courierRef`.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { InjectOptions } from "fastify";

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
import type { StoreOrder, DeliveryTask } from "../domain/model.js";
import type { WaslaPublicId } from "@wasla/contracts-delivery";

const TEST_SERVICE_SECRET = "delivery-test-secret-0123456789abc";
const TEST_ACTIVE_KID = "test-active";
const ALL_SCOPES = Object.values(DELIVERY_SCOPES);
const OTHER_CUSTOMER = "WS-0000000099" as typeof CUSTOMER_REF;
const DRIVER_REF = "WS-0000000088" as WaslaPublicId;
const OTHER_DRIVER = "WS-0000000077" as WaslaPublicId;

const NOW = "2026-10-05T18:00:00.000Z";

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
    readinessPort: new FakeReadinessProbe([]),
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
    serviceName?: string;
  } = {},
): InjectOptions {
  const headers = serviceAuthHeaders({
    serviceName: options.serviceName ?? "customer-bot",
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

function mintAssertion(
  harness: AssertedHarness,
  publicId: string,
  act: "customer" | "driver" = "customer",
): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act,
    chn: "telegram",
    via: act === "driver" ? "driver-bot" : "customer-bot",
    aud: ["delivery"],
    now: new Date(),
  }).assertion;
}

function seedOrder(harness: AssertedHarness, customerRef: WaslaPublicId = CUSTOMER_REF): StoreOrder {
  const order: StoreOrder = {
    orderId: "order-seed-1",
    publicId: "WS-0000000100" as WaslaPublicId,
    customerRef,
    storeId: "store-1",
    storeSlug: STORE_SLUG,
    fulfillmentState: "placed",
    paymentState: "pending",
    paymentRef: null,
    inventoryState: "none",
    inventoryRef: null,
    currencyCode: "SAR",
    itemsTotalMinorUnits: 1000,
    deliveryFeeMinorUnits: 500,
    totalMinorUnits: 1500,
    items: [
      {
        orderItemId: "item-1",
        lineNo: 1,
        productId: PRODUCT_A,
        sku: "SKU-A",
        quantity: 1,
        unitPriceMinorUnits: 1000,
        lineTotalMinorUnits: 1000,
      },
    ],
    version: 1,
  };
  harness.store.seed(order);
  return order;
}

function seedOrderWithTask(
  harness: AssertedHarness,
  customerRef: WaslaPublicId = CUSTOMER_REF,
  courierRef: WaslaPublicId | null = DRIVER_REF,
): { order: StoreOrder; task: DeliveryTask } {
  const order = seedOrder(harness, customerRef);
  const task: DeliveryTask = {
    taskId: "task-seed-1",
    orderId: order.orderId,
    state: "driver_assigned",
    ineligibilityReason: null,
    dispatchJobRef: "dispatch-1",
    courierRef,
    proof: null,
    version: 1,
  };
  harness.store.seed(order, task);
  return { order, task };
}

describe("Delivery ADR-060 P2 (CLM-0475): user assertion ownership — Batch 2", () => {
  describe("D2 — GET /store-orders/:orderPublicId", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      const order = seedOrder(h);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}`),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: matching customer reads order", async () => {
      const h = buildAssertedApp("enforce");
      const order = seedOrder(h, CUSTOMER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}`, {
          obo: CUSTOMER_REF,
          assertion: mintAssertion(h, CUSTOMER_REF),
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: mismatched customer returns 404", async () => {
      const h = buildAssertedApp("enforce");
      const order = seedOrder(h, CUSTOMER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}`, {
          obo: OTHER_CUSTOMER,
          assertion: mintAssertion(h, OTHER_CUSTOMER),
        }),
      );
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched customer does not reject (logs would_reject)", async () => {
      const h = buildAssertedApp("observe");
      const order = seedOrder(h, CUSTOMER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}`, {
          obo: OTHER_CUSTOMER,
          assertion: mintAssertion(h, OTHER_CUSTOMER),
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });
  });

  describe("D6 — GET /store-orders/:orderPublicId/delivery-task", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      const { order } = seedOrderWithTask(h);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}/delivery-task`),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: matching customer reads task", async () => {
      const h = buildAssertedApp("enforce");
      const { order } = seedOrderWithTask(h, CUSTOMER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}/delivery-task`, {
          obo: CUSTOMER_REF,
          assertion: mintAssertion(h, CUSTOMER_REF, "customer"),
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: matching driver reads task", async () => {
      const h = buildAssertedApp("enforce");
      const { order } = seedOrderWithTask(h, CUSTOMER_REF, DRIVER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}/delivery-task`, {
          obo: DRIVER_REF,
          assertion: mintAssertion(h, DRIVER_REF, "driver"),
          serviceName: "driver-bot",
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: mismatched customer returns 404", async () => {
      const h = buildAssertedApp("enforce");
      const { order } = seedOrderWithTask(h, CUSTOMER_REF, DRIVER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}/delivery-task`, {
          obo: OTHER_CUSTOMER,
          assertion: mintAssertion(h, OTHER_CUSTOMER, "customer"),
        }),
      );
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("enforce mode: mismatched driver returns 404", async () => {
      const h = buildAssertedApp("enforce");
      const { order } = seedOrderWithTask(h, CUSTOMER_REF, DRIVER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}/delivery-task`, {
          obo: OTHER_DRIVER,
          assertion: mintAssertion(h, OTHER_DRIVER, "driver"),
          serviceName: "driver-bot",
        }),
      );
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched customer does not reject", async () => {
      const h = buildAssertedApp("observe");
      const { order } = seedOrderWithTask(h, CUSTOMER_REF, DRIVER_REF);
      const res = await h.app.fastify.inject(
        signedRequest(h, "GET", `/store-orders/${order.publicId}/delivery-task`, {
          obo: OTHER_CUSTOMER,
          assertion: mintAssertion(h, OTHER_CUSTOMER, "customer"),
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });
  });
});
