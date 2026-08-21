/**
 * The Fastify surface of a bot — the five endpoints of
 * `packages/channel-core/contracts/api.openapi.yml`, wired to the core's use
 * cases.
 *
 * Routes:
 *   POST /channel/:bot/webhook      receive one update, exactly once → 202
 *   POST /channel/messages          the single outbound exit point    → 202
 *   GET  /channel/:bot/mini-app     which Mini App this bot opens
 *   POST /channel/:bot/deep-links   a shareable link into this bot
 *   GET  /health                    liveness (ok | degraded)
 *
 * This factory is shared by the three bot roots on purpose. The webhook is the
 * only unauthenticated entry point WASLA exposes, and its secret check is the
 * whole of its authentication (ADR-007 rule 1): triplicating that check would
 * mean three places where it can silently rot. What differs between bots —
 * token, presence, Mini App, copy — is *injected*, so the roots stay thin
 * (ADR-007 §1) while the security-critical path exists once and is tested once.
 *
 * The app never touches `process.env`; the bot root reads configuration and
 * hands over ready-made dependencies, which is what makes `app.inject` tests
 * possible without any environment at all.
 */

import Fastify, { type FastifyInstance } from "fastify";

import {
  START_COMMAND,
  channelError,
  createDeepLink,
  getMiniAppLaunch,
  isChannelError,
  receiveUpdate,
  sendMessage,
  type ButtonIntent,
  type GroupRole,
  type InboundDeps,
  type LaunchDeps,
  type OutboundDeps,
  type OutboundMessageCommand,
} from "@wasla/channel-core";
import {
  IMPLEMENTED_CHANNEL,
  type BotKind,
  type ChannelErrorCode,
  type DeepLinkAction,
  type DeepLinkResponse,
  type DeliveryAccepted,
  type MiniAppKind,
  type MiniAppLaunch,
  type UpdateAccepted,
} from "@wasla/contracts-channel";
import { assertWebhookSecret } from "@wasla/telegram-adapter";

import {
  buildConversationReply,
  type ConversationEvent,
  type ConversationHandler,
  type ConversationIdentity,
} from "../conversation.js";
import { buildGroupStartReply, buildStartReply } from "../welcome.js";

import { sendChannelError } from "./errors.js";

/** Every dependency the routes need, assembled by the bot root. */
export interface BotAppDeps {
  /** The one bot this process serves. */
  readonly bot: BotKind;
  readonly inbound: InboundDeps;
  readonly outbound: OutboundDeps;
  readonly launch: LaunchDeps;
}

export interface CreateBotAppOptions {
  readonly deps: BotAppDeps;
  /**
   * Expected webhook secret. Deliberately allowed to be `undefined` so a
   * misconfigured deployment fails *closed*: `assertWebhookSecret` rejects a
   * missing secret instead of treating authentication as disabled.
   */
  readonly webhookSecret: string | undefined;
  /** Overrides the default Arabic `/start` copy. */
  readonly welcomeText?: string;
  /** Overrides the default Arabic group `/start` copy (all roles). */
  readonly groupWelcomeText?: string;
  /**
   * False when this bot has no deep-link template, so the group reply is text
   * only. The root knows this from configuration; the app never reads the
   * environment itself.
   */
  readonly groupLinkAvailable?: boolean;
  /**
   * A domain flow for this bot, attached by the composition root.
   *
   * Absent for a bot that only launches its Mini App (Phase 03 behaviour). When
   * present it is called for every accepted update of a conversation this
   * deployment may answer, *after* the built-in `/start` reply — see
   * `runConversation` for why its failures are logged rather than propagated.
   */
  readonly onConversation?: ConversationHandler;
  /** Reported by `GET /health`; a root may degrade itself (e.g. no identity). */
  readonly health?: () => "ok" | "degraded";
  /** Fastify's pino logger. Off by default so tests stay quiet. */
  readonly logger?: boolean;
}

/** Reject a path parameter that is not the bot this process serves. */
function assertServedBot(raw: string, served: BotKind): BotKind {
  if (raw !== served) {
    throw channelError("CHANNEL_UNKNOWN_BOT", "هذا البوت لا يُخدَم من هذه العملية", {
      details: { requested: raw },
    });
  }
  return served;
}

function asObject(raw: unknown, message: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw channelError("CHANNEL_INVALID_MESSAGE", message);
  }
  return raw as Record<string, unknown>;
}

function readStringMap(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const object = asObject(raw, "params يجب أن يكون كائناً من نصوص");
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value !== "string") {
      throw channelError("CHANNEL_INVALID_DEEP_LINK", "قيم params يجب أن تكون نصوصاً", {
        details: { key },
      });
    }
    params[key] = value;
  }
  return params;
}

