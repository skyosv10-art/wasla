/**
 * محوّلُ سبرِ حدِّ السوقِ — اختباراتُ وحدةٍ (المراجعةُ 15/N · ADR-026 §4.17).
 *
 * `fetch` مُحقونٌ، فلا شبكةَ ولا سوقاً قائماً. وأهمُّ حالةٍ هنا ليست عطلاً بل
 * **200 معَ جسمٍ معطوبٍ**: حدُّ السوقِ يُجيبُ 200 دائماً، فمسبارٌ يقرأُ الرمزَ
 * وحدَهُ يُبلِّغُ سلامةَ سوقٍ فقدَ قاعدتَهُ. هذه هيَ العلّةُ التي تُقاسُ.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS,
  DELIVERY_MARKETPLACE_PROBE_SCOPES,
  HttpMarketplaceHealthProbe,
} from "../infrastructure/http-marketplace-probe.js";

const SIGNED_HEADERS = { "x-wasla-service": "delivery", "x-wasla-signature": "sig" };

interface Call {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

function probeWith(
  answer: (call: Call) => Promise<Response> | Response,
  options: { baseUrl?: string; timeoutMs?: number } = {},
): { probe: HttpMarketplaceHealthProbe; calls: Call[]; signedPaths: string[] } {
  const calls: Call[] = [];
  const signedPaths: string[] = [];
  const probe = new HttpMarketplaceHealthProbe({
    baseUrl: options.baseUrl ?? "http://marketplace:8090",
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    signRequest: (method: string, path: string) => {
      signedPaths.push(`${method} ${path}`);
      return SIGNED_HEADERS;
    },
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(url),
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.headers === undefined ? {} : { headers: init.headers as Record<string, string> }),
        ...(init?.signal === undefined || init.signal === null ? {} : { signal: init.signal }),
      };
      calls.push(call);
      return await answer(call);
    }) as unknown as typeof fetch,
  });
  return { probe, calls, signedPaths };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpMarketplaceHealthProbe — الحالةُ من الجسمِ لا من الرمزِ", () => {
  it("200 و`status: \"ok\"` ⇒ سليمٌ بلا سببٍ", async () => {
    const { probe, calls, signedPaths } = probeWith(() =>
      jsonResponse({ status: "ok", mode: "live" }),
    );

    const result = await probe.probe();

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://marketplace:8090/health");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers).toEqual(SIGNED_HEADERS);
    // المسارُ المُوقَّعُ هوَ المسارُ المُنادى — توقيعٌ على مسارٍ آخرَ يُرفَضُ عندَ السوقِ.
    expect(signedPaths).toEqual(["GET /health"]);
  });

  it("200 و`status: \"degraded\"` ⇒ عطلٌ باسمِهِ — وهذه هيَ العلّةُ المقيسةُ", async () => {
    const { probe } = probeWith(() => jsonResponse({ status: "degraded", mode: "live" }));

    // سوقٌ فقدَ قاعدتَهُ يُجيبُ 200؛ ولو قُرِئَ الرمزُ وحدَهُ لكانَ `ok: true`.
    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_degraded" });
  });

  it("200 و`status: \"unavailable\"` ⇒ عطلٌ باسمِهِ", async () => {
    const { probe } = probeWith(() => jsonResponse({ status: "unavailable", mode: "live" }));

    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_unavailable" });
  });

  it.each([
    ["حالةٌ لم تُعرَفْ", { status: "fine" }],
    ["حالةٌ غائبةٌ", { mode: "live" }],
    ["حالةٌ ليست نصّاً", { status: 1 }],
  ])("200 وجسمٌ منحرفٌ (%s) ⇒ `marketplace_contract_drift` لا سلامةٌ", async (_label, body) => {
    const { probe } = probeWith(() => jsonResponse(body));

    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_contract_drift" });
  });

  it.each([
    ["جسمٌ ليسَ JSON", new Response("<html>502</html>", { status: 200 })],
    ["جسمٌ فارغٌ", new Response("", { status: 200 })],
    ["JSON ليسَ كائناً", new Response("42", { status: 200 })],
    ["JSON معدومٌ", new Response("null", { status: 200 })],
  ])("200 وجسمٌ لا يُقرأُ (%s) ⇒ `marketplace_unreadable_body`", async (_label, response) => {
    const { probe } = probeWith(() => response);

    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_unreadable_body" });
  });

  it.each([401, 403])("%d ⇒ `marketplace_denied_identity`: نقصُ إعدادٍ عندَنا", async (status) => {
    const { probe } = probeWith(() => jsonResponse({ error_code: "UNAUTHORIZED" }, status));

    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_denied_identity" });
  });

  it.each([404, 500, 502, 503])("%d ⇒ `marketplace_error_status`", async (status) => {
    const { probe } = probeWith(() => jsonResponse({ status: "ok" }, status));

    // لاحِظْ: الجسمُ يقولُ `ok` والرمزُ يقولُ خلافَهُ — الرمزُ شرطٌ يُفحَصُ أوّلاً.
    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_error_status" });
  });

  it("انقطاعُ شبكةٍ ⇒ `marketplace_unreachable` بلا اسمِ مضيفٍ ولا نصِّ استثناءٍ", async () => {
    const { probe } = probeWith(() => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND marketplace.internal");
    });

    const result = await probe.probe();

    expect(result).toEqual({ ok: false, detail: "marketplace_unreachable" });
    expect(JSON.stringify(result)).not.toContain("marketplace.internal");
  });

  it("مَهَلٌ انقضى ⇒ `marketplace_timeout` — والإشارةُ تصلُ `fetch` فعلاً", async () => {
    const { probe, calls } = probeWith(
      async (call) =>
        await new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      { timeoutMs: 5 },
    );

    expect(await probe.probe()).toEqual({ ok: false, detail: "marketplace_timeout" });
    expect(calls[0]?.signal).toBeDefined();
  });

  it("مَهَلٌ غيرُ صالحٍ يعودُ إلى الافتراضِ ولا يُلغي الحمايةَ", async () => {
    const { probe } = probeWith(() => jsonResponse({ status: "ok" }), { timeoutMs: 0 });

    // صفرٌ كانَ سيُبطِلُ المؤقِّتَ أو يُلغيَ النداءَ فوراً؛ الافتراضُ يحفظُ المعنى.
    expect(DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS).toBe(1_000);
    expect(await probe.probe()).toEqual({ ok: true });
  });

  it("أصلٌ بخطوطٍ مائلةٍ زائدةٍ لا يُنتِجُ `//health`", async () => {
    const { probe, calls } = probeWith(() => jsonResponse({ status: "ok" }), {
      baseUrl: "http://marketplace:8090///",
    });

    await probe.probe();

    expect(calls[0]?.url).toBe("http://marketplace:8090/health");
  });

  it("صلاحيّاتُ المسبارِ فارغةٌ — مسبارُ صحّةٍ لا يقرأُ متجراً", () => {
    expect(DELIVERY_MARKETPLACE_PROBE_SCOPES).toEqual([]);
  });
});
