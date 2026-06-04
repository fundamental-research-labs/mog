Rating: 9/10

# Review — Plan 013: Harden and unify the kernel Cells domain


## Summary judgment

This is an unusually high-fidelity plan. Nearly every concrete claim it makes about the
target folder is verifiable in the current source, and the diagnosis-to-remedy chain is
sound. It correctly identifies that `mog/kernel/src/domain/cells` is a thin orchestration
layer over the Rust compute core (reached via `ctx.computeBridge`), and it scopes its work
to the production path rather than papering over Rust/bridge defects with TS shims. The
sequencing is deliberate (low-risk read consolidation first, high-blast-radius async
conversion gated behind module-by-module migration, cross-folder Rust primitives last),
and it is explicit about which objectives are blocked on other folders. The few deductions
are for contract under-specification on the new bridge primitives and a couple of
unanalyzed call-site/API-surface details, not for anything structurally wrong.

I verified the plan against source before scoring. Spot checks that held:
- Divergent read API: `getData`/`getRawValue`/`getEffectiveValue`/`getValue` exist in
  **both** `cell-reads.ts` (lines 108/303/320/331) and `cell-values.ts`
  (250/337/408/426); `getCellIdAt` exists in `cell-reads.ts:354` **and** `cell-identity.ts:78`.
- Fire-and-forget writes: `void (async () => …)()` IIFEs and bare `void ctx.computeBridge.*`
  are pervasive in `cell-values.ts` (72, 82, 125, 130, 169, 221, 521), `cell-iteration.ts`
  (90, 109, 156), and the entire `setFormat*`/`setRowFormat`/`setColFormat` family in
  `cell-properties.ts`. `setValue` is confirmed `: CellAddress` (sync) returning `cellRef`
  *before* the bridge call resolves — the race the plan describes is real.
- Error→null collapse: `computeValueToRaw` (`cell-iteration.ts:46-47`) returns `null` for
  `{ type: 'error', value }`.
- Magic-number window + defaults in `getCurrentRegion` (`cell-iteration.ts:371-388`:
  `10000`/`500`, `±100`, `+1000`, `+200`) and `getCount` materializing a `queryRange`
  (`cell-values.ts:462`) both confirmed.
- `previewTextToColumns` reimplements `buildDelimiterRegex`/`splitByDelimiter`/
  `splitByFixedWidth` (`cell-data-operations.ts:358/417/464`) while `textToColumns`
  delegates to Rust (`:268`).
- `updateCellPosition` is a confirmed no-op stub (`cell-identity.ts:99-107`).
- Barrel surface: `index.ts` re-exports `cell-values`, `cell-identity`, `cell-iteration`,
  `cell-hyperlinks`, `built-in-styles`, `cell-data-operations` — but **not** `cell-reads`
  or `cell-properties`, exactly as claimed.
- Deep imports confirmed across `api/worksheet/internal.ts`, `worksheet-impl.ts`,
  `cell-styles.ts`, `styles.ts`, `validation.ts`, `format-utils.ts`, `records.ts`,
  `cells.ts`, `cell-operations.ts`, `schema-bridge.ts`; and
  `resolveProjectionAnchorFormula` is indeed imported by `cell-operations.ts:27`.

## Major strengths

- **Evidence-grounded diagnosis.** Each objective is anchored to a specific, real defect
  with named functions and observable consequences (formula bar showing `#DIV/0!` reading
  back empty; returned `CellAddress` reported before the write lands; window-miss in
  `getCurrentRegion`). This is the difference between a refactor wishlist and a plan.
- **Correct layering discipline.** It repeatedly resists fixing Rust-owned concerns in TS:
  identity stays Rust-minted, clear policy prefers Rust empty-input handling, and
  preview/commit divergence is fixed by sourcing both from the same Rust split rather than
  by patching the TS reimplementation. This matches the actual architecture.
- **Invariant ledger.** The "contracts and invariants to preserve" section is the strongest
  part: it pins the formula-null→0 parity rule, region-on-every-read, spill/materialized
  resolution, forced-text bypass, and "events stay with `MutationResultHandler`" — and
  notes several are *currently honored only by `cell-reads`*, which is precisely why
  consolidating onto it (not `cell-values`) is the safe direction.
- **Risk-aware sequencing.** Async conversion is flagged as the highest risk and deferred to
  Phase 2 with a module-by-module migration and reliance on existing API-layer mocks. Phase 3
  is correctly identified as hard-blocked on bridge/Rust primitives.
- **Honest verification framing.** It lists the kernel suite, the named `__tests__`, and the
  relevant app-eval/api-eval scenarios while explicitly stating the planning worker does not
  execute them.

## Major gaps or risks

