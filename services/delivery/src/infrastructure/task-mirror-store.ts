/**
 * PostgresTaskMirrorStore — the delivery-owned state the dispatch-relay
 * mirror writes (ADR-026 §2.4/§4.2, review 3/N). Everything a mirror
 * transition touches happens in ONE transaction:
 *
 *   delivery_tasks (state + courier + assignedAt + watermark + version)
 *   + delivery_task_transitions (append-only ledger row, actor `dispatch`)
 *   + delivery_outbox (the mirror's `delivery.*` event)
 *
 * …so a crash mid-apply leaves NOTHING behind — proven on real Postgres in
 * `relay.integration.test.ts` (rollback test), not asserted in memory.
 *
 * Idempotency, two layers (port contract: "idempotent per (task, eventId)"):
 *   1. the outbox insert is `ON CONFLICT (event_id) DO NOTHING` — the mirror
 *      event's id IS the dispatch event's id, so a rebuild after
 *      `clearMirrorState` (which never clears delivery_outbox — append-only
 *      by design, relay.rebuildAll) re-emits the same id as a no-op;
 *   2. the task watermark (`dispatch_last_occurred_at/event_id`) makes a
 *      redelivered older event `skipped_stale` before it reaches this store.
 *
 * The consumed ledger is written by the relay via `markConsumed` (as in the
 * in-memory fake) — if the process dies between `applyMirrorTransition` and
 * `markConsumed`, the watermark is what stops a redelivery from re-applying.
 *
 * Read-only towards dispatch: this store NEVER writes `dispatch_outbox`
 * (no `published_at`) — same boundary rule as ADR-025 §2.3.
 */

import type { Pool, PoolClient } from "pg";
import type { ConsumedStatus, DispatchOutboxRow, RelayCheckpoint } from "../domain/consumed-events.js";
import type { MirrorTransition } from "../domain/dispatch-mirror.js";
import {
  DELEGATION_SOURCE_STATE,
  DELEGATION_TARGET_STATE,
  DISPATCH_DELEGATION_LEDGER_REASON,
  type DelegatableTask,
} from "../domain/delegation.js";
import { DeliveryError } from "../domain/errors.js";
import type { DelegationContext, MirrorContext, TaskDelegationStore, TaskMirrorStore } from "../ports.js";
import {
  deliveryDispatchRequestedEvent,
  deliveryDriverAssignedEvent,
  deliveryStatusChangedEvent,
  deliveryTaskCancelledEvent,
  type DeliveryDomainEvent,
} from "../domain/events.js";

/** The narrow task view the event builders need (same fields the fake builds). */
interface TaskRow {
  readonly task_id: string;
  readonly order_id: string;
  readonly state: string;
  readonly courier_ref: string | null;
  readonly version: number;
}

export class PostgresTaskMirrorStore implements TaskMirrorStore, TaskDelegationStore {
  constructor(private readonly pool: Pool) {}

