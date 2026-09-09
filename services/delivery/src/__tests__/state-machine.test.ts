import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_TASK_STATES,
  DELIVERY_TASK_TERMINAL_STATES,
  FULFILLMENT_STATES,
  FULFILLMENT_TERMINAL_STATES,
  PAYMENT_STATES,
  PAYMENT_TERMINAL_STATES,
} from "@wasla/contracts-delivery";

import {
  canCompleteDelivery,
  canConfirmOrder,
  DELIVERY_TASK_TRANSITIONS,
  FULFILLMENT_TRANSITIONS,
  isDeliveryTaskTerminal,
  isDeliveryTaskTransitionAllowed,
  isFulfillmentTerminal,
  isFulfillmentTransitionAllowed,
  isPaymentTerminal,
  isPaymentTransitionAllowed,
  PAYMENT_TRANSITIONS,
} from "../domain/state-machine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adrPath = resolve(__dirname, "../../../../docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md");
const adr = readFileSync(adrPath, "utf8");

/** The ADR §3 section — the binding reference for all three machines. */
const section = (n: "3.1" | "3.2" | "3.3"): string => {
  // Anchored to line start: "### 3.1" must not be swallowed by "## 3.".
  const whole = adr.split(/^## 3\./m)[1]?.split(/^## 4\./m)[0] ?? "";
  return whole.split(`### ${n}`)[1]?.split(/^### /m)[0] ?? "";
};

/**
 * Parse the ADR's arrow tables into a flat edge list.
 *
 * The tables use three shapes, all handled:
 *  - plain edge:      `a → b`
 *  - target group:    `a → b | c`
 *  - source group:    `a | b | c → d`
 *  - chains:          `a → b → c` (a→b, b→c)
 * Prose in (…) and […] is stripped before parsing; the terminal-states line
 * has no arrow and is skipped naturally.
 */
function parseAdrEdges(text: string): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").trim();
    if (!line.includes("→")) continue;
    const parts = line
      .split("→")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;
    let currentSources = parts[0].split("|").map((s) => s.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const targets = parts[i].split("|").map((s) => s.trim()).filter(Boolean);
      for (const src of currentSources) {
        for (const tgt of targets) {
          edges.push([src, tgt]);
        }
      }
      currentSources = targets;
    }
  }
  return edges;
}

const key = (a: string, b: string) => `${a}→${b}`;
const toKeySet = (edges: ReadonlyArray<readonly [string, string]>) =>
  new Set(edges.map(([a, b]) => key(a, b)));

const adrFulfillment = parseAdrEdges(section("3.1"));
const adrPayment = parseAdrEdges(section("3.2"));
const adrTask = parseAdrEdges(section("3.3"));

describe("state machines vs ADR-026 §3 — the binding reference, edge by edge", () => {
  it("fulfillment table matches the ADR exactly, in both directions", () => {
    const code = toKeySet(FULFILLMENT_TRANSITIONS.map((r) => [r.from, r.to] as const));
    const doc = toKeySet(adrFulfillment);
    expect([...code].sort()).toEqual([...doc].sort());
    expect(FULFILLMENT_TRANSITIONS).toHaveLength(adrFulfillment.length);
    expect(adrFulfillment.length).toBe(14); // ADR §3.1 header: 11 states · 14 transitions
  });

  it("payment mirror matches the ADR exactly, in both directions", () => {
    const code = toKeySet(PAYMENT_TRANSITIONS.map((r) => [r.from, r.to] as const));
    const doc = toKeySet(adrPayment);
    expect([...code].sort()).toEqual([...doc].sort());
    expect(PAYMENT_TRANSITIONS).toHaveLength(7); // ADR §3.2 header: 7 states · 7 transitions
  });

  it("delivery-task mirror matches the ADR exactly, in both directions", () => {
    const code = toKeySet(DELIVERY_TASK_TRANSITIONS.map((r) => [r.from, r.to] as const));
    const doc = toKeySet(adrTask);
    expect([...code].sort()).toEqual([...doc].sort());
    expect(DELIVERY_TASK_TRANSITIONS).toHaveLength(adrTask.length);
    expect(adrTask.length).toBe(19); // ADR §3.3 header: 14 states · 19 transitions
  });

  it("every ADR-mentioned state exists in the contract constants", () => {
    const adrStates = new Set(adrFulfillment.flatMap(([a, b]) => [a, b]));
    for (const s of adrStates) {
      expect(FULFILLMENT_STATES).toContain(s);
    }
    const adrPayStates = new Set(adrPayment.flatMap(([a, b]) => [a, b]));
    for (const s of adrPayStates) {
      expect(PAYMENT_STATES).toContain(s);
    }
    const adrTaskStates = new Set(adrTask.flatMap(([a, b]) => [a, b]));
    for (const s of adrTaskStates) {
      expect(DELIVERY_TASK_STATES).toContain(s);
    }
  });
});

