import { describe, it, expect } from "vitest";
import {
  classifyOrderEvent,
  isSuggestionTrigger,
  isTerminal,
  isBefore,
  ZERO_CHECKPOINT,
  OrderPayloadError,
  type OrderOutboxRow,
  type RelayCheckpoint,
} from "../domain/consumed-events.js";
import { runRelayBatch } from "../relay.js";
import type { RelayDeps, SupportTicketStore, SupportEventPublisher } from "../ports.js";
import {
  InMemoryCheckpointStore,
  InMemoryDeadLetterStore,
  InMemoryConsumerLock,
} from "../infrastructure/relay-stores.js";
import { InMemoryOrderEventSource } from "../infrastructure/relay-event-source.js";
import { InMemorySupportTicketStore } from "../infrastructure/in-memory.js";
import { InMemorySupportEventPublisher } from "../infrastructure/in-memory.js";

/* ── helpers ── */

function makeRow(overrides: Partial<OrderOutboxRow> = {}): OrderOutboxRow {
  return {
    event_id: crypto.randomUUID(),
    event_type: "order.status_changed",
    event_version: "v1",
    aggregate_type: "order",
    aggregate_id: "ORD-1234567890",
    occurred_at: new Date().toISOString(),
    trace_id: null,
    data: {
      order_public_id: "ORD-1234567890",
      customer_public_id: "WS-1234567890",
      to_status: "completed",
      from_status: "in_progress",
      sequence: 5,
      actor_type: "system",
      is_terminal: true,
    },
    ...overrides,
  };
}

function makeDeps(rows: OrderOutboxRow[] = []): { deps: RelayDeps; stores: TestStores } {
  const eventSource = new InMemoryOrderEventSource(rows);
  const checkpoint = new InMemoryCheckpointStore();
  const deadLetter = new InMemoryDeadLetterStore();
  const lock = new InMemoryConsumerLock();
  const tickets = new InMemorySupportTicketStore();
  const publisher = new InMemorySupportEventPublisher();

  const deps: RelayDeps = {
    events: eventSource,
    tickets: tickets as unknown as SupportTicketStore,
    checkpoint,
    deadLetter,
    lock,
    publisher: publisher as unknown as SupportEventPublisher,
  };

  return {
    deps,
    stores: { eventSource, checkpoint, deadLetter, lock, tickets, publisher },
  };
}

interface TestStores {
  eventSource: InMemoryOrderEventSource;
  checkpoint: InMemoryCheckpointStore;
  deadLetter: InMemoryDeadLetterStore;
  lock: InMemoryConsumerLock;
  tickets: InMemorySupportTicketStore;
  publisher: InMemorySupportEventPublisher;
}

/* ── domain unit tests ── */

