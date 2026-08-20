/**
 * `UpdateParserPort` implementation for Telegram (ADR-007 rule 2 and rule 8).
 *
 * Contract of this file: raw webhook body in, neutral `InboundUpdate` out. It is
 * the only translation from Telegram vocabulary into WASLA vocabulary on the
 * inbound side.
 *
 * Two deliberate behaviours:
 *
 * 1. Structural garbage (not an object, no `update_id`) throws
 *    `CHANNEL_INVALID_UPDATE` — the request is malformed, there is nothing to
 *    record and the bot answers 400.
 * 2. A well-formed update of a kind this phase does not handle is *not* an
 *    error here: it is returned as `kind: "unsupported"`. Rejecting it is the
 *    core's decision (`CHANNEL_UNSUPPORTED_UPDATE`), which keeps the policy in
 *    one place and lets the core stay the only component that decides what is
 *    processed.
 */

import {
  LIMITS,
  channelError,
  type InboundActor,
  type InboundUpdate,
} from "@wasla/channel-core";
import {
  IMPLEMENTED_CHANNEL,
  type BotKind,
  type ChannelName,
  type InboundUpdateKind,
} from "@wasla/contracts-channel";

import {
  GROUP_CHAT_TYPES,
  GROUP_EVENT_FIELDS,
  isObject,
  readArray,
  readIdentifier,
  readObject,
  readString,
  type RawObject,
} from "./api-shapes.js";
import { cleanLanguageCode, cleanLine, cleanText } from "./sanitize.js";

/** Marker Telegram commands start with. */
const COMMAND_PREFIX = "/";

/** Caps applied to normalised actor fields before the core sees them. */
const ACTOR_LIMITS = { displayNameMax: 120, refMax: LIMITS.chatRefMax } as const;

/** Update fields that carry a message-like payload, in resolution order. */
const MESSAGE_FIELDS: readonly string[] = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
] as const;

function invalidUpdate(reason: string, details?: Record<string, string | number>): never {
  throw channelError("CHANNEL_INVALID_UPDATE", `تحديث غير صالح: ${reason}`, { details });
}

/**
 * Splits `/start ABC@bot` into its command and argument.
 *
 * The `@botusername` suffix is stripped because Telegram appends it whenever a
 * command is issued in a group — keeping it would make the same command look
 * like a different one depending on where it was typed.
 */
function parseCommand(text: string): { command: string; argument?: string } {
  const [head, ...rest] = text.slice(COMMAND_PREFIX.length).split(/\s+/);
  const command = (head ?? "").split("@")[0]?.toLowerCase() ?? "";
  const argument = rest.join(" ").trim();
  return argument.length > 0 ? { command, argument } : { command };
}

function readActor(source: RawObject | undefined): InboundActor | undefined {
  if (!source) return undefined;
  const from = readObject(source, "from");
  if (!from) return undefined;
  const channelUserRef = readIdentifier(from, "id");
  if (!channelUserRef || channelUserRef.length > ACTOR_LIMITS.refMax) return undefined;

  const first = cleanLine(from["first_name"], ACTOR_LIMITS.displayNameMax);
  const last = cleanLine(from["last_name"], ACTOR_LIMITS.displayNameMax);
  const username = cleanLine(from["username"], ACTOR_LIMITS.displayNameMax);
  const displayName =
    cleanLine([first, last].filter(Boolean).join(" "), ACTOR_LIMITS.displayNameMax) ?? username;

  return {
    channelUserRef,
    ...(displayName ? { displayName } : {}),
    ...(cleanLanguageCode(from["language_code"])
      ? { languageCode: cleanLanguageCode(from["language_code"]) as string }
      : {}),
  };
}

function readChat(container: RawObject): { chatRef: string; isGroup: boolean } {
  const chat = readObject(container, "chat");
  if (!chat) invalidUpdate("لا توجد محادثة في التحديث");
  const chatRef = readIdentifier(chat, "id");
  if (!chatRef) invalidUpdate("معرّف المحادثة مفقود");
  if (chatRef.length > LIMITS.chatRefMax) {
    invalidUpdate("معرّف المحادثة يتجاوز الحد", { max: LIMITS.chatRefMax });
  }
  const type = readString(chat, "type") ?? "";
  return { chatRef, isGroup: GROUP_CHAT_TYPES.includes(type) };
}

/** Does this message carry a membership/service event rather than content? */
function isGroupEvent(message: RawObject): boolean {
  return GROUP_EVENT_FIELDS.some((field) => message[field] !== undefined);
}

/**
 * Turns a contact or a location into text.
 *
 * The neutral update has no typed slot for either (the core does not need one in
 * Phase 03): the *kind* carries the meaning and the text carries a compact,
 * already-sanitised summary. Structured contact and location columns are an
 * explicit deferral, listed in the adapter document.
 */
