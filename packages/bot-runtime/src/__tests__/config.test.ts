/**
 * Configuration tests.
 *
 * Every case here is a deployment mistake that has to be caught at startup rather
 * than at the first user interaction: a forgotten token, a secret that is too
 * short to be a secret, an http Mini App URL Telegram will refuse to open, a
 * link template with no place to put the payload.
 */

import { describe, expect, it } from "vitest";

import { BOT_KINDS } from "@wasla/contracts-channel";

import {
  DEFAULT_BOT_PORTS,
  DEFAULT_MINI_APP_LABELS,
  SingleBotRegistry,
  envNames,
  envPrefix,
  loadBotConfig,
  loadBotPresence,
  type EnvBag,
} from "../config.js";

const SECRET = "a-sufficiently-long-secret";

function envFor(bot: "customer" | "driver" | "partner", overrides: EnvBag = {}): EnvBag {
  const names = envNames(bot);
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: SECRET,
    [names.miniAppUrl]: `https://apps.wasla.test/${bot}`,
    ...overrides,
  };
}

describe("envPrefix / envNames", () => {
  it("derives variable names from the bot kind", () => {
    expect(envPrefix("driver")).toBe("DRIVER_BOT");
    expect(envNames("driver").token).toBe("DRIVER_BOT_TOKEN");
    expect(envNames("partner").deepLinkTemplate).toBe("PARTNER_BOT_DEEP_LINK_TEMPLATE");
  });
});

describe("loadBotPresence", () => {
  it.each(BOT_KINDS)("maps bot %s onto its own Mini App", (bot) => {
    const presence = loadBotPresence(bot, envFor(bot));

    expect(presence.bot).toBe(bot);
    expect(presence.miniApp).toBe(bot);
    expect(presence.miniAppLabel).toBe(DEFAULT_MINI_APP_LABELS[bot]);
  });

  it("accepts a custom label", () => {
    const names = envNames("customer");
    const presence = loadBotPresence(
      "customer",
      envFor("customer", { [names.miniAppLabel]: "ابدأ الطلب" }),
    );

    expect(presence.miniAppLabel).toBe("ابدأ الطلب");
  });

  it("refuses a non-https Mini App URL", () => {
    const names = envNames("customer");
    expect(() =>
      loadBotPresence("customer", envFor("customer", { [names.miniAppUrl]: "http://apps.test/x" })),
    ).toThrow(/https/);
  });

  it("refuses a deep-link template without the payload placeholder", () => {
    const names = envNames("customer");
    expect(() =>
      loadBotPresence(
        "customer",
        envFor("customer", { [names.deepLinkTemplate]: "https://t.me/wasla_bot" }),
      ),
    ).toThrow(/placeholder/);
  });

  it("keeps a valid template", () => {
    const names = envNames("customer");
    const presence = loadBotPresence(
      "customer",
      envFor("customer", { [names.deepLinkTemplate]: "https://t.me/wasla_bot?start={payload}" }),
    );

    expect(presence.deepLinkTemplate).toBe("https://t.me/wasla_bot?start={payload}");
  });
});

describe("loadBotConfig", () => {
  it("reads a complete configuration and defaults the port", () => {
    const config = loadBotConfig("customer", envFor("customer"));

    expect(config.bot).toBe("customer");
    expect(config.port).toBe(DEFAULT_BOT_PORTS.customer);
    expect(config.identityServiceUrl).toBeUndefined();
  });

  it("prefers the bot-specific port over the shared PORT", () => {
    const names = envNames("driver");
    const config = loadBotConfig("driver", envFor("driver", { PORT: "9000", [names.port]: "9100" }));

    expect(config.port).toBe(9100);
  });

  it("falls back to the shared PORT", () => {
    const config = loadBotConfig("driver", envFor("driver", { PORT: "9000" }));

    expect(config.port).toBe(9000);
  });

  it.each(["token", "webhookSecret", "miniAppUrl"] as const)(
    "refuses to start without %s",
    (field) => {
      const names = envNames("customer");
      const env = { ...envFor("customer") } as Record<string, string | undefined>;
      delete env[names[field] as string];

      expect(() => loadBotConfig("customer", env)).toThrow(new RegExp(names[field] as string));
    },
  );

  it("refuses a webhook secret shorter than the published minimum", () => {
    const names = envNames("customer");
    expect(() => loadBotConfig("customer", envFor("customer", { [names.webhookSecret]: "short" }))).toThrow(
      /at least/,
    );
  });

  it("refuses a non-numeric port", () => {
    const names = envNames("customer");
    expect(() => loadBotConfig("customer", envFor("customer", { [names.port]: "eighty" }))).toThrow(
      /integer/,
    );
  });

  it("carries the identity service configuration through", () => {
    const config = loadBotConfig(
      "partner",
      envFor("partner", {
        IDENTITY_SERVICE_URL: "http://identity:8080",
        IDENTITY_TIMEOUT_MS: "1500",
        WASLA_SERVICE_AUTH_KEYS: "test-active:active:bot-runtime-test-secret-0123456789",
        WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
      }),
    );

    expect(config.identityServiceUrl).toBe("http://identity:8080");
    expect(config.identityTimeoutMs).toBe(1500);
    expect(config.serviceAuthActiveKid).toBe("test-active");
  });

  it("يرفض الإقلاع إذا وُصل حدُّ الهويّةِ بلا مادّةِ مفاتيحَ (M1-04)", () => {
    // حدُّ الهويّةِ يفرضُ التوقيعَ: بوتٌ يُقلِعُ بلا مفاتيحَ سيُرَدُّ 401 عندَ
    // كلِّ `/start`، فيقولُ للمستخدمِ إنّ هويّتَه تعذَّرت وهي متاحةٌ. الإخفاقُ
    // عندَ الإقلاعِ يُسمّي المتغيّرَ الناقصَ بدلَ ذلك.
    expect(() =>
      loadBotConfig("partner", envFor("partner", { IDENTITY_SERVICE_URL: "http://identity:8080" })),
    ).toThrow(/WASLA_SERVICE_AUTH_KEYS/);
  });

  it("carries a Postgres DATABASE_URL through (MR 5 persistence)", () => {
    const config = loadBotConfig(
      "customer",
      envFor("customer", { DATABASE_URL: "postgres://wasla:secret@db:5432/wasla" }),
    );

    expect(config.databaseUrl).toBe("postgres://wasla:secret@db:5432/wasla");
  });

  it("treats an absent or blank DATABASE_URL as «in-memory»", () => {
    expect(loadBotConfig("customer", envFor("customer")).databaseUrl).toBeUndefined();
    expect(
      loadBotConfig("customer", envFor("customer", { DATABASE_URL: "   " })).databaseUrl,
    ).toBeUndefined();
  });

  it.each(["mysql://db:3306/wasla", "db:5432/wasla", "http://db:5432"])(
    "refuses a DATABASE_URL that is not Postgres (%s)",
    (value) => {
      // A typo would otherwise fail on the first webhook, not at startup.
      expect(() => loadBotConfig("customer", envFor("customer", { DATABASE_URL: value }))).toThrow(
        /DATABASE_URL/,
      );
    },
  );
});

describe("SingleBotRegistry", () => {
  it("serves its own bot and nothing else", () => {
    const presence = loadBotPresence("driver", envFor("driver"));
    const registry = new SingleBotRegistry(presence);

    expect(registry.presenceFor("driver")).toBe(presence);
    expect(registry.presenceFor("customer")).toBeNull();
    expect(registry.presenceFor("partner")).toBeNull();
  });
});
