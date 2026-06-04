Rating: 8/10

# Review of 060 — Runtime Spreadsheet App Source Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every concrete claim it makes about
`mog/runtime/spreadsheet-app/src` checks out against the real source, and the gaps it
targets are genuine and verifiable — not invented. It correctly understands the package's
unusual role (a deliberate bundle-composition facade that internalizes private
`@mog/app-spreadsheet`, `@mog/shell`, `@mog-sdk/kernel` packages while keeping public
declarations private-type-free) and it preserves that intent throughout. The contracts and
invariants section is the best part: it reads like it was written by someone who actually
traced the lifecycle, save, and capability paths.

The main weakness is ambition. Nine multi-part objectives spread across six parallel agents,
including a behavior-preserving refactor of a 1,422-line `runtime.ts` into six modules, a
cross-package contracts metadata change, and a full real-input E2E suite. The plan does not
rank these by value-to-cost, so two of the cheapest, highest-confidence wins (wiring the
existing node tests into the test script; fixing the policy-snapshot capability omission) sit
buried among large speculative refactors that carry real regression risk.

## Major strengths

- **Accurate problem identification.** I verified the central claims:
  - `dirty-events.ts` is exactly the hand-maintained `Set<string>` of ~160 event types the
    plan describes (objective 4), with no mutation/read/lifecycle distinction — drift-prone
    and a legitimate target for contract-backed generation.
  - `runtime.ts` is 1,422 lines with lifecycle, save-state, authorization, events, and
    attachment logic interleaved in one controller class (objective 2).
  - `getEffectivePolicySnapshot()` → `policySnapshot()` enumerates a hardcoded list of only
    six capabilities (`workbook:read`, `export`, `screenshot`, `write`, `undo-group`,
    `decorations:write`) and **omits `workbook:policy-admin`**, which the matrix uses. The
    plan's objective 5 calls this out exactly. This is a real, concrete bug, not a vibe.
  - The package `test` script runs only `generate-workbook-facade-matrix.mjs --check` and
    `check-boundary.mjs`; the three `src/__tests__/*.test.ts` files use `node:test` and are
    **not run by the package test script** (objective 8). Verified.
  - `check-boundary.mjs` is regex-heavy (objective 1's AST recommendation is grounded).
  - `runtime/sdk/src/generated/api-spec.json` exists and is the right source of truth for
    facade method coverage; `contracts/src/events` exists with per-domain event files,
    making objective 4's "contracts owns the taxonomy" feasible.
- **Contract/invariant section is excellent.** Epoch invalidation, `detach()`-unmounts-only,
  single-attachment `AlreadyAttached`, `workbookId` (semantic) vs `workbookSessionId` (exact
  key), the five-field save-clean match (`epoch`, `dirtyEpoch`, `changeSequence`,
  `saveRequestId`, `bytesHash`), and read-paths-must-not-dirty are all stated as testable
  invariants. These are the right things to pin.
- **Real verification gates that exist.** `pnpm --filter @mog-sdk/spreadsheet-app
  {test,typecheck,build}`, `pnpm check:api-snapshots`, and
  `pnpm check:publish-readiness:fast` are all real, present scripts. Gating against built
  `dist` for boundary/declaration checks matches the package's actual build flow.
- **Sound risk register and explicit non-goals.** "Not a sandbox / not an isolation boundary
  for hostile content," and "do not expose private packages as host APIs" correctly fence the
  work. The refactor-ordering mitigation (land transition modules + golden tests before
  moving behavior) is the right sequencing instinct.

## Major gaps or risks

- **No prioritization / phasing by value.** The two cheap, low-risk wins
  (objective 8 test-wiring; the `policy-admin` omission in objective 5) are worth far more per
  unit effort than the `runtime.ts` six-module refactor, yet they're presented as peers. A
  plan this large should state a minimal first slice that lands value without the high-risk
  refactor, so the effort degrades gracefully if it stalls.
- **Cross-package contracts work is understated.** Objective 4 ("add mutation/read/event
  metadata to the contracts event source if it does not already exist, then generate the
  classifier from that metadata") mutates the shared public `@mog-sdk/contracts` package and
  its `@mog/types-events` taxonomy. That is a larger, higher-blast-radius change than the
  one-line phrasing implies — it affects every consumer of the event taxonomy and needs its
  own contract/snapshot discipline. It is listed under dependencies, but not costed as the
  separate workstream it really is.
- **E2E scope is broad and brittleness-prone.** Objective 7 asks for real
  keyboard/mouse/clipboard E2E across edit, save/export routing, detach/reattach, focus,
  slots, theme, and portal strategy. This is valuable but is the most expensive and flaky
  surface; the plan gives a good mitigation (assert public behavior/ARIA, not markup) but no
  bound on how much of this is in-scope for a first landing vs. aspirational.
- **"Generated or contract-backed wherever possible" is soft.** Objectives 1 and 4 lean on
  generation but leave the boundary between generated and hand-maintained fuzzy ("small
  package-local allowlist only for synthetic events"). Without a crisp rule for what stays
  manual, the allowlist can quietly reabsorb the drift problem the generation was meant to
  solve.
- **Parallelization has hidden coupling.** Agents B (lifecycle/save extraction) and C
  (authority/facade) both touch the authorization path that currently lives inside
  `runtime.ts` (`authorize`, `policySnapshot`, `resolveActor`). The plan assigns
  `authorization.ts` to B's module list and the policy work to C, which is a likely merge/seam
  conflict. "Naturally parallelizable if contracts are assigned up front" undersells this.

## Contract and verification assessment

The contract surface is the plan's strongest dimension. Invariants are concrete, mostly
falsifiable, and tied to the real public API (`createSpreadsheetRuntime`,
`MogSpreadsheetApp`, `mountSpreadsheetApp`, and the `public-types.ts` exports — all
confirmed as the actual root surface). The "every Workbook/sub-API method in `api-spec.json`
has exactly one matrix decision, no implicit allow" gate is exactly the right invariant for a
capability facade and is checkable today via the existing generator.

Verification gates are real and appropriately layered (package test/typecheck/build → API
snapshot → publish-readiness → boundary-against-dist). The one soft spot: the plan asserts
new node, React/browser, and E2E test layers but does not specify the runner wiring beyond
"update the package test script." Given the `src/__tests__` files use `node:test` and are
currently orphaned, the plan should name the concrete command(s) and where the
React/browser layer plugs in (the package has only `tsup`/`vite-css` configs today — no test
runner config), otherwise objective 8 risks under-specifying its own remediation.

## Concrete changes that would raise the rating

1. **Add an explicit phasing/priority order.** Define a minimal first slice — e.g. (a) wire
   `src/__tests__` into the package `test` script, (b) add `workbook:policy-admin` (and any
   other missing capabilities) to `policySnapshot` with a coverage test asserting the snapshot
   enumerates the full `SpreadsheetCapability` union — that lands verified value before the
   `runtime.ts` refactor. State that the large refactor is independently abandonable.
2. **Cost the contracts-metadata change as its own workstream** with its own snapshot/gate,
   and add a fallback: if event metadata cannot land in contracts this cycle, keep the
   package-local classifier but add the "every `@mog-sdk/contracts/events` type is classified"
   coverage test now (it catches drift even without generation).
3. **Resolve the B/C authorization seam.** Decide whether `authorization.ts` is owned by the
   lifecycle extraction or the policy work, and sequence one before the other, so the single
   runtime policy service isn't authored twice.
4. **Specify the test-runner wiring concretely** for the new node and React/browser layers
   (command, config file, where it hooks into publish-readiness), rather than "update the
   package test script."
5. **Bound the E2E scope.** Mark which real-input flows are in-scope for the first landing
   (suggest: edit + save/export routing + detach/reattach) vs. later (clipboard, portal
   strategy, every slot/theme permutation), so the most brittle surface doesn't gate the rest.
6. **Pin the generated-vs-manual rule** for the dirty classifier and boundary inventory: state
   that synthetic/runtime-only events must be individually listed with a justifying comment,
   and that anything in the shared taxonomy must be generated — no manual additions of shared
   types.
