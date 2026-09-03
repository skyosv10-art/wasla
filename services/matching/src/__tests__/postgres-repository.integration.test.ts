/**
 * What only a real engine can prove.
 *
 * The port-conformance suite proves that the two adapters BEHAVE the same. This
 * file proves the things that live in the database and that no in-memory
 * imitation can establish: that the constraints of the contract are actually
 * enforced, that the indexes exist, that the seeded ruleset is really there, and
 * that a value survives the round trip through `TIMESTAMPTZ`, `TEXT[]` and
 * `UUID[]` unchanged.
 *
 * Every assertion here answers "what breaks in production if this is wrong?":
 *  - an unenforced `ck_candidacy_accepted_lte_received` produces an acceptance
 *    rate above one, which silently reorders every driver,
 *  - an unenforced `ux_decision_rank` lets one decision carry two rank 1s, and
 *    the audit answer stops being a ranking,
 *  - an unenforced `ck_decision_empty_has_reason` lets "zero candidates" be
 *    stored with no cause, which is the state an operator cannot investigate,
 *  - a missing seeded ruleset means a service that cannot rank at all.
 *
 * Skipped when DATABASE_URL is unset. CI job: `matching-db-integration`.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { RULESET_V1, RULESET_V1_VERSION } from "../domain/ruleset.js";
import type { Candidacy, MatchingDecision } from "../domain/model.js";
import { candidacyFixture, NOW, ORDER_ID, ORDER_PUBLIC_ID, ZONE_PICKUP, ZONE_SAME_CITY } from "./harness.js";
import { CONTRACT_TABLES, PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

const DRIVER_A = "WS-8000000001";
const DRIVER_B = "WS-8000000002";
const DECISION_ID = "22222222-2222-4222-8222-222222222222";

/** A decision that satisfies every CHECK, so each test can break exactly one. */
function decisionFixture(overrides: Partial<MatchingDecision> = {}): MatchingDecision {
  return {
    id: DECISION_ID,
    orderId: ORDER_ID,
    orderPublicId: ORDER_PUBLIC_ID,
    dispatchJobId: null,
    rulesetVersion: RULESET_V1_VERSION,
    requestedAt: NOW,
    evaluatedAt: NOW,
    orderType: "ride",
    vehicleClass: "sedan",
    pickupZoneId: ZONE_PICKUP,
    counts: { considered: 2, eligible: 2, returned: 1, excluded: 0 },
    emptyReasonCode: null,
    candidates: [
      {
        rank: 1,
        driverPublicId: DRIVER_A,
        scoreBp: 8_000,
        components: {
          zoneProximityBp: 10_000,
          completionBp: 5_000,
          acceptanceBp: 7_000,
          fairnessBp: 10_000,
        },
        tiebreakBy: "score",
      },
    ],
    createdAt: NOW,
    ...overrides,
  };
}

