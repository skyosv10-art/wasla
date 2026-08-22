/**
 * اختبارات مستودعات التفاوض على PostgreSQL الحقيقي.
 *
 * لا تختبر هذه suite محاكاة Drizzle: تطبق `pg-harness` العقد الرسمي ثم تثبت أن كل قيد مسمى
 * يرفض المخالفة بالاسم الذي يخرجه PostgreSQL بعد فك سلسلة `cause`. وتثبت أيضاً أن كل منفذ
 * يعيد الأنواع والحقول والترتيب التي يحتاجها المجال، فلا يكفي نجاح INSERT وحده.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { NegotiationDomainEvent } from "@wasla/contracts-negotiation";

import { postgresError } from "../infrastructure/drizzle/repository.js";
import {
  CUSTOMER_ID,
  DRIVER_ID,
  OFFER_ID,
  ORDER_ID,
  START,
} from "./helpers.js";
import {
  PG_ENABLED,
  createPgHarness,
  resetData,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const THREAD = "aaaaaaaa-0000-4000-8000-000000000001";
const ROUND = "bbbbbbbb-0000-4000-8000-000000000001";
const MESSAGE = "cccccccc-0000-4000-8000-000000000001";
const HANDOFF = "dddddddd-0000-4000-8000-000000000001";
const FINGERPRINT = "0".repeat(64);

function uuid(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function order(number: number): string {
  return `ORD-${String(number).padStart(10, "0")}`;
}

function actor(number: number): string {
  return `WS-${String(number).padStart(10, "0")}`;
}

function event(id: string, occurredAt = START): NegotiationDomainEvent {
  return {
    event_id: id,
    event_type: "negotiations.thread_opened",
    event_version: "v1",
    occurred_at: occurredAt,
    producer: "negotiations-service",
    aggregate: {
      type: "negotiation_thread",
      id: THREAD,
    },
    trace_id: "trace-123",
    data: {
      thread_id: THREAD,
      order_public_id: ORDER_ID,
      customer_public_id: CUSTOMER_ID,
      driver_public_id: DRIVER_ID,
      dispatch_offer_id: OFFER_ID,
      service_kind: "ride",
      opening_amount_minor: 3000,
      currency: "SAR",
      opened_by: "customer",
      policy_version: 1,
      expires_at: "2026-08-23T00:15:00.000Z",
      occurred_for: START,
    },
  } as NegotiationDomainEvent;
}

/** يكتب خيطاً قانونياً مباشرة ليكون أساس اختبارات قيود الصفوف الأدنى. */
async function insertRawThread(
  pg: PgFixture,
  id = THREAD,
  number = 1000000001,
): Promise<void> {
  await pg.pool.query(
    `INSERT INTO negotiation_threads (
       id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
       service_kind, policy_version, currency, opening_amount_minor, opened_by,
       expires_at, next_tick_at
     ) VALUES ($1, $2, $3, $4, $5, 'ride', 1, 'SAR', 3000, 'customer', $6, $6)`,
    [
      id,
      order(number),
      actor(number + 1),
      actor(number + 2),
      uuid(number),
      "2026-08-23T00:15:00Z",
    ],
  );
}

/** يكتب اتفاقاً قانونياً؛ لا يطلب العقد صف جولة مرجعياً لأن رقم الجولة أثر تاريخي. */
async function insertRawAgreement(
  pg: PgFixture,
  threadId = THREAD,
  number = 1000000001,
): Promise<void> {
  await insertRawThread(pg, threadId, number);
  await pg.pool.query(
    `INSERT INTO negotiation_agreements (
       thread_id, order_public_id, driver_public_id, round_no, amount_minor, currency,
       accepted_by, policy_version, agreed_at, next_handoff_at
     ) VALUES ($1, $2, $3, 1, 3000, 'SAR', 'driver', 1, $4, $4)`,
    [threadId, order(number), actor(number + 2), START],
  );
}

async function expectConstraint(
  expectedConstraint: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(postgresError(error).constraint).toBe(expectedConstraint);
    return;
  }
  throw new Error(`كان ينبغي أن ترفض PostgreSQL القيد ${expectedConstraint}`);
}