  /* ── checkpoint (delivery-owned) ── */

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    const r = await this.pool.query<{ last_occurred_at: Date; last_event_id: string }>(
      `SELECT last_occurred_at, last_event_id::text
         FROM delivery_relay_checkpoint WHERE consumer_id = $1`,
      [consumerId],
    );
    // ISO دائماً — المحرّكُ يقارنُ معجميّاً (relay.isAfter) وصيغةُ `::text` تنكسر أمامَها.
    return r.rows.length
      ? { last_occurred_at: r.rows[0].last_occurred_at.toISOString(), last_event_id: r.rows[0].last_event_id }
      : null;
  }

  async writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO delivery_relay_checkpoint (consumer_id, last_occurred_at, last_event_id)
       VALUES ($1, $2::timestamptz, $3::uuid)
       ON CONFLICT (consumer_id)
       DO UPDATE SET last_occurred_at = EXCLUDED.last_occurred_at,
                     last_event_id = EXCLUDED.last_event_id,
                     updated_at = now()`,
      [consumerId, checkpoint.last_occurred_at, checkpoint.last_event_id],
    );
  }

  /* ── delegation (command side, ADR-026 §2.4/§4.6-2, review 4/N) ── */

  async getTaskForDelegation(taskId: string): Promise<DelegatableTask | null> {
    const r = await this.pool.query<{ task_id: string; order_id: string; state: string; dispatch_job_ref: string | null }>(
      `SELECT task_id::text, order_id::text, state, dispatch_job_ref
         FROM delivery_tasks WHERE task_id = $1::uuid`,
      [taskId],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      taskId: row.task_id,
      orderId: row.order_id,
      state: row.state as DelegatableTask["state"],
      dispatchJobRef: row.dispatch_job_ref,
    };
  }

  async bindDispatchJob(taskId: string, jobRef: string, context: DelegationContext): Promise<"bound" | "already_bound"> {
    return this.withTransaction(async (tx) => {
      const sel = await tx.query<TaskRow & { dispatch_job_ref: string | null }>(
        `SELECT task_id::text, order_id::text, state, courier_ref, version, dispatch_job_ref
           FROM delivery_tasks WHERE task_id = $1::uuid
         FOR UPDATE`,
        [taskId],
      );
      const task = sel.rows[0];
      if (!task) {
        throw new DeliveryError(
          "DELIVERY_TASK_NOT_FOUND",
          `مهمّة التوصيل ${taskId} غير موجودة`,
          { traceId: context.traceId ?? undefined },
        );
      }
      if (task.dispatch_job_ref !== null) {
        if (task.dispatch_job_ref === jobRef) {
          // The deterministic idempotency key makes a racing or retried caller
          // ask for the same job — replay, not contradiction.
          return "already_bound" as const;
        }
        // A DIFFERENT ref is a contradiction the design refuses to swallow —
        // it means two delegation wires (or a broken bridge) bound one task
        // to two jobs. Loud, contract-coded, nothing written.
        throw new DeliveryError(
          "DELIVERY_CONCURRENT_UPDATE",
          `المهمّة ${taskId} مربوطةٌ بمهمّةِ توزيعٍ أخرى (${task.dispatch_job_ref}) — لا يُربطُ مهمّتانِ بمهمّةٍ واحدة`,
          { traceId: context.traceId ?? undefined, details: { field: "dispatch_job_ref", expected: jobRef, actual: task.dispatch_job_ref } },
        );
      }
      if (task.state !== DELEGATION_SOURCE_STATE) {
        throw new DeliveryError(
          "DELIVERY_TRANSITION_NOT_ALLOWED",
          `التفويضُ يبدأُ من ${DELEGATION_SOURCE_STATE} فقط — المهمّةُ في ${task.state}`,
          { traceId: context.traceId ?? undefined, details: { from: task.state, to: DELEGATION_TARGET_STATE } },
        );
      }

      // 1. Task state + the ref — ONE UPDATE (eligible → dispatch_requested).
      await tx.query(
        `UPDATE delivery_tasks
            SET state = $2,
                dispatch_job_ref = $3,
                version = version + 1,
                updated_at = now()
          WHERE task_id = $1::uuid`,
        [taskId, DELEGATION_TARGET_STATE, jobRef],
      );

      // 2. Transition ledger — append-only, actor is system (the wire).
      await tx.query(
        `INSERT INTO delivery_task_transitions
           (task_id, from_state, to_state, reason_code, actor_type, actor_ref, trace_id, occurred_at)
         VALUES ($1::uuid, $2, $3, $4, 'system', NULL, $5, $6::timestamptz)`,
        [taskId, DELEGATION_SOURCE_STATE, DELEGATION_TARGET_STATE, DISPATCH_DELEGATION_LEDGER_REASON, context.traceId, context.occurredAt],
      );

      // 3. The delegation's domain event — same transaction, so a consumer of
      //    delivery.dispatch_requested can never see an unbound task.
      const event = this.buildDelegationEvent(task, jobRef, context);
      await tx.query(
        `INSERT INTO delivery_outbox
           (event_id, event_type, event_version, aggregate_type, aggregate_id,
            payload, trace_id, occurred_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.event_id,
          event.event_type,
          event.event_version,
          event.aggregate.type,
          event.aggregate.id,
          JSON.stringify(event.payload),
          event.trace_id,
          event.occurred_at,
        ],
      );
      return "bound" as const;
    });
  }

  /* ── the coarse mirror ── */

  async getTaskByJobRef(jobId: string): Promise<readonly { taskId: string; state: string; lastDispatchEvent: RelayCheckpoint | null }[]> {
    const r = await this.pool.query<{
      task_id: string;
      state: string;
      dispatch_last_occurred_at: Date | null;
      dispatch_last_event_id: string | null;
    }>(
      `SELECT task_id::text, state, dispatch_last_occurred_at, dispatch_last_event_id::text
         FROM delivery_tasks
        WHERE dispatch_job_ref = $1`,
      [jobId],
    );
    return r.rows.map((row) => ({
      taskId: row.task_id,
      state: row.state,
      lastDispatchEvent:
        row.dispatch_last_occurred_at !== null && row.dispatch_last_event_id !== null
          ? { last_occurred_at: row.dispatch_last_occurred_at.toISOString(), last_event_id: row.dispatch_last_event_id }
          : null,
    }));
  }

  async applyMirrorTransition(taskId: string, transition: MirrorTransition, context: MirrorContext): Promise<void> {
    await this.withTransaction(async (tx) => {
      // Lock the task row — the relay is single-consumer today, but the lock
      // makes the read-modify-write safe against any future writer.
      const sel = await tx.query<TaskRow>(
        `SELECT task_id::text, order_id::text, state, courier_ref, version
           FROM delivery_tasks WHERE task_id = $1::uuid
         FOR UPDATE`,
        [taskId],
      );
      const task = sel.rows[0];
      if (!task) throw new Error(`unknown task ${taskId}`);

      const from = task.state;
      const courierRef = transition.courierRef ?? task.courier_ref;
      const newState = transition.to;

      // 1. Task state + dispatch watermark — one UPDATE.
      await tx.query(
        `UPDATE delivery_tasks
            SET state = $2,
                courier_ref = COALESCE($3::text, courier_ref),
                assigned_at = COALESCE($4::timestamptz, assigned_at),
                dispatch_last_occurred_at = $5::timestamptz,
                dispatch_last_event_id = $6::uuid,
                version = version + 1,
                updated_at = now()
          WHERE task_id = $1::uuid`,
        [taskId, newState, courierRef, transition.assignedAt ?? null, context.occurredAt, context.eventId],
      );

      // 2. Transition ledger — append-only, actor is dispatch.
      await tx.query(
        `INSERT INTO delivery_task_transitions
           (task_id, from_state, to_state, reason_code, actor_type, actor_ref, trace_id, occurred_at)
         VALUES ($1::uuid, $2, $3, $4, 'dispatch', $5, $6, $7::timestamptz)`,
        [taskId, from, newState, transition.ledgerReason, transition.courierRef ?? null, context.traceId, context.occurredAt],
      );

      // 3. The mirror's domain event — idempotent by event_id (see class doc).
      const event = this.buildEvent(task, from, courierRef, newState, transition, context);
      await tx.query(
        `INSERT INTO delivery_outbox
           (event_id, event_type, event_version, aggregate_type, aggregate_id,
            payload, trace_id, occurred_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.event_id,
          event.event_type,
          event.event_version,
          event.aggregate.type,
          event.aggregate.id,
          JSON.stringify(event.payload),
          event.trace_id,
          event.occurred_at,
        ],
      );
    });
  }

  async recordConsumedNoOp(taskId: string, context: MirrorContext): Promise<void> {
    // Guarded update: the watermark advances only forward — an older
    // redelivered no-op cannot drag it back (row comparison is lexicographic
    // on (occurred_at, event_id), the same order readAfter uses).
    await this.pool.query(
      `UPDATE delivery_tasks
          SET dispatch_last_occurred_at = $2::timestamptz,
              dispatch_last_event_id = $3::uuid,
              updated_at = now()
        WHERE task_id = $1::uuid
          AND (dispatch_last_occurred_at IS NULL
               OR (dispatch_last_occurred_at, dispatch_last_event_id) < ($2::timestamptz, $3::uuid))`,
      [taskId, context.occurredAt, context.eventId],
    );
  }

  /* ── consumed-event ledger (idempotency) ── */

  async getConsumed(eventId: string): Promise<{ status: ConsumedStatus; attempt_count: number } | null> {
    const r = await this.pool.query<{ consumed_status: ConsumedStatus; attempt_count: number }>(
      `SELECT consumed_status, attempt_count FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [eventId],
    );
    return r.rows.length ? { status: r.rows[0].consumed_status, attempt_count: r.rows[0].attempt_count } : null;
  }

  async markConsumed(
    eventId: string,
    row: Pick<DispatchOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: ConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO delivery_relay_consumed_events
         (event_id, event_type, aggregate_type, aggregate_id, consumed_status, attempt_count, last_error)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id)
       DO UPDATE SET consumed_status = EXCLUDED.consumed_status,
                     attempt_count = EXCLUDED.attempt_count,
                     last_error = EXCLUDED.last_error,
                     updated_at = now()`,
      [eventId, row.event_type, row.aggregate_type, row.aggregate_id, status, attemptCount, lastError ?? null],
    );
  }

  /* ── replay / rebuild ── */

  async clearMirrorState(): Promise<void> {
    // delivery_outbox is NOT cleared — append-only by design (relay.rebuildAll);
    // re-applied events no-op on the outbox unique key. Proof columns are
    // cleared with the state so ck_delivery_proof stays satisfied for a bound
    // task that had reached `delivered`.
    await this.withTransaction(async (tx) => {
      await tx.query(`DELETE FROM delivery_task_transitions`);
      await tx.query(`DELETE FROM delivery_relay_consumed_events`);
      await tx.query(`DELETE FROM delivery_relay_checkpoint`);
      await tx.query(
        `UPDATE delivery_tasks
            SET state = 'dispatch_requested',
                courier_ref = NULL,
                assigned_at = NULL,
                delivered_at = NULL,
                proof_type = NULL,
                proof_ref = NULL,
                dispatch_last_occurred_at = NULL,
                dispatch_last_event_id = NULL,
                updated_at = now()
          WHERE dispatch_job_ref IS NOT NULL`,
      );
    });
  }

  /* ── internals ── */

  private async withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** The delegation event (§2.4) — same builder the fake uses, task now bound. */
  private buildDelegationEvent(
    task: TaskRow & { dispatch_job_ref: string | null },
    jobRef: string,
    context: DelegationContext,
  ): DeliveryDomainEvent {
    const domainTask = {
      taskId: task.task_id,
      orderId: task.order_id,
      state: DELEGATION_TARGET_STATE,
      courierRef: task.courier_ref,
      dispatchJobRef: jobRef,
      version: task.version + 1,
    } as never;
    return deliveryDispatchRequestedEvent(domainTask, DELEGATION_SOURCE_STATE as never, {
      eventId: context.eventId,
      occurredAt: context.occurredAt,
      traceId: context.traceId,
    });
  }

  /** Same builder logic as the in-memory fake (mirror-fakes.buildEvent). */
  private buildEvent(
    task: TaskRow,
    from: string,
    courierRef: string | null,
    newState: string,
    transition: MirrorTransition,
    context: MirrorContext,
  ): DeliveryDomainEvent {
    const ctx = { eventId: context.eventId, occurredAt: context.occurredAt, traceId: context.traceId };
    const domainTask = {
      taskId: task.task_id,
      orderId: task.order_id,
      state: newState,
      courierRef,
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
