/**
 * HTTP route tests for the Audit service (M3-04).
 *
 * Tests POST /audit/events (append), GET /audit/events (list with filters),
 * validation, immutability (no update/delete routes), and authz.
 */

import { describe, expect, it } from "vitest";

import { buildSignedAuditApp, signFor } from "../helpers.js";
import { AUDIT_SCOPES } from "../../http/service-identity.js";

const validEvent = {
  actor_id: "WS-1000000001",
  actor_role: "operator",
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
    expect(body.actor_id).toBe("WS-1000000001");
    expect(body.actor_role).toBe("operator");
    expect(body.action).toBe("driver.suspend");
    expect(body.resource_type).toBe("driver");
    expect(body.resource_id).toBe("WS-2000000001");
    expect(body.metadata).toEqual({ reason: "documentation_expired" });
    expect(body.created_at).toBeTruthy();
  });

  it("rejects missing required fields with 400", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({
      method: "POST",
      url: "/audit/events",
      payload: { actor_id: "WS-1" },
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
        actor_id: "WS-1",
        actor_role: "admin",
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
        actor_id: "  ",
        actor_role: "operator",
        action: "test",
        resource_type: "test",
        resource_id: "test",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("AUDIT_INVALID_EVENT");
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
    const { app } = buildSignedAuditApp();
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, actor_id: "WS-1" } });
    await app.inject({ method: "POST", url: "/audit/events", payload: { ...validEvent, actor_id: "WS-2" } });

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

describe("Audit immutability", () => {
  it("does not expose PUT /audit/events/:id", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({ method: "PUT", url: "/audit/events/1", payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it("does not expose DELETE /audit/events/:id", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({ method: "DELETE", url: "/audit/events/1" });
    expect(response.statusCode).toBe(404);
  });

  it("does not expose PATCH /audit/events/:id", async () => {
    const { app } = buildSignedAuditApp();
    const response = await app.inject({ method: "PATCH", url: "/audit/events/1", payload: {} });
    expect(response.statusCode).toBe(404);
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
