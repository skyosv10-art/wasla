/**
 * تُجزّأ النبضة إلى معاملة لكل مهمة لأن المعاملة الواحدة كانت ستمتد على كل
 * المهام وكل نداءات HTTP: ذلك يستنزف بركة الاتصالات ويلغي تقدم مهام سليمة عند
 * فشل مهمة واحدة. الحصر يجعل عمر المعاملة قريباً من (2 + حجم الموجة) × مهلة
 * العميل، فيطابق وعد الوثائق بأن الفشل محصور في مهمته. يبقى الاعتماد على مهل
 * HTTP الصارمة تخفيفاً لازماً للدين المتبقي، كما تسميه وثيقة الاستمرارية.
 */
import type { DispatchDependencies, JobRepository } from "./ports.js";
import type { DispatchRunner } from "./runner.js";
import { tick, type TickInput, type TickOutcome } from "./use-cases/tick.js";

function scopeToJob(jobs: JobRepository, jobId: string): JobRepository {
  return {
    find: (id) => jobs.find(id),
    findByOrderId: (orderId) => jobs.findByOrderId(orderId),
    findByIdempotencyKey: (key) => jobs.findByIdempotencyKey(key),
    insert: (input) => jobs.insert(input),
    updateStatus: (id, status, reasonCode, changedAt) =>
      jobs.updateStatus(id, status, reasonCode, changedAt),
    listActive: async () => {
      const job = await jobs.find(jobId);
      return job === null ? [] : [job];
    },
  };
}

function withTickClock(deps: DispatchDependencies, jobId: string, tickAt: string): DispatchDependencies {
  return {
    jobs: scopeToJob(deps.jobs, jobId),
    waves: deps.waves,
    offers: deps.offers,
    outbox: deps.outbox,
    idempotency: deps.idempotency,
    matching: deps.matching,
    orders: deps.orders,
    rules: deps.rules,
    clock: { now: () => tickAt },
    ids: deps.ids,
  };
}

export async function runTick(runner: DispatchRunner, input: TickInput = {}): Promise<TickOutcome> {
  // قراءة واحدة تجمع المهام النشطة ولحظة النبضة معاً: قراءتان منفصلتان تفتحان
  // احتمال أن تقع قراءة الساعة بعد قراءة القائمة بمدّة غير محدودة، فتُقارن مُهَل
  // المهام بلحظة لا تمثّل اللحظة التي رُصدت فيها القائمة.
  const { active, tickAt } = await runner.read(async (deps) => ({
    active: await deps.jobs.listActive(),
    tickAt: deps.clock.now(),
  }));
  const totals = {
    timedOutOffers: 0,
    openedWaves: 0,
    escalatedJobs: 0,
    exhaustedJobs: 0,
    deferredJobs: 0,
  };

  for (const job of active) {
    const outcome = await runner.write((deps) => tick(withTickClock(deps, job.id, tickAt), input));
    totals.timedOutOffers += outcome.timedOutOffers;
    totals.openedWaves += outcome.openedWaves;
    totals.escalatedJobs += outcome.escalatedJobs;
    totals.exhaustedJobs += outcome.exhaustedJobs;
    totals.deferredJobs += outcome.deferredJobs;
  }

  return { tickAt, ...totals };
}
