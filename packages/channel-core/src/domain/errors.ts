/**
 * Typed channel-layer error.
 *
 * The catalogue itself is NOT re-declared here: code → class → retryable comes
 * from `@wasla/contracts-channel` (`CHANNEL_ERRORS`), which is drift-guarded
 * against `contracts/errors.md`. One catalogue, one place to change.
 *
 * `WaslaError` (@wasla/errors) stays the shared base so logging and error
 * boundaries behave identically across services.
 */

import { WaslaError } from "@wasla/errors";
import {
  CHANNEL_ERRORS,
  statusForChannelError,
  type ChannelErrorClass,
  type ChannelErrorCode,
} from "@wasla/contracts-channel";

/** Extra, non-sensitive context attached to an error for the HTTP boundary. */
export type ChannelErrorDetails = Readonly<Record<string, string | number | boolean>>;

export interface ChannelErrorOptions {
  readonly message: string;
  readonly details?: ChannelErrorDetails;
  readonly cause?: unknown;
  readonly traceId?: string;
  /** Channel-supplied cooldown (seconds) for rate-limited failures. */
  readonly retryAfterSeconds?: number;
}

/**
 * A failure expressed in the stable channel vocabulary.
 *
 * Adapters translate channel-native failures into these codes, so the core (and
 * anything above it) never sees a channel-specific error string (ADR-007 rule 7).
 */
export class ChannelError extends WaslaError {
  override readonly code: ChannelErrorCode;
  readonly class: ChannelErrorClass;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: ChannelErrorDetails;
  readonly retryAfterSeconds?: number;

  constructor(code: ChannelErrorCode, options: ChannelErrorOptions) {
    super({
      code,
      message: options.message,
      cause: options.cause,
      traceId: options.traceId,
    });
    this.code = code;
    this.class = CHANNEL_ERRORS[code].class;
    this.status = statusForChannelError(code);
    this.retryable = CHANNEL_ERRORS[code].retryable;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** Serialisable, log-safe representation (no channel payloads, no secrets). */
  override toJSON(): {
    code: ChannelErrorCode;
    message: string;
    class: ChannelErrorClass;
    status: number;
    retryable: boolean;
    traceId?: string;
    details?: ChannelErrorDetails;
  } {
    return {
      code: this.code,
      message: this.message,
      class: this.class,
      status: this.status,
      retryable: this.retryable,
      traceId: this.traceId,
      details: this.details,
    };
  }
}

/** Convenience constructor: `channelError("CHANNEL_INVALID_MESSAGE", "…")`. */
export function channelError(
  code: ChannelErrorCode,
  message: string,
  options: Omit<ChannelErrorOptions, "message"> = {},
): ChannelError {
  return new ChannelError(code, { message, ...options });
}

/** Type guard for error boundaries. */
export function isChannelError(value: unknown): value is ChannelError {
  return value instanceof ChannelError;
}
