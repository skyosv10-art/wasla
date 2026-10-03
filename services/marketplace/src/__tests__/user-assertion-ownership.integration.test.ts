/**
 * ADR-060 P2 (CLM-0443): user assertion ownership on the marketplace boundary.
 *
 * Three routes move from `scoped()` to `beneficiary: "asserted"` (actor `store_staff`):
 * - `POST /stores`: `owner_public_id` in the body must be the verified end user.
 * - `GET /stores?owner_public_id=…`: an owner filter must be the verified end user.
 * - `GET /products/:productId/inventory`: the verified end user must be the owner or
 *   active staff of the product's store.
 *
 * Modes:
 * - `off` (production default): no verification, behaviour unchanged.
 * - `observe`: verified when present, never rejects; a bad or missing assertion leaves
 *   `endUser` unset, so no ownership check runs.
 * - `enforce`: an assertion is required; ownership mismatch answers 404, not 403.
 *
 * System reads used by `delivery` (`GET /stores/:storeSlug`, `GET /products/:productId`)
 * stay `scoped()` without `obo` and never need an assertion.
 */

import { generateKeyPairSync } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryServiceTokenReplayGuard,
  USER_ASSERTION_HEADER,
  userAssertionPublicKeysFromEnv,
  type UserAssertionPublicKeys,
} from "@wasla/service-auth";
import {
  mintUserAssertion,
  userAssertionSigningKey,
  type UserAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";

import { MarketplaceCatalogService } from "../app/catalog.js";
import { MarketplaceProductService } from "../app/products.js";
import { MarketplaceStoreService } from "../app/stores.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import type { Clock } from "../domain/time.js";
import { createMarketplaceApp } from "../http/app.js";
import { attachSigningInject, createTestKeyRegistry, signFor } from "./service-identity-support.js";
import {
  MEMBER,
  MODERATOR,
  OTHER_OWNER,
  OWNER,
  PG_ENABLED,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const NOW = "2026-06-01T00:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };
const CATEGORY = "electronics-phones";
const SLUG = "madinah-electronics";

let keySeed = 0;
const write = () => ({
  "idempotency-key": `idem-ua-${String(++keySeed).padStart(8, "0")}`,
  "content-type": "application/json",
});

function generateTestKeys(): { signingKey: UserAssertionSigningKey; publicKeys: UserAssertionPublicKeys } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingKey = userAssertionSigningKey("ua-test", privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const publicKeys = userAssertionPublicKeysFromEnv({
    WASLA_USER_ASSERTION_PUBLIC_KEYS: JSON.stringify({ "ua-test": spki }),
  });
  return { signingKey, publicKeys };
}

type Mode = "off" | "observe" | "enforce";

describe.skipIf(!PG_ENABLED)("CLM-0443 · marketplace asserted ownership (ADR-060 P2)", () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let keys: ReturnType<typeof createTestKeyRegistry>;
  let signingKey: UserAssertionSigningKey;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await pg?.close();
  });

  async function build(mode: Mode): Promise<void> {
    await resetData(pg.pool);
    await seedLeafCategory(pg.stores, CATEGORY);
    const uow = new MarketplaceUnitOfWork(pg.db);
    const deps = { uow, clock: fixedClock };
    keys = createTestKeyRegistry();
    const generated = generateTestKeys();
    signingKey = generated.signingKey;
    app = createMarketplaceApp({
      mode: "postgres",
      services: {
        stores: new MarketplaceStoreService(deps),
        products: new MarketplaceProductService(deps),
        catalog: new MarketplaceCatalogService(deps),
      },
      serviceIdentity: {
        keys,
        replayGuard: new InMemoryServiceTokenReplayGuard(),
        userAssertion: { mode, publicKeys: generated.publicKeys },
      },
    });
    attachSigningInject(app, keys);
    await app.ready();
  }

  function assertion(sub: string): string {
    return mintUserAssertion({
      key: signingKey,
      sub,
      act: "store_staff",
      chn: "telegram",
      via: "partner-bot",
      aud: ["marketplace"],
      now: new Date(),
    }).assertion;
  }

  /** A partner-bot call on behalf of `obo`, with an optional assertion. */
  function asStaff(
    method: string,
    url: string,
    obo: string,
    options: { assertionFor?: string } = {},
  ): Record<string, string> {
    return {
      ...signFor(method, url, { keys, serviceName: "partner-bot", onBehalfOfPublicId: obo }),
      ...(options.assertionFor === undefined ? {} : { [USER_ASSERTION_HEADER]: assertion(options.assertionFor) }),
    };
  }

  async function registerStore(
    owner: string,
    headers: Record<string, string>,
    slug = SLUG,
  ): Promise<LightMyRequestResponse> {
    return await app.inject({
      method: "POST",
      url: "/stores",
      headers: { ...headers, ...write() },
      payload: { owner_public_id: owner, store_slug: slug, title_ar: "إلكترونيّات المدينة", category_slug: CATEGORY },
    });
  }

  /** Store + approval + one product, through the declared routes. Returns the product id. */
  async function seedProduct(mode: Mode): Promise<string> {
    const headers = mode === "enforce" ? asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }) : {};
    const registered = await registerStore(OWNER, headers);
    expect(registered.statusCode, registered.body).toBe(201);
    const requested = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/review-requests`,
      headers: write(),
      payload: { requested_by_public_id: OWNER },
    });
    expect(requested.statusCode, requested.body).toBe(201);
    const decided = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/decisions`,
      headers: write(),
      payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
    });
    expect(decided.statusCode, decided.body).toBe(201);
    const created = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/products`,
      headers: write(),
      payload: {
        sku: "SKU-UA",
        title_ar: "هاتف",
        category_slug: CATEGORY,
        price_minor_units: 249900,
        currency_code: "SAR",
        created_by_public_id: OWNER,
        initial_quantity: 3,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().product_id as string;
  }

  async function readInventory(productId: string, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    return await app.inject({ method: "GET", url: `/products/${productId}/inventory`, headers });
  }

  // ── off: compatibility ──────────────────────────────────────────────

  describe("off mode (production default) — behaviour unchanged", () => {
    beforeEach(async () => build("off"));

    it("POST /stores succeeds without an assertion, owner taken from the body", async () => {
      const response = await registerStore(OWNER, {});
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().owner_public_id).toBe(OWNER);
    });

    it("GET /stores?owner_public_id lists without an assertion", async () => {
      await registerStore(OWNER, {});
      const response = await app.inject({ method: "GET", url: `/stores?owner_public_id=${OWNER}` });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().stores).toHaveLength(1);
    });

    it("GET /products/:id/inventory reads without an assertion", async () => {
      const productId = await seedProduct("off");
      const response = await readInventory(productId);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().quantity_on_hand).toBe(3);
    });

    it("an assertion for another user is ignored in off mode", async () => {
      const url = "/stores";
      const response = await registerStore(OWNER, asStaff("POST", url, OTHER_OWNER, { assertionFor: OTHER_OWNER }));
      expect(response.statusCode, response.body).toBe(201);
    });
  });

  // ── observe: verify, never reject ───────────────────────────────────

  describe("observe mode — verified when valid, never rejected", () => {
    beforeEach(async () => build("observe"));

    it("POST /stores without an assertion succeeds (no endUser, no check)", async () => {
      const response = await registerStore(OWNER, asStaff("POST", "/stores", OWNER));
      expect(response.statusCode, response.body).toBe(201);
    });

    it("POST /stores with a valid matching assertion succeeds", async () => {
      const response = await registerStore(OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      expect(response.statusCode, response.body).toBe(201);
    });

    it("GET /products/:id/inventory without an assertion still reads", async () => {
      const productId = await seedProduct("observe");
      const url = `/products/${productId}/inventory`;
      const response = await readInventory(productId, asStaff("GET", url, OTHER_OWNER));
      expect(response.statusCode, response.body).toBe(200);
    });

    // CLM-0448: with a VALID assertion, observe sets `endUser`; before the fix the
    // three ownership checks below answered 404 in observe exactly as in enforce.
    it("CLM-0448: POST /stores naming another owner with a valid assertion → 201 (observe logs, does not reject)", async () => {
      const response = await registerStore(OTHER_OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      expect(response.statusCode, response.body).toBe(201);
    });

    it("CLM-0448: GET /stores?owner_public_id=<other> with a valid assertion → 200 in observe", async () => {
      await registerStore(OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      const url = `/stores?owner_public_id=${OWNER}`;
      const response = await app.inject({ method: "GET", url, headers: asStaff("GET", url, OTHER_OWNER, { assertionFor: OTHER_OWNER }) });
      expect(response.statusCode, response.body).toBe(200);
    });

    it("CLM-0448: GET /products/:id/inventory by a non-member with a valid assertion → 200 in observe", async () => {
      const productId = await seedProduct("observe");
      const url = `/products/${productId}/inventory`;
      const response = await readInventory(productId, asStaff("GET", url, OTHER_OWNER, { assertionFor: OTHER_OWNER }));
      expect(response.statusCode, response.body).toBe(200);
    });
  });

  // ── enforce: positive and negative ──────────────────────────────────

  describe("enforce mode — ownership bound to the verified end user", () => {
    beforeEach(async () => build("enforce"));

    it("POST /stores without an assertion → 401", async () => {
      const response = await registerStore(OWNER, asStaff("POST", "/stores", OWNER));
      expect(response.statusCode, response.body).toBe(401);
    });

    it("POST /stores with an assertion whose sub differs from obo → 403", async () => {
      const response = await registerStore(OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OTHER_OWNER }));
      expect(response.statusCode, response.body).toBe(403);
    });

    it("POST /stores by the asserted owner → 201", async () => {
      const response = await registerStore(OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().owner_public_id).toBe(OWNER);
    });

    it("POST /stores naming another owner in the body → 404 STORE_NOT_FOUND, nothing written", async () => {
      const response = await registerStore(OTHER_OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe("STORE_NOT_FOUND");
      const listed = await app.inject({
        method: "GET",
        url: "/stores?state=draft",
        headers: asStaff("GET", "/stores?state=draft", OWNER, { assertionFor: OWNER }),
      });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(listed.json().stores).toHaveLength(0);
    });

    it("GET /stores?owner_public_id=<self> → 200 with own stores", async () => {
      await registerStore(OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      const response = await app.inject({
        method: "GET",
        url: `/stores?owner_public_id=${OWNER}`,
        headers: asStaff("GET", `/stores?owner_public_id=${OWNER}`, OWNER, { assertionFor: OWNER }),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().stores).toHaveLength(1);
    });

    it("GET /stores?owner_public_id=<other> → 404", async () => {
      await registerStore(OWNER, asStaff("POST", "/stores", OWNER, { assertionFor: OWNER }));
      const response = await app.inject({
        method: "GET",
        url: `/stores?owner_public_id=${OWNER}`,
        headers: asStaff("GET", `/stores?owner_public_id=${OWNER}`, OTHER_OWNER, { assertionFor: OTHER_OWNER }),
      });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe("STORE_NOT_FOUND");
    });

    it("GET /products/:id/inventory by the store owner → 200", async () => {
      const productId = await seedProduct("enforce");
      const url = `/products/${productId}/inventory`;
      const response = await readInventory(productId, asStaff("GET", url, OWNER, { assertionFor: OWNER }));
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().quantity_on_hand).toBe(3);
    });

    it("GET /products/:id/inventory by active staff → 200", async () => {
      const productId = await seedProduct("enforce");
      const added = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/staff`,
        headers: write(),
        payload: { member_public_id: MEMBER, role: "staff", added_by_public_id: OWNER },
      });
      expect(added.statusCode, added.body).toBe(201);
      const url = `/products/${productId}/inventory`;
      const response = await readInventory(productId, asStaff("GET", url, MEMBER, { assertionFor: MEMBER }));
      expect(response.statusCode, response.body).toBe(200);
    });

    it("GET /products/:id/inventory by a non-member → 404 PRODUCT_NOT_FOUND", async () => {
      const productId = await seedProduct("enforce");
      const url = `/products/${productId}/inventory`;
      const response = await readInventory(productId, asStaff("GET", url, OTHER_OWNER, { assertionFor: OTHER_OWNER }));
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
    });

    it("GET /products/:id/inventory without an assertion → 401", async () => {
      const productId = await seedProduct("enforce");
      const url = `/products/${productId}/inventory`;
      const response = await readInventory(productId, asStaff("GET", url, OWNER));
      expect(response.statusCode, response.body).toBe(401);
    });

    it("an assertion for a customer (wrong act) → 403", async () => {
      const wrongAct = mintUserAssertion({
        key: signingKey,
        sub: OWNER,
        act: "customer",
        chn: "telegram",
        via: "partner-bot",
        aud: ["marketplace"],
        now: new Date(),
      }).assertion;
      const response = await registerStore(OWNER, {
        ...signFor("POST", "/stores", { keys, serviceName: "partner-bot", onBehalfOfPublicId: OWNER }),
        [USER_ASSERTION_HEADER]: wrongAct,
      });
      expect(response.statusCode, response.body).toBe(403);
    });

    it("system reads used by delivery stay scoped: GET /stores/:slug and GET /products/:id need no assertion", async () => {
      const productId = await seedProduct("enforce");
      const store = await app.inject({
        method: "GET",
        url: `/stores/${SLUG}`,
        headers: signFor("GET", `/stores/${SLUG}`, { keys, serviceName: "delivery" }),
      });
      expect(store.statusCode, store.body).toBe(200);
      const product = await app.inject({
        method: "GET",
        url: `/products/${productId}`,
        headers: signFor("GET", `/products/${productId}`, { keys, serviceName: "delivery" }),
      });
      expect(product.statusCode, product.body).toBe(200);
    });
  });
});
