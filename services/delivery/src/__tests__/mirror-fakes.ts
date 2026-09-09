/**
 * In-memory TaskMirrorStore + DispatchEventSource fakes (ADR-026 §4.2 —
 * unit-review boundary: no Postgres here, by declared deferral).
 *
 * The fake mirrors what a Postgres adapter must do in ONE transaction:
 * task update + transition ledger + delivery_outbox append + consumed
 * ledger + watermark — so engine guarantees are tested against the same
 * atomicity contract the real adapter will implement.
 */

import type { ConsumedStatus, DispatchOutboxRow, RelayCheckpoint } from "../domain/consumed-events.js";
import type { MirrorTransition } from "../domain/dispatch-mirror.js";
import {
  deliveryDriverAssignedEvent,
  deliveryStatusChangedEvent,
  deliveryTaskCancelledEvent,
  type DeliveryDomainEvent,
} from "../domain/events.js";
import type { DispatchEventSource, MirrorContext, TaskMirrorStore } from "../ports.js";

export interface FakeTask {
  taskId: string;
  orderId: string;
  state: string;
  courierRef: string | null;
  assignedAt: string | null;
  dispatchJobRef: string | null;
}

export interface FakeTransitionRow {
  taskId: string;
  from: string;
  to: string;
  reasonCode: string;
  actorType: string;
  actorRef: string | null;
  traceId: string | null;
  occurredAt: string;
}

export interface FakeConsumedRow {
  eventId: string;
  eventType: string;
  aggregateId: string;
  status: ConsumedStatus;
  attemptCount: number;
  lastError: string | null;
}

export class InMemoryMirrorStore implements TaskMirrorStore {
  readonly tasks = new Map<string, FakeTask>();
  readonly transitions: FakeTransitionRow[] = [];
  readonly outbox: DeliveryDomainEvent[] = [];
  readonly consumed = new Map<string, FakeConsumedRow>();
  /** Per-task watermark — derived state a pg adapter computes from the consumed ledger. */
  readonly watermarks = new Map<string, RelayCheckpoint>();
  readonly checkpoints = new Map<string, RelayCheckpoint>();
  /** Test hook: throw on the Nth applyMirrorTransition call (retry testing). */
  failApplyNTimes = 0;
  private applyCalls = 0;

  bindTask(task: FakeTask): void {
    this.tasks.set(task.taskId, task);
  }

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    return this.checkpoints.get(consumerId) ?? null;
  }

  async writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void> {
    this.checkpoints.set(consumerId, checkpoint);
  }

  async getTaskByJobRef(jobId: string) {
    const found = [...this.tasks.values()].filter((t) => t.dispatchJobRef === jobId);
    return found.map((t) => ({
      taskId: t.taskId,
      state: t.state,
      lastDispatchEvent: this.watermarks.get(t.taskId) ?? null,
    }));
  }

  async applyMirrorTransition(taskId: string, transition: MirrorTransition, context: MirrorContext): Promise<void> {
    if (this.failApplyNTimes > 0 && this.applyCalls < this.failApplyNTimes) {
      this.applyCalls += 1;
      throw new Error("injected store failure");
    }
    this.applyCalls += 1;
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);
    const from = task.state;
    const updated: FakeTask = {
      ...task,
      state: transition.to,
      courierRef: transition.courierRef ?? task.courierRef,
      assignedAt: transition.assignedAt ?? task.assignedAt,
    };
    this.tasks.set(taskId, updated);

    this.transitions.push({
      taskId,
      from,
      to: transition.to,
      reasonCode: transition.ledgerReason,
      actorType: "dispatch",
      actorRef: transition.courierRef ?? null,
      traceId: context.traceId,
      occurredAt: context.occurredAt,
    });

    this.outbox.push(this.buildEvent(updated, from, transition, context));
    this.watermarks.set(taskId, { last_occurred_at: context.occurredAt, last_event_id: context.eventId });
  }

  async recordConsumedNoOp(taskId: string, context: MirrorContext): Promise<void> {
    const prev = this.watermarks.get(taskId) ?? null;
    const next = { last_occurred_at: context.occurredAt, last_event_id: context.eventId };
    if (!prev || next.last_occurred_at > prev.last_occurred_at) {
      this.watermarks.set(taskId, next);
    }
  }

  async getConsumed(eventId: string) {
    const row = this.consumed.get(eventId);
    return row ? { status: row.status, attempt_count: row.attemptCount } : null;
  }

  async markConsumed(
    eventId: string,
    row: Pick<DispatchOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: ConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void> {
    const existing = this.consumed.get(eventId);
    this.consumed.set(eventId, {
      eventId,
      eventType: row.event_type,
      aggregateId: row.aggregate_id,
      status,
      attemptCount,
      lastError: lastError ?? existing?.lastError ?? null,
    });
  }

  async clearMirrorState(): Promise<void> {
    this.transitions.length = 0;
    this.consumed.clear();
    this.watermarks.clear();
    this.checkpoints.clear();
    for (const t of this.tasks.values()) {
      // Rebuild from the delegation point: a bound task rebuilds from
      // dispatch_requested — the wire bound the job there.
      if (t.dispatchJobRef) {
        t.state = "dispatch_requested";
        t.courierRef = null;
        t.assignedAt = null;
      }
    }
  }

  private buildEvent(task: FakeTask, from: string, transition: MirrorTransition, context: MirrorContext): DeliveryDomainEvent {
    const ctx = { eventId: context.eventId, occurredAt: context.occurredAt, traceId: context.traceId };
    const domainTask = {
      taskId: task.taskId,
      orderId: task.orderId,
      state: task.state,
      courierRef: task.courierRef,
      version: 1,
    } as never;
    if (transition.emit.eventKind === "driver_assigned") {
      return deliveryDriverAssignedEvent(domainTask, from as never, transition.emit.reason, ctx);
    }
    if (transition.emit.eventKind === "status_changed") {
      return deliveryStatusChangedEvent(domainTask, from as never, transition.emit.reason, ctx, { actor_type: "dispatch", actor_ref: null });
    }
    return deliveryTaskCancelledEvent(domainTask, from as never, transition.emit.reason, ctx);
  }
}

/** Reads a scripted list of rows after the checkpoint (stream order). */
export class ScriptedEventSource implements DispatchEventSource {
  constructor(readonly rows: readonly DispatchOutboxRow[]) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly DispatchOutboxRow[]> {
    const sorted = [...this.rows].sort((a, b) =>
      a.occurred_at === b.occurred_at ? a.event_id.localeCompare(b.event_id) : a.occurred_at.localeCompare(b.occurred_at),
    );
    const after = sorted.filter((r) => {
      if (!checkpoint) return true;
      if (r.occurred_at !== checkpoint.last_occurred_at) return r.occurred_at > checkpoint.last_occurred_at;
      return r.event_id > checkpoint.last_event_id;
    });
    return after.slice(0, limit);
  }
}

/** Convenience builder for a dispatch outbox row. */
export function dispatchRow(overrides: Partial<DispatchOutboxRow> & { event_id: string; event_type: DispatchOutboxRow["event_type"]; data: Record<string, unknown> }): DispatchOutboxRow {
  return {
    event_version: "v1",
    aggregate_type: "dispatch_job",
    aggregate_id: "job-agg-1",
    occurred_at: "2026-09-09T10:00:00.000Z",
    trace_id: null,
    ...overrides,
  };
}
