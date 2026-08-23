/**
 * محولات منافذ التفاوض إلى PostgreSQL عبر Drizzle.
 *
 * الطبقة أدناه هي حد التحويل الوحيد بين صفوف PostgreSQL ونماذج المجال: التواريخ تخرج ISO،
 * المال يبقى `number` موافقاً لعقد الخدمة، وJSONB لا يتجاوز الصندوق الخارجي إلا كحدث متعاقد
 * عليه. لا يقرأ استعمال الحالة SQLSTATE ولا أسماء أعمدة؛ أخطاء PostgreSQL تفك من سلسلة
 * `cause` ثم تترجم فقط إلى أخطاء المجال التي يستطيع العميل معالجتها.
 *
 * لا تبدأ المستودعات معاملات. اختيار حدود العملية التطبيقية مسؤولية
 * `PostgresNegotiationUnitOfWork`، لأن عملية واحدة قد تغيّر جولة وخيطاً وصادراً ومفتاح إعادة.
 */
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { NegotiationDomainEvent } from "@wasla/contracts-negotiation";
import {
  alreadyAgreed,
  roundNotFound,
  roundStale,
  selfAcceptForbidden,
  threadAlreadyExists,
  threadNotFound,
  turnViolation,
} from "../../domain/errors.js";
import type {
  NegotiationAgreement,
  NegotiationHandoffOutcome,
  NegotiationHandoffState,
  NegotiationLocale,
  NegotiationMessage,
  NegotiationParty,
  NegotiationPolicy,
  NegotiationPriceHandoff,
  NegotiationRound,
  NegotiationRoundState,
  NegotiationThread,
  NegotiationThreadState,
} from "../../domain/model.js";
import type {
  AgreementRepository,
  CreateAgreementInput,
  CreateMessageInput,
  CreateRoundInput,
  CreateThreadInput,
  HandoffMutation,
  IdempotencyStore,
  MessageRepository,
  NegotiationPolicyRepository,
  Outbox,
  PriceHandoffRepository,
  RoundRepository,
  RoundResolution,
  ThreadFilter,
  ThreadMutation,
  ThreadRepository,
} from "../../ports.js";
import type { DbOrTx } from "./db.js";
import {
  negotiationAgreements,
  negotiationIdempotency,
  negotiationMessages,
  negotiationOutbox,
  negotiationPolicies,
  negotiationPriceHandoffs,
  negotiationRounds,
  negotiationThreads,
} from "./schema.js";

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
function need(value: Date): string {
  return value.toISOString();
}
export function postgresError(error: unknown): {
  code?: string;
  constraint?: string;
} {
  let cursor = error;
  const found: { code?: string; constraint?: string } = {};
  for (let n = 0; n < 8 && cursor && typeof cursor === "object"; n += 1) {
    const x = cursor as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      found.code === undefined &&
      typeof x.code === "string" &&
      x.code.length === 5
    )
      found.code = x.code;
    if (found.constraint === undefined && typeof x.constraint === "string")
      found.constraint = x.constraint;
    if (x.cause === cursor) break;
    cursor = x.cause;
  }
  return found;
}
function translate(error: unknown): never {
  const detail = postgresError(error);
  if (
    detail.constraint === "ux_negotiation_threads_order_driver" ||
    detail.constraint === "ux_negotiation_threads_dispatch_offer"
  )
    throw threadAlreadyExists(detail.constraint);
  if (detail.constraint === "ux_negotiation_rounds_one_pending")
    throw turnViolation("counterparty");
  if (
    detail.constraint === "ux_negotiation_rounds_one_accepted" ||
    detail.constraint === "ux_negotiation_agreements_order_driver"
  )
    throw alreadyAgreed(detail.constraint);
  if (detail.constraint === "ck_negotiation_rounds_no_self_resolution")
    throw selfAcceptForbidden();
  throw error;
}

