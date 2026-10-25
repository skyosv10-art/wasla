/**
 * Process entry point of the customer bot: the one file that binds a port.
 *
 * Kept separate from `server.ts` so importing the wiring — in a test, or in a
 * future in-process host — never starts a listener as a side effect.
 *
 * It passes `buildApp` and does **not** call `runBot(BOT)`: `runBot` builds the app
 * from the shared runtime directly, which would skip this bot's composition root and
 * therefore its domain flows. That was a real defect, fixed in Phase 05 · MR 5/6 —
 * see `runBotApp` in @wasla/bot-runtime for what it cost.
 */

import { runBotApp } from "@wasla/bot-runtime";

import { BOT } from "./server.js";
import { buildAppWithEdge } from "./edge.js";

// D6 (CLM-0691): the entry point builds through `buildAppWithEdge`, not `buildApp`.
// Fail-closed by design (ADR-069): with WASLA_EDGE_ENABLED unset or falsy,
// `buildAppWithEdge` returns the plain composition root — identical behavior to
// `buildApp` — so this wiring registers the edge only when the owner turns it on.
// The thing that listens is by construction the thing that was built and tested
// (edge-composition.test.ts exercises `buildAppWithEdge` with the edge enabled).
void runBotApp(BOT, buildAppWithEdge);