/** Contract button (snake_case) → neutral button intent (camelCase). */
function readButton(raw: unknown): ButtonIntent {
  const button = asObject(raw, "زر غير صالح");
  const label = button.label;
  if (typeof label !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "زر بلا عنوان نصّي");
  }

  if (button.type === "mini_app") {
    const miniApp = button.mini_app;
    if (typeof miniApp !== "string") {
      throw channelError("CHANNEL_INVALID_MESSAGE", "زر Mini App بلا mini_app");
    }
    const path = button.path;
    if (path !== undefined && typeof path !== "string") {
      throw channelError("CHANNEL_INVALID_MESSAGE", "مسار Mini App يجب أن يكون نصاً");
    }
    return {
      type: "mini_app",
      label,
      miniApp: miniApp as MiniAppKind,
      ...(path === undefined ? {} : { path }),
    };
  }

  if (button.type === "deep_link") {
    const action = button.action;
    if (typeof action !== "string") {
      throw channelError("CHANNEL_INVALID_MESSAGE", "زر رابط عميق بلا action");
    }
    const params = readStringMap(button.params);
    return {
      type: "deep_link",
      label,
      action: action as DeepLinkAction,
      ...(params === undefined ? {} : { params }),
    };
  }

  throw channelError("CHANNEL_INVALID_MESSAGE", "نوع زر غير معروف", {
    details: { type: String(button.type) },
  });
}

/**
 * Contract `OutboundMessage` → the core's `OutboundMessageCommand`.
 *
 * Only the *shape* is checked here (types, presence of required fields). Every
 * limit — text length, button count, idempotency key length, channel match — is
 * the use case's, so the same rule cannot be enforced differently by an HTTP
 * caller and by an in-process one.
 */
export function readOutboundMessage(raw: unknown): OutboundMessageCommand {
  const body = asObject(raw, "جسم الطلب يجب أن يكون كائن JSON");

  const channel = body.channel;
  const chatRef = body.chat_ref;
  const kind = body.kind;
  const text = body.text;
  const idempotencyKey = body.idempotency_key;

  if (typeof channel !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "channel مطلوب");
  }
  if (typeof chatRef !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "chat_ref مطلوب");
  }
  if (kind !== "text" && kind !== "text_with_buttons") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "kind يجب أن يكون text أو text_with_buttons");
  }
  if (typeof text !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "text مطلوب");
  }
  if (typeof idempotencyKey !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "idempotency_key مطلوب");
  }

  const rawButtons = body.buttons;
  let buttons: ButtonIntent[] | undefined;
  if (rawButtons !== undefined && rawButtons !== null) {
    if (!Array.isArray(rawButtons)) {
      throw channelError("CHANNEL_INVALID_MESSAGE", "buttons يجب أن يكون مصفوفة");
    }
    buttons = rawButtons.map(readButton);
  }

  const priority = body.priority;
  if (priority !== undefined && typeof priority !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "priority يجب أن يكون نصاً");
  }
  const traceId = body.trace_id;
  if (traceId !== undefined && typeof traceId !== "string") {
    throw channelError("CHANNEL_INVALID_MESSAGE", "trace_id يجب أن يكون نصاً");
  }

  return {
    channel: channel as OutboundMessageCommand["channel"],
    chatRef,
    kind,
    text,
    ...(buttons === undefined ? {} : { buttons }),
    ...(priority === undefined
      ? {}
      : { priority: priority as OutboundMessageCommand["priority"] }),
    idempotencyKey,
    ...(traceId === undefined ? {} : { traceId }),
  };
}

/** Read the `action` of a deep-link request. */
function readDeepLinkRequest(raw: unknown): {
  action: DeepLinkAction;
  params?: Record<string, string>;
} {
  const body = asObject(raw, "جسم الطلب يجب أن يكون كائن JSON");
  const action = body.action;
  if (typeof action !== "string") {
    throw channelError("CHANNEL_INVALID_DEEP_LINK", "action مطلوب");
  }
  const params = readStringMap(body.params);
  return { action: action as DeepLinkAction, ...(params === undefined ? {} : { params }) };
}

