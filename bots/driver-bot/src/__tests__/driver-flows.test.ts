/**
 * The Phase 05 · MR 5/6 questions of the driver bot, asked through the real
 * composition root and the real webhook: does a Telegram update reach the Driver
 * Core, and does nothing of the Driver Core reach Telegram?
 *
 * Two layers are covered on purpose:
 *
 *  - **the wiring** — `buildApp` + `app.inject`, with a fake `DriverFlowsPort`, so
 *    what is asserted is command registration, the reply path, idempotency and the
 *    failure paths of the code that ships;
 *  - **the adapter** — `UseCaseDriverFlows` over the in-memory Driver Core, so «the
 *    bot calls the same use cases as HTTP» is proven, not claimed.
 *
 * No database, no network, no Telegram token.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { ELIGIBILITY_REASON_CODES } from "@wasla/contracts-driver";
import {
  createDirectRunner,
  createInMemoryEnvironment,
  reviewDocument,
  submitDocument,
  registerVehicle,
  setServiceZones,
  suspendDriver,
  type DriverRunner,
} from "@wasla/drivers-service";
import { beforeEach, describe, expect, it } from "vitest";

import { UseCaseDriverFlows, toDriverLocale } from "../driver-core.js";
import {
  DOCUMENT_STATUS_TEXT,
  DOCUMENT_TYPE_TEXT,
  DriverFlowError,
  ELIGIBILITY_REASON_TEXT,
  NO_DOCUMENTS_TEXT,
  type DeclaredAvailabilityView,
  type DriverDocumentView,
  type DriverFlowsPort,
  type DriverStatusView,
} from "../flows.js";
import { buildApp } from "../server.js";

const SECRET = "driver-bot-test-webhook-secret";
const DRIVER = "WS-1000000001";
const ZONE_A = "11111111-1111-4111-8111-111111111111";

const ENV = {
  DRIVER_BOT_TOKEN: "token-value",
  DRIVER_BOT_WEBHOOK_SECRET: SECRET,
  DRIVER_BOT_MINI_APP_URL: "https://apps.wasla.test/driver",
  IDENTITY_SERVICE_URL: "http://identity:8080",
};

const ELIGIBLE: DriverStatusView = {
  eligibilityState: "eligible",
  reasonCodes: [],
  declaredAvailability: "offline",
  recheckAt: "2027-01-01T00:00:00.000Z",
};

/** A Driver Core that records what it was asked, and answers what we told it. */
class RecordingFlows implements DriverFlowsPort {
  readonly ensured: {
    waslaPublicId: string;
    displayName?: string;
    languageCode?: string;
  }[] = [];
  readonly statusCalls: string[] = [];
  readonly declarations: { waslaPublicId: string; declared: DeclaredAvailabilityView }[] = [];
  readonly documentCalls: string[] = [];

  status: DriverStatusView = ELIGIBLE;
  documents: DriverDocumentView[] = [];
  failWith: DriverFlowError | Error | null = null;

  async ensureRegistered(input: {
    waslaPublicId: string;
    displayName?: string;
    languageCode?: string;
  }): Promise<{ created: boolean }> {
    if (this.failWith) throw this.failWith;
    this.ensured.push(input);
    return { created: true };
  }

  async readStatus(input: { waslaPublicId: string }): Promise<DriverStatusView> {
    if (this.failWith) throw this.failWith;
    this.statusCalls.push(input.waslaPublicId);
    return this.status;
  }

  async declareAvailability(input: {
    waslaPublicId: string;
    declared: DeclaredAvailabilityView;
  }): Promise<DriverStatusView> {
    if (this.failWith) throw this.failWith;
    this.declarations.push(input);
    return { ...this.status, declaredAvailability: input.declared };
  }

  async listDocuments(input: { waslaPublicId: string }): Promise<readonly DriverDocumentView[]> {
    if (this.failWith) throw this.failWith;
    this.documentCalls.push(input.waslaPublicId);
    return this.documents;
  }
}

function build(flows?: DriverFlowsPort) {
  const channel = new MockChannelAdapter();
  const { app } = buildApp({
    env: ENV,
    channel,
    identity: new FakeIdentityBootstrap("WS-1000"),
    logger: false,
    ...(flows === undefined ? {} : { driverFlows: flows }),
  });
  return { app, channel };
}

