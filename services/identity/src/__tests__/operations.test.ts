import { describe, it, expect, beforeEach } from "vitest";

import {
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  SystemClock,
  CryptoIdGenerator,
  resolveTelegramIdentity,
  addIdentityLink,
  startRecovery,
  getIdentityHistory,
  IdentityError,
  type UseCaseDeps,
} from "../index.js";

function makeDeps(): { deps: UseCaseDeps; outbox: InMemoryOutbox; repo: InMemoryIdentityRepository } {
  const repo = new InMemoryIdentityRepository();
  const outbox = new InMemoryOutbox();
  const deps: UseCaseDeps = {
    repo,
    outbox,
    publicIdSeq: new InMemoryPublicIdSequence(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
  };
  return { deps, outbox, repo };
}

describe("addIdentityLink / startRecovery / getIdentityHistory", () => {
  let harness: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    harness = makeDeps();
  });

  it("adds a phone link to an existing user and emits identity.link.added", async () => {
    const { deps, outbox } = harness;
    const user = await resolveTelegramIdentity(deps, {
      telegram_user_id: 1,
      telegram_username: "a",
      source: "customer_bot",
    });
    outbox.drain();

    const link = await addIdentityLink(deps, {
      waslaPublicId: user.wasla_public_id,
      provider: "phone",
      external_id: "+966500000000",
      verified: true,
    });

    expect(link).toMatchObject({
      provider: "phone",
      external_id: "+966500000000",
      verified: true,
    });
    const events = await outbox.unread();
    expect(events.map((e) => e.event_type)).toEqual(["identity.link.added"]);
  });

  it("rejects a link already bound to another user (409 conflict)", async () => {
    const { deps } = harness;
    const userA = await resolveTelegramIdentity(deps, {
      telegram_user_id: 1,
      telegram_username: "a",
      source: "customer_bot",
    });
    const userB = await resolveTelegramIdentity(deps, {
      telegram_user_id: 2,
      telegram_username: "b",
      source: "customer_bot",
    });

    await expect(
      addIdentityLink(deps, {
        waslaPublicId: userB.wasla_public_id,
        provider: "telegram",
        external_id: "1", // belongs to userA
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_LINK_ALREADY_LINKED" });

    expect(userA.wasla_public_id).not.toBe(userB.wasla_public_id);
  });

  it("rejects an invalid provider (422)", async () => {
    const { deps } = harness;
    const user = await resolveTelegramIdentity(deps, {
      telegram_user_id: 1,
      telegram_username: "a",
      source: "customer_bot",
    });
    await expect(
      addIdentityLink(deps, {
        waslaPublicId: user.wasla_public_id,
        provider: "wechat",
        external_id: "x",
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_LINK_INVALID_PROVIDER" });
  });

  it("starts recovery and emits identity.recovery.started", async () => {
    const { deps, outbox } = harness;
    const user = await resolveTelegramIdentity(deps, {
      telegram_user_id: 1,
      telegram_username: "a",
      source: "customer_bot",
    });
    outbox.drain();

    const recovery = await startRecovery(deps, {
      waslaPublicId: user.wasla_public_id,
      verification_method: "phone_otp",
    });

    expect(recovery.status).toBe("verification_pending");
    expect(recovery.recovery_id).toMatch(/^[0-9a-f-]{36}$/);
    const events = await outbox.unread();
    expect(events.map((e) => e.event_type)).toEqual([
      "identity.recovery.started",
    ]);
  });

  it("returns identity history filtered by field", async () => {
    const { deps } = harness;
    const user = await resolveTelegramIdentity(deps, {
      telegram_user_id: 1,
      telegram_username: "a",
      source: "customer_bot",
    });
    await resolveTelegramIdentity(deps, {
      telegram_user_id: 1,
      telegram_username: "b",
      source: "customer_bot",
    });

    const history = await getIdentityHistory(deps, {
      waslaPublicId: user.wasla_public_id,
      field: "telegram_username",
    });
    expect(history.map((h) => h.new_value)).toEqual(["a", "b"]);
    expect(history[0].old_value).toBeNull();
  });

  it("throws typed IdentityError instances", async () => {
    const { deps } = harness;
    await expect(
      getIdentityHistory(deps, { waslaPublicId: "WS-0000000099" }),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
