/**
 * مِشْكاةُ بوابةِ خروج Phase 09 — خدمتان حقيقيّتان على مِقبضَينِ حقيقيَّين.
 *
 * # ما تُثبته هذه الحزمة ولا يُثبته غيرُها
 *
 * اختباراتُ خدمةِ السمعة الـ282 كلُّها تُغذّي أحداثاً **كتبناها بأيدينا** في ملفّ
 * الاختبار. وهذا يُثبت أنّ المُستهلكَ يفهم العقدَ كما فهمناه، ولا يُثبت أنّ العقدَ
 * الذي فهمناه هو العقدُ الذي يُصدره محرّكُ الطلب فعلاً. والفرقُ بين الاثنين هو
 * بالضبط نوعُ العطبِ الذي يبقى مخفيّاً حتى الإنتاج: حقلٌ اسمُه `driver_public_id`
 * في اختبارنا و`driver_id` في المحرّك، أو `sequence` يبدأ من صفرٍ لا من واحد.
 *
 * فهذه البوابةُ لا تكتب حدثاً واحداً بيدها. تسوق طلباً عبر HTTP في محرّكِ الطلب
 * الحقيقيِّ حتى `completed`، ثمّ تقرأ **صفَّ صادرِ المحرّك** فتأخذ الحمولاتَ التي
 * أصدرها هو، وتُمرِّرها كما هي إلى `consumeSourceEvent`. فإن اختلف اسمُ حقلٍ في
 * أيِّ جهةٍ سقطت البوابةُ في `pnpm -r test` قبل أن يُدمج التغيير.
 *
 * # النسخةُ الخاطئةُ الأرخص
 *
 * كان الأرخصُ أن نستدعي حالاتِ استخدامِ السمعة مباشرةً بدلاً من رفع مُستمعٍ: أسرعُ
 * وأقصر. لكنّها كانت ستُثبت أنّ المجالَ صحيح — وذاك مُثبَتٌ أصلاً — ولا تُثبت أنّ
 * الطبقةَ التي ستُنادى في الإنتاج تُعيد ما نتوقّعه على المسار المُعلَن. ولذلك تُقرأ
 * النتيجةُ هنا من `GET /reputation/scores/...` على منفذٍ، لا من مستودعٍ في الذاكرة.
 *
 * والأرخصُ الثاني كان `SystemClock` للمحرّك كما في بوابةِ Phase 06. لكنّ السمعةَ
 * تُذبل بنصفِ عمرٍ 180 يوماً، فعمرُ الواقعة داخلٌ في حساب النتيجة؛ وساعةُ نظامٍ كانت
 * ستجعل النتيجةَ المُتوقَّعةَ تتغيّر مع تغيّر اليوم — وهو أسوأُ فشلٍ: يمرّ اليومَ
 * ويسقط بعد شهرٍ بلا أن يلمس أحدٌ سطراً. فكلتا الساعتين هنا مُعلَنتان بلحظةٍ مكتوبة.
 *
 * Scope: Phase 09 · MR 6/6 — بوابة الخروج فقط.
 * Related Code: services/orders, services/reputation
 * Related Docs: docs/12-testing/PHASE09_EXIT_GATE_E2E.md
 */
import type { AddressInfo } from "node:net";

import type { OrderStatus } from "@wasla/contracts-order";
import {
  allowedTargets,
  createDirectRunner,
  createOrderApp,
  CryptoIdGenerator as OrderIdGenerator,
  FixedClock,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox as InMemoryOrderOutbox,
  transitionRule,
  type OrderDomainEvent,
} from "@wasla/orders-service";
import {
  consumeSourceEvent,
  createDirectOutboxDrainRunner,
  createInMemoryReputationDependencies,
  drainOutbox,
  RecordingEventSink,
  type DrainReport,
  type InMemoryReputationDependencies,
  type SourceEventConsumption,
} from "@wasla/reputation-service";
import { createReputationApp } from "@wasla/reputation-service/http";
import {
  createDirectReputationRunner,
  type ReputationRunner,
} from "@wasla/reputation-service/runner";

