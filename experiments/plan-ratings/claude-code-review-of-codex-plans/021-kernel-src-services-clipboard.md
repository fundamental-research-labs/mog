Rating: 8/10

# Review: 021 — Kernel Clipboard Service Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. It correctly diagnoses that the kernel
`services/clipboard` folder is today a thin XState state holder, not the
"production clipboard authority" its own doc comments claim, and that the real
copy/paste/import/format-transfer behavior lives in the spreadsheet app while a
lossy kernel app-API bridge sits in between. I spot-checked the plan's most
load-bearing claims against the actual tree and they are accurate:

- `kernel/src/api/app/app-kernel-api.ts` `toKernelPayload` does hard-code
  `source.viewType: 'kanban'` (line 1333), synthesizes `col-${i}` IDs
  (lines 1322–1329), drops `formulas`/`formats` entirely, and writes only
  `text/plain` via `navigator.clipboard.writeText` (lines 1229–1230, 1248–1249).
- The current `clipboard-service.ts` has no paste-session token: `PASTE_COMPLETE`
  / `PASTE_ERROR` carry no session/version id, so a late async completion can
  mutate newer state — exactly the correctness risk the plan calls out.
- `getPayload()` returns the live context payload object (line 298–300), so the
  mutable-shared-payload risk is real.
- The duplicated/parallel contracts (`kernel/.../types.ts`,
  `types/api/src/services`, `types/api/src/apps/api.ts`, the spreadsheet
  `domain/clipboard` suite) all exist as described.

Because the plan's premises are verifiable and its invariants are the right ones,
it would meaningfully guide an implementer. The main reasons it is not a 9–10 are
scope sprawl well beyond the named folder, under-specification of where the
canonical contract lands, and a missing treatment of public-API back-compat.

## Major strengths

- **Accurate, citable diagnosis.** Nearly every concrete claim maps to a real
  line in the tree. This is the difference between a plan and a wish.
- **Invariant-first framing.** The "contracts and invariants to preserve or
  strengthen" section is the best part: rectangularity, dimension agreement
  between values/formulas/formats, `tableContext` length agreement, source-field
  preservation, capability independence of `clipboard:read` vs `clipboard:write`,
  and the dependency-direction rule (kernel must not depend on `apps/spreadsheet`).
  These are testable and they target the actual defects.
- **Correct identification of the paste-session race** and the mutable-payload
  aliasing bug as correctness issues, not cosmetics.
- **HTML-first import semantics** and "text/html is not an independent untrusted
  field — sign it against the rich payload" is a sophisticated, correct stance.
- **Sequencing and parallelization** are realistic: canonical contract + pure
  normalizers first (with tests), then kernel internals, then app/UI call sites,
  then delete the deprecated `ViewClipboardData` path. The worker decomposition
  matches the dependency graph.
- **Headless determinism** via an in-memory host port instead of scattered
  `navigator`/`DOMParser` feature checks is the right architecture for the test
  fleet.

## Major gaps or risks

- **Scope vs. the assigned folder.** The folder is three small files (~15KB), but
  the plan effectively proposes refactoring the entire cross-app clipboard stack:
  a new public contract package, codec extraction out of `apps/spreadsheet`, a new
  host-port abstraction, app-API rewrites, and grid-editing/coordinator migration.
  That is defensible (the folder genuinely cannot become the authority in
  isolation), but the plan never states a minimal first landable increment scoped
  to the folder itself. An implementer could spend weeks before anything ships. A
  "phase 0 that lives entirely inside `services/clipboard`" (session tokens +
  immutable `getPayload` + normalizers + tests) would de-risk this.
- **Canonical contract location is hand-waved.** "Choose one canonical public
  payload contract under the public contracts/types layer" — but the codebase has
  both `@mog-sdk/contracts` and `types/api`/`types/app-platform`. The plan should
  name the target package and say which existing type wins. This is the single
  highest-leverage decision and it is left open.
- **Public-API back-compat is unaddressed.** `AppClipboardPayload` in
  `types/api/src/apps/api.ts` is a published app-platform surface. The plan says
  "update or replace" it and mentions an API snapshot check, but does not discuss
  whether this is a breaking change for existing app authors or how to stage it.
  Given the project's publish-readiness gates, this needs an explicit answer.
- **No concrete signatures.** The plan names helpers (`normalizeClipboardPayload`,
  `computeClipboardSignature`, `ClipboardHostPort.write/read`) and a `Result`-vs-
  snapshot-error decision, but defers the actual TypeScript shapes. For a contract
  consolidation whose whole point is precision, leaving signatures unspecified
  pushes the hardest design work to implementation time.
- **Conditional-format and merged-span transfer are hedged** ("where the
  production paste executor supports it"). That ambiguity invites silently
  dropping these on the floor; the plan should require the inventory step to
  enumerate exactly what `conditional-format-paste.ts` / merged spans support and
  make a pass/defer call per field.
- **Signature comparison semantics are thin.** "Compare system contents with the
  kernel signature to choose internal vs external" — but clipboard round-trips
  through the OS normalize whitespace/line-endings inconsistently across
  browsers/OSes. The plan acknowledges line-ending normalization in tests but does
  not specify the canonicalization function that both write and read must share.

## Contract and verification assessment

The contract section is the plan's strongest dimension and is largely sufficient:
the invariants are precise enough to become assertions, and the capability-gating
and dependency-direction rules are explicit. The gap is that the *target type*
and its *exact fields/signatures* are not pinned, so two workers could still
diverge.

Verification gates are good and appropriately layered: kernel-service state-machine
unit tests (every transition incl. late-session rejection), property tests for
normalization (ragged rows, dimension mismatch, mutation-after-copy, line-ending
signatures), codec tests across TSV/CSV/HTML/styles/errors/dates, capability-
independence tests, spreadsheet integration tests, and real-keyboard browser E2E
with an explicit "do not seed clipboard by direct actor mutation" rule — which is
exactly the failure mode that makes clipboard E2E worthless. The named gate
commands (`pnpm test`/`typecheck`, API snapshot, dev-server exercise) are
correct. What's missing: no acceptance criterion ties the new session-token model
to a *specific* regression test proving a stale `PASTE_COMPLETE` is rejected, and
no gate asserts the public-API snapshot diff is intentional rather than incidental.

## Concrete changes that would raise the rating

1. Add a **Phase 0 scoped strictly to `services/clipboard`**: introduce a paste
   session/version token, make `getPayload()` return a frozen/cloned snapshot, add
   the pure normalizers + invariant assertions, and ship the kernel unit/property
   tests — all without touching apps. This is independently valuable and verifies
   the riskiest correctness claims early.
2. **Name the canonical contract's home package and the winning type**, and state
   the deprecation/alias policy for `AppClipboardPayload` and `ViewClipboardData`
   explicitly, including whether the app-platform change is breaking.
3. **Inline the key signatures**: the normalized internal record, the host-port
   interface, the session events, and the shared text/HTML canonicalization
   function used by both signature computation and comparison.
4. **Resolve the `Result`-vs-snapshot-error question in the plan**, not at
   implementation time, since it changes the service interface every caller binds
   to.
5. Require the **inventory step to produce a per-`CellFormat`-field table** (and a
   conditional-format / merged-span verdict) marking each as transfer / defer, so
   fidelity claims are auditable rather than aspirational.
6. Add an **explicit acceptance test** for late-session rejection and an
   intentional-API-diff gate to the verification list.

These are refinements, not corrections — the plan's analysis is sound and its
direction is right.