type PolicyRow = typeof negotiationPolicies.$inferSelect;
type ThreadRow = typeof negotiationThreads.$inferSelect;
type RoundRow = typeof negotiationRounds.$inferSelect;
type MessageRow = typeof negotiationMessages.$inferSelect;
type AgreementRow = typeof negotiationAgreements.$inferSelect;
type HandoffRow = typeof negotiationPriceHandoffs.$inferSelect;
function policy(row: PolicyRow): NegotiationPolicy {
  return {
    policyVersion: row.policyVersion,
    label: row.label,
    currency: row.currency,
    minAmountMinor: row.minAmountMinor,
    maxAmountMinor: row.maxAmountMinor,
    maxRounds: row.maxRounds,
    roundTtlSeconds: row.roundTtlSeconds,
    threadTtlSeconds: row.threadTtlSeconds,
    maxMessageLength: row.maxMessageLength,
    maxMessagesPerThread: row.maxMessagesPerThread,
    isFrozen: row.isFrozen,
    createdAt: need(row.createdAt),
  };
}
function thread(row: ThreadRow): NegotiationThread {
  return {
    id: row.id,
    orderPublicId: row.orderPublicId,
    customerPublicId: row.customerPublicId,
    driverPublicId: row.driverPublicId,
    dispatchOfferId: row.dispatchOfferId,
    serviceKind: row.serviceKind as NegotiationThread["serviceKind"],
    state: row.state as NegotiationThreadState,
    closeReasonCode:
      row.closeReasonCode as NegotiationThread["closeReasonCode"],
    policyVersion: row.policyVersion,
    currency: row.currency,
    openingAmountMinor: row.openingAmountMinor,
    openedBy: row.openedBy as NegotiationParty,
    roundCount: row.roundCount,
    currentRoundNo: row.currentRoundNo,
    agreedRoundNo: row.agreedRoundNo,
    expiresAt: need(row.expiresAt),
    nextTickAt: iso(row.nextTickAt),
    closedAt: iso(row.closedAt),
    createdAt: need(row.createdAt),
    updatedAt: need(row.updatedAt),
    version: row.version,
  };
}
function round(row: RoundRow): NegotiationRound {
  return {
    id: row.id,
    threadId: row.threadId,
    roundNo: row.roundNo,
    proposedBy: row.proposedBy as NegotiationParty,
    amountMinor: row.amountMinor,
    currency: row.currency,
    state: row.state as NegotiationRoundState,
    resolvedBy: row.resolvedBy as NegotiationParty | null,
    expiresAt: need(row.expiresAt),
    respondedAt: iso(row.respondedAt),
    createdAt: need(row.createdAt),
  };
}
function message(row: MessageRow): NegotiationMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    sequenceNo: row.sequenceNo,
    authorRole: row.authorRole as NegotiationMessage["authorRole"],
    body: row.body,
    sourceLocale: row.sourceLocale as NegotiationLocale,
    systemCode: row.systemCode,
    roundNo: row.roundNo,
    redactedAt: iso(row.redactedAt),
    redactionReasonCode: row.redactionReasonCode,
    createdAt: need(row.createdAt),
  };
}
function agreement(row: AgreementRow): NegotiationAgreement {
  return {
    threadId: row.threadId,
    orderPublicId: row.orderPublicId,
    driverPublicId: row.driverPublicId,
    roundNo: row.roundNo,
    amountMinor: row.amountMinor,
    currency: row.currency,
    acceptedBy: row.acceptedBy as NegotiationParty,
    policyVersion: row.policyVersion,
    agreedAt: need(row.agreedAt),
    handoffState: row.handoffState as NegotiationHandoffState,
    handoffAttempts: row.handoffAttempts,
    handedOffAt: iso(row.handedOffAt),
    nextHandoffAt: iso(row.nextHandoffAt),
    lastErrorCode: row.lastErrorCode,
    createdAt: need(row.createdAt),
    updatedAt: need(row.updatedAt),
  };
}
function handoff(row: HandoffRow): NegotiationPriceHandoff {
  return {
    id: row.id,
    threadId: row.threadId,
    attemptNo: row.attemptNo,
    amountMinor: row.amountMinor,
    currency: row.currency,
    requestedAt: need(row.requestedAt),
    outcome: row.outcome as NegotiationHandoffOutcome | null,
    responseStatus: row.responseStatus,
    errorCode: row.errorCode,
    completedAt: iso(row.completedAt),
  };
}

/**
 * يخزن خيط التفاوض الرئيسي.
 * تحرسه فرادتا الطلب/السائق وعرض التوزيع وقيود حالة الإغلاق وعدّادات الجولات.
 * اختير صف واحد قابل لتحديث تفاؤلي بدلاً من سجل حالات منفصل كي تقرأ كل عملية صورة الخيط
 * ونسخته معاً ولا تقبل كتابتين متزامنتين على نفس الجولة.
 */
