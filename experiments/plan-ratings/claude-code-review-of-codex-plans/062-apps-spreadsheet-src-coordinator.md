Rating: 8/10

# Review of 062 — Spreadsheet Coordinator Production-Path Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about
the `apps/spreadsheet/src/coordinator` folder checks out against the actual source,
and the few "smells" it targets are real, verifiable defects rather than invented
straw men. It correctly diagnoses the central tension in the folder: `SheetCoordinator`
is documented as a "~250-line pure composition root" but is in fact a 1,173-line file
carrying substantial production behavior. The improvement objectives, contracts, and
verification gates are specific, internally consistent, and mostly land on genuine
correctness invariants (disposal safety, idempotent push/pull projection, read-only
gates) rather than cosmetic refactoring.

The plan loses points for ambition-vs-atomicity: it is effectively ten loosely coupled
workstreams (host injection, actor-access migration, projection extraction, wiring
extraction, mutation normalization, sparkline hardening, shell relocation, docs) bundled
into a single folder plan, several of which the plan itself insists must land "in one
change set." That is a large, regression-prone surface for one workstream, and one step
(shell ownership) is left as an unresolved fork rather than a decision.

## Verified claims (spot-checked against source)

- **Composition-root drift is real.** `sheet-coordinator.ts` is 1,173 lines; its own
  header still claims "~250-line pure composition root." Plan item 10 explicitly calls
  out updating these stale comments.
- **Duplicated push/pull projection logic exists.** `wireFloatingObjectManager()`
  (lines ~724–949) and `processCoordinatorReceipts()` (`receipt-processing.ts`) both
  independently derive `applyBatch(...)` updates and `getObjects()?.applyPatches(...)`
  patches with create/update/remove/bounds handling — exactly the duplication item 3
  targets with a shared pure reducer.
- **The "snippet test" critique is precisely correct.** `receipt-propagation.test.ts`
  (line ~265) literally comments "We simulate what the dispatcher does with receipts" and
  calls `coordinator.processReceipts(result.receipts)` directly rather than exercising real
  `dispatch(...)`. Meanwhile `dispatcher.ts` *does* already call
  `coordinator.processReceipts(...)` for both sync (line ~1445) and async (line ~1412)
  paths — so the plan's invariant and its "update stale comments about future receipt
  wiring" instruction are both accurate.
- **Ambient host usage is present:** `queueMicrotask(flush)` and
  `requestAnimationFrame(...)` in `sheet-coordinator.ts`, `(window as any).__OS_DEVTOOLS__?.reportReceipt?.(...)`,
  pervasive `Date.now()` across `mutations/diagram.ts`, `mutations/equation.ts`, and
  `sparklines/sparkline-manager.ts`, and `queueMicrotask` in `connector-rerouting.ts`.
  `types.ts` already documents a confirm-injection seam, confirming the direction.
- **Actor-access debt is real.** `actor-access/index.ts` carries a `@deprecated`
  `createActorAccessLayerFromBundle(...)` and many `Record<string, unknown>`
  accessors/commands/selectors — the typed-aggregate target in item 6.
- **Sparkline hydration race is real.** `hydrateSheet()` returns `0` when a hydration is
  already pending (`pendingSheetHydrations.has(key)` → `return 0`), exactly the silent
  "returns 0 when work is pending" hazard item 8 flags.
- **Verification gates resolve.** Package name is `@mog/app-spreadsheet`;
  `tools/platform-dependency-allowlist.jsonc` exists; and every named app-eval scenario
  exists, including the exact files `cross-sheet/navigation/sheet-switch-commits-normal-edit.spec.ts`,
  `sheet-switch-during-async-commit-waits-for-completion.spec.ts`,
  `rendering/drawings/smartart-rendered.spec.ts`, and `sparklines/line-sparkline-insert.spec.ts`.

This degree of accuracy is the strongest signal in the plan's favor: a reviewer can trust
that the work described actually maps to the code.

## Major strengths

- **Tests-first sequencing.** Item 1 mandates contract/characterization tests
  (construction/start/dispose order, cleanup-exactly-once, real `dispatch(...)` receipt
  propagation) *before* extraction. This is the right ordering for a refactor of behavior
  that is currently under-tested, and it directly remedies the snippet-test weakness.
- **Sharp invariant statement.** The "Production-path contracts and invariants" section is
  the best part of the plan: durable state stays Rust/Workbook-owned, EventBus stays a
  downstream notification (never a persistence mechanism), push/pull projection must be
  equivalent and idempotent with structural sharing, disposal must be safe against pending
  microtask/RAF work, read-only gates must not be weakened. These are testable and
  enforceable.
- **Real verification, not mock theater.** It pairs package tests with concrete existing
  app-eval scenarios and adds a new E2E for the object delete/duplicate receipt path that
  asserts the dispatcher pull-path updates the renderer *before* the EventBus fallback —
  a meaningful end-to-end assertion of the core invariant.