const CONSTRAINT_CASES = [
  {
    name: "ck_negotiation_policies_amount_bounds",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_policies (
           policy_version, label, currency, min_amount_minor, max_amount_minor, max_rounds,
           round_ttl_seconds, thread_ttl_seconds, max_message_length, max_messages_per_thread
         ) VALUES (2, 'invalid-policy', 'SAR', 100, 100, 2, 60, 120, 10, 10)`,
      ),
  },
  {
    name: "ck_negotiation_policies_ttl_order",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_policies (
           policy_version, label, currency, min_amount_minor, max_amount_minor, max_rounds,
           round_ttl_seconds, thread_ttl_seconds, max_message_length, max_messages_per_thread
         ) VALUES (2, 'invalid-policy', 'SAR', 100, 200, 2, 120, 60, 10, 10)`,
      ),
  },
  {
    name: "ux_negotiation_threads_order_driver",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg, uuid(1), 1);
      return pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, policy_version, currency, opening_amount_minor, opened_by,
           expires_at, next_tick_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 1, 'SAR', 3000, 'customer', $6, $6)`,
        [
          uuid(2),
          order(1),
          actor(99),
          actor(3),
          uuid(2),
          "2026-08-23T00:15:00Z",
        ],
      );
    },
  },
  {
    name: "ux_negotiation_threads_dispatch_offer",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg, uuid(1), 1);
      return pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, policy_version, currency, opening_amount_minor, opened_by,
           expires_at, next_tick_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 1, 'SAR', 3000, 'customer', $6, $6)`,
        [
          uuid(2),
          order(2),
          actor(98),
          actor(97),
          uuid(1),
          "2026-08-23T00:15:00Z",
        ],
      );
    },
  },
  {
    name: "ck_negotiation_threads_open_is_clean",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, policy_version, currency, opening_amount_minor, opened_by,
           expires_at, next_tick_at, closed_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 1, 'SAR', 3000, 'customer', $6, $6, $6)`,
        [uuid(1), order(1), actor(2), actor(3), uuid(1), START],
      ),
  },
  {
    name: "ck_negotiation_threads_closed_has_reason",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, state, close_reason_code, policy_version, currency,
           opening_amount_minor, opened_by, expires_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 'cancelled', 'order_withdrawn', 1, 'SAR',
                   3000, 'customer', $6)`,
        [uuid(1), order(1), actor(2), actor(3), uuid(1), START],
      ),
  },
  {
    name: "ck_negotiation_threads_agreed_names_round",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, state, close_reason_code, policy_version, currency,
           opening_amount_minor, opened_by, expires_at, closed_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 'agreed', 'order_withdrawn', 1, 'SAR',
                   3000, 'customer', $6, $6)`,
        [uuid(1), order(1), actor(2), actor(3), uuid(1), START],
      ),
  },
  {
    name: "ck_negotiation_threads_round_counters",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, policy_version, currency, opening_amount_minor, opened_by,
           round_count, current_round_no, expires_at, next_tick_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 1, 'SAR', 3000, 'customer', 0, 1, $6, $6)`,
        [uuid(1), order(1), actor(2), actor(3), uuid(1), START],
      ),
  },
  {
    name: "ck_negotiation_threads_agreed_round_exists",
    violate: (pg: PgFixture) =>
      pg.pool.query(
        `INSERT INTO negotiation_threads (
           id, order_public_id, customer_public_id, driver_public_id, dispatch_offer_id,
           service_kind, state, close_reason_code, policy_version, currency,
           opening_amount_minor, opened_by, round_count, current_round_no, agreed_round_no,
           expires_at, closed_at
         ) VALUES ($1, $2, $3, $4, $5, 'ride', 'agreed', 'agreed', 1, 'SAR', 3000,
                   'customer', 2, 1, 2, $6, $6)`,
        [uuid(1), order(1), actor(2), actor(3), uuid(1), START],
      ),
  },
  {
    name: "ux_negotiation_rounds_thread_no",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      await pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, state, expires_at
         ) VALUES ($1, $2, 1, 'customer', 3000, 'SAR', 'expired', $3)`,
        [uuid(10), THREAD, START],
      );
      return pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, state, expires_at
         ) VALUES ($1, $2, 1, 'driver', 3100, 'SAR', 'expired', $3)`,
        [uuid(11), THREAD, START],
      );
    },
  },
  {
    name: "ck_negotiation_rounds_state_timestamp",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, state, expires_at
         ) VALUES ($1, $2, 1, 'customer', 3000, 'SAR', 'accepted', $3)`,
        [uuid(10), THREAD, START],
      );
    },
  },
  {
    name: "ck_negotiation_rounds_no_self_resolution",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, state, resolved_by,
           expires_at, responded_at
         ) VALUES ($1, $2, 1, 'customer', 3000, 'SAR', 'accepted', 'customer', $3, $3)`,
        [uuid(10), THREAD, START],
      );
    },
  },
  {
    name: "ux_negotiation_rounds_one_pending",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      await pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, expires_at
         ) VALUES ($1, $2, 1, 'customer', 3000, 'SAR', $3)`,
        [uuid(10), THREAD, START],
      );
      return pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, expires_at
         ) VALUES ($1, $2, 2, 'driver', 3100, 'SAR', $3)`,
        [uuid(11), THREAD, START],
      );
    },
  },
  {
    name: "ux_negotiation_rounds_one_accepted",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      await pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, state, resolved_by,
           expires_at, responded_at
         ) VALUES ($1, $2, 1, 'customer', 3000, 'SAR', 'accepted', 'driver', $3, $3)`,
        [uuid(10), THREAD, START],
      );
      return pg.pool.query(
        `INSERT INTO negotiation_rounds (
           id, thread_id, round_no, proposed_by, amount_minor, currency, state, resolved_by,
           expires_at, responded_at
         ) VALUES ($1, $2, 2, 'driver', 3100, 'SAR', 'accepted', 'customer', $3, $3)`,
        [uuid(11), THREAD, START],
      );
    },
  },
  {
    name: "ux_negotiation_messages_thread_seq",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      await pg.pool.query(
        `INSERT INTO negotiation_messages (id, thread_id, sequence_no, author_role, system_code)
         VALUES ($1, $2, 1, 'system', 'first')`,
        [uuid(10), THREAD],
      );
      return pg.pool.query(
        `INSERT INTO negotiation_messages (id, thread_id, sequence_no, author_role, system_code)
         VALUES ($1, $2, 1, 'system', 'second')`,
        [uuid(11), THREAD],
      );
    },
  },
  {
    name: "ck_negotiation_messages_body_or_code",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_messages (id, thread_id, sequence_no, author_role)
         VALUES ($1, $2, 1, 'system')`,
        [uuid(10), THREAD],
      );
    },
  },
  {
    name: "ck_negotiation_messages_redaction",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_messages (
           id, thread_id, sequence_no, author_role, body, redacted_at
         ) VALUES ($1, $2, 1, 'customer', 'لا تحذفني', $3)`,
        [uuid(10), THREAD, START],
      );
    },
  },
  {
    name: "ux_negotiation_agreements_order_driver",
    violate: async (pg: PgFixture) => {
      await insertRawAgreement(pg, uuid(1), 1);
      await insertRawThread(pg, uuid(2), 2);
      return pg.pool.query(
        `INSERT INTO negotiation_agreements (
           thread_id, order_public_id, driver_public_id, round_no, amount_minor, currency,
           accepted_by, policy_version, agreed_at, next_handoff_at
         ) VALUES ($1, $2, $3, 1, 3100, 'SAR', 'customer', 1, $4, $4)`,
        [uuid(2), order(1), actor(3), START],
      );
    },
  },
  {
    name: "ck_negotiation_agreements_handed_off_at",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_agreements (
           thread_id, order_public_id, driver_public_id, round_no, amount_minor, currency,
           accepted_by, policy_version, agreed_at, handoff_state
         ) VALUES ($1, $2, $3, 1, 3000, 'SAR', 'driver', 1, $4, 'handed_off')`,
        [THREAD, order(1000000001), actor(1000000003), START],
      );
    },
  },
  {
    name: "ck_negotiation_agreements_terminal_no_retry",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_agreements (
           thread_id, order_public_id, driver_public_id, round_no, amount_minor, currency,
           accepted_by, policy_version, agreed_at, handoff_state, next_handoff_at, last_error_code
         ) VALUES ($1, $2, $3, 1, 3000, 'SAR', 'driver', 1, $4, 'rejected', $4, 'order_rejected')`,
        [THREAD, order(1000000001), actor(1000000003), START],
      );
    },
  },
  {
    name: "ck_negotiation_agreements_failure_named",
    violate: async (pg: PgFixture) => {
      await insertRawThread(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_agreements (
           thread_id, order_public_id, driver_public_id, round_no, amount_minor, currency,
           accepted_by, policy_version, agreed_at, handoff_state
         ) VALUES ($1, $2, $3, 1, 3000, 'SAR', 'driver', 1, $4, 'rejected')`,
        [THREAD, order(1000000001), actor(1000000003), START],
      );
    },
  },
  {
    name: "ux_negotiation_price_handoffs_attempt",
    violate: async (pg: PgFixture) => {
      await insertRawAgreement(pg);
      await pg.pool.query(
        `INSERT INTO negotiation_price_handoffs (
           id, thread_id, attempt_no, amount_minor, currency, requested_at
         ) VALUES ($1, $2, 1, 3000, 'SAR', $3)`,
        [uuid(10), THREAD, START],
      );
      return pg.pool.query(
        `INSERT INTO negotiation_price_handoffs (
           id, thread_id, attempt_no, amount_minor, currency, requested_at
         ) VALUES ($1, $2, 1, 3000, 'SAR', $3)`,
        [uuid(11), THREAD, START],
      );
    },
  },
  {
    name: "ck_negotiation_price_handoffs_completion",
    violate: async (pg: PgFixture) => {
      await insertRawAgreement(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_price_handoffs (
           id, thread_id, attempt_no, amount_minor, currency, requested_at, outcome
         ) VALUES ($1, $2, 1, 3000, 'SAR', $3, 'accepted')`,
        [uuid(10), THREAD, START],
      );
    },
  },
  {
    name: "ck_negotiation_price_handoffs_failure_named",
    violate: async (pg: PgFixture) => {
      await insertRawAgreement(pg);
      return pg.pool.query(
        `INSERT INTO negotiation_price_handoffs (
           id, thread_id, attempt_no, amount_minor, currency, requested_at, outcome, completed_at
         ) VALUES ($1, $2, 1, 3000, 'SAR', $3, 'rejected', $3)`,
        [uuid(10), THREAD, START],
      );
    },
  },
] as const;

describe.skipIf(!PG_ENABLED)("مستودعات تفاوض PostgreSQL", () => {
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

  /** كل قيد مستقل حتى تكشف PostgreSQL الاسم الحقيقي لا غلاف Drizzle. */
  it.each(CONSTRAINT_CASES)(
    "ترفض $name المخالفة باسم القيد نفسه",
    async ({ name, violate }) => {
      await expectConstraint(name, () => violate(pg));
    },
  );

  it("يقرأ سياسة البذرة بجميع الحقول والأنواع", async () => {
    const policy = await pg.policies.findActive();
    expect(policy).toEqual({
      policyVersion: 1,
      label: "saudi-launch-v1",
      currency: "SAR",
      minAmountMinor: 500,
      maxAmountMinor: 500000,
      maxRounds: 5,
      roundTtlSeconds: 120,
      threadTtlSeconds: 900,
      maxMessageLength: 1000,
      maxMessagesPerThread: 100,
      isFrozen: true,
      createdAt: expect.any(String),
    });
  });

  it("يدخل الخيط ويعيد كل حقوله وtimestamptz وbigint كقيمة مجال", async () => {
    const thread = await pg.threads.create({
      id: THREAD,
      orderPublicId: ORDER_ID,
      customerPublicId: CUSTOMER_ID,
      driverPublicId: DRIVER_ID,
      dispatchOfferId: OFFER_ID,
      serviceKind: "ride",
      policyVersion: 1,
      currency: "SAR",
      openingAmountMinor: 900719925,
      openedBy: "customer",
      expiresAt: "2026-08-23T00:15:00.000Z",
      nextTickAt: "2026-08-23T00:15:00.000Z",
      createdAt: START,
    });
    expect(await pg.threads.find(THREAD)).toEqual(thread);
    expect(thread.openingAmountMinor).toBe(900719925);
    expect(thread.createdAt).toBe(START);
  });

  it("يرتب قائمة الخيوط ويطبق مرشحي order_public_id وdriver_public_id والحد", async () => {
    await insertRawThread(pg, uuid(1), 1);
    await insertRawThread(pg, uuid(2), 2);
    await pg.pool.query(
      `UPDATE negotiation_threads SET created_at = $2 WHERE id = $1`,
      [uuid(2), "2026-08-23T00:01:00Z"],
    );
    expect(
      (await pg.threads.list({ orderPublicId: order(1) }, 5)).map(
        (thread) => thread.id,
      ),
    ).toEqual([uuid(1)]);
    expect(
      (await pg.threads.list({ driverPublicId: actor(4) }, 1)).map(
        (thread) => thread.id,
      ),
    ).toEqual([uuid(2)]);
  });

  it("يدخل الجولات ويعيدها بترتيب round_no تصاعدياً", async () => {
    await insertRawThread(pg);
    await pg.rounds.create({
      id: uuid(12),
      threadId: THREAD,
      roundNo: 2,
      proposedBy: "driver",
      amountMinor: 3100,
      currency: "SAR",
      expiresAt: "2026-08-23T00:02:00.000Z",
      createdAt: START,
    });
    await pg.rounds.resolve(THREAD, 2, {
      state: "rejected",
      resolvedBy: "customer",
      respondedAt: START,
    });
    await pg.rounds.create({
      id: ROUND,
      threadId: THREAD,
      roundNo: 1,
      proposedBy: "customer",
      amountMinor: 3000,
      currency: "SAR",
      expiresAt: "2026-08-23T00:02:00.000Z",
      createdAt: START,
    });
    expect(
      (await pg.rounds.list(THREAD)).map((round) => round.roundNo),
    ).toEqual([1, 2]);
    expect((await pg.rounds.findPending(THREAD))?.amountMinor).toBe(3000);
  });

  it("يدخل الرسائل ويعيد UTF-8 وترتيب sequence_no والتنقيح", async () => {
    await insertRawThread(pg);
    const second = await pg.messages.create({
      id: uuid(22),
      threadId: THREAD,
      sequenceNo: 2,
      authorRole: "driver",
      body: "وعليكم السلام",
      sourceLocale: "ar",
      systemCode: null,
      roundNo: null,
      createdAt: START,
    });
    await pg.messages.create({
      id: MESSAGE,
      threadId: THREAD,
      sequenceNo: 1,
      authorRole: "customer",
      body: "مرحبا",
      sourceLocale: "ar",
      systemCode: null,
      roundNo: null,
      createdAt: START,
    });
    expect(
      (await pg.messages.list(THREAD)).map((message) => message.sequenceNo),
    ).toEqual([1, 2]);
    expect(
      (await pg.messages.redact(THREAD, second.id, "spam", START)).body,
    ).toBeNull();
    expect(await pg.messages.count(THREAD)).toBe(2);
  });

  it("يدخل الاتفاق ويعيده ويصفّي التسليم المستحق بالحد", async () => {
    await insertRawThread(pg);
    const agreement = await pg.agreements.create({
      threadId: THREAD,
      orderPublicId: ORDER_ID,
      driverPublicId: DRIVER_ID,
      roundNo: 1,
      amountMinor: 3000,
      currency: "SAR",
      acceptedBy: "driver",
      policyVersion: 1,
      agreedAt: START,
      nextHandoffAt: START,
    });
    expect(await pg.agreements.findByOrder(ORDER_ID)).toEqual(agreement);
    expect(await pg.agreements.listHandoffDue(START, 1)).toEqual([agreement]);
  });

  it("يدخل محاولات التسليم ويعيد الحقول بترتيب attempt_no تنازلياً", async () => {
    await insertRawAgreement(pg);
    await pg.handoffs.begin({
      id: HANDOFF,
      threadId: THREAD,
      attemptNo: 1,
      amountMinor: 3000,
      currency: "SAR",
      requestedAt: START,
    });
    const second = await pg.handoffs.begin({
      id: uuid(32),
      threadId: THREAD,
      attemptNo: 2,
      amountMinor: 3000,
      currency: "SAR",
      requestedAt: START,
    });
    const completed = await pg.handoffs.complete(second.id, {
      outcome: "unavailable",
      responseStatus: 503,
      errorCode: "order_engine_down",
      completedAt: START,
    });
    expect(completed.errorCode).toBe("order_engine_down");
    expect(
      (await pg.handoffs.list(THREAD)).map((handoff) => handoff.attemptNo),
    ).toEqual([2, 1]);
  });

  it("يحفظ مفتاح التكرار للنطاق نفسه ويرفض تغيير النطاق لأن المفتاح عالمي في العقد", async () => {
    await pg.idempotency.remember("idem-0001", "open_thread", FINGERPRINT);
    await pg.idempotency.remember("idem-0001", "open_thread", "1".repeat(64));
    await pg.idempotency.remember("idem-0001", "post_message", "2".repeat(64));
    expect(await pg.idempotency.find("idem-0001")).toEqual({
      scope: "open_thread",
      payloadFingerprint: FINGERPRINT,
    });
  });

  it("يحفظ JSONB في الصادر ويعيد غير المنشور بترتيب occurred_at ثم id", async () => {
    await pg.outbox.append(event(uuid(42), "2026-08-23T00:01:00.000Z"));
    await pg.outbox.append(event(uuid(41), START));
    const unread = await pg.outbox.unread();
    expect(unread.map((item) => item.event_id)).toEqual([uuid(41), uuid(42)]);
    expect(unread[0]?.data).toMatchObject({ order_public_id: ORDER_ID });
    expect(unread[0]?.trace_id).toBe("trace-123");
  });

  it("يحذف الصفوف التابعة للجولات والرسائل عند حذف الخيط", async () => {
    await insertRawThread(pg);
    await pg.rounds.create({
      id: ROUND,
      threadId: THREAD,
      roundNo: 1,
      proposedBy: "customer",
      amountMinor: 3000,
      currency: "SAR",
      expiresAt: START,
      createdAt: START,
    });
    await pg.messages.create({
      id: MESSAGE,
      threadId: THREAD,
      sequenceNo: 1,
      authorRole: "customer",
      body: "رسالة",
      sourceLocale: "ar",
      systemCode: null,
      roundNo: null,
      createdAt: START,
    });
    await pg.pool.query("DELETE FROM negotiation_threads WHERE id = $1", [
      THREAD,
    ]);
    expect(await pg.rounds.list(THREAD)).toEqual([]);
    expect(await pg.messages.list(THREAD)).toEqual([]);
  });

  it("يحمي تحديث الخيط بالتفاؤل ويرتب القراءة المستحقة", async () => {
    const harness = createPgHarness(pg);
    await insertRawThread(pg);
    const updated = await pg.threads.update(
      THREAD,
      { roundCount: 1, currentRoundNo: 1 },
      START,
      1,
    );
    await expect(
      pg.threads.update(THREAD, { roundCount: 2 }, START, 1),
    ).rejects.toMatchObject({
      code: "NEGOTIATION_ROUND_STALE",
    });
    expect(
      (await pg.threads.listDueForTick("2026-08-23T00:16:00.000Z", 1))[0]
        ?.version,
    ).toBe(updated.version);
    expect(harness.clock.now()).toBe(START);
  });

  it("يعرض كتالوج PostgreSQL القيود الأربعة والعشرين بالاسم نفسه", async () => {
    const result = await pg.pool.query<{ name: string }>(
      `SELECT conname AS name
       FROM pg_constraint
       WHERE conname LIKE 'ck_negotiation_%' OR conname LIKE 'ux_negotiation_%'
       UNION
       SELECT indexname AS name
       FROM pg_indexes
       WHERE indexname LIKE 'ux_negotiation_%'`,
    );
    expect(
      result.rows
        .map((row) => row.name)
        .filter((name) => name.includes("_negotiation_")),
    ).toHaveLength(24);
  });

  it("يجد الخيط بمعرف عرض التوزيع ويفصل العرض عن زوج الطلب والسائق", async () => {
    await insertRawThread(pg, uuid(51), 51);
    expect(
      (await pg.threads.findByDispatchOffer(uuid(51)))?.orderPublicId,
    ).toBe(order(51));
    expect(await pg.threads.findByDispatchOffer(uuid(52))).toBeNull();
  });

  it("يعيد قائمة السياسات بترتيب النسخة ويستبعد غير المجمدة من النشطة", async () => {
    await pg.pool.query(
      `INSERT INTO negotiation_policies (
         policy_version, label, currency, min_amount_minor, max_amount_minor, max_rounds,
         round_ttl_seconds, thread_ttl_seconds, max_message_length,
         max_messages_per_thread, is_frozen
       ) VALUES (2, 'draft-policy', 'SAR', 100, 200, 2, 60, 120, 10, 10, false)`,
    );
    expect(
      (await pg.policies.list()).map((policy) => policy.policyVersion),
    ).toEqual([1, 2]);
    expect((await pg.policies.findActive())?.policyVersion).toBe(1);
  });

  it("يرتب الجولات المستحقة حسب expires_at ثم المعرف ويطبق الحد", async () => {
    await insertRawThread(pg);
    await pg.rounds.create({
      id: uuid(62),
      threadId: THREAD,
      roundNo: 2,
      proposedBy: "driver",
      amountMinor: 3100,
      currency: "SAR",
      expiresAt: "2026-08-23T00:02:00.000Z",
      createdAt: START,
    });
    await pg.rounds.resolve(THREAD, 2, {
      state: "expired",
      resolvedBy: null,
      respondedAt: START,
    });
    await pg.rounds.create({
      id: uuid(61),
      threadId: THREAD,
      roundNo: 1,
      proposedBy: "customer",
      amountMinor: 3000,
      currency: "SAR",
      expiresAt: "2026-08-23T00:01:00.000Z",
      createdAt: START,
    });
    expect(
      (await pg.rounds.listPendingDue("2026-08-23T00:03:00.000Z", 1)).map(
        (round) => round.id,
      ),
    ).toEqual([uuid(61)]);
  });

  it("يحدث الاتفاق إلى handed_off مع القيم null المطلوبة للعقد", async () => {
    await insertRawAgreement(pg);
    const updated = await pg.agreements.update(
      THREAD,
      {
        handoffState: "handed_off",
        handoffAttempts: 1,
        handedOffAt: START,
        nextHandoffAt: null,
        lastErrorCode: null,
      },
      START,
    );
    expect(updated.handoffState).toBe("handed_off");
    expect(updated.handedOffAt).toBe(START);
    expect(updated.nextHandoffAt).toBeNull();
  });

  it("يخفي الحدث المنشور من unread ويحافظ على JSONB غير المنشور", async () => {
    await pg.outbox.append(event(uuid(71)));
    await pg.pool.query(
      "UPDATE negotiation_outbox SET published_at = $2 WHERE id = $1",
      [uuid(71), START],
    );
    await pg.outbox.append(event(uuid(72), "2026-08-23T00:01:00.000Z"));
    expect((await pg.outbox.unread()).map((item) => item.event_id)).toEqual([
      uuid(72),
    ]);
  });
});