describe("structural invariants of the three machines", () => {
  it("terminal states have NO outgoing edges and non-terminals do", () => {
    for (const t of FULFILLMENT_TRANSITIONS) {
      expect(isFulfillmentTerminal(t.from), `${t.from} is terminal yet has an edge`).toBe(false);
    }
    for (const s of FULFILLMENT_STATES) {
      if (!isFulfillmentTerminal(s)) {
        expect(
          FULFILLMENT_TRANSITIONS.some((t) => t.from === s),
          `${s} is not terminal yet has no outgoing edge`,
        ).toBe(true);
      }
    }
    for (const t of PAYMENT_TRANSITIONS) {
      expect(isPaymentTerminal(t.from)).toBe(false);
    }
    for (const t of DELIVERY_TASK_TRANSITIONS) {
      expect(isDeliveryTaskTerminal(t.from)).toBe(false);
    }
  });

  it("every non-initial state is reachable (has an incoming edge)", () => {
    const hasIncoming = (states: readonly string[], edges: ReadonlyArray<readonly [string, string]>) =>
      states
        .filter((s) => s !== states[0])
        .every((s) => edges.some(([, to]) => to === s));
    // draft / pending / pending_eligibility are the initials; reachability of
    // the rest is the "no orphan state" guarantee.
    expect(hasIncoming(FULFILLMENT_STATES, FULFILLMENT_TRANSITIONS.map((t) => [t.from, t.to] as const))).toBe(true);
    expect(hasIncoming(PAYMENT_STATES, PAYMENT_TRANSITIONS.map((t) => [t.from, t.to] as const))).toBe(true);
    expect(hasIncoming(DELIVERY_TASK_STATES, DELIVERY_TASK_TRANSITIONS.map((t) => [t.from, t.to] as const))).toBe(true);
  });

  it("terminal sets match the ADR prose", () => {
    // Anchored to line start so "### 3.x" is not swallowed by "## 3.".
    const sec = adr.split(/^## 3\./m)[1]?.split(/^## 4\./m)[0] ?? "";
    const stated = [...sec.matchAll(/الحالاتُ النهائيّةُ:\s*(.+)/g)].map((m) =>
      m[1].split("·").map((s) => s.trim()).filter(Boolean),
    );
    expect(stated).toHaveLength(3);
    expect(new Set(stated[0])).toEqual(new Set(FULFILLMENT_TERMINAL_STATES));
    expect(new Set(stated[1])).toEqual(new Set(PAYMENT_TERMINAL_STATES));
    expect(new Set(stated[2])).toEqual(new Set(DELIVERY_TASK_TERMINAL_STATES));
  });

  it("the full state × state space admits EXACTLY the table (no derived shortcuts)", () => {
    // For every pair: membership equals table membership.
    for (const from of FULFILLMENT_STATES) {
      for (const to of FULFILLMENT_STATES) {
        expect(isFulfillmentTransitionAllowed(from, to)).toBe(
          FULFILLMENT_TRANSITIONS.some((t) => t.from === from && t.to === to),
        );
      }
    }
    for (const from of PAYMENT_STATES) {
      for (const to of PAYMENT_STATES) {
        expect(isPaymentTransitionAllowed(from, to)).toBe(
          PAYMENT_TRANSITIONS.some((t) => t.from === from && t.to === to),
        );
      }
    }
    for (const from of DELIVERY_TASK_STATES) {
      for (const to of DELIVERY_TASK_STATES) {
        expect(isDeliveryTaskTransitionAllowed(from, to)).toBe(
          DELIVERY_TASK_TRANSITIONS.some((t) => t.from === from && t.to === to),
        );
      }
    }
  });
});

describe("the composite gates (tested, not reviewed)", () => {
  it("§2.2 — placed → confirmed ONLY with payment_state = authorized", () => {
    expect(canConfirmOrder({ fulfillmentState: "placed", paymentState: "authorized" })).toBe(true);
    expect(canConfirmOrder({ fulfillmentState: "placed", paymentState: "pending" })).toBe(false);
    expect(canConfirmOrder({ fulfillmentState: "placed", paymentState: "captured" })).toBe(false);
    expect(canConfirmOrder({ fulfillmentState: "placed", paymentState: "failed" })).toBe(false);
    // Not even from any other state, whatever the mirror says.
    expect(canConfirmOrder({ fulfillmentState: "confirmed", paymentState: "authorized" })).toBe(false);
    expect(canConfirmOrder({ fulfillmentState: "draft", paymentState: "authorized" })).toBe(false);
  });

  it("§2.4 — delivered ONLY from arrived, ONLY with proof", () => {
    const proof = { proofType: "otp" as const, proofRef: "ref-1" };
    expect(canCompleteDelivery({ state: "arrived", proof })).toBe(true);
    expect(canCompleteDelivery({ state: "arrived", proof: null })).toBe(false);
    expect(canCompleteDelivery({ state: "in_transit", proof })).toBe(false);
    expect(canCompleteDelivery({ state: "driver_assigned", proof })).toBe(false);
    expect(canCompleteDelivery({ state: "delivered", proof })).toBe(false);
    // Proof can never complete a non-delivery transition either.
    expect(canCompleteDelivery({ state: "arrived", proof }, "failed")).toBe(false);
  });
});
