/**
 * In-memory reputation bridge for testing and local development.
 * Production calls the reputation service's POST /reputation/facts endpoint
 * (Postgres adapter deferred to integration review).
 */

import type { ReputationBridgePort } from "../ports.js";

export class InMemoryReputationBridge implements ReputationBridgePort {
  readonly recordedFacts: Array<{
    ticketId: string;
    subjectPublicId: string;
    orderPublicId: string | null;
    resolutionReason: string;
    recordedAt: Date;
  }> = [];

  async recordDisputeResolved(params: {
    ticketId: string;
    subjectPublicId: string;
    orderPublicId: string | null;
    resolutionReason: string;
  }): Promise<void> {
    this.recordedFacts.push({
      ...params,
      recordedAt: new Date(),
    });
  }

  /** Test helper — reset. */
  reset(): void {
    this.recordedFacts.length = 0;
  }
}
