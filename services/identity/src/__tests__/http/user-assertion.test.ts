/**
 * ADR-060 · CLM-0440 — `POST /identity/assertions`: إصدارُ `wua1` من `identity` وحدَها.
 *
 * المفتاحُ يُولَّدُ داخلَ الاختبارِ (`generateKeyPairSync`)؛ لا مادّةَ مفتاحٍ في Git.
 * المقيسُ: الإصدارُ السليمُ يُتحقَّقُ منهُ بالمفتاحِ العامِّ؛ المستخدمُ غيرُ المربوطِ لا يُنشأُ؛
 * الفاعلُ يتبعُ المناديَ لا الطلبَ؛ الجمهورُ من قائمةٍ مغلقةٍ؛ غيابُ المفتاحِ ⇒ 503؛
 * الصلاحيّةُ المطلوبةُ وحدَها تفتحُ المسارَ؛ والسجلُّ لا يحملُ التأكيدَ.
 */
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryServiceTokenReplayGuard } from "@wasla/service-auth";
import {
  userAssertionSigningKey,
  verifyUserAssertion,
  type UserAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";

import { createIdentityApp } from "../../http/app.js";
import { IDENTITY_SCOPES } from "../../http/service-identity.js";
import { buildInMemoryDeps, createTestKeyRegistry, signFor } from "./support.js";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const ISSUE = "/identity/assertions";
const RESOLVE = "/identity/resolve";
const pair = generateKeyPairSync("ed25519");
const KEY = userAssertionSigningKey("ua-test-1", pair.privateKey);
const PUBLIC = new Map([["ua-test-1", pair.publicKey]]);

function harness(signingKey: UserAssertionSigningKey | null = KEY, logs: Array<Record<string, unknown>> = []) {
  const keys = createTestKeyRegistry();
  const deps = buildInMemoryDeps();
  const app = createIdentityApp({
    deps,
    logger: { level: "info", stream: { write: (line: string) => logs.push(JSON.parse(line)) } } as unknown as boolean,
    serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() },
    userAssertion: { signingKey, now: () => NOW },
  });
  const call = (url: string, payload: unknown, serviceName: string, scopes?: readonly string[]) =>
    app.inject({
      method: "POST",
      url,
      payload: payload as Record<string, unknown>,
      headers: signFor("POST", url, { keys, serviceName, ...(scopes === undefined ? {} : { scopes }) }),
    });
  return { app, deps, call, logs };
}

async function seed(h: ReturnType<typeof harness>, telegramUserId: number): Promise<string> {
  const res = await h.call(RESOLVE, { telegram_user_id: telegramUserId, source: "customer_bot" }, "customer-bot");
  expect(res.statusCode).toBe(201);
  return (res.json() as { wasla_public_id: string }).wasla_public_id;
}

const issueScope = [IDENTITY_SCOPES.assertionIssue];

