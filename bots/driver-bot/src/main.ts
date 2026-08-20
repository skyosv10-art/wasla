/**
 * Process entry point of the driver bot: the one file that binds a port.
 *
 * Kept separate from `server.ts` so importing the wiring — in a test, or in a
 * future in-process host — never starts a listener as a side effect.
 */

import { runBot } from "@wasla/bot-runtime";

import { BOT } from "./server.js";

void runBot(BOT);
