/**
 * HTTP route tests for the Audit service (M3-04).
 *
 * Tests POST /audit/events (append), GET /audit/events (list with filters),
 * validation, immutability (no update/delete routes — modification attempts
 * are rejected 405 + Allow per UAT-08 / ADR-072 D2), and authz.
 *
 * ADR-063 PO-002 (CLM-0477): actor_id and actor_role are derived from the
 * verified service token, not accepted from the request body.
 */

import { describe, expect, it } from "vitest";

import { buildSignedAuditApp, signFor } from "../helpers.js";
import { AUDIT_SCOPES } from "../../http/service-identity.js";

const validEvent = {
  action: "driver.suspend",
  resource_type: "driver",
  resource_id: "WS-2000000001",
  metadata: { reason: "documentation_expired" },
};

describe("POST /audit/events", () => {
  it("creates an audit event and returns 201", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: validEvent,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBe(1);
    // actor_id and actor_role are derived from the verified service token
    expect(body.actor_id).toBe("admin-portal");
    expect(body.actor_role).toBe("admin-portal");
    expect(body.action).toBe("driver.suspend");
    expect(body.resource_type).toBe("driver");
    expect(body.resource_id).toBe("WS-2000000001");
    expect(body.metadata).toEqual({ reason: "documentation_expired" });
    expect(body.created_at).toBeTruthy();
  });

  it("derives actor_id from obo when present", async () => {
    const { app, keys } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: validEvent,
      headers: signFor("POST", "/audit/events", { keys, onBehalfOfPublicId: "WS-1000000001" }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.actor_id).toBe("WS-1000000001");
    expect(body.actor_role).toBe("admin-portal");
  });

  it("rejects missing required fields with 400", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: { action: "test" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("AUDIT_INVALID_EVENT");
  });

  it("defaults metadata to empty object when omitted", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: {
        action: "test",
        resource_type: "test",
        resource_id: "WS-2",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().metadata).toEqual({});
  });

  it("rejects empty string fields with 400", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: {
        action: "  ",
        resource_type: "test",
        resource_id: "test",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("AUDIT_INVALID_EVENT");
  });

  it("ignores actor_id and actor_role in body (derived from token)", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: {
        ...validEvent,
        actor_id: "WS-ATTACKER",
        actor_role: "superadmin",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    // The body-supplied values are ignored; the token-derived values are used
    expect(body.actor_id).toBe("admin-portal");
    expect(body.actor_role).toBe("admin-portal");
  });
});

describe("GET /audit/events", () => {
  it("returns empty list when no events exist", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({ method: "GET", url: "/audit/events" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toEqual([]);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("returns seeded events newest-first", async () => {
    const { app } = buildSignedAuditApp();
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, action: "first" } });
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, action: "second" } });

    const response = await app.inject({ method: "GET", url: "/audit/events" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].action).toBe("second");
    expect(body.events[1].action).toBe("first");
  });

  it("filters by action", async () => {
    const { app } = buildSignedAuditApp();
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, action: "suspend" } });
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, action: "reinstate" } });

    const response = await app.inject({ method: "GET", url: "/audit/events?action=suspend" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].action).toBe("suspend");
  });

  it("filters by actor_id", async () => {
    const { app, keys } = buildSignedAuditApp();
    await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: { ...validEvent },
      headers: signFor("POST", "/audit/events", { keys, onBehalfOfPublicId: "WS-1" }),
    });
    await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: { ...validEvent },
      headers: signFor("POST", "/audit/events", { keys, onBehalfOfPublicId: "WS-2" }),
    });

    const response = await app.inject({ method: "GET", url: "/audit/events?actor_id=WS-2" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].actor_id).toBe("WS-2");
  });

  it("filters by resource_type and resource_id", async () => {
    const { app } = buildSignedAuditApp();
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, resource_type: "driver", resource_id: "WS-D1" } });
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, resource_type: "customer", resource_id: "WS-C1" } });

    const response = await app.inject({ method: "GET", url: "/audit/events?resource_type=customer&resource_id=WS-C1" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].resource_type).toBe("customer");
  });

  it("respects limit and offset", async () => {
    const { app } = buildSignedAuditApp();
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, action: `event-${i}` } });
    }

    const response = await app.inject({ method: "GET", url: "/audit/events?limit=2&offset=1" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].action).toBe("event-3");
    expect(body.events[1].action).toBe("event-2");
  });
});

