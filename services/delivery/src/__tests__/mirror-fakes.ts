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
import type { DispatchEventSource, MirrorContext, RelayConsumerLock, TaskMirrorStore } from "../ports.js";

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

/* ════════════════════════════════════════════════════════════════════════
 * Delegation fakes (review 4/N — the command side, ADR-026 §2.4).
 * The fake store mirrors what the Postgres adapter does in ONE transaction
 * (ref + eligible→dispatch_requested + ledger + outbox event), and the fake
 * requester mirrors dispatch's create-job idempotency (same key → same job,
 * never a second one) — the two facts §4.6-2 needs from the wire's test seam.
 * ════════════════════════════════════════════════════════════════════════ */

import type { DelegatableTask, MutableDelegatableTask } from "../domain/delegation.js";
import {
  DELEGATION_SOURCE_STATE,
  DELEGATION_TARGET_STATE,
  DISPATCH_DELEGATION_LEDGER_REASON,
  deriveDelegationIdempotencyKey,
} from "../domain/delegation.js";
import type { DelegationContext, DispatchDelegationCommand, DispatchJobRequestOutcome, DispatchJobRequester, TaskDelegationStore } from "../ports.js";
import { DeliveryError } from "../domain/errors.js";

export class InMemoryDelegationStore implements TaskDelegationStore {
  readonly tasks = new Map<string, MutableDelegatableTask & { ledger: { from: string; to: string; reason: string; actor: string; occurredAt: string }[]; outbox: string[] }>();

  bindTask(task: DelegatableTask): void {
    this.tasks.set(task.taskId, { ...task, ledger: [], outbox: [] });
  }

  async getTaskForDelegation(taskId: string): Promise<DelegatableTask | null> {
    const t = this.tasks.get(taskId);
    return t ? { taskId: t.taskId, orderId: t.orderId, state: t.state, dispatchJobRef: t.dispatchJobRef } : null;
  }

  async bindDispatchJob(taskId: string, jobRef: string, context: DelegationContext): Promise<"bound" | "already_bound"> {
    const t = this.tasks.get(taskId);
    if (!t) {
      throw new DeliveryError("DELIVERY_TASK_NOT_FOUND", `مهمّة التوصيل ${taskId} غير موجودة`, { traceId: context.traceId ?? undefined });
    }
    if (t.dispatchJobRef !== null) {
      if (t.dispatchJobRef === jobRef) return "already_bound";
      throw new DeliveryError(
        "DELIVERY_CONCURRENT_UPDATE",
        `المهمّة مربوطةٌ بمهمّةِ توزيعٍ أخرى (${t.dispatchJobRef})`,
        { traceId: context.traceId ?? undefined, details: { field: "dispatch_job_ref", expected: jobRef, actual: t.dispatchJobRef } },
      );
    }
    if (t.state !== DELEGATION_SOURCE_STATE) {
      throw new DeliveryError(
        "DELIVERY_TRANSITION_NOT_ALLOWED",
        `التفويضُ يبدأُ من ${DELEGATION_SOURCE_STATE} فقط — المهمّةُ في ${t.state}`,
        { traceId: context.traceId ?? undefined, details: { from: t.state, to: DELEGATION_TARGET_STATE } },
      );
    }
    // The atomic bind, in memory: state + ref + ledger row + outbox event id.
    t.state = DELEGATION_TARGET_STATE;
    t.dispatchJobRef = jobRef;
    t.ledger.push({ from: DELEGATION_SOURCE_STATE, to: DELEGATION_TARGET_STATE, reason: DISPATCH_DELEGATION_LEDGER_REASON, actor: "system", occurredAt: context.occurredAt });
    t.outbox.push(context.eventId);
    return "bound";
  }
}

/** A scripted dispatch bridge — records commands, scripts outcomes/failures. */
export class FakeDispatchJobRequester implements DispatchJobRequester {
  readonly commands: DispatchDelegationCommand[] = []
  /** Key → job ref, dispatch's remembered idempotency. */
  readonly remembered = new Map<string, string>();
  /** Queue of outcomes or thrown errors, one per NEW key. */
  readonly script: (DispatchJobRequestOutcome | Error)[] = []
  /** When true, requestJob throws once for a new key then succeeds on retry. */
  failFirstNKeys = 0;

  async requestJob(command: DispatchDelegationCommand): Promise<DispatchJobRequestOutcome> {
    this.commands.push(command);
    const rememberedRef = this.remembered.get(command.idempotencyKey);
    if (rememberedRef !== undefined) {
      return { jobRef: rememberedRef, replayed: true };
    }
    if (this.failFirstNKeys > 0) {
      this.failFirstNKeys -= 1;
      throw new Error("dispatch bridge unavailable (scripted)");
    }
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    const outcome: DispatchJobRequestOutcome = next ?? { jobRef: `job-${this.commands.length}`, replayed: false };
    this.remembered.set(command.idempotencyKey, outcome.jobRef);
    return outcome;
  }
}

/**
 * قفلُ مُستهلِكٍ زائفٌ **يُسجِّلُ ولا يحجبُ** (M5-13R · §4.24-ب) — لاختباراتِ
 * المحرّكِ الصافيةِ: يُثبِتُ أنَّ الحيازةَ والإطلاقَ يحصلانِ في الترتيبِ الصحيحِ
 * حولَ الدفعةِ، ويُتيحُ تسجيلَ تسلسلِ الدُعواتِ في الاختباراتِ التي تُريدُ مُشاهدةَ
 * ترتيبِ الحُقولِ لا حجبَها.
 */
export class RecordingRelayLock implements RelayConsumerLock {
  /** تُنادى قبلَ `fn` وبعدَهُ — للتحقُّقِ من الترتيبِ بدقّةٍ في الاختباراتِ. */
  readonly calls: Array<{ consumerId: string; phase: "acquire" | "release"; at: number }> = [];
  private n = 0;

  async withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T> {
    this.calls.push({ consumerId, phase: "acquire", at: ++this.n });
    try {
      return await fn();
    } finally {
      this.calls.push({ consumerId, phase: "release", at: ++this.n });
    }
  }

  /** كلُّ حيازةٍ أُطلِقَت؟ — دفاعٌ ضدَّ تسريبٍ يُخضِرُ اختبارًا ويُسرِّبُ في الإنتاجِ. */
  get balanced(): boolean {
    const acquires = this.calls.filter((c) => c.phase === "acquire").length;
    const releases = this.calls.filter((c) => c.phase === "release").length;
    return acquires === releases;
  }
}

/** Deterministic id/clock for tests — readable event ids and ISO stamps. */
export function deterministicIds(prefix = "evt") {
  let n = 0;
  return {
    ids: { uuid: () => `${prefix}-${String(++n).padStart(4, "0")}` },
    clock: { now: () => new Date("2026-09-09T12:00:00.000Z").toISOString() },
  };
}

export { deriveDelegationIdempotencyKey };
