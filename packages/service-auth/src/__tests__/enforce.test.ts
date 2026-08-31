/**
 * نقطةُ الفرض (M1-03 · الفجوةُ الثالثة) — مصفوفةُ القراراتِ الأربعُ التي يجب
 * أن تُثبَت قبلَ أن يُقال «النظامُ يفرض الهويّةَ»:
 *
 * | الحالُ                        | المنتظَر |
 * |------------------------------|---------|
 * | لا هويّةَ                     | 401     |
 * | هويّةٌ مُنتحَلةٌ (توقيعٌ مُختلَقٌ) | 401     |
 * | هويّةٌ صحيحةٌ                  | مقبولٌ   |
 * | هويّةٌ صحيحةٌ وصلاحيّةٌ ناقصةٌ  | 403     |
 *
 * ويُضاف إليها بابانِ لا يقلّانِ أثراً: **الرمزُ المُعادُ** (401) و**مخزنٌ لا
 * يُجيب** (503 لا 200).
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import { describe, expect, it } from "vitest";

import { enforceServiceIdentity, REPLAY_STORE_UNAVAILABLE_CODE } from "../enforce.js";
import { SERVICE_AUTH_HEADER, serviceAuthHeaders } from "../http.js";
import { MIN_SECRET_BYTES, ServiceAuthKeyRegistry } from "../keys.js";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
} from "../replay.js";
import type { ServiceTokenReplayGuard } from "../replay.js";

const SECRET = "k".repeat(MIN_SECRET_BYTES);
const OTHER = "z".repeat(MIN_SECRET_BYTES);

const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: SECRET, status: "active" }],
  activeKid: "k1",
});

/** مُهاجمٌ يعرف الصيغةَ ومعرِّفَ المفتاحِ ولا يملك السرَّ. */
const forgedKeys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: OTHER, status: "active" }],
  activeKid: "k1",
});

const NOW = new Date("2026-08-31T05:00:00.000Z");
const REQUEST = { method: "POST", path: "/matching/candidates" } as const;

function enforcement(overrides: Partial<Parameters<typeof enforceServiceIdentity>[1]> = {}) {
  return {
    audience: "matching",
    keys,
    replayGuard: new InMemoryServiceTokenReplayGuard({ now: () => NOW }),
    requiredScopes: ["matching:candidates:evaluate"],
    now: () => NOW,
    ...overrides,
  };
}

function signedHeaders(
  overrides: {
    scopes?: readonly string[];
    audience?: string;
    method?: string;
    path?: string;
    keys?: ServiceAuthKeyRegistry;
    now?: Date;
    jti?: string;
  } = {},
): Record<string, string> {
  return serviceAuthHeaders({
    serviceName: "dispatch",
    audience: overrides.audience ?? "matching",
    method: overrides.method ?? REQUEST.method,
    path: overrides.path ?? REQUEST.path,
    keys: overrides.keys ?? keys,
    now: overrides.now ?? NOW,
    scopes: overrides.scopes ?? ["matching:candidates:evaluate"],
    ...(overrides.jti === undefined ? {} : { jti: overrides.jti }),
  });
}

