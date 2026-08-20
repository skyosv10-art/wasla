/**
 * The two production-side injectables the core deliberately does not own:
 * wall-clock time and identifier generation.
 *
 * `channel-core` ships only deterministic fakes (`FixedClock`,
 * `SequentialIdGenerator`) so its tests can assert exact timestamps and ids.
 * Real time and real UUIDs are a *composition root* concern, which is why they
 * live here and not in the core: nothing above this file may reach for
 * `Date.now()` or `randomUUID()` directly, otherwise a use case stops being
 * testable (DEFINITION_OF_DONE — deterministic tests).
 */

import { randomUUID } from "node:crypto";

import type { ClockPort, IdGeneratorPort } from "@wasla/channel-core";

/** Wall-clock time, ISO-8601 with milliseconds and a `Z` suffix. */
export class SystemClock implements ClockPort {
  now(): string {
    return new Date().toISOString();
  }
}

/** UUID v4 from Node's crypto — no extra dependency (ADR-003). */
export class CryptoIdGenerator implements IdGeneratorPort {
  uuid(): string {
    return randomUUID();
  }
}