/** Build a bot's HTTP app without listening (the `app.inject` seam). */
export function createBotApp(options: CreateBotAppOptions): FastifyInstance {
  const { deps } = options;
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error, _request, reply) => {
    sendChannelError(reply, error);
  });

  // GET /health — liveness. `channel` is reported so an operator can tell which
  // channel implementation a process is running (ADR-007: the channel is a value).
  app.get("/health", async (_request, reply) => {
    const status = options.health?.() ?? "ok";
    return reply.status(200).send({ status, channel: IMPLEMENTED_CHANNEL });
  });

  // POST /channel/:bot/webhook
  //
  // Order is the contract's and is not negotiable:
  //   1. secret verification — before parsing, before any state change;
  //   2. the served bot;
  //   3. the use case, which owns de-duplication and identity bootstrap.
  // A duplicate is a 202 with `status: "duplicate"`, never an error: Telegram
  // retries on any non-2xx, so answering 4xx to a replay would guarantee more
  // replays.
  app.post("/channel/:bot/webhook", async (request, reply) => {
    assertWebhookSecret(request.headers, options.webhookSecret);

    const { bot: rawBot } = request.params as { bot: string };
    const bot = assertServedBot(rawBot, deps.bot);

    const result = await receiveUpdate(deps.inbound, {
      bot,
      raw: request.body,
      traceId: request.id,
    });

    // Who gets answered, and with what, is decided by the core's reply policy —
    // this root only obeys it. A group we do not operate is recorded and left in
    // silence: the response is still 202, because the update *was* received and a
    // non-2xx would only make Telegram send it again.
    if (result.status === "accepted" && result.command === START_COMMAND && result.replyAllowed) {
      if (result.scope === "group") {
        await answerGroupStart(
          app,
          options,
          result.chatRef,
          result.channelUpdateId,
          result.groupRole ?? "support",
          request.id,
        );
      } else {
        await answerStart(app, options, result.chatRef, result.channelUpdateId, request.id);
      }
    }

    // The domain flow, when the root attached one. It runs for accepted updates
    // only (a duplicate must not act twice) and only where a reply is allowed —
    // a room we do not operate gets no domain behaviour either.
    if (options.onConversation && result.status === "accepted" && result.replyAllowed) {
      await runConversation(app, options, result, request.id);
    }

    return reply.status(202).send({
      status: result.status,
      channel: result.channel,
      bot: result.bot,
      channel_update_id: result.channelUpdateId,
      kind: result.kind,
    } satisfies UpdateAccepted);
  });

  // POST /channel/messages — the single exit point. `failed` is not a contract
  // status: a message the channel permanently rejected is an error to the caller,
  // reported with the code the adapter produced.
  app.post("/channel/messages", async (request, reply) => {
    const message = readOutboundMessage(request.body);
    const outcome = await sendMessage(deps.outbound, { message, bot: deps.bot });

    if (outcome.status === "failed") {
      throw channelError(
        (outcome.errorCode ?? "CHANNEL_TRANSPORT_ERROR") as ChannelErrorCode,
        "تعذّر تسليم الرسالة عبر القناة",
        { details: { delivery_id: outcome.deliveryId, attempts: outcome.attempts } },
      );
    }

    return reply.status(202).send({
      delivery_id: outcome.deliveryId,
      status: outcome.status,
      channel: outcome.channel,
      chat_ref: outcome.chatRef,
      attempts: outcome.attempts,
    } satisfies DeliveryAccepted);
  });

  // GET /channel/:bot/mini-app — the Exit Gate's question, answered from
  // injected configuration only.
  app.get("/channel/:bot/mini-app", async (request, reply) => {
    const { bot: rawBot } = request.params as { bot: string };
    const bot = assertServedBot(rawBot, deps.bot);
    const launch = getMiniAppLaunch(deps.launch, bot);

    return reply.status(200).send({
      bot: launch.bot,
      mini_app: launch.miniApp,
      url: launch.url,
      label: launch.label,
    } satisfies MiniAppLaunch);
  });

  // POST /channel/:bot/deep-links
  app.post("/channel/:bot/deep-links", async (request, reply) => {
    const { bot: rawBot } = request.params as { bot: string };
    const bot = assertServedBot(rawBot, deps.bot);
    const { action, params } = readDeepLinkRequest(request.body);

    const link = createDeepLink(deps.launch, {
      bot,
      action,
      ...(params === undefined ? {} : { params }),
    });

    return reply.status(200).send({
      url: link.url,
      payload: link.payload,
      bot: link.bot,
      action: link.action,
    } satisfies DeepLinkResponse);
  });

  return app;
}

/**
 * Answer a fresh `/start` with the bot's Mini App button.
 *
 * Failures are logged, not propagated: the update has already been recorded as
 * processed, so answering the webhook with an error would only make Telegram
 * replay an update we would then reject as a duplicate — losing the reply *and*
 * spending the retry budget. A retryable send is already persisted as a `queued`
 * delivery and is picked up by `retryDueDeliveries`; a permanent failure (a
 * misconfigured Mini App) is a deployment fault that belongs in the log.
 */
async function answerStart(
  app: FastifyInstance,
  options: CreateBotAppOptions,
  chatRef: string,
  channelUpdateId: string,
  traceId: string,
): Promise<void> {
  const { deps } = options;
  try {
    const launch = getMiniAppLaunch(deps.launch, deps.bot);
    await sendMessage(deps.outbound, {
      bot: deps.bot,
      message: buildStartReply({
        bot: deps.bot,
        channel: deps.outbound.channel.channel,
        chatRef,
        channelUpdateId,
        launch,
        ...(options.welcomeText === undefined ? {} : { text: options.welcomeText }),
        traceId,
      }),
    });
  } catch (error) {
    app.log.error(
      {
        bot: deps.bot,
        trace_id: traceId,
        code: isChannelError(error) ? error.code : "CHANNEL_INTERNAL_ERROR",
      },
      "start reply could not be sent",
    );
  }
}

