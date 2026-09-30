# CLM-0417 — RISK-0013: idempotent replay returns the same bytes

**Date:** 2026-09-30 · **Branch:** `fix/clm-0417-risk-0013-canonical-replay` · **Authority:** written mandate "MASTER REPAIR & MERGE", 2026-09-30

## Root cause
The first answer to an idempotent write is serialized from the object the route built.
The replay is serialized from the stored `response_body JSONB`, and JSONB does not keep key order.
The fields were equal but the bytes were not.

## Fix
There is no schema change and no contract change. JSON object key order carries no meaning.
Every JSON reply in the eight services that keep idempotent answers in JSONB now goes through one canonical serializer (`app.setReplySerializer(canonicalJson)`):
- marketplace
- delivery
- dispatch
- drivers
- matching
- negotiations
- reputation
- subscriptions

That serializer sorts keys at every depth. Otherwise it keeps `JSON.stringify` semantics: `toJSON` is honoured, `undefined` is dropped, and non-finite numbers become `null`. The first answer and the replay therefore pass through the same function and come out as the same bytes by construction.

The request fingerprint (`canonical` in marketplace) is unchanged, so stored request hashes stay valid.

## Measured
- **Marketplace `idempotency-replay.integration.test.ts`:** the new `replay.body === first.body` assertion **fails 8/11 with the serializer line removed** and passes 11/11 with it.
- **Byte assertions added next to every `replay.json() == first.json()` in the tree:** subscriptions ×4, marketplace ×3, drivers ×1, delivery ×1.
- **Phase-11 exit gate:** `replay.text === first.text` over real HTTP; this is the assertion that originally exposed the risk.
- **Local PostgreSQL 17.11:** every integration and e2e leg of the eight services is green (`pg17-local-summary.txt`). Unit suites are green and `tsc` is clean in all eight.
