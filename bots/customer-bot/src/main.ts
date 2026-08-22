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

import { BOT, buildApp } from "./server.js";

void runBotApp(BOT, () => buildApp());