/** One Telegram private-chat command update. */
function command(updateId: number, text: string, extra: Record<string, unknown> = {}) {
  return {
    update_id: updateId,
    message: {
      chat: { id: 5, type: "private" },
      from: { id: 6, first_name: "فهد", ...extra },
      text,
    },
  };
}

async function post(app: ReturnType<typeof build>["app"], payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/channel/driver/webhook",
    headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
    payload,
  });
}

describe("driver bot — Driver Core flows", () => {
  let flows: RecordingFlows;

  beforeEach(() => {
    flows = new RecordingFlows();
  });

  it("bootstraps the profile on /start and still answers with the Mini App only", async () => {
    const { app, channel } = build(flows);

    const response = await post(app, command(201, "/start", { language_code: "ar-SA" }));

    expect(response.statusCode).toBe(202);
    expect(flows.ensured).toEqual([
      { waslaPublicId: DRIVER, displayName: "فهد", languageCode: "ar-SA" },
    ]);
    // One message, not two: the welcome is the reply to /start.
    expect(channel.sent).toHaveLength(1);
    expect(channel.last()?.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "driver" });
    await app.close();
  });

  it("answers /status with the verdict and the availability", async () => {
    const { app, channel } = build(flows);

    await post(app, command(202, "/status"));

    expect(flows.statusCalls).toEqual([DRIVER]);
    const text = channel.last()?.text ?? "";
    expect(text).toContain("مؤهَّل لاستقبال الطلبات");
    expect(text).toContain("غير متاح");
    await app.close();
  });

  /**
   * The reason for `/status` existing: a driver told only «غير مؤهَّل» phones support,
   * and support then reads him the list the service had already computed.
   */
  it("tells an ineligible driver what to do about it, in words not codes", async () => {
    flows.status = {
      eligibilityState: "ineligible",
      reasonCodes: ["DOCUMENT_EXPIRED", "NO_SERVICE_ZONE"],
      declaredAvailability: "available",
      recheckAt: "2026-09-01T00:00:00.000Z",
    };
    const { app, channel } = build(flows);

    await post(app, command(203, "/status"));

    const text = channel.last()?.text ?? "";
    expect(text).toContain(ELIGIBILITY_REASON_TEXT.DOCUMENT_EXPIRED);
    expect(text).toContain(ELIGIBILITY_REASON_TEXT.NO_SERVICE_ZONE);
    expect(text).not.toContain("DOCUMENT_EXPIRED");
    expect(text).toContain("2026-09-01");
    await app.close();
  });

  /**
   * Copy coverage as a drift guard: a reason code added to the closed catalog and
   * not to the Arabic map would otherwise reach a driver as a bare identifier, and
   * `renderStatus`'s `?? code` fallback would make that a silent regression.
   */
  it("has Arabic copy for exactly the closed reason catalog", () => {
    expect(Object.keys(ELIGIBILITY_REASON_TEXT).sort()).toEqual([...ELIGIBILITY_REASON_CODES].sort());
  });

  it.each([
    ["/available", "available"],
    ["/offline", "offline"],
  ])("records %s and answers with the verdict it produced", async (text, declared) => {
    const { app, channel } = build(flows);

    const response = await post(app, command(210 + declared.length, text));

    expect(response.statusCode).toBe(202);
    expect(flows.declarations).toEqual([{ waslaPublicId: DRIVER, declared }]);
    // Not «تم»: the reply says what his state now IS, which is the question he asked.
    expect(channel.last()?.text).toContain("الحالة:");
    await app.close();
  });

  /**
   * The failure this asserts against is the plausible one: a driver taps
   * `/available`, is answered «تم», and waits for orders that will never come
   * because his licence expired last night.
   */
  it("does not let a declaration imply he will receive orders", async () => {
    flows.status = {
      eligibilityState: "ineligible",
      reasonCodes: ["DOCUMENT_EXPIRED"],
      declaredAvailability: "offline",
      recheckAt: null,
    };
    const { app, channel } = build(flows);

    await post(app, command(230, "/available"));

    const text = channel.last()?.text ?? "";
    expect(text).toContain("غير مؤهَّل حالياً");
    expect(text).toContain("التوافر: متاح");
    expect(text).toContain(ELIGIBILITY_REASON_TEXT.DOCUMENT_EXPIRED);
    await app.close();
  });

  it("answers /docs with each document, its state and its expiry", async () => {
    flows.documents = [
      { documentType: "driving_license", status: "verified", expiresAt: "2027-03-01" },
      { documentType: "national_id", status: "pending", expiresAt: null },
      { documentType: "vehicle_registration", status: "superseded", expiresAt: "2026-01-01" },
    ];
    const { app, channel } = build(flows);

    await post(app, command(240, "/docs"));

    expect(flows.documentCalls).toEqual([DRIVER]);
    const text = channel.last()?.text ?? "";
    expect(text).toContain(`${DOCUMENT_TYPE_TEXT.driving_license}: ${DOCUMENT_STATUS_TEXT.verified}`);
    expect(text).toContain("تنتهي 2027-03-01");
    expect(text).toContain(DOCUMENT_STATUS_TEXT.pending);
    // The superseded copy is shown deliberately: the driver's view must not
    // disagree with the one support reads while helping him.
    expect(text).toContain(DOCUMENT_STATUS_TEXT.superseded);
    await app.close();
  });

  it("says so, kindly, when there is no document yet", async () => {
    const { app, channel } = build(flows);

    await post(app, command(241, "/docs"));

    expect(channel.last()?.text).toBe(NO_DOCUMENTS_TEXT);
    await app.close();
  });

  it("derives the idempotency key from the update, so a replay sends one message", async () => {
    const { app, channel } = build(flows);

    const first = await post(app, command(250, "/available"));
    const replay = await post(app, command(250, "/available"));

    expect(first.json().status).toBe("accepted");
    expect(replay.json().status).toBe("duplicate");
    // A replayed update must not declare availability twice: that would publish a
    // second candidacy and, with a per-attempt idempotency key, matching would
    // apply it as a distinct write.
    expect(flows.declarations).toHaveLength(1);
    expect(channel.sent).toHaveLength(1);
    await app.close();
  });

  it("turns a domain error code into copy, and never into an internal message", async () => {
    flows.failWith = new DriverFlowError("DRIVER_NOT_FOUND", "لا ملف سائق للمعرّف WS-1000000001");
    const { app, channel } = build(flows);

    const response = await post(app, command(260, "/status"));

    // The webhook still succeeds: the update *was* received (Telegram would
    // otherwise replay it), and the driver is told what to do next.
    expect(response.statusCode).toBe(202);
    expect(channel.last()?.text).toContain("/start");
    expect(channel.last()?.text).not.toContain(DRIVER);
    await app.close();
  });

  it("keeps the webhook successful and silent when the core fails unexpectedly", async () => {
    flows.failWith = new Error("pool exhausted");
    const { app, channel } = build(flows);

    const response = await post(app, command(261, "/docs"));

    expect(response.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("never reads a driver's own data into a group", async () => {
    flows.documents = [{ documentType: "national_id", status: "verified", expiresAt: null }];
    const { app, channel } = build(flows);

    await post(app, {
      update_id: 270,
      message: {
        chat: { id: -100, type: "supergroup" },
        from: { id: 6, first_name: "فهد" },
        text: "/docs",
      },
    });

    expect(flows.documentCalls).toHaveLength(0);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("does not register the domain commands when no Driver Core is configured", async () => {
    // No `driverFlows`, and the environment names no DRIVER_DATABASE_URL: the
    // Phase 03 bot, unchanged. A refusal, not an empty answer.
    const { app, channel } = build();

    const available = await post(app, command(280, "/available"));
    const start = await post(app, command(281, "/start"));

    expect(available.statusCode).toBe(422);
    expect(available.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
    expect(start.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(1);
    await app.close();
  });
});

describe("UseCaseDriverFlows — the adapter over the Driver Core", () => {
  function wired(): { runner: DriverRunner; env: ReturnType<typeof createInMemoryEnvironment> } {
    const env = createInMemoryEnvironment();
    env.zoneCatalog.seed(ZONE_A);
    return { runner: createDirectRunner(env), env };
  }

  it("registers once and never overwrites what the app set", async () => {
    const { runner } = wired();
    const flows = new UseCaseDriverFlows(runner);

    const first = await flows.ensureRegistered({
      waslaPublicId: DRIVER,
      displayName: "فهد",
      languageCode: "ar-SA",
    });
    // The driver renames himself in the Mini App…
    const again = await flows.ensureRegistered({
      waslaPublicId: DRIVER,
      displayName: "اسم من تيليجرام",
    });

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    const status = await flows.readStatus({ waslaPublicId: DRIVER });
    expect(status.declaredAvailability).toBe("offline");
  });

  /**
   * A fresh `/start` leaves `service_kinds` empty on purpose — a claim the driver
   * never made must not appear in his file — so the first `/status` is an accurate
   * instruction rather than a welcome.
   */
  it("answers a freshly registered driver with what he still has to do", async () => {
    const { runner } = wired();
    const flows = new UseCaseDriverFlows(runner);
    await flows.ensureRegistered({ waslaPublicId: DRIVER });

    const status = await flows.readStatus({ waslaPublicId: DRIVER });

    expect(status.eligibilityState).toBe("ineligible");
    expect(status.reasonCodes).toContain("NO_SERVICE_KIND");
    expect(status.reasonCodes).toContain("NO_PRIMARY_VEHICLE");
  });

  it("reports an unregistered driver as a code the bot can translate", async () => {
    const { runner } = wired();
    const flows = new UseCaseDriverFlows(runner);

    await expect(flows.readStatus({ waslaPublicId: "WS-9999999999" })).rejects.toMatchObject({
      name: "DriverFlowError",
      code: "DRIVER_NOT_FOUND",
    });
  });

  /** The declaration reaches the same store the HTTP surface writes to. */
  it("declares availability through the use case, and republishes", async () => {
    const { runner, env } = wired();
    const flows = new UseCaseDriverFlows(runner);
    await flows.ensureRegistered({ waslaPublicId: DRIVER });

    const status = await flows.declareAvailability({
      waslaPublicId: DRIVER,
      declared: "available",
    });

    expect(status.declaredAvailability).toBe("available");
    expect((await env.profiles.find(DRIVER))?.declaredAvailability).toBe("available");
    // Every write ends in a re-decision, and every re-decision is published.
    expect((await env.publications.list(DRIVER)).length).toBeGreaterThan(0);
  });

  it("refuses a declaration from a suspended driver, with its own code", async () => {
    const { runner, env } = wired();
    const flows = new UseCaseDriverFlows(runner);
    await flows.ensureRegistered({ waslaPublicId: DRIVER });
    await suspendDriver(env, DRIVER, "FRAUD_REVIEW");

    await expect(
      flows.declareAvailability({ waslaPublicId: DRIVER, declared: "available" }),
    ).rejects.toMatchObject({ name: "DriverFlowError", code: "DRIVER_SUSPENDED" });
  });

  it("reads back exactly what the use cases stored, and no storage pointer", async () => {
    const { runner, env } = wired();
    const flows = new UseCaseDriverFlows(runner);
    await flows.ensureRegistered({ waslaPublicId: DRIVER });
    await setServiceZones(env, DRIVER, { zones: [{ zoneId: ZONE_A, preferenceRank: 1 }] });
    await registerVehicle(env, DRIVER, {
      vehicleClass: "sedan",
      idempotencyKey: "veh-000001",
      plateNumber: "ABC-1234",
    });
    const submitted = await submitDocument(env, DRIVER, {
      documentType: "driving_license",
      storageRef: "s3://wasla-docs/secret-path.pdf",
      idempotencyKey: "doc-000001",
      expiresAt: "2027-03-01",
    });
    await reviewDocument(env, DRIVER, submitted.id, {
      status: "verified",
      reviewedBy: "ops-1",
      expiresAt: "2027-03-01",
    });

    const documents = await flows.listDocuments({ waslaPublicId: DRIVER });

    expect(documents).toEqual([
      { documentType: "driving_license", status: "verified", expiresAt: "2027-03-01" },
    ]);
    // The storage reference is a file-store pointer; a chat message is the last
    // place it belongs.
    expect(JSON.stringify(documents)).not.toContain("s3://");
  });

  it("maps a language tag to a stored locale, or to nothing at all", () => {
    expect(toDriverLocale("ar-SA")).toBe("ar");
    expect(toDriverLocale("EN_us")).toBe("en");
    expect(toDriverLocale("fr")).toBeUndefined();
    expect(toDriverLocale(undefined)).toBeUndefined();
  });
});
