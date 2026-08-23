/**
 * The driver bot's conversation flows — what the bot *does* beyond opening its
 * Mini App, expressed without a single reference to Telegram or to the Driver
 * Core's implementation.
 *
 * ## Why the driver bot carries more than the customer bot
 *
 * The same product rule applies to both: «الـMini App هي مكان الخدمات الثقيلة؛
 * البوت للإطلاق، التنبيه، التوجيه، الإجراءات الصغيرة»
 * (docs/01-product/USER_FLOWS.md §1). But a driver's smallest action is also his
 * most frequent one — going available and going offline, many times a day, often
 * one-handed at a kerb. That is exactly «إجراء صغير», and forcing it through a
 * Mini App launch would be the one place where the app is *worse* than the chat.
 *
 * So four flows, and the reason each one is here:
 *
 *   /start      → make sure a driver profile exists (bootstrap, answers nothing)
 *   /available  → declare available   ─┐ the two-value axis of ADR-012 decision 4;
 *   /offline    → declare offline     ─┘ `busy` is dispatch's word, never the driver's
 *   /status     → the verdict and, when he is not eligible, WHY — in words he can act on
 *   /docs       → read back the documents and where each one stands
 *
 * ## What is deliberately NOT here
 *
 * **Uploading a document.** `POST /drivers/{id}/documents` takes a `storage_ref`
 * — a pointer into a file store — and never the file (`contracts/api.openapi.yml`,
 * and the privacy rule in `services/drivers/src/__tests__/privacy.test.ts`). A
 * chat upload would therefore need this bot to receive a photo, put it in object
 * storage, and mint that reference: a storage integration with its own retention
 * and access rules, invented inside an engineering MR. `/docs` reads back and
 * points at the app; the boundary is declared, not forgotten (Phase 12 owns
 * driver document capture).
 *
 * **Anything administrative.** Review, suspend, reinstate are acts of ops with a
 * `reviewed_by`, and a bot whose caller is the subject of the decision must not be
 * able to make it. There is no `/verify` here and there must never be.
 *
 * ## Two rules keep this file honest (same as the customer bot)
 *
 *  1. **No validation and no decision.** Nothing here decides what eligible means
 *     or whether a declaration is allowed; it calls a use case and translates the
 *     error *code*. The reason copy below is keyed by the closed reason-code
 *     catalog (`services/drivers/contracts/errors.md` §كتالوج أسباب عدم الأهليّة)
 *     — a rule re-expressed here would be a rule that can disagree with itself.
 *  2. **No adapter.** It depends on `DriverFlowsPort`, whose only production
 *     implementation calls the use cases in process (`driver-core.ts`).
 */

import type {
  ConversationEvent,
  ConversationHandler,
  ConversationReply,
} from "@wasla/bot-runtime";

/** Commands this bot answers, beyond `start`. */
export const DRIVER_AVAILABLE_COMMAND = "available";
export const DRIVER_OFFLINE_COMMAND = "offline";
export const DRIVER_STATUS_COMMAND = "status";
export const DRIVER_DOCS_COMMAND = "docs";
export const DRIVER_NEGOTIATIONS_COMMAND = "negotiations";
export const DRIVER_ACCEPT_COMMAND = "accept";
export const DRIVER_REJECT_COMMAND = "reject";

/** Everything the bot registers with the channel core when flows are wired. */
export const DRIVER_SUPPORTED_COMMANDS: readonly string[] = [
  "start",
  DRIVER_AVAILABLE_COMMAND,
  DRIVER_OFFLINE_COMMAND,
  DRIVER_STATUS_COMMAND,
  DRIVER_DOCS_COMMAND,
  DRIVER_NEGOTIATIONS_COMMAND,
  DRIVER_ACCEPT_COMMAND,
  DRIVER_REJECT_COMMAND,
] as const;

/** The two values a driver may declare. `busy` is not among them, by contract. */
export type DeclaredAvailabilityView = "available" | "offline";

/**
 * The verdict, reduced to what a chat message can honestly show.
 *
 * `reasonCodes` and not reason text: the codes are a closed set on the wire
 * (`EligibilityView.reason_codes`), and the Arabic below is this surface's copy of
 * them. Sending the driver a code would be useless; letting the service send
 * Arabic would put product copy in a domain service.
 */
