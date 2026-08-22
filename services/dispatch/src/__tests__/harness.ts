/**
 * Test harness: the two fakes and a wired dependency bundle.
 *
 * The fake order engine deliberately imports the **real** transition table from
 * `@wasla/orders-service` and validates every requested move against it. A hand-written
 * fake that accepts anything would let dispatch build a sequence of transitions the real
 * engine rejects, and we would only find out in the exit gate (MR 6/6) — after the
 * persistence and HTTP layers were built on top of the mistake. This way the fake cannot
 * lie about what the engine would accept.
 *
 * The fakes also model the two conflict codes that matter to dispatch:
 * `ORDER_ASSIGNMENT_FORBIDDEN` (someone already holds this order) and
 * `ORDER_ASSIGNMENT_DUPLICATE` (this driver already has a live assignment on it). Those
 * two are how a race gets decided, so a fake that could not produce them would leave the
 * most important branch in `accept-offer.ts` untested.
 */
import { isTransitionAllowed } from "@wasla/orders-service";

import { engineUnavailable, orderEngineTimeout } from "../domain/errors.js";
import type { DispatchRules } from "../domain/model.js";
import {
  FixedClock,
  InMemoryIdempotencyStore,
  InMemoryJobRepository,
  InMemoryOfferRepository,
  InMemoryOutbox,
  InMemoryWaveRepository,
  SequentialIdGenerator,
  StaticRulesProvider,
} from "../infrastructure/in-memory.js";
import type {
  CandidateRequest,
  CandidateResult,
  DispatchDependencies,
  MatchingPort,
  OrderEnginePort,
  OrderEngineResult,
  RegisterOfferInput,
  ResolveAssignmentInput,
  TransitionOrderInput,
} from "../ports.js";

/**
 * The order statuses, taken from the real function's own signature.
 *
 * Derived rather than imported from the order contracts package: dispatch does not
 * depend on those contracts, and adding a dependency just to name a type would make the
 * dependency graph claim a coupling that does not exist.
 */
type OrderStatus = Parameters<typeof isTransitionAllowed>[0];

/** The rules used by most tests: 2 drivers per wave, 3 waves, 30s offers, 120s escalation. */
export const TEST_RULES: DispatchRules = {
  rulesetVersion: 1,
  waveSize: 2,
  offerTimeoutSeconds: 30,
  maxWaves: 3,
  escalationTimeoutSeconds: 120,
};

/** How the next port call should fail, if at all. */
export type PortFailure = "unavailable" | "timeout";

interface FakeAssignment {
  readonly id: string;
  readonly orderId: string;
  readonly driverPublicId: string;
  state: "offered" | "accepted" | "rejected" | "expired" | "cancelled";
}

export interface EngineCall {
  readonly kind: "register" | "resolve" | "transition";
  readonly idempotencyKey: string;
  readonly detail: string;
}

export class FakeOrderEngine implements OrderEnginePort {
  readonly calls: EngineCall[] = [];
  private readonly orders = new Map<string, OrderStatus>();
  private readonly assignments = new Map<string, FakeAssignment>();
  private readonly seenKeys = new Map<string, OrderEngineResult>();
  private readonly failures: PortFailure[] = [];
  private readonly forbiddenDrivers = new Set<string>();
  private assignmentCounter = 0;

  /** Orders start `published`, the status dispatch is handed one in. */
  seedOrder(orderId: string, status: OrderStatus = "published"): void {
    this.orders.set(orderId, status);
  }

  statusOf(orderId: string): OrderStatus | undefined {
    return this.orders.get(orderId);
  }

  assignmentState(assignmentId: string): FakeAssignment["state"] | undefined {
    return this.assignments.get(assignmentId)?.state;
  }

  /** Queue a transport failure for the next call, in order. */
  failNext(failure: PortFailure): void {
    this.failures.push(failure);
  }

  /** Make the engine refuse to register this driver, as if another order held them. */
  forbidDriver(driverPublicId: string): void {
    this.forbiddenDrivers.add(driverPublicId);
  }

