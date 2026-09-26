import { describe, it, expect } from "vitest";
import { createSupportApp } from "../http/app.js";
import type { SupportHttpDeps } from "../http/app.js";
import { InMemorySupportTicketStore } from "../infrastructure/in-memory.js";
import { InMemorySupportEventPublisher } from "../infrastructure/in-memory.js";
import { InMemoryReputationBridge } from "../infrastructure/reputation-bridge.js";
import type { SupportTicket } from "../domain/model.js";

function createApp(bridge?: InMemoryReputationBridge): {
  app: ReturnType<typeof createSupportApp>;
  store: InMemorySupportTicketStore;
  publisher: InMemorySupportEventPublisher;
  bridge: InMemoryReputationBridge;
} {
  const store = new InMemorySupportTicketStore();
  const publisher = new InMemorySupportEventPublisher();
  const reputationBridge = bridge ?? new InMemoryReputationBridge();
  const deps: SupportHttpDeps = { store, publisher, reputationBridge };
  return { app: createSupportApp(deps), store, publisher, bridge: reputationBridge };
}

async function createTicketWithSubject(
  app: ReturnType<typeof createSupportApp>,
  subjectPublicId: string | null = "WS-1234567890",
): Promise<SupportTicket> {
  const res = await app.inject({
    method: "POST",
    url: "/support/tickets",
    payload: {
      ticket_type: "behavior_complaint",
      reporter_public_id: "WS-9876543210",
      subject_public_id: subjectPublicId,
      order_public_id: "ORD-1234567890",
    },
  });
  return res.json() as Promise<SupportTicket>;
}

async function attachEvidence(
  app: ReturnType<typeof createSupportApp>,
  ticketId: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/support/tickets/${ticketId}/evidence`,
    payload: {
      evidence_type: "photo",
      content_hash: "abc123",
      storage_ref: "s3://bucket/key",
    },
  });
  const evidence = res.json() as { evidence_id: string };
  return evidence.evidence_id;
}

describe("reputation bridge", () => {
  describe("InMemoryReputationBridge", () => {
    it("records dispute_resolved fact", async () => {
      const bridge = new InMemoryReputationBridge();
      await bridge.recordDisputeResolved({
        ticketId: "ticket-1",
        subjectPublicId: "WS-1234567890",
        orderPublicId: "ORD-1234567890",
        resolutionReason: "refund_issued",
      });
      expect(bridge.recordedFacts).toHaveLength(1);
      expect(bridge.recordedFacts[0].ticketId).toBe("ticket-1");
      expect(bridge.recordedFacts[0].subjectPublicId).toBe("WS-1234567890");
      expect(bridge.recordedFacts[0].orderPublicId).toBe("ORD-1234567890");
      expect(bridge.recordedFacts[0].resolutionReason).toBe("refund_issued");
    });

    it("records multiple facts", async () => {
      const bridge = new InMemoryReputationBridge();
      for (let i = 0; i < 3; i++) {
        await bridge.recordDisputeResolved({
          ticketId: `ticket-${i}`,
          subjectPublicId: `WS-123456789${i}`,
          orderPublicId: `ORD-123456789${i}`,
          resolutionReason: "warning_sent",
        });
      }
      expect(bridge.recordedFacts).toHaveLength(3);
    });

    it("reset clears recorded facts", async () => {
      const bridge = new InMemoryReputationBridge();
      await bridge.recordDisputeResolved({
        ticketId: "ticket-1",
        subjectPublicId: "WS-1234567890",
        orderPublicId: null,
        resolutionReason: "no_action_needed",
      });
      bridge.reset();
      expect(bridge.recordedFacts).toHaveLength(0);
    });
  });

  describe("HTTP resolve handler integration", () => {
    it("records dispute_resolved when ticket is resolved with subject", async () => {
      const { app, store, bridge } = createApp();

      const ticket = await createTicketWithSubject(app);
      const evidenceId = await attachEvidence(app, ticket.ticket_id);

      // Move to investigating first (required by state machine)
      await store.updateState(ticket.ticket_id, "investigating", {});

      await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket.ticket_id}/resolve`,
        payload: {
          resolution_reason: "refund_issued",
          evidence_id: evidenceId,
        },
      });

      expect(bridge.recordedFacts).toHaveLength(1);
      expect(bridge.recordedFacts[0].subjectPublicId).toBe("WS-1234567890");
      expect(bridge.recordedFacts[0].orderPublicId).toBe("ORD-1234567890");
      expect(bridge.recordedFacts[0].resolutionReason).toBe("refund_issued");
    });

    it("does not record when ticket has no subject_public_id", async () => {
      const { app, store, bridge } = createApp();

      const ticket = await createTicketWithSubject(app, null);
      const evidenceId = await attachEvidence(app, ticket.ticket_id);

      await store.updateState(ticket.ticket_id, "investigating", {});

      await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket.ticket_id}/resolve`,
        payload: {
          resolution_reason: "no_action_needed",
          evidence_id: evidenceId,
        },
      });

      expect(bridge.recordedFacts).toHaveLength(0);
    });

    it("still resolves ticket when bridge throws", async () => {
      const failingBridge = new InMemoryReputationBridge();
      failingBridge.recordDisputeResolved = async () => {
        throw new Error("reputation service unavailable");
      };

      const { app, store } = createApp(failingBridge);

      const ticket = await createTicketWithSubject(app);
      const evidenceId = await attachEvidence(app, ticket.ticket_id);

      await store.updateState(ticket.ticket_id, "investigating", {});

      const res = await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket.ticket_id}/resolve`,
        payload: {
          resolution_reason: "refund_issued",
          evidence_id: evidenceId,
        },
      });

      expect(res.statusCode).toBe(200);
      const resolved = res.json() as SupportTicket;
      expect(resolved.state).toBe("resolved");
    });

    it("does not record when bridge is not provided", async () => {
      const store = new InMemorySupportTicketStore();
      const publisher = new InMemorySupportEventPublisher();
      const deps: SupportHttpDeps = { store, publisher };
      const app = createSupportApp(deps);

      const ticket = await createTicketWithSubject(app);
      const evidenceId = await attachEvidence(app, ticket.ticket_id);

      await store.updateState(ticket.ticket_id, "investigating", {});

      await app.inject({
        method: "POST",
        url: `/support/tickets/${ticket.ticket_id}/resolve`,
        payload: {
          resolution_reason: "refund_issued",
          evidence_id: evidenceId,
        },
      });

      // No bridge → no facts recorded (no error either)
      const resolvedTicket = await store.getTicket(ticket.ticket_id);
      expect(resolvedTicket?.state).toBe("resolved");
    });
  });
});
