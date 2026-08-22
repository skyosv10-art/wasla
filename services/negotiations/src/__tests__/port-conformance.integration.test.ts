/**
 * مصفوفة مطابقة منافذ الذاكرة وPostgreSQL.
 *
 * كل سيناريو يبدأ من `helpers.makeDeps()` المبذورة بعرض توزيع قانوني، ويستبدل في جانب
 * PostgreSQL التخزين وحده. الساعة والمعرفات ومنفذا العرض وتسلّم السعر هي نفس المساعدات،
 * ولذلك يكون أي فرق مرئي فرقاً في محول الاستمرارية لا في بيئة غير مبذورة.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { acceptRound } from '../use-cases/accept-round.js';
import { cancelThread } from '../use-cases/cancel-thread.js';
import { openThread } from '../use-cases/open-thread.js';
import { postMessage } from '../use-cases/post-message.js';
import { proposeRound } from '../use-cases/propose-round.js';
import { rejectRound } from '../use-cases/reject-round.js';
import { runTick } from '../use-cases/run-tick.js';
import type { NegotiationDependencies } from '../ports.js';
import { makeDeps, openInput } from './helpers.js';
import {
  PG_ENABLED,
  createPgHarness,
  resetData,
  setupPostgres,
  type PgFixture,
} from './pg-harness.js';

type Runtime = {
  readonly deps: NegotiationDependencies;
  readonly write: <T>(
    operation: (deps: NegotiationDependencies) => Promise<T>,
  ) => Promise<T>;
  readonly setClock: (iso: string) => void;
  readonly setHandoffMode: (mode: 'accept' | 'throw') => void;
};

type Scenario = {
  readonly name: string;
  readonly run: (runtime: Runtime) => Promise<unknown>;
};

function memoryRuntime(): Runtime {
  const deps = makeDeps();
  return {
    deps,
    write: (operation) => operation(deps),
    setClock: (iso) => deps.clock.set(iso),
    setHandoffMode: (mode) => {
      deps.agreedPrice.mode = mode;
    },
  };
}

function postgresRuntime(fixture: PgFixture): Runtime {
  const harness = createPgHarness(fixture);
  return {
    deps: harness.deps,
    write: (operation) =>
      fixture.unitOfWork.run(harness.shared, ({ deps }) => operation(deps)),
    setClock: (iso) => harness.clock.set(iso),
    setHandoffMode: (mode) => {
      harness.agreedPrice.mode = mode;
    },
  };
}

async function open(runtime: Runtime, key: string) {
  return runtime.write((deps) =>
    openThread(deps, openInput() as never, { idempotencyKey: key }),
  );
}

async function propose(
  runtime: Runtime,
  threadId: string,
  expectedRoundNo: number,
  key: string,
) {
  const proposedBy = expectedRoundNo % 2 === 0 ? 'customer' : 'driver';
  return runtime.write((deps) =>
    proposeRound(
      deps,
      threadId,
      {
        proposed_by: proposedBy,
        amount_minor: 3100 + expectedRoundNo * 10,
        currency: 'SAR',
        expected_round_no: expectedRoundNo,
      },
      { idempotencyKey: key },
    ),
  );
}

async function snapshot(deps: NegotiationDependencies, threadId: string) {
  return {
    thread: await deps.threads.find(threadId),
    rounds: await deps.rounds.list(threadId),
    messages: await deps.messages.list(threadId),
    agreement: await deps.agreements.find(threadId),
    handoffs: await deps.handoffs.list(threadId),
    outbox: (await deps.outbox.unread()).map((event) => ({
      eventId: event.event_id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
    })),
  };
}

async function negotiationErrorCode(
  operation: () => Promise<unknown>,
): Promise<string> {
  try {
    await operation();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String(error.code);
    }
    throw error;
  }
  throw new Error('كان ينبغي أن تفشل العملية');
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'فتح خيط تفاوض',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-open-0001');
      return {
        result: opened,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'رفض جولة من الطرف المقابل',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-reject-open');
      const round = await propose(
        runtime,
        opened.thread.id,
        0,
        'parity-reject-propose',
      );
      const rejected = await runtime.write((deps) =>
        rejectRound(
          deps,
          opened.thread.id,
          round.round.roundNo,
          { acting_party: 'driver', close_thread: false },
          { idempotencyKey: 'parity-reject-round' },
        ),
      );
      return {
        result: rejected,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'تجاوز الحد الأقصى للجولات',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-budget-open');
      for (let roundNo = 0; roundNo < 5; roundNo += 1) {
        const proposal = await propose(
          runtime,
          opened.thread.id,
          roundNo,
          `parity-budget-${roundNo}`,
        );
        const actingParty =
          proposal.round.proposedBy === 'customer' ? 'driver' : 'customer';
        await runtime.write((deps) =>
          rejectRound(
            deps,
            opened.thread.id,
            proposal.round.roundNo,
            { acting_party: actingParty, close_thread: false },
            { idempotencyKey: `parity-budget-reject-${roundNo}` },
          ),
        );
      }
      const code = await negotiationErrorCode(() =>
        propose(runtime, opened.thread.id, 5, 'parity-budget-overflow'),
      );
      return {
        code,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'إلغاء الخيط من الإرسال',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-cancel-open');
      const cancelled = await runtime.write((deps) =>
        cancelThread(
          deps,
          opened.thread.id,
          { reason_code: 'cancelled_by_dispatch' },
          { idempotencyKey: 'parity-cancel-thread' },
        ),
      );
      return {
        result: cancelled,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'انتهاء جولة عبر runTick',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-round-expiry-open');
      await propose(
        runtime,
        opened.thread.id,
        0,
        'parity-round-expiry-propose',
      );
      runtime.setClock('2026-08-23T00:02:01.000Z');
      const tick = await runtime.write((deps) => runTick(deps));
      return {
        tick,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'انتهاء خيط عبر runTick',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-thread-expiry-open');
      runtime.setClock('2026-08-23T00:15:01.000Z');
      const tick = await runtime.write((deps) => runTick(deps));
      return {
        tick,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'رسائل متعددة مع تنقيح',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-messages-open');
      const first = await runtime.write((deps) =>
        postMessage(
          deps,
          opened.thread.id,
          { author_role: 'customer', body: 'الأولى', source_locale: 'ar' },
          { idempotencyKey: 'parity-message-one' },
        ),
      );
      await runtime.write((deps) =>
        postMessage(
          deps,
          opened.thread.id,
          { author_role: 'driver', body: 'الثانية', source_locale: 'ar' },
          { idempotencyKey: 'parity-message-two' },
        ),
      );
      const redacted = await runtime.write((deps) =>
        deps.messages.redact(
          opened.thread.id,
          first.message.id,
          'spam',
          deps.clock.now(),
        ),
      );
      return {
        redacted,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'توافق ثم تسليم سعر ناجح',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-agree-open');
      const proposal = await propose(
        runtime,
        opened.thread.id,
        0,
        'parity-agree-propose',
      );
      const accepted = await runtime.write((deps) =>
        acceptRound(
          deps,
          opened.thread.id,
          proposal.round.roundNo,
          { acting_party: 'driver' },
          { idempotencyKey: 'parity-agree-accept' },
        ),
      );
      return {
        result: accepted,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'فشل تسليم السعر ثم إعادة محاولة بتراجع أسي',
    run: async (runtime) => {
      const opened = await open(runtime, 'parity-retry-open');
      const proposal = await propose(
        runtime,
        opened.thread.id,
        0,
        'parity-retry-propose',
      );
      runtime.setHandoffMode('throw');
      const first = await runtime.write((deps) =>
        acceptRound(
          deps,
          opened.thread.id,
          proposal.round.roundNo,
          { acting_party: 'driver' },
          { idempotencyKey: 'parity-retry-accept' },
        ),
      );
      runtime.setHandoffMode('accept');
      runtime.setClock('2026-08-23T00:00:30.000Z');
      const retryTick = await runtime.write((deps) => runTick(deps));
      return {
        first,
        retryTick,
        state: await snapshot(runtime.deps, opened.thread.id),
      };
    },
  },
  {
    name: 'إعادة نفس مفتاح فتح الخيط',
    run: async (runtime) => {
      const first = await open(runtime, 'parity-replay-0001');
      const replay = await open(runtime, 'parity-replay-0001');
      return {
        first,
        replay,
        state: await snapshot(runtime.deps, first.thread.id),
      };
    },
  },
];

/** لا تسمح المقارنة بأن تمر على كائن فارغ أو أثر بلا كتابة مرئية. */
function assertNonEmptyTrace(trace: unknown): void {
  expect(trace).toBeTruthy();
  expect(JSON.stringify(trace).length).toBeGreaterThan(120);
  const record = trace as { state?: { outbox?: unknown[] } };
  expect(record.state?.outbox?.length ?? 0).toBeGreaterThan(0);
}

describe.skipIf(!PG_ENABLED)('مطابقة منفذ الذاكرة ↔ PostgreSQL', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  it.each(SCENARIOS)('$name ينتج الأثر المرئي نفسه', async ({ run }) => {
    const expected = await run(memoryRuntime());
    const actual = await run(postgresRuntime(pg));
    assertNonEmptyTrace(expected);
    assertNonEmptyTrace(actual);
    expect(actual).toEqual(expected);
  });
});