export interface DriverStatusView {
  readonly eligibilityState: "eligible" | "ineligible" | "suspended" | "unknown";
  readonly reasonCodes: readonly string[];
  readonly declaredAvailability: DeclaredAvailabilityView;
  /** The next instant the verdict could change with nobody doing anything. */
  readonly recheckAt: string | null;
}

/** One document, reduced to what a chat message can honestly show. */
export interface DriverDocumentView {
  readonly documentType: string;
  readonly status: "pending" | "verified" | "rejected" | "superseded";
  readonly expiresAt: string | null;
}

/**
 * What the bot needs from the Driver Core, and nothing more.
 *
 * Deliberately narrower than the service: a chat surface that could review a
 * document or suspend a profile would sooner or later be asked to.
 */
export interface DriverFlowsPort {
  /**
   * Make sure a driver profile exists for this identity.
   *
   * Must never overwrite a profile edited in the Mini App — see `driver-core.ts`
   * for how that is guaranteed.
   */
  ensureRegistered(input: {
    readonly waslaPublicId: string;
    readonly displayName?: string;
    readonly languageCode?: string;
  }): Promise<{ readonly created: boolean }>;

  /** The verdict. Recomputes, by design — see `readEligibility`. */
  readStatus(input: { readonly waslaPublicId: string }): Promise<DriverStatusView>;

  declareAvailability(input: {
    readonly waslaPublicId: string;
    readonly declared: DeclaredAvailabilityView;
  }): Promise<DriverStatusView>;

  listDocuments(input: {
    readonly waslaPublicId: string;
  }): Promise<readonly DriverDocumentView[]>;
}

/**
 * A failure of the Driver Core, carried across the boundary as a *code*.
 *
 * The adapter throws this; the copy below turns the code into Arabic. Passing a
 * code instead of a message is what stops the bot from re-wording domain rules
 * (and from leaking an internal message to a driver).
 */
export class DriverFlowError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DriverFlowError";
  }
}

/** Arabic copy per error code. Product language is Arabic-first. */
export const DRIVER_FLOW_ERROR_TEXT: Readonly<Record<string, string>> = {
  DRIVER_NOT_FOUND: "لا يوجد ملف سائق لك بعد. أرسل /start لإنشائه، ثم أعد المحاولة.",
  DRIVER_ALREADY_EXISTS: "ملفك موجود بالفعل. أرسل /status لمعرفة وضعك.",
  DRIVER_SUSPENDED: "ملفك موقوف حالياً، فلا يمكن تغيير حالة التوافر. تواصل مع الدعم.",
  DRIVER_ZONE_UNKNOWN: "المنطقة المرتبطة بملفك غير متاحة حالياً.",
  DRIVER_VALIDATION_FAILED: "البيانات غير مكتملة. أكمل ملفك من التطبيق ثم أعد المحاولة.",
  DRIVER_UNAVAILABLE: "الخدمة غير متاحة مؤقتاً. أعد المحاولة بعد قليل.",
  DRIVER_DEPENDENCY_UNAVAILABLE: "الخدمة غير متاحة مؤقتاً. أعد المحاولة بعد قليل.",
  DRIVER_NEGOTIATION_NOT_FOUND: "لم نعد نجد هذا التفاوض. افتح التطبيق لتحديث القائمة.",
  DRIVER_NEGOTIATION_ROUND_STALE: "تغيّر العرض قبل تنفيذ الإجراء. راجع التطبيق ثم أعد المحاولة.",
  DRIVER_NEGOTIATION_NOT_ACTIONABLE: "لم يعد العرض قابلاً للتنفيذ. راجع التطبيق لمعرفة حالته.",
};

/** What a driver reads when the core failed with a code we have no copy for. */
export const DRIVER_FLOW_FALLBACK_ERROR_TEXT = "تعذّر إكمال الطلب الآن. أعد المحاولة بعد قليل.";

/** Arabic label per eligibility state. */
export const ELIGIBILITY_STATE_TEXT: Readonly<
  Record<DriverStatusView["eligibilityState"], string>