/**
 * لحظةُ بدايةِ ساعةِ المحرّك، ولحظةُ ساعةِ السمعة بعدها بساعة.
 *
 * الترتيبُ مقصود: الوقائعُ تحدث ثمّ تُقرأ. ولو كانت ساعةُ السمعة **قبل** أحداثِ
 * المحرّك لصار عمرُ الواقعة سالباً، ولحسبت دالّةُ الذبول عاملاً أكبرَ من واحد —
 * أي أنّ حدثاً «من المستقبل» يزن أكثرَ من حدثِ اليوم. لا القاعدةُ تمنع ذلك ولا
 * المجالُ يعرف عنه شيئاً، لأنّه لا يحدث في نظامٍ ساعتُه واحدة.
 */
export const ENGINE_START_AT = "2026-01-01T00:00:00.000Z";
export const REPUTATION_START_AT = "2026-01-01T01:00:00.000Z";

/** منطقتان من تجهيزة السعودية، بمُعرّفَينِ ثابتَين: البوابةُ لا تُنادي الجغرافيا. */
const PICKUP_ZONE = "66666666-6666-4666-8666-666666666666";
const DROPOFF_ZONE = "77777777-7777-4777-8777-777777777777";

export interface GateContext {
  /** أصلُ محرّكِ الطلب — مُستمعٌ حقيقيٌّ على منفذٍ يمنحه النظام. */
  readonly ordersUrl: string;
  /** أصلُ خدمةِ السمعة — مُستمعٌ حقيقيٌّ آخر. */
  readonly reputationUrl: string;
  /** ساعةُ المحرّك، كي تسير الوقائعُ بترتيبٍ مقروءٍ في سجلّ التدقيق. */
  readonly engineClock: FixedClock;
  /** تبعيّاتُ السمعة، للقراءةِ المباشرةِ من صفِّ الصادر في التوكيدات. */
  readonly reputation: InMemoryReputationDependencies;
  /** مُشغّلُ السمعة، وهو ما يستهلكه `consumeSourceEvent`. */
  readonly reputationRunner: ReputationRunner;
  /** ما أصدره المحرّكُ فعلاً — لا ما نظنّ أنّه يُصدره. */
  readonly engineEvents: () => Promise<OrderDomainEvent[]>;
  readonly close: () => Promise<void>;
}

/**
 * يرفع الخدمتين بتركيبِهما الإنتاجيِّ على مُهيئي الذاكرة.
 *
 * `createDirectRunner` و`createDirectReputationRunner` هما نفسُ المِشْبكَينِ الذَين
 * يستعملهما `http/server.ts` في كلِّ خدمة؛ الفرقُ الوحيدُ هو المستودعُ خلفهما.
 * ولو رفعنا هنا مِشْبكاً خاصّاً بالاختبار لكانت البوابةُ تُثبت تركيباً لا يوجد.
 */
export async function startGate(): Promise<GateContext> {
  // --- محرّكُ الطلب ---------------------------------------------------------
  const engineClock = new FixedClock(ENGINE_START_AT);
  const engineOutbox = new InMemoryOrderOutbox();
  const ordersApp = createOrderApp({
    runner: createDirectRunner({
      repository: new InMemoryOrderRepository(),
      outbox: engineOutbox,
      clock: engineClock,
      ids: new OrderIdGenerator(),
      publicIds: new InMemoryOrderPublicIdGenerator(),
    }),
    health: { persistence: "memory" },
    logger: false,
  });
  await ordersApp.listen({ port: 0, host: "127.0.0.1" });
  const ordersUrl = `http://127.0.0.1:${(ordersApp.server.address() as AddressInfo).port}`;

  // --- خدمةُ السمعة --------------------------------------------------------
  const reputation = createInMemoryReputationDependencies({ startAt: REPUTATION_START_AT });
  const reputationRunner = createDirectReputationRunner(reputation);
  const reputationApp = createReputationApp({
    runner: reputationRunner,
    health: { persistence: "memory" },
    logger: false,
  });
  await reputationApp.listen({ port: 0, host: "127.0.0.1" });
  const reputationUrl = `http://127.0.0.1:${(reputationApp.server.address() as AddressInfo).port}`;

  return {
    ordersUrl,
    reputationUrl,
    engineClock,
    reputation,
    reputationRunner,
    engineEvents: () => engineOutbox.unread(),
    close: async () => {
      await reputationApp.close();
      await ordersApp.close();
    },
  };
}