export class PostgresThreadRepository implements ThreadRepository {
  constructor(private readonly db: DbOrTx) {}
  async find(id: string) {
    const r = await this.db
      .select()
      .from(negotiationThreads)
      .where(eq(negotiationThreads.id, id))
      .limit(1);
    return r[0] ? thread(r[0]) : null;
  }
  async findByOrderAndDriver(orderPublicId: string, driverPublicId: string) {
    const r = await this.db
      .select()
      .from(negotiationThreads)
      .where(
        and(
          eq(negotiationThreads.orderPublicId, orderPublicId),
          eq(negotiationThreads.driverPublicId, driverPublicId),
        ),
      )
      .limit(1);
    return r[0] ? thread(r[0]) : null;
  }
  async findByDispatchOffer(dispatchOfferId: string) {
    const r = await this.db
      .select()
      .from(negotiationThreads)
      .where(eq(negotiationThreads.dispatchOfferId, dispatchOfferId))
      .limit(1);
    return r[0] ? thread(r[0]) : null;
  }
  async create(input: CreateThreadInput) {
    try {
      const r = await this.db
        .insert(negotiationThreads)
        .values({
          ...input,
          expiresAt: new Date(input.expiresAt),
          nextTickAt:
            input.nextTickAt === null ? null : new Date(input.nextTickAt),
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt),
        })
        .returning();
      if (!r[0]) throw threadNotFound();
      return thread(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async update(
    id: string,
    mutation: ThreadMutation,
    at: string,
    expectedVersion: number,
  ) {
    try {
      const set = {
        ...(mutation.state === undefined ? {} : { state: mutation.state }),
        ...(mutation.closeReasonCode === undefined
          ? {}
          : { closeReasonCode: mutation.closeReasonCode }),
        ...(mutation.roundCount === undefined
          ? {}
          : { roundCount: mutation.roundCount }),
        ...(mutation.currentRoundNo === undefined
          ? {}
          : { currentRoundNo: mutation.currentRoundNo }),
        ...(mutation.agreedRoundNo === undefined
          ? {}
          : { agreedRoundNo: mutation.agreedRoundNo }),
        ...(mutation.nextTickAt === undefined
          ? {}
          : {
              nextTickAt:
                mutation.nextTickAt === null
                  ? null
                  : new Date(mutation.nextTickAt),
            }),
        ...(mutation.closedAt === undefined
          ? {}
          : {
              closedAt:
                mutation.closedAt === null ? null : new Date(mutation.closedAt),
            }),
        updatedAt: new Date(at),
        version: expectedVersion + 1,
      };
      const r = await this.db
        .update(negotiationThreads)
        .set(set)
        .where(
          and(
            eq(negotiationThreads.id, id),
            eq(negotiationThreads.version, expectedVersion),
          ),
        )
        .returning();
      if (r[0]) return thread(r[0]);
      const current = await this.find(id);
      if (current === null) throw threadNotFound();
      throw roundStale(expectedVersion, current.version);
    } catch (e) {
      throw e;
    }
  }
  async list(filter: ThreadFilter, limit: number) {
    const terms = [
      filter.orderPublicId === undefined
        ? undefined
        : eq(negotiationThreads.orderPublicId, filter.orderPublicId),
      filter.driverPublicId === undefined
        ? undefined
        : eq(negotiationThreads.driverPublicId, filter.driverPublicId),
      filter.state === undefined
        ? undefined
        : eq(negotiationThreads.state, filter.state),
    ];
    const r = await this.db
      .select()
      .from(negotiationThreads)
      .where(and(...terms))
      .orderBy(desc(negotiationThreads.createdAt), asc(negotiationThreads.id))
      .limit(limit);
    return r.map(thread);
  }
  async listDueForTick(now: string, limit: number) {
    const r = await this.db
      .select()
      .from(negotiationThreads)
      .where(
        and(
          eq(negotiationThreads.state, "open"),
          lte(negotiationThreads.nextTickAt, new Date(now)),
        ),
      )
      .orderBy(asc(negotiationThreads.nextTickAt), asc(negotiationThreads.id))
      .limit(limit);
    return r.map(thread);
  }
}
/**
 * يخزن العروض المرقمة وقرار كل عرض.
 * تحرسه فرادة رقم الجولة، وفهارسا الجولة المعلقة والمقبولة، وقيدا زمن/صاحب الحسم.
 * التمثيل صف لكل جولة بدلاً من مبلغ حالي في الخيط يحفظ تاريخ العرض الذي صار اتفاقاً.
 */
export class PostgresRoundRepository implements RoundRepository {
  constructor(private readonly db: DbOrTx) {}
  async list(id: string) {
    return (
      await this.db
        .select()
        .from(negotiationRounds)
        .where(eq(negotiationRounds.threadId, id))
        .orderBy(asc(negotiationRounds.roundNo))
    ).map(round);
  }
  async find(id: string, no: number) {
    const r = await this.db
      .select()
      .from(negotiationRounds)
      .where(
        and(
          eq(negotiationRounds.threadId, id),
          eq(negotiationRounds.roundNo, no),
        ),
      )
      .limit(1);
    return r[0] ? round(r[0]) : null;
  }
  async findPending(id: string) {
    const r = await this.db
      .select()
      .from(negotiationRounds)
      .where(
        and(
          eq(negotiationRounds.threadId, id),
          eq(negotiationRounds.state, "pending"),
        ),
      )
      .limit(1);
    return r[0] ? round(r[0]) : null;
  }
  async findAccepted(id: string) {
    const r = await this.db
      .select()
      .from(negotiationRounds)
      .where(
        and(
          eq(negotiationRounds.threadId, id),
          eq(negotiationRounds.state, "accepted"),
        ),
      )
      .limit(1);
    return r[0] ? round(r[0]) : null;
  }
  async create(input: CreateRoundInput) {
    try {
      const r = await this.db
        .insert(negotiationRounds)
        .values({
          ...input,
          expiresAt: new Date(input.expiresAt),
          createdAt: new Date(input.createdAt),
        })
        .returning();
      if (!r[0]) throw roundNotFound();
      return round(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async resolve(id: string, no: number, resolution: RoundResolution) {
    try {
      const r = await this.db
        .update(negotiationRounds)
        .set({
          ...resolution,
          respondedAt:
            resolution.respondedAt === null
              ? null
              : new Date(resolution.respondedAt),
        })
        .where(
          and(
            eq(negotiationRounds.threadId, id),
            eq(negotiationRounds.roundNo, no),
          ),
        )
        .returning();
      if (!r[0]) throw roundNotFound();
      return round(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async listPendingDue(now: string, limit: number) {
    return (
      await this.db
        .select()
        .from(negotiationRounds)
        .where(
          and(
            eq(negotiationRounds.state, "pending"),
            lte(negotiationRounds.expiresAt, new Date(now)),
          ),
        )
        .orderBy(asc(negotiationRounds.expiresAt), asc(negotiationRounds.id))
        .limit(limit)
    ).map(round);
  }
}
/**
 * يخزن رسائل المحادثة بترتيبها وحالة تنقيحها.
 * يحرسه تسلسل فريد لكل خيط وقيدا فصل رسالة المستخدم عن رسالة النظام والتنقيح المبرر.
 * تبقى الرسالة المنقحة صفاً بلا نص بدلاً من حذفها حتى لا تنكسر مراجعة التسلسل.
 */
export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: DbOrTx) {}
  async list(id: string) {
    return (
      await this.db
        .select()
        .from(negotiationMessages)
        .where(eq(negotiationMessages.threadId, id))
        .orderBy(asc(negotiationMessages.sequenceNo))
    ).map(message);
  }
  async count(id: string) {
    const r = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(negotiationMessages)
      .where(eq(negotiationMessages.threadId, id));
    return r[0]?.count ?? 0;
  }
  async create(input: CreateMessageInput) {
    try {
      const r = await this.db
        .insert(negotiationMessages)
        .values({ ...input, createdAt: new Date(input.createdAt) })
        .returning();
      if (!r[0]) throw threadNotFound();
      return message(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async redact(
    threadId: string,
    messageId: string,
    reasonCode: string,
    at: string,
  ) {
    const r = await this.db
      .update(negotiationMessages)
      .set({
        body: null,
        redactedAt: new Date(at),
        redactionReasonCode: reasonCode,
      })
      .where(
        and(
          eq(negotiationMessages.threadId, threadId),
          eq(negotiationMessages.id, messageId),
        ),
      )
      .returning();
    if (!r[0]) throw threadNotFound();
    return message(r[0]);
  }
}
/**
 * يخزن الاتفاق المنفصل عن الخيط وحالة تسليم السعر.
 * تحرسه فرادة الطلب/السائق وقيود الحالة النهائية ومواعيد التسليم.
 * هو جدول مستقل لا أعمدة إضافية في الخيط لأن حقيقة الاتفاق لا يجب أن تتغير مع فشل النقل.
 */
export class PostgresAgreementRepository implements AgreementRepository {
  constructor(private readonly db: DbOrTx) {}
  async find(id: string) {
    const r = await this.db
      .select()
      .from(negotiationAgreements)
      .where(eq(negotiationAgreements.threadId, id))
      .limit(1);
    return r[0] ? agreement(r[0]) : null;
  }
  async findByOrder(id: string) {
    const r = await this.db
      .select()
      .from(negotiationAgreements)
      .where(eq(negotiationAgreements.orderPublicId, id))
      .limit(1);
    return r[0] ? agreement(r[0]) : null;
  }
  async create(input: CreateAgreementInput) {
    try {
      const r = await this.db
        .insert(negotiationAgreements)
        .values({
          ...input,
          agreedAt: new Date(input.agreedAt),
          nextHandoffAt:
            input.nextHandoffAt === null ? null : new Date(input.nextHandoffAt),
          createdAt: new Date(input.agreedAt),
          updatedAt: new Date(input.agreedAt),
        })
        .returning();
      if (!r[0]) throw threadNotFound();
      return agreement(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async update(id: string, mutation: HandoffMutation, at: string) {
    try {
      const r = await this.db
        .update(negotiationAgreements)
        .set({
          ...(mutation.handoffState === undefined
            ? {}
            : { handoffState: mutation.handoffState }),
          ...(mutation.handoffAttempts === undefined
            ? {}
            : { handoffAttempts: mutation.handoffAttempts }),
          ...(mutation.handedOffAt === undefined
            ? {}
            : {
                handedOffAt:
                  mutation.handedOffAt === null
                    ? null
                    : new Date(mutation.handedOffAt),
              }),
          ...(mutation.nextHandoffAt === undefined
            ? {}
            : {
                nextHandoffAt:
                  mutation.nextHandoffAt === null
                    ? null
                    : new Date(mutation.nextHandoffAt),
              }),
          ...(mutation.lastErrorCode === undefined
            ? {}
            : { lastErrorCode: mutation.lastErrorCode }),
          updatedAt: new Date(at),
        })
        .where(eq(negotiationAgreements.threadId, id))
        .returning();
      if (!r[0]) throw threadNotFound();
      return agreement(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async listHandoffDue(now: string, limit: number) {
    return (
      await this.db
        .select()
        .from(negotiationAgreements)
        .where(
          and(
            eq(negotiationAgreements.handoffState, "pending"),
            lte(negotiationAgreements.nextHandoffAt, new Date(now)),
          ),
        )
        .orderBy(
          asc(negotiationAgreements.nextHandoffAt),
          asc(negotiationAgreements.threadId),
        )
        .limit(limit)
    ).map(agreement);
  }
}
/**
 * يخزن سجل محاولات تسليم السعر قبل معرفة النتيجة وبعد اكتمالها.
 * تحرسه فرادة رقم المحاولة وقيدا اكتمال النتيجة واسم خطأ الفشل.
 * الصف لكل محاولة بدلاً من عداد في الاتفاق يحفظ أثراً قابلاً للتدقيق لكل اتصال خارجي.
 */
export class PostgresPriceHandoffRepository implements PriceHandoffRepository {
  constructor(private readonly db: DbOrTx) {}
  async begin(input: {
    readonly id: string;
    readonly threadId: string;
    readonly attemptNo: number;
    readonly amountMinor: number;
    readonly currency: string;
    readonly requestedAt: string;
  }) {
    try {
      const r = await this.db
        .insert(negotiationPriceHandoffs)
        .values({ ...input, requestedAt: new Date(input.requestedAt) })
        .returning();
      if (!r[0]) throw threadNotFound();
      return handoff(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async complete(
    id: string,
    outcome: {
      readonly outcome: NegotiationHandoffOutcome | null;
      readonly responseStatus: number | null;
      readonly errorCode: string | null;
      readonly completedAt: string;
    },
  ) {
    try {
      const r = await this.db
        .update(negotiationPriceHandoffs)
        .set({ ...outcome, completedAt: new Date(outcome.completedAt) })
        .where(eq(negotiationPriceHandoffs.id, id))
        .returning();
      if (!r[0]) throw threadNotFound();
      return handoff(r[0]);
    } catch (e) {
      return translate(e);
    }
  }
  async list(id: string) {
    return (
      await this.db
        .select()
        .from(negotiationPriceHandoffs)
        .where(eq(negotiationPriceHandoffs.threadId, id))
        .orderBy(desc(negotiationPriceHandoffs.attemptNo))
    ).map(handoff);
  }
}
/**
 * يقرأ نسخ سياسة التفاوض المجمدة.
 * حدود السياسة تحفظها قيود المبلغ والمهلة في الجدول، ولا يعدل هذا المستودع السياسة.
 * القراءة فقط مقصودة: النسخة المرتبطة بالخيط تفسير تاريخي وليست إعداداً حياً قابلاً للكتابة.
 */
export class PostgresNegotiationPolicyRepository implements NegotiationPolicyRepository {
  constructor(private readonly db: DbOrTx) {}
  async find(v: number) {
    const r = await this.db
      .select()
      .from(negotiationPolicies)
      .where(eq(negotiationPolicies.policyVersion, v))
      .limit(1);
    return r[0] ? policy(r[0]) : null;
  }
  async findActive() {
    const r = await this.db
      .select()
      .from(negotiationPolicies)
      .where(eq(negotiationPolicies.isFrozen, true))
      .orderBy(desc(negotiationPolicies.policyVersion))
      .limit(1);
    return r[0] ? policy(r[0]) : null;
  }
  async list() {
    return (
      await this.db
        .select()
        .from(negotiationPolicies)
        .orderBy(asc(negotiationPolicies.policyVersion))
    ).map(policy);
  }
}
/**
 * يخزن أحداث المجال المراد نشرها ويقرأ غير المنشور منها بترتيب ثابت.
 * جدول الصادر لا يحمل قيداً مسمى من قائمة التفاوض، لكن فهرس غير المنشور يحرس مسار الناشر.
 * خزن الحمولة JSONB بدلاً من أعمدة لكل حدث لأن عقد الحدث هو الواجهة المتغيرة لا جدول التفاوض.
 */
export class PostgresNegotiationOutbox implements Outbox {
  constructor(private readonly db: DbOrTx) {}
  async append(event: NegotiationDomainEvent) {
    await this.db.insert(negotiationOutbox).values({
      id: event.event_id,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      payload: event as unknown as Record<string, unknown>,
      occurredAt: new Date(event.occurred_at),
      traceId: event.trace_id,
    });
  }
  async unread() {
    return (
      await this.db
        .select()
        .from(negotiationOutbox)
        .where(isNull(negotiationOutbox.publishedAt))
        .orderBy(asc(negotiationOutbox.occurredAt), asc(negotiationOutbox.id))
    ).map((r) => r.payload as unknown as NegotiationDomainEvent);
  }
}
/**
 * يخزن بصمة كل مفتاح إعادة مع نطاق العملية الذي أنشأه.
 * يحرس المفتاح الأساسي العالمي الجدول، وتتحقق طبقة الاستعمال من تطابق النطاق والبصمة.
 * لا نخزن استجابة تطبيقية كاملة هنا لأن منفذ هذه المرحلة يحتاج قرار الإعادة فقط لا ذاكرة HTTP.
 */
export class PostgresNegotiationIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: DbOrTx) {}
  async find(key: string) {
    const r = await this.db
      .select({
        scope: negotiationIdempotency.scope,
        payloadFingerprint: negotiationIdempotency.payloadFingerprint,
      })
      .from(negotiationIdempotency)
      .where(eq(negotiationIdempotency.idempotencyKey, key))
      .limit(1);
    return r[0] ?? null;
  }
  async remember(key: string, scope: string, payloadFingerprint: string) {
    await this.db
      .insert(negotiationIdempotency)
      .values({
        idempotencyKey: key,
        scope,
        threadId: null,
        payloadFingerprint,
        responseStatus: 200,
        responseBody: {},
      })
      .onConflictDoNothing();
  }
}