describe("consumed-events domain", () => {
  describe("isSuggestionTrigger", () => {
    it("returns true for completed", () => {
      expect(isSuggestionTrigger("completed")).toBe(true);
    });

    it("returns true for customer_cancelled", () => {
      expect(isSuggestionTrigger("customer_cancelled")).toBe(true);
    });

    it("returns true for driver_cancelled", () => {
      expect(isSuggestionTrigger("driver_cancelled")).toBe(true);
    });

    it("returns true for partner_cancelled", () => {
      expect(isSuggestionTrigger("partner_cancelled")).toBe(true);
    });

    it("returns true for failed", () => {
      expect(isSuggestionTrigger("failed")).toBe(true);
    });

    it("returns true for payment_disputed", () => {
      expect(isSuggestionTrigger("payment_disputed")).toBe(true);
    });

    it("returns false for non-trigger states", () => {
      expect(isSuggestionTrigger("published")).toBe(false);
      expect(isSuggestionTrigger("searching")).toBe(false);
      expect(isSuggestionTrigger("assigned")).toBe(false);
      expect(isSuggestionTrigger("in_progress")).toBe(false);
    });
  });

  describe("isTerminal", () => {
    it("returns false for pending", () => {
      expect(isTerminal("pending")).toBe(false);
    });

    it("returns true for all non-pending statuses", () => {
      expect(isTerminal("suggested")).toBe(true);
      expect(isTerminal("ignored")).toBe(true);
      expect(isTerminal("ignored_foreign")).toBe(true);
      expect(isTerminal("skipped_stale")).toBe(true);
      expect(isTerminal("poisoned")).toBe(true);
    });
  });

  describe("isBefore", () => {
    it("compares by occurred_at first", () => {
      const a: RelayCheckpoint = { last_occurred_at: "2024-01-01T00:00:00Z", last_event_id: "aaa" };
      const b: RelayCheckpoint = { last_occurred_at: "2024-01-02T00:00:00Z", last_event_id: "bbb" };
      expect(isBefore(a, b)).toBe(true);
      expect(isBefore(b, a)).toBe(false);
    });

    it("breaks ties by event_id", () => {
      const a: RelayCheckpoint = { last_occurred_at: "2024-01-01T00:00:00Z", last_event_id: "aaa" };
      const b: RelayCheckpoint = { last_occurred_at: "2024-01-01T00:00:00Z", last_event_id: "bbb" };
      expect(isBefore(a, b)).toBe(true);
      expect(isBefore(b, a)).toBe(false);
    });

    it("returns false for equal checkpoints", () => {
      const a: RelayCheckpoint = { last_occurred_at: "2024-01-01T00:00:00Z", last_event_id: "aaa" };
      expect(isBefore(a, a)).toBe(false);
    });
  });

  describe("classifyOrderEvent", () => {
    it("classifies a terminal order event as suggest", () => {
      const row = makeRow();
      const result = classifyOrderEvent(row);
      expect(result.kind).toBe("suggest");
    });

    it("classifies a non-trigger terminal state as ignored", () => {
      const row = makeRow({
        data: {
          order_public_id: "ORD-1234567890",
          customer_public_id: "WS-1234567890",
          to_status: "blocked",
          from_status: "in_progress",
          sequence: 5,
          actor_type: "system",
          is_terminal: true,
        },
      });
      const result = classifyOrderEvent(row);
      expect(result.kind).toBe("ignored");
    });

    it("classifies a foreign event type as ignored", () => {
      const row = makeRow({ event_type: "order.some_other_event" });
      const result = classifyOrderEvent(row);
      expect(result.kind).toBe("ignored");
    });

    it("throws OrderPayloadError on missing order_public_id", () => {
      const row = makeRow({
        data: {
          customer_public_id: "WS-1234567890",
          to_status: "completed",
          from_status: null,
          sequence: 1,
          actor_type: "system",
          is_terminal: true,
        },
      });
      expect(() => classifyOrderEvent(row)).toThrow(OrderPayloadError);
    });

    it("throws OrderPayloadError on invalid customer_public_id format", () => {
      const row = makeRow({
        data: {
          order_public_id: "ORD-1234567890",
          customer_public_id: "invalid-id",
          to_status: "completed",
          from_status: null,
          sequence: 1,
          actor_type: "system",
          is_terminal: true,
        },
      });
      expect(() => classifyOrderEvent(row)).toThrow(OrderPayloadError);
    });

    it("throws OrderPayloadError on non-integer sequence", () => {
      const row = makeRow({
        data: {
          order_public_id: "ORD-1234567890",
          customer_public_id: "WS-1234567890",
          to_status: "completed",
          from_status: null,
          sequence: 1.5,
          actor_type: "system",
          is_terminal: true,
        },
      });
      expect(() => classifyOrderEvent(row)).toThrow(OrderPayloadError);
    });

    it("throws OrderPayloadError on non-boolean is_terminal", () => {
      const row = makeRow({
        data: {
          order_public_id: "ORD-1234567890",
          customer_public_id: "WS-1234567890",
          to_status: "completed",
          from_status: null,
          sequence: 1,
          actor_type: "system",
          is_terminal: "true",
        },
      });
      expect(() => classifyOrderEvent(row)).toThrow(OrderPayloadError);
    });

    it("accepts null from_status (order creation)", () => {
      const row = makeRow({
        data: {
          order_public_id: "ORD-1234567890",
          customer_public_id: "WS-1234567890",
          to_status: "customer_cancelled",
          from_status: null,
          sequence: 1,
          actor_type: "customer",
          is_terminal: true,
        },
      });
      const result = classifyOrderEvent(row);
      expect(result.kind).toBe("suggest");
    });
  });
});

/* ── relay batch tests ── */