export interface HttpResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  baseUrl: string,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${init.path}`, {
    method: init.method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/** نداءُ محرّكِ الطلب بترويساتِه المُعلَنة. */
export async function callEngine(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly customerScope?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  return call(gate.ordersUrl, {
    method: init.method,
    path: init.path,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.customerScope === undefined ? {} : { "x-customer-public-id": init.customerScope }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
  });
}

/** نداءُ خدمةِ السمعة على مسارها المُعلَن. */
export async function callReputation(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  return call(gate.reputationUrl, {
    method: init.method,
    path: init.path,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
  });
}

let counter = 0;

/** مفتاحُ تكرارٍ جديد. كلُّ كتابةٍ في هذه الحزمة تحمل مفتاحَها. */
export function nextKey(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(6, "0")}`;
}

/** مُعرّفٌ عامٌّ بصيغةِ القاعدة: `WS-` وعشرةُ أرقام. */
export function waslaId(seed: number): string {
  return `WS-${String(seed).padStart(10, "0")}`;
}

/** مُعرّفُ UUID ثابتٌ مُشتقٌّ من عدّاد — لا `randomUUID` كي يبقى الفشلُ مقروءاً. */
export function seededUuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, "0");
  return `11111111-1111-4111-8111-${hex}`;
}

export interface GateOrder {
  readonly orderPublicId: string;
  readonly customerPublicId: string;
  readonly driverPublicId: string;
}

/**
 * طلبٌ يدخل المحرّكَ على مسارِ الاستلامِ المُعلَن `POST /orders/intake`.
 *
 * ولا تمرّ البوابةُ عبر «نواة العميل» كما تفعل بوابةُ Phase 06: تلك تُثبت التسليمَ
 * بين العميل والمحرّك، وهذه تُثبت التسليمَ بين المحرّك والسمعة. وإدخالُ خدمتَينِ
 * وسيطتَينِ لا تُثبتهما البوابةُ كان سيجعل فشلَ الجغرافيا يظهر كفشلٍ في السمعة.
 */
