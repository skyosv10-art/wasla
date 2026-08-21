/**
 * The Phase 04 questions of the customer bot, asked through the real composition
 * root and the real webhook: does a Telegram update reach the Customer Core, and
 * does nothing of the Customer Core reach Telegram?
 *
 * Two layers are covered on purpose:
 *
 *  - **the wiring** — `buildApp` + `app.inject`, with a fake `CustomerFlowsPort`,
 *    so what is asserted is command registration, the reply path, idempotency and
 *    the failure paths of the code that ships;
 *  - **the adapter** — `UseCaseCustomerFlows` over the in-memory Customer Core,
 *    so «the bot calls the same use cases as HTTP» is proven, not claimed.
 *
 * No database, no network, no Telegram token.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import {
  CryptoIdGenerator,
  FakeGeography,
  FakeIdentityLookup,
  InMemoryCustomerRepository,
  InMemoryOutbox,
  SystemClock,
  UnavailableOrderIntake,
  getCustomerProfile,
  savePlace,
  type UseCaseDeps,
} from "@wasla/customers-service";
import { beforeEach, describe, expect, it } from "vitest";

import { UseCaseCustomerFlows, toLocale } from "../customer-core.js";
import {
  CustomerFlowError,
  NO_ORDERS_TEXT,
  NO_PLACES_TEXT,
  ORDERS_REPLY_LIMIT,
  type CustomerFlowsPort,
  type OrderRequestView,
  type SavedPlaceView,
} from "../flows.js";
import { buildApp } from "../server.js";

const SECRET = "customer-bot-test-webhook-secret";

const ENV = {
  CUSTOMER_BOT_TOKEN: "token-value",
  CUSTOMER_BOT_WEBHOOK_SECRET: SECRET,
  CUSTOMER_BOT_MINI_APP_URL: "https://apps.wasla.test/customer",
  IDENTITY_SERVICE_URL: "http://identity:8080",
};

/** A Customer Core that records what it was asked, and answers what we told it. */
class RecordingFlows implements CustomerFlowsPort {
  readonly ensured: {
    waslaPublicId: string;
    displayName?: string;
    languageCode?: string;
  }[] = [];
  readonly placeCalls: string[] = [];
  readonly orderCalls: { waslaPublicId: string; limit: number }[] = [];

  places: SavedPlaceView[] = [];
  orders: OrderRequestView[] = [];
  failWith: CustomerFlowError | Error | null = null;

  async ensureProfile(input: {
    waslaPublicId: string;
    displayName?: string;
    languageCode?: string;
  }): Promise<{ created: boolean }> {
    if (this.failWith) throw this.failWith;
    this.ensured.push(input);
    return { created: true };
  }

  async listSavedPlaces(input: { waslaPublicId: string }): Promise<readonly SavedPlaceView[]> {
    if (this.failWith) throw this.failWith;
    this.placeCalls.push(input.waslaPublicId);
    return this.places;
  }

  async listRecentOrderRequests(input: {
    waslaPublicId: string;
    limit: number;
  }): Promise<readonly OrderRequestView[]> {
    if (this.failWith) throw this.failWith;
    this.orderCalls.push(input);
    return this.orders;
  }
}

function build(flows?: CustomerFlowsPort) {
  const channel = new MockChannelAdapter();
  const { app } = buildApp({
    env: ENV,
    channel,
    identity: new FakeIdentityBootstrap("WS-1000"),
    logger: false,
    ...(flows === undefined ? {} : { customerFlows: flows }),
  });
  return { app, channel };
}

/** One Telegram private-chat command update. */
function command(updateId: number, text: string, extra: Record<string, unknown> = {}) {
  return {
    update_id: updateId,
    message: {
      chat: { id: 5, type: "private" },
      from: { id: 6, first_name: "نورة", ...extra },
      text,
    },
  };
}

async function post(
  app: ReturnType<typeof build>["app"],
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/channel/customer/webhook",
    headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
    payload,
  });
}

