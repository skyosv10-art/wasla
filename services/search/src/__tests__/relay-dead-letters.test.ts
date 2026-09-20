/**
 * اختباراتُ وحدةٍ لمقياسِ المسمومِ وحُكمِهِ ولمسارِهِ على الحدِّ
 * (فجوةُ `G5` · موجةُ العينِ · `CLM-0247`).
 *
 * قسمانِ: دوالُّ الحكمِ النقيّةُ بلا قاعدةٍ ولا حدٍّ، ثمَّ المسارُ بمنفذٍ وهميٍّ.
 * والعتبةُ **لا تُمرَّرُ** في أيِّ اختبارٍ: تُقرأُ من الثابتِ المنشورِ، فاختبارٌ
 * يحقنُ عتبتَهُ كانَ سيبقى أخضرَ بعدَ تخفيفِ العتبةِ الحقيقيّةِ.
 */

import { describe, expect, it } from "vitest";

import {
  SEARCH_DEAD_LETTER_LEDGERS,
  SEARCH_DEAD_LETTER_THRESHOLDS,
  classifySearchDeadLetterSeverity,
  oldestSearchPoisonedAgeSeconds,
  type SearchDeadLetterMetric,
} from "../domain/relay-dead-letters.js";
import type { SearchDeadLetterReadPort } from "../ports.js";
import { buildEnforcedApp, inject, signFor } from "./service-identity-support.js";

const AT = new Date("2026-09-20T12:00:00.000Z");

function metric(overrides: Partial<SearchDeadLetterMetric> = {}): SearchDeadLetterMetric {
  return {
    measuredAt: AT.toISOString(),
    totalPoisoned: 0,
    totalAcknowledgedPoisoned: 0,
    totalUnacknowledgedPoisoned: 0,
    ledgers: [
      {
        ledger: "marketplace",
        poisoned: 0,
        acknowledgedPoisoned: 0,
        unacknowledgedPoisoned: 0,
        oldestPoisonedAt: null,
        newestPoisonedAt: null,
        oldestUnacknowledgedPoisonedAt: null,
        byEventType: [],
      },
    ],
    ...overrides,
  };
}

function poisonedMetric(count: number, oldestIso: string | null): SearchDeadLetterMetric {
  /*
   * لا إقرارَ في هذا المعوانِ بقصدٍ: هوَ معوانُ موجةِ العينِ، ومعناهُ «فقدٌ
   * مفتوحٌ» — وإضافةُ إقرارٍ إليهِ كانت ستُغيِّرُ ما تقيسُهُ اختباراتٌ قائمةٌ.
   * وحالةُ المُقَرِّ بهِ لها معوانُها في `relay-acknowledgement.test.ts`.
   */
  return metric({
    totalPoisoned: count,
    totalAcknowledgedPoisoned: 0,
    totalUnacknowledgedPoisoned: count,
    ledgers: [
      {
        ledger: "marketplace",
        poisoned: count,
        acknowledgedPoisoned: 0,
        unacknowledgedPoisoned: count,
        oldestPoisonedAt: oldestIso,
        newestPoisonedAt: oldestIso,
        oldestUnacknowledgedPoisonedAt: oldestIso,
        byEventType: [{ eventType: "marketplace.product_published", poisoned: count }],
      },
    ],
  });
}

function fakeDeadLetterPort(
  value: SearchDeadLetterMetric,
  capture?: (q: { eventTypeLimit: number }) => void,
): SearchDeadLetterReadPort {
  return {
    async readSearchDeadLetters(query) {
      capture?.(query);
      return value;
    },
  };
}

describe("search dead-letter verdict (G5)", () => {
  it("declares exactly one ledger — and it is named in operator language", () => {
    // دفترٌ يُضافُ غداً يُسقِطُ هذا الاختبارَ قصداً: القائمةُ عقدٌ منشورٌ في
    // الجوابِ، وتوسيعُها صامتاً كانَ سيُغيِّرُ شكلَ جوابِ مسارِ تشغيلٍ بلا قرارٍ.
    expect(SEARCH_DEAD_LETTER_LEDGERS).toEqual(["marketplace"]);
  });

  it("an empty ledger is ok — and the reason says WHY, not just the severity", () => {
    const verdict = classifySearchDeadLetterSeverity(metric(), AT);
    expect(verdict).toEqual({
      severity: "ok",
      because: "no_poisoned_rows",
      oldestPoisonedAgeSeconds: null,
      // مضافٌ في موجةِ المحضرِ (`CLM-0249`) — والمساواةُ الكاملةُ مقصودةٌ: حقلٌ
      // يُضافُ لحكمٍ منشورٍ يجبُ أن يُسقِطَ هذا الاختبارَ لا أن يمرَّ صامتاً.
      oldestUnacknowledgedPoisonedAgeSeconds: null,
    });
  });

  it("a single poisoned row is already a warning (threshold is 1, not a tunable)", () => {
    const verdict = classifySearchDeadLetterSeverity(
      poisonedMetric(1, "2026-09-20T11:59:00.000Z"),
      AT,
    );
    expect(SEARCH_DEAD_LETTER_THRESHOLDS.warningPoisoned).toBe(1);
    expect(verdict.severity).toBe("warning");
    expect(verdict.because).toBe("poisoned_present");
    expect(verdict.oldestPoisonedAgeSeconds).toBe(60);
  });

  it("count at or above critical escalates — and count wins over age when both fire", () => {
    // الترتيبُ مُثبَتٌ لا مُستنتَجٌ: عيبٌ منهجيٌّ جارٍ أعجلُ من تنبيهٍ مُهمَلٍ.
    const old = new Date(AT.getTime() - 5 * 86_400_000).toISOString();
    const verdict = classifySearchDeadLetterSeverity(
      poisonedMetric(SEARCH_DEAD_LETTER_THRESHOLDS.criticalPoisoned, old),
      AT,
    );
    expect(verdict.severity).toBe("critical");
    expect(verdict.because).toBe("poisoned_count_at_or_above_critical");
  });

  it("age alone escalates a single neglected row", () => {
    const old = new Date(
      AT.getTime() - SEARCH_DEAD_LETTER_THRESHOLDS.criticalAgeSeconds * 1000,
    ).toISOString();
    const verdict = classifySearchDeadLetterSeverity(poisonedMetric(1, old), AT);
    expect(verdict.severity).toBe("critical");
    expect(verdict.because).toBe("oldest_poisoned_at_or_above_critical_age");
  });

  it("clock skew never yields a negative age, and an unreadable stamp is null not zero", () => {
    // صفرٌ يُقرأُ «الآنَ» وهوَ ادّعاءٌ لم يُقَسْ — فالعدمُ يُعادُ عدماً.
    const future = new Date(AT.getTime() + 5_000).toISOString();
    expect(oldestSearchPoisonedAgeSeconds(poisonedMetric(1, future), AT)).toBe(0);
    expect(oldestSearchPoisonedAgeSeconds(poisonedMetric(1, "not-a-date"), AT)).toBeNull();
  });
});

