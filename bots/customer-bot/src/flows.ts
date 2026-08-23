/**
 * The customer bot's conversation flows — what the bot *does* beyond opening its
 * Mini App, expressed without a single reference to Telegram or to the Customer
 * Core's implementation.
 *
 * Scope is set by the product, not by what the API happens to allow:
 * «الـMini App هي مكان الخدمات الثقيلة؛ البوت للإطلاق، التنبيه، التوجيه،
 * الإجراءات الصغيرة» (docs/01-product/USER_FLOWS.md §1). So this file binds three
 * small actions and refuses to invent a fourth:
 *
 *   /start   → make sure a customer profile exists (bootstrap, answers nothing)
 *   /places  → read back the saved places
 *   /orders  → read back the recent order requests and their state
 *
 * **Creating an order is deliberately not here.** A valid request needs exactly
 * two stops, each with a zone and a source, a vehicle class and a price mode
 * (ADR-009 §4): collecting that through chat messages would be a new product
 * flow invented inside an engineering MR, and USER_FLOWS.md already places that
 * work in the Mini App (Phase 11). The bot therefore *points* at the app.
 *
 * Two rules keep this file honest:
 *
 *  1. **No validation.** Nothing here decides what a valid place, zone or
 *     identity is; it calls a use case and translates the error *code* it gets
 *     back. A rule enforced both in `domain/validation.ts` and here would be a
 *     rule that can disagree with itself.
 *  2. **No adapter.** It depends on `CustomerFlowsPort`, whose only production
 *     implementation calls the use cases in process (`customer-core.ts`). That is
 *     what lets the whole flow be tested with a fake in three lines, and what
 *     keeps a future out-of-process implementation a swap rather than a rewrite.
 */

import type {
  ConversationEvent,
  ConversationHandler,
  ConversationReply,
} from "@wasla/bot-runtime";

/** Commands this bot answers, beyond `start`. */
export const CUSTOMER_PLACES_COMMAND = "places";
export const CUSTOMER_ORDERS_COMMAND = "orders";
export const CUSTOMER_NEGOTIATIONS_COMMAND = "negotiations";
export const CUSTOMER_ACCEPT_COMMAND = "accept";
export const CUSTOMER_REJECT_COMMAND = "reject";

/** Everything the bot registers with the channel core when flows are wired. */
export const CUSTOMER_SUPPORTED_COMMANDS: readonly string[] = [
  "start",
  CUSTOMER_PLACES_COMMAND,
  CUSTOMER_ORDERS_COMMAND,
  CUSTOMER_NEGOTIATIONS_COMMAND,
  CUSTOMER_ACCEPT_COMMAND,
  CUSTOMER_REJECT_COMMAND,
] as const;

/** How many order requests one reply shows. Small on purpose: this is a chat. */
export const ORDERS_REPLY_LIMIT = 5;

/** A saved place, reduced to what a chat message can honestly show. */
export interface SavedPlaceView {
  readonly label: string;
  readonly addressText: string | null;
}

/** An order request, reduced to what a chat message can honestly show. */
export interface OrderRequestView {
  readonly status: "submitted" | "submission_failed";
  readonly orderType: "ride" | "delivery";
  /** Set by the order engine when it accepted the request; null otherwise. */
  readonly orderPublicId: string | null;
  /** Why intake failed, as an error code — never as a message. */
  readonly failureReasonCode: string | null;
  readonly createdAt: string;
}

/**
 * What the bot needs from the Customer Core, and nothing more.
 *
 * Deliberately narrower than the service: a chat surface that could submit an
 * order or delete a place would sooner or later be asked to, and the product
 * put those in the Mini App.
 */
export interface CustomerFlowsPort {
  /**
   * Make sure a customer profile exists for this identity.
   *
   * Must never overwrite a profile the person edited in the Mini App — see
   * `customer-core.ts` for how that is guaranteed.
   */
  ensureProfile(input: {
    readonly waslaPublicId: string;
    readonly displayName?: string;
    readonly languageCode?: string;
  }): Promise<{ readonly created: boolean }>;

  listSavedPlaces(input: {
    readonly waslaPublicId: string;
  }): Promise<readonly SavedPlaceView[]>;

  listRecentOrderRequests(input: {
    readonly waslaPublicId: string;
    readonly limit: number;
  }): Promise<readonly OrderRequestView[]>;
}

/**
 * A failure of the Customer Core, carried across the boundary as a *code*.
 *
 * The adapter throws this; the copy below turns the code into Arabic. Passing a
 * code instead of a message is what stops the bot from re-wording domain rules
 * (and from leaking an internal message to a user).
 */
export class CustomerFlowError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CustomerFlowError";
  }
}

/** Arabic copy per error code. Product language is Arabic-first. */
export const FLOW_ERROR_TEXT: Readonly<Record<string, string>> = {
  CUSTOMER_IDENTITY_NOT_FOUND:
    "لم نتعرّف على حسابك بعد. أرسل /start مرة أخرى لبدء المحادثة من جديد.",
  CUSTOMER_PROFILE_NOT_FOUND:
    "لا يوجد ملف عميل لك بعد. أرسل /start لإنشائه، ثم أعد المحاولة.",
  CUSTOMER_ZONE_NOT_FOUND: "المنطقة المرتبطة ببياناتك غير متاحة حالياً.",
  CUSTOMER_DEPENDENCY_UNAVAILABLE:
    "الخدمة غير متاحة مؤقتاً. أعد المحاولة بعد قليل.",
  CUSTOMER_NEGOTIATION_NOT_FOUND: "لم نعد نجد هذا التفاوض. افتح التطبيق لتحديث القائمة.",
  CUSTOMER_NEGOTIATION_ROUND_STALE: "تغيّر العرض قبل تنفيذ الإجراء. راجع التطبيق ثم أعد المحاولة.",
  CUSTOMER_NEGOTIATION_NOT_ACTIONABLE: "لم يعد العرض قابلاً للتنفيذ. راجع التطبيق لمعرفة حالته.",
};

