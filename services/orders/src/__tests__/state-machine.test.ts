/**
 * The transition table is the phase's central claim, so it is tested in two
 * independent directions:
 *
 *  1. **Against the document.** `docs/03-domain/ORDER_ENGINE.md` §4 is parsed
 *     and compared row by row with the code, in BOTH directions. A row added to
 *     the code without the document fails; a row added to the document without
 *     the code fails too. Without the second direction the document becomes a
 *     description that drifts, and this repository's rule is that the document
 *     is the source.
 *  2. **Against itself.** The graph properties are computed, not asserted in
 *     prose: nothing unreachable, nothing self-looping, terminals derived and
 *     equal to the contract, the full 441-pair space partitioned exactly.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ORDER_INITIAL_STATUS,
  ORDER_STATUSES,
  ORDER_TERMINAL_STATUSES,
  ORDER_TRANSIENT_STATUSES,
  type OrderStatus,
} from "@wasla/contracts-order";
import { describe, expect, it } from "vitest";

import {
  allowedTargets,
  assignmentRequirement,
  DERIVED_TERMINAL_STATUSES,
  isTerminalStatus,
  isTransitionAllowed,
  ORDER_TRANSITION_COUNT,
  ORDER_TRANSITION_SPACE,
  ORDER_TRANSITIONS,
  reachableStatuses,
  requiresReasonCode,
  transitionRule,
  unreachableStatuses,
} from "../domain/state-machine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(HERE, "../../../../docs/03-domain/ORDER_ENGINE.md");

interface DocRow {
  readonly from: string;
  readonly to: string;
  readonly actor: string;
  readonly reason: string | null;
}

/** Parse the `### 4.N من \`state\`` sections into rows. */
function parseDocumentedTransitions(): DocRow[] {
  const markdown = readFileSync(DOC_PATH, "utf8");
  const section = markdown.slice(markdown.indexOf("## 4."), markdown.indexOf("## 5."));
  const rows: DocRow[] = [];
  let from: string | null = null;
  for (const line of section.split("\n")) {
    const heading = /^### 4\.\d+ من `([a-z_]+)`/.exec(line);
    if (heading) {
      from = heading[1]!;
      continue;
    }
    if (!line.startsWith("|") || from == null) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells[0]!.startsWith("---") || cells[0] === "إلى") continue;
    const strip = (value: string): string => value.replace(/`/g, "").trim();
    const reason = strip(cells[2]!);
    rows.push({
      from,
      to: strip(cells[0]!),
      actor: strip(cells[1]!),
      reason: reason === "—" || reason === "" ? null : reason,
    });
  }
  return rows;
}

const documented = parseDocumentedTransitions();

const key = (row: { from: string; to: string; actor: string; reason: string | null }): string =>
  `${row.from}→${row.to}|${row.actor}|${row.reason ?? "-"}`;

describe("conformance with docs/03-domain/ORDER_ENGINE.md §4", () => {
  it("parses 72 documented rows", () => {
    expect(documented).toHaveLength(72);
  });

  it("the code table has exactly as many rows as the document", () => {
    expect(ORDER_TRANSITION_COUNT).toBe(documented.length);
  });

  it("every documented row exists in the code, with the same actor and reason", () => {
    const inCode = new Set(
      ORDER_TRANSITIONS.map((rule) =>
        key({
          from: rule.from,
          to: rule.to,
          actor: rule.expectedActor,
          reason: rule.typicalReason,
        }),
      ),
    );
    const missing = documented.filter((row) => !inCode.has(key(row)));
    expect(missing).toEqual([]);
  });

  it("every code row exists in the document — the document is the source", () => {
    const inDoc = new Set(documented.map(key));
    const extra = ORDER_TRANSITIONS.filter(
      (rule) =>
        !inDoc.has(
          key({
            from: rule.from,
            to: rule.to,
            actor: rule.expectedActor,
            reason: rule.typicalReason,
          }),
        ),
    );
    expect(extra).toEqual([]);
  });

  it("the per-state counts announced in the headings match the rows below them", () => {
    const markdown = readFileSync(DOC_PATH, "utf8");
    const section = markdown.slice(markdown.indexOf("## 4."), markdown.indexOf("## 5."));
    for (const match of section.matchAll(/^### 4\.\d+ من `([a-z_]+)` \((\d+)\)/gm)) {
      const state = match[1] as OrderStatus;
      expect(allowedTargets(state).size, `out-degree of ${state}`).toBe(
        Number(match[2]),
      );
    }
  });
});

describe("graph shape", () => {
  it("covers 72 of the 441 possible pairs", () => {
    expect(ORDER_TRANSITION_SPACE).toBe(441);
    expect(ORDER_TRANSITION_COUNT).toBe(72);
  });

  it("has no duplicate edge", () => {
    const pairs = ORDER_TRANSITIONS.map((rule) => `${rule.from}→${rule.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("has no self-transition: a status never moves to itself", () => {
    expect(ORDER_TRANSITIONS.filter((rule) => rule.from === rule.to)).toEqual([]);
    for (const status of ORDER_STATUSES) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });

  it("partitions the whole 441-pair space into allowed and refused", () => {
    let allowed = 0;
    let refused = 0;
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (isTransitionAllowed(from, to)) allowed += 1;
        else refused += 1;
      }
    }
    expect(allowed).toBe(72);
    expect(refused).toBe(441 - 72);
  });

  it("references only known statuses", () => {
    const known = new Set<string>(ORDER_STATUSES);
    for (const rule of ORDER_TRANSITIONS) {
      expect(known.has(rule.from)).toBe(true);
      expect(known.has(rule.to)).toBe(true);
    }
  });
});

