/**
 * اختباراتُ `@wasla/tick-scheduler` (G8 · M2-09A · CLM-0330).
 *
 * **تستوردُ الشيفرةَ الفعليّةَ** — نقيضُ السلفِ الذي بحثَ عن نصوصٍ في ملفٍّ لا
 * يُقلِعُ. والرمزُ يُتحقَّقُ منهُ بـ`verifyServiceToken` نفسِها التي تستعملُها
 * الخدماتُ، على خادمِ HTTP حقيقيٍّ محلّيٍّ، فالربطُ (طريقةٌ · مسارٌ · جمهورٌ ·
 * صلاحيّاتٌ) مُثبَتٌ لا مُفترَضٌ.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { keyRegistryFromEnv, verifyServiceToken, SERVICE_AUTH_HEADER } from "@wasla/service-auth";
import { ENFORCED_OPERATIONS, PRODUCTION_GRANTS } from "@wasla/authz-policy";
import {
  EXIT_CONFIG,
  EXIT_OK,
  EXIT_TICK_FAILED,
  SCHEDULER_SERVICE_NAME,
  TICK_ROUTES,
  runTicks,
  type RunDependencies,
} from "../index.js";

const KEYS_ENV = {
  WASLA_SERVICE_AUTH_KEYS: "k1:active:test-secret-that-is-long-enough-for-hmac-0123456789",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "k1",
};
const NOW = new Date("2026-09-24T09:00:00.000Z");

interface Seen {
  method: string;
  path: string;
  token: string | undefined;
  body: string;
  contentType: string | undefined;
}

let server: Server;
let baseUrl: string;
let seen: Seen[];
let respond: (req: IncomingMessage) => { status: number; delayMs?: number };
let lockDir: string;

beforeEach(async () => {
  seen = [];
  respond = () => ({ status: 202 });
  lockDir = await mkdtemp(join(tmpdir(), "wasla-tick-"));
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const header = req.headers[SERVICE_AUTH_HEADER];
      seen.push({
        method: req.method ?? "",
        path: req.url ?? "",
        token: Array.isArray(header) ? header[0] : header,
        body,
        contentType: req.headers["content-type"],
      });
      const { status, delayMs } = respond(req);
      setTimeout(() => res.writeHead(status).end(status >= 400 ? "boom" : ""), delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(lockDir, { recursive: true, force: true });
});

function deps(env: Record<string, string | undefined>): RunDependencies {
  const allUrls = Object.fromEntries(TICK_ROUTES.map((t) => [`WASLA_TICK_BASE_URL_${t.service.toUpperCase()}`, baseUrl]));
  return {
    env: { ...KEYS_ENV, ...allUrls, WASLA_TICK_LOCK_DIR: lockDir, ...env },
    fetch: globalThis.fetch,
    now: () => NOW,
    log: () => {},
  };
}

describe("مساراتُ النبضةِ تطابقُ سياسةَ التفويضِ", () => {
  test("كلُّ مسارِ نبضةٍ في السياسةِ مغطّى، وكلُّ مسارٍ هنا مُفوَّضٌ بصلاحيّاتِه نفسِها", () => {
    const policyTicks = ENFORCED_OPERATIONS.filter((op) => op.method === "POST" && op.path.endsWith("/tick"));
    expect(policyTicks.length).toBe(TICK_ROUTES.length);
    for (const op of policyTicks) {
      const route = TICK_ROUTES.find((t) => t.path === op.path);
      expect(route, op.path).toBeDefined();
      expect(route!.audience).toBe(op.audience);
      expect([...route!.scopes].sort()).toEqual([...op.scopes].sort());
    }
  });
});

describe("منحُ الدورِ في المصفوفةِ", () => {
  test("لكلِّ مسارِ نبضةٍ منحٌ لـtick-scheduler بصلاحيّتِه نفسِها ولا أكثرَ، ولا منحَ على غيرِ جماهيرِ النبضةِ", () => {
    const grants = PRODUCTION_GRANTS[SCHEDULER_SERVICE_NAME]!;
    expect(grants.map((g) => g.audience).sort()).toEqual(TICK_ROUTES.map((t) => t.audience).sort());
    for (const route of TICK_ROUTES) {
      expect(grants.find((g) => g.audience === route.audience)!.scopes).toEqual(route.scopes);
    }
  });
});

describe("النداءُ الفعليُّ", () => {
  test("كلُّ الخدماتِ: رمزٌ يتحقّقُ منهُ بـverifyServiceToken، بلا جسمٍ ولا content-type، وخروجٌ 0", async () => {
    const result = await runTicks(deps({}));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.outcomes.map((o) => o.outcome)).toEqual(TICK_ROUTES.map(() => "ok"));
    expect(seen).toHaveLength(TICK_ROUTES.length);
    const keys = keyRegistryFromEnv(KEYS_ENV);
    for (const route of TICK_ROUTES) {
      const req = seen.find((s) => s.path === route.path)!;
      expect(req.method).toBe("POST");
      expect(req.body).toBe("");
      expect(req.contentType).toBeUndefined();
      const principal = verifyServiceToken(req.token!, {
        audience: route.audience,
        method: "POST",
        path: route.path,
        keys,
        now: NOW,
      });
      expect(principal.kind).toBe("service");
      expect(JSON.stringify(principal)).toContain(SCHEDULER_SERVICE_NAME);
      for (const scope of route.scopes) expect(JSON.stringify(principal)).toContain(scope);
    }
  });

  test("الرمزُ لا يصلحُ لمسارٍ آخرَ (الربطُ حقيقيٌّ)", async () => {
    await runTicks(deps({ WASLA_TICK_SERVICES: "dispatch" }));
    const keys = keyRegistryFromEnv(KEYS_ENV);
    expect(() =>
      verifyServiceToken(seen[0]!.token!, { audience: "dispatch", method: "POST", path: "/negotiations/tick", keys, now: NOW }),
    ).toThrow();
  });

  test("WASLA_TICK_SERVICES يحصرُ النداءَ في خدمةٍ واحدةٍ", async () => {
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "reputation" }));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(seen.map((s) => s.path)).toEqual(["/reputation/tick"]);
  });

  test("503 فشلٌ مُسمّى unavailable يُسقِطُ الخروجَ — لا نجاحًا صامتًا", async () => {
    respond = () => ({ status: 503 });
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "drivers" }));
    expect(result.exitCode).toBe(EXIT_TICK_FAILED);
    expect(result.outcomes[0]!.outcome).toBe("unavailable");
  });

  test("4xx/5xx فشلٌ بحالتِه", async () => {
    respond = () => ({ status: 401 });
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "dispatch" }));
    expect(result.exitCode).toBe(EXIT_TICK_FAILED);
    expect(result.outcomes[0]).toMatchObject({ outcome: "failed", status: 401 });
  });

  test("المهلةُ تُجهِضُ النداءَ ولا تُعلِّقُ", async () => {
    respond = () => ({ status: 202, delayMs: 2_000 });
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "dispatch", WASLA_TICK_TIMEOUT_MS: "100" }));
    expect(result.exitCode).toBe(EXIT_TICK_FAILED);
    expect(result.outcomes[0]).toMatchObject({ outcome: "timeout", timeoutMs: 100 });
  });

  test("خدمةٌ غيرُ قابلةٍ للوصولِ فشلٌ لا استثناءٌ قاتلٌ", async () => {
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "dispatch", WASLA_TICK_BASE_URL_DISPATCH: "http://127.0.0.1:1" }));
    expect(result.exitCode).toBe(EXIT_TICK_FAILED);
    expect(result.outcomes[0]!.outcome).toBe("failed");
  });
});

describe("القفلُ", () => {
  test("قفلٌ قائمٌ يتخطّى الخدمةَ بلا نداءٍ، وقفلُ التشغيلِ يُحذَفُ بعدَهُ حتى عندَ الفشلِ", async () => {
    await writeFile(join(lockDir, "wasla-tick-dispatch.lock"), "{}");
    respond = () => ({ status: 500 });
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "dispatch,negotiations" }));
    expect(result.outcomes.find((o) => o.service === "dispatch")!.outcome).toBe("locked");
    expect(seen.map((s) => s.path)).toEqual(["/negotiations/tick"]);
    expect(await readdir(lockDir)).toEqual(["wasla-tick-dispatch.lock"]);
  });
});

describe("أخطاءُ التهيئةِ تخرجُ بـ2 قبلَ أيِّ نداءٍ", () => {
  test.each([
    ["مفاتيحُ مفقودةٌ", { WASLA_SERVICE_AUTH_KEYS: undefined }],
    ["صيغةُ مفاتيحَ قديمةٌ", { WASLA_SERVICE_AUTH_KEYS: "k1:secret" }],
    ["خدمةٌ مجهولةٌ", { WASLA_TICK_SERVICES: "orders" }],
    ["مهلةٌ غيرُ صالحةٍ", { WASLA_TICK_TIMEOUT_MS: "soon" }],
  ])("%s", async (_name, env) => {
    const result = await runTicks(deps(env));
    expect(result.exitCode).toBe(EXIT_CONFIG);
    expect(seen).toHaveLength(0);
  });

  test("عنوانٌ مفقودٌ لخدمةٍ فشلٌ مُسمّى misconfigured ولا نداءَ لها", async () => {
    const result = await runTicks(deps({ WASLA_TICK_SERVICES: "subscriptions", WASLA_TICK_BASE_URL_SUBSCRIPTIONS: undefined }));
    expect(result.exitCode).toBe(EXIT_TICK_FAILED);
    expect(result.outcomes[0]!.outcome).toBe("misconfigured");
    expect(seen).toHaveLength(0);
  });
});
