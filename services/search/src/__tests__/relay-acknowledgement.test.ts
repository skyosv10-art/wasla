/**
 * اختباراتُ وحدةٍ لمحضرِ الإقرارِ: التطبيعُ والتركيبُ والقرارُ النقيُّ، ثمَّ
 * المسارُ بمنفذٍ وهميٍّ (فجوةُ `G5` · موجةُ **المحضرِ** · `CLM-0249`).
 *
 * والحدودُ **لا تُكتَبُ أرقاماً** في أيِّ توقُّعٍ: تُقرأُ من الثوابتِ المنشورةِ،
 * فاختبارٌ يُثبِّتُ `12` نصّاً كانَ سيبقى أخضرَ لو خُفِّضَ الحدُّ إلى حرفٍ واحدٍ —
 * أي لو صارَ «سببُ الإقرارِ» كلمةً بلا معنىً في دفترِ مسؤوليّةٍ.
 */

import { describe, expect, it } from "vitest";

import {
  SEARCH_ACKNOWLEDGEMENT_REASON_MAX_LENGTH,
  SEARCH_ACKNOWLEDGEMENT_REASON_MIN_LENGTH,
  SEARCH_ACKNOWLEDGER_MAX_LENGTH,
  composeSearchAcknowledger,
  decideSearchAcknowledgement,
  normalizeSearchAcknowledgementReason,
} from "../domain/relay-acknowledgement.js";
import type { SearchRelayAcknowledgementPort } from "../ports.js";
import { buildEnforcedApp, inject, signFor } from "./service-identity-support.js";

const OUTBOX_ID = "11111111-2222-4333-8444-555555555555";
const URL = `/search/relay/dead-letters/marketplace/${OUTBOX_ID}/acknowledgement`;
const REASON = "مقبولٌ بقرارِ مالكٍ: المنتجُ حُذِفَ من المصدرِ ولا وجهةَ لتطبيقِهِ";

const fakeSearchPort = {
  async search() {
    return { items: [], total: 0, page: 1, page_size: 20 };
  },
};

type AckCommand = Parameters<SearchRelayAcknowledgementPort["acknowledgePoisonedEvent"]>[0];

function fakeAckPort(
  decision: Awaited<ReturnType<SearchRelayAcknowledgementPort["acknowledgePoisonedEvent"]>>,
  capture?: (cmd: AckCommand) => void,
): SearchRelayAcknowledgementPort {
  return {
    async acknowledgePoisonedEvent(cmd) {
      capture?.(cmd);
      return decision;
    },
  };
}

describe("search acknowledgement reason (G5 · the record)", () => {
  it("rejects a missing, non-string, too-short or too-long reason — each with its own cause", () => {
    expect(normalizeSearchAcknowledgementReason(undefined)).toEqual({
      reason: "rejected",
      because: "missing",
    });
    expect(normalizeSearchAcknowledgementReason(7)).toEqual({
      reason: "rejected",
      because: "not_a_string",
    });
    expect(
      normalizeSearchAcknowledgementReason("x".repeat(SEARCH_ACKNOWLEDGEMENT_REASON_MIN_LENGTH - 1)),
    ).toEqual({ reason: "rejected", because: "too_short" });
    expect(
      normalizeSearchAcknowledgementReason("x".repeat(SEARCH_ACKNOWLEDGEMENT_REASON_MAX_LENGTH + 1)),
    ).toEqual({ reason: "rejected", because: "too_long" });
  });

  it("measures length AFTER trimming — whitespace is not a reason", () => {
    /*
     * ولمَ بعدَ التقليمِ؟ لأنَّ اثنتَي عشرةَ مسافةً كانت ستمرُّ حدَّ الطولِ
     * وتُكتَبُ في دفترِ المسؤوليّةِ سبباً — وهيَ **لا سببَ**.
     */
    const spaces = " ".repeat(SEARCH_ACKNOWLEDGEMENT_REASON_MIN_LENGTH + 4);
    expect(normalizeSearchAcknowledgementReason(spaces)).toEqual({
      reason: "rejected",
      because: "too_short",
    });
    const padded = `   ${REASON}   `;
    expect(normalizeSearchAcknowledgementReason(padded)).toEqual({
      reason: "accepted",
      value: REASON,
    });
  });
});

describe("search acknowledger composition (G5 · the record)", () => {
  it("composes from the proven identity — and carries the human when there is one", () => {
    expect(composeSearchAcknowledger({ serviceName: "search-ingress" })).toEqual({
      acknowledger: "composed",
      value: "service:search-ingress",
    });
    expect(
      composeSearchAcknowledger({ serviceName: "search-ingress", onBehalfOfPublicId: "usr_42" }),
    ).toEqual({
      acknowledger: "composed",
      value: "service:search-ingress/on-behalf-of:usr_42",
    });
  });

  it("rejects an empty service name and an over-long composition instead of truncating", () => {
    /*
     * والقصُّ الصامتُ هوَ العطبُ المقصودُ هنا: اسمٌ مقصوصٌ في دفترِ مسؤوليّةٍ
     * يُقرأُ **مُقِرّاً آخرَ**، والرفضُ الصريحُ يُرى في السجلِّ ويُصلَحُ.
     */
    expect(composeSearchAcknowledger({ serviceName: "   " })).toEqual({
      acknowledger: "rejected",
      because: "empty_service_name",
    });
    expect(
      composeSearchAcknowledger({ serviceName: "s".repeat(SEARCH_ACKNOWLEDGER_MAX_LENGTH + 1) }),
    ).toEqual({ acknowledger: "rejected", because: "too_long" });
  });
});

