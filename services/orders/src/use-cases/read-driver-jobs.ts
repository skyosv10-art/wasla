/**
 * Read a driver's job history (earnings screen · M3-02 gap closure).
 *
 * The driver mini-app's earnings screen calls `GET /orders/drivers/:driverPublicId/jobs`
 * with `status=completed` and a `period` (today | week | month). The route handler
 * computes the `since` timestamp from the period and calls this use case, which
 * delegates to the repository's `listJobsByDriver` — a read-only projection across
 * orders + assignments + stops + history.
 *
 * The driver is identified by the beneficiary claim in the service token, which
 * the route handler has already verified against the `:driverPublicId` path
 * parameter. The use case itself never trusts a caller-asserted id.
 *
 * `listJobsByDriver` returns only orders the driver was assigned to (accepted
 * assignment) whose status is terminal (`completed`, `driver_cancelled`,
 * `customer_cancelled`). Non-terminal orders are invisible: a job in flight has
 * no earnings row.
 */

import type { DriverJobHistoryEntry } from "../domain/model.js";
import type { OrderDependencies } from "../ports.js";

export interface ReadDriverJobsInput {
  readonly driverPublicId: string;
  readonly since: string;
  readonly traceId?: string;
}

export async function readDriverJobs(
  deps: OrderDependencies,
  input: ReadDriverJobsInput,
): Promise<DriverJobHistoryEntry[]> {
  return deps.repository.listJobsByDriver(input.driverPublicId, input.since);
}