describe("relay consumer", () => {
  describe("runRelayBatch", () => {
    it("processes a terminal order event and suggests a ticket", async () => {
      const row = makeRow();
      const { deps, stores } = makeDeps([row]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(1);
      expect(result.suggested).toBe(1);
      expect(result.ignored).toBe(0);
      expect(result.poisoned).toBe(0);

      const tickets = stores.tickets.getAllTickets();
      expect(tickets).toHaveLength(1);
      expect(tickets[0].ticket_type).toBe("order_issue");
      expect(tickets[0].state).toBe("open");
      expect(tickets[0].order_public_id).toBe("ORD-1234567890");
      expect(tickets[0].reporter_public_id).toBe("WS-1234567890");

      const published = stores.publisher.getEvents();
      expect(published).toHaveLength(1);
      expect(published[0].event_type).toBe("support.ticket_opened");
    });

    it("ignores non-trigger terminal states", async () => {
      const row = makeRow({
        data: {
          order_public_id: "ORD-1234567890",
          customer_public_id: "WS-1234567890",
          to_status: "blocked",
          from_status: "in_progress",
          sequence: 5,
          actor_type: "system",
          is_terminal: true,
        },
      });
      const { deps, stores } = makeDeps([row]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(1);
      expect(result.suggested).toBe(0);
      expect(result.ignored).toBe(1);
      expect(stores.tickets.getAllTickets()).toHaveLength(0);
    });

    it("ignores foreign event types", async () => {
      const row = makeRow({ event_type: "order.some_other_event" });
      const { deps } = makeDeps([row]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(1);
      expect(result.suggested).toBe(0);
      expect(result.ignored).toBe(1);
      expect(result.ignored).toBe(1);
    });

    it("poisons events with unsupported versions", async () => {
      const row = makeRow({ event_version: "v2" });
      const { deps, stores } = makeDeps([row]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(1);
      expect(result.poisoned).toBe(1);
      expect(stores.deadLetter.deadLetters).toHaveLength(1);
      expect(stores.deadLetter.deadLetters[0].reason).toContain("unsupported");
    });

    it("poisons events with invalid payloads", async () => {
      const row = makeRow({
        data: {
          order_public_id: "invalid",
          customer_public_id: "WS-1234567890",
          to_status: "completed",
          from_status: null,
          sequence: 1,
          actor_type: "system",
          is_terminal: true,
        },
      });
      const { deps, stores } = makeDeps([row]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(1);
      expect(result.poisoned).toBe(1);
      expect(stores.deadLetter.deadLetters).toHaveLength(1);
    });

    it("skips stale events (already consumed)", async () => {
      const oldRow = makeRow({
        occurred_at: "2024-01-01T00:00:00Z",
        event_id: "00000000-0000-0000-0000-000000000001",
      });
      const { deps, stores } = makeDeps([oldRow]);

      // First batch consumes it
      await runRelayBatch(deps);

      // Second batch — the event source filters past the checkpoint,
      // so 0 rows are read. The checkpoint stays at the consumed event.
      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(0);
      expect(result.suggested).toBe(0);
      expect(result.checkpoint.last_event_id).toBe("00000000-0000-0000-0000-000000000001");

      // Re-adding the same row simulates a redelivery — it should be
      // skipped_stale because it's at or before the checkpoint.
      stores.eventSource.addRows([oldRow]);
      const result2 = await runRelayBatch(deps);
      expect(result2.processed).toBe(0);
      expect(result2.skipped_stale).toBe(0);
    });

    it("processes multiple events in order", async () => {
      const row1 = makeRow({
        occurred_at: "2024-01-01T00:00:00Z",
        event_id: "00000000-0000-0000-0000-000000000001",
      });
      const row2 = makeRow({
        occurred_at: "2024-01-01T00:00:01Z",
        event_id: "00000000-0000-0000-0000-000000000002",
        data: {
          order_public_id: "ORD-9876543210",
          customer_public_id: "WS-9876543210",
          to_status: "customer_cancelled",
          from_status: "published",
          sequence: 2,
          actor_type: "customer",
          is_terminal: true,
        },
      });
      const { deps, stores } = makeDeps([row1, row2]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(2);
      expect(result.suggested).toBe(2);

      const tickets = stores.tickets.getAllTickets();
      expect(tickets).toHaveLength(2);
      expect(tickets[0].order_public_id).toBe("ORD-1234567890");
      expect(tickets[1].order_public_id).toBe("ORD-9876543210");
    });

    it("writes checkpoint after processing", async () => {
      const row = makeRow({
        occurred_at: "2024-01-01T00:00:00Z",
        event_id: "00000000-0000-0000-0000-000000000001",
      });
      const { deps, stores } = makeDeps([row]);

      await runRelayBatch(deps);

      const cp = await stores.checkpoint.getCheckpoint("support-order-relay-v1");
      expect(cp).not.toBeNull();
      expect(cp!.last_occurred_at).toBe("2024-01-01T00:00:00Z");
      expect(cp!.last_event_id).toBe("00000000-0000-0000-0000-000000000001");
    });

    it("processes an empty batch gracefully", async () => {
      const { deps } = makeDeps([]);

      const result = await runRelayBatch(deps);

      expect(result.processed).toBe(0);
      expect(result.suggested).toBe(0);
      expect(result.checkpoint).toEqual(ZERO_CHECKPOINT);
    });

    it("suggests a ticket for each trigger state", async () => {
      const triggerStates = [
        "completed",
        "customer_cancelled",
        "driver_cancelled",
        "partner_cancelled",
        "failed",
        "payment_disputed",
      ];

      for (const state of triggerStates) {
        const row = makeRow({
          event_id: crypto.randomUUID(),
          data: {
            order_public_id: "ORD-1234567890",
            customer_public_id: "WS-1234567890",
            to_status: state,
            from_status: "in_progress",
            sequence: 5,
            actor_type: "system",
            is_terminal: true,
          },
        });
        const { deps, stores } = makeDeps([row]);

        const result = await runRelayBatch(deps);

        expect(result.suggested, `state ${state} should trigger a suggestion`).toBe(1);
        const tickets = stores.tickets.getAllTickets();
        expect(tickets).toHaveLength(1);
        expect(tickets[0].ticket_type).toBe("order_issue");
      }
    });
  });
});