describe("enforceServiceIdentity — المصفوفةُ الأربع", () => {
  it("لا هويّةَ → 401 ورسالةٌ لا تُسمّي البابَ", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: {} },
      enforcement(),
    );
    expect(decision.outcome).toBe("denied");
    if (decision.outcome !== "denied") return;
    expect(decision.status).toBe(401);
    expect(decision.code).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(decision.logReason).toBe("missing_credentials");
    expect(decision.message).not.toContain("توقيع");
    expect(decision.message).not.toContain("مفتاح");
  });

  it("هويّةٌ مُنتحَلةٌ → 401 بسببٍ داخليٍّ «توقيعٌ لا يُطابق»", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ keys: forgedKeys }) },
      enforcement(),
    );
    expect(decision.outcome).toBe("denied");
    if (decision.outcome !== "denied") return;
    expect(decision.status).toBe(401);
    expect(decision.logReason).toBe("bad_signature");
  });

  it("هويّةٌ صحيحةٌ → مقبولٌ ويُسلَّم Principal بشكلِ ADR-018", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders() },
      enforcement(),
    );
    expect(decision.outcome).toBe("allowed");
    if (decision.outcome !== "allowed") return;
    expect(decision.principal.kind).toBe("service");
    expect(decision.principal.serviceName).toBe("dispatch");
    expect(decision.principal.audience).toBe("matching");
  });

  it("هويّةٌ صحيحةٌ وصلاحيّةٌ ناقصةٌ → 403 لا 401، وتُسمّى الناقصةُ داخليّاً", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ scopes: ["matching:candidacy:read"] }) },
      enforcement(),
    );
    expect(decision.outcome).toBe("denied");
    if (decision.outcome !== "denied") return;
    expect(decision.status).toBe(403);
    expect(decision.code).toBe(AuthErrorCode.FORBIDDEN);
    expect(decision.logReason).toBe("insufficient_scope");
    expect(decision.missingScopes).toEqual(["matching:candidates:evaluate"]);
  });
});

describe("enforceServiceIdentity — الطزاجةُ", () => {
  it("الرمزُ نفسُه مرّتَينِ: يُقبَل ثمّ يُرفَض 401", async () => {
    const options = enforcement();
    const headers = signedHeaders();
    const first = await enforceServiceIdentity({ ...REQUEST, headers }, options);
    const second = await enforceServiceIdentity({ ...REQUEST, headers }, options);
    expect(first.outcome).toBe("allowed");
    expect(second.outcome).toBe("denied");
    if (second.outcome !== "denied") return;
    expect(second.status).toBe(401);
    expect(second.logReason).toBe("replayed_token");
  });

  it("ورمزانِ مختلفانِ في اللحظةِ نفسِها يُقبَلانِ — الحارسُ لا يمنع التوازي", async () => {
    const options = enforcement();
    const first = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders() },
      options,
    );
    const second = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders() },
      options,
    );
    expect(first.outcome).toBe("allowed");
    expect(second.outcome).toBe("allowed");
  });

  it("لا يُسأل الحارسُ عن رمزٍ لم يُثبَت توقيعُه — فلا يُغرَق المخزنُ من الخارج", async () => {
    const asked: string[] = [];
    const spy: ServiceTokenReplayGuard = {
      remember(entry) {
        asked.push(entry.jti);
        return "accepted";
      },
    };
    await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ keys: forgedKeys }) },
      enforcement({ replayGuard: spy }),
    );
    await enforceServiceIdentity({ ...REQUEST, headers: {} }, enforcement({ replayGuard: spy }));
    expect(asked).toHaveLength(0);

    await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ jti: "V".repeat(22) }) },
      enforcement({ replayGuard: spy }),
    );
    expect(asked).toEqual(["V".repeat(22)]);
  });

  it("الطزاجةُ تُفحَص قبلَ الصلاحيّةِ: رمزٌ مُعادٌ بصلاحيّةٍ ناقصةٍ يُرَدُّ 401", async () => {
    const options = enforcement();
    const headers = signedHeaders({ scopes: ["matching:candidacy:read"] });
    const first = await enforceServiceIdentity({ ...REQUEST, headers }, options);
    const second = await enforceServiceIdentity({ ...REQUEST, headers }, options);
    expect(first.outcome === "denied" && first.status).toBe(403);
    expect(second.outcome === "denied" && second.status).toBe(401);
  });

  it("مخزنٌ لا يُجيب → 503 لا 200 ولا 401", async () => {
    const broken: ServiceTokenReplayGuard = {
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزنُ صامتٌ.");
      },
    };
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders() },
      enforcement({ replayGuard: broken }),
    );
    expect(decision.outcome).toBe("denied");
    if (decision.outcome !== "denied") return;
    expect(decision.status).toBe(503);
    expect(decision.code).toBe(REPLAY_STORE_UNAVAILABLE_CODE);
    expect(decision.logReason).toBe("replay_store_unavailable");
  });

  it("وخطأٌ غيرُ متوقَّعٍ من المخزنِ لا يُبتلَع — يُرفَع كما هو", async () => {
    const exploding: ServiceTokenReplayGuard = {
      remember() {
        throw new TypeError("عيبُ برمجةٍ لا عيبُ مخزنٍ");
      },
    };
    await expect(
      enforceServiceIdentity(
        { ...REQUEST, headers: signedHeaders() },
        enforcement({ replayGuard: exploding }),
      ),
    ).rejects.toThrow(TypeError);
  });

  it("يقبل حارساً غيرَ متزامنٍ — العقدُ نفسُه لـRedis", async () => {
    const seen = new Set<string>();
    const asyncGuard: ServiceTokenReplayGuard = {
      async remember(entry) {
        await Promise.resolve();
        if (seen.has(entry.jti)) return "replayed";
        seen.add(entry.jti);
        return "accepted";
      },
    };
    const options = enforcement({ replayGuard: asyncGuard });
    const headers = signedHeaders();
    expect((await enforceServiceIdentity({ ...REQUEST, headers }, options)).outcome).toBe(
      "allowed",
    );
    expect((await enforceServiceIdentity({ ...REQUEST, headers }, options)).outcome).toBe(
      "denied",
    );
  });
});

