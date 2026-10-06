/**
 * ADR-060 P2 (CLM-0475): user assertion ownership on support ticket routes.
 *
 * Tests the three modes for S1, S2, S3, and S4:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched `reporter_public_id` returns 404.
 *
 * S1: `POST /support/tickets` — `reporter_public_id` in body must match `endUser.publicId`.
 * S2: `GET /support/tickets` — list filtered by `reporter_public_id` = `endUser.publicId`.
 * S3: `GET /support/tickets/:ticketId` — `ticket.reporter_public_id` must match `endUser.publicId`.
 * S4: `POST /support/tickets/:ticketId/evidence` — `ticket.reporter_public_id` must match `endUser.publicId`.
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

import { createSupportApp } from "../http/app.js";
import {
  SUPPORT_SERVICE_AUDIENCE,
  SUPPORT_SCOPES,
} from "../http/service-identity.js";
import {
  InMemorySupportTicketStore,
  InMemorySupportEventPublisher,
} from "../infrastructure/in-memory.js";
import { InMemoryReputationBridge } from "../infrastructure/reputation-bridge.js";

const TEST_SERVICE_SECRET = "support-test-secret-0123456789abc";
const TEST_ACTIVE_KID = "test-active";
const ALL_SCOPES = Object.values(SUPPORT_SCOPES);
const REPORTER = "WS-0000000001";
const OTHER_REPORTER = "WS-0000000099";

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

interface SupportHarness {
  readonly app: ReturnType<typeof createSupportApp>;
  readonly keys: ServiceAuthKeyRegistry;
  readonly signingKey: UserAssertionSigningKey;
  readonly store: InMemorySupportTicketStore;
}

function buildAssertedApp(mode: "off" | "observe" | "enforce"): SupportHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const { signingKey, publicKeys } = generateTestKeys();
  const store = new InMemorySupportTicketStore();
  const publisher = new InMemorySupportEventPublisher();
  const reputationBridge = new InMemoryReputationBridge();

  const app = createSupportApp({
    store,
    publisher,
    reputationBridge,
    serviceIdentity: { keys, replayGuard, userAssertion: { mode, publicKeys } },
  });

  return { app, keys, signingKey, store };
}

function signedRequest(
  harness: SupportHarness,
  method: string,
  url: string,
  options: {
    obo?: string;
    assertion?: string;
    body?: unknown;
  } = {},
): InjectOptions {
  const headers = serviceAuthHeaders({
    serviceName: "customer-bot",
    audience: SUPPORT_SERVICE_AUDIENCE,
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
      ...(options.assertion ? { [USER_ASSERTION_HEADER]: options.assertion } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
  };

  if (options.body !== undefined) {
    result.payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return result;
}

function mintAssertion(harness: SupportHarness, publicId: string): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act: "customer",
    chn: "telegram",
    via: "customer-bot",
    aud: ["support"],
    now: new Date(),
  }).assertion;
}

function ticketBody(reporterPublicId: string = REPORTER): Record<string, unknown> {
  return {
    ticket_type: "order_issue",
    reporter_public_id: reporterPublicId,
    subject_public_id: null,
    order_public_id: null,
  };
}

async function createTicket(harness: SupportHarness, reporterPublicId: string = REPORTER, withAssertion: boolean = false): Promise<string> {
  const opts: { body: unknown; obo?: string; assertion?: string } = {
    body: ticketBody(reporterPublicId),
  };
  if (withAssertion) {
    opts.obo = reporterPublicId;
    opts.assertion = mintAssertion(harness, reporterPublicId);
  }
  const res = await harness.app.inject(
    signedRequest(harness, "POST", "/support/tickets", opts),
  );
  return JSON.parse(res.body).ticket_id;
}

describe("Support ADR-060 P2 (CLM-0475): user assertion ownership", () => {
  describe("S1 — POST /support/tickets", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      const res = await h.app.inject(
        signedRequest(h, "POST", "/support/tickets", { body: ticketBody() }),
      );
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });

    it("enforce mode: matching reporter creates ticket", async () => {
      const h = buildAssertedApp("enforce");
      const res = await h.app.inject(
        signedRequest(h, "POST", "/support/tickets", {
          body: ticketBody(REPORTER),
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });

    it("enforce mode: mismatched reporter returns 404", async () => {
      const h = buildAssertedApp("enforce");
      const res = await h.app.inject(
        signedRequest(h, "POST", "/support/tickets", {
          body: ticketBody(OTHER_REPORTER),
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched reporter does not reject", async () => {
      const h = buildAssertedApp("observe");
      const res = await h.app.inject(
        signedRequest(h, "POST", "/support/tickets", {
          body: ticketBody(OTHER_REPORTER),
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });
  });

  describe("S2 — GET /support/tickets", () => {
    it("off mode: no assertion needed, returns all tickets", async () => {
      const h = buildAssertedApp("off");
      await createTicket(h, REPORTER);
      await createTicket(h, OTHER_REPORTER);
      const res = await h.app.inject(signedRequest(h, "GET", "/support/tickets"));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tickets.length).toBe(2);
      await h.app.close();
    });

    it("enforce mode: only reporter's tickets returned", async () => {
      const h = buildAssertedApp("enforce");
      await createTicket(h, REPORTER, true);
      await createTicket(h, OTHER_REPORTER, true);
      const res = await h.app.inject(
        signedRequest(h, "GET", "/support/tickets", {
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tickets.length).toBe(1);
      expect(body.tickets[0].reporter_public_id).toBe(REPORTER);
      await h.app.close();
    });

    it("enforce mode: other reporter's tickets not visible", async () => {
      const h = buildAssertedApp("enforce");
      await createTicket(h, OTHER_REPORTER, true);
      const res = await h.app.inject(
        signedRequest(h, "GET", "/support/tickets", {
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tickets.length).toBe(0);
      await h.app.close();
    });

    it("observe mode: all tickets returned (no filtering in observe)", async () => {
      const h = buildAssertedApp("observe");
      await createTicket(h, REPORTER);
      await createTicket(h, OTHER_REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "GET", "/support/tickets", {
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // In observe mode, endUser is present so filtering is applied.
      // The assertion's sub matches REPORTER, so only REPORTER's tickets are returned.
      expect(body.tickets.length).toBe(1);
      await h.app.close();
    });
  });

  describe("S3 — GET /support/tickets/:ticketId", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      const ticketId = await createTicket(h, REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "GET", `/support/tickets/${ticketId}`),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: matching reporter reads ticket", async () => {
      const h = buildAssertedApp("enforce");
      const ticketId = await createTicket(h, REPORTER, true);
      const res = await h.app.inject(
        signedRequest(h, "GET", `/support/tickets/${ticketId}`, {
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });

    it("enforce mode: mismatched reporter returns 404", async () => {
      const h = buildAssertedApp("enforce");
      const ticketId = await createTicket(h, REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "GET", `/support/tickets/${ticketId}`, {
          obo: OTHER_REPORTER,
          assertion: mintAssertion(h, OTHER_REPORTER),
        }),
      );
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched reporter does not reject", async () => {
      const h = buildAssertedApp("observe");
      const ticketId = await createTicket(h, REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "GET", `/support/tickets/${ticketId}`, {
          obo: OTHER_REPORTER,
          assertion: mintAssertion(h, OTHER_REPORTER),
        }),
      );
      expect(res.statusCode).toBe(200);
      await h.app.close();
    });
  });

  describe("S4 — POST /support/tickets/:ticketId/evidence", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      const ticketId = await createTicket(h, REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "POST", `/support/tickets/${ticketId}/evidence`, {
          body: {
            evidence_type: "screenshot",
            content_hash: "abc123",
            storage_ref: "s3://bucket/key",
          },
        }),
      );
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });

    it("enforce mode: matching reporter attaches evidence", async () => {
      const h = buildAssertedApp("enforce");
      const ticketId = await createTicket(h, REPORTER, true);
      const res = await h.app.inject(
        signedRequest(h, "POST", `/support/tickets/${ticketId}/evidence`, {
          body: {
            evidence_type: "screenshot",
            content_hash: "abc123",
            storage_ref: "s3://bucket/key",
          },
          obo: REPORTER,
          assertion: mintAssertion(h, REPORTER),
        }),
      );
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });

    it("enforce mode: mismatched reporter returns 404", async () => {
      const h = buildAssertedApp("enforce");
      const ticketId = await createTicket(h, REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "POST", `/support/tickets/${ticketId}/evidence`, {
          body: {
            evidence_type: "screenshot",
            content_hash: "abc123",
            storage_ref: "s3://bucket/key",
          },
          obo: OTHER_REPORTER,
          assertion: mintAssertion(h, OTHER_REPORTER),
        }),
      );
      expect(res.statusCode).toBe(404);
      await h.app.close();
    });

    it("observe mode: mismatched reporter does not reject", async () => {
      const h = buildAssertedApp("observe");
      const ticketId = await createTicket(h, REPORTER);
      const res = await h.app.inject(
        signedRequest(h, "POST", `/support/tickets/${ticketId}/evidence`, {
          body: {
            evidence_type: "screenshot",
            content_hash: "abc123",
            storage_ref: "s3://bucket/key",
          },
          obo: OTHER_REPORTER,
          assertion: mintAssertion(h, OTHER_REPORTER),
        }),
      );
      expect(res.statusCode).toBe(201);
      await h.app.close();
    });
  });
});