describe("search acknowledgement decision (G5 · the record)", () => {
  it("separates three answers an operator must tell apart", () => {
    expect(
      decideSearchAcknowledgement({
        status: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementReason: null,
      }),
    ).toEqual({ outcome: "rejected", reason: "not_found", observedStatus: null });

    expect(
      decideSearchAcknowledgement({
        status: "applied",
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementReason: null,
      }),
    ).toEqual({ outcome: "rejected", reason: "not_poisoned", observedStatus: "applied" });

    expect(
      decideSearchAcknowledgement({
        status: "poisoned",
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementReason: null,
      }),
    ).toEqual({ outcome: "acknowledged" });
  });

  it("an existing acknowledgement is returned as-is — never overwritten", () => {
    const decision = decideSearchAcknowledgement({
      status: "poisoned",
      acknowledgedAt: "2026-09-01T00:00:00.000Z",
      acknowledgedBy: "service:ops-console/on-behalf-of:usr_7",
      acknowledgementReason: REASON,
    });
    expect(decision).toEqual({
      outcome: "already_acknowledged",
      acknowledgedAt: "2026-09-01T00:00:00.000Z",
      acknowledgedBy: "service:ops-console/on-behalf-of:usr_7",
      acknowledgementReason: REASON,
    });
  });
});

