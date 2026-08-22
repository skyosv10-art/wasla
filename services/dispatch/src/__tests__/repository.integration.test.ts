/**
 * Postgres repository tests (Phase 07 · MR 5a/6).
 *
 * These are the tests the in-memory suite CANNOT write. Every case here is about
 * something only a real database has: a partial unique index, a CHECK constraint, a
 * trigger, an FK cascade, a row lock. The in-memory store imitates each of them with
 * a hand-written scan, so the imitation passing proves nothing about the real one.
 *
 * What is deliberately NOT retested here: the use-case behaviour. That is covered
 * once, in the pure suite, and then covered against Postgres by
 * `port-conformance.integration.test.ts` — running one scenario set through both
 * adapters. Copying the use-case assertions into this file would triple the cost of
 * every future change to the tick for no additional information.
 *
 * Skipped when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import { DISPATCH_EVENT_VERSION } from "../domain/events.js";
import { driverId, orderRef, TEST_RULES, ZONE_ID } from "./harness.js";
import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:00:30.000Z";

/** A job insert payload, numbered so a failure names which one. */
function jobInput(index: number) {
  const ref = orderRef(index);
  return {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "delivery" as const,
    vehicleClass: "motorcycle" as const,
    rules: TEST_RULES,
    expiresAt: "2026-01-01T00:03:00.000Z",
    escalationExpiresAt: "2026-01-01T00:05:00.000Z",
    createdIdempotencyKey: `create-job-key-${String(index).padStart(4, "0")}`,
    payloadFingerprint: "a".repeat(64),
    createdAt: AT,
  };
}

function waveInput(index: number, jobId: string, waveNumber: number) {
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    jobId,
    waveNumber,
    openedAt: AT,
    expiresAt: LATER,
  };
}

function offerInput(index: number, jobId: string, waveId: string, driver: number) {
  return {
    id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    jobId,
    waveId,
    driverPublicId: driverId(driver),
    orderAssignmentId: null,
    offeredAt: AT,
    expiresAt: LATER,
  };
}

/**
 * The domain error code of a rejected promise.
 *
 * Assertions name error `code`s, never messages — same discipline as the pure suite:
 * the messages are Arabic operator text and rewording one must not break a test,
 * while a changed code breaks a client. A raw (untranslated) error returns its own
 * text, so a missing translation reads as a diff instead of an unhelpful "throws".
 */
async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR_THROWN";
  } catch (error) {
    if (isDispatchError(error)) return error.code;
    return `UNTRANSLATED: ${String(error)}`;
  }
}

