/**
 * The transition table lives in a document (docs/03-domain/ORDER_ENGINE.md §4)
 * because whoever comes next reads documents, not code. That only works if the
 * document is machine-checked — an unverified table is a rumour.
 *
 * This test parses §4 and asserts the table is internally coherent and agrees
 * with the contract: every state appears exactly once as a source, every target
 * and reason code exists, terminal states have no outgoing edge, and every state
 * is reachable (no impossible state, which is the Phase 06 exit-gate claim).
 *
 * MR 2/6 adds the second half of the guard: `state-machine.ts` must produce the
 * same 72 pairs this document publishes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORDER_STATUSES,
  ORDER_INITIAL_STATUS,
  ORDER_TERMINAL_STATUSES,
  ORDER_TRANSIENT_STATUSES,
  ORDER_REASON_CODES,
  ORDER_DRIVER_BOUND_STATUSES,
} from "../index.js";

const DOC_PATH = resolve(__dirname, "../../../../../docs/03-domain/ORDER_ENGINE.md");
const doc = readFileSync(DOC_PATH, "utf8");

type Edge = { from: string; to: string; actor: string; reason: string | null };

/** Parse the `### 4.x من `state` (n)` sections of §4 into edges. */
function parseTransitionTable(markdown: string): { edges: Edge[]; declared: Map<string, number> } {
  const edges: Edge[] = [];
  const declared = new Map<string, number>();
  const sections = markdown.split(/^### 4\.\d+ /m).slice(1);

  for (const section of sections) {
    const header = /^من (?:`([a-z_]+)`|الحالات النهائية السبع) \((\d+)\)/.exec(section);
    if (!header) continue;
    const count = Number(header[2]);
    // The terminal section declares zero outgoing edges for seven states at once.
    if (!header[1]) {
      expect(count, "the terminal section must declare zero outgoing edges").toBe(0);
      for (const terminal of ORDER_TERMINAL_STATUSES) declared.set(terminal, 0);
      continue;
    }
    const from = header[1]!;
    declared.set(from, count);

    for (const line of section.split("\n")) {
      const row = /^\|\s*`([a-z_]+)`\s*\|\s*`([a-z]+)`\s*\|\s*(.*?)\s*\|/.exec(line.trim());
      if (!row) continue;
      const reasonMatch = /`([A-Z][A-Z0-9_]+)`/.exec(row[3]!);
      edges.push({
        from,
        to: row[1]!,
        actor: row[2]!,
        reason: reasonMatch ? reasonMatch[1]! : null,
      });
    }
  }
  return { edges, declared };
}

const { edges, declared } = parseTransitionTable(doc);
const outgoing = new Map<string, Set<string>>(
  ORDER_STATUSES.map((s) => [s, new Set<string>()]),
);
for (const edge of edges) outgoing.get(edge.from)?.add(edge.to);

describe("the published transition table is parseable and complete", () => {
  it("declares an outgoing set for every one of the 21 statuses", () => {
    expect([...declared.keys()].sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("lists exactly as many rows as each section header claims", () => {
    for (const [from, count] of declared) {
      expect(outgoing.get(from)!.size, `section for ${from}`).toBe(count);
    }
  });

  it("publishes 72 allowed pairs out of 441", () => {
    expect(edges).toHaveLength(72);
    expect(new Set(edges.map((e) => `${e.from}→${e.to}`)).size).toBe(72);
    expect(ORDER_STATUSES.length ** 2).toBe(441);
  });

  it("states in the summary line the same number it lists", () => {
    expect(doc).toContain("اثنان وسبعون زوجاً مسموحاً من أصل 441");
  });
});

describe("every edge refers to things that exist", () => {
  it("targets only real statuses", () => {
    for (const edge of edges) {
      expect(ORDER_STATUSES as readonly string[], `${edge.from} → ${edge.to}`).toContain(edge.to);
    }
  });

  it("names only real actor types", () => {
    for (const edge of edges) {
      expect(["system", "customer", "driver", "partner", "admin"]).toContain(edge.actor);
    }
  });

  it("uses only catalog reason codes", () => {
    for (const edge of edges.filter((e) => e.reason)) {
      expect(ORDER_REASON_CODES as readonly string[], `${edge.from} → ${edge.to}`).toContain(
        edge.reason!,
      );
    }
  });
});

describe("no impossible state (the Phase 06 exit-gate claim, checked on the table)", () => {
  it("never allows a self-transition", () => {
    for (const edge of edges) expect(edge.from).not.toBe(edge.to);
  });

  it("closes every terminal state (no outgoing edge)", () => {
    for (const terminal of ORDER_TERMINAL_STATUSES) {
      expect(outgoing.get(terminal)!.size, `${terminal} must be closed`).toBe(0);
    }
  });

  it("derives the same terminal set from the table as the contract declares", () => {
    const derived = ORDER_STATUSES.filter((s) => outgoing.get(s)!.size === 0);
    expect(derived.sort()).toEqual([...ORDER_TERMINAL_STATUSES].sort());
  });

  it("gives every non-terminal state a way out (no dead end without a reason)", () => {
    for (const status of ORDER_STATUSES) {
      if ((ORDER_TERMINAL_STATUSES as readonly string[]).includes(status)) continue;
      expect(outgoing.get(status)!.size, `${status} has no exit`).toBeGreaterThan(0);
    }
  });

  it("makes every state reachable from the initial one", () => {
    const seen = new Set<string>([ORDER_INITIAL_STATUS]);
    const queue: string[] = [ORDER_INITIAL_STATUS];
    while (queue.length > 0) {
      for (const next of outgoing.get(queue.shift()!)!) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const unreachable = ORDER_STATUSES.filter((s) => !seen.has(s));
    expect(unreachable, "an unreachable state is an impossible state").toEqual([]);
  });

  it("gives every state except the initial one at least one inbound edge", () => {
    for (const status of ORDER_STATUSES) {
      if (status === ORDER_INITIAL_STATUS) continue;
      const inbound = edges.filter((e) => e.to === status);
      expect(inbound.length, `nothing leads to ${status}`).toBeGreaterThan(0);
    }
  });

  it("keeps the transient pair genuinely transient (each returns to searching)", () => {
    for (const transient of ORDER_TRANSIENT_STATUSES) {
      expect([...outgoing.get(transient)!], `${transient} must resume the search`).toContain(
        "searching",
      );
    }
  });
});

describe("the table honours the decisions in ADR-010", () => {
  it("starts the order in published and nowhere else", () => {
    expect(ORDER_INITIAL_STATUS).toBe("published");
    expect(edges.some((e) => e.to === "published")).toBe(false);
  });

  it("forbids cancelling a ride that is already under way", () => {
    expect([...outgoing.get("in_progress")!]).not.toContain("customer_cancelled");
    expect(doc).toContain("لا `in_progress` → `customer_cancelled`");
  });

  it("lets completed lead only to a dispute or a review", () => {
    expect([...outgoing.get("completed")!].sort()).toEqual(["payment_disputed", "under_review"]);
  });

  it("resolves a review into a verdict and never back into the previous state", () => {
    expect([...outgoing.get("under_review")!].sort()).toEqual([
      "blocked",
      "completed",
      "failed",
    ]);
  });

  it("routes every payment dispute through review, so the verdict has one source", () => {
    expect([...outgoing.get("payment_disputed")!]).toEqual(["under_review"]);
  });

  it("enters every driver-bound state from a state that already resolved an assignment", () => {
    // A driver-bound state is only reachable through `accepted`, which is where the
    // assignment becomes active — so no path can name a driver before one accepted.
    for (const status of ORDER_DRIVER_BOUND_STATUSES) {
      const sources = edges.filter((e) => e.to === status).map((e) => e.from);
      const fromPreAssignment = sources.filter((s) =>
        ["published", "searching", "offered", "negotiating"].includes(s),
      );
      if (status === "accepted") {
        expect(fromPreAssignment.sort()).toEqual(["negotiating", "offered"]);
      } else {
        expect(fromPreAssignment, `${status} must not be entered before acceptance`).toEqual([]);
      }
    }
  });

  it("keeps dispatch policy out of the document's edges (no wave, no candidate)", () => {
    for (const edge of edges) {
      expect(edge.to).not.toMatch(/candidate|wave|dispatch/);
    }
  });
});
