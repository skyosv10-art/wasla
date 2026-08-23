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
import type { DispatchJob, DispatchOffer, DispatchOfferDetail } from "../domain/model.js";
import { isTerminalJobStatus } from "../domain/state-machine.js";
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

export interface ReadOfferInput {
  readonly offerId: string;
  readonly traceId?: string;
}

/**
 * Read the offer and the owning job without changing either one.
 *
 * A missing offer (or an impossible orphan in a non-Postgres adapter) is `null`,
 * not an exception: the HTTP boundary owns translating a resource absence into 404.
 * `standing` belongs here because it is a fact derived from domain state, not from
 * a route's view of the wall clock. The tick is the sole operation that advances an
 * expired offer, so an overdue-but-unticked `offered` row correctly remains standing.
 */
export async function readDispatchOffer(
  deps: DispatchDependencies,
  input: ReadOfferInput,
): Promise<DispatchOfferDetail | null> {
  const offerId = assertUuid("offer_id", input.offerId, input.traceId);
  const offer = await deps.offers.find(offerId);
  if (offer === null) return null;

  const job = await deps.jobs.find(offer.jobId);
  if (job === null) return null;

  return {
    ...offer,
    orderId: job.orderId,
    orderPublicId: job.orderPublicId,
    orderType: job.orderType,
    vehicleClass: job.vehicleClass,
    jobStatus: job.status,
    standing: offer.status === "offered" && !isTerminalJobStatus(job.status),
  };
}