describe("terminal states are derived, not declared", () => {
  it("the derived set equals the contract list", () => {
    expect([...DERIVED_TERMINAL_STATUSES].sort()).toEqual(
      [...ORDER_TERMINAL_STATUSES].sort(),
    );
  });

  it("no terminal state has an outgoing edge", () => {
    for (const status of ORDER_TERMINAL_STATUSES) {
      expect(allowedTargets(status).size, `${status} must be final`).toBe(0);
    }
  });

  it("every non-terminal state has at least one way out", () => {
    for (const status of ORDER_STATUSES) {
      if (isTerminalStatus(status)) continue;
      expect(allowedTargets(status).size, `${status} must have an exit`).toBeGreaterThan(0);
    }
  });

  it("requires a reason code for terminal targets only", () => {
    for (const status of ORDER_STATUSES) {
      expect(requiresReasonCode(status)).toBe(isTerminalStatus(status));
    }
  });

  it("transient statuses are not terminal and lead back to searching", () => {
    for (const status of ORDER_TRANSIENT_STATUSES) {
      expect(isTerminalStatus(status)).toBe(false);
      expect(allowedTargets(status).has("searching")).toBe(true);
    }
  });
});

describe("reachability", () => {
  it("every status is reachable from published", () => {
    expect(unreachableStatuses()).toEqual([]);
    expect(reachableStatuses().size).toBe(ORDER_STATUSES.length);
  });

  it("every status other than published has an inbound edge", () => {
    for (const status of ORDER_STATUSES) {
      if (status === ORDER_INITIAL_STATUS) continue;
      const inbound = ORDER_TRANSITIONS.filter((rule) => rule.to === status);
      expect(inbound.length, `${status} must be reachable`).toBeGreaterThan(0);
    }
  });

  it("nothing transitions back into published: an order is born once", () => {
    expect(ORDER_TRANSITIONS.filter((rule) => rule.to === ORDER_INITIAL_STATUS)).toEqual([]);
  });
});

describe("documented lifecycle decisions", () => {
  it("in_progress cannot be cancelled by the customer (ADR-010)", () => {
    expect(isTransitionAllowed("in_progress", "customer_cancelled")).toBe(false);
    expect(allowedTargets("in_progress").size).toBe(4);
  });

  it("a dispute is adjudicated only through review", () => {
    expect([...allowedTargets("payment_disputed")]).toEqual(["under_review"]);
  });

  it("a review ends in a verdict, never back in the dispute", () => {
    expect(isTransitionAllowed("under_review", "payment_disputed")).toBe(false);
    expect([...allowedTargets("under_review")].sort()).toEqual([
      "blocked",
      "completed",
      "failed",
    ]);
  });

  it("only completed orders can be disputed", () => {
    const disputers = ORDER_TRANSITIONS.filter((rule) => rule.to === "payment_disputed");
    expect(disputers.map((rule) => rule.from)).toEqual(["completed"]);
  });

  it("every edge names an actor and reason codes are optional only off terminals", () => {
    for (const rule of ORDER_TRANSITIONS) {
      expect(rule.expectedActor).toBeTruthy();
      if (isTerminalStatus(rule.to)) {
        expect(rule.typicalReason, `${rule.from}→${rule.to}`).not.toBeNull();
      }
    }
  });

  it("exposes the rule behind each allowed pair and nothing else", () => {
    expect(transitionRule("published", "searching")?.expectedActor).toBe("system");
    expect(transitionRule("published", "completed")).toBeUndefined();
  });
});

describe("assignment coupling mirrors ck_orders_assignment_matches_status", () => {
  it("driver-bound statuses require an assignment", () => {
    for (const status of ["accepted", "assigned", "driver_en_route", "arrived", "in_progress", "completed"] as const) {
      expect(assignmentRequirement(status)).toBe("required");
    }
  });

  it("pre-assignment statuses forbid one", () => {
    for (const status of ["published", "searching", "offered", "negotiating"] as const) {
      expect(assignmentRequirement(status)).toBe("forbidden");
    }
  });

  it("terminal, transient and review statuses leave it open", () => {
    for (const status of [
      ...ORDER_TERMINAL_STATUSES,
      ...ORDER_TRANSIENT_STATUSES,
      "payment_disputed",
      "under_review",
    ] as const) {
      expect(assignmentRequirement(status)).toBe("optional");
    }
  });

  it("classifies every status exactly once", () => {
    const counts = { required: 0, forbidden: 0, optional: 0 };
    for (const status of ORDER_STATUSES) counts[assignmentRequirement(status)] += 1;
    expect(counts).toEqual({ required: 6, forbidden: 4, optional: 11 });
  });
});