describe("enforceServiceIdentity — أبوابُ الرمزِ تبقى مفروضةً على الحدّ", () => {
  it("رمزٌ منتهٍ → 401 بكودِ الانتهاءِ (يخدم المُشغِّلَ الشريف)", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ now: new Date(NOW.getTime() - 3_600_000) }) },
      enforcement(),
    );
    expect(decision.outcome === "denied" && decision.code).toBe(AuthErrorCode.EXPIRED);
  });

  it("رمزٌ لخدمةٍ أخرى → 401 بكودِ الجمهور", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ audience: "drivers" }) },
      enforcement(),
    );
    expect(decision.outcome === "denied" && decision.code).toBe(
      AuthErrorCode.AUDIENCE_MISMATCH,
    );
  });

  it("رمزُ مسارٍ آخرَ لا يُقبَل على هذا المسار", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ path: "/matching/rulesets", method: "GET" }) },
      enforcement(),
    );
    expect(decision.outcome === "denied" && decision.logReason).toBe(
      "request_binding_mismatch",
    );
  });

  it("ترويسةٌ مكرَّرةٌ تُرفَض بوصفِها غموضاً", async () => {
    const decision = await enforceServiceIdentity(
      {
        ...REQUEST,
        headers: { [SERVICE_AUTH_HEADER]: ["a", "b"] },
      },
      enforcement(),
    );
    expect(decision.outcome === "denied" && decision.logReason).toBe("malformed_token");
  });

  it("مفتاحٌ مسحوبٌ → 401 بسببٍ يُميِّزه عن المجهول", async () => {
    const signed = signedHeaders();
    const afterIncident = new ServiceAuthKeyRegistry({
      keys: [
        { kid: "k1", secret: "", status: "revoked" },
        { kid: "k2", secret: `${SECRET}-2`, status: "active" },
      ],
      activeKid: "k2",
    });
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signed },
      enforcement({ keys: afterIncident }),
    );
    expect(decision.outcome === "denied" && decision.logReason).toBe("revoked_key");
  });

  it("حدٌّ بلا صلاحيّةٍ مُعلَنةٍ يقبل هويّةً مُثبَتةً — والقائمةُ الفارغةُ صريحةٌ", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ scopes: [] }) },
      enforcement({ requiredScopes: [] }),
    );
    expect(decision.outcome).toBe("allowed");
  });

  it("ويقبل صلاحيّةً بحرفِ بدلٍ في الجزءِ الأخيرِ كما في auth-sdk", async () => {
    const decision = await enforceServiceIdentity(
      { ...REQUEST, headers: signedHeaders({ scopes: ["matching:candidates:*"] }) },
      enforcement(),
    );
    expect(decision.outcome).toBe("allowed");
  });
});