describe("Audit immutability — UAT-08: 405 + Allow (ADR-072 D2)", () => {
  const COLLECTION_ALLOW = "GET, HEAD, POST";

  for (const method of ["PUT", "PATCH", "DELETE"] as const) {
    it(`rejects ${method} /audit/events with 405 and Allow: GET, HEAD, POST`, async () => {
      const { app } = buildSignedAuditApp();
      const response = await app.inject({ method, url: "/audit/events", payload: {} });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe(COLLECTION_ALLOW);
      expect(response.json().code).toBe("AUDIT_METHOD_NOT_ALLOWED");
      expect(response.json().trace_id).toBeTruthy();
    });
  }

  for (const method of ["PUT", "PATCH", "DELETE", "POST"] as const) {
    it(`rejects ${method} /audit/events/:id with 405 and an empty Allow`, async () => {
      const { app } = buildSignedAuditApp();
      const response = await app.inject({ method, url: "/audit/events/1", payload: {} });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("");
      expect(response.json().code).toBe("AUDIT_METHOD_NOT_ALLOWED");
    });
  }

  it("every method listed in Allow is actually served on /audit/events", async () => {
    const { app } = buildSignedAuditApp();
    const get = await app.inject({ method: "GET", url: "/audit/events" });
    const head = await app.inject({ method: "HEAD", url: "/audit/events" });
    const post = await app.inject({ method: "POST", url: "/audit/events", payload: validEvent });
    expect(get.statusCode).toBe(200);
    expect(head.statusCode).toBe(200);
    expect(post.statusCode).toBe(201);
  });

  it("modification attempts leave the stored events unchanged", async () => {
    const { app, deps } = buildSignedAuditApp();
    await app.inject({ method: "POST", url: "/audit/events", payload: validEvent });
    await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: { ...validEvent, action: "driver.reinstate" },
    });
    // Deep copy: the in-memory repo returns live objects, so an in-place mutation
    // would otherwise make `before` and `after` equal by aliasing.
    const before = structuredClone(await deps.repo.list({ limit: 200, offset: 0 }));
    const beforeWire = (await app.inject({ method: "GET", url: "/audit/events" })).json();

    const tamper = { action: "tampered", resource_id: "WS-0", metadata: { forged: true } };
    const attempts = [
      { method: "PUT", url: "/audit/events" },
      { method: "PATCH", url: "/audit/events" },
      { method: "DELETE", url: "/audit/events" },
      { method: "PUT", url: `/audit/events/${before[0]!.id}` },
      { method: "PATCH", url: `/audit/events/${before[0]!.id}` },
      { method: "DELETE", url: `/audit/events/${before[0]!.id}` },
      { method: "POST", url: `/audit/events/${before[0]!.id}` },
    ] as const;
    for (const attempt of attempts) {
      const response = await app.inject({ ...attempt, payload: tamper });
      expect(response.statusCode).toBe(405);
    }

    const after = await deps.repo.list({ limit: 200, offset: 0 });
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/audit/events" })).json()).toEqual(beforeWire);
  });

  it("an unsigned modification attempt is 401 before any 405 is disclosed", async () => {
    const { rawInject } = buildSignedAuditApp();
    const response = await rawInject({ method: "DELETE", url: "/audit/events/1" });
    expect(response.statusCode).toBe(401);
    expect(response.headers.allow).toBeUndefined();
  });

  it("non-modifying unknown requests keep the router's 404", async () => {
    const { app } = buildSignedAuditApp();
    const itemGet = await app.inject({ method: "GET", url: "/audit/events/1" });
    const otherPut = await app.inject({ method: "PUT", url: "/audit/other", payload: {} });
    expect(itemGet.statusCode).toBe(404);
    expect(otherPut.statusCode).toBe(404);
    expect(itemGet.headers.allow).toBeUndefined();
  });
});

describe("Authz enforcement", () => {
  it("rejects POST without audit:write scope", async () => {
    const { app, keys } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: validEvent,
      headers: signFor("POST", "/audit/events", { keys, scopes: [AUDIT_SCOPES.read] }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects GET without audit:read scope", async () => {
    const { app, keys } = buildSignedAuditApp();
    const response = await app.inject({
      method: "GET",
      url: "/audit/events",
      headers: signFor("GET", "/audit/events", { keys, scopes: [AUDIT_SCOPES.write] }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects unsigned requests", async () => {
    const { rawInject } = buildSignedAuditApp();
    const response = await rawInject({ method: "GET", url: "/audit/events" });

    expect(response.statusCode).toBe(401);
  });
});
