/**
 * `POST /negotiations/{threadId}/messages` — say something.
 *
 * ## Chat is content; the event stream is not (ADR-013 decision 6)
 *
 * The body is stored. The emitted `message_posted` carries `body_length` and never
 * the text — see `events.messagePosted`, and the privacy test that reads every
 * payload key against `NEGOTIATION_EVENT_FORBIDDEN_FIELDS`. An amount DOES cross into
 * events, because a price is the negotiation's subject and cannot be audited without
 * it; a sentence between two people is not.
 *
 * ## Messages are refused on a closed thread
 *
 * Not stored-and-hidden, not queued. A message nobody will ever answer, accepted with
 * a `2xx`, is the worst of the options: the sender believes he was heard. The route
 * answers `THREAD_CLOSED` and the client can say so.
 *
 * ## `source_locale`, not a translation (ADR-013 decision 7)
 *
 * The language the text was written in is stored; the translated text is not. A stored
 * translation is a second version of what someone said that can be quoted back at
 * him, and it goes stale the moment the engine improves. Rendering is the reader's
 * side of the problem.
 */

import { messageTooLong, threadNotFound } from "../domain/errors.js";
import type { NegotiationMessage, NegotiationThread } from "../domain/model.js";
import { requireUsablePolicy } from "../domain/policy.js";
import { assertThreadOpen, partyOf } from "../domain/state-machine.js";
import {
  assertLocale,
  assertMessageBody,
  assertParty,
  assertRoundNo,
  assertUuid,
} from "../domain/validation.js";
import type { NegotiationDependencies } from "../ports.js";
import { assertThreadNotExpired } from "./expiry-core.js";
import { appendMessage, guardIdempotency, type WriteOptions } from "./shared.js";

export interface PostMessageInput {
  readonly author_role: unknown;
  readonly body: unknown;
  readonly round_no?: unknown;
  readonly source_locale?: unknown;
}

export interface PostMessageResult {
  readonly thread: NegotiationThread;
  readonly message: NegotiationMessage;
  readonly replay: boolean;
}

export async function postMessage(
  deps: NegotiationDependencies,
  threadId: unknown,
  input: PostMessageInput,
  options: WriteOptions = {},
): Promise<PostMessageResult> {
  const id = assertUuid(threadId, "threadId");
  // Only a party may post through this route. `system` messages exist in the table and
  // are written by the service itself; accepting `system` from a caller would let a
  // client forge platform notices, which is the one authorship a user must be able to
  // trust.
  const authorRole = assertParty(input.author_role, "author_role");
  const sourceLocale = assertLocale(input.source_locale ?? "ar");
  const roundNo = input.round_no === undefined || input.round_no === null ? null : assertRoundNo(input.round_no);

  const thread = await deps.threads.find(id);
  if (thread === null) throw threadNotFound();
  assertThreadOpen(thread);
  // The role must be one this thread actually has. Without it, «customer» on a thread
  // could be posted by anyone holding the id.
  if (partyOf(thread, authorRole === "customer" ? thread.customerPublicId : thread.driverPublicId) === null) {
    throw threadNotFound();
  }

  const policy = requireUsablePolicy(
    await deps.policies.find(thread.policyVersion),
    thread.policyVersion,
  );
  if (typeof input.body === "string" && input.body.trim().length > policy.maxMessageLength) {
    // A distinct code carrying the limit, checked before the generic body validator so
    // the client can show «1000 characters max» instead of «invalid body».
    throw messageTooLong(policy.maxMessageLength);
  }
  const body = assertMessageBody(input.body, policy.maxMessageLength);

  // Guard before the time check, as in `accept-round`: a send whose response was lost must
  // recognise its own retry rather than be judged again against a clock that has moved.
  const guard = await guardIdempotency(deps, "post_message", options.idempotencyKey, {
    threadId: id,
    authorRole,
    body,
    roundNo,
    sourceLocale,
  });
  if (guard === "replay") {
    // Matched on author and text: a retried send must not become a second bubble in
    // the conversation.
    const existing = (await deps.messages.list(id)).find(
      (message) => message.authorRole === authorRole && message.body === body,
    );
    if (existing !== undefined) return { thread, message: existing, replay: true };
  }

  const at = deps.clock.now();
  await assertThreadNotExpired(deps, thread, at, options);

  const message = await appendMessage(deps, thread, policy, {
    authorRole,
    body,
    roundNo,
    sourceLocale,
    at,
    traceId: options.traceId,
  });
  return { thread, message, replay: false };
}
