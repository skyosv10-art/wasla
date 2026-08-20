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
import { buildBotRuntime, type BotRuntime, type BuildBotRuntimeOptions } from "../runtime.js";

import { createBotApp } from "./app.js";

export interface StartBotOptions extends BuildBotRuntimeOptions {
  readonly env?: EnvBag;
  readonly logger?: boolean;
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
    health: () => (runtime.identityDegraded ? "degraded" : "ok"),
    logger: options.logger ?? true,
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
  try {
    await startBot(bot);
  } catch (error) {
    console.error(`[${bot}-bot] failed to start:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
