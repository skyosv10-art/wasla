/**
 * Reads.
 *
 * Separated from the writes because they answer a different question and carry a
 * different risk: a read is the endpoint an operator refreshes during an incident, so
 * it must never mutate anything — not even to "fix" an offer whose deadline has passed.
 * A read that resolved expired offers would make the counters in `TickResult` depend on
 * how often somebody opened a screen.
 *
 * Offers are returned oldest-first so the wave order is visible without a client
 * sorting by a timestamp it may format differently.
 */
import { jobNotFound } from "../domain/errors.js";
import type { DispatchJob, DispatchOffer } from "../domain/model.js";
import { assertUuid } from "../domain/validation.js";
import type { DispatchDependencies } from "../ports.js";

export interface ReadJobInput {
  readonly jobId: string;
  readonly traceId?: string;
}

export async function readDispatchJob(
  deps: DispatchDependencies,
  input: ReadJobInput,
): Promise<DispatchJob> {
  const jobId = assertUuid("job_id", input.jobId, input.traceId);
  const job = await deps.jobs.find(jobId);
  if (job === null) throw jobNotFound(input.traceId);
  return job;
}

export async function listDispatchOffers(
  deps: DispatchDependencies,
  input: ReadJobInput,
): Promise<readonly DispatchOffer[]> {
  const jobId = assertUuid("job_id", input.jobId, input.traceId);
  const job = await deps.jobs.find(jobId);
  // 404 on the job rather than an empty list: "this job has no offers yet" and "this
  // job does not exist" are different facts, and a client that cannot tell them apart
  // will retry forever against a typo.
  if (job === null) throw jobNotFound(input.traceId);
  const offers = await deps.offers.listForJob(jobId);
  return [...offers].sort((left, right) =>
    left.offeredAt === right.offeredAt
      ? left.id.localeCompare(right.id)
      : left.offeredAt.localeCompare(right.offeredAt),
  );
}
