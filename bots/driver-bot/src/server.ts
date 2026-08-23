/**
 * Wiring of the driver bot (السائق) — importable, and with no side effects.
 *
 * Reads DRIVER_BOT_TOKEN, DRIVER_BOT_WEBHOOK_SECRET and DRIVER_BOT_MINI_APP_URL from
 * the environment (docs/02-architecture/CHANNEL_BOTS.md → Configuration) and
 * serves the channel contract on DRIVER_BOT_PORT, default 8084.
 *
 * Phase 05 · MR 5/6 adds one thing: the bot's *domain* flows
 * (docs/02-architecture/DRIVER_BOT_FLOWS.md). They are attached here — the
 * composition root is the only layer allowed to know both a channel and a domain
 * (ADR-007 §1) — and only when DRIVER_DATABASE_URL says where the Driver Core data
 * lives. Without it the bot is exactly the Phase 03 bot: `/start` opens the Mini
 * App, and `/available`, `/offline`, `/status`, `/docs` are not registered at all.
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";

import {
  buildDriverFlows,
  buildDriverNegotiations,
  type DriverFlowsEnv,
  type DriverFlowsWiring,
} from "./driver-core.js";

import {
  DRIVER_SUPPORTED_COMMANDS,
  createDriverConversationHandler,
  type DriverFlowsPort,
} from "./flows.js";
import {
  createDriverNegotiationConversationHandler,
  type DriverNegotiationsPort,
} from "./negotiation-flows.js";

/** The bot this deployable serves. Nothing else in this package may vary. */
export const BOT = "driver" as const;

export interface DriverBotOverrides extends BotRuntimeOverrides {
  /**
   * Injects the domain flows instead of building them from the environment.
   *
   * The seam the tests use: it exercises this exact root — the same command
   * registration, the same handler, the same reply path — with a fake Driver Core,
   * so no test needs a database to prove the wiring.
   */
  readonly driverFlows?: DriverFlowsPort;
  /** Injected in tests; production reads NEGOTIATIONS_SERVICE_URL through the core. */
  readonly driverNegotiations?: DriverNegotiationsPort;
}

/**
 * Builds the driver bot without binding a port.
 *
 * This is the seam the tests use, so what they assert is the real composition
 * root and not a re-creation of it.
 */
export function buildApp(overrides?: DriverBotOverrides): BotApp {
  // The same bag the channel configuration is read from: one environment per
  // process, so a test cannot accidentally give the channel and the domain two
  // different views of it.
  const env = (overrides?.env ?? process.env) as DriverFlowsEnv;
  let wiring: DriverFlowsWiring | null = null;
  const flows =
    overrides?.driverFlows ?? ((wiring = buildDriverFlows(env)) ? wiring.flows : undefined);

  const negotiations = overrides?.driverNegotiations ?? buildDriverNegotiations(env);
  const driverHandler = flows === undefined ? undefined : createDriverConversationHandler(flows);
  const negotiationHandler = flows === undefined ? undefined : createDriverNegotiationConversationHandler(flows, negotiations);

  const app = buildBotApp(BOT, {
    ...overrides,
    // Commands are registered only when a flow can actually answer them: an
    // advertised `/available` that replies with nothing is worse than a command the
    // core rejects with CHANNEL_UNSUPPORTED_COMMAND (422) — a driver who taps
    // «available» and is answered by silence will believe he is receiving orders.
    ...(flows === undefined
      ? {}
      : {
          supportedCommands: overrides?.supportedCommands ?? DRIVER_SUPPORTED_COMMANDS,
          onConversation: async (event) => (await driverHandler!(event)) ?? negotiationHandler!(event),
        }),
  });

  // The pool this root opened is released by Fastify's shutdown, like the
  // channel's own resources — a bot must not leak connections because a test or
  // a rolling deploy closed it politely.
  if (wiring?.pool) {
    const { pool } = wiring;
    app.app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  return app;
}
