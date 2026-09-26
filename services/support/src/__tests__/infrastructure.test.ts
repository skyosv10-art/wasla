/**
 * اختباراتُ مستودعِ الذاكرة — تُثبِتُ أنَّ المُهيئَ يفرضُ كلَّ قيدٍ مُسمّى.
 *
 * هذه الاختباراتُ تُشغَّلُ على المُهيئِ الذاكرةِ وحدها — بلا قاعدةِ بيانات.
 * حزمةُ المطابقةِ (في مراجعةٍ لاحقة) ستُشغّلُ نفسَ الحالاتِ على PostgreSQL.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { SUPPORT_TICKET_TYPES, SUPPORT_RESOLUTION_REASONS, SUPPORT_EVIDENCE_TYPES } from "../domain/model.js";
import {
  InMemorySupportTicketStore,
  InMemorySupportEventPublisher,
} from "../infrastructure/in-memory.js";

describe("InMemorySupportTicketStore", () => {
  let store: InMemorySupportTicketStore;

  beforeEach(() => {
    store = new InMemorySupportTicketStore();
  });

  describe("createTicket", () => {
    it("creates a ticket in open state", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      expect(ticket.state).toBe("open");
      expect(ticket.ticket_type).toBe("order_issue");
      expect(ticket.reporter_public_id).toBe("WS-CUST000001");
      expect(ticket.escalation_level).toBeNull();
      expect(ticket.evidence_id).toBeNull();
      expect(ticket.resolution_reason).toBeNull();
      expect(ticket.opened_at).toBeTruthy();
      expect(ticket.closed_at).toBeNull();
    });

    it("creates ticket with all types", async () => {
      for (const type of SUPPORT_TICKET_TYPES) {
        const ticket = await store.createTicket({
          ticket_type: type,
          reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
        });
        expect(ticket.ticket_type).toBe(type);
      }
    });

    it("creates ticket with optional fields", async () => {
      const ticket = await store.createTicket({
        ticket_type: "behavior_complaint",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: "WS-DRVR000001",
        order_public_id: "ORD-000001",
      });

      expect(ticket.subject_public_id).toBe("WS-DRVR000001");
      expect(ticket.order_public_id).toBe("ORD-000001");
    });
  });

  describe("getTicket", () => {
    it("returns null for unknown ticket", async () => {
      const ticket = await store.getTicket("unknown-id");
      expect(ticket).toBeNull();
    });

    it("returns the ticket after creation", async () => {
      const created = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });
      const ticket = await store.getTicket(created.ticket_id);
      expect(ticket).not.toBeNull();
      expect(ticket!.ticket_id).toBe(created.ticket_id);
    });
  });

  describe("updateState", () => {
    it("transitions open → investigating with evidence", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      // Attach evidence first
      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "photo",
        content_hash: "abc123",
        storage_ref: "s3://bucket/key",
      });

      const updated = await store.updateState(ticket.ticket_id, "investigating", {
        evidence_id: evidence.evidence_id,
      });

      expect(updated.state).toBe("investigating");
      expect(updated.investigating_at).toBeTruthy();
      expect(updated.evidence_id).toBe(evidence.evidence_id);
    });

    it("refuses investigating without evidence (evidence gate)", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      await expect(
        store.updateState(ticket.ticket_id, "investigating", {}),
      ).rejects.toThrow();
    });

    it("refuses invalid transition (open → resolved)", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      await expect(
        store.updateState(ticket.ticket_id, "resolved", {}),
      ).rejects.toThrow();
    });

    it("transitions investigating → escalated", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "photo",
        content_hash: "abc123",
        storage_ref: "s3://bucket/key",
      });

      await store.updateState(ticket.ticket_id, "investigating", {
        evidence_id: evidence.evidence_id,
      });
      const updated = await store.updateState(ticket.ticket_id, "escalated", {
        escalation_level: "support_supervisor",
      });

      expect(updated.state).toBe("escalated");
      expect(updated.escalation_level).toBe("support_supervisor");
      expect(updated.escalated_at).toBeTruthy();
    });

    it("throws not found for unknown ticket", async () => {
      await expect(
        store.updateState("unknown", "investigating", {}),
      ).rejects.toThrow();
    });
  });

  describe("attachEvidence", () => {
    it("attaches evidence to a ticket", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "message",
        content_hash: "sha256:abc",
        storage_ref: "s3://bucket/msg",
      });

      expect(evidence.evidence_type).toBe("message");
      expect(evidence.content_hash).toBe("sha256:abc");
      expect(evidence.ticket_id).toBe(ticket.ticket_id);
      expect(evidence.attached_at).toBeTruthy();
    });

    it("supports all evidence types", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      for (const type of SUPPORT_EVIDENCE_TYPES) {
        const evidence = await store.attachEvidence({
          ticket_id: ticket.ticket_id,
          evidence_type: type,
          content_hash: "hash",
          storage_ref: "ref",
        });
        expect(evidence.evidence_type).toBe(type);
      }
    });

    it("throws not found for unknown ticket", async () => {
      await expect(
        store.attachEvidence({
          ticket_id: "unknown",
          evidence_type: "photo",
          content_hash: "hash",
          storage_ref: "ref",
        }),
      ).rejects.toThrow();
    });
  });

  describe("getEvidence", () => {
    it("returns null for unknown evidence", async () => {
      const evidence = await store.getEvidence("unknown");
      expect(evidence).toBeNull();
    });

    it("returns evidence after attachment", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "photo",
        content_hash: "hash",
        storage_ref: "ref",
      });

      const found = await store.getEvidence(evidence.evidence_id);
      expect(found).not.toBeNull();
      expect(found!.content_hash).toBe("hash");
    });
  });

  describe("resolve", () => {
    it("resolves a ticket with evidence and reason", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "photo",
        content_hash: "hash",
        storage_ref: "ref",
      });

      await store.updateState(ticket.ticket_id, "investigating", {
        evidence_id: evidence.evidence_id,
      });

      const resolved = await store.resolve({
        ticket_id: ticket.ticket_id,
        resolution_reason: "refund_issued",
        evidence_id: evidence.evidence_id,
      });

      expect(resolved.state).toBe("resolved");
      expect(resolved.resolution_reason).toBe("refund_issued");
      expect(resolved.resolved_at).toBeTruthy();
    });

    it("refuses resolution without evidence (evidence gate)", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      await expect(
        store.resolve({
          ticket_id: ticket.ticket_id,
          resolution_reason: "refund_issued",
          evidence_id: "fake-evidence-id",
        }),
      ).rejects.toThrow();
    });

    it("supports all resolution reasons", async () => {
      for (const reason of SUPPORT_RESOLUTION_REASONS) {
        const ticket = await store.createTicket({
          ticket_type: "order_issue",
          reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
        });

        const evidence = await store.attachEvidence({
          ticket_id: ticket.ticket_id,
          evidence_type: "photo",
          content_hash: "hash",
          storage_ref: "ref",
        });

        await store.updateState(ticket.ticket_id, "investigating", {
          evidence_id: evidence.evidence_id,
        });

        const resolved = await store.resolve({
          ticket_id: ticket.ticket_id,
          resolution_reason: reason,
          evidence_id: evidence.evidence_id,
        });

        expect(resolved.resolution_reason).toBe(reason);
      }
    });

    it("throws not found for unknown ticket", async () => {
      await expect(
        store.resolve({
          ticket_id: "unknown",
          resolution_reason: "refund_issued",
          evidence_id: "evidence-id",
        }),
      ).rejects.toThrow();
    });
  });

  describe("events", () => {
    it("records ticket_opened event on create", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      const events = store.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe("support.ticket_opened");
      expect(events[0].aggregate_id).toBe(ticket.ticket_id);
      expect(events[0].payload.ticket_type).toBe("order_issue");
    });

    it("records ticket_resolved event on resolve", async () => {
      const ticket = await store.createTicket({
        ticket_type: "order_issue",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: null,
        order_public_id: null,
      });

      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "photo",
        content_hash: "hash",
        storage_ref: "ref",
      });

      await store.updateState(ticket.ticket_id, "investigating", {
        evidence_id: evidence.evidence_id,
      });

      await store.resolve({
        ticket_id: ticket.ticket_id,
        resolution_reason: "refund_issued",
        evidence_id: evidence.evidence_id,
      });

      const events = store.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("support.ticket_opened");
      expect(events[1].event_type).toBe("support.ticket_resolved");
      expect(events[1].payload.resolution_reason).toBe("refund_issued");
    });
  });

  describe("full lifecycle", () => {
    it("completes the full ticket lifecycle", async () => {
      // 1. Create
      const ticket = await store.createTicket({
        ticket_type: "payment_dispute",
        reporter_public_id: "WS-CUST000001",
        subject_public_id: "WS-DRVR000001",
        order_public_id: "ORD-000001",
      });
      expect(ticket.state).toBe("open");

      // 2. Attach evidence
      const evidence = await store.attachEvidence({
        ticket_id: ticket.ticket_id,
        evidence_type: "order_log",
        content_hash: "sha256:abc",
        storage_ref: "s3://logs/123",
      });

      // 3. Investigate
      const investigating = await store.updateState(ticket.ticket_id, "investigating", {
        evidence_id: evidence.evidence_id,
      });
      expect(investigating.state).toBe("investigating");

      // 4. Escalate
      const escalated = await store.updateState(ticket.ticket_id, "escalated", {
        escalation_level: "support_supervisor",
      });
      expect(escalated.state).toBe("escalated");
      expect(escalated.escalation_level).toBe("support_supervisor");

      // 5. Resolve
      const resolved = await store.resolve({
        ticket_id: ticket.ticket_id,
        resolution_reason: "warning_sent",
        evidence_id: evidence.evidence_id,
      });
      expect(resolved.state).toBe("resolved");
      expect(resolved.resolution_reason).toBe("warning_sent");

      // 6. Close
      const closed = await store.updateState(ticket.ticket_id, "closed", {});
      expect(closed.state).toBe("closed");
      expect(closed.closed_at).toBeTruthy();
    });
  });
});

describe("InMemorySupportEventPublisher", () => {
  it("publishes all three event types", async () => {
    const publisher = new InMemorySupportEventPublisher();

    await publisher.publishTicketOpened("ticket-1", "order_issue", "WS-CUST000001");
    await publisher.publishTicketEscalated("ticket-1", "support_supervisor");
    await publisher.publishTicketResolved("ticket-1", "refund_issued", "evidence-1");

    const events = publisher.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0].event_type).toBe("support.ticket_opened");
    expect(events[1].event_type).toBe("support.ticket_escalated");
    expect(events[2].event_type).toBe("support.ticket_resolved");
    expect(events[1].payload.escalation_level).toBe("support_supervisor");
    expect(events[2].payload.evidence_id).toBe("evidence-1");
  });

  it("does not include PII in event payloads", async () => {
    const publisher = new InMemorySupportEventPublisher();

    await publisher.publishTicketOpened("ticket-1", "order_issue", "WS-CUST000001");

    const events = publisher.getEvents();
    const payload = events[0].payload as Record<string, unknown>;
    // No PII fields
    expect(payload).not.toHaveProperty("chat_id");
    expect(payload).not.toHaveProperty("telegram");
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("free_text");
  });
});
