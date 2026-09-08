/**
 * @wasla/contracts-search — Search domain event types (Event Contract).
 *
 * The search service publishes events about its OWN lifecycle (index built,
 * rebuilt, degraded), NOT marketplace domain events — those are CONSUMED
 * (input), not produced. Marketplace domain events belong to the
 * marketplace service contract (@wasla/contracts-marketplace).
 *
 * Versioned: any backward-incompatible change requires v2 + ADR.
 */

export interface SearchEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "search-service";
  aggregate: {
    type: "index";
    id: string;
  };
  trace_id?: string;
}

export interface SearchIndexRebuiltV1 extends SearchEventEnvelope {
  event_type: "search.index.rebuilt";
  event_version: "v1";
  payload: {
    index_id: string;
    documents_indexed: number;
    duration_ms: number;
    source: "bootstrap" | "incremental" | "manual";
  };
}

export interface SearchIndexDegradedV1 extends SearchEventEnvelope {
  event_type: "search.index.degraded";
  event_version: "v1";
  payload: {
    index_id: string;
    reason: "ingestion_lag" | "rebuild_failed" | "partial";
    last_healthy_at: string;
  };
}

export type SearchDomainEvent =
  | SearchIndexRebuiltV1
  | SearchIndexDegradedV1;
