/**
 * اختباراتُ وحدةٍ ليدِ الإعادةِ: القرارُ النقيُّ، ثمَّ المسارُ بمنفذٍ وهميٍّ
 * (فجوةُ `G5` · موجةُ **اليدِ** · `CLM-0248`).
 *
 * والحالةُ الهدفُ **لا تُكتَبُ حرفاً** في أيِّ توقُّعٍ هنا: تُقرأُ من الثابتِ
 * المنشورِ `SEARCH_REQUEUE_TARGET_STATUS`، فاختبارٌ يُثبِّتُ `"pending"` نصّاً
 * كانَ سيبقى أخضرَ لو تغيَّرَ الثابتُ إلى حالةٍ نهائيّةٍ — أي لو انقلبَ المسارُ
 * إلى ما **لا يُعيدُ** شيئاً.
 */

import { describe, expect, it } from "vitest";

import {
  SEARCH_REQUEUE_TARGET_STATUS,
  decideSearchRequeue,
} from "../domain/relay-requeue.js";
import type { SearchRelayRequeuePort } from "../ports.js";
import { buildEnforcedApp, inject, signFor } from "./service-identity-support.js";

const OUTBOX_ID = "11111111-2222-4333-8444-555555555555";
const URL = `/search/relay/dead-letters/marketplace/${OUTBOX_ID}/requeue`;

const fakeSearchPort = {
  async search() {
    return { items: [], total: 0, page: 1, page_size: 20 };
  },
};

