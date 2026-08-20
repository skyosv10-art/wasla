/**
 * The *only* description of Telegram Bot API wire shapes in the repository.
 *
 * Deliberately partial: it declares the handful of fields WASLA reads, not the
 * full Bot API surface. ADR-007 §3 rejected a bot library precisely so that this
 * vocabulary stays small, auditable and confined to this package.
 *
 * Nothing here is exported from the package root as a domain type — these are
 * transport shapes. They die at the parser boundary and are replaced by the
 * neutral `InboundUpdate` of the core.
 *
 * Every reader below treats the payload as untrusted input (ADR-007 rule 8):
 * shapes are validated structurally, never cast.
 */

/** A JSON object of unknown content — the safe starting point for a webhook body. */
export type RawObject = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readObject(source: RawObject, key: string): RawObject | undefined {
  const value = source[key];
  return isObject(value) ? value : undefined;
}

export function readString(source: RawObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads a channel-side identifier as a string.
 *
 * Telegram sends numeric ids that exceed the safe integer range for channels and
 * some supergroups, so the whole system treats them as opaque strings from the
 * first read (`ChatRef` is a string in the core). Accepting a numeric JSON value
 * and stringifying it here is the single conversion point.
 */
export function readIdentifier(source: RawObject, key: string): string | undefined {
  const value = source[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function readArray(source: RawObject, key: string): readonly unknown[] | undefined {
  const value = source[key];
  return Array.isArray(value) ? value : undefined;
}

/** Telegram chat types that WASLA treats as a group conversation (ADR-007 rule 9). */
export const GROUP_CHAT_TYPES: readonly string[] = ["group", "supergroup"] as const;

/** Message fields whose presence marks a service (membership) event in a group. */
export const GROUP_EVENT_FIELDS: readonly string[] = [
  "new_chat_members",
  "left_chat_member",
  "group_chat_created",
  "supergroup_chat_created",
  "migrate_to_chat_id",
] as const;

/** Envelope every Bot API method answers with. */
export interface BotApiEnvelope {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
  readonly errorCode?: number;
  readonly retryAfterSeconds?: number;
}

/**
 * Reads a Bot API response envelope defensively.
 *
 * A proxy or an outage can answer with HTML or an empty body; that must surface
 * as a transport failure, never as a crash inside the adapter.
 */
export function readEnvelope(body: unknown): BotApiEnvelope {
  if (!isObject(body)) return { ok: false };
  const parameters = readObject(body, "parameters");
  const retryAfter = parameters?.["retry_after"];
  const errorCode = body["error_code"];
  return {
    ok: body["ok"] === true,
    result: body["result"],
    description: readString(body, "description"),
    errorCode: typeof errorCode === "number" ? errorCode : undefined,
    retryAfterSeconds:
      typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0
        ? Math.ceil(retryAfter)
        : undefined,
  };
}

/** Extracts the channel-side message reference from a `sendMessage` result. */
export function readMessageRef(result: unknown): string | undefined {
  if (!isObject(result)) return undefined;
  return readIdentifier(result, "message_id");
}
