Rating: 8/10

# Review of Plan 019 — `kernel/src/floating-objects`


## Summary judgment

This is a strong, evidence-grounded plan. Almost every concrete claim it
makes is verifiable against the actual source, with line numbers that land
on or within a line of the real code. It correctly identifies the module's
load-bearing dual read/write architecture (async writes through
`ComputeBridge` → Rust → event bus; sync reads off the kernel-owned
`FloatingObjectsProjection` mirror), states the invariants that must be
preserved, and proposes a sensible six-phase sequence ordered by severity
with the highest-risk correctness fix (sentinel anchors) landing first. The
phasing is honest about cross-folder coordination (`@mog-sdk/contracts`,
`api/`, `bridges/compute`) and the declaration-rollup ordering. It reads
like the author actually inspected the files rather than summarizing a
folder description.

The gap between this and a 9–10 is a handful of under-specified contracts
(the orphaned-anchor fallback is named as a goal but its exact semantics are
left "to be documented"), one factual imprecision about a sentinel literal,
and a few cross-folder dependencies asserted as available without confirming
they exist.

## Major strengths

- **Verified findings, not hand-waving.** I confirmed the core claims:
  - Sentinel anchors are real: `cell-anchor-resolver.ts:87` and `:366` use
    `toCellId('__placeholder__')`, `:417` defaults to `'__placeholder__'`,
    `:236` hardcodes `toCellId('cell-0-0')`; `managers/picture-manager.ts`
    and `managers/textbox-manager.ts` (lines ~141/147 and ~137/143) and
    `spreadsheet/ole-object-manager.ts:75` all carry the same placeholder
    defaults. The "latent prod data-corruption, dev throws" framing is the
    right severity call.
  - Serial IPC waterfall confirmed: `computeObjectBounds`/`resolveAnchorAsync`
    issue sequential `getCellPosition`→`getColPosition`→`getRowPosition`
    awaits (resolver lines 162/172/173, then 183/191/192 for the second
    anchor) — genuinely N×(3–6) round-trips, and the batched alternative
    (`resolveCellPositions`) already exists and is used by
    `getObjectsInViewport` (`spreadsheet-object-manager.ts:594,650`), so
    Phase 2's batch path is grounded in an existing primitive.
  - `deleteMany` is the claimed O(n) serial loop (`spreadsheet-object-mutator.ts:84-90`,
    each iteration calling `getContainerId` + delete).
  - `hitTest`/`resolvePosition` are permanent `return null` no-ops
    (`spreadsheet-object-manager.ts:361-367`).
  - `updateTextEffect` does send the whole object: it builds
    `updatedTextBox = { ...textbox, textEffects: nextTextEffect }` and passes
    the entire `TextBoxObject` to `updateObject` (`:563-564`).
  - `generateObjectId` is `Date.now()` + a module-global `objectIdCounter`
    (`:96-97`), shared across manager instances — the collision/non-determinism
    risk is real.
  - The `applyBatch` notification-scoping issue is real: pure deletes leave
    `affectedSheets.size === 0` → `notify(null)` (`floating-objects-projection.ts:211-217`),
    because `deleteObject` removes the object before its sheet can be read.
- **The `computeAllObjectBounds` reconciliation item is a sharp catch.** The
  doc-comment at `spreadsheet-object-manager.ts:231` claims "Falls back to
  empty map if the bridge method is not available," but the body
  (`:233-236`) calls the bridge unconditionally with no guard. The plan
  flags exactly this comment/code drift. That level of reading earns trust.
- **Invariants are explicit and correctly chosen:** single source of truth,
  cell↔pixel math confined to `cell-anchor-resolver.ts`, one notification per
  logical mutation, sync-reads/async-writes split, event-driven population.
  These match what the code actually enforces.
- **Verification gates are concrete and named:** the existing test files
  (`projection/__tests__/floating-objects-projection.test.ts`,
  `setup-disposal.test.ts`) exist; the new unit tests are specific and
  testable (parallel-vs-serial bounds parity, sheet-scoped delete
  notification, batched `deleteMany` call-count assertion); and it correctly
  invokes the contracts declaration-rebuild gate.

## Major gaps or risks

- **Orphaned-anchor policy (Phase 3) is the weakest contract.** The plan
  asserts "re-anchor to nearest surviving cell + retained pixel offset, or
  convert to absolute" but leaves the *choice* between those two undefined
  and never specifies which cell is "nearest" (last valid row/col? clamp
  direction?), how this interacts with two-cell anchors where only one
  endpoint dies, or whether re-anchoring mutates persisted Rust state or is
  purely a projection-side bounds repair. The plan even says the result is
  "to be documented and tested" — i.e. the spec defers the spec. Since this
  is sold as a correctness/contract improvement to a public `ws.objects.*`
  behavior, the determinism it promises needs to be pinned down *in the
  plan*, not during implementation. This is the single largest spec-quality
  gap.
