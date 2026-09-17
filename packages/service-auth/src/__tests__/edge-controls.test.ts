/**
 * اختباراتُ ضوابطِ الحدود: تحديدُ معدَّلِ الإساءةِ وتنقيحُ الأخطاءِ وتدقيقُ الرفض (M1-08).
 *
 * برهانُ القبول: 429 بعد استنفادِ الدلو · لا تسرُّبَ رمزٍ أو سرٍّ في 401/403/429 ·
 * الطلباتُ الشرعيّةُ تمرُّ · التعبئةُ حتميّةٌ معَ الساعةِ المُحقونة.
 */

import { describe, it, expect } from "vitest";

import {
  EdgeRateLimiter,
  redactErrorBody,
  InMemoryAuditSink,
  recordSecurityDenial,
  RATE_LIMIT_DEFAULTS,
  type AuditEvent,
} from "../edge-controls.js";

// ── ساعةٌ مُحقونةٌ ────────────────────────────────────────────────────────────

function makeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

// ── تحديدُ المعدَّلِ ────────────────────────────────────────────────────────

describe("EdgeRateLimiter", () => {
  it("يسمحُ حتى استنفادِ السعة", () => {
    const clock = makeClock(0);
    const limiter = new EdgeRateLimiter(clock.now, { capacity: 3, refillPerSecond: 1 });

    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take()).toEqual({ allowed: true });
  });

  it("يرفضُ بعد استنفادِ السعة بـ429 ومدّةِ انتظار", () => {
    const clock = makeClock(0);
    const limiter = new EdgeRateLimiter(clock.now, { capacity: 2, refillPerSecond: 1 });

    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take()).toEqual({ allowed: true });
    const verdict = limiter.take();
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("يتعبَّأُ حتميّاً معَ الساعةِ المُحقونة", () => {
    const clock = makeClock(0);
    const limiter = new EdgeRateLimiter(clock.now, { capacity: 2, refillPerSecond: 10 });

    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take().allowed).toBe(false);

    // تقدُّمُ 200ms ⇒ رمزان جديدان
    clock.advance(200);
    expect(limiter.take()).toEqual({ allowed: true });
    expect(limiter.take()).toEqual({ allowed: true });
  });

  it("لا يتجاوزُ السعةَ بعد التعبئة", () => {
    const clock = makeClock(0);
    const limiter = new EdgeRateLimiter(clock.now, { capacity: 5, refillPerSecond: 100 });

    // استنفاد
    for (let i = 0; i < 5; i++) {
      expect(limiter.take().allowed).toBe(true);
    }

    // تقدُّمُ ثانية كاملة: التعبئةُ تملأُ حتّى السعة لا أكثر
    clock.advance(1000);
    expect(limiter.availableTokens).toBe(5);
  });

  it("يستخدمُ الافتراضيّات عندَ غيابِ الخيارات", () => {
    const clock = makeClock(0);
    const limiter = new EdgeRateLimiter(clock.now);
    expect(limiter.availableTokens).toBe(RATE_LIMIT_DEFAULTS.capacity);
  });
});

// ── التنقيحُ ────────────────────────────────────────────────────────────────

describe("redactErrorBody", () => {
  it("ينزعُ الترويساتِ الحسّاسة", () => {
    const body = {
      error: {
        code: "AUTHN_UNAUTHENTICATED",
        x_wasla_service_auth: "wsvc3.abc123",
        authorization: "Bearer some-token",
      },
    };
    const redacted = redactErrorBody(body) as Record<string, Record<string, unknown>>;
    expect(redacted.error.x_wasla_service_auth).toBe("[redacted]");
    expect(redacted.error.authorization).toBe("[redacted]");
  });

  it("يستبدلُ رموزَ wsvc3 في النصوص", () => {
    const body = {
      message: "Token wsvc3.eyJhbGciOiJIUzI1NiJ9.payload.sig was rejected",
    };
    const redacted = redactErrorBody(body) as Record<string, Record<string, unknown>>;
    expect(String(redacted.message)).not.toContain("wsvc3.");
    expect(String(redacted.message)).toContain("[token]");
  });

  it("يستبدلُ السلاسلَ السريّةَ الطويلة", () => {
    const longSecret = "a".repeat(40);
    const body = { detail: `Secret was ${longSecret}` };
    const redacted = redactErrorBody(body) as Record<string, Record<string, unknown>>;
    expect(String(redacted.detail)).not.toContain(longSecret);
    expect(String(redacted.detail)).toContain("[redacted]");
  });

  it("لا يُغيِّرُ الأجسامَ البريئة", () => {
    const body = { error: { code: "NOT_FOUND", trace_id: "abc-123" } };
    const redacted = redactErrorBody(body);
    expect(redacted).toEqual(body);
  });

  it("يتعاملُ معَ null وغيرِ الكائنات", () => {
    expect(redactErrorBody(null)).toBeNull();
    expect(redactErrorBody("string")).toBe("string");
    expect(redactErrorBody(42)).toBe(42);
  });

  it("ينظِّفُ الأجسامَ المتداخلة", () => {
    const body = {
      outer: {
        inner: {
          x_wasla_service_auth: "wsvc3.secret",
          safe: "ok",
        },
      },
    };
    const redacted = redactErrorBody(body) as Record<string, Record<string, Record<string, unknown>>>;
    expect(redacted.outer.inner.x_wasla_service_auth).toBe("[redacted]");
    expect(redacted.outer.inner.safe).toBe("ok");
  });
});

// ── التدقيقُ ────────────────────────────────────────────────────────────────

describe("InMemoryAuditSink", () => {
  it("يُسجِّلُ الأحداث", () => {
    const sink = new InMemoryAuditSink();
    const event: AuditEvent = {
      type: "authn_denied",
      traceId: "req-1",
      route: "POST /orders",
      method: "POST",
      timestamp: new Date().toISOString(),
    };
    sink.record(event);
    expect(sink.count).toBe(1);
    expect(sink.events[0]).toEqual(event);
  });

  it("يُرشِّحُ حسبَ النوع", () => {
    const sink = new InMemoryAuditSink();
    sink.record({
      type: "authn_denied",
      traceId: "1",
      route: "GET /orders",
      method: "GET",
      timestamp: new Date().toISOString(),
    });
    sink.record({
      type: "rate_limited",
      traceId: "2",
      route: "POST /orders",
      method: "POST",
      timestamp: new Date().toISOString(),
    });
    expect(sink.filter("authn_denied")).toHaveLength(1);
    expect(sink.filter("rate_limited")).toHaveLength(1);
    expect(sink.filter("authz_denied")).toHaveLength(0);
  });
});

describe("recordSecurityDenial", () => {
  it("يُسجِّلُ حدثاً عندَ وجودِ بالوعة", () => {
    const sink = new InMemoryAuditSink();
    recordSecurityDenial(sink, "authz_denied", {
      id: "req-1",
      method: "POST",
      url: "/channel/messages",
    });
    expect(sink.count).toBe(1);
    expect(sink.events[0].type).toBe("authz_denied");
    expect(sink.events[0].route).toBe("POST /channel/messages");
  });

  it("لا يفعلُ شيئاً عندَ غيابِ البالوعة", () => {
    recordSecurityDenial(undefined, "authn_denied", {
      id: "req-1",
      method: "GET",
      url: "/health",
    });
    // لا يُرمى خطأ
  });
});