> = {
  eligible: "مؤهَّل لاستقبال الطلبات",
  ineligible: "غير مؤهَّل حالياً",
  suspended: "موقوف",
  unknown: "غير محدَّد بعد",
};

/** Arabic label per declared availability. */
export const AVAILABILITY_TEXT: Readonly<Record<DeclaredAvailabilityView, string>> = {
  available: "متاح",
  offline: "غير متاح",
};

/**
 * Arabic copy per eligibility reason code — the closed catalog, and each line says
 * what the driver can DO about it. A reason he cannot act on is noise.
 *
 * Keyed by `ELIGIBILITY_REASON_CODES`; `driver-flows.test.ts` asserts this map
 * covers the catalog exactly, so a code added to the domain cannot reach a driver
 * as a bare identifier.
 */
export const ELIGIBILITY_REASON_TEXT: Readonly<Record<string, string>> = {
  PROFILE_SUSPENDED: "ملفك موقوف — تواصل مع الدعم لرفع الإيقاف.",
  PROFILE_NOT_VERIFIED: "ملفك لم يُعتمد بعد — المراجعة الإدارية جارية.",
  NO_PRIMARY_VEHICLE: "لا توجد مركبة رئيسية — سجّل مركبتك من التطبيق.",
  NO_SERVICE_ZONE: "لم تحدّد مناطق عملك — اخترها من التطبيق.",
  NO_SERVICE_KIND: "لم تحدّد نوع الخدمة (مشاوير أو توصيل) — حدّدها من التطبيق.",
  DOCUMENT_MISSING: "تنقص وثيقة مطلوبة — أضفها من التطبيق.",
  DOCUMENT_PENDING: "لديك وثيقة قيد المراجعة — لا حاجة لإجراء منك الآن.",
  DOCUMENT_REJECTED: "رُفضت إحدى وثائقك — أعد تقديم نسخة واضحة وسارية.",
  DOCUMENT_EXPIRED: "انتهت صلاحية إحدى وثائقك — أعد تقديم نسخة سارية.",
};

/** Arabic label per document type. */
export const DOCUMENT_TYPE_TEXT: Readonly<Record<string, string>> = {
  national_id: "الهوية",
  driving_license: "رخصة القيادة",
  vehicle_registration: "استمارة المركبة",
  vehicle_insurance: "تأمين المركبة",
  vehicle_photo: "صورة المركبة",
};

/** Arabic label per document status. */
export const DOCUMENT_STATUS_TEXT: Readonly<Record<string, string>> = {
  pending: "قيد المراجعة",
  verified: "مُعتمدة",
  rejected: "مرفوضة",
  superseded: "مُستبدلة",
};

export const NO_DOCUMENTS_TEXT = "لا توجد وثائق بعد. افتح التطبيق لإضافة وثائقك.";
export const DOCUMENTS_HEADER_TEXT = "وثائقك:";
export const DOCUMENTS_UPLOAD_HINT_TEXT = "لإضافة وثيقة أو استبدال واحدة، افتح التطبيق.";
export const STATUS_REASONS_HEADER_TEXT = "الأسباب:";

/** `2026-08-21T09:15:00.000Z` → `2026-08-21` — a date is enough in a chat. */
function toDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * The status reply: verdict, declared availability, and the actionable reasons.
 *
 * The reasons are shown even though the verdict alone would fit in a line, and
 * that is the whole point of this command: a driver who is told only «غير مؤهَّل»
 * calls support, and support then reads the same reason list to him. Anything the
 * service already computed and the driver can act on belongs in his own hands.
 *
 * `recheckAt` is shown only when the verdict is not `eligible`: for an eligible
 * driver it is the date his licence expires, which reads like a threat in a status
 * reply and belongs on the documents list — where `/docs` puts it.
 */
export function renderStatus(status: DriverStatusView, step: string): ConversationReply {
  const lines = [
    `الحالة: ${ELIGIBILITY_STATE_TEXT[status.eligibilityState]}`,
    `التوافر: ${AVAILABILITY_TEXT[status.declaredAvailability]}`,
  ];

  if (status.reasonCodes.length > 0) {
    lines.push(STATUS_REASONS_HEADER_TEXT);
    for (const code of status.reasonCodes) {
      lines.push(`• ${ELIGIBILITY_REASON_TEXT[code] ?? code}`);
    }
  }

  if (status.eligibilityState !== "eligible" && status.recheckAt !== null) {
    lines.push(`مراجعة تلقائية بتاريخ: ${toDay(status.recheckAt)}`);
  }

  return { text: lines.join("\n"), withMiniApp: true, step };
}

