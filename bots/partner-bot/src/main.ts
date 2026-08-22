/**
 * Process entry point of the partner bot: the one file that binds a port.
 *
 * Kept separate from `server.ts` so importing the wiring — in a test, or in a
 * future in-process host — never starts a listener as a side effect.
 *
 * This bot has no domain flows yet, so `runBot(BOT)` would behave identically today.
 * It goes through its own `buildApp` anyway, so that the day it gains a flow the
 * process that listens is already the root that was tested — the defect the other two
 * bots actually shipped with (see `runBotApp` in @wasla/bot-runtime).
 */

import { runBotApp } from "@wasla/bot-runtime";

import { BOT, buildApp } from "./server.js";

void runBotApp(BOT, () => buildApp());