describe.skipIf(!PG_ENABLED)("matching Postgres adapters", () => {
  let pg: PgFixture;

  beforeEach(async () => {
    pg ??= await setupPostgres();
    await resetData(pg.pool);
  });

  afterAll(async () => {
    await pg?.close();
  });

  // ------------------------------------------------------------------ //
  // The schema itself                                                  //
  // ------------------------------------------------------------------ //

  // ── M0-18 · لماذا لا تُقرأ القاعدةُ كلُّها ────────────────────────────
  // كان هذا التوكيدُ يقرأُ **كلَّ** جداولِ `public` ويوازيها بجداولِ العقدِ
  // بـ`toEqual`، فكانَ يُوكِّدُ — من غيرِ أن يُعلنَ — أنّ **لا خدمةَ أخرى
  // تشاركُ القاعدةَ**. وذلك ليسَ عقداً لخدمةِ المطابقةِ: القاعدةُ ليست ملكَها،
  // و`docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md` §3 تُعلنُ الاشتراكَ آمناً.
  // فحينَ شُغِّلت الاثنتا عشرةَ مجموعةً تِباعاً على قاعدةٍ واحدةٍ (2026-08-30)
  // رأى التوكيدُ 53 جدولاً بدلَ 6 وأخفقَ — وهو `RISK-0014`. وصارت نتيجةُ
  // المجموعةِ **دالّةً في ترتيبِ التشغيلِ** لا في شفرةِ الخدمةِ.
  //
  // والعلاجُ ليسَ إضعافَ التوكيدِ بل **تصحيحَ موضوعِه**: العقدُ يقولُ
  // «هذهِ الجداولُ الستةُ موجودةٌ» ولا يقولُ «ولا شيءَ غيرَها في القاعدةِ».
  // فالاستعلامُ يُقيَّدُ بـ`= ANY($1)` — لا يرى غيرَ أسماءِ العقدِ إطلاقاً.
  //
  // **وما فُقد لم يُهدَر:** بُعدُ «لا جدولَ زائداً» محروسٌ ثابتاً في
  // `schema-drift.test.ts` («declares exactly the tables the projection covers»)
  // الذي يوازي DDLالعقدِ بمسقطِ Drizzle — بلا قاعدةٍ ولا اشتراكٍ. فالبعدُ
  // انتقلَ إلى موضعِه الصحيحِ ولم يُحذَف.
  //
  // **وقائمةُ العقدِ تُقرأُ من الملفِ وقتَ التشغيلِ** لا تُكتَبُ حرفاً هنا،
  // فلا يمكنُ لجدولٍ يُحذَفُ من `schema.sql` أن يبقى محروساً وهماً.
  // ────────────────────────────────────────────────────────────────────

  it("creates every table and index the contract declares", async () => {
    const tables = await pg.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1",
      [CONTRACT_TABLES],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([...CONTRACT_TABLES].sort());

    const indexes = await pg.pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY 1",
      [CONTRACT_TABLES],
    );
    const names = indexes.rows.map((row) => row.indexname);
    // The partial index is the one that keeps the candidate scan proportional to
    // the number of available drivers instead of everyone who ever registered.
    expect(names).toContain("ix_candidacy_ready");
    expect(names).toContain("ix_candidacy_zones");
    expect(names).toContain("ix_candidacy_services");
    expect(names).toContain("ix_decisions_order");
    expect(names).toContain("ix_matching_outbox_unpublished");
  });

  // ── M0-18 · معيارُ القبولِ الثاني حرفاً ───────────────────────────────
  // «وحالةٌ تُثبت أنّ توكيدَ ‹كلُّ ما يُعلنه العقدُ› لا يقرأ جداولَ خدمةٍ أخرى».
  //
  // وهذه الحالةُ **قُطريّةٌ**: لا تكتفي بأن التوكيدَ المُقيَّدَ لا يرى الدخيلَ،
  // بل تُثبِتُ أوّلاً أنّ الاستعلامَ الواسعَ **يراه** — وإلا كانت الحالةُ
  // زخرفةً تنجحُ لأنّ الدخيلَ لم يُخلَق أصلاً.
  //
  // والدخيلُ يُحاكي خدمةً أخرى بجدولٍ وفهرسٍ في `public`، ويُحذَفُ في
  // `finally` فلا يُلوِّثُ ما بعدَه — لأنّ هذه المجموعةَ **هي** التي تُشغَّلُ
  // على القاعدةِ المشتركةِ، فلا يجوزُ أن تُخلِّفَ ما خلَّفَه غيرُها.
  // ────────────────────────────────────────────────────────────────────

  it("reads only the contract's own tables when another service shares the database", async () => {
    const foreignTable = "m0_18_foreign_service_probe";
    const foreignIndex = "ix_m0_18_foreign_service_probe";

    try {
      await pg.pool.query(`CREATE TABLE ${foreignTable} (id BIGSERIAL PRIMARY KEY, note TEXT)`);
      await pg.pool.query(`CREATE INDEX ${foreignIndex} ON ${foreignTable} (note)`);

      // 1. الدخيلُ حقيقيٌّ: الاستعلامُ الواسعُ — وهو ما كان التوكيدُ يستعملُه —
      //    يراه. فلو أخفقَ هذا السطرُ لكانَ ما بعدَه بلا معنى.
      const wide = await pg.pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
      );
      const wideNames = wide.rows.map((row) => row.table_name);
      expect(wideNames).toContain(foreignTable);
      // وهذا هو الإخفاقُ الأصليُّ حرفاً: الواسعُ **لا يساوي** جداولَ العقدِ.
      expect(wideNames).not.toEqual([...CONTRACT_TABLES].sort());

      // 2. والتوكيدُ المُقيَّدُ لا يراه، ويبقى مساوياً لجداولِ العقدِ تماماً.
      const scoped = await pg.pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1",
        [CONTRACT_TABLES],
      );
      const scopedNames = scoped.rows.map((row) => row.table_name);
      expect(scopedNames).not.toContain(foreignTable);
      expect(scopedNames).toEqual([...CONTRACT_TABLES].sort());

      // 3. والفهارسُ كذلك — فقيدُ `tablename` لا اسمُ الفهرسِ، إذ الفهرسُ
      //    الدخيلُ قد يُسمّى أيَّ شيءٍ ولا يُتوقَّعُ اسمُه.
      const scopedIndexes = await pg.pool.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY 1",
        [CONTRACT_TABLES],
      );
      expect(scopedIndexes.rows.map((row) => row.indexname)).not.toContain(foreignIndex);
    } finally {
      await pg.pool.query(`DROP TABLE IF EXISTS ${foreignTable} CASCADE`);
    }
  });

  it("seeds ruleset version 1 exactly as the domain copy declares it", async () => {
    const active = await pg.rulesets.findActive();
    expect(active?.version).toBe(RULESET_V1_VERSION);
    expect(active?.label).toBe(RULESET_V1.label);
    expect(active?.weights).toEqual(RULESET_V1.weights);
    expect(active?.candidacyFreshnessSeconds).toBe(RULESET_V1.candidacyFreshnessSeconds);
    expect(active?.maxCandidates).toBe(RULESET_V1.maxCandidates);
    expect(active?.fairnessHorizonSeconds).toBe(RULESET_V1.fairnessHorizonSeconds);
    expect(active?.isFrozen).toBe(true);
    // The seeded row's timestamps come from now(), so they are real times rather
    // than the epoch sentinel the pure domain copy carries.
    expect(active?.frozenAt).not.toBeNull();
  });

  it("never returns an unfrozen ruleset as the active one", async () => {
    await pg.rulesets.put({
      ...RULESET_V1,
      version: 2,
      label: "draft-not-frozen",
      isFrozen: false,
      frozenAt: null,
      createdAt: NOW,
    });
    const active = await pg.rulesets.findActive();
    // Version 2 is newer, and it must still lose: a decision produced by an
    // editable ruleset cannot be defended afterwards.
    expect(active?.version).toBe(RULESET_V1_VERSION);
    expect((await pg.rulesets.list()).map((r) => r.version)).toEqual([1, 2]);
  });

  // ------------------------------------------------------------------ //
  // Round trips                                                        //
  // ------------------------------------------------------------------ //

  it("round-trips arrays, nullable timestamps and counters unchanged", async () => {
    const row: Candidacy = candidacyFixture({
      driverPublicId: DRIVER_A,
      serviceKinds: ["ride", "delivery"],
      zoneIds: [ZONE_PICKUP, ZONE_SAME_CITY],
      lastOfferedAt: "2026-08-20T10:30:00.000Z",
      lastAssignedAt: null,
      offersReceived: 9,
      offersAccepted: 4,
      ordersCompleted: 3,
    });
    await pg.candidacy.seed(row);
    expect(await pg.candidacy.find(DRIVER_A)).toEqual(row);
  });

  it("returns every row to the evaluator, including the ones the filters will drop", async () => {
    // `counts.considered` is defined as every row that took part, and the filter
    // ORDER decides which reason code an operator reads. Pushing the filters into
    // SQL would move both into a query plan (declared debt, Phase 09).
    await pg.candidacy.seed(candidacyFixture({ driverPublicId: DRIVER_A }));
    await pg.candidacy.seed(
      candidacyFixture({
        driverPublicId: DRIVER_B,
        availabilityState: "offline",
        eligibilityState: "unknown",
      }),
    );
    const rows = await pg.candidacy.listForEvaluation();
    expect(rows.map((row) => row.driverPublicId).sort()).toEqual([DRIVER_A, DRIVER_B]);
  });

  it("stores a decision with its ranked candidates and reads them back in rank order", async () => {
    const decision = decisionFixture({
      counts: { considered: 3, eligible: 2, returned: 2, excluded: 1 },
      candidates: [
        ...decisionFixture().candidates,
        {
          rank: 2,
          driverPublicId: DRIVER_B,
          scoreBp: 4_000,
          components: {
            zoneProximityBp: 2_000,
            completionBp: 1_000,
            acceptanceBp: 5_000,
            fairnessBp: 10_000,
          },
          tiebreakBy: "driver_public_id",
        },
      ],
    });
    await pg.decisions.append(decision);
    const readBack = await pg.decisions.find(decision.id);
    expect(readBack).toEqual(decision);
    expect(readBack?.candidates.map((candidate) => candidate.rank)).toEqual([1, 2]);
  });

  it("refuses to append the same decision id twice (append-only audit)", async () => {
    await pg.decisions.append(decisionFixture());
    await expect(pg.decisions.append(decisionFixture())).rejects.toThrow();
    expect(await pg.decisions.count()).toBe(1);
  });

  it("deletes the score rows with their decision and nothing else", async () => {
    // ON DELETE CASCADE exists so a future pruning policy (Phase 09) can drop
    // scores without leaving orphan rows that no query would ever find again.
    await pg.decisions.append(decisionFixture());
    await pg.pool.query("DELETE FROM matching_decisions WHERE id = $1", [DECISION_ID]);
    const orphans = await pg.pool.query("SELECT 1 FROM matching_decision_candidates");
    expect(orphans.rowCount).toBe(0);
  });

  // ------------------------------------------------------------------ //
  // Constraints — the promises the DDL makes                           //
  // ------------------------------------------------------------------ //

  it("rejects an accepted count above the received count", async () => {
    await expect(
      pg.pool.query(
        `INSERT INTO driver_candidacy (driver_public_id, offers_received, offers_accepted)
         VALUES ($1, 1, 2)`,
        [DRIVER_A],
      ),
    ).rejects.toThrow(/ck_candidacy_accepted_lte_received/u);
  });

  it("rejects a driver public id that is not in the WS shape", async () => {
    await expect(
      pg.pool.query("INSERT INTO driver_candidacy (driver_public_id) VALUES ($1)", ["driver-1"]),
    ).rejects.toThrow(/driver_public_id/u);
  });

  it("rejects non-monotonic decision counts", async () => {
    await expect(
      pg.decisions.append(
        decisionFixture({ counts: { considered: 1, eligible: 2, returned: 1, excluded: 0 } }),
      ),
    ).rejects.toThrow(/ck_decision_counts_monotonic/u);
  });

  it("rejects an empty decision with no reason code", async () => {
    await expect(
      pg.decisions.append(
        decisionFixture({
          counts: { considered: 5, eligible: 0, returned: 0, excluded: 0 },
          emptyReasonCode: null,
          candidates: [],
        }),
      ),
    ).rejects.toThrow(/ck_decision_empty_has_reason/u);
  });

  it("rejects two candidates sharing a rank inside one decision", async () => {
    await pg.decisions.append(decisionFixture());
    await expect(
      pg.pool.query(
        `INSERT INTO matching_decision_candidates
           (decision_id, rank, driver_public_id, score_bp, zone_proximity_bp, completion_bp, acceptance_bp, fairness_bp)
         VALUES ($1, 1, $2, 100, 0, 0, 0, 0)`,
        [DECISION_ID, DRIVER_B],
      ),
    ).rejects.toThrow(/ux_decision_rank/u);
  });

  it("rejects a ruleset whose weights do not sum to 100", async () => {
    await expect(
      pg.rulesets.put({
        ...RULESET_V1,
        version: 3,
        label: "weights-do-not-sum",
        weights: { ...RULESET_V1.weights, fairness: 30 },
      }),
    ).rejects.toThrow(/ck_ruleset_weights_sum_100/u);
  });

  it("rejects a frozen ruleset with no frozen_at, and the reverse", async () => {
    await expect(
      pg.rulesets.put({ ...RULESET_V1, version: 4, isFrozen: true, frozenAt: null }),
    ).rejects.toThrow(/ck_ruleset_frozen_at/u);
    await expect(
      pg.rulesets.put({ ...RULESET_V1, version: 5, isFrozen: false, frozenAt: NOW }),
    ).rejects.toThrow(/ck_ruleset_frozen_at/u);
  });

  it("rejects an idempotency key shorter than the domain validator accepts", async () => {
    await expect(pg.idempotency.remember("short", "fingerprint")).rejects.toMatchObject({
      code: "MATCHING_VALIDATION_FAILED",
    });
  });

  // ------------------------------------------------------------------ //
  // The outbox                                                         //
  // ------------------------------------------------------------------ //

  it("returns only unpublished events, in append order", async () => {
    const event = (id: string, occurredAt: string) => ({
      event_id: id,
      event_type: "matching.driver_availability_changed",
      event_version: "v1" as const,
      occurred_at: occurredAt,
      producer: "matching-service" as const,
      aggregate: { type: "driver_candidacy" as const, id: DRIVER_A },
      trace_id: null,
      data: {
        driver_public_id: DRIVER_A,
        from_state: "offline" as const,
        to_state: "available" as const,
        changed_at: occurredAt,
      },
    });
    const first = "33333333-3333-4333-8333-333333333331";
    const second = "33333333-3333-4333-8333-333333333332";
    await pg.outbox.append(event(first, "2026-08-22T00:00:00.000Z") as never);
    await pg.outbox.append(event(second, "2026-08-22T00:00:01.000Z") as never);

    expect((await pg.outbox.unread()).map((e) => e.event_id)).toEqual([first, second]);
    expect(await pg.outbox.markPublished([first], NOW)).toBe(1);
    expect((await pg.outbox.unread()).map((e) => e.event_id)).toEqual([second]);
  });
});
