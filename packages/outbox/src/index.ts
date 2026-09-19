/**
 * @wasla/outbox — عقدُ صندوقِ الصادر المشترك (ADR-042).
 *
 * يُصدِّرُ الأنواعَ والمنطقَ المشتركَ لتصريفِ صندوقِ الصادر. كلُّ خدمةٍ
 * تُصدِّرُ محوّلًا رقيقًا يربطُ جدولَها بهذا العقد.
 *
 * Scope: مشترك · صندوقُ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: ADR-042
 */

export type {
  OutboxRecord,
  EventSinkPort,
  DrainFailure,
  DrainReport,
} from "./types.js";

export {
  createDirectOutboxDrainRunner,
  drainOutbox,
} from "./drain.js";

export type {
  Clock,
  OutboxDrainStore,
  OutboxDrainRunner,
} from "./drain.js";

export {
  EventSinkUnconfiguredError,
  unconfiguredEventSink,
} from "./sink.js";