function fakeRequeuePort(
  decision: Awaited<ReturnType<SearchRelayRequeuePort["requeuePoisonedEvent"]>>,
  capture?: (cmd: { ledger: string; outboxId: string }) => void,
): SearchRelayRequeuePort {
  return {
    async requeuePoisonedEvent(cmd) {
      capture?.(cmd);
      return decision;
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * 1) القرارُ — نقيٌّ بلا قاعدةٍ ولا حدٍّ
 * ════════════════════════════════════════════════════════════════════════ */

describe("search requeue decision (G5 · the hand)", () => {
  it("targets the only non-terminal status — so the relay actually retries it", () => {
    /*
     * هذا الاختبارُ هوَ الذي يحمي **جوهرَ** الموجةِ: `isTerminal` في `relay.ts`
     * هيَ `status !== "pending"`، فرفعٌ إلى أيِّ حالةٍ أخرى كانَ يُنتِجُ مساراً
     * يقولُ «أُعيدَ» ثمَّ يُقصِّرُ المُرحِّلُ الصفَّ في الخطوةِ 1 بلا محاولةٍ.
     */
    expect(SEARCH_REQUEUE_TARGET_STATUS).toBe("pending");
  });

  it("an absent row is rejected as not_found — not a silent success", () => {
    expect(decideSearchRequeue(null)).toEqual({
      outcome: "rejected",
      reason: "not_found",
      observedStatus: null,
    });
  });

  it("distinguishes «no row» from «row that is not poisoned», and publishes what it read", () => {
    // الفرقُ هوَ سببُ وجودِ دالّةٍ نقيّةٍ أصلاً: عددُ الصفوفِ المُعدَّلةِ يطويهما
    // في صفرٍ واحدٍ، فيقرأُ المُشغِّلُ مُعرِّفَهُ خطأً وهوَ صحيحٌ.
    for (const status of ["applied", "pending", "ignored", "skipped_stale", "skipped"]) {
      expect(decideSearchRequeue(status)).toEqual({
        outcome: "rejected",
        reason: "not_poisoned",
        observedStatus: status,
      });
    }
  });

  it("only a poisoned row is requeued, and the previous status is published", () => {
    expect(decideSearchRequeue("poisoned")).toEqual({
      outcome: "requeued",
      previousStatus: "poisoned",
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 2) المسارُ على الحدِّ
 * ════════════════════════════════════════════════════════════════════════ */

describe("POST /search/relay/dead-letters/:ledger/:outboxId/requeue (G5)", () => {
  it("accepts with 202 and publishes the rewind cost and the preserved evidence", async () => {
    const seen: { ledger: string; outboxId: string }[] = [];
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayRequeuePort: fakeRequeuePort(
        { outcome: "requeued", previousStatus: "poisoned" },
        (cmd) => seen.push(cmd),
      ),
    });

    const response = await inject(app.fastify, { method: "POST", url: URL });
    /*
     * 202 لا 200: ما تمَّ هوَ الإعادةُ إلى الطابورِ، والتطبيقُ في دورةٍ لاحقةٍ.
     * و200 كانَ يُقرأُ «عولِجَ» فيُغلِقُ المُشغِّلُ الحادثةَ.
     */
    expect(response.statusCode).toBe(202);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      outcome: "requeued",
      ledger: "marketplace",
      outbox_id: OUTBOX_ID,
      previous_status: "poisoned",
      new_status: SEARCH_REQUEUE_TARGET_STATUS,
      checkpoint_rewound: true,
      rewind_method: "checkpoint_row_deleted",
      // الكلفةُ منشورةٌ في الجسمِ لا في وثيقةٍ وحدَها.
      rewind_cost: "full_rescan_from_zero",
      // مُعلِمٌ لا حاكمٌ: حدثٌ فاسدٌ واحدٌ لا يصيرُ بوّابةَ نشرٍ.
      gates_readiness: false,
    });
    // والدليلُ لا يُمحى — والعقدُ يُسمِّي الحقولَ الثلاثةَ بعينِها.
    expect(body["evidence_preserved"]).toEqual(["attempt_count", "last_error", "consumed_at"]);
    expect(seen).toEqual([{ ledger: "marketplace", outboxId: OUTBOX_ID }]);
    await app.close();
  });

  it("404 for an unknown row — and 409 naming the observed status for a row that is not poisoned", async () => {
    const missing = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayRequeuePort: fakeRequeuePort({
        outcome: "rejected",
        reason: "not_found",
        observedStatus: null,
      }),
    });
    const notFound = await inject(missing.fastify, { method: "POST", url: URL });
    expect(notFound.statusCode).toBe(404);
    expect((notFound.json() as { code: string }).code).toBe("SEARCH_RELAY_DEAD_LETTER_NOT_FOUND");
    await missing.close();

    const applied = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayRequeuePort: fakeRequeuePort({
        outcome: "rejected",
        reason: "not_poisoned",
        observedStatus: "applied",
      }),
    });
    const conflict = await inject(applied.fastify, { method: "POST", url: URL });
    expect(conflict.statusCode).toBe(409);
    const conflictBody = conflict.json() as { code: string; message: string };
    expect(conflictBody.code).toBe("SEARCH_RELAY_DEAD_LETTER_NOT_POISONED");
    /*
     * الحالةُ المقروءةُ **في الرسالةِ** لا في حقلٍ رابعٍ: عقدُ الخطأِ ثلاثةُ
     * حقولٍ، فحقلٌ إضافيٌّ كانَ يمرُّ في اختبارٍ ولا يصلُ السلكَ.
     */
    expect(conflictBody.message).toContain("applied");
    await applied.close();
  });

  it("a second call on the same row conflicts — the route needs no idempotency key", async () => {
    /*
     * التماثُليّةُ طبيعيّةٌ لا مُصطنَعةٌ: النداءُ الثاني يجدُ الصفَّ `pending`
     * فيُرَدُّ 409، فلا أثرَ يُضاعَفُ — ومفتاحُ تماثُليّةٍ هنا آلةٌ بلا عملٍ
     * وسجلٌّ ثانٍ يُصانُ بلا مُقابِلٍ.
     */
    let calls = 0;
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayRequeuePort: {
        async requeuePoisonedEvent() {
          calls += 1;
          return calls === 1
            ? { outcome: "requeued", previousStatus: "poisoned" }
            : { outcome: "rejected", reason: "not_poisoned", observedStatus: "pending" };
        },
      },
    });
    expect((await inject(app.fastify, { method: "POST", url: URL })).statusCode).toBe(202);
    const second = await inject(app.fastify, { method: "POST", url: URL });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { message: string }).message).toContain("pending");
    await app.close();
  });

  it("rejects an unknown ledger and a malformed id with 400 — before the port is touched", async () => {
    /*
     * ولمَ 400 لا 503؟ `$1::uuid` على نصٍّ مُشوَّهٍ يرفعُ `22P02` فيُترجَمُ 503 —
     * أي **حكمٌ كاذبٌ على الخدمةِ** بسببِ خطأِ منادٍ. والرفضُ قبلَ المنفذِ
     * مُثبَتٌ بأنَّ المنفذَ لم يُنادَ.
     */
    let called = 0;
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayRequeuePort: {
        async requeuePoisonedEvent() {
          called += 1;
          return { outcome: "requeued", previousStatus: "poisoned" };
        },
      },
    });

    const badLedger = await inject(app.fastify, {
      method: "POST",
      url: `/search/relay/dead-letters/dispatch/${OUTBOX_ID}/requeue`,
    });
    expect(badLedger.statusCode).toBe(400);
    expect((badLedger.json() as { code: string }).code).toBe("SEARCH_RELAY_LEDGER_UNKNOWN");

    const badId = await inject(app.fastify, {
      method: "POST",
      url: "/search/relay/dead-letters/marketplace/not-a-uuid/requeue",
    });
    expect(badId.statusCode).toBe(400);
    expect((badId.json() as { code: string }).code).toBe("SEARCH_RELAY_OUTBOX_ID_INVALID");

    expect(called).toBe(0);
    await app.close();
  });

  it("answers 503 when no port is wired — never a success it did not perform", async () => {
    const app = buildEnforcedApp({ searchReadPort: fakeSearchPort });
    const response = await inject(app.fastify, { method: "POST", url: URL });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { code: string }).code).toBe("SEARCH_INTERNAL_ERROR");
    await app.close();
  });

  it("demands its own scope — the dead-letter READ scope does not buy a hand", async () => {
    /*
     * الصلاحيّةُ ثالثةٌ مستقلّةٌ: لوحةُ مراقبةٍ تقرأُ الدفترَ لا تملكُ أن
     * تُرجِعَ نقطةَ تقدُّمِ مُرحِّلٍ فتُحدِثَ مسحاً من الصفرِ.
     */
    const app = buildEnforcedApp({
      searchReadPort: fakeSearchPort,
      relayRequeuePort: fakeRequeuePort({ outcome: "requeued", previousStatus: "poisoned" }),
    });
    const response = await inject(app.fastify, {
      method: "POST",
      url: URL,
      headers: signFor("POST", URL, { scopes: ["search:relay-dead-letters:read"] }),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
