/**
 * اختبارات حدود المعاملة لعمليات التفاوض.
 *
 * كل استعمال حالة كاتب ينفذ داخل `PostgresNegotiationUnitOfWork.run()`، لا داخل المستودعات.
 * تثبت هذه الاختبارات أن تغيير الخيط والجولة والاتفاق والصادر ومفتاح التكرار يلتزم معاً أو
 * يتراجع معاً، وأن `read()` لا يبدأ معاملة لمجرد تنفيذ SELECT.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { NegotiationDomainEvent } from '@wasla/contracts-negotiation';

import { acceptRound } from '../use-cases/accept-round.js';
import { cancelThread } from '../use-cases/cancel-thread.js';
import { openThread } from '../use-cases/open-thread.js';
import { postMessage } from '../use-cases/post-message.js';
import { proposeRound } from '../use-cases/propose-round.js';
import { runTick } from '../use-cases/run-tick.js';
import type { NegotiationDependencies, Outbox } from '../ports.js';
import { openInput } from './helpers.js';
import {
  PG_ENABLED,
  createPgHarness,
  resetData,
  setupPostgres,
  type PgFixture,
  type PgHarness,
} from './pg-harness.js';

class Explosion extends Error {}

/** يكتب الحدث أولاً ثم يرمي، لمحاكاة فشل آخر خطوة محلية في العملية. */
class ExplodingOutbox implements Outbox {
  constructor(private readonly inner: Outbox) {}

  async append(event: NegotiationDomainEvent): Promise<void> {
    await this.inner.append(event);
    throw new Explosion('فشل الصادر المقصود');
  }

  async unread(): ReturnType<Outbox['unread']> {
    return this.inner.unread();
  }
}