describe.skipIf(!PG_ENABLED)("Postgres dispatch repositories", () => {
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

  describe("dispatch_jobs", () => {
    it("round-trips a job through every column, as ISO strings", async () => {
      const input = jobInput(1);
      const inserted = await pg.jobs.insert(input);
      const read = await pg.jobs.find(input.id);

      expect(read).toEqual(inserted);
      // `pg` hands back Date objects for TIMESTAMPTZ. If one escaped the adapter,
      // `expiresAt` would be a Date here and every deadline comparison in the tick
      // would start depending on which adapter produced the row.
      expect(typeof read?.expiresAt).toBe("string");
      expect(read?.expiresAt).toBe(input.expiresAt);
      expect(read?.status).toBe("pending");
      expect(read?.statusReasonCode).toBeNull();
    });

    it("folds the five flat snapshot columns back into one rules object", async () => {
      // The DDL stores the snapshot flat so each field carries its own CHECK; the
      // domain reads one frozen object. If the fold were wrong, `waveSize` could
      // silently read `maxWaves` and every wave would be the wrong size.
      const read = await pg.jobs.insert(jobInput(2));
      expect(read.rules).toEqual(TEST_RULES);
    });

    it("refuses a second job for the same order, by any of its three unique keys", async () => {
      const first = jobInput(3);
      await pg.jobs.insert(first);

      // Same order_id.
      expect(await errorCodeOf(pg.jobs.insert({ ...first, id: jobInput(4).id }))).toBe(
        "DISPATCH_JOB_ALREADY_EXISTS",
      );
      // Same idempotency key, different order.
      expect(
        await errorCodeOf(
          pg.jobs.insert({
            ...jobInput(5),
            createdIdempotencyKey: first.createdIdempotencyKey,
          }),
        ),
      ).toBe("DISPATCH_JOB_ALREADY_EXISTS");
    });

    it("refuses an escalation deadline before the wave deadline", async () => {
      // ck_dispatch_jobs_deadline_order. Reversed, a job would escalate to the
      // community before its own paid-driver budget ran out.
      const code = await errorCodeOf(
        pg.jobs.insert({
          ...jobInput(6),
          expiresAt: "2026-01-01T00:05:00.000Z",
          escalationExpiresAt: "2026-01-01T00:03:00.000Z",
        }),
      );
      expect(code).toBe("DISPATCH_VALIDATION_FAILED");
    });

    it("refuses a fingerprint that is not 64 characters", async () => {
      const code = await errorCodeOf(
        pg.jobs.insert({ ...jobInput(7), payloadFingerprint: "short" }),
      );
      expect(code).toBe("DISPATCH_VALIDATION_FAILED");
    });

    it("refuses an illegal status move, which no CHECK constraint can catch", async () => {
      // This is the case that justifies reading the row before writing it. The DDL
      // is perfectly happy with `assigned → pending`: both are valid enum values and
      // neither needs a reason code. Only the transition table forbids it.
      const job = await pg.jobs.insert(jobInput(8));
      await pg.jobs.updateStatus(job.id, "dispatching", null, AT);
      await pg.jobs.updateStatus(job.id, "assigned", "OFFER_ACCEPTED", LATER);

      expect(await errorCodeOf(pg.jobs.updateStatus(job.id, "pending", null, LATER))).toBe(
        "DISPATCH_VALIDATION_FAILED",
      );
      expect((await pg.jobs.find(job.id))?.status).toBe("assigned");
    });

    it("refuses a terminal status with no reason, and a reason from the wrong list", async () => {
      const job = await pg.jobs.insert(jobInput(9));
      await pg.jobs.updateStatus(job.id, "dispatching", null, AT);

      expect(await errorCodeOf(pg.jobs.updateStatus(job.id, "assigned", null, LATER))).toBe(
        "DISPATCH_REASON_CODE_REQUIRED",
      );
      // `JOB_CANCELLED` is a real code — for `cancelled`, not for `assigned`.
      expect(
        await errorCodeOf(pg.jobs.updateStatus(job.id, "assigned", "JOB_CANCELLED", LATER)),
      ).toBe("DISPATCH_REASON_CODE_UNKNOWN");
    });

    it("lists active jobs by creation time then id, and drops terminal ones", async () => {
      // The tick reads this list. A non-deterministic order means two ticks can
      // process the same backlog in different sequences, which makes an incident
      // impossible to replay.
      const first = await pg.jobs.insert({ ...jobInput(10), createdAt: AT });
      const second = await pg.jobs.insert({
        ...jobInput(11),
        createdAt: "2026-01-01T00:00:10.000Z",
      });
      const third = await pg.jobs.insert({
        ...jobInput(12),
        createdAt: "2026-01-01T00:00:20.000Z",
      });
      await pg.jobs.updateStatus(second.id, "cancelled", "JOB_CANCELLED", LATER);

      const active = await pg.jobs.listActive();
      expect(active.map((job) => job.id)).toEqual([first.id, third.id]);
    });

    it("finds a job by order id and by idempotency key, and null for neither", async () => {
      const input = jobInput(13);
      await pg.jobs.insert(input);
      expect((await pg.jobs.findByOrderId(input.orderId))?.id).toBe(input.id);
      expect((await pg.jobs.findByIdempotencyKey(input.createdIdempotencyKey))?.id).toBe(input.id);
      expect(await pg.jobs.findByOrderId(orderRef(999).orderId)).toBeNull();
      expect(await pg.jobs.findByIdempotencyKey("no-such-key-0001")).toBeNull();
    });

    it("lets the trigger own updated_at", async () => {
      // trg_dispatch_jobs_updated_at (schema.sql §6). The consequence is documented
      // in DISPATCH_PERSISTENCE.md §4 and is why the conformance suite compares
      // everything except `updatedAt`.
      const job = await pg.jobs.insert(jobInput(14));
      const moved = await pg.jobs.updateStatus(job.id, "dispatching", null, AT);
      expect(Date.parse(moved.updatedAt)).toBeGreaterThanOrEqual(Date.parse(job.updatedAt));
      expect(moved.createdAt).toBe(job.createdAt);
    });
  });

  describe("dispatch_waves", () => {
    it("refuses a second OPEN wave for one job — the stall that must not happen", async () => {
      // ux_dispatch_waves_one_open_job. Two concurrent ticks both find no open wave
      // and both insert; without the partial index the customer is offered to twice
      // the configured number of drivers.
      const job = await pg.jobs.insert(jobInput(20));
      const open = await pg.waves.insert(waveInput(20, job.id, 1));

      const code = await errorCodeOf(pg.waves.insert(waveInput(21, job.id, 2)));
      expect(code).toBe("DISPATCH_WAVE_ALREADY_OPEN");
      // And the message names the wave that IS open, not the one we tried to open.
      expect((await pg.waves.findOpenForJob(job.id))?.id).toBe(open.id);
    });

    it("allows the next wave once the previous one is closed", async () => {
      const job = await pg.jobs.insert(jobInput(21));
      const first = await pg.waves.insert(waveInput(22, job.id, 1));
      await pg.waves.updateStatus(first.id, "completed", "WAVE_OFFERS_RESOLVED", LATER);
      const second = await pg.waves.insert(waveInput(23, job.id, 2));

      expect(second.waveNumber).toBe(2);
      expect(await pg.waves.countForJob(job.id)).toBe(2);
      expect((await pg.waves.listForJob(job.id)).map((wave) => wave.waveNumber)).toEqual([1, 2]);
    });

    it("refuses a repeated wave number even after the first one closed", async () => {
      // ux_dispatch_waves_job_number. Without it, a retried tick would re-open
      // "wave 2" and the wave budget would never be reached.
      const job = await pg.jobs.insert(jobInput(22));
      const first = await pg.waves.insert(waveInput(24, job.id, 1));
      await pg.waves.updateStatus(first.id, "completed", "WAVE_OFFERS_RESOLVED", LATER);

      expect(await errorCodeOf(pg.waves.insert(waveInput(25, job.id, 1)))).toBe(
        "DISPATCH_WAVE_ALREADY_OPEN",
      );
    });

    it("keeps completed_at null exactly while the wave is open", async () => {
      // ck_dispatch_waves_state_timestamp. A closed wave with no closing time is a
      // wave whose duration cannot be reported.
      const job = await pg.jobs.insert(jobInput(23));
      const wave = await pg.waves.insert(waveInput(26, job.id, 1));
      expect(wave.completedAt).toBeNull();

      const closed = await pg.waves.updateStatus(wave.id, "completed", "OFFER_ACCEPTED", LATER);
      expect(closed.completedAt).toBe(LATER);
    });

    it("stores the round deadline the contract requires", async () => {
      // The gap MR 5a/6 found: `expires_at` is NOT NULL, and the value used to exist
      // only inside the `dispatch.wave_opened` event payload.
      const job = await pg.jobs.insert(jobInput(24));
      const wave = await pg.waves.insert(waveInput(27, job.id, 1));
      expect(wave.expiresAt).toBe(LATER);
    });

    it("refuses a wave for a job that does not exist", async () => {
      // The FK. In memory this insert succeeds and produces an orphan.
      await expect(
        pg.waves.insert(waveInput(28, "30000000-0000-4000-8000-000000000999", 1)),
      ).rejects.toThrow();
    });
  });

  describe("dispatch_offers", () => {
    it("refuses the same driver twice in one job, across waves", async () => {
      // ux_dispatch_offers_job_driver — the guard that stops wave 3 re-asking the
      // driver who declined in wave 1, and it holds even if the exclusion list we
      // send to matching is wrong.
      const job = await pg.jobs.insert(jobInput(30));
      const first = await pg.waves.insert(waveInput(30, job.id, 1));
      await pg.offers.insert(offerInput(30, job.id, first.id, 1));
      await pg.offers.resolve(offerInput(30, job.id, first.id, 1).id, {
        status: "rejected",
        reasonCode: "DRIVER_DECLINED",
        respondedAt: LATER,
        resolvedAt: LATER,
      });
      await pg.waves.updateStatus(first.id, "completed", "WAVE_OFFERS_RESOLVED", LATER);
      const second = await pg.waves.insert(waveInput(31, job.id, 2));

      expect(await errorCodeOf(pg.offers.insert(offerInput(31, job.id, second.id, 1)))).toBe(
        "DISPATCH_MATCHING_RESULT_INVALID",
      );
    });

    it("refuses a second accepted offer for one job", async () => {
      // ux_dispatch_offers_one_accepted_job. This is the constraint that decides
      // every accept race: without it two drivers both drive to the restaurant.
      const job = await pg.jobs.insert(jobInput(31));
      const wave = await pg.waves.insert(waveInput(32, job.id, 1));
      const a = offerInput(32, job.id, wave.id, 1);
      const b = offerInput(33, job.id, wave.id, 2);
      await pg.offers.insert(a);
      await pg.offers.insert(b);

      await pg.offers.resolve(a.id, {
        status: "accepted",
        reasonCode: "OFFER_ACCEPTED",
        respondedAt: LATER,
        resolvedAt: LATER,
      });
      expect(
        await errorCodeOf(
          pg.offers.resolve(b.id, {
            status: "accepted",
            reasonCode: "OFFER_ACCEPTED",
            respondedAt: LATER,
            resolvedAt: LATER,
          }),
        ),
      ).toBe("DISPATCH_OFFER_SUPERSEDED");
      expect((await pg.offers.find(b.id))?.status).toBe("offered");
    });

    it("refuses resolving an already-resolved offer", async () => {
      const job = await pg.jobs.insert(jobInput(32));
      const wave = await pg.waves.insert(waveInput(33, job.id, 1));
      const offer = offerInput(34, job.id, wave.id, 1);
      await pg.offers.insert(offer);
      await pg.offers.resolve(offer.id, {
        status: "rejected",
        reasonCode: "DRIVER_DECLINED",
        respondedAt: LATER,
        resolvedAt: LATER,
      });

      expect(
        await errorCodeOf(
          pg.offers.resolve(offer.id, {
            status: "accepted",
            reasonCode: "OFFER_ACCEPTED",
            respondedAt: LATER,
            resolvedAt: LATER,
          }),
        ),
      ).toBe("DISPATCH_VALIDATION_FAILED");
    });

    it("refuses a responded_at on an outcome no human answered", async () => {
      // ck_dispatch_offers_state_timestamp: a timed-out offer with a response time
      // is a contradiction, and it is the shape a buggy retry produces.
      const job = await pg.jobs.insert(jobInput(33));
      const wave = await pg.waves.insert(waveInput(34, job.id, 1));
      const offer = offerInput(35, job.id, wave.id, 1);
      await pg.offers.insert(offer);

      expect(
        await errorCodeOf(
          pg.offers.resolve(offer.id, {
            status: "timed_out",
            reasonCode: "OFFER_TIMED_OUT",
            respondedAt: LATER,
            resolvedAt: LATER,
          }),
        ),
      ).toBe("DISPATCH_VALIDATION_FAILED");
    });

    it("refuses a driver id that is not a WASLA public id", async () => {
      const job = await pg.jobs.insert(jobInput(34));
      const wave = await pg.waves.insert(waveInput(35, job.id, 1));
      expect(
        await errorCodeOf(
          pg.offers.insert({ ...offerInput(36, job.id, wave.id, 1), driverPublicId: "driver-7" }),
        ),
      ).toBe("DISPATCH_VALIDATION_FAILED");
    });

    it("lists offers deterministically, and every driver ever offered", async () => {
      const job = await pg.jobs.insert(jobInput(35));
      const wave = await pg.waves.insert(waveInput(36, job.id, 1));
      // Same `offeredAt` on purpose: within one wave every offer shares the tick's
      // clock reading, so `id` is the tie-break that makes the order stable.
      await pg.offers.insert(offerInput(38, job.id, wave.id, 2));
      await pg.offers.insert(offerInput(37, job.id, wave.id, 1));

      const listed = await pg.offers.listForJob(job.id);
      expect(listed.map((offer) => offer.id)).toEqual([
        offerInput(37, job.id, wave.id, 1).id,
        offerInput(38, job.id, wave.id, 2).id,
      ]);
      expect(await pg.offers.listOfferedDriverIds(job.id)).toEqual([driverId(1), driverId(2)]);
      expect((await pg.offers.listForWave(wave.id)).length).toBe(2);
    });

    it("deletes a job's waves and offers with the job (FK cascade)", async () => {
      // ON DELETE CASCADE. Nothing in the service deletes a job, but an operator
      // eventually will, and a leftover offer row pointing at a missing job would
      // break `listOfferedDriverIds` for the order's replacement job.
      const job = await pg.jobs.insert(jobInput(36));
      const wave = await pg.waves.insert(waveInput(37, job.id, 1));
      await pg.offers.insert(offerInput(39, job.id, wave.id, 1));

      await pg.pool.query("DELETE FROM dispatch_jobs WHERE id = $1", [job.id]);
      expect(await pg.waves.listForJob(job.id)).toEqual([]);
      expect(await pg.offers.listForJob(job.id)).toEqual([]);
    });
  });

  describe("dispatch_outbox", () => {
    it("returns unpublished events in append order and hides published ones", async () => {
      const job = await pg.jobs.insert(jobInput(40));
      const base = {
        // `event_version` is TEXT `^v[0-9]+$` in the contract, not an integer: a
        // consumer routes on the string, and the CHECK is what keeps a `1` from
        // being stored and breaking that routing.
        event_version: DISPATCH_EVENT_VERSION,
        occurred_at: AT,
        aggregate: { type: "dispatch_job" as const, id: job.id },
        trace_id: null,
      };
      const first = {
        ...base,
        event_id: "60000000-0000-4000-8000-000000000001",
        event_type: "dispatch.job_created" as const,
        data: { dispatch_job_id: job.id },
      };
      const second = {
        ...base,
        event_id: "60000000-0000-4000-8000-000000000002",
        event_type: "dispatch.job_dispatching" as const,
        data: { dispatch_job_id: job.id },
      };

      // Appended out of order to prove the ORDER BY, not the insertion order.
      await pg.outbox.append(second as never);
      await pg.outbox.append(first as never);

      const unread = await pg.outbox.unread();
      expect(unread.map((event) => event.event_id)).toEqual([first.event_id, second.event_id]);

      expect(await pg.outbox.markPublished([first.event_id], LATER)).toBe(1);
      expect((await pg.outbox.unread()).map((event) => event.event_id)).toEqual([second.event_id]);
    });

    it("stores the whole event payload, not a projection of it", async () => {
      // The relay (Phase 09) republishes this JSON verbatim. If the adapter stored a
      // subset, the consumer contract would be decided here instead of in
      // `contracts/events.json`.
      const job = await pg.jobs.insert(jobInput(41));
      const event = {
        event_id: "60000000-0000-4000-8000-000000000003",
        event_type: "dispatch.job_created" as const,
        event_version: DISPATCH_EVENT_VERSION,
        occurred_at: AT,
        aggregate: { type: "dispatch_job" as const, id: job.id },
        trace_id: "trace-abc",
        data: { dispatch_job_id: job.id, zone_id: ZONE_ID, nested: { deep: [1, 2, 3] } },
      };
      await pg.outbox.append(event as never);
      expect((await pg.outbox.unread())[0]).toEqual(event);
    });

    it("counts nothing for an empty publish list", async () => {
      expect(await pg.outbox.markPublished([], LATER)).toBe(0);
    });
  });

  describe("dispatch_idempotency", () => {
    it("remembers a fingerprint and answers null for an unknown key", async () => {
      await pg.idempotency.remember("accept-offer-key-1", "b".repeat(64));
      expect(await pg.idempotency.find("accept-offer-key-1")).toBe("b".repeat(64));
      expect(await pg.idempotency.find("never-seen-key-1")).toBeNull();
    });

    it("treats a repeat of the same key as a retry, not a conflict", async () => {
      // The upsert. A primary-key violation here would turn a network retry into a
      // 500 AFTER the use case had already decided the call was a replay.
      await pg.idempotency.remember("accept-offer-key-2", "c".repeat(64));
      await expect(
        pg.idempotency.remember("accept-offer-key-2", "c".repeat(64)),
      ).resolves.toBeUndefined();
    });

    it("refuses a key outside the 8..128 the domain validator enforces", async () => {
      expect(await errorCodeOf(pg.idempotency.remember("short", "d".repeat(64)))).toBe(
        "DISPATCH_VALIDATION_FAILED",
      );
    });
  });
});
