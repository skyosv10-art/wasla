/**
 * Wiring of the customer bot (العميل) — importable, and with no side effects.
 *
 * Reads CUSTOMER_BOT_TOKEN, CUSTOMER_BOT_WEBHOOK_SECRET and CUSTOMER_BOT_MINI_APP_URL from
 * the environment (docs/02-architecture/CHANNEL_BOTS.md → Configuration) and
 * serves the channel contract on CUSTOMER_BOT_PORT, default 8083.
 *
 * Phase 04 adds one thing: the bot's *domain* flows
 * (docs/02-architecture/CUSTOMER_BOT_FLOWS.md). They are attached here — the
 * composition root is the only layer allowed to know both a channel and a domain
 * (ADR-007 §1) — and only when CUSTOMER_DATABASE_URL says where the Customer Core
 * data lives. Without it the bot is exactly the Phase 03 bot: `/start` opens the
 * Mini App, and `/places` / `/orders` are not registered at all.
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";

import {
  buildCustomerFlows,
  buildCustomerNegotiations,
  type CustomerFlowsEnv,
  type CustomerFlowsWiring,
} from "./customer-core.js";

import {
  CUSTOMER_SUPPORTED_COMMANDS,
  createCustomerConversationHandler,
  type CustomerFlowsPort,
} from "./flows.js";
import {
  createCustomerNegotiationConversationHandler,
  type CustomerNegotiationsPort,
} from "./negotiation-flows.js";

/** The bot this deployable serves. Nothing else in this package may vary. */
export const BOT = "customer" as const;

export interface CustomerBotOverrides extends BotRuntimeOverrides {
  /**
   * Injects the domain flows instead of building them from the environment.
   *
   * The seam the tests use: it exercises this exact root — the same command
   * registration, the same handler, the same reply path — with a fake Customer
   * Core, so no test needs a database to prove the wiring.
   */
  readonly customerFlows?: CustomerFlowsPort;
  /** Injected in tests; production reads NEGOTIATIONS_SERVICE_URL through the core. */
  readonly customerNegotiations?: CustomerNegotiationsPort;
}

/**
 * Builds the customer bot without binding a port.
 *
 * This is the seam the tests use, so what they assert is the real composition
 * root and not a re-creation of it.
 */
export function buildApp(overrides?: CustomerBotOverrides): BotApp {
  // The same bag the channel configuration is read from: one environment per
  // process, so a test cannot accidentally give the channel and the domain two
  // different views of it.
  const env = (overrides?.env ?? process.env) as CustomerFlowsEnv;
  let wiring: CustomerFlowsWiring | null = null;
  const flows =
    overrides?.customerFlows ?? ((wiring = buildCustomerFlows(env)) ? wiring.flows : undefined);

  const negotiations = overrides?.customerNegotiations ?? buildCustomerNegotiations(env);
  const customerHandler = flows === undefined ? undefined : createCustomerConversationHandler(flows);
  const negotiationHandler = flows === undefined ? undefined : createCustomerNegotiationConversationHandler(flows, negotiations);

  const app = buildBotApp(BOT, {
    ...overrides,
    // Commands are registered only when a flow can actually answer them: an
    // advertised `/places` that replies with nothing is worse than a command the
    // core rejects with CHANNEL_UNSUPPORTED_COMMAND (422).
    ...(flows === undefined
      ? {}
      : {
          supportedCommands: overrides?.supportedCommands ?? CUSTOMER_SUPPORTED_COMMANDS,
          onConversation: async (event) => (await customerHandler!(event)) ?? negotiationHandler!(event),
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