function describeContact(contact: RawObject): string | undefined {
  const phone = cleanLine(contact["phone_number"], 32);
  const name = cleanLine(
    [contact["first_name"], contact["last_name"]].filter((part) => typeof part === "string").join(" "),
    ACTOR_LIMITS.displayNameMax,
  );
  return cleanLine([name, phone].filter(Boolean).join(" · "), LIMITS.textMax);
}

function describeLocation(location: RawObject): string | undefined {
  const latitude = location["latitude"];
  const longitude = location["longitude"];
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return `${latitude},${longitude}`;
}

interface Resolved {
  readonly kind: InboundUpdateKind;
  readonly chatRef: string;
  readonly isGroup: boolean;
  readonly actor?: InboundActor;
  readonly command?: string;
  readonly commandArgument?: string;
  readonly text?: string;
  readonly callbackData?: string;
}

function resolveCallback(callback: RawObject): Resolved {
  const message = readObject(callback, "message");
  if (!message) invalidUpdate("استجابة زر بلا رسالة أصل");
  const { chatRef, isGroup } = readChat(message);
  const callbackData = cleanLine(callback["data"], LIMITS.textMax);
  if (!callbackData) invalidUpdate("استجابة زر بلا بيانات");
  return {
    kind: "callback",
    chatRef,
    isGroup,
    callbackData,
    ...(readActor(callback) ? { actor: readActor(callback) as InboundActor } : {}),
  };
}

function resolveMessage(message: RawObject): Resolved {
  const { chatRef, isGroup } = readChat(message);
  const actor = readActor(message);
  const base = { chatRef, isGroup, ...(actor ? { actor } : {}) };

  if (isGroupEvent(message)) {
    const joined = readArray(message, "new_chat_members")?.length;
    return {
      ...base,
      kind: "group_event",
      ...(joined !== undefined ? { text: `joined:${joined}` } : {}),
    };
  }

  const contact = readObject(message, "contact");
  if (contact) {
    const described = describeContact(contact);
    return { ...base, kind: "contact", ...(described ? { text: described } : {}) };
  }

  const location = readObject(message, "location");
  if (location) {
    const described = describeLocation(location);
    if (!described) return { ...base, kind: "unsupported" };
    return { ...base, kind: "location", text: described };
  }

  const text = cleanText(message["text"], LIMITS.textMax);
  if (!text) return { ...base, kind: "unsupported" };

  if (text.startsWith(COMMAND_PREFIX)) {
    const { command, argument } = parseCommand(text);
    if (command.length === 0) return { ...base, kind: "unsupported", text };
    return {
      ...base,
      kind: "command",
      command,
      ...(argument ? { commandArgument: argument } : {}),
      text,
    };
  }

  return { ...base, kind: "text_message", text };
}

/**
 * Telegram implementation of `UpdateParserPort`.
 *
 * Stateless and free of I/O, so the bot can construct one per process and the
 * tests can assert parsing without any transport in the picture.
 */
export class TelegramUpdateParser {
  readonly channel: ChannelName = IMPLEMENTED_CHANNEL;

  parse(raw: unknown, bot: BotKind): InboundUpdate {
    if (!isObject(raw)) invalidUpdate("الجسم ليس كائن JSON");
    const channelUpdateId = readIdentifier(raw, "update_id");
    if (!channelUpdateId) invalidUpdate("معرّف التحديث مفقود");

    const callback = readObject(raw, "callback_query");
    const messageField = MESSAGE_FIELDS.find((field) => isObject(raw[field]));

    let resolved: Resolved;
    if (callback) {
      resolved = resolveCallback(callback);
    } else if (messageField) {
      resolved = resolveMessage(raw[messageField] as RawObject);
    } else {
      // A well-formed update we do not handle yet (poll, shipping query, …).
      // It has no chat we can answer in, so the neutral update carries an empty
      // chat reference and the core rejects it as unsupported.
      resolved = { kind: "unsupported", chatRef: "", isGroup: false };
    }

    return {
      channel: this.channel,
      bot,
      channelUpdateId,
      chatRef: resolved.chatRef,
      kind: resolved.kind,
      ...(resolved.command ? { command: resolved.command } : {}),
      ...(resolved.commandArgument ? { commandArgument: resolved.commandArgument } : {}),
      ...(resolved.text ? { text: resolved.text } : {}),
      ...(resolved.callbackData ? { callbackData: resolved.callbackData } : {}),
      ...(resolved.actor ? { actor: resolved.actor } : {}),
      ...(resolved.isGroup ? { isGroup: true } : {}),
    };
  }
}
