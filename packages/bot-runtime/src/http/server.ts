/**
 * Bot bootstrap: read the environment, wire the ports, listen.
 *
 * Shared by the three roots so each `bots/<bot>-bot` wiring file is a single
 * call naming its own bot — the difference between the three bots is *configuration*, and a
 * launcher is not the place to re-express it three times.
 *
 * Not covered by the unit suite (which uses `createBotApp` + `app.inject` with
 * in-memory ports): this file's job is process concerns — env, port, signals.
 */

import type { FastifyInstance } from "fastify";

import type { BotKind } from "@wasla/contracts-channel";

import { loadBotConfig, type BotConfig, type EnvBag } from "../config.js";
import type { ConversationHandler } from "../conversation.js";
import { buildBotRuntime, type BotRuntime, type BuildBotRuntimeOptions } from "../runtime.js";

import { createBotApp } from "./app.js";

export interface StartBotOptions extends BuildBotRuntimeOptions {
  readonly env?: EnvBag;
  readonly logger?: boolean;
  /**
   * The bot's domain flow, if it has one.
   *
   * Passed through untouched: this launcher assembles *channel* dependencies, and
   * a domain flow is assembled by the root that owns the domain (ADR-007 §1). A
   * bot without one behaves exactly as it did in Phase 03.
   */
  readonly onConversation?: ConversationHandler;
}

/** Alias used by the composition roots, whose vocabulary is "overrides". */
export type BotRuntimeOverrides = StartBotOptions;

/** One wired bot, not yet listening. */
export interface BotApp {
  readonly app: FastifyInstance;
  readonly config: BotConfig;
  readonly runtime: BotRuntime;
}

/**
 * Wire one bot from the environment without binding a port.
 *
 * The roots and their tests use this seam: it exercises the same configuration
 * reader and the same wiring as production, minus the socket.
 */
export function buildBotApp(bot: BotKind, options: StartBotOptions = {}): BotApp {
  const env = options.env ?? (process.env as EnvBag);
  const config = loadBotConfig(bot, env);
  const runtime = buildBotRuntime(config, options);

  const app = createBotApp({
    deps: {
      bot: runtime.bot,
      inbound: runtime.inbound,
      outbound: runtime.outbound,
      launch: runtime.launch,
    },
    webhookSecret: config.webhookSecret,
    ...(options.onConversation === undefined
      ? {}
      : { onConversation: options.onConversation }),
    // Group replies carry a deep link; a bot without a link template answers in
    // text instead of failing every group reply on a missing template.
    groupLinkAvailable: config.presence.deepLinkTemplate !== undefined,
    health: () => (runtime.identityDegraded ? "degraded" : "ok"),
    logger: options.logger ?? true,
  });

  // Fastify owns the shutdown sequence, so the connection pool is released from
  // its `onClose` hook rather than from a signal handler here: `app.close()`
  // during a test, a rolling deploy, or `SIGTERM` then all end the same way, and
  // a bot cannot leak a pool by forgetting to unwind it.
  app.addHook("onClose", async () => {
    await runtime.close();
  });

  return { app, config, runtime };
}

/**
 * Build and start one bot.
 *
 * Configuration errors are thrown *before* `listen`, so a misconfigured bot
 * never occupies its port while rejecting every update (fail fast, config.ts).
 */
export async function startBot(
  bot: BotKind,
  options: StartBotOptions = {},
): Promise<FastifyInstance> {
  const { app, config } = buildBotApp(bot, options);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  return app;
}

/**
 * `startBot` for a module entrypoint: logs the failure and exits non-zero so an
 * orchestrator restarts (or stops restarting) the container instead of seeing a
 * healthy process with a rejected promise.
 */
export async function runBot(bot: BotKind): Promise<void> {
  return runBotApp(bot, () => buildBotApp(bot));
}

/**
 * `runBot` for a bot whose composition root adds something to the wiring.
 *
 * ## The defect this exists to close (Phase 05 · MR 5/6)
 *
 * A bot with domain flows assembles them in its own `server.ts` — `buildApp()` —
 * because the composition root is the only layer allowed to know both a channel and a
 * domain (ADR-007 §1). But its entry point called `runBot(BOT)`, which builds the app
 * from `buildBotApp` **directly**, skipping that root entirely. The consequence was
 * invisible in every test, because the tests call `buildApp` — and total in production:
 * the deployed process registered no domain command at all, so every `/places` and
 * `/orders` was answered `CHANNEL_UNSUPPORTED_COMMAND` (422) by a bot whose suite was
 * green. It was found while building the driver bot's mirror of the same shape.
 *
 * The fix is to make the launcher take the root instead of re-deriving it. A bot's
 * `main.ts` now reads `void runBotApp(BOT, buildApp)`, so the thing that listens is by
 * construction the thing that was built and tested.
 *
 * Not covered by the unit suite for the same reason `startBot` is not: its job is
 * process concerns — listen, log, exit code.
 */
export async function runBotApp(bot: BotKind, build: () => BotApp): Promise<void> {
  try {
    const { app, config } = build();
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (error) {
    console.error(`[${bot}-bot] failed to start:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
