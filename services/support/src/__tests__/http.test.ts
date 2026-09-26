/**
 * اختباراتُ طبقةِ HTTP لخدمة الدعم (Phase 16 · ADR-049).
 *
 * تُشغَّلُ على تطبيقِ Fastify مُستخدِمةً المخزنَ الذاكريّ — بلا قاعدةِ بيانات.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { createSupportApp } from "../http/app.js";
import {
  InMemorySupportTicketStore,
  InMemorySupportEventPublisher,
} from "../infrastructure/in-memory.js";

describe("Support HTTP layer", () => {
  let app: FastifyInstance;
  let store: InMemorySupportTicketStore;
  let publisher: InMemorySupportEventPublisher;

  beforeEach(() => {
    store = new InMemorySupportTicketStore();
    publisher = new InMemorySupportEventPublisher();
    app = createSupportApp({ store, publisher });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("returns ok status", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("ok");
      expect(body.service).toBe("support-service");
      expect(body.port).toBe(8095);
    });
  });

  describe("POST /support/tickets", () => {
    it("creates a ticket and returns 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      expect(res.statusCode).toBe(201);
      const ticket = JSON.parse(res.body);
      expect(ticket.state).toBe("open");
      expect(ticket.ticket_type).toBe("order_issue");
      expect(ticket.reporter_public_id).toBe("WS-CUST000001");
      expect(ticket.ticket_id).toBeTruthy();
    });

    it("rejects missing ticket_type with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("SUPPORT_VALIDATION_FAILED");
    });

    it("rejects missing reporter_public_id with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /support/tickets/:ticketId", () => {
    it("returns 404 for unknown ticket", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/support/tickets/00000000-0000-0000-0000-000000000000",
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("SUPPORT_TICKET_NOT_FOUND");
    });

    it("returns the ticket after creation", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const { ticket_id } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: "GET",
        url: `/support/tickets/${ticket_id}`,
      });

      expect(res.statusCode).toBe(200);
      const ticket = JSON.parse(res.body);
      expect(ticket.ticket_id).toBe(ticket_id);
    });
  });

  describe("POST /support/tickets/:ticketId/evidence", () => {
    it("attaches evidence and returns 201", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const { ticket_id } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/evidence`,
        payload: {
          evidence_type: "photo",
          content_hash: "sha256:abc",
          storage_ref: "s3://bucket/key",
        },
      });

      expect(res.statusCode).toBe(201);
      const evidence = JSON.parse(res.body);
      expect(evidence.evidence_type).toBe("photo");
      expect(evidence.content_hash).toBe("sha256:abc");
      expect(evidence.ticket_id).toBe(ticket_id);
    });

    it("returns 404 for unknown ticket", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/support/tickets/00000000-0000-0000-0000-000000000000/evidence",
        payload: {
          evidence_type: "photo",
          content_hash: "hash",
          storage_ref: "ref",
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /support/tickets/:ticketId/escalate", () => {
    it("escalates a ticket", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const { ticket_id } = JSON.parse(createRes.body);

      // Attach evidence first (evidence gate)
      await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/evidence`,
        payload: {
          evidence_type: "photo",
          content_hash: "hash",
          storage_ref: "ref",
        },
      });

      // Move to investigating
      await store.updateState(ticket_id, "investigating", {});

      // Escalate
      const res = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/escalate`,
        payload: {
          escalation_level: "support_supervisor",
        },
      });

      expect(res.statusCode).toBe(200);
      const ticket = JSON.parse(res.body);
      expect(ticket.state).toBe("escalated");
      expect(ticket.escalation_level).toBe("support_supervisor");
    });

    it("returns 404 for unknown ticket", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/support/tickets/00000000-0000-0000-0000-000000000000/escalate",
        payload: {
          escalation_level: "support_supervisor",
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /support/tickets/:ticketId/resolve", () => {
    it("resolves a ticket with evidence", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const { ticket_id } = JSON.parse(createRes.body);

      // Attach evidence
      const evidenceRes = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/evidence`,
        payload: {
          evidence_type: "photo",
          content_hash: "hash",
          storage_ref: "ref",
        },
      });

      const { evidence_id } = JSON.parse(evidenceRes.body);

      // Move to investigating
      await store.updateState(ticket_id, "investigating", {});

      // Resolve
      const res = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/resolve`,
        payload: {
          resolution_reason: "refund_issued",
          evidence_id,
        },
      });

      expect(res.statusCode).toBe(200);
      const ticket = JSON.parse(res.body);
      expect(ticket.state).toBe("resolved");
      expect(ticket.resolution_reason).toBe("refund_issued");
    });
  });

  describe("POST /support/tickets/:ticketId/close", () => {
    it("closes a resolved ticket", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const { ticket_id } = JSON.parse(createRes.body);

      // Attach evidence
      const evidenceRes = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/evidence`,
        payload: {
          evidence_type: "photo",
          content_hash: "hash",
          storage_ref: "ref",
        },
      });

      const { evidence_id } = JSON.parse(evidenceRes.body);

      // Full lifecycle: open → investigating → resolved → closed
      await store.updateState(ticket_id, "investigating", {});
      await store.resolve({
        ticket_id,
        resolution_reason: "refund_issued",
        evidence_id,
      });

      const res = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/close`,
      });

      expect(res.statusCode).toBe(200);
      const ticket = JSON.parse(res.body);
      expect(ticket.state).toBe("closed");
      expect(ticket.closed_at).toBeTruthy();
    });

    it("returns 404 for unknown ticket", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/support/tickets/00000000-0000-0000-0000-000000000000/close",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("full lifecycle via HTTP", () => {
    it("completes the full ticket lifecycle through HTTP endpoints", async () => {
      // 1. Create
      const createRes = await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "payment_dispute",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: "WS-DRVR000001",
          order_public_id: "ORD-000001",
        },
      });

      expect(createRes.statusCode).toBe(201);
      const { ticket_id } = JSON.parse(createRes.body);

      // 2. Attach evidence
      const evidenceRes = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/evidence`,
        payload: {
          evidence_type: "order_log",
          content_hash: "sha256:abc",
          storage_ref: "s3://logs/123",
        },
      });

      expect(evidenceRes.statusCode).toBe(201);
      const { evidence_id } = JSON.parse(evidenceRes.body);

      // 3. Investigate (via store — HTTP escalate requires investigating first)
      await store.updateState(ticket_id, "investigating", {});

      // 4. Escalate
      const escalateRes = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/escalate`,
        payload: {
          escalation_level: "support_supervisor",
        },
      });

      expect(escalateRes.statusCode).toBe(200);
      expect(JSON.parse(escalateRes.body).state).toBe("escalated");

      // 5. Resolve
      const resolveRes = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/resolve`,
        payload: {
          resolution_reason: "warning_sent",
          evidence_id,
        },
      });

      expect(resolveRes.statusCode).toBe(200);
      expect(JSON.parse(resolveRes.body).state).toBe("resolved");

      // 6. Close
      const closeRes = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket_id}/close`,
      });

      expect(closeRes.statusCode).toBe(200);
      expect(JSON.parse(closeRes.body).state).toBe("closed");
    });
  });

  describe("events", () => {
    it("publishes ticket_opened event on create", async () => {
      await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const events = publisher.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe("support.ticket_opened");
    });

    it("does not include PII in event payloads", async () => {
      await app.inject({
        method: "POST",
        url: "/support/tickets",
        payload: {
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
          subject_public_id: null,
          order_public_id: null,
        },
      });

      const events = publisher.getEvents();
      const payload = events[0].payload;
      expect(payload).not.toHaveProperty("chat_id");
      expect(payload).not.toHaveProperty("telegram");
      expect(payload).not.toHaveProperty("phone");
      expect(payload).not.toHaveProperty("name");
    });
  });
});
