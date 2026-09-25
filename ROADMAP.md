# WASLA MARKET — Roadmap

**Repository:** `skyosv10-art/wasla` (this repository is WASLA MARKET)
**Last updated:** 2026-09-25 (`CLM-0351` — M5-14 review 4/N: E2E exit gate package (tenant isolation + SLA proof + audit trail + lifecycle enforcement). Prior: review 3/N merged PR #465, review 2/N merged PR #464, review 1/N merged PR #463).
**Last milestone (M1-05 — the authorization policy matrix):** `M1-04` answers *is this request from a service the system knows?* Nothing in the repository answered *is this service entitled to what it carries?* — and the vacuum was a **correct decision half-implemented**: `packages/service-auth/src/{enforce,index,token}.ts` and `services/orders/src/http/service-identity.ts` each state in prose that the gateway must not hold a role→scope matrix, and each names `M1-05` as its owner. So the matrix had a declared home and no existence, and `mintServiceToken` passed `scp` through without asking about entitlement. Added: `packages/authz-policy` as the single source (80 enforced operations, 10 production roles with 18 grants, 8 isolated test-fleet roles, 16 classified owner/tenant bindings, pure decision functions), 27 rejection-heavy tests across all three dimensions (`owner`/`role`/`tenant`), and governance check 16 wired into the single entry point — drift-proof in **both** directions, with 16 mutation cases proving the guard bites.
**The board's number was never measured, and it is corrected by addition, not erasure:** the `M1-05` row said *inventory of 107 operations*. The live measurement is **8 boundaries · 89 registered routes · 80 enforced operations · 9 `OPEN` routes · 64 enforced scopes · 0 routes with neither a scope nor `OPEN`**. The `107` stays written on the board because it is the prior evidence; the measurement is written beside it with the guard that reproduces it.
**Two gaps the measurement surfaced that were not on anyone's list — `RISK-0042`:** (1) **ownership is caller-asserted.** `assertOwner()` compares `order.customerPublicId` against the `X-Customer-Public-Id` header, whose **shape** is validated and whose truth is not — and the token carries `sub`/`aud`/`scp` with **no beneficiary identity at all**, so `TOKEN_BOUND_OPERATION_COUNT = 0` out of 80. (2) **tenant membership is never checked.** `storeSlug` is read from the path and handed to the repository in **eleven** marketplace routes, so a holder of `marketplace:staffWrite` can write staff into *any* store. Both are recorded by addition; `RISK-0026` (resource identity in the query string) is **not** claimed closed.
**The limit of the green, stated where it cannot be missed:** **green here means "no drift in configuration"; it does not mean "an over-privileged token cannot be minted."** Runtime enforcement at the signer was rejected for this wave on measurement, not taste: nine `*-e2e` packages sign with wider-than-any-grant scope sets **deliberately** — one of them signs with a *production* role — so the barrier would fail all nine, and rewriting them lies outside the scope `CLM-0177` reserved. The alternative that was **explicitly refused** is softening the barrier with an environment or name exemption: a barrier with a back door is measured by the widest thing it admits. What this wave does not close now has a board item with a measured exit criterion (`M1-05B`), not a footnote.
**A guard cannot enforce what it cannot read, and three of its own mutation cases were lying:** `OPERATION_BINDINGS` rows are written **flat rather than `.map()`-generated** so the static guard can read them, and the bot role — a template literal `${config.bot}-bot` — is expanded over the `BOT_KINDS` declared in the contract. Writing the mutation suite then caught **three cases that mutated nothing** (targeting strings absent from the file) and therefore reported green falsely, and a fourth that exposed **real blindness in the guard**: a `split` anchored on a name *prefix* also matched `PRODUCTION_GRANTS_RENAMED`, so the guard read a matrix whose name had been removed and still passed. The anchor is now a word-boundary match and both rename cases are permanent.

**Previous milestone (M0-22B — branch protection on `main`, which fell with the billing block, is restored and measured after the write, not before it; the acceptance item's second half is in force again)
**Earlier milestone (M0-22B, second half):** the protection set on 2026-09-05 (27 required contexts, proven to block with `405` twice) fell silently with the billing block on 2026-09-13 — `RISK-0036` recorded a measured absence (`protected:false`, `/protection` answering `404` after the repo went public), with remediation reserved to the owner: upgrade to Pro or make the repository public. The repository is now public and the block has lifted, so the declared constraint dissolved — and the protection was **restored first, before any new work**, so that this cycle's own PR passes under the enforcement it reinstates. `PUT /branches/main/protection` was sent from the snapshot body in [`MERGE_BLOCKING.json`](docs/12-testing/MERGE_BLOCKING.json), then **measured after the write**: 31 required contexts matching the expanded `ci.yml` job list letter-for-letter (27 grew to 31 with the `search` and `delivery` items), `strict:true`, `enforce_admins:true`, `protected:true` — evidence in [`ci-evidence/2026-09-14T215000Z-m0-22b-protection-restored/`](docs/12-testing/ci-evidence/2026-09-14T215000Z-m0-22b-protection-restored/README.md). The guard's own live question now answers green (exit 0): matching the pipeline, proven by `405`, asked live. One defect was caught by the post-write measurement itself: the first `PUT` sent an empty protection object (a client-side path error reading the snapshot's root instead of its `.protection` member) and GitHub answered `200` — protection with **zero** required checks. Had the `200` been accepted as proof, `main` would have been "protected" by nothing; the re-measure showed `contexts: 0`, and the second `PUT` with the correct body fixed it. Recorded in the evidence README rather than erased: `200` from `PUT` is not evidence of protection; the measurement after the write is what separates "sent" from "in force". `RISK-0036` stays `open` (closing it is the owner's call, §9) with the measured update; the M0-22B status stays `Ready for Gate` — what was restored is the *force* of the third evidence, not a new status.

**Previous milestone (M0-40 — every "CI verdict unknown" claim in the repository is now audited against the live API on every gate run, and the phrase turned out to mean two different things)**
**Milestone (M0-40):** the account block lifted, and the repository was left holding rows that say *we do not know* in a time where knowing had become possible — with nothing obliging anyone to revisit them. Deleting those sentences would be deleting evidence, so they were kept and made **auditable instead**: [`docs/12-testing/CI_VERDICT_AUDIT.md`](docs/12-testing/CI_VERDICT_AUDIT.md) carries every fingerprint with its classification and its run, and check 15 ([`scripts/checks/audit-ci-verdicts.sh`](scripts/checks/audit-ci-verdicts.sh)) re-measures **every row against GitHub on every gate run** — a recorded classification that diverges from the live measurement fails the gate.
**What the measurement actually found, and it contradicts the earlier summary:** "NOT VERIFIED" is an **overloaded phrase** in this repository. Some of it is about the **production layer** (M0-15, nothing deployed to measure) and some about **merge authority** (M0-22A, a real 200 on a real merge), neither of which is a claim of ignorance about a CI verdict — so a guard keyed on the bare phrase would demand audits for verdicts that never existed, which is a false alarm people learn to ignore. The guard therefore keys on an explicit marker in the line itself (`account_billing_blocked`, `JOB DID NOT START`, `Jobs Started: 0`). Four fingerprints merged during the block (`c2134ad`, `402140c`, `0dbd333`, `6b1faa6`) each have a run with **31 jobs of which zero started** — their "unknown" is **true and stays**, and no retroactive verdict is obtainable for them: re-running today judges today's code, not that push. Four others (`d2bf46f`, `bee9ed7`, `bea99c2b`, `e31b2ca`) have **real green verdicts**, so the blanket reading "no item has a verdict" was wrong.
**Two defects the guard found in itself before it was trusted:** (1) the GitHub API **does not match an abbreviated sha** and answers with zero runs — an answer that reads as "no verdict" and would have greened a false claim of ignorance; `3cb44c35` returns zero runs abbreviated and run 34877247715 (`success`) in full. (2) Eleven-digit decimal tokens on the board (`34065473979`) are **run ids, not commits**, and every digit is inside the hex range, so they pass any pattern; they are now resolved through git, then through the API, and an unresolvable token is a **failure** where a judgement is possible and a **declared partial** where it is not. Governance suite 307 → **322 cases**; static `governance_checks` 14 → 15. `RISK-0039` is narrowed, not closed: green on `main` is measured twice over, but the code merged during the block still never passed a gate **on the day it merged** — the aggregate is green, not each push — and with `RISK-0036` a verdict is read without blocking a merge.

**Previous milestone (M0-39 — a mandatory board check could disable itself by nothing more than a change of working directory, and CI is the only thing that saw it)**
**Milestone (M0-39):** the claim-release push for M0-38 touched **ledgers only, no code** — and CI still turned red in two synthetic cases that are green on every local run. Cause: `validate-launch-board.sh` reads the board from its argument `$1`, then cross-checks the board's IDs against `Work Item(s)` in a **hard-coded relative** `docs/16-progress/TASK_LOG.md`. From the repository root — which is where CI runs — a one-row synthetic board was compared against the *real* task log, so the guard failed truthfully and meaninglessly. From anywhere else — which is where the local harness runs — `[ -f ]` was false and **the whole cross-check vanished silently**. The false red is the lesser half: a mandatory check that cancels itself on a `cd` is worse than a missing one, because a missing guard is visible. The closing line `OK: Work Item references … match` was also printed *outside* the condition, announcing a match even when no log had been read. Fixed at the root: the log is now derived from the **board's own directory**, a board named `LAUNCH_EXECUTION_BOARD.md` with no sibling log is a **failure, not a skip**, and the success line names the log it actually compared. Five new cases (302 → **307**, 0 failing) pin all three claims, including rejection from `/` — the assertion that had never been measured. No gate was disabled, no test loosened, no case silenced: the two red cases stayed as they were and now pass because the guard became correct.
**Pattern, recorded twice in one day:** `rg` missing on the runner (M0-38) and the working directory here. Both are the same species — **a guard depending on something in its environment that it neither declares nor verifies, and going quiet when that environment changes.** Standing rule from now on: any guard reading a file by a fixed relative path is suspect until its independence from the working directory is measured, and a missing mandatory input is a failure rather than a skip.

**Previous milestone (M0-38 — the work-claim ledger can no longer contradict itself, one reader answers "is this claim active?" for both guards, and three guards that used to disable themselves silently now fail closed; **and GitHub Actions produced its first real verdict since 2026-09-13**)
**Last milestone (M0-38):** running the governance gate *with network access* — not reading code — turned check 4 red: two claims (`CLM-0078`, `CLM-0079`) were still `Active` while their branches were deleted, and one of them already carried a **measured release note** written the same day. The ledger, which is the only source of path ownership, was asserting a thing and its opposite, because the guard read the status column and never read the release notes beside it. Locally, without network, that check skips silently — so the defect only existed where it mattered. Four holes were closed, and three of them were found by *running* things, not by planning: (1) a door that pairs every `Active` row with release notes in both directions, network-free, with diacritics normalised, keeping the precision limit that a note about *another* claim's release must not count; (2) **one reader** (`scripts/checks/lib/claims_rows.sh`) after the two guards were measured disagreeing — one matched the status exactly, the other by substring, and the second one's header claimed they were identical, so *writing the release evidence re-created the defect*, and `Paused` was ignored entirely by the first even though it locks scope; (3) **fail-closed imports**, because wiring that shared reader in flipped two existing mutation cases to "pass": the synthetic stage copied only the guard file, the import failed, the row list came back empty, and the guard cheerfully reported "no active claims" and exited green — a guard that cancels itself on a missing file is more dangerous than a missing guard, since the absence is visible and the self-cancellation is not; and (4) the one that only CI could find — see below.
**CI, measured 2026-09-14T17:16Z:** the account block described in `RISK-0039` has lifted. Run [34873584143](https://github.com/skyosv10-art/wasla/actions/runs/34873584143) actually **started**: 30 jobs with real runner ids and executed steps, not `steps: []` / `runner_id: 0`. Its verdict was **red for a real defect**: the test-invocation guard's first door scanned with `rg … 2>/dev/null || true`, and `rg` is not installed on the GitHub runner — so the missing tool produced an empty offender list and the door passed green on nothing, in the one place that matters. That case is green on every local run; the guard whose stated purpose is to stop "local disagreeing with CI" was itself disagreeing with CI. The scan now runs in `python3` inside the same file that scans `package.json` (one scanner, one fewer tool in the trust path, and a scan failure is an error rather than a skip), and a new case re-runs the same mutation with `rg` crippled in `PATH`. Governance suite 292 → **302 cases, 0 failing**; `scripts/verify.sh` green; the gate green **with** network. Then run [34876097859](https://github.com/skyosv10-art/wasla/actions/runs/34876097859) came back **31/31 jobs successful — the first genuinely green CI verdict in this repository since 2026-09-13.** `RISK-0039` stays open until a green verdict is measured on `main` and the merges marked "NOT VERIFIED" during the block are reviewed; `RISK-0036` (no branch protection) is still open, so a verdict is now *read* but does not yet *block* a merge.

**Previous milestone (M0-34 — a migration upgrade is now proven against a database that already holds rows, and a guard makes that proof mandatory for every non-baseline migration)
**Last milestone:** the last remaining gap in `RISK-0020` was that every migration proof ran against an **empty** database: apply, roll back, re-apply. Production databases are never empty, and the difference is not theoretical — `drizzle-kit` emitted `ALTER TABLE … ADD COLUMN "expires_at" timestamptz NOT NULL;` as a single statement in `services/delivery/drizzle/0001`. That succeeds on an empty table and fails with `23502` on a table holding one row; only a human reviewer caught it. Two layers now close that: a live proof that applies baseline migrations, **seeds rows with known values**, applies the remaining migrations **to the populated database**, and asserts every row survives with the backfill equal to `created_at + interval '24 hours'` exactly — then rolls back a step and asserts the rows are still there. And a fourth gate in `validate-migrations.sh` rejects any non-baseline migration that has no declared upgrade proof, and rejects the single-statement `ADD COLUMN … NOT NULL` pattern outright. Nine mutation cases prove the gate both rejects and accepts. Measured locally on PostgreSQL 18.6; **CI is still account-blocked (`RISK-0039`), so no gate verdict exists and `RISK-0020` stays open**.

**Previous milestone:** `scripts/ci-evidence.sh` stopped restating a conclusion as a reason. It had declared that GitHub "publishes no counterpart to `failure_reason`", so a job that never started was recorded with `reason = failure` — a word that reads as "the code failed" when nothing ran at all. That declared limit was measured false, and the cause is now read literally from the check-run annotations.

**Earlier milestone:** the inventory-conflict flag ledger gained a write route: `POST /delivery/inventory-conflicts/{flag_id}/acknowledgement` records the acknowledger from the **proven service identity alone** — never from the request body — and the first acknowledgement wins in a single statement (ADR-026 §4.20).

## What this project is

WASLA MARKET is the commerce system of WASLA. It is a permanently independent
repository with its own code, data, tests, CI and releases.

```
MARKET creates the work.  MOVE executes the work.  CORE coordinates it.
```

| System | Repository | Role |
|---|---|---|
| WASLA CORE | `noor-seez/wasla-core` | shared operating layer and coordinator |
| WASLA MOVE | `noor-seez/ceezr` | field execution |
| WASLA MARKET | `skyosv10-art/wasla` | this repository — commerce |

No monorepo, no merged repositories, no shared runtime package, no
cross-database access between the three.

## Ownership boundary

**MARKET owns:** merchants, stores and store staff, products, categories and
catalog, inventory and reservations, Commercial Orders and order items,
marketplace search, commercial review content, B2B and partner commerce,
customer commerce surfaces, store-level pricing and product-specific rules.

**MARKET does not own:** identity, sessions, principals, roles and permissions,
organizations and tenancy, payments, wallets, ledger, settlement,
subscriptions and entitlements, reputation scoring, notification delivery,
channel abstraction, fulfillment coordination (all CORE) — nor drivers,
vehicles, fleets, dispatch, matching, tracking, proof of delivery, rides or
delivery execution (all MOVE).

**Canonical model:** a Commercial Order is a commercial commitment owned here.
It is never an Operational Job and never a Ride.

## Current state of this repository (observed, not assumed)

- pnpm workspace. `services/`: analytics, audit, auth, billing, chat,
  compliance, customers, delivery, dispatch, drivers, fraud, geography,
  identity, marketplace, matching, negotiations, notifications, orders,
  partners, referrals, reputation, rides, search, subscriptions, support,
  translation.
- `packages/`: contracts, events, channel-core, channel-postgres,
  telegram-adapter, bot-runtime, service-auth, auth-sdk, telemetry, i18n,
  errors, config, ui, test-utils, and a set of `*-e2e` suites.
- `bots/`, `apps/`, `infra/`, `docs/`, `scripts/`, `.gitlab/`, `CODEOWNERS`.
- One GitHub workflow: `.github/workflows/ci.yml`, plus `.gitlab-ci.yml`.

Several service folders here own domains that the final architecture assigns
elsewhere: `drivers`, `dispatch`, `matching`, `rides`, `delivery` belong to
MOVE; `identity`, `auth`, `billing`, `subscriptions`, `notifications`,
`reputation`, `referrals`, `geography`, `audit`, `compliance`, `support` belong
to CORE. They stay in place until their replacement is proven — being present
today is not a claim of ownership.

## Done

- [x] Roadmap established at the repository root.
- [x] Roadmap-freshness gate (`scripts/check-roadmap.mjs` +
      `.github/workflows/roadmap.yml`): a push that changes implementation and
      does not update this file fails CI.
- [x] Gate proven on a live CI run: run "Roadmap freshness" on commit
      `2cb88e4c` failed with
      `ROADMAP.md was not updated alongside implementation changes:
      - .github/workflows/roadmap.yml`.
      That failure is the gate correctly refusing its own bootstrap commit,
      which added the workflow without touching ROADMAP.md. The commit that
      updates this file passes.

Nothing else has been changed in this repository by the WASLA integration work.

## In progress

- **M2-01 — claim `CLM-0195`: one container image, an SBOM and a vulnerability gate — IN PROGRESS.**
  Measured before any edit (2026-09-16): the repository had **no Dockerfile, no SBOM and no image
  scan** — the roadmap item was a heading with zero artifacts, and `infra/docker/` held nothing.
  An open attempt existed (**PR #205**) and it was **not** progress: its Dockerfile copied
  `services/*/dist` while every service's `start` command is `node --import tsx src/…` and the
  workspace packages export `src/*.ts`, so the image **could not boot**; its SBOM script fell back
  **silently** to a near-empty file when `syft` was absent; **no CI job built the image**, so none
  of that could ever show; it used a claim (`CLM-0194`) owned by another item and an ADR number
  (`ADR-032`) reserved for the config schema. It is **closed with a written reason and its evidence
  is preserved**, and the work was redone from the root. Delivered: a single three-stage
  `Dockerfile` on a **digest-pinned** base whose Node version **equals** `NODE_VERSION` in CI,
  running as `USER node`, with the package chosen **at run time** (argument or `WASLA_SERVICE`) so
  16 runnable packages share one build file; `scripts/container/` (tools installed by pinned
  version **and sha256** from a single `tool-pins.env`, with no third-party action and no
  `curl | sh`; contract verification **inside the image**; CycloneDX SBOM with a component floor and
  **no silent fallback**; two builds compared by **purl set**, not bytes, because timestamps make a
  byte comparison lie red; a `HIGH,CRITICAL --ignore-unfixed` gate with **no exceptions file**); the
  `image-supply-chain` job in `ci.yml`, whose context was added to live branch protection and then
  **re-measured from the API** (32 required contexts, raw response committed); and **check 19** in
  the single entry point with nine gates and **16 mutation cases that must bite**, each proving it
  changed bytes with `cmp`. Two defects the measurement surfaced that were on no list: **`RISK-0048`**
  — `services/delivery` and `services/search` had a production `src/http/server.ts` and four
  blocking CI legs **but no `start` script**: tested yet unshippable, invisible to `tsc`, to tests
  and to every guard. Fixed, and the run contract is now guarded **in both directions**.
  **`RISK-0047`** — because the packages export TypeScript, the runtime image necessarily carries
  dev dependencies (`tsx` is a runtime requirement here); trimming needs a real compile path and a
  wider scope, so it is recorded as **open debt and the image surface is not called trimmed**.
  **First real CI verdict: RED — and it is recorded, not smoothed over.** Run
  [35145160740](https://github.com/skyosv10-art/wasla/actions/runs/35145160740) failed in three jobs.
  The image itself **did build**, its in-image contract passed and both SBOMs matched; what blocked
  was **what the build revealed**. Three root causes, each fixed at the root — no gate disabled, no
  `continue-on-error`, no widened `--ignore-unfixed`, no exceptions file, no weakened mutation case:
  (1) a **silent mutation** — the gate-4 case matched `^RUN corepack enable$` byte-for-byte and a
  later Dockerfile hardening changed that line, so the mutation stopped mutating and the case passed
  locally on nothing; the suite's own `cmp` byte-diff guard caught it (420 pass · 1 fail) and the
  mutation is now anchored to the line **prefix**. The bitter lesson is written down: the local green
  was measured **before** that hardening, so it was not measuring the tree that was pushed.
  (2) **17 fixable HIGH/CRITICAL OS vulnerabilities** on the digest-pinned base (`libcrypto3`,
  `libssl3`, `musl`, `zlib`) — a digest pins **what** you build on and never brings patches published
  after the base was sealed; fixed with `apk upgrade --no-cache`, and the build-time dependency this
  introduces is declared as **`RISK-0049`**, not hidden. (3) **49 fixable HIGH/CRITICAL findings whose
  sole source was the `corepack` cache shipped into the runtime layer** (`pnpm@9.15.9` alone carried
  eleven, plus `pacote`, `sigstore`, `tar`, `ip-address`, `glob`, `minimatch`, `cross-spawn`,
  `brace-expansion`) — **none of them in the repository tree**, which carries the patched versions.
  A service image needs no package manager, so it was removed from the runtime layer:
  `scripts/container/resolve-package.mjs` resolves the package with `node` from `pnpm-workspace.yaml`
  and the entrypoint runs its own `scripts.start` — the source of truth is unchanged and the attack
  surface is gone. `RISK-0047` is **updated by measurement, not closed**.
  **Second CI verdict: RED again — on two targets the first two were hiding.** Run
  [35151578239](https://github.com/skyosv10-art/wasla/actions/runs/35151578239): `governance-guard`
  and `verify` green, `image-supply-chain` still red — but the scan now measures **alpine = 0** and
  the `corepack` cache = **0**, which is the proof that the fixes above actually worked. What blocked
  was 42 findings in two newly visible targets. (4) **The `npm` bundled with the node image was being
  shipped and never invoked** (`tar@6.2.1` critical, plus `pacote`, `sigstore`, `glob`, `minimatch`,
  `brace-expansion@2.0.1`, `cross-spawn`, `ip-address`): removed from the runtime layer — a tool that
  is never called is attack surface for nothing. (5) **22 fixable findings inside the pre-compiled
  `esbuild` Go binary** (`stdlib v1.23.12`, including a critical `crypto/tls` flaw): this repository
  cannot fix it — the patch lives in Go and in esbuild's own build, and the binary is present only
  because `tsx` is a runtime requirement (`RISK-0047`). The three honest options were: disable the
  gate (a lie), keep it permanently red with no remedy (it gets silenced within a week and the whole
  gate dies), or a **narrow, time-boxed, risk-linked, machine-enforced exception**. The third was
  chosen and it **increases** enforcement: `docs/07-security/IMAGE_VULN_EXCEPTIONS.yaml` plus **gate
  10 of check 19**, which fails the push on any entry without explicit paths, without an expiry,
  with an expiry beyond 90 days or already expired, or without a risk id **declared as a line** in
  `RISK_REGISTER.md` — and on any `scan-image.sh` that stops passing the file or starts passing it to
  the full report. The full report is still generated **without** the file, so all 22 findings stay
  measured and published; nothing is fixed and nothing is claimed fixed (`RISK-0050`, expiry
  `2026-12-15`, real remedy is compiling TypeScript and dropping `tsx` in `M2-02`). The mutation
  suite then caught **two holes in that new gate before the push** — a risk-id reader that accepted
  any mention anywhere, and a mutation that stripped only the first of two risk references — both
  fixed and recorded (8 new cases; 429 total, 0 failing).
  **Third CI verdict: GREEN — measured, not assumed.** Run
  [35156630802](https://github.com/skyosv10-art/wasla/actions/runs/35156630802) (`aa2d824`): **all 32
  required jobs green**, including `image-supply-chain` for the first time in the repository's
  history — two independent builds, 548 components each, identical purl closure, the in-image
  contract proven from inside (non-root, 16 packages resolved without a package manager). The full
  report, still generated **without** the exceptions file, measures **48** findings (CRITICAL=1,
  HIGH=21, MEDIUM=23, LOW=2, UNKNOWN=1) down from 77: removing `npm` eliminated 29 outright, and the
  remaining 22 blocking findings are the `esbuild` binary alone — exactly the number of declared
  exceptions, so nothing extra is silently excluded, and the job prints the exception, its risk ids
  and its expiry into the run log itself. Not claimed: the image is **not** called secure; the most
  that is said is that no HIGH/CRITICAL finding with a published fix remains **outside one declared,
  expiring, guarded exception** as of the measurement; those 22 are **not fixed**, the real remedy is
  dropping `tsx` from runtime (`M2-02`), and the `2026-12-15` expiry turns the gate red by itself if
  that is not done. Promotion to `Completed` remains the program owner's alone.
  **Merged into `main`** as squash [`66fef14`](https://github.com/skyosv10-art/wasla/commit/66fef14) (PR #208) on the owner's
  standing mandate to merge anything green, and the cycle was closed in a separate §8.1 batch: `CLM-0195` released,
  the board row moved to **Ready for Gate** — **not** `Completed`, which is the program owner's call alone (§9).
  On `main` right after the merge, `WASLA CI` read **RED** for one measured reason — check 4 refusing an active claim
  whose branch the merge had deleted — and that closeout batch is the remedy, not a weakened guard.
  Docs: `ADR-033`, `docs/08-infrastructure/CONTAINER_IMAGES.md` §6.2, `docs/12-testing/M2-01_GATE.md` §5.2 and §5.3.
  Not claimed: **check 19 reads configuration; it does not prove the image builds** — there is no
  Docker in the local execution environment, so the build, the in-image contract and the
  vulnerability verdict are CI's alone; the dry-run entry (`WASLA_ENTRYPOINT_DRYRUN=1`) loads each
  package's entry **without binding a port** and is **not** a boot proof; and there is no registry,
  no deployment and no `docker-compose` (that is `M2-02`). Promotion to `Completed` is the program
  owner's authority alone (§9).

- **M2-04 — claim `CLM-0194`: config schema, env registry and generated env examples — IN PROGRESS.**
  Measured before any edit (2026-09-16, repo-wide text scan): **17** raw numeric env reads in
  production code with no validator, **4** duplicated strict readers in four unrelated files,
  **no `.env.example` at all**, and `packages/config` holding only a `.gitkeep`. The board's own
  estimate ("جرد 20 variables") was low by ~3x — the real inventory is **59 variables / 157
  declared readers**; the estimate is corrected additively, not erased. Operational impact is
  named, not hypothesised: `Number("٣") ⇒ NaN`, so `DISPATCH_WAVE_SIZE=٣` yields
  `waveSize = NaN` — an assignment wave with zero drivers while `GET /dispatch/health` still
  answers **200** (`RISK-0046`, sev:high, mitigating). Delivered: one source of truth
  (`packages/config/env-registry.json`) with two **generated** artifacts (`.env.example`, 301
  lines — the first in this repo's history — and `src/registry.generated.ts`, 697 lines) that are
  never hand-edited; ten strict readers throwing a named `ConfigError` (33 tests); all 17 raw
  reads converted, with the four dispatch rules moved to
  `services/dispatch/src/config/runtime-config.ts` with a floor of 1 each (7 tests); 11 services
  consuming the package for real; and **check 18** in the single entry point with eight gates and
  eleven mutation cases. Two defects in the guard itself were found by measurement and are kept
  on record: gate 7 originally **imported** the secret placeholder from the generator, so a
  mutation writing a real secret into `.env.example` passed both gate 3 and gate 7 (a guard
  validating the generator with the generator) — fixed with an independent literal; and after the
  migration the scanner no longer saw the migrated reads, so gate 1 would have measured a shrinking
  inventory as the code improved — fixed with a `reader` mode. Docs: `ADR-032`,
  `docs/08-infrastructure/CONFIG_SCHEMA.md`, `docs/12-testing/M2-04_GATE.md`. Not claimed: the guard
  is textual/pattern-based, `packages/config/` is excluded from measurement for a written reason,
  reader *choice* is unguarded, and no boot-with-broken-env exit gate exists yet — that is what
  would close `RISK-0046`. Promotion to `Completed` is the program owner's authority alone (§9).

- **M1-08 — claim `CLM-0192`: edge abuse/error/audit controls — COMPLETED.** A shared edge-controls
  layer in `packages/service-auth/src/edge-controls.ts` provides three mechanisms:
  `EdgeRateLimiter` (token bucket on an injected clock, returns 429 + Retry-After, never
  sleeps, in-process only), `redactErrorBody` (strips sensitive headers and `wsvc2.` tokens
  from error response bodies), and `AuditEventSink` (minimal interface for security-denial
  events: authn_denied, authz_denied, rate_limited). 22 acceptance tests in
  `edge-controls.test.ts` prove: 429 after bucket exhaustion, no token/secret leakage in
  error bodies, legitimate requests pass, deterministic clock-based refill. Merged via
  [PR #201](https://github.com/skyosv10-art/wasla/pull/201), squash `a9308c9`, 33/33 CI green.

- **M1-09 — claim `CLM-0193`: threat model and security testing policy — COMPLETED.** A signed security
  review package covering M1-01..M1-08 controls, ADR-018..031, RISK_REGISTER (46 risks),
  and INCIDENTS. `docs/07-security/THREAT_MODEL.md` catalogs threats by STRIDE category
  (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation
  of Privilege) across 5 trust boundaries, classifying each as covered, tracked, new-risk,
  accepted, or out-of-scope — with every unresolved threat mapped to an existing RISK-####
  entry or an explicit rationale. `docs/12-testing/SECURITY_TESTING_POLICY.md` defines
  required negative tests (authn/authz/tenant/owner/replay/rate-limit/redaction),
  when tests must be added or re-run, what CI/governance checks prove and what they do
  not prove, and incident-triggered review rules. Non-claims are explicit: edge controls
  are primitives available, not deployment-enforced; `RISK-0042` remains open; no coverage
  tooling; no eslint.

- **M1-07 — claim `CLM-0191`: bot internal routes now enforce service identity.** The bot-runtime
  HTTP app (`packages/bot-runtime/src/http/app.ts`) had three internal routes with no service-auth
  protection: `POST /channel/messages` (the outbound exit point), `GET /channel/:bot/mini-app`, and
  `POST /channel/:bot/deep-links`. The webhook (`POST /channel/:bot/webhook`) stays protected by its
  Telegram webhook secret per ADR-007, and `/health` stays open. A new `service-identity.ts` module
  in `packages/bot-runtime/src/http/` wires `registerServiceIdentityOnFastify` from `@wasla/service-auth`
  with channel-specific scopes (`channel:message:send`, `channel:mini-app:read`, `channel:deep-link:create`),
  following the same pattern proven in all 8 service boundaries. Closes AUD-005.

- **M1-06 — claim `CLM-0190`: the published contracts now declare what the code enforces.** All
  eight published OpenAPI specs (`services/{delivery,dispatch,geography,identity,marketplace,matching,negotiations,orders}/contracts/api.openapi.yml`)
  now carry a `securitySchemes.ServiceAuth` (apiKey, header `x-wasla-service-auth`), a per-operation
  `security:` block whose scope matches the `scoped(SCOPES.*)` in the service's `app.ts`, and `401`/`403`
  responses via reusable `$ref` to each service's `ErrorResponse` — **75 enforced operations across 8
  boundaries**, every scope-to-route mapping verified programmatically. The `§5.9` inventory in
  `SERVICE_AUTH_ENFORCEMENT.md` is emptied to zero rows (markers preserved), and `RISK-0041` moves
  from `open` to `mitigating`. Two contract drifts surfaced and were fixed at the root: four contract
  packages (`dispatch`, `marketplace`, `matching`, `negotiation`) were missing `401`/`403` from their
  `HTTP_STATUS_CODES` arrays, and a fragile regex in `marketplace/http-drift.test.ts` broke under
  `ruamel.yaml`'s flow-mapping reformatting (`{ $ref: '...' }` → `{$ref: '...'}`) and was widened with
  `\s*` toleration — matching the same reference name, not weakening the guard. All 8 service suites
  green (2405 tests), full `verify.sh` green with no skips. Merged via [PR #197](https://github.com/skyosv10-art/wasla/pull/197)
  (30/30 CI green). **What this does not close:** `RISK-0041`'s final closure is the owner's call;
  the guard reads `securitySchemes`/header presence only, not per-route scope matching — that was
  verified once manually here, and no permanent guard prevents scope drift if a contract's `security:`
  block is edited without the code changing. And the main-branch CI run after merge caught two real
  debts: CLM-0190 was not released (stale-claim freshness check failed), and ROADMAP.md carried
  unresolved merge-conflict markers from an earlier squash that the PR check (comparing only
  consecutive pushes) did not surface — both fixed in this same cycle.

- **M5-13 — review 25/N, claim `CLM-0186`: a time bomb in a test, defused by reading CI red.** The
  first push of the `M1-05B` wave-4 batch (PR #190) failed two CI jobs — `db-integration (delivery)`
  and `db-integration-shared` — on `relay-acknowledgement.integration.test.ts`:
  `expected 'critical' to be 'warning'`. The batch did not touch delivery at all, and the same jobs
  were green on `main` two hours earlier — because the detonation is **calendar-gated, not
  code-gated**: the test seeds a poisoned row at a fixed `T0 = 2026-09-15T00:00:00Z` and then
  classifies severity with **the wall clock** (`new Date()`), while the classifier escalates to
  `critical` at age ≥ 24 h (`criticalAgeSeconds = 86_400`). The first CI run **after 2026-09-16
  00:00 UTC** was this one — every run before it passed, every run after it would have failed, on
  `main` as well as on any branch. The root cause is the coupling of a fixed seed to a moving
  clock in a test whose subject (acknowledgement changing the verdict) has nothing to do with the
  passage of time. The fix anchors the classification instant to the seed (`AT = T0 + 6 h`, a
  `warning` with no escalation, at any hour the suite runs) and uses it for the acknowledgement
  timestamp too, so the test measures **the acknowledgement, not the machine's clock**. The unit
  tests of the same classifier were already clock-fixed (`NOW`) and are untouched; no production
  code changed, no gate was weakened, and the failure's evidence is documented here rather than
  erased.

- **M1-05B — wave 4, claim `CLM-0185`.** `RISK-0042`'s **third finding is finally measured**, not
  just described: the three product-lifecycle routes — `POST /products/:productId/publish`,
  `POST /products/:productId/archive`, `POST /products/:productId/inventory` — no longer take the
  actor from the request body. They are classified `tenantScoped(...)` (403 before the handler for a
  token without `obo`), and a new `productActor` edge helper reads the actor from the token and
  compares the body's `actor_public_id` **to** it — the field stays required by the contract (deleting
  it is a contract change owned by `M1-06`) but is demoted from judge to consistency check; a mismatch
  returns `PRODUCT_NOT_FOUND`, not 403, because the addressed resource is the product and a 403 would
  make the boundary an oracle. Inside the writing `uow`, `assertActiveMembership` runs **after** the
  product and its store are loaded (via a new `loadStoreById`) and **before** the state-transition and
  moderation checks — so a stranger to the store gets `STORE_NOT_FOUND` even on an unmoderated
  product, and the product's state secret is not read for someone who does not own it. The moderation
  routes (`POST /products/:productId/decisions`) stay unbound **by written reason**: platform
  authority — binding them to store membership inverts the policy (a store approving itself).
  Measured result: `TOKEN_BOUND_OPERATION_COUNT` **7 → 10**, `TENANT_BOUND_OPERATION_COUNT`
  **5 → 8**, classified rows **16 → 18**, `UNCLASSIFIED_OPERATION_COUNT` **65 → 63** — all derived,
  never hand-written. Three new gate-7 mutation cases bite in both directions (reverting publish or
  inventory-adjust to `scoped` fails; hiding the archive row from the matrix while the code enforces
  fails), nine new barrier tests in `service-identity.test.ts` (403 without `obo`, crossing with a
  matching `obo`, `PRODUCT_NOT_FOUND` on mismatch — the bound-route list now carries a per-route
  `mismatchCode`, since product-addressed routes name the product absent), and two new Postgres
  integration tests (a stranger rejected `STORE_NOT_FOUND` before the state check, and no
  inventory-adjustment row written). No production caller broke, measured: the only production role
  with marketplace grants is `delivery`, holding none of the three bound scopes. Decision:
  [ADR-031](docs/15-decisions/ADR-031-product-lifecycle-actor-binding.md). **What this wave does not
  claim:** the two `actor_public_id` fields in the two moderation-decision bodies remain body-sourced
  **by written platform-authority reason**; the membership-vs-rank debt (a `staff` member adding a
  member) stays a named debt needing a third error code and a contract change; `RISK-0042` closing is
  the programme owner's decision alone; and the published contracts still do not state the beneficiary
  requirement — that is `RISK-0041` and belongs to `M1-06`.

- **M1-05B (runtime authorization + token-bound beneficiary) — wave 1 of 3, claim `CLM-0178`.**
  The two order read routes (`GET /orders/:orderId`, `GET /orders/:orderId/history`) no longer
  decide ownership from a header the caller writes. They are classified
  `beneficiary: "required"`, and the `service-auth` middleware rejects any token without a
  beneficiary claim with **403 before the handler runs** — on the same wire code and message as
  insufficient scope, differing only in `logReason`, so the rejection code cannot be used as a
  probe for which routes are bound. Ownership is then read from the token
  (`ownerPublicIdOf`), and `X-Customer-Public-Id` stays required **by the contract** but is
  demoted from judge to a value that must *match* the signed beneficiary; a mismatch returns
  `ORDER_NOT_FOUND`, not 403, because 403 would disclose that the order exists and belongs to
  someone other than the identity named in the header. `TOKEN_BOUND_OPERATION_COUNT` went from
  **0 to 2**, derived from the matrix rows and rejected by the guard if hand-written. Decision:
  [ADR-028](docs/15-decisions/ADR-028-token-bound-owner-binding.md).

- **M1-05B — wave 2 of 3, claim `CLM-0179`.** Five of the eleven `:storeSlug` marketplace
  routes now prove **store membership**, in two layers because neither layer answers the
  other's question. At the edge, `tenantScoped(...)` marks the route
  `beneficiary: "required"`, so a token carrying the full marketplace scope set but no `obo`
  is rejected **403 before the store is touched**. Inside the transaction,
  `assertActiveMembership` (and `assertActiveOwnership` for a review request, because the
  ledger writes the owner's `actorType` unconditionally) runs **inside the same `uow` that
  will write** — not in an earlier read — because membership is revoked between a check and a
  write. Rejection is `STORE_NOT_FOUND` (404), an error code already in the published
  contract, so no contract changes; 403 was rejected because the difference between 403 and
  404 turns the boundary into an oracle for which stores exist.
  `TOKEN_BOUND_OPERATION_COUNT` went **2 → 7**, and a *second* derived count
  (`TENANT_BOUND_OPERATION_COUNT = 5`) was added because one number hides that one of the two
  dimensions is zero. Decision:
  [ADR-029](docs/15-decisions/ADR-029-tenant-membership-binding.md).

  **The most valuable evidence in this wave was red, not green.** The first version of the
  membership guard consulted the `store_staff` table alone and passed **every in-memory
  test**. Run against a real Postgres, the integration suite produced **45 failures, all
  `STORE_NOT_FOUND` on the store's own owner**: `registerStore` writes
  `stores.owner_public_id` and **never inserts a staff row with role `owner`** — so
  `store_staff` is the table of "who was added", not "who owns", and some fixtures had been
  inserting the owner row by hand, which made the table look as if it carried owners. Had it
  shipped, every store owner would have been locked out of their own store in production
  **with all gates green**. Both guards now take the owner from the store row, and the
  membership assertion returns `void` rather than a row, because returning a row for a staff
  member and nothing for the owner invites reading absence as non-membership.

  **The static guard was fixed in the guard, not in the code it reads.** Gate 7's helper
  inventory required the closing brace at column zero, so a helper nested inside the app
  factory was invisible to it. The first fix was to constrain the *code's* shape — which is
  moving the problem. Instead the anchor now captures indentation and requires the closing
  brace at the declaration's own depth, with **two** mutation cases: nesting alone **passes**,
  nesting plus emptying the requirement **fails** — so the pass is a reading, not a blindness.
  The guard now has **31** mutation cases (was 25) and the governance suite **353** (was 347).

  **What this wave does not claim.** The first half of `M1-05B`'s exit criterion — a live
  rejection of an over-privileged token at mint time — is **untouched**. The wave enforces
  **membership, not intra-store rank**: a member with role `staff` can add a member to their
  own store; rank needs a third error code and a contract change, and was recorded as a named
  debt rather than half-implemented. `RISK-0042`'s third item is also untouched, and its size
  was **understated**: there are **eight** body actor fields in `requests.ts`, not two.
  And the attacker was **hypothetical on the day of binding**: the only production role with
  any marketplace grant is `delivery`, which holds none of the five bound scopes — so green
  here means "no measured caller was broken", not "this held under real load". `RISK-0042`
  stays **open**; closing it needs three independent measured evidences and is the programme
  owner's decision alone. `RISK-0043` was opened for a defect this batch exposed that no guard
  catches: production source importing a package declared only in `devDependencies`, which a
  `--prod` install would crash on while every gate stays green.

- **The estimate that justified deferring this was wrong, and it is corrected by addition.**
  `M1-05` and `RISK-0042` both said the fix required **adding a beneficiary claim to the token
  contract** (`ADR-020`/`ADR-021`) — a change touching eight boundaries and twenty signing
  sites. Re-measurement showed the claim **already existed**, optionally: `ServiceTokenPayload.obo`
  in `packages/service-auth/src/token.ts`, minted via `onBehalfOfPublicId`, validated in
  `decodePayload` (empty or wrong-typed ⇒ `invalid_claims`), surfaced as
  `ServicePrincipal.onBehalfOfPublicId`, with a ready reader `ownerPublicIdOf()` in
  `packages/auth-sdk` and exactly one prior consumer (inventory-conflict audit attribution in
  `services/delivery`). The real gap was **"an optional claim nobody required, and an
  `assertOwner` that preferred a caller-written header over it."** The wrong estimate stays
  written wherever it appears, because it is what the deferral was argued from — erasing it
  would make the deferral look like a decision without a reason.

- **The enforcement point is the receiver, not the signer — measured, not preferred.** The
  signer gained an **optional** third argument (`onBehalfOfPublicId`), passed as a per-call
  argument rather than a builder argument because the service is one and the beneficiary changes
  per request. Requiring it at the signer would be a promise, not enforcement: whoever signs can
  decline to pass it, and only the receiver can refuse. So the effect of this wave is measured by
  **how many routes reject a token without a beneficiary**, not by how many callers pass one.

- **One deliberate exception, written because it looks like the opposite of closed-by-default.**
  The middleware computes `identity === undefined ? false : identity.beneficiary === "required"`.
  `undefined` can only occur on an **unregistered** route, because the `onRoute` boot guard kills
  the app for any *registered* route that is unclassified. An unregistered route guards no
  resource, and requiring a beneficiary there replaces an honest **404 with a lying 403**,
  merging path typos with security refusals in operator logs. This surfaced as a **real
  regression**: the first draft defaulted to `true` and broke a pre-existing test that says in
  as many words that an unknown route must not be dressed up as a missing order. The root cause
  was fixed; the test was not weakened. The closed-by-default **scope** gate above it was not
  touched.

- **What this wave does not close, stated where it cannot be missed.** `RISK-0042` remains
  **open** with two of three findings untouched: marketplace tenant membership is still never
  checked (`storeSlug` flows from path to repository across **eleven** routes), and
  `actorPublicId` on product publish/archive is still read from the **request body**. Both
  **2** token-bound rows are in the **ownership** dimension; the **tenant dimension has zero**
  bindings (fourteen `none` rows, eleven of them in marketplace), and an explicit test asserts
  no tenant row is token-bound so the number 2 cannot be read as wider than it is. **78 of 80**
  enforced operations remain unbound. The published contracts still say nothing about this
  requirement — that is `RISK-0041` and belongs to `M1-06`. And the orders contract tests are
  **blind to this barrier by design** (their signing wrapper derives `obo` from the test's own
  header, stated in prose in `support.ts`); barrier proof lives in the `service-identity` tests
  and in the guard's five mutation cases.

- **A mutation case went silent the moment the number it asserted changed.** The existing case
  mutating `TOKEN_BOUND_OPERATION_COUNT = 0` → `12` in the matrix document became a **no-op**
  once the document said `2` — a mutation that changes nothing reads as a guard that bites. It
  now reads the number from the document, inflates it, and **asserts the file actually changed**
  before measuring. Every one of the five new mutation cases does the same, because in `M1-05`
  three mutations passed silently and one genuine guard blindness was caught exactly this way.

- **M1-05 (authorization policy matrix) — wave 1, claim `CLM-0177`.** Authorization now has
  one place it is asked from. Added: `packages/authz-policy` (`@wasla/authz-policy`), which
  depends on nothing in `@wasla/service-auth` and is depended on by no gateway — the matrix is
  **data and a decision**, signing is **machinery**, and inverting that would make the drawing a
  cycle and make either side untestable without the other. It holds `ENFORCED_OPERATIONS` (80
  rows, measured off `app.ts`/`service-identity.ts` at all 8 boundaries), `PRODUCTION_GRANTS`
  (10 roles, 18 grants, each with the scope constant that evidences it), `TEST_FLEET_ROLES`
  (8 roles isolated rather than narrowed — their **breadth is the negative test**, so narrowing
  them would break correct tests while isolating them fixes the boundary), and
  `OPERATION_BINDINGS` (16 classified rows). A grant is a **ceiling, not an order**: requesting
  less is allowed, so a health probe signing with an empty scope set
  (`DELIVERY_MARKETPLACE_PROBE_SCOPES`) is correct behaviour and not a misconfiguration — read
  as an order, that probe would have failed for no fault. `orders:history:read` is an enforced
  scope with **no holder**: declared finite debt, `holdersOf()` returns `[]`.
  Governance check 16 (`validate-authz-policy.sh`, six gates) measures the live tree and
  compares it to the declaration: an operation in code without a declaration fails, a
  declaration for a dead route fails, a granted scope no route enforces fails, a signing triple
  outside its grant ceiling fails, a production role that signs without being declared fails, a
  test-fleet role in a non-test file fails, and a number in the document that contradicts the
  measurement fails. Every unreadable signing site is a **failure, not a pass** — the unknown is
  not read as permission. Documented in
  [ADR-027](docs/15-decisions/ADR-027-authorization-policy-matrix.md),
  [`AUTHORIZATION_POLICY_MATRIX.md`](docs/07-security/AUTHORIZATION_POLICY_MATRIX.md) (its
  measurement inside `authz-matrix:start/end` markers the guard reads literally), and
  `RISK-0042`. **Not closed by this wave, and named as `M1-05B` rather than left as a note:**
  runtime enforcement at the signer, a beneficiary identity claim in the token contract, the
  rewrite of nine `*-e2e` packages, and tenant-membership enforcement on `storeSlug`.
  **Dependency stated rather than concealed:** `M1-04` is `Ready for Gate`, **not**
  `Completed`; building on it follows the `M0-36` precedent and is machine-guarded — if `M1-04`
  is sent back with a change to `enforce.ts` or to any scope name, gate 2 fails the batch
  immediately. This wave does **not** promote `M1-05` to `Completed`: that is the programme
  owner's decision alone, on three independent evidences.

- **M5-13 (Store Orders & Delivery) — review 13/N, claim `CLM-0134`.** Delivery idempotency
  keys now expire. Added: an `expires_at TIMESTAMPTZ NOT NULL` column on
  `delivery_idempotency_keys` with a table-level `CHECK (expires_at > created_at)` and an
  index on the expiry, mirrored in `src/db/schema.ts`; a generated, hand-corrected
  migration `drizzle/0001_idempotency_key_lifetime.sql` (plus its `.down.sql`) that adds
  the column nullable, backfills it to `created_at + 24 hours`, then sets `NOT NULL` —
  the generator's single `ADD COLUMN ... NOT NULL` statement was measured failing with
  `23502` against a table that already held a row; a boot-time resolver for
  `IDEMPOTENCY_KEY_TTL_SECONDS` (default 86400, floor 3600) that **refuses to start**
  rather than silently correcting a bad value; expiry-aware reads plus an atomic
  `ON CONFLICT ... DO UPDATE ... WHERE expires_at <= now()` takeover of dead rows, so an
  expired key is reusable without a spurious 409 while a live key still answers 409; and
  a batched sweeper (`DELETE ... FOR UPDATE SKIP LOCKED`, batch 500, at most 20 batches
  per round) exposed as `POST /delivery/idempotency-keys/sweep` returning measured counts
  (`batches`, `deleted`, `remaining`, `stopped_because`) instead of a bare acknowledgement.
  No in-process scheduler: the platform bans `setInterval` in services and exposes
  periodic work as a route. Nothing schedules the sweep yet — that wiring and its cadence
  are an operational decision; what changed is that the backlog is now measurable.
  The upgrade is proven against a table that already holds rows, so the §4.14 gap is
  closed **for this migration**; `RISK-0020` stays open for the repository as a whole,
  by owner decision.
- **M5-13 (Store Orders & Delivery) — review 14/N, claim `CLM-0135`.** The sweeper now has a
  caller. Added: `src/ops/idempotency-sweep-runner.ts`, the pure half — it reads the two
  sweep settings out of a plain env record (decimal digits only; `5oo`, `0`, `-1`, `2.5`,
  `0x10` and `1e3` are all **refused loudly**, because `Number.isInteger(Number(raw))` was
  measured accepting `0x10` as 16), runs one round through the existing use case, and returns
  a report plus an exit code — it touches no `process`, opens no connection and prints
  nothing; and `src/ops/idempotency-sweep-cli.ts`, the only process boundary — it requires
  `DATABASE_URL`, opens a single-connection pool, writes the report line to stdout and errors
  to stderr, closes the pool in `finally` and exits with the report's code. Exit codes are the
  alarm channel and are deliberately distinct: `0` drained, `1` failed, `3` hit the batch
  ceiling with work left, `4` an empty batch while expired rows remain (transient lock
  contention). `2` is left alone — Node itself produces it on a broken import. The caller
  talks to the database directly rather than calling its own HTTP route, so no service-auth
  key has to live on a scheduler host and no client timeout can cut a long round in half; the
  route stays for manual in-network maintenance. Killing the process mid-round is safe by
  construction (each batch commits alone, the round limit is a local counter), so there is no
  graceful-shutdown handler and no lock against overlapping runs. A text guard
  (`ops-runner-purity.test.ts`) asserts that `src/ops/` contains no timers or cron, and that
  env reads, `process.exit` and stream writes occur in exactly the one declared boundary file
  — asserted by set equality, so a second entry point must be declared to pass. Measured:
  delivery unit **329/329 in 20 files**, delivery integration **69/69 in 9 files** (six new
  tests spawn the real command as a child process against real PostgreSQL and assert exit
  code, stdout and stderr). Not claimed: the schedule itself is not in this repository — the
  crontab line and the Kubernetes `CronJob` example in the runbook are written, not proven
  against a deployment, since `infra/` still holds only `.gitkeep`; and there is still no
  metric or alert on `remaining`, only an exit code an operator can wire.
- **M5-13 (Store Orders & Delivery) — review 15/N, claim `CLM-0136`.** `GET /delivery/ready`
  now asks the marketplace instead of admitting it never did. Until this review the response
  carried `not_claimed: ["marketplace_catalog_not_probed"]`: the catalog port was wired
  (review 8/N) but readiness never probed it. Both reasons review 8/N gave for refusing to
  probe still hold, so the answer is an **observation, not a check**. Added:
  `src/domain/dependency-probe.ts` — a pure `CachedDependencyProbe` with an injected clock
  that caches one observation per TTL per replica (`MARKETPLACE_PROBE_TTL_MS`, default
  15000), caches failures as well as successes (otherwise a marketplace outage costs a full
  timeout on *every* heartbeat, i.e. the protection disappears exactly when it is needed),
  coalesces concurrent heartbeats onto a single in-flight call, and never reports a negative
  age; and `src/infrastructure/http-marketplace-probe.ts` — a signed `GET /health` call with
  an **empty scope list** (a health probe reads no store and no product), a client-side
  `AbortSignal` timeout (`MARKETPLACE_PROBE_TIMEOUT_MS`, default 1000) and a closed reason
  vocabulary. The probe reads the **body**, not the HTTP code: marketplace `/health` answers
  200 unconditionally and carries `status: "ok" | "degraded" | "unavailable"` in the body
  (its `catalog.health()` really queries the database), so a code-only probe would have
  reported a marketplace that had lost its database as healthy — and an unknown status is
  `marketplace_contract_drift`, not health. The result enters the response as
  `dependencies: [{name, ok, detail?, observed_at, age_ms, gates_readiness: false}]` and
  **never** influences `status`, which is still derived from `checks` alone: reads,
  cancellation and fulfillment transitions need no marketplace, so evicting this service
  from rotation for another service's outage would widen the outage rather than contain it.
  `gates_readiness` is declared on the wire (and pinned `const: false` in the contract)
  because whoever reads the body during an incident does not read the ADR. Both new settings
  refuse to boot on a non-decimal value rather than falling back silently, and the same
  measurement from review 14/N was applied to `resolveIdempotencyTtlSeconds`, which still
  accepted `0x10` as 16. Measured: delivery unit **382/382 in 23 files** (was 329 in 20),
  delivery contracts **28/28** (was 26), exit gate **8/8** now wired to a real probe against
  the real marketplace origin — proving a signature with empty scopes is actually accepted at
  that boundary. Not claimed: no metric or alert on the observation (`docs/13-observability/`
  is still empty — an owner decision), no probe for the dispatch bridge or outbox lag, and no
  circuit breaker: a fifteen-second-old observation is far too stale a decision to refuse an
  order with.
- **M5-13 (Store Orders & Delivery) — review 16/N, claim `CLM-0137`.** Active inventory
  conflict detection, lifting the debt declared in ADR-026 §4.8 — the last §4 debt that
  needed neither an owner decision nor an independent scope. The headline finding is that
  **the rule §4.8 wrote is wrong and was not implemented.** §4.8 asked for "comparing the
  observed `quantity_after` against active order lines", but a reservation is a negative delta
  in the marketplace's *own* inventory ledger (`services/marketplace/src/domain/reservation.ts`
  writes `reason_code: 'reservation'` as `system:delivery`) and `product_inventory.quantity_on_hand`
  carries `CHECK (>= 0)`. So `quantity_after` is already net of our reservations: a store with
  three units and one order reserving all three reports `quantity_after = 0`, which is perfect
  health. That comparison would have flagged **every** healthy order — a hundred percent noise
  rate. There is therefore no quantity-versus-quantity comparison anywhere in this
  implementation; the criterion is whether the adjustment's **reason** casts doubt on units we
  hold. Added: `src/domain/inventory-conflict.ts` — a pure assessment with three closed kinds
  (`stock_zeroed_while_reserved`, which outranks the reason because severity comes first;
  `downward_correction_while_reserved`; `shrinkage_while_reserved`) and four closed dismissals
  evaluated in a fixed, contractual order (`no_active_reservation`,
  `delivery_own_reservation_flow`, `quantity_increase`, `reason_not_conflicting`), with our own
  `reservation`/`reservation_release` excluded by construction — without that exclusion our own
  action flags us on every order placed. `delivery_inventory_conflicts` (fourteenth table,
  eleven named checks, migration `0002_inventory_conflict_ledger` plus a hand-reviewed reverse)
  is written in the **same transaction** as the observation, because an observation stored
  without its flag means a consumed event and a lost doubt with no way back, and with
  `ON CONFLICT DO NOTHING` rather than `DO UPDATE`, because a redelivery must not erase an
  operator's acknowledgement. The stale guard still comes first: a stale `adjustment_sequence`
  writes no flag at all, so the port now returns a discriminated
  `InventoryObservationOutcome` instead of `void`. Active demand is joined through
  `store_orders`, the only row carrying both the marketplace `store_id` and the `order_id`
  (reservations carry `store_slug`), so no marketplace table is joined and no cross-boundary
  `REFERENCES` is added. `GET /delivery/inventory-conflicts` returns the flags with the
  applied filter echoed in the body — whoever reads a zero learns *under which filter* it was
  zero — and is deliberately absent from `api.openapi.yml`, following the sweep route
  precedent exactly. The contract guard in `packages/contracts/delivery` earned a mention: it
  forbids `reserved_quantity` anywhere in the delivery schema (delivery holds no balance,
  §2.3), it really did fail on the first column name, and the column was renamed to
  `affected_units_total` rather than the guard widened. Measured on real PostgreSQL: delivery
  unit **412/412 in 25 files** (was 382 in 23), delivery integration **84/84 in 10 files**
  (was 69 in 9), delivery contracts **28/28**, exit gate **8/8**, `pnpm -r typecheck` clean
  repository-wide, contract-versus-migration equivalence measured across seven catalogue
  dimensions, and all eleven constraint names read out of a real catalogue rather than
  predicted. Not claimed: no inbound service-auth on any delivery route (the service signs
  outbound only — an independent scope for all eleven routes together); no write route for
  acknowledgement yet (the columns exist and are read, acknowledgement is manual on the
  database); no metric, alert or time series on the flags; no retention policy for the flag
  ledger; and a flag does not prove damage — a `shrinkage` exceeding free stock is *refused*
  by the marketplace, so a recorded loss is a floor, not a measure.
- **M5-13 (Store Orders & Delivery) — review 17/N, claim `CLM-0138`.** Inbound service
  authentication on the delivery boundary, lifting the debt declared in ADR-026 §4.18 ("no
  inbound auth on any route — the service signs outbound only"). Nine of the eleven routes now
  require a proven service identity (`aud = delivery`) **and a scope that is unique to that
  route**: `delivery:store-order:{write,read,cancel,confirm}`, `delivery:payment-mirror:write`,
  `delivery:fulfillment:transition`, `delivery:delivery-task:read`,
  `delivery:ops:idempotency-sweep`, `delivery:ops:inventory-conflicts:read`. Missing identity
  is `401`, proven identity with a missing scope is `403`, and the two answers are never
  conflated. `GET /delivery/health` and `GET /delivery/ready` stay **open by a written
  decision**: their caller is the deployment orchestrator, which holds no service key — closing
  them stops deployments, not attackers. An unregistered path answers `401` **before** `404`,
  so the service surface cannot be mapped without a key, and a newly registered route with no
  identity classification **fails startup** rather than passing silently.
  The measured finding worth recording is that the shared middleware emits **three** denial
  codes, not two: `packages/service-auth/src/errors.ts` `codeFor()` returns `AUTHN_EXPIRED` for
  an expired token and `AUTHN_AUDIENCE_MISMATCH` for a token aimed at another boundary,
  otherwise `AUTHN_UNAUTHENTICATED`. A test was written asserting two and **failed**; the
  assertion and the source comments were corrected to the measured truth rather than the
  behaviour bent to the guess. Both exceptions are only ever spoken *after* the signature is
  proven, so they serve an honest operator diagnosing a deployment mistake and tell an attacker
  without a key nothing. Denials use this contract's flat envelope
  `{error_code, message, trace_id}` — not dispatch's `code` — and deliberately carry no
  `DELIVERY_` prefix, because they are the vocabulary of every boundary in the system
  (ADR-020, ADR-021) and a caller who programs against `AUTHZ_FORBIDDEN` at one boundary must
  read the same code here.
  This is also **the first boundary enforced before a production caller exists**: a measured
  search found no in-repo HTTP caller of any of the eleven routes outside `services/delivery/**`
  except `packages/delivery-e2e`, so enforcement preceded adoption and broke no caller.
  Measured: **20 new proof cases** in `services/delivery/src/__tests__/service-identity.test.ts`
  (the full matrix, four dangerous writes unreachable by read tokens, and binding limits — other
  path, other method, other order id, health and ready still open, unknown route `401` before
  `404`, unclassified route rejected at startup); delivery unit **432/432 in 26 files** (was
  412 in 25); delivery integration **84/84 in 10 files**, unchanged; exit gate **11/11** (was
  8/8) including three on-the-wire proofs issued with raw `fetch` against the running gate
  rather than through the signing helper; `pnpm -r typecheck` clean repository-wide. No
  `pnpm-lock.yaml` change: both packages already depended on `@wasla/service-auth`.
  Not claimed: `api.openapi.yml` was **not touched** — the published contract declares neither
  `securitySchemes` nor `401`/`403`, which is a **real gap, not a good choice**, and it is the
  precedent of all five previously enforced boundaries, so the fix is one contract convention
  for every boundary at once rather than a second convention invented here.
  `services/marketplace` is still not enforced (declared, not fixed). `RISK-0026` (the query
  string is not bound into the signature — it affects `GET /delivery/inventory-conflicts`) and
  `RISK-0015` (the replay guard is in-memory, so it is per-process) remain open.
  **[Added 2026-09-17 · `CLM-0206` — corrected by addition, not deletion]** Both are no longer
  true: the query string is now normalized (sorted) into the request binding
  (`docs/15-decisions/ADR-036-request-binding-includes-query.md`, `RISK-0026` → `mitigating`,
  scheme `wsvc2` → `wsvc3`) and the replay store is now shared on PostgreSQL (`ADR-035`,
  `RISK-0015` closed). Read the sentences above with their dates. Role-to-scope
  granting is `M1-05`: this boundary declares what each route *requires*; who deserves a scope
  is the token issuer's decision. `docs/12-testing/M1-04_GATE.md` still describes five
  enforced boundaries and needs a sixth-wave update — a declared debt. **(Paid in review 22/N
  below.)**
- **M1-04 (central auth middleware) — gate update, review 22/N, claim `CLM-0143`.** Paying the
  debt declared by the sixth wave, and while measuring it two real defects surfaced that no
  check had caught. First, **silent documentation drift**: `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md`
  §2.7 and `docs/12-testing/M1-04_GATE.md` both declared **nine** delivery scopes while
  `DELIVERY_SCOPES` in `services/delivery/src/http/service-identity.ts` enforces **eleven** —
  the tenth (`delivery:ops:inventory-conflicts:acknowledge`, review 18/N) and the eleventh
  (`delivery:ops:relay-dead-letters:read`, review 21/N) were added to the code and never written
  down. Check 12 (`validate-service-auth-coverage.sh`) reads the §4 client table, not the §2.7
  scope table, so nothing failed. The fix is not a hand edit: the scope tables in both documents
  are now wrapped in `<!-- delivery-scopes:begin/end -->` markers and a new guard,
  `services/delivery/src/__tests__/service-auth-docs-drift.test.ts` (7 cases), reads the
  exported constant and both documents and fails on a missing, invented, or duplicated scope —
  and fails loudly if the markers themselves are deleted, so removing the markers cannot make
  the guard pass. It was confirmed RED against the nine-row tables before the documents were
  fixed. Second, routes 12 and 13 were classified with scopes in `app.ts` but had **never been
  measured unsigned** — their HTTP tests all call through the signing harness, so enforcement
  was inferred from middleware existence. Four boundary cases were added
  (`service-identity.test.ts` 20 → 24): each route unsigned ⇒ `401 AUTHN_UNAUTHENTICATED`, and
  each route with a valid token carrying a *different* delivery scope ⇒ `403 AUTHZ_FORBIDDEN`.
  The delivery boundary as measured today: **13 routes = 11 closed (one scope each) + 2 open by
  written decision** (`GET /delivery/health`, `GET /delivery/ready`). The gate document now
  carries a three-layer status header, a new §3.1 with a four-row measured-evidence table for
  waves 6 and reviews 18/N, 21/N, 22/N, and a new §5 holding the marked scope block.
  Measured: repository-wide `pnpm -r test` **4447 passing in 272 files** (was 4436/271),
  `pnpm -r typecheck` clean, governance gate green, `BASELINE.json` regenerated
  (`static.test_files_tracked` 340 → 341).
  Not claimed: the historical CI green for the wave-5 gate (run `34065473979`, 27/27,
  2026-09-07) is preserved and **not extended forward** — no CI verdict exists for wave 6 or
  anything after it, because every run since 2026-09-12T11:15Z fails with zero steps started
  (account billing, `docs/14-runbooks/CI_RUNNER_UNBLOCK.md`). `services/marketplace` remains the
  only implemented boundary with no enforcement, stated plainly rather than in a footnote.
  `api.openapi.yml` was not touched. No deployment was measured. The guard matches scope
  *names*, not the rationale next to them, and covers delivery only.
- **M1-04 (central auth middleware) — scope-table guard generalised to all six boundaries,
  review 23/N, claim `CLM-0144`.** Review 22/N closed the delivery drift with a unit-test guard
  and explicitly declared that it "covers delivery only". Measuring that residue produced a
  worse finding than the one it closed: the four geography scopes enforced in code
  (`geography:hierarchy:read`, `geography:zone:read`, `geography:location:read`,
  `geography:location:write`) appear **nowhere in `docs/`** — measured by searching every scope
  string across every documentation file, zero hits — and have been enforced since 2026-09-07.
  So the delivery drift was never one service's accident; it was the pattern, and the missing
  table is worse than a stale one because there is nothing to compare against. Chosen fix, among
  legitimate alternatives: extend **check 12**
  (`scripts/checks/validate-service-auth-coverage.sh`) with a new **gate 6** rather than add a
  fourteenth governance check. Rationale: one source of truth (the exported `*_SCOPES` constant
  in each `services/<svc>/src/http/service-identity.ts`), the strongest automatic enforcement
  available (check 12 already runs in CI and in the governance gate), and no new check counter,
  so no CI-config or baseline-counter churn. Gate 6 extracts every scope literal from each
  boundary's exported constant and requires it inside that boundary's
  `<!-- <svc>-scopes:begin/end -->` block in `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md`,
  and requires that no scope inside the block is absent from the code. A second, narrower rule
  was added after a fixture exposed the hole: every boundary the ledger declares **enforced**
  must have `service-identity.ts` at its declared path, so moving or renaming the file **fails**
  the check instead of silently skipping gate 6. Existing tables (matching, orders, identity,
  dispatch) were wrapped in markers in place — no table was copied, so no truth was duplicated
  — and a new §5.3 was written for geography with the nine closed routes measured from
  `services/geography/src/http/app.ts` plus `GET /health` open by explicit classification. The
  §5 heading, still reading "the two boundaries' scopes" while six are enforced, was corrected
  **by addition**: the stale title and the six-day documentation gap are both recorded in place
  rather than quietly overwritten. Measured: gate 6 was confirmed RED first — it rejected five
  of six boundaries before the tables were marked — then green across **6 boundaries and 38
  scopes** (delivery 11, dispatch 7, orders 6, identity 5, matching 5, geography 4). Six
  mutation cases were added to `scripts/checks/test-governance.sh` proving the gate actually
  rejects: a scope in code but not documented, a scope documented but not in code, a deleted
  marker, a moved identity file (all must fail), plus a truthful table and a boundary with no
  exported constant (must pass). The governance suite is **189 passing, 0 failing** (was 183/0).
  `M1-04_GATE.md` gained item 17, so the tally is now **16 ✅ and one ⚠️ partial (12)**, and its
  §5 records that the drift guard is now two layers over one truth source rather than one.
  Not claimed: this gate matches scope **names** against code, not each scope's binding to its
  route (that is proven on the wire in each boundary's `service-identity.test.ts`) and not the
  correctness of the rationale written beside a name. `bots/` and `packages/` remain outside the
  check's vision (`RISK-0027` still open). `services/marketplace` is still unenforced.
  `api.openapi.yml` was not touched. And there is still no CI verdict: every run fails with zero
  steps started (account billing, `docs/14-runbooks/CI_RUNNER_UNBLOCK.md`), so local green is
  reported as local green and nothing more.
- **M1-04 (central auth middleware) — coverage guard now sees `bots/` and `packages/`, review
  24/N, claim `CLM-0145`.** Review 23/N ended by naming its own blind spot: `bots/` and
  `packages/` stay outside check 12's vision (`RISK-0027`, open since 2026-09-05). Closing that
  root cause produced a genuine, previously invisible defect: two real outbound clients,
  `bots/customer-bot/src/infrastructure/http-negotiations.ts` and
  `bots/driver-bot/src/infrastructure/http-negotiations.ts`, follow the repository's own client
  naming convention, call `POST /negotiations/{thread}/rounds/{n}/{accept,reject}`, carry **no
  signer at all** (measured: no `sign*Request` anywhere in either file), and **had never
  appeared in the coverage ledger**. So the ledger's line "eleven signers out of eleven outbound
  clients — nothing deferred" was true of `services/` and misleading if read as a claim about
  the repository. Two changes: gate 2's discovery now globs `bots/*/src/infrastructure/http-*.ts`
  alongside `services/`, and a new **gate 7** takes a census of every production file containing
  `fetch(` under `services/`, `bots/`, and `packages/` (excluding `__tests__` and `*.test.ts`)
  and requires each one to be either a counted client or an exception **declared with its reason**
  inside `<!-- fetch-exceptions:begin/end -->` in the ledger. Gate 7 also rejects a *dead*
  exception (a listed file that no longer exists), rejects smuggling a real client into the
  exception list to exempt it from the ledger, and rejects deletion of the marker block —
  measured today as **22 raw callers = 16 counted clients + 11 declared exceptions** (the eleven
  being e2e harnesses, each with a written reason). The two bot clients were added to the ledger
  as `مؤجَّل` with an `M1-04` reference and the honest reason: the `negotiations` boundary is
  **not enforced** (measured — no `registerServiceIdentity` in
  `services/negotiations/src/http/app.ts`), so signing a call to a boundary that verifies nothing
  would buy reassurance rather than safety; they will be signed when the boundary is enforced,
  and the guard now prevents forgetting them. Seven mutation cases were added to
  `scripts/checks/test-governance.sh` (hidden raw caller, declared exception, dead exception,
  client smuggled into exceptions, deleted marker block, an unlisted `bots/` client, and a clean
  root) so the governance suite is **196 passing, 0 failing** (was 189/0). The gate document
  gained item 18, and item 12's old note — "all existing callers are signed" — was corrected
  **by addition**, not deleted: that sentence was false and only measurement could show it.
  `RISK-0027` stays `open` until its owner reviews it (§9: promotion is the owner's authority),
  while its technical cause is recorded as measured-closed. Not claimed: gate 7 matches `fetch(`
  only, so a caller using `undici`, `axios`, or another wrapper is still invisible, and no
  false-positive rate over time has been measured. And still no CI verdict: every run fails with
  zero steps started, so the green reported here is local only.
- **M1-04 — HTTP-wrapper lock closes the blind spot review 24/N declared, review 25/N, claim
  `CLM-0146`.** Review 24/N ended with an explicit non-claim: gate 7 greps `fetch(` only, so a
  caller using `axios`, `undici`, or any other wrapper stays invisible. Measured today, that hole
  is empty — zero HTTP-client dependencies exist in any `package.json` outside `node_modules`,
  and zero production files import one — but the hole is the dangerous kind: the day someone adds
  `axios`, gate 7 goes blind **while staying green**, which is worse than `RISK-0027` was, because
  that blindness is born green and warns nobody. So a new **gate 8** locks it by default-deny:
  thirteen known HTTP client packages (`axios`, `undici`, `got`, `node-fetch`, `ky`, `superagent`,
  `request`, `phin`, `needle`, `axios-retry`, `request-promise`, `isomorphic-fetch`,
  `cross-fetch`) are rejected in any `package.json` unless declared **with a reason** as a table
  row inside `<!-- http-wrappers:begin/end -->` in the ledger's new §4.2 — and once declared, the
  wrapper's import pattern is **added to gate 7's census automatically**, so every file importing
  it must itself be a counted client or a declared exception. Gate 8 also rejects a dead
  declaration (a wrapper declared but present in no `package.json`) because it widens the census
  with nothing behind it and simulates guarding, and it rejects deletion of the marker block. The
  declaration is parsed from the **first cell of table rows only**, not from the block's prose, so
  package names mentioned in the explanatory text are illustration rather than declaration — a
  first implementation read every backticked token and produced three phantom declarations
  (`fetch`, `node_modules`, `package.json`), which the guard correctly rejected as dead
  declarations, and the parser was narrowed. Five mutation cases were added (undeclared dependency
  fails, declared dependency passes, dead declaration fails, deleted block fails, and an importer
  of a declared wrapper is pulled into gate 7 and fails when unlisted), taking the governance
  suite to **201 passing, 0 failing** (was 196/0), and the gate document gained item 19. Also
  recorded honestly: during this work a stray shell heredoc executed with an unset root variable
  and deleted the new marker block from the real ledger instead of a synthetic fixture; the guard
  caught it immediately ("marker block missing"), which is exactly the failure mode gate 8 is
  built to catch, and the block was restored and re-measured green three times. Not claimed: the
  lock stops a wrapper entering **through `package.json`**; it does not stop a raw socket call
  (`node:http`, `net`) or a transitive package that wraps a client deep in its own dependency
  tree, and neither is measured today. And still no CI verdict: runs keep failing with zero steps
  started.
- **M1-04 — the negotiations boundary is enforced and the two deferred bot clients are signed,
  review 26/N, claim `CLM-0147`.** Review 24/N found two real outgoing clients that had never
  been in the coverage ledger and had never signed a call —
  `bots/{customer,driver}-bot/src/infrastructure/http-negotiations.ts` — and recorded them as
  `مؤجَّل` with an honest reason rather than signing them on the spot: `services/negotiations`
  did not verify inbound identity at all, so signing a call into a boundary that never reads the
  token is reassurance with no effect. This review removes the reason instead of the symptom:
  **the boundary is enforced first, then the clients are signed.** `services/negotiations` becomes
  the **seventh** enforced boundary with nine scopes over thirteen routes
  (`negotiations:thread:{write,read}`, `negotiations:round:{write,decide,read}`,
  `negotiations:message:{write,read}`, `negotiations:agreement:read`, `negotiations:tick:run`),
  `GET /health` open by explicit classification, and an unclassified route failing at boot rather
  than defaulting open. The split follows verbs, not tables, and the two splits that matter have
  their own `403` proofs on the wire: accepting or rejecting a round (`round:decide`) is not the
  same power as proposing one (`round:write`), because accepting creates an agreement and moves a
  price in the order engine; and the scheduler tick (`tick:run`) is a separate scope because it
  writes across every user's threads and its caller is a scheduler, not a user's bot. Fourteen
  proof cases were added in `services/negotiations/src/__tests__/service-identity.test.ts`
  (no identity → 401 with no reason leaked, forged → 401, valid → pass, missing scope → 403,
  replay → 401, replay store down → 503, a `round:write` token refused at accept, every thread /
  round / message scope refused at the tick, a token bound to another thread id or another path
  refused, unknown path → 401 before 404, and an unclassified route throwing at boot). The two bot
  clients now take a **required** `signRequest` with no default — a missing signer is a
  configuration fault at construction, not a silent unsigned call — and signing happens **outside**
  the request `try` block so a refusing signer surfaces as a config fault rather than being
  mislabelled `*_DEPENDENCY_UNAVAILABLE`. Each bot declares three scopes only
  (`thread:read`, `round:read`, `round:decide`), which is strictly less than the nine the boundary
  enforces, and four proof cases per bot read `aud`, `svc`, `scp` and the request binding `req`
  **out of the token payload itself** rather than asserting a function exists, plus a case proving
  a refusing signer means `fetch` is never called at all. The negotiation exit-gate harness now
  starts the service **enforced** and signs its own calls, so the boundary is proven over a real
  socket and not only by injection. Measured: negotiations service unit tests **244 passing in 14
  files** (was 230/13), customer-bot **36** (was 32), driver-bot **43** (was 39), repo-wide
  `pnpm -r test` **4469 passing in 275 files** (was 4447/272) with `EXIT=0`, `pnpm -r typecheck`
  clean, and the coverage guard green on **seven** enforced boundaries and **47** scopes with
  **zero deferred clients** — the first time that ledger has had no deferral since gate 2 was
  widened to see `bots/`. Gate item 12 moves from ⚠️ partial to ✅ because its stated reason no
  longer has a subject, and the old text is kept verbatim as evidence of what measurement could
  see that day rather than deleted. Not claimed: this does **not** complete `M1-04` —
  `services/marketplace` is still the one implemented boundary with no enforcement, promotion of
  the item to `Completed` and closing `RISK-0027` remain the program owner's authority alone, the
  query string is still outside the request binding so a token signed to list one order's threads
  can list another's (`RISK-0026`, same shape as `GET /orders/lookup`, root fix at `M1-05`), the
  replay guard is still in-process (`RISK-0015`),
  **[Added 2026-09-17 · `CLM-0206`: the query-string clause and the replay clause are both
  obsolete — `ADR-036` binds the sorted query string, `ADR-035` shares the replay store. The
  prediction that the root fix would wait for `M1-05` was wrong: the mechanism was fixable at the
  binding itself, and `M1-05` remains only for authorization.]** `api.openapi.yml` still documents no security
  scheme, and **there is still no CI verdict**: every run continues to fail with zero steps
  started, so the green reported here is local only.
- **M5-13 (Store Orders & Delivery) — review 18/N, claim `CLM-0139`.** The acknowledgement
  write route, lifting the debt declared in ADR-026 §4.18 ("no write route for the
  acknowledgement") — the debt whose only blocker, per §4.19, had already fallen: a `POST` that
  writes `acknowledged_by` without inbound authentication is **an acknowledgement with no
  acknowledger**. `POST /delivery/inventory-conflicts/{adjustmentId}/acknowledgement` is
  **schema-free**: `acknowledged_at`, `acknowledged_by`, the half-acknowledgement `CHECK` and
  the partial index have existed since 16/N and were created **for this route**, so what was
  missing was the door, not the ledger — which is itself evidence that the §4.18-9 decision to
  add the columns early was right.
  The acknowledger is taken **from the proven token only** (`service:<name>` or
  `service:<name>/on-behalf-of:<publicId>`), and any non-empty body is **rejected `400`, never
  silently ignored** — silent ignoring would produce the worst outcome available: a row in an
  **accountability ledger** bearing a name other than the one the caller believes it signed
  with. The rejection is justified by *the route having no body at all*, not by one field being
  reserved, so there is no ban-list to forget a future addition in. A composed identity longer
  than 128 characters is **rejected, not truncated**: a truncated identity in an accountability
  ledger is a lie that reads as a fact.
  A **tenth scope**, `delivery:ops:inventory-conflicts:acknowledge`, is separate from `:read`
  **by construction**, so whoever reads the board does not close incidents in their own name;
  a read-only token is answered `403` on a real socket in the phase-13 gate.
  **The first acknowledgement wins, in one statement** (`WITH upd AS (UPDATE … WHERE
  acknowledged_at IS NULL RETURNING …) SELECT … UNION ALL … WHERE NOT EXISTS`), so there is no
  window between "is it acknowledged?" and "acknowledge it" for a concurrent call to enter —
  proven with `Promise.all` and two different acknowledgers: one wins, the other reads the
  winner, and never both. The second call answers **`200`, not `409`**, with an explicit
  `outcome: "acknowledged" | "already_acknowledged"` discriminator that **names the first
  acknowledger**: the requested state is satisfied, so `409` would push a caller into a retry
  that cannot help, but staying silent about the difference would let a second operator believe
  an incident is in their custody when it is in someone else's. There is deliberately **no
  `Idempotency-Key`**: the operation is idempotent **in its nature** (`WHERE acknowledged_at IS
  NULL`), not by machinery, and demanding a key here would falsely imply the key is the
  protection — which would break the day key semantics change.
  A malformed `adjustmentId` is `400` **before touching the database**, not `404`, because
  `404` would send an operator hunting the database for a row that exists; an unknown flag is
  `404` with a new code `DELIVERY_INVENTORY_CONFLICT_NOT_FOUND` and no row is created. An
  unwired write port answers **`500`**, never `200 {outcome: "acknowledged"}` — a stricter
  stance than its read counterpart, because a falsely empty list reads as cleanliness while a
  false acknowledgement closes a real incident in an operator's mind with no trace in any ledger.
  The route stays **out of `api.openapi.yml`**, the third ops path to do so on the sweep and
  read precedents verbatim: the published contract stays **nine** routes, the registered surface
  becomes **twelve**.
  Discovered while wiring the gate: `packages/delivery-e2e/src/harness.ts` was passing
  **neither** ops port, so the read route merged in 16/N had never been exercised by the exit
  gate at all. Both are wired now.
  Measured on PostgreSQL 18.6 locally (CI runs 17.6): 7 unit cases for the composer and 10 for
  the route; inventory-conflict integration **21/21** (was 15/15); exit gate **16/16** (was
  11/11), including a full journey over a real socket; `pnpm -r typecheck` clean
  repository-wide.
  **A real pre-existing defect was found here and deliberately not fixed here**
  ([`RISK-0035`](docs/07-security/RISK_REGISTER.md), `high`): the marketplace writes
  `actor_public_id: "system:delivery"` on the reservation-decrement event, and the delivery
  inventory relay's classifier requires `^WS-[0-9]{10}$`, so the row is **poisoned and the
  checkpoint advances past it** — the event is *lost*, not held. It surfaced because this is the
  first case in the repository that relays inventory **after** placing an order (measured: 2
  applied, 1 poisoned), and it stayed hidden because `observed_quantity_after` is absolute, so
  any later applied event repairs the snapshot. Fixing it means either widening the classifier's
  actor pattern or changing **a published event payload**, both of which are contract decisions
  and not something to slip into a route delivery. The measurement is **pinned in the gate with
  an exact assertion** (`{applied: 2, poisoned: 1}`) rather than a lenient one, so the defect is
  measured, not masked.
  Not claimed: no `un-acknowledge` route — **a policy question, not a forgotten method**: who
  may overturn another operator's judgement, and with what trace is the reversal itself kept?
  No metric or alert on flags or acknowledgers (`docs/13-observability/` is empty); no retention
  policy for the flag ledger; `trace_id` still not published in the rows; still no
  `securitySchemes` in the published contract; `services/marketplace` still not enforced.
- **M5-13 (Store Orders & Delivery) — review 19/N, claim `CLM-0140`.** The concurrency
  refusal now tells the caller *when* to retry. Until now a lost idempotency-key race
  answered a bare `409 DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT`: correct, and useless — it
  said "you failed" without saying "retry", so the caller either spun in a tight loop
  (turning a millisecond of contention into database load) or gave up and lost a request
  that had **actually succeeded**. This lifts the oldest surviving debt in ADR-026 §4,
  declared in §4.10-1 at review 7/N.
  New: `src/http/retry-after.ts`, a pure module that imports no framework and knows no
  reply — it holds a closed `Partial<Record<DeliveryErrorCode, number>>` with exactly one
  key, and exports `declaredRetryAfterSeconds()` so a test can read the promise instead
  of trusting a comment. The error mapper sets the header only when that lookup returns a
  number. The value is **measured, not guessed**: probing the race on real PostgreSQL
  18.6 over twelve concurrent rounds produced eleven refusals, and in every one of them an
  **immediate** retry — no wait at all — was answered `201` with `Idempotent-Replay: true`.
  The winner's key row is therefore already committed when the refusal is raised and the
  true wait is zero; `1` is chosen because `0` reads as "spin now" and `1` is the smallest
  integer that does not. Delta-seconds, not an HTTP-date, so response validity does not
  depend on two clocks agreeing. It is a constant in code, not an environment variable,
  because the contract publishes `minimum: 1` and a tunable would let the answer drift
  from the contract without failing a test.
  Keyed by **error code, not status**: three different errors share `409`, and only this
  one is worth retrying — `DELIVERY_IDEMPOTENCY_KEY_REUSED` is a caller construction bug
  whose retry can never succeed, and `DELIVERY_CONCURRENT_UPDATE` needs a fresh read and a
  new decision, not the same request again. A status-keyed rule would have lied in two
  cases out of three. `components/responses/ConflictError` in `contracts/api.openapi.yml`
  now declares the header machine-readably (`type: integer, minimum: 1`), and a contract
  guard asserts it is the only `headers:` block in the file and that
  `DependencyUnavailable` has none.
  Proven in three layers, each measuring a real race: 10 unit assertions without a
  database; an integration test on real PostgreSQL that creates the race with
  `Promise.all` in a loop and **fails explicitly if no refusal is ever observed**; and the
  phase-13 exit gate, which repeats the measurement **over a real socket** because
  `app.inject` never touches the HTTP header serialiser — a header dropped or renamed by
  the listener would have passed green in integration and been invisible to every real
  caller. The gate reads the header as a **string** (`"1"`), proving the RFC 9110 §10.2.3
  `delay-seconds = 1*DIGIT` form and not merely the value, and it asserts the promise is
  honest: the immediate retry replays the winner's body byte for byte. The gate was rerun
  five times, 17/17 each time.
  Not claimed: `packages/contracts/delivery/src/api-types.ts` still models **no response
  header for any route** — it is hand-authored, and the fix is one convention for every
  response at once, the same argument as the missing `securitySchemes`. Measured and
  recorded as a trap: running `pnpm generate` in that package **overwrites the
  hand-authored file** with a machine dump (721 insertions, 306 deletions); it was
  reverted. No metric or alert on refusal frequency, so a race that becomes a pattern
  rather than an incident says nothing. No `Retry-After` on `503`
  (`DEPENDENCY_UNAVAILABLE`, `MARKETPLACE_UNAVAILABLE`) — the standard's own example case —
  because a dependency's recovery time is **not measured here**, and an unmeasured promise
  is the thing this review argues against. No `429` and no rate limiting on this boundary
  at all. And no claim about probability: the loop proves the race occurs, not how often,
  and every measurement is on 18.6 locally — CI runs 15/17.6, untested for this.
- **M5-13 (Store Orders & Delivery) — review 20/N, claim `CLM-0141`.** `RISK-0035` is
  closed, and the fix is one file: the consumer, not the contract. Every
  reservation-decrement event in the system was being **silently lost** — the marketplace
  writes `actor_public_id: "system:delivery"` on it, the delivery inventory relay's
  classifier required `^WS-[0-9]{10}$`, so the row was poisoned and the checkpoint
  advanced past it by design (one bad row must not block the queue), meaning the event was
  never retried and never alerted on.
  **The documented dilemma rested on a false premise.** The risk was recorded as a choice
  between two doors, both "contract decisions": widen the classifier's actor pattern, or
  change what the marketplace writes. Reading the published contract dissolved it —
  `services/marketplace/contracts/events.json`,
  `MarketplaceInventoryAdjustedV1.data.actor_public_id`, has declared the actor as a
  **`oneOf` of two forms since it was published**: a Wasla public id, or
  `{"type": "string", "pattern": "^system:[a-z_]+$"}`. `"system:delivery"` is therefore
  **contract-legal, literally**. The producer never left its contract; the consumer was
  **narrower than the contract it consumes**. So there was no second door and no owner
  decision: **no published payload was changed, no migration was run, and
  `services/marketplace` was not touched.**
  The rule this leaves behind, written into the code and not just this bullet: a consumer's
  validation must be a **superset** of what its producer's contract permits, never a
  subset. A narrower consumer **destroys facts that exist** — and above an advancing
  checkpoint it destroys them without a trace. The worst a wider consumer does is wait for
  a fact that never arrives. The two costs are not comparable, so the safe direction is
  declared rather than inferred.
  The fix: an exported `MARKETPLACE_ACTOR_PATTERNS` constant plus a `reqInventoryActorId`
  validator whose failure message **names both permitted forms**, so an operator reading an
  incident learns what is allowed rather than what was rejected. `reqWaslaPublicId` was
  deleted — it had no remaining caller, and a dead validator in a validation module is an
  invitation to use it by mistake. Note also that `actor_public_id` is **never persisted**:
  `delivery_inventory_observations` has no column for it, so the rejection was paying the
  highest possible price for the cheapest possible field. No column was added; widening a
  table for a field no one reads is refactoring, not fixing.
  A new **drift guard** (`services/delivery/src/__tests__/marketplace-actor-contract-drift.test.ts`)
  reads `events.json` itself, resolves the `oneOf` branches through `$defs`, and asserts the
  classifier's pattern set is **literally equal** to the contract's, and that each branch has
  a sample the classifier **actually accepts**. Add a third branch to the contract and the
  test fails — because the original defect was not a logic error but a **drift between two
  documents** that broke no build and tripped no type, and only dropped events in
  production.
  The boundary was not loosened: seven poison cases still fail (`system:`,
  `system:Delivery`, `system:store-ops`, `system:delivery:extra`, `svc:delivery`, `WS-123`,
  surrounding whitespace), both patterns anchored.
  Measured on PostgreSQL 18.6 locally: delivery unit **473/473 in 30 files** (was 459/29),
  delivery integration **92/92 in 10 files** (was 91/10), delivery contracts 29/29,
  `pnpm -r typecheck` clean repository-wide, and the phase-13 exit gate **17/17** with the
  pinned assertion flipped from `{applied: 2, poisoned: 1}` to `{applied: 3, poisoned: 0}`
  on a real socket, plus two new assertions: **no poisoned row exists at all** in
  `delivery_inventory_relay_consumed_events`, and the reservation row **specifically** is
  `applied` (joined through `marketplace_outbox`, because the consumed ledger deliberately
  does not store the payload — no second source of truth for a marketplace-owned event).
  No conflict flag changed: `DELIVERY_OWN_REASONS` already dismisses
  `reservation`/`reservation_release` as `delivery_own_reservation_flow` (§4.18), which was
  decided in review 18/N and is not a consequence of this one.
  Not claimed: **there is still no metric and no alert on poisoned rows**
  (`docs/13-observability/` is empty), so the guard against this class of defect is a
  **test, not an alarm** — it fails in CI and says nothing in production; that is the real
  remaining limit. There is **no replay path for an already-poisoned row**, so in any
  environment that ran before this fix the lost events **stay lost**; recovering them is an
  operational re-relay from an earlier checkpoint, not code, and it was not performed. The
  guard covers the actor field only, not the whole payload — `reason_code`, for instance,
  is a 7-value enum in the contract and any non-empty string in the classifier, which is
  the safe direction and was left alone; generalising the guard needs a JSON Schema
  validator (no `ajv` in the service's dependencies today) and is its own scope. And
  nothing here was measured on PostgreSQL 15/17.6 (the CI versions) or against a production
  database.
- **M5-13 (Store Orders & Delivery) — review 21/N, claim `CLM-0142`.** The first of the
  two limits declared when `RISK-0035` was closed is now lifted: there is a **measured
  metric and a classified alert verdict** on poisoned relay rows. Route thirteen,
  `GET /delivery/relay/dead-letters`, reads both consumed-event ledgers
  (`delivery_relay_consumed_events`, `delivery_inventory_relay_consumed_events`) and
  returns the `poisoned` count per ledger, a per-event-type breakdown, the oldest and
  newest poisoned timestamps, and an `alert` verdict — behind an **eleventh scope**,
  `delivery:ops:relay-dead-letters:read`, separate from everything before it.
  **The table is the source of truth, not an in-process counter.** A counter in memory
  would reset on redeploy and multiply by replica count, and **a false zero reads as
  cleanliness** — which is precisely the defect the metric exists to deny. Both ledgers,
  the breakdown and the measurement timestamp come from **one SQL statement**, so the
  published total corresponds to a moment that actually existed; two sequential queries
  would produce a total that never did, and an alert on a number that does not add up is
  an alert that gets silenced. The measured column is `updated_at`, not `consumed_at`:
  the row is created on the **first** attempt and poisoned after they are exhausted, so
  `consumed_at` is the age of the first attempt, not the age of the loss.
  **The thresholds are code constants published in the response body**
  (`alert.thresholds`), following the `Retry-After` precedent of review 19/N. `warning`
  fires at **one row**, because a poisoned row is a **lost event**, not a held one, and a
  higher threshold would mean loss tolerated by written decision. `critical` fires at ten
  (a standing systemic defect) or when the oldest is neglected for a day (the warning was
  read and not acted on); the count reason takes precedence over the age reason when both
  hold. An environment variable would be raised at night without review or trace; the
  constant's change **fails a test named after it**. And a copy of the threshold at the
  collector would be a second source of truth that diverges in one review and is
  discovered in an incident.
  **The verdict informs, it does not govern:** `gates_readiness: false` is published in
  the body, and `critical` does not change `GET /delivery/ready` (the §4.17 precedent) —
  proven by measurement, with 99 poisoned rows and readiness still `200 ready`. A corrupt
  past event is not a present outage, and coupling them would let one poisoned row take
  down a healthy service, after which **either the row gets deleted or the alert gets
  weakened**. The route answers `200` even at `critical` — the measurement succeeded even
  if what it measured is bad — and the only legitimate error is `500` when no measurement
  port is wired: "I don't know" is said, never translated into zero.
  **A real defect was found by the integration test alone.** Timestamps arrive as
  **strings**, not `Date`, because the rows are wrapped in `json_agg` (the `pg` driver
  does not convert inside JSON), so every read containing **at least one poisoned row**
  threw a `TypeError` — the incident path specifically — **while the empty case passed**.
  A metric that works when there is nothing and fails when there is something is worse
  than no metric. No in-memory fake could have found it. Fixed at the root: the timestamp
  is formatted in SQL (`to_char … AT TIME ZONE 'UTC'`), so its literal shape is decided
  here rather than left to a driver layer, and the parser **raises** on an unreadable
  timestamp instead of swallowing it as `null`.
  Measured locally on PostgreSQL 18.6: **32 new tests** (14 pure-domain, 10 at the HTTP
  boundary, 8 integration on a real database, including a **read-only proof** that the
  two ledgers' fingerprints are unchanged across the call), and the phase-13 exit gate is
  now **19/19** (was 17/17) with two assertions that the route is **wired into the real
  composition root** — so it measures a real database rather than returning 500 — and that
  `401`/`403` are enforced over a socket. `docs/13-observability/` now holds its first
  file, a metric contract; the runbook is `docs/14-runbooks/RELAY_POISONED_EVENTS.md`.
  Earlier statements across the docs that the directory "is empty" were true when written
  and are annotated with audit notes rather than erased.
  Not claimed: **no alarm rings**. There is no alerting system and no deployment
  environment in this repository, so the metric is read by asking — whoever does not ask
  does not know. There is still **no re-process/replay path for a poisoned row** (the
  second limit of `RISK-0035` stands): it is a safety question, not a missing method — who
  decides the corruption is gone, and is an old event re-applied to state that has moved
  on? The operational repair is described in the runbook, **unmeasured and unclaimed**.
  There is **no retention policy**, so the count is cumulative and `warning` stays up
  until a row is deleted deliberately — intended today (loss is not forgotten) and written
  down so it is not read as a defect. There is no acknowledgement column distinguishing a
  handled poisoned row from a neglected one. And nothing here was measured on PostgreSQL
  15/17.6 (the CI versions) or against a production database.
- **M5-13R (poisoned-row requeue) — review 22/N, claims `CLM-0157` + `CLM-0158` + `CLM-0159`.** The
  **second** limit declared when `RISK-0035` was closed is now lifted: a poisoned relay
  row has a way back. Route fourteen,
  `POST /delivery/relay/dead-letters/{ledger}/{eventId}/requeue`, sits behind a **twelfth
  scope**, `delivery:ops:relay-dead-letters:requeue`, **separate from `…:read`** — folding
  requeue into the read scope would let any stolen dashboard token rewind both delivery
  relays to zero repeatedly, a read-amplification flood held by a **look** permission.
  Rejection happens **before the port is called**, and that is asserted, not assumed.
  **Two moves in one transaction, or neither.** Review 39/N measured two facts before a
  line was written: the consumed ledgers hold **no payload and no `occurred_at`** — they
  are judgement ledgers, not message queues — and `poisoned` is a **terminal** status, so
  `relay.ts` short-circuits it and `replayFrom` alone looks like a replay path while
  replaying nothing. So the adapter lifts terminality (`poisoned` → `pending`) under
  `FOR UPDATE` **and then** rewinds that ledger's checkpoint to `ZERO_CHECKPOINT` via
  `ON CONFLICT`, on one connection in one transaction. Either move alone is a lie: lifting
  the status alone drops the row out of the **§4.23 metric** (it is no longer `poisoned`)
  while the advanced checkpoint means it is never read — **loss made more hidden than it
  was**, which is worse than not requeuing at all. This is measured, not argued: **two
  mutations** (disable the rewind; disable the status lift) each **fail the end-to-end
  proof**, so the test is not decoration.
  **Evidence is not erased.** `attempt_count` and `last_error` are deliberately left
  untouched — the ledger keeps no history, so they are the only trace of **why** the row
  was poisoned, and wiping them would make every rescue attempt destroy the cause of the
  defect. The cost is **declared, not hidden**: the relay computes
  `attempt = attempt_count + 1`, so an exhausted row gets exactly **one** more try and
  then re-poisons with a fresh reason.
  **The rewind cost is published in the response.** `rewind_cost:
  "full_rescan_from_zero"` — there is no way to rewind *precisely* to just before one
  event without copying a third field into the ledger and creating a duplicated source of
  truth, which §4.23's own preamble rejects. Idempotency makes every terminal row on the
  way back a **no-op**; the price is a batched rescan from the start of the outbox, a
  **read, not a write**, on a rare operator action rather than a hot path. A caller
  reading a bare `requeued` would think the replay was instant and escalate an incident
  when the row is not applied within a second.
  **`202`, not `200`; `requeued`, not `reprocessed`.** The call accepted the requeue; it
  did not complete it. The relay reads the row on a later cycle and may re-poison
  immediately if the cause is unchanged — a response saying "recovered" would **close an
  incident over a standing loss**. Two distinct rejection codes, too:
  `DELIVERY_RELAY_DEAD_LETTER_NOT_FOUND` (404, no such row) and
  `DELIVERY_RELAY_DEAD_LETTER_NOT_POISONED` (409, row exists in another state, **with the
  observed state in the message text**). Merging them would send an operator mid-incident
  chasing a valid id, thinking they mis-copied it, when in fact a colleague beat them to
  it a second earlier. The state is in the **message**, not `details`, by measurement:
  the published delivery error contract is three fields and `http/errors.ts` **does not
  emit `details`** — asserting on `details` would have been a green claim about a field
  that never reaches the wire, and that is exactly what happened once and was corrected.
  **A guard gap was closed on the way through.** Every check in
  `scripts/checks/validate-launch-board.sh` — allowed status, closure evidence, duplicate
  ids — runs over the output of a single strict `grep`. A row whose id did not match was
  therefore **dropped from every check silently, and the guard exited green**. It surfaced
  because this item was first filed as `M5-13-R` (two hyphens): the validator printed 90
  items while the board held 91. That silent gap between the two numbers **is** the
  defect. It is now a hard failure checked on the **id cell** rather than line-start, with
  seven governance cases including the decisive one: a malformed row carrying a
  **forbidden status** no longer escapes the status check. The governance suite went from
  246 to 252 cases, zero failing.
  Measured locally on PostgreSQL 18.6: **35 new tests** (9 pure-domain, 12 at the HTTP
  boundary, **14 integration on a real database**). The claims a memory fake cannot make:
  both moves commit together; `attempt_count` and `last_error` survive, asserted on real
  columns; a **rejected call writes not one byte** (ledger and checkpoint fingerprints
  before and after); the neighbouring relay's checkpoint is **untouched**; the checkpoint
  row is **created** when absent; and the row leaves the §4.23 poisoned count read through
  the metric adapter itself. The load-bearing test is the **end-to-end proof**: a relay
  batch **before** the requeue applies **0** and leaves the task `dispatch_requested`;
  after it, **1** is applied, the task is `driver_assigned` with its courier, and the
  verdict is `applied`. Both blockers are staged in the fixture (terminal verdict **and**
  an advanced checkpoint), so the test cannot bless an application that would have
  happened anyway.
  Not claimed: **no distributed lock** — an in-flight relay batch can advance the
  checkpoint over the rewind after `COMMIT` and silently void the requeue; the row stays
  `pending`, so it is **visible in the metric and not lost**, but may not be read until
  another requeue. Lifting that needs an advisory lock on the consumer and is its own
  scope, and it is the next priority because it is the only declared limit that voids work
  already done. **One attempt for an exhausted row** (the price of keeping the evidence).
  **No bulk requeue** — a hundred rows means a hundred rewinds to zero. **Only `poisoned`
  is requeued.** And **no operator UI and no alert invokes this automatically**: the act
  is a human decision, since an automatic requeue driven by a metric would turn a systemic
  defect into an endless rescan loop. Nothing here was measured on PostgreSQL 15/17.6 (the
  CI versions) or against a production database, and **CI itself returned no verdict**:
  the account is billing-blocked (`RISK-0039`), so local green is not a gate verdict.
  **Update 2026-09-15 (M5-13R · CLM-0174 · branch `fix/m5-13r-relay-advisory-lock`):** the
  first declared limit above — **no distributed lock** — is lifted by addition, not by
  erasing the paragraph that declared it. The consumer now holds a session-level
  `pg_advisory_lock` for the entire batch (checkpoint read through the last checkpoint
  write — the batch is not one transaction, so the xact lock would drop mid-batch, which
  is exactly where the race lived), and the requeue takes `pg_advisory_xact_lock` on the
  **same key** inside its transaction, auto-released at `COMMIT`/`ROLLBACK`. The key
  `(RELAY_ADVISORY_LOCK_NAMESPACE, hashtext(consumerId))` is exported from **one**
  module both sides import (the M0-15 lesson: a constant written twice drifts silently),
  and the consumer name itself is the key, so the two ledgers cannot block each other —
  **proven, not inferred**. `lock` is a **required** field in `RelayDeps` and
  `InventoryRelayDeps` (an optional field would make its absence a silent green — the
  defect species this repo has recorded twice), so forgetting it is now a compile error.
  `replayFrom`/`replayInventoryFrom` went under the lock too — same wound, same patch.
  **The decisive proof is choreographed, not hoped for:** a batch paused mid-flight on a
  gated event source (it read the stale checkpoint and holds the lock) + a requeue
  starting in that exact moment — with the lock, the requeue waits, the rewind lands
  **after** the batch, and a third batch re-reads the requeued row (a recorded second
  attempt) instead of the checkpoint swallowing it forever. **Both halves were mutated
  separately and measured (2026-09-15, PostgreSQL 18.6 local):** disabling the requeue
  lock alone fails 2 tests in under a second with the true assertion (not a silent
  timeout — a stalling cleanup that masked failures was found and fixed along the way);
  disabling the consumer lock alone fails the blocking test and the designed race. Both
  halves are required together. Measured: **5 new integration tests + 4 pure ordering
  tests · 125/125 integration · 533/533 unit · full repo typecheck clean.** Decision:
  ADR-026 §4.25. HTTP contract note: DELIVERY_HTTP.md §2.3د (202 may wait for one
  in-flight batch by construction — bounded, no configured timeout). Operator note:
  RELAY_POISONED_EVENTS.md §4. Declared limits that remain: one attempt for an
  exhausted row · no bulk requeue · only `poisoned` is requeued · no automatic
  requeue. **No CI verdict is claimed here — it is read from the CI runs after the
  push, and local green is not a gate verdict.**

  **CI verdict read (2026-09-15, run 34910328958):** the delivery db-integration
  job failed on PostgreSQL 15/17.6 with `already_recorded` whose `acknowledged_by`
  is `null` — a pre-existing semantic defect in the conflict-acknowledgement path
  that CI timing exposed and local 18.6 timing never did (local green is not a
  gate verdict; this is the run that proves the difference). Root cause and fix
  (ADR-026 §4.26): the single-statement design read the loser's response with the
  statement-start snapshot, i.e. the pre-winner-commit version — a response saying
  "you were beaten" that names nobody. The barrier is now one transaction with two
  statements (the UPDATE stays the winner barrier; on a miss a fresh-snapshot
  statement names the winner; the state is one-way so the inter-statement window is
  benign), proven by a deterministic designed-race test (loser provably blocked via
  `pg_blocking_pids` before the winner commits — fails on the old design with the
  exact CI symptom, passes on the fix: 126/126 integration, 533/533 unit). No test
  weakened, no skip classified.
- **M5-13 (poisoned-row acknowledgement) — review 24/N, claim `CLM-0181`.** The metric
  from review 21/N could say *warning* forever about a row that **is never coming back**:
  the producer was deleted, or the payload was corrupt at the source, so the requeue path
  of review 22/N re-poisons it on every attempt. One option was left to the operator in
  practice — **learn to ignore the alarm** — and that is a measurement defect, not a
  comfort defect. Route **fifteen**,
  `POST /delivery/relay/dead-letters/{ledger}/{eventId}/acknowledge`, sits behind a
  **thirteenth scope**, `delivery:ops:relay-dead-letters:acknowledge`, **separate from
  both `…:read` and `…:requeue`**: acknowledgement silences a **judgement**, so a stolen
  dashboard token would otherwise mute a real loss alarm with no hand repairing anything,
  and a token trusted to *retry* is not thereby trusted to declare a loss acceptable.
  Rejection happens **before the port is called**, and that is asserted, not assumed.
  **It adds, it does not erase.** `consumed_status` stays `poisoned`, `attempt_count`,
  `last_error` and `updated_at` are **untouched** (measured on four columns after the
  write), and `total_poisoned` is still published alongside its split
  (`total_acknowledged_poisoned` + `total_unacknowledged_poisoned`). Only **severity**
  excludes acknowledged rows, and the return to `ok` carries a **named** reason,
  `all_poisoned_acknowledged`, never `no_poisoned_rows` — a dashboard can tell *nothing
  broke* from *everything broke and was signed off*. Both ages are published, the alert
  age counting **unacknowledged** rows only.
  **The reason is mandatory and the bound rejects rather than truncates.** Trimmed, 12..512
  characters, enforced in the pure decision **and** by a database `CHECK`, because a
  silently truncated reason is a forged audit line. The acknowledger comes from the proven
  identity alone — never from the body, whose only accepted key is `reason` (an extra key
  is a 400, not a shrug).
  **Read-then-write under `FOR UPDATE`, deliberately.** A single
  `UPDATE … WHERE poisoned AND acknowledged_at IS NULL` returns **zero rows for three
  different situations** (absent row · not poisoned · already acknowledged), and an
  operator inside an incident needs three answers, not one. The second call is a **200
  `already_acknowledged` carrying the first acknowledger** (the §4.20 precedent), the
  transaction rolls back, and no overwrite happens. **Requeue after acknowledgement clears
  the acknowledgement triple** — a row judged *handled* does not carry that judgement into
  a second life. Constraints do the enforcing: all-or-none triple · acknowledgement only on
  `poisoned` · reason bounds · a partial index on unacknowledged rows.
  Measured: **46 cases in four layers** — 13 decision · 7 verdict · 18 on the wire · 8 on
  real PostgreSQL (four untouched columns · three direct writes rejected with `23514` ·
  the ledger fingerprint unchanged by a rejection and by the second call · requeue clearing
  the triple) · plus 2 migration-with-data cases across `0003` up and down. Service suite:
  **571 passed / 0 failed in 37 files** on the default path (integration runs in CI only —
  no local `DATABASE_URL`). Decision: ADR-026 **§4.27** (`§4.26` was already taken by the
  review-23/N CI-audit correction, and every file first written as §4.26 was corrected in
  this batch). Contract: DELIVERY_HTTP.md §2.3هـ. Metric contract §3 (the verdict table was
  corrected **by addition** — the old line is still readable). Operator procedure:
  RELAY_POISONED_EVENTS.md §4.1.
  **The batch's discovery is a production defect in review 22/N, not in this item —
  `RISK-0044` (high):** `relayRequeuePort` was **never wired** into the production root
  (`services/delivery/src/http/server.ts`) or into the exit-gate harness
  (`packages/delivery-e2e/src/harness.ts`). Route fourteen — declared *live* — answered
  **500 to every operator** for roughly 24 hours while **35 tests were green**, because
  every test builds the app with its own dependencies and therefore witnesses nothing about
  the root's composition. Both ports are now wired in both places and the boot log names
  them. **The risk does not close with the fix:** no guard matches the optional ports
  `createApp` accepts against what the root actually mounts, so the defect returns with the
  first port anyone forgets. **The 24-hour silence is part of the evidence and is not
  erased.**
  Declared limits that remain: no bulk acknowledgement · no un-acknowledgement without a
  requeue · no acknowledgement history (a column, not a log table: the first acknowledger
  stays) · no alarm rings in this repository. **No CI verdict is claimed here — it is read
  from the CI runs after the push, and local green is not a gate verdict.**

  **CI verdict read (2026-09-15, run 35013133735): 30 checks pass, two fail** —
  `db-integration (delivery)` and `db-integration-shared`, on one assertion:
  `relay-dead-letters.integration.test.ts` (review 21/N) compares `metric.ledgers`
  **literally and completely** with `toEqual`, and the metric now publishes three new
  fields (`acknowledgedPoisoned`, `unacknowledgedPoisoned`,
  `oldestUnacknowledgedPoisonedAt`). The **expectation** was corrected with those three
  fields plus the two new totals, and the comparison **stayed `toEqual` — it was not
  softened to `toMatchObject`**: a field added silently to a published response *must*
  fail this test, and that is exactly what it did. Softening the comparison would have
  switched off the guard that worked. **That file does not run locally** (`describe.skipIf`,
  no `DATABASE_URL`), making this the **second case in two days** where the CI verdict
  proved something local green cannot — the first was `already_recorded` in review 23/N.
  Local green is not a gate verdict, written twice now from measurement rather than
  advice.
- M5-13R moves to `Ready for Gate`, not `Completed`. M5-13 moved to `Completed` on
  2026-09-25 (CLM-0350) by program owner executive delegation: 25 reviews completed,
  exit gate (inventory/payment E2E) passing in CI, all 5 deferred items raised,
  RISK-0035/RISK-0044 closed, RISK-0012/RISK-0041 mitigated. Remaining risks are
  architectural decisions (RISK-0034) or cross-cutting concerns addressed in other
  milestones.

## Remaining, in dependency order

1. Boundary audit across all 26 services: classify each as `KEEP_IN_MARKET`,
   `MOVE_TO_CORE`, `MOVE_TO_MOVE`, `REFACTOR`, `REBUILD` or `RETIRE`, with
   evidence from the code rather than the folder name.
2. Migration matrix per entity, published in `docs/migration/`.
3. Adopt the CORE identity contract; retire local identity/auth as the source
   of truth once CORE holds it.
4. Canonical Commercial Order model, cleanly separated from any operational
   job or delivery execution state.
5. Produce `market.order.created` through a transactional outbox using the
   canonical event envelope; consume `core.fulfillment.completed`.
6. Remove any direct coupling with MOVE; all cross-system traffic goes through
   CORE APIs or events.
7. Hand billing, subscriptions, notifications, reputation, referrals,
   geography reference and compliance concerns to CORE.
8. Reconciliation and dry-run tooling for order and identity migrations.
9. Cutover and rollback rehearsal.

## Migrated

Nothing.

## Retired

Nothing. No legacy component is switched off before its replacement is proven.

## Blockers

| # | Blocker | Impact | What unblocks it |
|---|---|---|---|
| B-1 | Production data inventory unknown (row counts, live orders, duplicate identities) | No migration can be planned against real volumes | Read access to production, or an exported inventory |
| B-2 | Duplicate-identity merge policy undecided | Identity handover to CORE cannot complete | An owner decision on canonical selection and conflict rules |
| B-3 | No CORE database or environment provisioned | Integration against CORE cannot be executed end-to-end yet | Infrastructure decision and provisioning |
| B-4 | Regulatory pricing policy undecided | Commercial pricing rules cannot be finalised | A legal/regulatory decision |
| B-5 | No production release approval | No production deployment will be attempted | Explicit owner approval |

## Open questions

- Which of the 26 services are actually running, and which are scaffolding?
- Which tables here hold live commercial data versus fixtures?
- Which contracts under `packages/contracts` are honoured by a real
  implementation today?

## Risks

| Risk | Severity | Note |
|---|---|---|
| Services present here that the architecture assigns to CORE or MOVE | high | Presence is not ownership; each needs an evidenced disposition |
| Order model conflating commercial and operational concerns | high | Must be split before the fulfillment flow is wired |
| Contracts drifting ahead of implementation | medium | A contract without a producer and consumer is not implemented |
| Ownership and tenancy asserted by the caller, not bound to the token | high | `RISK-0042` — `TOKEN_BOUND_OPERATION_COUNT = 0`; 11 marketplace routes never check store membership; closed by `M1-05B` |

## Tests that pass at this commit

Measured on real PostgreSQL 18.6, not estimated (CI runs 15/17.6 — that combination is
not measured here):

- `services/delivery` unit suite: **459/459** in 29 files (was 449 in 28 — the 10 new
  tests cover the retry-delay table, its bounds and the declared-promise reader).
- `services/delivery` integration suite: **91/91** in 10 files (was 90 — the new test
  creates a real idempotency-key race in a loop and asserts both the header and that an
  immediate retry replays; it fails explicitly if no refusal is ever observed).
- `@wasla/contracts-delivery`: **29/29** (was 28 — the new guard asserts `ConflictError`
  is the only response declaring `Retry-After`).
- `@wasla/delivery-e2e` phase-13 exit gate with a database: **17/17** in 1 file (was 16),
  rerun five times with the same result.
- `pnpm -r typecheck`: clean.
- `bash scripts/checks/verify-governance.sh`: all executed checks pass; two declared
  partial skips (claim dormancy across branches, and live CI status).

No existing test was modified or removed. The cross-repository WASLA integration work
still has no test of its own here.

## Not proven yet

- Integration with CORE (not attempted).
- Any data migration.
- Any cutover or rollback.

## Cross-repository status (recorded 2026-09-11)

- WASLA CORE canonical repository: `noor-seez/wasla-core` — permanently
  independent. It is not merged here, not vendored here, and not a shared
  package. CORE published its Money (double-entry ledger, wallets,
  authorization/capture) and Fulfillment coordination cycle at commit
  `f0eccc4bf2`, verified locally: typecheck clean, 37/37 tests, governance,
  contract and migration gates passing.
- No cross-repository integration has started. This repository still emits and
  consumes nothing from CORE.
- Nothing in this repository is left uncommitted by the WASLA work: every
  change made here is published on `main`.
- GitHub Actions runs normally in this repository; the roadmap gate and the
  WASLA CI workflow both passed on commit `da569d3e3b`.
- M0-41 (governance check 17, `RISK-0044` closed): a guard now matches every
  service app factory's optional ports against what the production root
  (`services/*/src/http/server.ts`) and the exit-gate harness actually mount.
  It exists because measurement, not fear: delivery route 14 was declared live
  in three documents while answering 500 to every operator for ~24 hours, with
  35 green tests that could not see it — each test builds its own dependencies,
  and `tsc` cannot object because the port is optional by definition. Live
  measurement: 13 services, 11 optional ports, 10 harnesses, 0 exemptions. Its
  first run found a second live instance of the same defect
  (`idempotencySweepPort` mounted in the root, missing from the delivery
  exit-gate harness) which is fixed in the same batch. Declared limit: the
  guard reads key presence, not the passed object's behaviour, and follows an
  imported contract only one hop — what closes the gap fully is an exit gate
  that calls every closed route on the real root and reads something other
  than 500.

- **M0-41 wiring proof rebuilt structurally (2026-09-16 · `CLM-0184`).** The check-17 guard proved
  wiring with a **text search for the port name across the whole `server.ts`**, so deleting the key
  from **the object actually passed to the factory** — the exact defect `RISK-0044` was born from —
  passed green as long as the identifier survived anywhere else in the file. The false positive was
  **measured, not hypothetical**: `catalogPort` appears both in `buildCatalogPort()` (line 92) and in
  the factory call object (line 246) of `services/delivery/src/http/server.ts`. The proof now comes
  from the composition object itself (`scripts/checks/lib/app_port_wiring.py`): strings and comments
  are masked, the literal is extracted by brace matching, only first-level keys count, conditional
  and variable spreads are resolved, **every** call site is measured (name, `import … as`, assignment
  alias), and anything unresolvable **fails loudly instead of reading as wired**. Eleven new
  mutations pin the bite (383 governance cases · 0 failing), including the one that used to pass.
  Two new published counters make the remaining honesty visible: `CONDITIONAL_WIRED_PORTS` (a port
  wired behind a runtime condition) and `FACTORY_CALL_SITES`. `RISK-0033` closed on fresh evidence
  (branch gone from the platform, its work ancestral to `main`), its structural gap carried to
  `RISK-0045`, and `RISK-0015` re-measured as **still open** — the in-memory replay store is an owner
  decision, and M0-41 never touched it.

- **M1-04 wave 8 — claim `CLM-0196`: no ingress boundary exists silently (2026-09-17).** Before choosing
  any item, `M1-06`'s claim was **re-measured instead of trusted**: the published-contract debt inventory in
  `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md` §5.9 really is empty and nine contracts really do declare
  `securitySchemes` — the claim is true **within its scope**. The scope itself was the defect. Counting the
  tree gives **14** ingress boundaries (`services/*/src/http/app.ts` + `packages/*/src/http/app.ts`): **9**
  call `registerServiceIdentity` and **5 call nothing at all** — `customers` (10 routes), `drivers` (17),
  `reputation` (11), `search` (3), `subscriptions` (12) = **53 routes with no authentication header**, and
  none of their five OpenAPI contracts declares `securitySchemes`, `security:` or 401/403. These are not test
  fixtures: each has `app.listen` in `src/http/server.ts` and each is in the runnable inventory shipped by the
  `M2-01` image. Root cause: gates 1–9 of `validate-service-auth-coverage.sh` are **declaration-driven** (they
  read `enforced: <svc>` from the ledger and then interrogate the code), so a boundary that declares nothing was
  invisible to every gate — **silence was a valid exit**. Delivered this cycle is **measurement and enforcement
  of the inventory, not authentication**: gate **10** in a standalone `scripts/checks/lib/ingress_boundary_gate.sh`
  (a missing file or missing function **fails**, it is never a silent skip); a new marked inventory §5.10 with five
  rows and `TOTAL_ROUTES: 53` where **every count is derived from the code on every run**; `RISK-0051` (sev:high,
  open); `ADR-034`; and **14 mutation cases** covering a silent boundary, a stale row for a now-enforced boundary,
  a boundary with no file on disk, per-row and total route-count drift, a closed risk id, a risk id with no
  declaration line, a missing owning-gate reference, deleting the block, deleting the gate's own library, and a
  boundary living under `packages/` — each case proving by byte comparison that it actually mutated before the
  bite is measured. §5.9's text is **not erased**; its scope is stated additively. Not claimed: **not one of the
  53 routes was closed**, no scopes, no `service-identity.ts`, no beneficiary binding and no contract updates for
  those five services; green here means "the debt is measured, guarded and owned", not "the boundary is safe".
  `RISK-0027` (the guard's blindness to outbound clients under `packages/` and `bots/`) is a separate, still-open
  defect that gate 10 does not close. Enforcement follows wave by wave, starting with `customers`, and each row
  leaves §5.10 only under a CI verdict. Promotion of `M1-04` to `Completed` is the program owner's authority alone (§9).

- **M1-04 wave 9 — claim `CLM-0197`: the customers ingress boundary is closed, identity **and** ownership in one
  batch (2026-09-17).** This is the first of the five boundaries measured by wave 8 to actually be enforced, and the
  first `M1-04` wave to enforce **both dimensions at once**: who is calling (`aud`/`scp`) and **whom the resource
  belongs to** (`obo`). The reason is the boundary itself — every route except `GET /health` carries
  `waslaPublicId` in its path, i.e. it touches a resource owned by one specific human (profile, saved places, order
  requests). Enforcing identity without ownership here would have closed one door and left a wider one open: any
  service holding a customers scope could have read any customer's profile. Delivered: a new
  `services/customers/src/http/service-identity.ts` (audience `customers`, **7 exported scopes**, **9 enforced
  operations**, `GET /health` open by explicit classification); **13 ingress cases** in
  `services/customers/src/__tests__/service-identity.test.ts` (no header ⇒ 401; forged ⇒ 401; expired ⇒ 401
  `AUTHN_EXPIRED`; wrong audience ⇒ 401 `AUTHN_AUDIENCE_MISMATCH`; token signed for another path ⇒ 401; correct token
  crosses; missing scope ⇒ 403; **no `obo` ⇒ 403**; `obo` not matching the path owner ⇒ **404**
  `CUSTOMER_PROFILE_NOT_FOUND` per `ADR-009`, so the boundary is not an existence oracle; replay ⇒ 401; replay store
  unavailable ⇒ 503; unknown route ⇒ 401 **before** 404; `/health` ⇒ 200); all **9** operations registered
  `dimension: "owner"` / `strength: "token-bound"` in `packages/authz-policy/src/bindings.ts`, so the derived
  counters move `TOKEN_BOUND_OPERATION_COUNT` **10 ⇒ 19** while `TENANT_BOUND` stays 8; the policy matrix
  re-measured (boundaries **9 ⇒ 10**, `ENFORCED_OPERATIONS` **84 ⇒ 93**, `ENFORCED_SCOPES` **68 ⇒ 75**); the
  published contract now declares what is enforced (`securitySchemes.ServiceAuth` on
  `x-wasla-service-auth`, per-operation `security:` and 401/403 on all 9 operations), so the boundary never spent a
  moment in the "enforced but contract silent" state gate 9 guards; and the `customers` row **left §5.10** with
  `TOTAL_ROUTES` **53 ⇒ 43**, a number derived from the tree so deleting a row without enforcing is rejected. Five
  e2e harnesses (`customer-e2e`, `order-e2e`, `driver-e2e`, `dispatch-e2e`, `negotiation-e2e`) now sign their calls;
  the only grant widened is the **test** fleet role `e2e-harness`, and `assertSignerComposition` was not relaxed.
  Not claimed: there is **no production HTTP caller** for this boundary today — `bots/customer-bot` calls the use
  cases in-process and no `CUSTOMERS_*_URL` exists in `packages/config/env-registry.json` — so this batch is measured
  by "the boundary rejects the unsigned", not by a signed production call over the wire; this is a deliberate
  departure from the §2.0 ordering rule, written down in ledger §5.6 (a door onto an owned resource is not held open
  waiting for a caller). `RISK-0051` stays **open**: four silent boundaries remain (`drivers` 17, `reputation` 11,
  `search` 3, `subscriptions` 12 = 43 routes), and the drop in `TOTAL_ROUTES` must not be read as general progress.
  `RISK-0027` is untouched. The two declared `M1-05B` exceptions were neither widened nor touched. Promotion of
  `M1-04` to `Completed` remains the program owner's authority alone (§9).

- **M1-04 wave 10 — claim `CLM-0198`: the drivers ingress boundary is enforced (2026-09-17).** This is the
  second of the five boundaries measured by wave 8 to be enforced. All 16 operational routes now require
  a signed service identity token with the correct audience (`drivers`), scope, and beneficiary; `/health`
  remains open by explicit classification. `requireBeneficiary` enforces ownership on 14 owner-scoped routes
  (ADR-009: 404 not 403 on mismatch). The OpenAPI contract declares `securitySchemes` and `security:` on all
  16 operations. The authz-policy matrix gains `drivers` as its 11th audience with 16 enforced operations
  and 14 scopes. `RISK-0051` stays **open**: three silent boundaries remain (`reputation` 11, `search` 3,
  `subscriptions` 12 = 26 routes). Promotion of `M1-04` to `Completed` remains the program owner's authority
  alone (§9). The server reads `WASLA_SERVICE_AUTH_KEYS` via the standard `keyRegistryFromEnv(process.env)`
  pattern (not a custom `SERVICE_AUTH_SECRET` env var), matching all other enforced services.

- **M1-04 wave 11 — claim `CLM-0199`: the reputation ingress boundary is enforced (2026-09-17).** This is the
  third of the five boundaries measured by wave 8 to be enforced. All 10 operational routes now require a
  signed service identity token with the correct audience (`reputation`) and scope; `/health` remains open
  by explicit classification. `requireBeneficiary` enforces ownership on 2 owner-scoped routes (`GET /reputation/scores/:subjectType/:subjectPublicId` and `POST /reputation/ratings`). The OpenAPI contract declares
  `securitySchemes` and `security:` on all 10 operations. The authz-policy matrix gains `reputation` as its
  12th audience with 10 enforced operations and 9 scopes; `TOKEN_BOUND_OPERATION_COUNT` moves 34 → 36 and
  `UNCLASSIFIED_OPERATION_COUNT` moves 67 → 75. Both e2e harnesses (`reputation-e2e` and `subscription-e2e`)
  sign their calls to the reputation service. `RISK-0051` stays **open**: two silent boundaries remain
  (`search` 3, `subscriptions` 12 = 15 routes). Promotion of `M1-04` to `Completed` remains the program owner's
  authority alone (§9).

- **M1-04 wave 12 — claim `CLM-0200`: the search ingress boundary is enforced (2026-09-17).** This is the
  fourth of the five boundaries measured by wave 8 to be enforced. Both operational routes
  (`GET /search/ready` and `GET /search/products`) now require a signed service identity token with the
  correct audience (`search`) and scope; `/health` remains open by explicit classification. Search has no
  owner-scoped routes, so no beneficiary binding is added. The OpenAPI contract declares `securitySchemes`
  and `security:` on both enforced operations with `401`/`403` responses. The authz-policy matrix gains
  `search` as its 13th audience with 2 enforced operations and 2 scopes; `ENFORCED_OPERATIONS` moves 119 → 121
  and `ENFORCED_SCOPES` moves 98 → 100. `search-e2e` signs its calls to the search service (97 unit tests,
  22 e2e tests over a real database, both green). `RISK-0051` narrows to **one** silent boundary remaining
  (`subscriptions` 12 routes = 12 total). Promotion of `M1-04` to `Completed` remains the program owner's
  authority alone (§9).
- **M1-04 wave 13 — claim `CLM-0201`: the subscriptions ingress boundary is enforced (2026-09-17).** This is the
  fifth and final boundary measured by wave 8 to be enforced. All 11 operational routes now require a signed
  service identity token with the correct audience (`subscriptions`) and scope; `/health` remains open by
  explicit classification. `requireBeneficiary` enforces ownership on 6 owner-scoped routes (4 `:driverPublicId`,
  1 `:ownerPublicId`, 2 body-extracted: `driver_public_id` and `referee_public_id`); beneficiary mismatch
  returns 404 not 403 (ADR-009). The OpenAPI contract declares `securitySchemes` and `security:` on all 11
  enforced operations with `401`/`403` responses. The authz-policy matrix gains `subscriptions` as its 14th
  audience with 11 enforced operations and 9 scopes; `ENFORCED_OPERATIONS` moves 121 → 132, `ENFORCED_SCOPES`
  100 → 109, `TOKEN_BOUND_OPERATION_COUNT` 36 → 43. `subscription-e2e` signs its calls to the subscriptions
  service. **`RISK-0051` is closed**: zero silent boundaries remain, zero unenforced routes. The
  `requireBeneficiary` helper returns `undefined` when `serviceIdentity` is not configured, so integration
  tests that call `createSubscriptionApp` without a key registry pass without signing. Promotion of `M1-04`
  to `Completed` remains the program owner's authority alone (§9).

- **M1-03 — claim `CLM-0202`: the service-token replay store is shared across instances (2026-09-17).**
  Chosen by re-reading the risk register rather than trusting a report: `RISK-0015` was the last
  `high` risk filed under `M1-03` with status `mitigating`, and its own line declared the blocker
  verbatim — "the root fix is an owner decision, not an agent decision". That blocker was lifted by
  an explicit executive authorization from the program owner (2026-09-17).
  **The measurement corrected the register**: the line said "at least four production roots"; the
  actual count is **fourteen** — thirteen `services/*/src/http/server.ts` plus
  `packages/bot-runtime/src/http/server.ts` — each constructing
  `new InMemoryServiceTokenReplayGuard()` for itself. The defect was never the `InMemory` class,
  which is correct within its scope; it was that **the decision was distributed across fourteen
  sites**, so a captured signed token was accepted once per instance, and fixing all fourteen once
  would not have prevented the fifteenth: `tsc` cannot see it (the type is fine) and every test is
  green because each test builds its own dependencies and never boots a production root.
  The fix (`ADR-035`): a **single wrapper** decides
  (`createServiceTokenReplayGuardFromEnv`), defaulting to **PostgreSQL** — not the Redis the old
  comments promised, which exists nowhere in the repository as package, config, or CI service —
  with acceptance as one atomic statement
  (`INSERT … ON CONFLICT (kid,jti) DO UPDATE … WHERE retain_until <= $4`) on
  `wasla_service_token_replay`, and `memory` mode rejected outright under `NODE_ENV=production`.
  The factory is **synchronous by design**: config resolves at boot, the socket opens lazily on
  first `remember()`, and open failures are **not cached**, so recovery needs no redeploy; an async
  factory would have propagated `async` through `buildBotApp` into three bots and their test
  harnesses — dozens of files unrelated to the risk. Check **20**
  (`validate-replay-store.sh`, four gates, seven mutation cases including the worst bypass: flipping
  the wrapper's default without touching any root) guards the direction. Proof runs against real
  PostgreSQL in a new `db-integration` leg whose context was **registered as blocking on `main`**
  (32 → 33 contexts, re-measured from the API, raw evidence committed): idempotent DDL,
  cross-instance sharing, kid-scoped keys, **ten concurrent attempts ⇒ exactly one acceptance**,
  expiry reclaim, sweep, env factory. The config registry gained three variables (59 → 62) and a new
  reader mode `indirect_literal`, distinguishing a literal present for an **indirect binding** from
  one present as a **default value** — conflating them would have blinded gate 8 to its own purpose.
  `RISK-0015` stays **`mitigating`** until the leg's verdict is read green by run id: code, tests and
  docs existing is not production proof, and local green is not a CI verdict. What is **not** claimed:
  check 20 proves the decision has not returned to the roots, not that the store works; the rate
  limiter in §7.1 is still per-process; and promoting `M1-03` or closing a milestone remains the
  program owner's authority alone (§9).

- **M0-42 — claim `CLM-0207`: closing `RISK-0040` and releasing `M0-42` to Ready for Gate (2026-09-17).**
  A documentation reconciliation batch, not code: `RISK-0040` is closed with a declared closure
  condition, the board moves `M0-42` to `Ready for Gate` (promotion to `Completed` is the program
  owner's authority alone, §9), and `BASELINE.json` is regenerated by the script (`risks_not_closed`
  36 ⇒ 35). CI verdict read on the PR (`WASLA CI` 35276107536 success, `Roadmap freshness`
  35276033330 success, 35/35 checks pass, merge state `CLEAN`).

- **M0-43 — claim `CLM-0208`: a general guard against production imports from `devDependencies`
  (2026-09-18).** Before this batch, one package (`service-auth` ← `authz-policy` in `dependencies`,
  gate 9 of check 16) was guarded locally by a specific gate, but **no general guard** matched
  production value imports (`src/**` excluding `__tests__`) against `dependencies` in every
  `package.json`. Any package or service adding a production import from a package declared only in
  `devDependencies` would pass green and crash at runtime under a `--prod` install. Check **22** in
  the unified gate (`validate-production-dependency-guard.sh`) wraps `prod_deps_guard.py`, which reads
  39 production packages (11 `*-e2e` packages excluded), collects value imports (not `import type`)
  from `src/**` excluding `__tests__`, and matches them against `dependencies` and mandatory
  `peerDependencies`. Ten mutation cases in `gov-cases-prod-deps-guard.sh` prove its bite: value from
  devDeps, multiline value import, value export, `export { type X }` (type-only, erased at build
  time), value from peerDeps, `import type` from peerDeps, multiline `import type`, e2e package
  (excluded), deleting the workspace package reader, and the baseline. `RISK-0043` ⇒ `closed` with
  a declared closure condition: the guard does not prove dependency completeness (that is `tsc`'s
  job) — it prevents one class: a value import from a non-production-declared package in a production
  file. Local measurement: full `verify.sh` EXIT=0 — 474 governance suite cases · 0 failed ·
  `tests_passed: 4838` · `verify_overall: passed`. `BASELINE.json` is generated from the log via
  `baseline.sh --log` (not hand-edited): `governance_suite_cases: 474` · `governance_suite_failed: 0`
  · `verify_overall: passed`. CI verdict on the PR (`WASLA CI` 35304325360 success, 35/35 checks
  pass — one transient corepack/npm network failure on `db-integration-shared` rerun green).
  Promotion of `M0-43` to `Completed` is the program owner's authority alone (§9).

- **M0-44 — claim `CLM-0209`: a guard that reads platform branches and requires every
  branch to have either an active claim, an open PR, or a declared evidence row with a
  written reason (2026-09-18).**

  The measured defect (`RISK-0045`): check 4 (stale claims) measures **claims**, not
  **branches**. The 2026-09-18 measurement shows 13 branches diverged from `main` with
  no active claim: 8 merged-PR branches not deleted, 2 closed-PR branches, and 3 `probe/*`
  branches that are deliberate evidence. No guard reads platform branches.

  **Implemented:** check **23** in the unified gateway
  [`scripts/checks/validate-platform-branch-freshness.sh`](scripts/checks/validate-platform-branch-freshness.sh)
  reads platform branches via `gh api` and classifies every branch: active (claim in
  WORK_CLAIMS.md) · open (open PR) · preserved (in
  [`BRANCH_EVIDENCE.md`](docs/16-progress/BRANCH_EVIDENCE.md)) · stale (none of the
  above). Stale branches fail the gate. Seven mutation cases in
  [`lib/gov-cases-branch-freshness.sh`](scripts/checks/lib/gov-cases-branch-freshness.sh)
  prove the guard's bite. `RISK-0045` ⇒ `closed` with a declared closure limit: the
  guard does not delete branches but requires every branch to be owned or declared.
  CI verdict on the PR (`WASLA CI` 35312389585 success, 35/35 checks pass).
  Squash `0d65f14` merged into `main`. `CLM-0209`/`CLM-0210` released (§8.1).
  Promotion of `M0-44` to `Completed` is the program owner's authority alone (§9).
