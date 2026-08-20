/**
 * `ChannelPort` implementation for Telegram — the single way out (ADR-007 §2).
 *
 * One instance per bot, because a bot *is* its token: the customer bot must not
 * be able to send through the driver bot, and the presence (Mini App + link
 * template) it renders buttons with belongs to that same bot. The composition
 * root in MR 4 builds one adapter per configured bot.
 *
 * `send` never throws and never leaks Telegram vocabulary: every outcome is a
 * `ChannelSendResult` carrying a `CHANNEL_*` code, which is what allows the core
 * to own retry policy while knowing nothing about the channel (ADR-007 rule 7).
 */

import {
  ChannelError,
  type ChannelDispatch,
  type ChannelSendResult,
  type ClockPort,
  type BotPresence,
} from "@wasla/channel-core";
import { IMPLEMENTED_CHANNEL, type BotKind, type ChannelName } from "@wasla/contracts-channel";

import { readMessageRef } from "./api-shapes.js";
import { BotApiClient, type BotApiClientOptions } from "./bot-api-client.js";
import { mapTelegramFailure } from "./error-mapping.js";
import { buildInlineKeyboard, type InlineKeyboardMarkup } from "./keyboard.js";
import { TokenBucketRateLimiter, type RateLimitOptions } from "./rate-limit.js";

/** Bot API method used for every outbound message in Phase 03. */
const SEND_METHOD = "sendMessage";

export interface TelegramChannelAdapterOptions {
  readonly bot: BotKind;
  readonly presence: BotPresence;
  readonly clock: ClockPort;
  readonly api?: BotApiClient;
  readonly apiOptions?: BotApiClientOptions;
  readonly rateLimit?: RateLimitOptions;
  /** Pre-built limiter, when several adapters must share one budget. */
  readonly rateLimiter?: TokenBucketRateLimiter;
  /** Suppresses Telegram's own link previews; noisy in operational messages. */
  readonly disableLinkPreview?: boolean;
}

interface SendPayload {
  readonly chat_id: string;
  readonly text: string;
  readonly reply_markup?: InlineKeyboardMarkup;
  readonly link_preview_options?: { readonly is_disabled: true };
}

export class TelegramChannelAdapter {
  readonly channel: ChannelName = IMPLEMENTED_CHANNEL;
  readonly bot: BotKind;

  private readonly presence: BotPresence;
  private readonly api: BotApiClient;
  private readonly limiter: TokenBucketRateLimiter;
  private readonly disableLinkPreview: boolean;

  constructor(options: TelegramChannelAdapterOptions) {
    if (options.presence.bot !== options.bot) {
      throw new Error("presence belongs to a different bot");
    }
    this.bot = options.bot;
    this.presence = options.presence;
    this.api =
      options.api ??
      new BotApiClient(
        options.apiOptions ??
          (() => {
            throw new Error("api or apiOptions is required");
          })(),
      );
    this.limiter = options.rateLimiter ?? new TokenBucketRateLimiter(options.clock, options.rateLimit);
    this.disableLinkPreview = options.disableLinkPreview ?? true;
  }

  /**
   * Builds the Bot API payload from a dispatch the core already validated.
   *
   * Only button rendering can still fail here, because it depends on
   * configuration the core cannot see (Mini App address, link template).
   */
  private buildPayload(dispatch: ChannelDispatch): SendPayload {
    const markup =
      dispatch.kind === "text_with_buttons"
        ? buildInlineKeyboard(dispatch.buttons ?? [], this.presence, dispatch.chatRef)
        : undefined;
    return {
      chat_id: dispatch.chatRef,
      text: dispatch.text,
      ...(markup ? { reply_markup: markup } : {}),
      ...(this.disableLinkPreview ? { link_preview_options: { is_disabled: true as const } } : {}),
    };
  }

  async send(dispatch: ChannelDispatch): Promise<ChannelSendResult> {
    if (dispatch.channel !== this.channel) {
      return { ok: false, errorCode: "CHANNEL_INVALID_MESSAGE" };
    }

    let payload: SendPayload;
    try {
      payload = this.buildPayload(dispatch);
    } catch (error) {
      // A ChannelError here is a configuration or contract problem, already
      // classified; anything else is ours and must not be reported as the
      // channel's fault.
      if (error instanceof ChannelError) {
        return { ok: false, errorCode: error.code };
      }
      return { ok: false, errorCode: "CHANNEL_INTERNAL_ERROR" };
    }

    // Throttle before spending a call: a 429 is charged against the bot and
    // repeated bursts lengthen the cooldown Telegram imposes.
    const verdict = this.limiter.take(dispatch.chatRef);
    if (!verdict.allowed) {
      return {
        ok: false,
        errorCode: "CHANNEL_RATE_LIMITED",
        retryAfterSeconds: verdict.retryAfterSeconds,
      };
    }

    const outcome = await this.api.call(SEND_METHOD, payload);

    if (!outcome.transportFailed && outcome.envelope.ok) {
      const messageRef = readMessageRef(outcome.envelope.result);
      return { ok: true, ...(messageRef ? { messageRef } : {}) };
    }

    const failure = mapTelegramFailure({
      ...(outcome.transportFailed ? { transportFailed: true } : { status: outcome.status }),
      ...(outcome.transportFailed
        ? {}
        : {
            ...(outcome.envelope.description ? { description: outcome.envelope.description } : {}),
            ...(outcome.envelope.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: outcome.envelope.retryAfterSeconds }
              : {}),
          }),
    });

    // Telegram's cooldown outranks our local estimate, so record it before the
    // core asks for the next attempt.
    if (failure.errorCode === "CHANNEL_RATE_LIMITED" && failure.retryAfterSeconds !== undefined) {
      this.limiter.penalise(dispatch.chatRef, failure.retryAfterSeconds);
    }

    return { ok: false, ...failure };
  }
}