- **Contract clarity on new bridge primitives is thin.** Objectives 4–6 introduce
  `countCells(sheetId)`, `currentRegion(sheetId,row,col)`, a preview/`splitTextToColumns`
  path, and typed `getCellData`/`getActiveCell` responses — but the plan never states their
  signatures or return shapes (e.g. does `currentRegion` return `{minRow,minCol,maxRow,maxCol}`?
  is `countCells: Promise<number>`?). Since these are the cross-folder hand-off points to
  `bridges/compute` + compute-core, leaving the contract implicit is the plan's weakest seam.
- **Public API breakage not analyzed.** `setValue` is sync today; making it
  `Promise<CellAddress>` is a return-type change that ripples through `api/namespaces/cells.ts`
  and potentially the published SDK surface. The plan covers *internal* caller churn well but
  never asks whether any of these functions are re-exported with a sync contract that external
  consumers depend on. If they are, this is a breaking change that needs a callout.
- **`updateCellPosition` caller claim is slightly off.** The plan says to "update its
  (no-op-reliant) callers to use `relocateCells`," but a search finds no production callers of
  the *domain* stub — only the barrel export and a Jest mock (the `compute-bridge.gen.ts`
  `updateCellPosition` is a different, real Rust method). The action is likely just "delete the
  stub + drop the barrel export," not "migrate callers." Minor, but the framing overstates the
  work.
- **Incomplete read-accessor inventory.** Consolidation discusses
  `getData`/`getValue`/`getRawValue`/`getEffectiveValue`/`getCellIdAt`, but `cell-values.ts`
  also exports `getValueForEditing`, `getDataById`, `getPropertiesById`, `setPropertiesById`,
  and `getDisplayValue`. The plan should state whether these stay in `cell-values` or move,
  so the final module boundary is unambiguous.
- **Empty-input clear "preferred" policy is asserted, not validated.** Phase 2 step 8 chooses
  the Rust-side empty handling used by `setCellsByPosition` as the single policy, but the
  invariants section also notes clearing must preserve CellId (marker cells) vs. full delete
  (`clearRangeAndReturnIds`). The plan should confirm the Rust empty-input path yields the
  *marker-cell* semantics for all three entry points, since `setValue('')` currently routes
  through `getCellIdAt`→`batchClearCells` and `setValueAsText('')` through
  `clearRangeByPosition` — these may not be behaviorally identical today, which is the whole
  point of the parity test.

## Contract and verification assessment

The internal TS contracts (invariants section) are excellent and testable. The verification
gates are appropriately matched to the risks: read-parity matrix (plain/formula/error/spill/
materialized), error round-trip, awaitable-write rejection propagation, empty-input clear
parity, and Text-to-Columns preview==commit including quoted/escaped/consecutive-delimiter
cases. The `getCurrentRegion` gate correctly demands a "data beyond the old sampling window"
case to prove the window-miss is actually fixed rather than merely re-homed. The contracts
declaration-rollup ordering note aligns with known project behavior.

What's missing is the *external* contract precision: the new bridge method signatures and
the generated wire types (objective 6) are the integration boundary, and they're described
qualitatively ("extend the generated bridge types") without the shape the TS side will type
against. Because Phase 3 merge ordering depends on "the bridge method exists first," an
explicit signature stub in the plan would de-risk the coordination with the worker owning
`bridges/compute`.

## Concrete changes that would raise the rating

1. **Specify the new bridge contracts.** Give exact signatures/return shapes for
   `countCells`, `currentRegion`, the preview/`splitTextToColumns` call, and the typed
   `getCellData`/`getActiveCell` responses (field names, snake vs camel resolution, error
   encoding). This closes the only real coordination gap.
2. **Add a public-API-surface audit step.** Before Phase 2, confirm which of the soon-to-be-
   async functions are exposed (directly or transitively) on the published SDK and state
   whether the sync→Promise change is internal-only or a breaking change requiring a version/
   migration note.
3. **Correct the `updateCellPosition` action** to "delete stub + remove barrel export +
   update the Jest mock," and verify (as I did) that there are no production callers — rather
   than implying caller migration to `relocateCells`.
4. **Complete the module-boundary decision** for `getValueForEditing`, `getDataById`,
   `getPropertiesById`, `setPropertiesById`, `getDisplayValue` so the post-refactor home of
   every exported symbol is explicit.
5. **Pre-write a "current behavior" snapshot test** for the three empty-input clear paths and
   the formula-null→0 / error-preservation cases, landed *before* the refactor, so parity is
   locked against today's observable behavior rather than against the plan's assumptions.
6. **State the rollback/staging story for Phase 2** (e.g. can read consolidation and async
   writes ship independently behind separate merges?) given it's the highest-blast-radius
   change touching ~10 API modules.