- **Honest risk inventory.** The double-processing risk, sheet-switch interleaving,
  fire-and-forget writes hiding rejected promises, and host-global test churn are all
  acknowledged with mitigations. Edge cases (delete-after-queued-update, bounds-without-data,
  cross-sheet id collisions, multi-switch-before-commit) are concrete and test-shaped.

## Major gaps or risks

- **Scope is very large for one folder plan.** Ten implementation steps plus a five-agent
  parallelization scheme. Several steps demand atomic, repo-wide migrations: "Migrate all
  callers in one change set and typecheck" (actor bundle), "migrate callers to the new typed
  contract in the same workstream" (non-goals). Combined, these create a large blast radius
  and a hard-to-land single unit of work. The plan would be stronger if it explicitly
  ordered the workstreams as independently-landable increments behind the contract tests,
  rather than implying one mega-change.
- **Item 9 is a fork, not a decision.** "Decide whether `ShellCoordinator` belongs in
  `shell/` or under `apps/.../app`" leaves the single highest cross-folder-risk choice
  unresolved, with two divergent execution branches (move + delete `view-clipboard-data.ts`
  vs. retain + typed provider). For a plan that elsewhere commits firmly, this hedge weakens
  contract clarity and makes the step hard to estimate or verify. It should pick one and
  justify it.
- **User-visible payoff is under-articulated.** This is predominantly a quality/hardening
  refactor. The genuine bug classes it closes (post-disposal cache/renderer mutation,
  double-processed mutations regressing bounds, silently-swallowed rejected writes) are real
  but stated abstractly. One or two concrete reproducible symptoms ("object briefly snaps to
  stale bounds when receipt and event both arrive", "rejected diagram write silently leaves
  UI inconsistent") would sharpen prioritization and give the E2E gate a target symptom.
- **Idempotency contract is asserted but under-specified.** Item 3 says duplicate push/pull
  delivery should be "idempotent where possible" and "unchanged cache objects should retain
  references" — but does not define the equality/identity key used to detect "same state"
  (object id only? deep-equal? bounds epsilon?). Given the cache currently keys create-vs-update
  purely on `existingObjects.has(receipt.id)`, the reducer's dedup/identity rule is the crux
  of the whole unification and deserves an explicit spec.
- **Allowlist coupling is sequenced as "after."** Removing `platform-dependency-allowlist.jsonc`
  entries "after the implementation" is fine, but the plan doesn't note whether that file is a
  CI gate that would otherwise flag the *interim* states; a one-line note on whether the
  allowlist is enforced during the transition would de-risk it.

## Contract and verification assessment

Contracts are above-average in clarity. The push/pull equivalence requirement, the
`processReceipts` must-be-called-exactly-once assertion, the disposal-safety guarantees,
and the "all durable writes go through Worksheet API, not EventBus" rule are all stated as
checkable properties, and the test list (item-by-item, plus the dedicated "Focused
coordinator tests" section) maps cleanly onto them. The plan correctly distinguishes the
real `dispatch(...)` path from the existing snippet and demands the former.

Gaps: (1) the reducer identity/equality contract noted above is the main missing piece;
(2) "duplicate receipt/event delivery" tests are listed but the *expected* observable (no
patch emitted? patch emitted but no-op? reference retained?) isn't pinned; (3) the host
capability interface is enumerated by method but not by error/teardown semantics (e.g. what
`scheduler.requestAnimationFrame` returns for cancellation, what `confirm` resolves to in
headless tests). Verification gates themselves are excellent — correct package name, real
test target paths, and every named app-eval scenario exists on disk.

## Concrete changes that would raise the rating

1. **Specify the projection reducer's identity/equality contract** (id-keyed dedup, what
   counts as "unchanged" for reference retention, bounds comparison semantics). This is the
   single highest-leverage addition and the one most likely to cause subtle regressions if
   left implicit.
2. **Resolve item 9** — pick "move to `apps/.../app`" or "retain with typed provider" and
   delete the alternate branch, so the cross-folder step has one verifiable outcome.
3. **Re-sequence as independently-landable increments** behind the contract tests, and drop
   or soften the "in one change set" demands for the actor-bundle and typed-contract
   migrations (e.g. allow a deprecated overload to coexist for one PR), reducing blast radius.
4. **Pin expected observables for the duplicate-delivery and disposal tests** (assert no
   renderer patch / no cache mutation after dispose, assert structural sharing on no-op
   re-delivery), not just "cover" them.
5. **Add 1–2 concrete reproducible symptoms** the refactor fixes, and tie the new
   delete/duplicate E2E to one of them, to anchor production-path relevance.
6. **State whether `platform-dependency-allowlist.jsonc` is CI-enforced during the
   transition**, and if so how interim states avoid tripping it.

Net: a precise, well-researched, verification-serious plan whose main liabilities are
breadth and one unresolved fork — not correctness. 8/10.