describe("GET /search/relay/dead-letters (G5)", () => {
  const URL = "/search/relay/dead-letters";

  it("publishes the measurement, the verdict, the thresholds and the age source", async () => {
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
      deadLetterReadPort: fakeDeadLetterPort(poisonedMetric(2, "2026-09-20T11:00:00.000Z")),
      now: () => AT,
    });
    const response = await inject(app.fastify, { method: "GET", url: URL });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;

    expect(body["total_poisoned"]).toBe(2);
    expect(body["applied_filter"]).toEqual({ event_type_limit: 10 });
    expect(body["alert"]).toMatchObject({
      severity: "warning",
      because: "poisoned_present",
      oldest_poisoned_age_seconds: 3600,
      // الحدُّ منشورٌ في الجسمِ: العمرُ عمرُ أوّلِ محاولةٍ لا لحظةِ الفقدِ.
      age_measured_from: "consumed_at",
      // مُعلِمٌ لا حاكمٌ — ولا يُستنتَجُ من غيابِ حقلٍ.
      gates_readiness: false,
      thresholds: {
        warning_poisoned: 1,
        critical_poisoned: 10,
        critical_age_seconds: 86_400,
      },
    });
    await app.close();
  });

  it("names the ledger even when it is empty — a missing ledger reads as clean", async () => {
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
      deadLetterReadPort: fakeDeadLetterPort(metric()),
      now: () => AT,
    });
    const body = (await inject(app.fastify, { method: "GET", url: URL })).json() as {
      ledgers: readonly { ledger: string; poisoned: number }[];
    };
    expect(body.ledgers).toEqual([
      {
        ledger: "marketplace",
        poisoned: 0,
        acknowledged_poisoned: 0,
        unacknowledged_poisoned: 0,
        oldest_poisoned_at: null,
        oldest_unacknowledged_poisoned_at: null,
        newest_poisoned_at: null,
        by_event_type: [],
      },
    ]);
    await app.close();
  });

  it("answers 503 — never an empty measurement — when no port is wired", async () => {
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
    });
    const response = await inject(app.fastify, { method: "GET", url: URL });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { code: string }).code).toBe("SEARCH_INTERNAL_ERROR");
    await app.close();
  });

  it("rejects a bad event_type_limit with 400 instead of silently clamping it", async () => {
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
      deadLetterReadPort: fakeDeadLetterPort(metric()),
    });
    for (const bad of ["0", "-1", "1.5", "abc", "101"]) {
      const response = await inject(app.fastify, { method: "GET", url: `${URL}?event_type_limit=${bad}` });
      expect(response.statusCode, bad).toBe(400);
      expect((response.json() as { code: string }).code).toBe("SEARCH_DEAD_LETTER_LIMIT_INVALID");
    }
    await app.close();
  });

  it("passes a valid event_type_limit through to the port verbatim", async () => {
    const seen: { eventTypeLimit: number }[] = [];
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
      deadLetterReadPort: fakeDeadLetterPort(metric(), (q) => seen.push(q)),
    });
    await inject(app.fastify, { method: "GET", url: `${URL}?event_type_limit=3` });
    expect(seen).toEqual([{ eventTypeLimit: 3 }]);
    await app.close();
  });

  it("is a closed route: an unsigned call is refused before any measurement", async () => {
    const seen: { eventTypeLimit: number }[] = [];
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
      deadLetterReadPort: fakeDeadLetterPort(metric(), (q) => seen.push(q)),
    });
    const response = await app.fastify.inject({ method: "GET", url: URL });
    expect(response.statusCode).toBeGreaterThanOrEqual(401);
    expect(seen).toEqual([]);
    await app.close();
  });

  it("requires its OWN scope — a products-only caller cannot read the ledger", async () => {
    const app = buildEnforcedApp({
      searchReadPort: { async search() { return { items: [], total: 0, page: 1, page_size: 20 }; } },
      deadLetterReadPort: fakeDeadLetterPort(metric()),
    });
    const response = await app.fastify.inject({
      method: "GET",
      url: URL,
      headers: signFor("GET", URL, { scopes: ["search:products:read"] }),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