export async function intakeOrder(gate: GateContext, seed: number): Promise<GateOrder> {
  const customerPublicId = waslaId(700_000 + seed);
  const driverPublicId = waslaId(800_000 + seed);
  const response = await callEngine(gate, {
    method: "POST",
    path: "/orders/intake",
    body: {
      order_request_id: seededUuid(seed),
      customer_public_id: customerPublicId,
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "customer_offer",
      offered_price: { amount_minor: 2500, currency: "SAR" },
      stops: [
        { kind: "pickup", zone_id: PICKUP_ZONE, source: "map" },
        { kind: "dropoff", zone_id: DROPOFF_ZONE, source: "map" },
      ],
      requested_at: ENGINE_START_AT,
    },
    idempotencyKey: nextKey("gate-intake"),
  });
  if (response.status !== 201) {
    throw new Error(`intake failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    orderPublicId: response.body.order_public_id as string,
    customerPublicId,
    driverPublicId,
  };
}

/** أقصرُ مسارٍ مشروعٍ من `published` إلى الهدف، مُشتقٌّ من جدولِ المحرّك نفسِه. */
export function shortestPath(target: OrderStatus): OrderStatus[] {
  if (target === "published") return [];
  const previous = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = ["published"];
  const seen = new Set<OrderStatus>(["published"]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of allowedTargets(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === target) {
        const path: OrderStatus[] = [target];
        let cursor: OrderStatus = target;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor)!;
          if (cursor === "published") break;
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }
  throw new Error(`${target} is unreachable from published`);
}

/** حالاتٌ لا تُدخَل بلا إسنادٍ مقبولٍ مُثبَّت. */
function needsAssignment(status: OrderStatus): boolean {
  return (
    status === "accepted" ||
    status === "assigned" ||
    status === "driver_en_route" ||
    status === "arrived" ||
    status === "in_progress" ||
    status === "completed"
  );
}

/** الحالةُ التي يقول المحرّكُ إنّ الطلبَ فيها الآن. */
export async function currentStatus(gate: GateContext, order: GateOrder): Promise<OrderStatus> {
  const read = await callEngine(gate, {
    method: "GET",
    path: `/orders/${order.orderPublicId}`,
    customerScope: order.customerPublicId,
  });
  if (read.status !== 200) {
    throw new Error(`read failed: ${read.status} ${JSON.stringify(read.body)}`);
  }
  return read.body.status as OrderStatus;
}

/** عرضُ إسنادٍ ثمّ حلُّه بحالةٍ مطلوبة — عبر HTTP كما سيفعل الإرسال. */
export async function resolveAssignment(
  gate: GateContext,
  order: GateOrder,
  state: "accepted" | "rejected" | "timed_out" | "cancelled",
): Promise<HttpResult> {
  const offered = await callEngine(gate, {
    method: "POST",
    path: `/orders/${order.orderPublicId}/assignments`,
    body: { driver_public_id: order.driverPublicId },
    idempotencyKey: nextKey("gate-offer"),
  });
  if (offered.status !== 201) {
    throw new Error(`assignment failed: ${offered.status} ${JSON.stringify(offered.body)}`);
  }
  gate.engineClock.advance();
  return callEngine(gate, {
    method: "PATCH",
    path: `/orders/${order.orderPublicId}/assignments/${offered.body.id as string}`,
    body: { assignment_state: state },
    idempotencyKey: nextKey("gate-resolve"),
  });
}

/** انتقالٌ واحدٌ عبر HTTP، بالفاعلِ الذي يُسمّيه الجدولُ له. */
export async function attemptTransition(
  gate: GateContext,
  order: GateOrder,
  to: OrderStatus,
): Promise<HttpResult> {
  const rule = transitionRule(await currentStatus(gate, order), to);
  const actorType = rule?.expectedActor ?? "system";
  gate.engineClock.advance();
  return callEngine(gate, {
    method: "POST",
    path: `/orders/${order.orderPublicId}/transitions`,
    body: {
      to_status: to,
      ...(rule?.typicalReason == null ? {} : { reason_code: rule.typicalReason }),
      actor_type: actorType,
      ...(actorType === "system" ? {} : { actor_ref: order.customerPublicId }),
    },
    idempotencyKey: nextKey("gate-transition"),
  });
}

/** سَوقُ طلبٍ من `published` إلى الهدف، مع إثباتِ الإسنادِ حين يلزم. */
export async function driveTo(
  gate: GateContext,
  order: GateOrder,
  target: OrderStatus,
): Promise<void> {
  let bound = false;
  for (const next of shortestPath(target)) {
    if (!bound && needsAssignment(next)) {
      const resolved = await resolveAssignment(gate, order, "accepted");
      if (resolved.status !== 200) {
        throw new Error(`accept failed: ${resolved.status} ${JSON.stringify(resolved.body)}`);
      }
      bound = true;
    }
    const response = await attemptTransition(gate, order, next);
    if (response.status !== 200) {
      throw new Error(
        `drive to ${target} stalled at ${next}: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
  }
}

/**
 * أحداثُ المحرّكِ الفعليّةُ بنوعٍ مُعيَّن، بترتيبِ صدورها.
 *
 * تُقرأ من صفِّ صادرِ المحرّك لا من جوابِ HTTP: الجوابُ يقول ما صار للطلب، والصفُّ
 * يقول ما سيُسلَّم للمُشتركين — والسمعةُ مُشتركة، فما يعنيها هو الثاني.
 */
export async function emittedEvents(
  gate: GateContext,
  eventType: "order.status_changed" | "order.assignment_resolved",
  orderPublicId?: string,
): Promise<OrderDomainEvent[]> {
  const events = await gate.engineEvents();
  return events.filter((event) => {
    if (event.event_type !== eventType) return false;
    if (orderPublicId === undefined) return true;
    return (event.data as { order_public_id?: string }).order_public_id === orderPublicId;
  });
}

/** تغذيةُ حدثٍ خامٍ إلى مُستهلكِ السمعة، كما سيفعل مُشترِكُ الناقل. */
export async function feed(gate: GateContext, raw: unknown): Promise<SourceEventConsumption> {
  return consumeSourceEvent(gate.reputationRunner, raw);
}

/** تصريفُ صفِّ صادرِ السمعة إلى مصرفٍ مُسجِّل، وإعادةُ التقرير والمُسلَّم. */
export async function drain(
  gate: GateContext,
  limit = 50,
): Promise<{ readonly report: DrainReport; readonly sink: RecordingEventSink }> {
  const sink = new RecordingEventSink();
  const report = await drainOutbox(createDirectOutboxDrainRunner(gate.reputation.outbox), sink, {
    limit,
    clock: gate.reputation.clock,
  });
  return { report, sink };
}