- **`ComputeBridge.deleteFloatingObjects(sheetId, ids[])` is assumed, not
  confirmed.** Phase 5 reads as if this batch IPC may need to be added behind
  the Rust binding, but the plan doesn't establish whether it exists today.
  If it doesn't, Phase 5 silently grows a Rust + binding change that the
  non-goals section explicitly disclaims ("Changing Rust compute-core …").
  The fallback ("group deletes by resolved `containerId`, one IPC per sheet")
  is the safer primary path and should be stated as such, with the new batch
  IPC as a stretch.
- **Minor factual imprecision: `toCellId('n')`.** The plan repeatedly cites
  `managers/*` and `ole-object-manager.ts` using `toCellId('n')`. No such
  literal exists; those files use `__placeholder__`/`cell-0-0`. The "n"
  appears to be conflated with the `computeAllObjectBounds` doc-comment's
  "Falls back to n" shorthand. The substantive point (raw sentinel writes)
  is correct, but the specific literal is wrong — a reviewer or implementer
  grepping for `'n'` will find nothing.
- **Phase 4's "cached sorted view" is an aside, not a spec.** It's flagged as
  "Consider…" and bundled into the notification-scoping phase, which mixes a
  correctness fix with a speculative perf optimization. Either commit to it
  with an invariant (ascending `zIndex` preserved, when the cache
  invalidates) or drop it to a non-goal; leaving it as "consider" invites an
  implementer to under- or over-build.
- **Re-anchoring without data mutation (Phase 3) leans on `pendingBoundsOnly`
  reaching the projection via a `dimension:*` event,** but the plan flags
  this as something to "check against … `MutationResultHandler`" rather than
  confirming the path exists. If bounds-only updates for re-anchoring aren't
  actually emitted on row/col delete, the deterministic-fallback promise
  can't be met from inside this folder.

## Contract and verification assessment

Contract clarity is good for Phases 1, 2, 4, 5, 6 — each has a concrete
before/after and a testable assertion. The new invariants ("no object
persisted with an unresolvable sentinel anchor," "notification minimality")
are crisp and enforceable. The weak link is Phase 3's orphaned-anchor
contract, which is named but not specified (see above), and that's precisely
the one touching public semantics.

Verification gates are above average for an authoring-only plan: it names
real, existing test files; the unit tests are specific and falsifiable
(call-count assertions, serial-vs-parallel parity); it correctly threads the
`pnpm --filter @mog-sdk/contracts build` declaration-rollup gate and a kernel
typecheck. The app-eval coverage (insert → row/col delete intersecting the
anchor → object re-anchors instead of vanishing; multi-object delete + undo)
directly exercises the riskiest behavior change and wisely cites the
async-overlay-race and data-dependent-anchor memory gotchas. One gap: there's
no proposed test for the `computeAllObjectBounds` guard once the comment/code
drift is reconciled, and no regression guard around the `generateObjectId`
change (e.g. a determinism/replay test) despite the plan calling out
replay/CRDT funneling through the same bus.

## Concrete changes that would raise the rating

1. **Pin the orphaned-anchor contract in the plan (biggest lever).** State
   the single chosen behavior (e.g. "re-anchor `from` to the last surviving
   row/col in each axis, preserving pixel offset; never convert to absolute
   implicitly"), define it for the two-cell single-endpoint-deleted case,
   and state explicitly whether it mutates persisted state or is a
   projection-side bounds repair. Add the exact expected bounds to the
   app-eval assertion.
2. **Confirm or downgrade the batch-delete IPC.** Verify whether
   `ComputeBridge.deleteFloatingObjects` exists; if not, make "group by
   `containerId`, one IPC per sheet" the primary Phase 5 path and move the
   new batch IPC to an explicit cross-folder/Rust-touching stretch goal
   (reconciling with the non-goals section).
3. **Fix the `toCellId('n')` references** to cite the actual literals
   (`__placeholder__`, `cell-0-0`) and the misleading
   `computeAllObjectBounds` doc-comment separately, so grep-driven
   implementation lands on real code.
4. **Resolve the Phase 4 "cached sorted view" ambiguity** — either commit
   with an invalidation invariant and a test, or move it to non-goals.
5. **Add two verification gates:** a guard/test for `computeAllObjectBounds`
   once the comment/code drift is fixed, and a determinism/replay assertion
   for the new id source given the CRDT/undo paths share the bus.
6. **Confirm the `dimension:*` → bounds-only projection path** for
   re-anchoring actually exists before relying on it in Phase 3, or add
   wiring it up as an explicit sub-step.