describe("POST /search/relay/dead-letters/:ledger/:outboxId/acknowledgement", () => {
  it("returns 200 with the acknowledgement triple and says the row is STILL counted", async () => {
    const at = new Date("2026-09-20T12:00:00.000Z");
    let seen: AckCommand | undefined;
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: fakeAckPort({ outcome: "acknowledged" }, (cmd) => {
        seen = cmd;
      }),
      now: () => at,
    });

    const response = await inject(app.fastify, {
      method: "POST",
      url: URL,
      payload: { reason: REASON },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      outcome: "acknowledged",
      ledger: "marketplace",
      outbox_id: OUTBOX_ID,
      still_counted_in_total_poisoned: true,
      excluded_from_severity: true,
      evidence_preserved: ["status", "attempt_count", "last_error", "consumed_at"],
      acknowledgement: {
        acknowledged_at: at.toISOString(),
        acknowledged_by: "service:search-ingress",
        reason: REASON,
      },
      gates_readiness: false,
    });
    expect(seen).toEqual({
      ledger: "marketplace",
      outboxId: OUTBOX_ID,
      acknowledgedBy: "service:search-ingress",
      reason: REASON,
      acknowledgedAt: at,
    });
    await app.close();
  });

  it("takes the acknowledger from the PROVEN identity and refuses a body that claims one", async () => {
    /*
     * وهذا هوَ عمودُ الموجةِ: لو قُرِئَ `acknowledged_by` من الجسمِ لصارَ دفترُ
     * المسؤوليّةِ حقلاً يكتبُهُ مَن أرادَ، فيُقِرُّ أحدٌ باسمِ غيرِهِ. والرفضُ
     * صريحٌ لا إهمالٌ صامتٌ: المُنادي يجبُ أن يعلمَ أنَّ حقلَهُ لم يُكتَبْ.
     */
    let called = 0;
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: {
        async acknowledgePoisonedEvent() {
          called += 1;
          return { outcome: "acknowledged" };
        },
      },
    });

    const spoofed = await inject(app.fastify, {
      method: "POST",
      url: URL,
      payload: { reason: REASON, acknowledged_by: "service:someone-else" },
    });
    expect(spoofed.statusCode).toBe(400);
    expect((spoofed.json() as { code: string }).code).toBe(
      "SEARCH_RELAY_ACKNOWLEDGEMENT_BODY_INVALID",
    );
    expect(called).toBe(0);

    // واسمُ الخدمةِ الموقِّعةِ هوَ ما يُكتَبُ — يُقاسُ بتغييرِ الموقِّعِ.
    const other = await app.fastify.inject({
      method: "POST",
      url: URL,
      payload: { reason: REASON },
      headers: signFor("POST", URL, { serviceName: "ops-console" }),
    });
    expect(other.statusCode).toBe(200);
    expect((other.json() as { acknowledgement: { acknowledged_by: string } }).acknowledgement
      .acknowledged_by).toBe("service:ops-console");
    await app.close();
  });

  it("rejects a bad reason with 400 before the port is touched", async () => {
    let called = 0;
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: {
        async acknowledgePoisonedEvent() {
          called += 1;
          return { outcome: "acknowledged" };
        },
      },
    });

    for (const payload of [{}, { reason: "قصيرٌ" }, { reason: 9 }]) {
      const response = await inject(app.fastify, { method: "POST", url: URL, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(called).toBe(0);
    await app.close();
  });

  it("maps not_found to 404 and not_poisoned to 409 — with the observed status in the message", async () => {
    const missing = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: fakeAckPort({
        outcome: "rejected",
        reason: "not_found",
        observedStatus: null,
      }),
    });
    const notFound = await inject(missing.fastify, {
      method: "POST",
      url: URL,
      payload: { reason: REASON },
    });
    expect(notFound.statusCode).toBe(404);
    expect((notFound.json() as { code: string }).code).toBe("SEARCH_RELAY_DEAD_LETTER_NOT_FOUND");
    await missing.close();

    const applied = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: fakeAckPort({
        outcome: "rejected",
        reason: "not_poisoned",
        observedStatus: "applied",
      }),
    });
    const conflict = await inject(applied.fastify, {
      method: "POST",
      url: URL,
      payload: { reason: REASON },
    });
    expect(conflict.statusCode).toBe(409);
    const body = conflict.json() as { code: string; message: string };
    expect(body.code).toBe("SEARCH_RELAY_DEAD_LETTER_NOT_POISONED");
    expect(body.message).toContain("applied");
    await applied.close();
  });

  it("a second call answers 200 already_acknowledged carrying the FIRST record, not 409", async () => {
    /*
     * ولا 409: المُنادي لم يُخطِئْ والحالةُ التي أرادَها قائمةٌ. والجوابُ يحمِلُ
     * إقرارَ الأوّلِ فيرى الثاني اسمَ مَن سبقَهُ ولا يظنُّ الواقعةَ لهُ.
     */
    const first = {
      acknowledgedAt: "2026-09-01T00:00:00.000Z",
      acknowledgedBy: "service:ops-console/on-behalf-of:usr_7",
      acknowledgementReason: REASON,
    };
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: fakeAckPort({ outcome: "already_acknowledged", ...first }),
    });
    const response = await inject(app.fastify, {
      method: "POST",
      url: URL,
      payload: { reason: "سببٌ ثانٍ مختلفٌ تماماً عن الأوّلِ" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      outcome: string;
      acknowledgement: { acknowledged_at: string; acknowledged_by: string; reason: string };
    };
    expect(body.outcome).toBe("already_acknowledged");
    expect(body.acknowledgement).toEqual({
      acknowledged_at: first.acknowledgedAt,
      acknowledged_by: first.acknowledgedBy,
      reason: first.acknowledgementReason,
    });
    await app.close();
  });

  it("rejects an unknown ledger and a malformed id with 400 — before the port is touched", async () => {
    let called = 0;
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: {
        async acknowledgePoisonedEvent() {
          called += 1;
          return { outcome: "acknowledged" };
        },
      },
    });

    const badLedger = await inject(app.fastify, {
      method: "POST",
      url: `/search/relay/dead-letters/delivery/${OUTBOX_ID}/acknowledgement`,
      payload: { reason: REASON },
    });
    expect(badLedger.statusCode).toBe(400);
    expect((badLedger.json() as { code: string }).code).toBe("SEARCH_RELAY_LEDGER_UNKNOWN");

    const badId = await inject(app.fastify, {
      method: "POST",
      url: "/search/relay/dead-letters/marketplace/not-a-uuid/acknowledgement",
      payload: { reason: REASON },
    });
    expect(badId.statusCode).toBe(400);
    expect((badId.json() as { code: string }).code).toBe("SEARCH_RELAY_OUTBOX_ID_INVALID");
    expect(called).toBe(0);
    await app.close();
  });

  it("answers 503 — never silent success — when no acknowledgement port is wired", async () => {
    const app = buildEnforcedApp({ searchReadPort: fakeSearchPort });
    const response = await inject(app.fastify, {
      method: "POST",
      url: URL,
      payload: { reason: REASON },
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { code: string }).code).toBe("SEARCH_INTERNAL_ERROR");
    await app.close();
  });

  it("refuses an unsigned call and a call signed without the acknowledge scope", async () => {
    /*
     * والصلاحيّةُ **رابعةٌ مستقلّةٌ**: رمزٌ يملكُ صلاحيّةَ الإعادةِ وحدَها لا
     * يُقِرُّ — وإلّا كانت لوحةُ إنقاذٍ تملكُ إسكاتَ ما لا تُصلِحُهُ.
     */
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayAcknowledgementPort: fakeAckPort({ outcome: "acknowledged" }),
    });

    const unsigned = await app.fastify.inject({
      method: "POST",
      url: URL,
      payload: { reason: REASON },
    });
    expect(unsigned.statusCode).toBe(401);

    const wrongScope = await app.fastify.inject({
      method: "POST",
      url: URL,
      payload: { reason: REASON },
      headers: signFor("POST", URL, { scopes: ["search:relay-dead-letters:requeue"] }),
    });
    expect(wrongScope.statusCode).toBe(403);
    await app.close();
  });
});