  async registerOffer(input: RegisterOfferInput): Promise<OrderEngineResult> {
    const failure = this.nextFailure();
    if (failure !== null) return { outcome: failure };
    const replay = this.seenKeys.get(input.idempotencyKey);
    if (replay !== undefined) return { ...replay, outcome: "already_applied" };
    this.calls.push({
      kind: "register",
      idempotencyKey: input.idempotencyKey,
      detail: input.driverPublicId,
    });

    if (this.forbiddenDrivers.has(input.driverPublicId)) {
      return { outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_FORBIDDEN" };
    }
    const existing = [...this.assignments.values()].filter(
      (assignment) => assignment.orderId === input.orderId,
    );
    if (existing.some((assignment) => assignment.state === "accepted")) {
      return { outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_FORBIDDEN" };
    }
    if (
      existing.some(
        (assignment) =>
          assignment.driverPublicId === input.driverPublicId && assignment.state === "offered",
      )
    ) {
      return { outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_DUPLICATE" };
    }
    this.assignmentCounter += 1;
    const id = `assignment-${this.assignmentCounter}`;
    this.assignments.set(id, {
      id,
      orderId: input.orderId,
      driverPublicId: input.driverPublicId,
      state: "offered",
    });
    const result: OrderEngineResult = { outcome: "applied", assignmentId: id };
    this.seenKeys.set(input.idempotencyKey, result);
    return result;
  }

  async resolveAssignment(input: ResolveAssignmentInput): Promise<OrderEngineResult> {
    const failure = this.nextFailure();
    if (failure !== null) return { outcome: failure };
    const replay = this.seenKeys.get(input.idempotencyKey);
    if (replay !== undefined) return { ...replay, outcome: "already_applied" };
    this.calls.push({
      kind: "resolve",
      idempotencyKey: input.idempotencyKey,
      detail: input.state,
    });

    const assignment = this.assignments.get(input.assignmentId);
    if (assignment === undefined) {
      return { outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_NOT_FOUND" };
    }
    if (assignment.state !== "offered") {
      return { outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_ALREADY_RESOLVED" };
    }
    if (input.state === "accepted") {
      const otherAccepted = [...this.assignments.values()].some(
        (candidate) => candidate.orderId === assignment.orderId && candidate.state === "accepted",
      );
      // The single line that decides every accept race in the system.
      if (otherAccepted) {
        return { outcome: "rejected", rejectionCode: "ORDER_ASSIGNMENT_FORBIDDEN" };
      }
    }
    assignment.state = input.state;
    const result: OrderEngineResult = { outcome: "applied", assignmentId: assignment.id };
    this.seenKeys.set(input.idempotencyKey, result);
    return result;
  }

  async transitionOrder(input: TransitionOrderInput): Promise<OrderEngineResult> {
    const failure = this.nextFailure();
    if (failure !== null) return { outcome: failure };
    const replay = this.seenKeys.get(input.idempotencyKey);
    if (replay !== undefined) return { ...replay, outcome: "already_applied" };
    this.calls.push({
      kind: "transition",
      idempotencyKey: input.idempotencyKey,
      detail: input.to,
    });

    const current = this.orders.get(input.orderId);
    if (current === undefined) {
      return { outcome: "rejected", rejectionCode: "ORDER_NOT_FOUND" };
    }
    // Already there: a repeated legal request, not a conflict.
    if (current === input.to) return { outcome: "already_applied" };
    // The REAL table decides. If dispatch ever asks for a move the engine forbids, this
    // is where the test fails — not in the exit gate three MRs later.
    if (!isTransitionAllowed(current, input.to as OrderStatus)) {
      return { outcome: "rejected", rejectionCode: "ORDER_ILLEGAL_TRANSITION" };
    }
    this.orders.set(input.orderId, input.to as OrderStatus);
    const result: OrderEngineResult = { outcome: "applied" };
    this.seenKeys.set(input.idempotencyKey, result);
    return result;
  }

  private nextFailure(): PortFailure | null {
    return this.failures.shift() ?? null;
  }
}

export class FakeMatching implements MatchingPort {
  readonly requests: CandidateRequest[] = [];
  readonly unavailable: string[] = [];
  private pool: string[] = [];
  private readonly overrides: CandidateResult[] = [];
  private decisionCounter = 0;
  private failAvailability = false;
  private failure: PortFailure | null = null;
  private hardFailure = false;

  /** The drivers matching would rank, best first. */
  setPool(driverPublicIds: readonly string[]): void {
    this.pool = [...driverPublicIds];
  }

  /** Force one exact answer, including a deliberately invalid one. */
  enqueueRaw(result: CandidateResult): void {
    this.overrides.push(result);
  }

  breakAvailability(): void {
    this.failAvailability = true;
  }

  /**
   * Fail the next candidate lookup the way a real adapter must.
   *
   * A transport failure is translated into a `DispatchError` by the adapter, never
   * leaked as a raw `Error`: the tick defers a job on a domain error and rethrows
   * anything else, so an adapter that leaked its own error type would take down the
   * whole tick — every other job included — because one zone's lookup timed out.
   */
  failWith(failure: PortFailure): void {
    this.failure = failure;
  }

  /** Simulate a genuine bug (not a transport failure), which must NOT be swallowed. */
  failHard(): void {
    this.hardFailure = true;
  }

  async candidates(request: CandidateRequest): Promise<CandidateResult> {
    this.requests.push(request);
    if (this.hardFailure) throw new TypeError("cannot read properties of undefined");
    if (this.failure !== null) {
      const failure = this.failure;
      this.failure = null;
      throw failure === "timeout" ? orderEngineTimeout() : engineUnavailable();
    }
    const override = this.overrides.shift();
    if (override !== undefined) return override;

    this.decisionCounter += 1;
    const excluded = new Set(request.excludedDriverPublicIds);
    const picked = this.pool.filter((driver) => !excluded.has(driver)).slice(0, request.limit);
    return {
      decisionId: `decision-${this.decisionCounter}`,
      rulesetVersion: 1,
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      candidates: picked.map((driverPublicId, index) => ({ driverPublicId, rank: index + 1 })),
      // Empty is a normal answer with a reason, never an error.
      emptyReasonCode: picked.length === 0 ? "NO_AVAILABLE_DRIVERS" : null,
    };
  }

  async markUnavailable(driverPublicId: string): Promise<void> {
    if (this.failAvailability) throw new Error("matching unavailable");
    this.unavailable.push(driverPublicId);
  }
}

export interface Harness {
  readonly deps: DispatchDependencies;
  readonly clock: FixedClock;
  readonly orders: FakeOrderEngine;
  readonly matching: FakeMatching;
  readonly rules: StaticRulesProvider;
  readonly jobs: InMemoryJobRepository;
  readonly waves: InMemoryWaveRepository;
  readonly offers: InMemoryOfferRepository;
  readonly outbox: InMemoryOutbox;
}

export function createHarness(rules: DispatchRules = TEST_RULES): Harness {
  const clock = new FixedClock();
  const orders = new FakeOrderEngine();
  const matching = new FakeMatching();
  const rulesProvider = new StaticRulesProvider(rules);
  const jobs = new InMemoryJobRepository();
  const waves = new InMemoryWaveRepository();
  const offers = new InMemoryOfferRepository();
  const outbox = new InMemoryOutbox();
  const deps: DispatchDependencies = {
    jobs,
    waves,
    offers,
    outbox,
    idempotency: new InMemoryIdempotencyStore(),
    matching,
    orders,
    rules: rulesProvider,
    clock,
    ids: new SequentialIdGenerator(),
  };
  return { deps, clock, orders, matching, rules: rulesProvider, jobs, waves, offers, outbox };
}

/** A valid order id / public id pair, numbered so a failure names which one. */
export function orderRef(index: number): { orderId: string; orderPublicId: string } {
  return {
    orderId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    orderPublicId: `ORD-${String(index).padStart(10, "0")}`,
  };
}

export const ZONE_ID = "20000000-0000-4000-8000-000000000001";

export function driverId(index: number): string {
  return `WS-${String(index).padStart(10, "0")}`;
}
