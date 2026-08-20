/**
 * Stateless deep-link payload codec (ADR-007 rule 6).
 *
 * The payload is base64url-encoded and hard-capped at
 * `DEEP_LINK_MAX_PAYLOAD_LENGTH` characters — a channel-imposed limit published
 * in the API contract. Exceeding it is a contract error
 * (`CHANNEL_DEEP_LINK_TOO_LONG`), never a silent truncation.
 *
 * Stateless on purpose: no token table, so any instance can decode a link it
 * did not issue. Opaque/expiring tokens (`channel_deep_link_tokens`) are an
 * explicit deferral in schema.sql.
 *
 * Wire format before encoding: `action` optionally followed by `?k=v&k=v`,
 * with keys and values percent-encoded. It is compact (the 64-char budget is
 * tight) and unambiguous.
 */

import { DEEP_LINK_MAX_PAYLOAD_LENGTH, type DeepLinkAction } from "@wasla/contracts-channel";

import { channelError } from "./errors.js";
import { LIMITS, type DecodedDeepLink } from "./model.js";

/** Deep-link actions supported by the contract, in declaration order. */
export const DEEP_LINK_ACTIONS: readonly DeepLinkAction[] = [
  "open_app",
  "track_order",
  "join_support",
  "verify_partner",
] as const;

/** Is this string one of the contract's deep-link actions? */
export function isDeepLinkAction(value: string): value is DeepLinkAction {
  return (DEEP_LINK_ACTIONS as readonly string[]).includes(value);
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

/**
 * Encode an action + params into a deep-link payload.
 *
 * @throws ChannelError `CHANNEL_INVALID_DEEP_LINK` for an unknown action, a
 *         non-string param or more params than the contract allows.
 * @throws ChannelError `CHANNEL_DEEP_LINK_TOO_LONG` when the encoded payload
 *         exceeds the channel limit.
 */
export function encodeDeepLinkPayload(
  action: DeepLinkAction,
  params: Readonly<Record<string, string>> = {},
): string {
  if (!isDeepLinkAction(action)) {
    throw channelError("CHANNEL_INVALID_DEEP_LINK", "غير مدعوم: فعل رابط عميق خارج العقد", {
      details: { action },
    });
  }

  const entries = Object.entries(params);
  if (entries.length > LIMITS.deepLinkParamsMax) {
    throw channelError(
      "CHANNEL_INVALID_DEEP_LINK",
      `عدد معاملات الرابط العميق يتجاوز الحد (${LIMITS.deepLinkParamsMax})`,
      { details: { received: entries.length } },
    );
  }
  for (const [key, value] of entries) {
    if (typeof value !== "string" || key.length === 0) {
      throw channelError(
        "CHANNEL_INVALID_DEEP_LINK",
        "معاملات الرابط العميق يجب أن تكون أزواج نصية",
        { details: { key } },
      );
    }
  }

  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const payload = toBase64Url(query.length === 0 ? action : `${action}?${query}`);

  if (payload.length > DEEP_LINK_MAX_PAYLOAD_LENGTH) {
    throw channelError(
      "CHANNEL_DEEP_LINK_TOO_LONG",
      `حمولة الرابط العميق ${payload.length} حرفاً وتتجاوز حد القناة (${DEEP_LINK_MAX_PAYLOAD_LENGTH})`,
      { details: { length: payload.length, limit: DEEP_LINK_MAX_PAYLOAD_LENGTH } },
    );
  }
  return payload;
}

/**
 * Decode a payload received back from the channel (e.g. on a start command).
 *
 * Input is untrusted (ADR-007 rule 8): anything unparsable or carrying an
 * unknown action is rejected with `CHANNEL_INVALID_DEEP_LINK`.
 */
export function decodeDeepLinkPayload(payload: string): DecodedDeepLink {
  if (payload.length === 0 || payload.length > DEEP_LINK_MAX_PAYLOAD_LENGTH) {
    throw channelError("CHANNEL_INVALID_DEEP_LINK", "حمولة رابط عميق بطول غير مقبول", {
      details: { length: payload.length },
    });
  }

  let decoded: string;
  try {
    decoded = fromBase64Url(payload);
  } catch (cause) {
    throw channelError("CHANNEL_INVALID_DEEP_LINK", "تعذّر فك ترميز حمولة الرابط العميق", {
      cause,
    });
  }

  const separator = decoded.indexOf("?");
  const action = separator === -1 ? decoded : decoded.slice(0, separator);
  if (!isDeepLinkAction(action)) {
    throw channelError("CHANNEL_INVALID_DEEP_LINK", "فعل رابط عميق غير معروف", {
      details: { action },
    });
  }

  const params: Record<string, string> = {};
  if (separator !== -1) {
    for (const pair of decoded.slice(separator + 1).split("&")) {
      if (pair.length === 0) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        throw channelError("CHANNEL_INVALID_DEEP_LINK", "معامل رابط عميق غير صالح", {
          details: { pair },
        });
      }
      params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  }

  return { action, params };
}