describe("POST /identity/assertions — الإصدارُ (ADR-060 · CLM-0440)", () => {
  it("يُصدِرُ تأكيداً يتحقّقُ منهُ المفتاحُ العامُّ: sub = المعرّفُ العامُّ، via = المنادي", async () => {
    const h = harness();
    const publicId = await seed(h, 9001);
    const res = await h.call(ISSUE, { telegram_user_id: 9001, actor_type: "customer", audience: ["negotiations"] }, "customer-bot", issueScope);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assertion: string; wasla_public_id: string; expires_at: string; actor_type: string };
    expect(body.wasla_public_id).toBe(publicId);
    expect(body.actor_type).toBe("customer");
    expect(body.expires_at).toBe("2026-10-02T12:01:00.000Z");
    const verdict = verifyUserAssertion(body.assertion, {
      publicKeys: PUBLIC,
      audience: "negotiations",
      onBehalfOfPublicId: publicId,
      callerService: "customer-bot",
      actors: ["customer"],
      now: NOW,
    });
    expect(verdict).toMatchObject({ ok: true, payload: { sub: publicId, via: "customer-bot", iss: "identity", chn: "telegram" } });
  });

  it("مستخدمٌ غيرُ مربوطٍ ⇒ 404 ولا يُنشأُ مستخدمٌ (قراءةٌ فقط، بخلافِ resolve)", async () => {
    const h = harness();
    const res = await h.call(ISSUE, { telegram_user_id: 424242, actor_type: "customer", audience: ["negotiations"] }, "customer-bot", issueScope);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "IDENTITY_NOT_FOUND" });
    expect(await h.deps.repo.findUserByTelegramId(424242)).toBeNull();
  });

  it("الفاعلُ يتبعُ المناديَ: customer-bot لا يطلبُ driver، وخدمةٌ ليست بوتاً لا تطلبُ شيئاً", async () => {
    const h = harness();
    await seed(h, 9002);
    const lifted = await h.call(ISSUE, { telegram_user_id: 9002, actor_type: "driver", audience: ["negotiations"] }, "customer-bot", issueScope);
    expect(lifted.statusCode).toBe(403);
    expect(lifted.json()).toMatchObject({ code: "IDENTITY_ASSERTION_FORBIDDEN" });
    const service = await h.call(ISSUE, { telegram_user_id: 9002, actor_type: "customer", audience: ["negotiations"] }, "customers", issueScope);
    expect(service.statusCode).toBe(403);
    const driver = await h.call(ISSUE, { telegram_user_id: 9002, actor_type: "driver", audience: ["drivers", "matching"] }, "driver-bot", issueScope);
    expect(driver.statusCode).toBe(200);
  });

  it("جمهورٌ خارجَ القائمةِ المغلقةِ للفاعلِ ⇒ 403", async () => {
    const h = harness();
    await seed(h, 9003);
    const res = await h.call(ISSUE, { telegram_user_id: 9003, actor_type: "customer", audience: ["negotiations", "payments"] }, "customer-bot", issueScope);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "IDENTITY_ASSERTION_FORBIDDEN" });
  });

  it("طلبٌ مشوَّهٌ ⇒ 400", async () => {
    const h = harness();
    for (const payload of [
      { actor_type: "customer", audience: ["negotiations"] },
      { telegram_user_id: "9004", actor_type: "customer", audience: ["negotiations"] },
      { telegram_user_id: 9004, actor_type: "admin", audience: ["negotiations"] },
      { telegram_user_id: 9004, actor_type: "customer", audience: [] },
    ]) {
      const res = await h.call(ISSUE, payload, "customer-bot", issueScope);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "IDENTITY_ASSERTION_INVALID_REQUEST" });
    }
  });

  it("بلا مفتاحِ توقيعٍ ⇒ 503 IDENTITY_ASSERTION_UNAVAILABLE (حالُ الإنتاجِ حتّى P3)", async () => {
    const h = harness(null);
    await seed(h, 9005);
    const res = await h.call(ISSUE, { telegram_user_id: 9005, actor_type: "customer", audience: ["negotiations"] }, "customer-bot", issueScope);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "IDENTITY_ASSERTION_UNAVAILABLE" });
  });

  it("صلاحيّةُ resolve وحدَها لا تُصدِرُ تأكيداً ⇒ 403", async () => {
    const h = harness();
    await seed(h, 9006);
    const res = await h.call(ISSUE, { telegram_user_id: 9006, actor_type: "customer", audience: ["negotiations"] }, "customer-bot", [IDENTITY_SCOPES.resolveWrite]);
    expect(res.statusCode).toBe(403);
  });

  it("سجلُّ التدقيقِ user_assertion_issued يحملُ المعرّفَ العامَّ ولا يحملُ التأكيدَ", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const h = harness(KEY, logs);
    const publicId = await seed(h, 9007);
    const res = await h.call(ISSUE, { telegram_user_id: 9007, actor_type: "customer", audience: ["negotiations"] }, "customer-bot", issueScope);
    const assertion = (res.json() as { assertion: string }).assertion;
    const issued = logs.filter((l) => l.event === "user_assertion_issued");
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ sub: publicId, act: "customer", via: "customer-bot", aud: ["negotiations"] });
    const all = JSON.stringify(logs);
    expect(all).not.toContain(assertion.split(".")[2]!);
    expect(all).not.toContain('"telegram_user_id":9007');
  });
});