/** What a user reads when the core failed with a code we have no copy for. */
export const FLOW_FALLBACK_ERROR_TEXT =
  "تعذّر إكمال الطلب الآن. أعد المحاولة بعد قليل.";

/** Arabic label per order request state (ADR-009 §5: only these two exist). */
export const ORDER_STATUS_TEXT: Readonly<Record<OrderRequestView["status"], string>> = {
  submitted: "تم الإرسال",
  submission_failed: "لم يصل للمحرّك",
};

/** Arabic label per order type. */
export const ORDER_TYPE_TEXT: Readonly<Record<OrderRequestView["orderType"], string>> = {
  ride: "مشوار",
  delivery: "توصيل",
};

export const NO_PLACES_TEXT =
  "لا توجد أماكن محفوظة بعد. افتح التطبيق لإضافة مكانك الأول.";
export const NO_ORDERS_TEXT =
  "لا توجد طلبات حديثة. افتح التطبيق لإنشاء طلب جديد.";
export const PLACES_HEADER_TEXT = "أماكنك المحفوظة:";
export const ORDERS_HEADER_TEXT = "أحدث طلباتك:";

/** `2026-08-21T09:15:00.000Z` → `2026-08-21` — a date is enough in a chat. */
function toDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** The saved-places reply. Zone paths are not resolved — see §6 of the doc. */
export function renderPlaces(places: readonly SavedPlaceView[]): ConversationReply {
  if (places.length === 0) {
    return { text: NO_PLACES_TEXT, withMiniApp: true, step: "places" };
  }

  const lines = places.map((place, index) => {
    const suffix = place.addressText ? ` — ${place.addressText}` : "";
    return `${index + 1}. ${place.label}${suffix}`;
  });

  return {
    text: [PLACES_HEADER_TEXT, ...lines].join("\n"),
    withMiniApp: true,
    step: "places",
  };
}

/**
 * The order-requests reply.
 *
 * A failed submission is shown as failed, with no excuse and no reason text: the
 * customer is told the request did not reach the engine, which is the truth the
 * fail-closed handover produced (ADR-009 §3). The reason code stays in the
 * event log, where support reads it.
 */
export function renderOrders(orders: readonly OrderRequestView[]): ConversationReply {
  if (orders.length === 0) {
    return { text: NO_ORDERS_TEXT, withMiniApp: true, step: "orders" };
  }

  const lines = orders.map((order) => {
    const type = ORDER_TYPE_TEXT[order.orderType];
    const status = ORDER_STATUS_TEXT[order.status];
    const reference = order.orderPublicId ? ` — ${order.orderPublicId}` : "";
    return `• ${toDay(order.createdAt)} — ${type} — ${status}${reference}`;
  });

  return {
    text: [ORDERS_HEADER_TEXT, ...lines].join("\n"),
    withMiniApp: true,
    step: "orders",
  };
}

/**
 * Build the bot's conversation handler over a `CustomerFlowsPort`.
 *
 * Anything that is not one of the three flows returns `null` — silence, not an
 * error: the channel core already rejected unregistered commands, and a bot that
 * answered every stray text message would be noise inside a conversation whose
 * real surface is the Mini App.
 */
export function createCustomerConversationHandler(
  flows: CustomerFlowsPort,
): ConversationHandler {
  return async (event: ConversationEvent): Promise<ConversationReply | null> => {
    // A group is a dispatch room, not a workspace: personal data is never read
    // into one (USER_FLOWS.md §1, ADR-008). The group `/start` reply already
    // pointed the person to the private conversation.
    if (event.scope !== "private") return null;
    if (event.kind !== "command" || event.command === undefined) return null;

    try {
      switch (event.command) {
        case "start": {
          // The identity was just bootstrapped by the core, so this costs no
          // round-trip. Answers nothing: the welcome message is the reply.
          const identity = await event.resolveIdentity();
          await flows.ensureProfile({
            waslaPublicId: identity.waslaPublicId,
            ...(event.displayName === undefined ? {} : { displayName: event.displayName }),
            ...(event.languageCode === undefined
              ? {}
              : { languageCode: event.languageCode }),
          });
          return null;
        }

        case CUSTOMER_PLACES_COMMAND: {
          const identity = await event.resolveIdentity();
          const places = await flows.listSavedPlaces({
            waslaPublicId: identity.waslaPublicId,
          });
          return renderPlaces(places);
        }

        case CUSTOMER_ORDERS_COMMAND: {
          const identity = await event.resolveIdentity();
          const orders = await flows.listRecentOrderRequests({
            waslaPublicId: identity.waslaPublicId,
            limit: ORDERS_REPLY_LIMIT,
          });
          return renderOrders(orders);
        }

        default:
          return null;
      }
    } catch (error) {
      if (error instanceof CustomerFlowError) {
        return {
          text: FLOW_ERROR_TEXT[error.code] ?? FLOW_FALLBACK_ERROR_TEXT,
          step: `error:${event.command}`,
        };
      }
      // Not a domain failure (identity unreachable, a bug, a broken pool): let it
      // reach the runtime, which logs it with the trace id. Turning an unknown
      // failure into a friendly message here would hide it from the operator.
      throw error;
    }
  };
}