describe("customer bot — Customer Core flows", () => {
  let flows: RecordingFlows;

  beforeEach(() => {
    flows = new RecordingFlows();
  });

  it("bootstraps the profile on /start and still answers with the Mini App only", async () => {
    const { app, channel } = build(flows);

    const response = await post(app, command(101, "/start", { language_code: "ar-SA" }));

    expect(response.statusCode).toBe(202);
    expect(flows.ensured).toEqual([
      { waslaPublicId: "WS-1000000001", displayName: "نورة", languageCode: "ar-SA" },
    ]);
    // One message, not two: the welcome is the reply to /start.
    expect(channel.sent).toHaveLength(1);
    expect(channel.last()?.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "customer" });
    await app.close();
  });

  it("answers /places with the saved places and a way into the app", async () => {
    flows.places = [
      { label: "البيت", addressText: "حي العزيزية" },
      { label: "العمل", addressText: null },
    ];
    const { app, channel } = build(flows);

    const response = await post(app, command(102, "/places"));

    expect(response.statusCode).toBe(202);
    expect(flows.placeCalls).toEqual(["WS-1000000001"]);
    const sent = channel.last();
    expect(sent?.text).toContain("البيت — حي العزيزية");
    expect(sent?.text).toContain("2. العمل");
    expect(sent?.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "customer" });
    await app.close();
  });

  it("says so, kindly, when there is no saved place yet", async () => {
    const { app, channel } = build(flows);

    await post(app, command(103, "/places"));

    expect(channel.last()?.text).toBe(NO_PLACES_TEXT);
    await app.close();
  });

  it("answers /orders with the state of each request and asks for few", async () => {
    flows.orders = [
      {
        status: "submitted",
        orderType: "ride",
        orderPublicId: "ORD-77",
        failureReasonCode: null,
        createdAt: "2026-08-21T09:15:00.000Z",
      },
      {
        status: "submission_failed",
        orderType: "delivery",
        orderPublicId: null,
        failureReasonCode: "ENGINE_UNAVAILABLE",
        createdAt: "2026-08-20T18:00:00.000Z",
      },
    ];
    const { app, channel } = build(flows);

    await post(app, command(104, "/orders"));

    expect(flows.orderCalls).toEqual([
      { waslaPublicId: "WS-1000000001", limit: ORDERS_REPLY_LIMIT },
    ]);
    const text = channel.last()?.text ?? "";
    expect(text).toContain("2026-08-21 — مشوار — تم الإرسال — ORD-77");
    expect(text).toContain("2026-08-20 — توصيل — لم يصل للمحرّك");
    // A reason code is operational data, not a message to a customer.
    expect(text).not.toContain("ENGINE_UNAVAILABLE");
    await app.close();
  });

  it("says so when there is no recent order", async () => {
    const { app, channel } = build(flows);

    await post(app, command(105, "/orders"));

    expect(channel.last()?.text).toBe(NO_ORDERS_TEXT);
    await app.close();
  });

  it("derives the idempotency key from the update, so a replay sends one message", async () => {
    const { app, channel } = build(flows);

    const first = await post(app, command(106, "/places"));
    const replay = await post(app, command(106, "/places"));

    expect(first.json().status).toBe("accepted");
    expect(replay.json().status).toBe("duplicate");
    // The duplicate never reached the domain, and never produced a second reply.
    expect(flows.placeCalls).toHaveLength(1);
    expect(channel.sent).toHaveLength(1);
    expect(channel.last()?.idempotencyKey).toBe("flow:customer:106:places");
    await app.close();
  });

  it("turns a domain error code into copy, and never into an internal message", async () => {
    flows.failWith = new CustomerFlowError(
      "CUSTOMER_PROFILE_NOT_FOUND",
      "لا يوجد ملف عميل لهذا المعرّف",
    );
    const { app, channel } = build(flows);

    const response = await post(app, command(107, "/places"));

    // The webhook still succeeds: the update *was* received (Telegram would
    // otherwise replay it), and the customer is told what to do next.
    expect(response.statusCode).toBe(202);
    expect(channel.last()?.text).toContain("/start");
    expect(channel.last()?.text).not.toContain("المعرّف");
    await app.close();
  });

  it("keeps the webhook successful and silent when the core fails unexpectedly", async () => {
    flows.failWith = new Error("pool exhausted");
    const { app, channel } = build(flows);

    const response = await post(app, command(108, "/orders"));

    expect(response.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("never reads personal data into a group", async () => {
    flows.places = [{ label: "البيت", addressText: "حي العزيزية" }];
    const { app, channel } = build(flows);

    await post(app, {
      update_id: 109,
      message: {
        chat: { id: -100, type: "supergroup" },
        from: { id: 6, first_name: "نورة" },
        text: "/places",
      },
    });

    expect(flows.placeCalls).toHaveLength(0);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("does not register the domain commands when no Customer Core is configured", async () => {
    // No `customerFlows`, and the environment names no CUSTOMER_DATABASE_URL:
    // the Phase 03 bot, unchanged.
    const { app, channel } = build();

    const places = await post(app, command(110, "/places"));
    const start = await post(app, command(111, "/start"));

    // 422 is the channel contract's answer for an update it will not act on.
    expect(places.statusCode).toBe(422);
    expect(places.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
    expect(start.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(1);
    await app.close();
  });
});

describe("UseCaseCustomerFlows — the adapter over the Customer Core", () => {
  const CUSTOMER = "WS-1000000001";

  function deps(): UseCaseDeps {
    return {
      repo: new InMemoryCustomerRepository(),
      outbox: new InMemoryOutbox(),
      clock: new SystemClock(),
      idGen: new CryptoIdGenerator(),
      identityLookup: new FakeIdentityLookup([CUSTOMER]),
      geography: new FakeGeography([{ zoneId: "11111111-1111-4111-8111-111111111111", status: "active" }]),
      orderIntake: new UnavailableOrderIntake(),
    };
  }

  it("creates the profile once and never overwrites what the app set", async () => {
    const base = deps();
    const flows = new UseCaseCustomerFlows(base);

    const first = await flows.ensureProfile({
      waslaPublicId: CUSTOMER,
      displayName: "نورة",
      languageCode: "ar-SA",
    });
    // The customer renames themselves in the Mini App…
    const renamed = await flows.ensureProfile({
      waslaPublicId: CUSTOMER,
      displayName: "اسم من تيليجرام",
    });

    expect(first.created).toBe(true);
    expect(renamed.created).toBe(false);
    const profile = await getCustomerProfile(base, { waslaPublicId: CUSTOMER });
    expect(profile.displayName).toBe("نورة");
    expect(profile.preferredLocale).toBe("ar");
  });

  it("reports a domain refusal as a code the bot can translate", async () => {
    const flows = new UseCaseCustomerFlows(deps());

    await expect(
      flows.ensureProfile({ waslaPublicId: "WS-9999999999" }),
    ).rejects.toMatchObject({
      name: "CustomerFlowError",
      code: "CUSTOMER_IDENTITY_NOT_FOUND",
    });
  });

  it("reads back exactly what the use cases stored", async () => {
    const base = deps();
    const flows = new UseCaseCustomerFlows(base);
    await flows.ensureProfile({ waslaPublicId: CUSTOMER });
    await savePlace(base, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "place-key-0001",
      draft: {
        label: "البيت",
        zoneId: "11111111-1111-4111-8111-111111111111",
        addressText: "حي العزيزية",
      },
    });

    const places = await flows.listSavedPlaces({ waslaPublicId: CUSTOMER });
    const orders = await flows.listRecentOrderRequests({
      waslaPublicId: CUSTOMER,
      limit: ORDERS_REPLY_LIMIT,
    });

    expect(places).toEqual([{ label: "البيت", addressText: "حي العزيزية" }]);
    expect(orders).toEqual([]);
  });

  it("maps a language tag to a stored locale, or to nothing at all", () => {
    expect(toLocale("ar-SA")).toBe("ar");
    expect(toLocale("EN_us")).toBe("en");
    expect(toLocale("fr")).toBeUndefined();
    expect(toLocale(undefined)).toBeUndefined();
  });
});
