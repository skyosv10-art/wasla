/**
 * Wire shapes: snake_case fields, and the privacy boundary between the two
 * candidate-bearing responses and everything else.
 *
 * These tests are cheap and boring on purpose. The expensive failure they prevent
 * is a field that silently stops being serialised — the response still validates
 * as an object, the consumer still parses it, and the missing value only surfaces
 * as a wrong ranking somewhere else.
 */

import { describe, expect, it } from "vitest";

import { driverAvailabilityChanged, driverCandidacyUpdated } from "../domain/events.js";
import { RULESET_V1 } from "../domain/ruleset.js";
import { toCandidateResult, toCandidacy, toDecision, toRuleset } from "../mappers.js";
import { evaluateCandidates } from "../use-cases/evaluate-candidates.js";
import { readCandidacy, upsertCandidacy } from "../use-cases/manage-candidacy.js";
import {
  ZONE_PICKUP,
  candidacyFixture,
  createHarness,
  queryFixture,
  seedAll,
} from "./harness.js";

describe("candidate result mapping", () => {
  it("emits the contract field names for a non-empty result", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000801" })]);

    const wire = toCandidateResult(await evaluateCandidates(deps, queryFixture() as never));

    expect(Object.keys(wire).sort()).toEqual([
      "candidates",
      "counts",
      "decision_id",
      "evaluated_at",
      "ruleset_version",
    ]);
    expect(wire.candidates[0]).toMatchObject({
      rank: 1,
      driver_public_id: "WS-0000000801",
      tiebreak_by: "score",
    });
    expect(Object.keys(wire.candidates[0]!.components!).sort()).toEqual([
      "acceptance_bp",
      "completion_bp",
      "fairness_bp",
      "zone_proximity_bp",
    ]);
  });

  it("includes empty_reason_code exactly when the list is empty", async () => {
    const deps = createHarness();
    const empty = toCandidateResult(await evaluateCandidates(deps, queryFixture() as never));
    expect(empty.empty_reason_code).toBe("NO_CANDIDACY_ROWS");

    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000802" })]);
    const filled = toCandidateResult(await evaluateCandidates(deps, queryFixture() as never));
    // Present-but-null would tell a consumer there is a reason and refuse to name it.
    expect("empty_reason_code" in filled).toBe(false);
  });

  it("omits the audit-only counter from the dispatch-facing response", async () => {
    const deps = createHarness();
    const wire = toCandidateResult(await evaluateCandidates(deps, queryFixture() as never));
    expect(Object.keys(wire.counts).sort()).toEqual(["considered", "eligible", "returned"]);
  });
});

describe("candidacy mapping", () => {
  it("carries every declared field plus the computed freshness flag", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, {
      driverPublicId: "WS-0000000810",
      availabilityState: "available",
      eligibilityState: "eligible",
      eligibilitySource: "claimed",
      serviceKinds: ["ride"],
      vehicleClass: "sedan",
      zoneIds: [ZONE_PICKUP],
      actorType: "driver_bot",
      idempotencyKey: "idem-mapper-0001",
    } as never);

    const wire = toCandidacy(await readCandidacy(deps, "WS-0000000810"));

    expect(wire).toMatchObject({
      driver_public_id: "WS-0000000810",
      availability_state: "available",
      eligibility_state: "eligible",
      eligibility_source: "claimed",
      service_kinds: ["ride"],
      vehicle_class: "sedan",
      zone_ids: [ZONE_PICKUP],
      offers_received: 0,
      offers_accepted: 0,
      orders_completed: 0,
      is_fresh: true,
      updated_by: "driver_bot",
    });
    expect(wire.last_offered_at).toBeNull();
  });
});

describe("ruleset mapping", () => {
  it("names all seven weights, including the ones weighted zero", () => {
    const wire = toRuleset(RULESET_V1);
    expect(Object.keys(wire.weights!).sort()).toEqual([
      "acceptance",
      "completion",
      "distance",
      "eta",
      "fairness",
      "rating",
      "zone_proximity",
    ]);
    expect(wire.weights!.zone_proximity).toBe(RULESET_V1.weights.zoneProximity);
    expect(wire.is_frozen).toBe(true);
  });
});

describe("decision mapping is the only path that pairs ids with scores", () => {
  it("returns the audit view with candidates and the excluded counter", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000820" })]);
    const result = await evaluateCandidates(deps, queryFixture() as never);

    const wire = toDecision(result.decision);

    expect(wire.decision_id).toBe(result.decisionId);
    expect(wire.counts).toMatchObject({ excluded: 0 });
    expect(wire.candidates![0]!.driver_public_id).toBe("WS-0000000820");
    expect(wire.empty_reason_code).toBeNull();
  });
});

describe("events keep their envelope and their limits", () => {
  const envelope = {
    eventId: "44444444-4444-4444-8444-444444444444",
    occurredAt: "2026-08-22T00:00:00.000Z",
    traceId: null,
  };

  it("stamps the standard envelope on a candidacy event", () => {
    const event = driverCandidacyUpdated(candidacyFixture({ driverPublicId: "WS-0000000830" }), envelope);
    expect(event).toMatchObject({
      event_id: envelope.eventId,
      event_type: "matching.candidacy_updated",
      event_version: "v1",
      producer: "matching-service",
      aggregate: { type: "driver_candidacy", id: "WS-0000000830" },
    });
  });

  it("carries both states on an availability event", () => {
    const event = driverAvailabilityChanged(
      {
        driverPublicId: "WS-0000000831",
        fromState: "available",
        toState: "busy",
        actorType: "driver_bot",
        reasonCode: "OFFER_ACCEPTED",
        changedAt: envelope.occurredAt,
      },
      envelope,
    );
    // A consumer told only the destination cannot tell a change from a repetition,
    // and a bot that cannot tell shows its owner a flickering status.
    expect(event.data).toMatchObject({ from_state: "available", to_state: "busy" });
  });

  it("never carries a channel identifier anywhere in a payload", () => {
    const payload = JSON.stringify(
      driverCandidacyUpdated(candidacyFixture({ driverPublicId: "WS-0000000832" }), envelope),
    );
    // ADR-007: escalation is a decision here and a delivery there.
    expect(payload).not.toMatch(/chat_id|telegram/i);
  });
});
