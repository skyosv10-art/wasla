/**
 * سطحُ طبقةِ التطبيق (Phase 10 · المراجعة 4/6) — مُصدَّرٌ في مسارٍ منفصل `./app`.
 *
 * ولمَ لا يُصدَّر من الجذر؟ لأنّ هذه الطبقةَ تُنسّق **معاملةً** على وحدةِ عمل، فمن استوردها
 * استورد معها حدَّ القاعدة. والجذرُ سطحُ المجالِ النقيّ (`src/index.ts` يشرح)، وخلطُهما كان
 * سيجعل حاسبَ حالةٍ في تطبيقٍ آخرَ يجرّ `pg` بلا سببٍ ثمّ يفشل بناؤه.
 *
 * والساعةُ لا تُصدَّر من هنا ولا تُنشأ داخلَ الطبقة: `SubscriptionService` و`ReferralService`
 * تستلمانها في المُنشئ، و`app/runtime.ts` وحدَه يعرف الساعةَ الحقيقيّة — فمن أراد زمناً
 * مثبَّتاً في اختبارٍ لا يحتاج إلى حيلةٍ في الإطار.
 */

export {
  REFERRAL_LIST_LIMIT,
  ReferralService,
  type ClaimInput,
  type ClaimOutcome,
} from "./referrals.js";
export {
  SubscriptionService,
  TICK_BATCH_LIMIT,
  type ActivateInput,
  type GrantOutcome,
  type RecomputeOutcome,
  type StartTrialInput,
  type StateView,
  type TickOutcome,
} from "./subscriptions.js";
export { REFERRAL_CODE_ALPHABET, referralCodeFor } from "./referral-code.js";
export {
  DRAIN_BATCH_LIMIT,
  EventPayloadIncompleteError,
  EventSinkUnconfiguredError,
  drainSubscriptionOutbox,
  sequentialIdGenerator,
  sequentialUuidGenerator,
  toOutboxDraft,
  transitionEvent,
  unconfiguredEventSink,
  type DrainFailure,
  type DrainReport,
  type EventSinkPort,
  type IdGenerator,
} from "./events.js";
export {
  CONSUMED_EVENT_TYPE,
  FACT_IGNORE_REASONS,
  FACT_ROUTE_KEY,
  QUALIFYING_FACT_KIND,
  ReputationFactConsumer,
  parseReputationFact,
  type FactIgnoreReason,
  type FactOutcome,
  type ReputationFactEvent,
} from "./facts.js";
export { fingerprint } from "./idempotency.js";
export { systemClock, uuidIdGenerator } from "./runtime.js";
export { syncFromLedger, type SyncInput, type SyncOutcome } from "./sync.js";