async function count(pg: PgFixture, table: string): Promise<number> {
  const result = await pg.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function write<T>(
  pg: PgFixture,
  harness: PgHarness,
  operation: (deps: NegotiationDependencies) => Promise<T>,
): Promise<T> {
  return pg.unitOfWork.run(harness.shared, ({ deps }) => operation(deps));
}

async function open(pg: PgFixture, harness: PgHarness, key: string) {
  return write(pg, harness, (deps) =>
    openThread(deps, openInput() as never, { idempotencyKey: key }),
  );
}

async function proposed(
  pg: PgFixture,
  harness: PgHarness,
  key = 'atomic-propose-0001',
) {
  const opened = await open(pg, harness, `${key}-open`);
  const proposal = await write(pg, harness, (deps) =>
    proposeRound(
      deps,
      opened.thread.id,
      {
        proposed_by: 'customer',
        amount_minor: 3100,
        currency: 'SAR',
        expected_round_no: 0,
      },
      { idempotencyKey: key },
    ),
  );
  return { opened, proposal };
}

describe.skipIf(!PG_ENABLED)('ذرية معاملات تفاوض PostgreSQL', () => {
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

  it('يلتزم فتح الخيط والصادر ومفتاح التكرار معاً', async () => {
    const harness = createPgHarness(pg);
    await open(pg, harness, 'atomic-open-0001');
    expect(await count(pg, 'negotiation_threads')).toBe(1);
    expect(await count(pg, 'negotiation_outbox')).toBe(1);
    expect(await count(pg, 'negotiation_idempotency')).toBe(1);
  });

  it('يتراجع فتح الخيط كاملاً إذا فشل الصادر في آخر العملية', async () => {
    const harness = createPgHarness(pg);
    await expect(
      pg.unitOfWork.run(harness.shared, async ({ deps }) => {
        const broken: NegotiationDependencies = {
          ...deps,
          outbox: new ExplodingOutbox(deps.outbox),
        };
        await openThread(broken, openInput() as never, {
          idempotencyKey: 'atomic-open-0002',
        });
      }),
    ).rejects.toBeInstanceOf(Explosion);
    expect(await count(pg, 'negotiation_threads')).toBe(0);
    expect(await count(pg, 'negotiation_outbox')).toBe(0);
    expect(await count(pg, 'negotiation_idempotency')).toBe(0);
  });

  it('يتراجع proposeRound في المنتصف: لا جولة ولا تحديث خيط ولا صادر', async () => {
    const harness = createPgHarness(pg);
    const opened = await open(pg, harness, 'atomic-propose-open');
    await expect(
      pg.unitOfWork.run(harness.shared, async ({ deps }) => {
        await proposeRound(
          { ...deps, outbox: new ExplodingOutbox(deps.outbox) },
          opened.thread.id,
          {
            proposed_by: 'customer',
            amount_minor: 3100,
            currency: 'SAR',
            expected_round_no: 0,
          },
          { idempotencyKey: 'atomic-propose-fail' },
        );
      }),
    ).rejects.toBeInstanceOf(Explosion);
    expect(await pg.rounds.list(opened.thread.id)).toEqual([]);
    expect((await pg.threads.find(opened.thread.id))?.roundCount).toBe(0);
    expect(await pg.outbox.unread()).toHaveLength(1);
  });

  it('يلتزم proposeRound بجولته وتحديث الخيط والصادر ومفتاحه معاً', async () => {
    const harness = createPgHarness(pg);
    const { opened, proposal } = await proposed(pg, harness);
    expect(
      (await pg.rounds.list(opened.thread.id)).map((round) => round.id),
    ).toEqual([proposal.round.id]);
    expect((await pg.threads.find(opened.thread.id))?.currentRoundNo).toBe(1);
    expect(await pg.outbox.unread()).toHaveLength(2);
    expect(await pg.idempotency.find('atomic-propose-0001')).not.toBeNull();
  });

  it('يلتزم acceptRound بالجولة المقبولة والخيط والاتفاق والصادر', async () => {
    const harness = createPgHarness(pg);
    const { opened, proposal } = await proposed(pg, harness);
    const accepted = await write(pg, harness, (deps) =>
      acceptRound(
        deps,
        opened.thread.id,
        proposal.round.roundNo,
        { acting_party: 'driver' },
        { idempotencyKey: 'atomic-accept-0001' },
      ),
    );
    expect((await pg.threads.find(opened.thread.id))?.state).toBe('agreed');
    expect((await pg.rounds.find(opened.thread.id, 1))?.state).toBe('accepted');
    expect(await pg.agreements.find(opened.thread.id)).toEqual(
      accepted.agreement,
    );
    expect(await pg.idempotency.find('atomic-accept-0001')).not.toBeNull();
  });

  it('يتراجع acceptRound إذا فشل الصادر ولا يترك اتفاقاً أو قبولاً', async () => {
    const harness = createPgHarness(pg);
    const { opened, proposal } = await proposed(pg, harness);
    await expect(
      pg.unitOfWork.run(harness.shared, async ({ deps }) => {
        await acceptRound(
          { ...deps, outbox: new ExplodingOutbox(deps.outbox) },
          opened.thread.id,
          proposal.round.roundNo,
          { acting_party: 'driver' },
          { idempotencyKey: 'atomic-accept-fail' },
        );
      }),
    ).rejects.toBeInstanceOf(Explosion);
    expect((await pg.rounds.find(opened.thread.id, 1))?.state).toBe('pending');
    expect((await pg.threads.find(opened.thread.id))?.state).toBe('open');
    expect(await pg.agreements.find(opened.thread.id)).toBeNull();
  });

  it('يلتزم postMessage بالرسالة والصادر ومفتاح التكرار', async () => {
    const harness = createPgHarness(pg);
    const opened = await open(pg, harness, 'atomic-message-open');
    const posted = await write(pg, harness, (deps) =>
      postMessage(
        deps,
        opened.thread.id,
        { author_role: 'customer', body: 'رسالة ذرية', source_locale: 'ar' },
        { idempotencyKey: 'atomic-message-0001' },
      ),
    );
    expect(await pg.messages.list(opened.thread.id)).toEqual([posted.message]);
    expect(await pg.outbox.unread()).toHaveLength(2);
    expect(await pg.idempotency.find('atomic-message-0001')).not.toBeNull();
  });

  it('يلتزم cancelThread بإغلاق الخيط وتسوية الجولة والصادر', async () => {
    const harness = createPgHarness(pg);
    const { opened } = await proposed(pg, harness, 'atomic-cancel-round');
    await write(pg, harness, (deps) =>
      cancelThread(
        deps,
        opened.thread.id,
        { reason_code: 'cancelled_by_dispatch' },
        { idempotencyKey: 'atomic-cancel-0001' },
      ),
    );
    expect((await pg.threads.find(opened.thread.id))?.state).toBe('cancelled');
    expect((await pg.rounds.find(opened.thread.id, 1))?.state).toBe('expired');
    expect(await pg.idempotency.find('atomic-cancel-0001')).not.toBeNull();
  });

  it('يلتزم runTick بانتهاء الجولة وكتابة الصادر من دون مؤقت', async () => {
    const harness = createPgHarness(pg);
    const { opened } = await proposed(pg, harness, 'atomic-tick-round');
    harness.clock.set('2026-08-23T00:02:01.000Z');
    const result = await write(pg, harness, (deps) => runTick(deps));
    expect(result.roundsExpired).toBe(1);
    expect((await pg.rounds.find(opened.thread.id, 1))?.state).toBe('expired');
    expect(await pg.outbox.unread()).toHaveLength(3);
  });

  it('يسمح بإعادة مفتاح العملية التي تراجع تنفيذها', async () => {
    const harness = createPgHarness(pg);
    await expect(
      pg.unitOfWork.run(harness.shared, async ({ deps }) => {
        await openThread(
          { ...deps, outbox: new ExplodingOutbox(deps.outbox) },
          openInput() as never,
          { idempotencyKey: 'atomic-retry-0001' },
        );
      }),
    ).rejects.toBeInstanceOf(Explosion);
    const retried = await open(pg, harness, 'atomic-retry-0001');
    expect(retried.replay).toBe(false);
    expect(await count(pg, 'negotiation_threads')).toBe(1);
  });

  it('ينفذ read بلا BEGIN/COMMIT ولا يترك أي صف جديد', async () => {
    const harness = createPgHarness(pg);
    const transaction = vi.spyOn(pg.db, 'transaction');
    const active = await pg.unitOfWork.read(harness.shared, ({ deps }) =>
      deps.policies.findActive(),
    );
    expect(active?.policyVersion).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(await count(pg, 'negotiation_outbox')).toBe(0);
    transaction.mockRestore();
  });
});
