/**
 * Chat: sequence, limits, locale, refusal on a closed thread, and redaction.
 *
 * The redaction test is the one worth reading twice. It asserts that the row SURVIVES
 * with an emptied body — because deleting a message loses the sequence and makes «he told
 * me X» unexaminable in both directions, which protects nobody.
 */

import { describe, expect, it } from "vitest";

import { cancelThread } from "../use-cases/cancel-thread.js";
import { postMessage } from "../use-cases/post-message.js";
import { readNegotiation } from "../use-cases/read-negotiation.js";
import { expectCode, key, withOpenThread } from "./helpers.js";

describe("postMessage", () => {
  it("numbers messages per thread, gap-free", async () => {
    const { deps, thread } = await withOpenThread();
    const first = await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "أين أنت الآن؟" },
      { idempotencyKey: key("m") },
    );
    const second = await postMessage(
      deps,
      thread.id,
      { author_role: "driver", body: "على بعد خمس دقائق" },
      { idempotencyKey: key("m") },
    );

    expect(first.message.sequenceNo).toBe(1);
    expect(second.message.sequenceNo).toBe(2);
    // The sequence is what makes «in this order» answerable without trusting clocks on
    // two different phones.
    expect((await deps.messages.list(thread.id)).map((m) => m.sequenceNo)).toEqual([1, 2]);
  });

  it("stores the source locale and never a translation", async () => {
    const { deps, thread } = await withOpenThread();
    const { message } = await postMessage(
      deps,
      thread.id,
      { author_role: "driver", body: "میں پانچ منٹ میں پہنچ رہا ہوں", source_locale: "ur" },
      { idempotencyKey: key("m") },
    );
    expect(message.sourceLocale).toBe("ur");
    // A stored translation is a second version of what someone said that can be quoted
    // back at him, and it goes stale the moment the engine improves.
    expect(Object.keys(message)).not.toContain("translatedBody");
  });

  it("refuses an unsupported locale", async () => {
    const { deps, thread } = await withOpenThread();
    await expectCode(
      postMessage(
        deps,
        thread.id,
        { author_role: "driver", body: "bonjour", source_locale: "fr" },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_LOCALE_UNSUPPORTED",
    );
  });

  it("refuses an over-long body with the policy limit in the error", async () => {
    const { deps, thread } = await withOpenThread();
    const error = await expectCode(
      postMessage(
        deps,
        thread.id,
        { author_role: "driver", body: "ا".repeat(1001) },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_MESSAGE_TOO_LONG",
    );
    // The limit that refuses the message is the same number the bot showed while it was
    // being typed.
    expect(error.details?.expected).toBe("<= 1000");
  });

  it("refuses an empty body rather than storing an invisible bubble", async () => {
    const { deps, thread } = await withOpenThread();
    await expectCode(
      postMessage(deps, thread.id, { author_role: "driver", body: "   " }, { idempotencyKey: key() }),
      "NEGOTIATION_VALIDATION_FAILED",
    );
  });

  it("refuses a caller claiming to be the system", async () => {
    const { deps, thread } = await withOpenThread();
    // Platform notices are the one authorship a user must be able to trust.
    await expectCode(
      postMessage(
        deps,
        thread.id,
        { author_role: "system", body: "تم إلغاء الطلب" },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_VALIDATION_FAILED",
    );
  });

  it("enforces the per-thread message cap", async () => {
    const { deps, thread } = await withOpenThread();
    for (let index = 0; index < 100; index += 1) {
      await postMessage(
        deps,
        thread.id,
        { author_role: index % 2 === 0 ? "customer" : "driver", body: `رسالة ${index}` },
        { idempotencyKey: key("m") },
      );
    }
    const error = await expectCode(
      postMessage(
        deps,
        thread.id,
        { author_role: "customer", body: "واحدة أخرى" },
        { idempotencyKey: key() },
      ),
      "NEGOTIATION_MESSAGE_LIMIT_REACHED",
    );
    expect(error.details?.expected).toBe("<= 100");
  });

  it("refuses a message on a closed thread instead of accepting it silently", async () => {
    const { deps, thread } = await withOpenThread();
    await cancelThread(
      deps,
      thread.id,
      { reason_code: "order_withdrawn" },
      { idempotencyKey: key("c") },
    );
    // A message nobody will answer, accepted with a 2xx, is the worst option: the sender
    // believes he was heard.
    await expectCode(
      postMessage(deps, thread.id, { author_role: "driver", body: "هل تسمعني؟" }, { idempotencyKey: key() }),
      "NEGOTIATION_THREAD_CLOSED",
    );
  });

  it("replays an identical send instead of adding a second bubble", async () => {
    const { deps, thread } = await withOpenThread();
    const shared = key("m-replay");
    const first = await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "شكراً" },
      { idempotencyKey: shared },
    );
    const second = await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "شكراً" },
      { idempotencyKey: shared },
    );

    expect(second.replay).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(await deps.messages.count(thread.id)).toBe(1);
    expect(deps.outbox.ofType("negotiations.message_posted")).toHaveLength(1);
  });

  it("keeps the row on redaction and empties only the text", async () => {
    const { deps, thread } = await withOpenThread();
    const { message } = await postMessage(
      deps,
      thread.id,
      { author_role: "customer", body: "رقمي 0500000000" },
      { idempotencyKey: key("m") },
    );
    await postMessage(
      deps,
      thread.id,
      { author_role: "driver", body: "تم" },
      { idempotencyKey: key("m") },
    );

    const redacted = await deps.messages.redact(thread.id, message.id, "pii_phone", "2026-08-23T00:05:00.000Z");
    expect(redacted.body).toBeNull();
    expect(redacted.redactedAt).toBe("2026-08-23T00:05:00.000Z");
    expect(redacted.redactionReasonCode).toBe("pii_phone");
    // The sequence is intact: message 2 is still message 2, and «what was said between
    // them» remains examinable even though the text is gone.
    const view = await readNegotiation(deps, thread.id);
    expect(view.messages.map((m) => m.sequenceNo)).toEqual([1, 2]);
    expect(view.messages[0]?.body).toBeNull();
  });
});
