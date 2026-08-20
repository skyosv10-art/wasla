/**
 * Composition tests — the ADR-007 axiom, executed.
 *
 * `buildBotRuntime` is the only place that names a concrete adapter, so these
 * tests do two things: they prove the production wiring boots from environment
 * variables alone, and they prove the same wiring runs with the channel and the
 * identity service swapped for test doubles, with nothing above changed.
 */

import { describe, expect, it } from "vitest";

import {
  FakeIdentityBootstrap,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  MockChannelAdapter,
  type ChannelDispatch,
} from "@wasla/channel-core";

import { envNames, loadBotConfig, type EnvBag } from "../config.js";
import { createBotApp } from "../http/app.js";
import { buildBotApp } from "../http/server.js";
import { buildBotRuntime, type ChannelStoreSet } from "../runtime.js";

import { authHeaders, startUpdate } from "./harness.js";

const SECRET = "a-sufficiently-long-secret";

function envFor(bot: "customer" | "driver" | "partner", overrides: EnvBag = {}): EnvBag {
  const names = envNames(bot);
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: SECRET,
    [names.miniAppUrl]: `https://apps.wasla.test/${bot}`,
    [names.deepLinkTemplate]: `https://t.me/wasla_${bot}_bot?start={payload}`,
    ...overrides,
  };
}

function appFor(
  bot: "customer" | "driver" | "partner",
  env: EnvBag,
  doubles: { channel?: MockChannelAdapter; identity?: FakeIdentityBootstrap } = {},
) {
  const config = loadBotConfig(bot, env);
  const runtime = buildBotRuntime(config, {
    ...(doubles.channel ? { channel: doubles.channel } : {}),
    ...(doubles.identity ? { identity: doubles.identity } : {}),
  });

  const app = createBotApp({
    deps: {
      bot: runtime.bot,
      inbound: runtime.inbound,
      outbound: runtime.outbound,
      launch: runtime.launch,
    },
    webhookSecret: config.webhookSecret,
    health: () => (runtime.identityDegraded ? "degraded" : "ok"),
  });

  return { app, runtime };
}

describe("buildBotRuntime", () => {
  it("runs an end-to-end /start with the channel and identity swapped out", async () => {
    const channel = new MockChannelAdapter();
    const identity = new FakeIdentityBootstrap();
    const { app } = appFor("driver", envFor("driver", { IDENTITY_SERVICE_URL: "http://identity:8080" }), {
      channel,
      identity,
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/driver/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(1),
    });

    expect(response.statusCode).toBe(202);
    expect(identity.calls).toHaveLength(1);
    const dispatch = channel.last() as ChannelDispatch;
    expect(dispatch.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "driver" });
    // The Mini App URL came from the environment, not from the source.
    expect((await app.inject({ method: "GET", url: "/channel/driver/mini-app" })).json().url).toBe(
      "https://apps.wasla.test/driver",
    );
  });

  it("reports `degraded` and refuses /start when no identity service is configured", async () => {
    const channel = new MockChannelAdapter();
    const { app } = appFor("customer", envFor("customer"), { channel });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ status: "degraded", channel: "telegram" });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(2),
    });

    // Retryable and honest: no identity is invented, so the update can be replayed
    // once the service is wired.
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("CHANNEL_IDENTITY_BOOTSTRAP_FAILED");
    expect(channel.sent).toHaveLength(0);
  });

  it("builds the real Telegram adapter when no double is injected", async () => {
    const { runtime } = appFor("partner", envFor("partner", { IDENTITY_SERVICE_URL: "http://identity:8080" }));

    expect(runtime.outbound.channel.channel).toBe("telegram");
    expect(runtime.identityDegraded).toBe(false);
  });
});

/**
 * Persistence selection (MR 5). `buildBotRuntime` is the one place that decides
 * whether the three channel stores are durable, so the decision is asserted here
 * rather than trusted. No database is contacted: `pg` opens sockets lazily, so
 * building the runtime and closing it again touches nothing.
 */
describe("buildBotRuntime persistence", () => {
  it("stays in memory when no DATABASE_URL is configured", async () => {
    const { runtime } = appFor("customer", envFor("customer"), {
      channel: new MockChannelAdapter(),
    });

    expect(runtime.persistence).toBe("memory");
    // The same outbox must serve both paths, or the event log loses its order.
    expect(runtime.inbound.outbox).toBe(runtime.outbound.outbox);
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it("wires the Postgres stores when DATABASE_URL is configured", async () => {
    const { runtime } = appFor(
      "driver",
      envFor("driver", { DATABASE_URL: "postgres://wasla:secret@db:5432/wasla" }),
      { channel: new MockChannelAdapter() },
    );

    expect(runtime.persistence).toBe("postgres");
    expect(runtime.inbound.outbox).toBe(runtime.outbound.outbox);
    expect(runtime.inbound.processedUpdates).not.toBeInstanceOf(InMemoryProcessedUpdateStore);
    expect(runtime.outbound.deliveries).not.toBeInstanceOf(InMemoryDeliveryStore);

    await runtime.close();
  });

  it("accepts an injected store set and releases it when the app closes", async () => {
    let closed = 0;
    const outbox = new InMemoryOutbox();
    const stores: ChannelStoreSet = {
      processedUpdates: new InMemoryProcessedUpdateStore(),
      deliveries: new InMemoryDeliveryStore(),
      outbox,
      close: async () => {
        closed += 1;
      },
    };

    const { app, runtime } = buildBotApp("partner", {
      env: envFor("partner", { DATABASE_URL: "postgres://wasla:secret@db:5432/wasla" }),
      logger: false,
      channel: new MockChannelAdapter(),
      stores,
    });

    expect(runtime.inbound.outbox).toBe(outbox);
    expect(closed).toBe(0);

    // Shutting the HTTP surface down must release the persistence layer with it.
    await app.close();
    expect(closed).toBe(1);
  });
});
