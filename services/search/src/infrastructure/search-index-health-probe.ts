/**
 * Readiness probe adapter over the derived read model (ADR-025 §5 · RISK-0030).
 *
 * ## Why a COUNT and not `SELECT 1`
 *
 * `SELECT 1` proves the connection pool is alive; it does NOT prove the search
 * read model exists. A service pointed at a database where `search_product_index`
 * was never migrated would answer `SELECT 1` happily and then fail every single
 * search — exactly the class of lie this probe was added to end. The probe
 * therefore touches the real table, and a missing table is an unreachable index.
 *
 * ## Why it never throws
 *
 * A probe that throws forces every caller to own error translation. This one
 * returns `index_reachable: false` and lets the HTTP layer decide the status
 * code (`503 SEARCH_INDEX_DEGRADED`). The failure is logged with its cause so a
 * red probe can be diagnosed without reproducing it.
 *
 * ## Declared limits
 *
 * - **Reachability, not freshness.** A reachable index that is hours behind the
 *   relay reads as ready. Lag-aware readiness needs a checkpoint age budget and
 *   is tracked as RISK-0032 — not silently implied by a green probe.
 * - **An empty index is READY, not degraded.** Zero documents is the truthful
 *   state of a new deployment before the first relay run; failing readiness on
 *   it would deadlock a cold start that can only fill the index once it is up.
 *   `indexed_documents: 0` is reported so a caller can tell empty from full.
 */

import type { Pool } from "pg";

import type { SearchIndexHealth, SearchIndexHealthPort } from "../ports.js";

/**
 * Counting every row is O(table) in PostgreSQL. The probe runs on every
 * orchestrator poll, so it counts a bounded sample instead: enough to tell
 * "empty" from "populated" without a sequential scan of the whole index.
 */
export const PROBE_SAMPLE_LIMIT = 1000;

export class SearchIndexHealthProbe implements SearchIndexHealthPort {
  constructor(
    private readonly pool: Pool,
    private readonly logger: Pick<Console, "error"> = console,
  ) {}

  async probe(): Promise<SearchIndexHealth> {
    try {
      const { rows } = await this.pool.query<{ sampled: string }>(
        `SELECT count(*)::text AS sampled
           FROM (SELECT 1 FROM search_product_index LIMIT ${PROBE_SAMPLE_LIMIT}) AS sample`,
      );
      const sampled = rows.length > 0 ? Number(rows[0].sampled) : 0;
      return { index_reachable: true, indexed_documents: sampled };
    } catch (error) {
      this.logger.error("search index readiness probe failed", error);
      return { index_reachable: false, indexed_documents: null };
    }
  }
}