/**
 * The documents reply — including superseded ones.
 *
 * The service returns them deliberately («بما فيها المستبدلة حتى يبقى التدقيق
 * قابلاً للقراءة», `listDriverDocuments`), and hiding them here would make the
 * driver's own view disagree with the one support reads while helping him.
 */
export function renderDocuments(documents: readonly DriverDocumentView[]): ConversationReply {
  if (documents.length === 0) {
    return { text: NO_DOCUMENTS_TEXT, withMiniApp: true, step: "docs" };
  }

  const lines = documents.map((document) => {
    const type = DOCUMENT_TYPE_TEXT[document.documentType] ?? document.documentType;
    const status = DOCUMENT_STATUS_TEXT[document.status] ?? document.status;
    const expiry = document.expiresAt ? ` — تنتهي ${document.expiresAt}` : "";
    return `• ${type}: ${status}${expiry}`;
  });

  return {
    text: [DOCUMENTS_HEADER_TEXT, ...lines, DOCUMENTS_UPLOAD_HINT_TEXT].join("\n"),
    withMiniApp: true,
    step: "docs",
  };
}

/**
 * Build the bot's conversation handler over a `DriverFlowsPort`.
 *
 * Anything that is not one of the five commands returns `null` — silence, not an
 * error: the channel core already rejected unregistered commands, and a bot that
 * answered every stray text message would be noise in a driver's phone.
 */
export function createDriverConversationHandler(flows: DriverFlowsPort): ConversationHandler {
  return async (event: ConversationEvent): Promise<ConversationReply | null> => {
    // A group is a dispatch room, not a workspace: a driver's verdict, documents
    // and availability are personal data and are never read into one
    // (USER_FLOWS.md §1, ADR-008). The group `/start` reply already pointed the
    // person to the private conversation.
    if (event.scope !== "private") return null;
    if (event.kind !== "command" || event.command === undefined) return null;

    try {
      switch (event.command) {
        case "start": {
          // The identity was just bootstrapped by the core, so this costs no
          // round-trip. Answers nothing: the welcome message is the reply.
          const identity = await event.resolveIdentity();
          await flows.ensureRegistered({
            waslaPublicId: identity.waslaPublicId,
            ...(event.displayName === undefined ? {} : { displayName: event.displayName }),
            ...(event.languageCode === undefined ? {} : { languageCode: event.languageCode }),
          });
          return null;
        }

        case DRIVER_STATUS_COMMAND: {
          const identity = await event.resolveIdentity();
          const status = await flows.readStatus({ waslaPublicId: identity.waslaPublicId });
          return renderStatus(status, "status");
        }

        // The declaration and the verdict are ONE reply, not two: a driver who
        // sends /available and reads «تم» has been told his tap was recorded, not
        // that he will now receive orders — and those are different facts whenever
        // a document has expired. The reply he gets is the answer to the question
        // he actually asked.
        case DRIVER_AVAILABLE_COMMAND:
        case DRIVER_OFFLINE_COMMAND: {
          const declared: DeclaredAvailabilityView =
            event.command === DRIVER_AVAILABLE_COMMAND ? "available" : "offline";
          const identity = await event.resolveIdentity();
          const status = await flows.declareAvailability({
            waslaPublicId: identity.waslaPublicId,
            declared,
          });
          return renderStatus(status, `availability:${declared}`);
        }

        case DRIVER_DOCS_COMMAND: {
          const identity = await event.resolveIdentity();
          const documents = await flows.listDocuments({
            waslaPublicId: identity.waslaPublicId,
          });
          return renderDocuments(documents);
        }

        default:
          return null;
      }
    } catch (error) {
      if (error instanceof DriverFlowError) {
        return {
          text: DRIVER_FLOW_ERROR_TEXT[error.code] ?? DRIVER_FLOW_FALLBACK_ERROR_TEXT,
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