/**
 * Answer a fresh `/start` **inside a group** we operate.
 *
 * Same failure discipline as the private answer, and the same idempotency key, so
 * a replay cannot double-post into a room. The button is a deep link into the
 * private conversation; when this bot has no link template configured the reply
 * degrades to text rather than disappearing.
 */
async function answerGroupStart(
  app: FastifyInstance,
  options: CreateBotAppOptions,
  chatRef: string,
  channelUpdateId: string,
  role: GroupRole,
  traceId: string,
): Promise<void> {
  const { deps } = options;
  try {
    await sendMessage(deps.outbound, {
      bot: deps.bot,
      message: buildGroupStartReply({
        bot: deps.bot,
        channel: deps.outbound.channel.channel,
        chatRef,
        channelUpdateId,
        role,
        withLink: options.groupLinkAvailable ?? true,
        ...(options.groupWelcomeText === undefined ? {} : { text: options.groupWelcomeText }),
        traceId,
      }),
    });
  } catch (error) {
    app.log.error(
      {
        bot: deps.bot,
        trace_id: traceId,
        role,
        code: isChannelError(error) ? error.code : "CHANNEL_INTERNAL_ERROR",
      },
      "group start reply could not be sent",
    );
  }
}

/**
 * Run the root's domain flow for one update and deliver what it answered.
 *
 * Failures are logged, not propagated, for the same reason `answerStart` swallows
 * them: the update is already recorded as processed, so a non-2xx would make
 * Telegram replay an update we would then reject as a duplicate — losing the
 * reply *and* spending the retry budget. The webhook's contract is «received»,
 * not «acted upon»; what a flow could not do is an operational fact, and it
 * belongs in the log with its trace id.
 *
 * Identity is resolved lazily and at most once per update: `resolveIdentity`
 * caches the promise, so two flow branches asking for it cost one round-trip,
 * and a flow that never asks costs none.
 */
async function runConversation(
  app: FastifyInstance,
  options: CreateBotAppOptions,
  result: Awaited<ReturnType<typeof receiveUpdate>>,
  traceId: string,
): Promise<void> {
  const { deps } = options;
  const handler = options.onConversation;
  if (!handler) return;

  let identityPromise: Promise<ConversationIdentity> | undefined;
  const resolveIdentity = (): Promise<ConversationIdentity> => {
    if (result.identity) return Promise.resolve(result.identity);
    identityPromise ??= (async () => {
      const actor = result.actor;
      if (!actor) {
        throw channelError(
          "CHANNEL_IDENTITY_BOOTSTRAP_FAILED",
          "لا يمكن تحديد هوية المُرسل من هذا التحديث",
        );
      }
      return deps.inbound.identity.ensureIdentity({
        channel: result.channel,
        bot: deps.bot,
        actor,
        traceId,
      });
    })();
    return identityPromise;
  };

  const event: ConversationEvent = {
    bot: deps.bot,
    channel: result.channel,
    chatRef: result.chatRef,
    channelUpdateId: result.channelUpdateId,
    kind: result.kind,
    ...(result.command === undefined ? {} : { command: result.command }),
    scope: result.scope,
    ...(result.actor?.displayName === undefined
      ? {}
      : { displayName: result.actor.displayName }),
    ...(result.actor?.languageCode === undefined
      ? {}
      : { languageCode: result.actor.languageCode }),
    traceId,
    ...(result.identity === undefined ? {} : { identity: result.identity }),
    resolveIdentity,
  };

  try {
    const reply = await handler(event);
    if (!reply) return;

    const launch =
      reply.withMiniApp === true ? getMiniAppLaunch(deps.launch, deps.bot) : undefined;

    await sendMessage(deps.outbound, {
      bot: deps.bot,
      message: buildConversationReply({
        bot: deps.bot,
        channel: deps.outbound.channel.channel,
        chatRef: result.chatRef,
        channelUpdateId: result.channelUpdateId,
        reply,
        ...(launch === undefined ? {} : { launch }),
        traceId,
      }),
    });
  } catch (error) {
    app.log.error(
      {
        bot: deps.bot,
        trace_id: traceId,
        kind: result.kind,
        ...(result.command === undefined ? {} : { command: result.command }),
        code: isChannelError(error) ? error.code : "CHANNEL_INTERNAL_ERROR",
      },
      "conversation flow could not be completed",
    );
  }
}
