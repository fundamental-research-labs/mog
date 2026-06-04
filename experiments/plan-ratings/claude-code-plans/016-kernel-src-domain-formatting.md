# Plan 016 — Harden `mog/kernel/src/domain/formatting`

## Source folder and scope

- **Folder:** `mog/kernel/src/domain/formatting`
- **Files in scope:**
  - `format-registry.ts` (~430 lines) — runtime home of `FORMAT_PROPERTY_REGISTRY` plus query/summary helpers.
  - `merges.ts` (~440 lines) — domain-level merge operations that delegate to the Rust compute core via `ctx.computeBridge`.
- **Out of scope (touched only as downstream consumers, not rewritten here):** `mog/kernel/src/api/worksheet/operations/merge-operations.ts`, `mog/kernel/src/api/worksheet/structure.ts`, `mog/kernel/src/domain/sorting/sorting.ts`, `mog/contracts/src/formatting/*`, `mog/types/formatting/*`, and the generated bridge files under `mog/kernel/src/bridges/compute/`.

This is a public Mog source folder. All planning/rationale text lives in `mog-internal`.

## Current role of this folder in Mog

The `domain/formatting` folder is supposed to be the kernel's shared, framework-agnostic surface for formatting semantics consumed by UI, compute, and file IO. Today it holds exactly two unrelated concerns:

1. **`format-registry.ts`** — the single runtime source of truth for the catalog of Excel-compatible format properties (font, alignment, fill, borders, number format, protection), each tagged with a four-axis implementation status (`contract`/`import`/`export`/`render`). Types were extracted to `@mog/types-formatting`; this file owns the data constant and the query helpers (`getMissing*Properties`, `getPropertiesByCategory`, `getImplementationSummary`, `printRegistrySummary`). The contracts/types packages now re-export *to* this file, making it authoritative.

2. **`merges.ts`** — a pure-function module (each function takes `DocumentContext` first) that forwards merge reads/writes to `ctx.computeBridge`. The Rust compute core owns validation, overlap checks, value clearing, storage, and event emission. The TS layer is a thin shim.

### Problems found by inspection

**A. The status registry is hand-maintained and unverified.**
- The `status` booleans (`contract`/`import`/`export`/`render`) are typed in by hand. Nothing links them to the actual import (`format-mapper.ts`), export (`exporter.ts`), or render (`cell-layer.ts`) code paths, so they drift silently. The header comment claims the registry is used to "drive automated testing," but no test consumes `FORMAT_PROPERTY_REGISTRY` — the only repo callers of the value (vs. the type) are the re-export shims in `contracts`/`types`. The query helpers (`getMissingContractProperties`, etc.) have no production callers.
- `patternBackgroundColor` is marked `contract: false` while `import/export/render: true`, i.e. a documented capability gap encoded as data with no enforcement that it ever gets closed.
- The file is saturated with literal "Excel" references in comments/descriptions, which conflicts with the established repo convention to avoid naming "Excel" in source ([[no-excel-in-code]]).

**B. `merges.ts` is a partially-bypassed delegation layer with dead surface and a perf footgun.**
- **Spatial queries exist but are unused.** The compute bridge exposes `getMergesInViewportSpatial(sheetId, startRow, startCol, endRow, endCol)` and `getMergeAtCellSpatial(sheetId, row, col)` (spatial-index backed). Yet `merges.ts` implements `getInRange`, `getInViewport`, and `clearAll` by calling `getAllMergesInSheet` and filtering **client-side** with a local `rangesOverlap`. For viewport rendering this is O(all merges in sheet) per query — exactly what the spatial index was built to avoid. `getForCell`/`isOrigin` use the non-spatial `getMergeAtCellQuery` rather than `getMergeAtCellSpatial`.
- **The module is bypassed.** Real consumers fetch merges directly off the bridge instead of through this module: `api/worksheet/structure.ts` and `domain/sorting/sorting.ts` both call `ctx.computeBridge.getAllMergesInSheet(...)` directly. The module's `getInRange`/`getInViewport` have **no repo callers at all**. So the "shared semantics" module is neither the single entry point nor on the hot path.
- **`MutationResult` is discarded.** `computeBridge.mergeRange`/`unmergeRange` return a `MutationResult` (carrying `mergeChanges`, `recalc`, and structure deltas). `merges.ts` throws it away and returns `void`. Downstream `merge-operations.mergeCells` therefore builds an optimistic success result without knowing whether Rust actually merged, rejected an overlap, or clobbered data.
- **Dead/misleading API-compat stubs.** `checkMergeDataLoss` always returns `{hasDataLoss:false, cellsWithData:0}`, `validateAndClean` always returns `0`, and `subscribe` returns a no-op unsubscribe. None are called anywhere in the repo. They advertise behavior they no longer provide and are an active correctness trap (`checkMergeDataLoss` says "no data loss" unconditionally).
- **Unbatched fan-out.** `mergeAcross` and `clearAll` issue one sequential `await` per row / per merge. Each is an independent bridge round-trip; for wide selections or import resets this is N serial mutations.
- **`mergeAndCenter` does not center.** The function name promises center alignment; the body only unmerges + merges and a comment defers centering to a separate `setFormat` call. The name overpromises relative to behavior.

## Improvement objectives

1. Make `merges.ts` the *single, correct* kernel entry point for merge access, backed by the spatial Rust queries on read paths, and migrate the two direct-bridge consumers onto it.
2. Stop discarding `MutationResult` on write paths so merge success/failure/data-loss is observable end to end.
3. Remove the dead, misleading API-compat stubs and the unused query surface, or wire them to real behavior — no silent no-ops.
4. Batch the fan-out operations (`mergeAcross`, `clearAll`) where a batch bridge call is available, and otherwise make the sequential cost explicit.
5. Turn `format-registry.ts` from hand-maintained documentation into an enforced contract: either drive a real status check/test from it or relocate it so its authority matches its (lack of) runtime use; scrub "Excel" naming per repo convention.

## Production-path contracts and invariants to preserve or strengthen

- **Pure-function shape preserved.** Every `merges.ts` export keeps `DocumentContext` as its first parameter and stays side-effect-free beyond the bridge call. No event emission moves into this layer — `MutationResultHandler` remains the emitter.
- **Rust remains the source of truth** for validation, overlap rejection, value clearing, and merge storage. This plan does not move semantics into TS; it stops the TS layer from *re-deriving* or *hiding* what Rust already computes.
- **Type fidelity.** `getMergesInViewportSpatial` returns `MergeRegion[]`, whereas the current `getInViewport` returns `ResolvedMergedRegion[]`. The return type contract of the public functions must be preserved (or the consumers updated in lockstep) — see implementation step 2.
- **Registry authority.** `format-registry.ts` must remain the runtime source that `contracts`/`types` re-export from; any relocation must keep those re-export targets valid.
- **No behavior regression for current callers** of `mergeCells`, `mergeAndCenter`, `unmergeCells`, `getAll`, `getForCell` in `merge-operations.ts`.

## Concrete implementation plan

### Step 1 — Route reads through the spatial index
- Reimplement `getInViewport` to call `ctx.computeBridge.getMergesInViewportSpatial(sheetId, startRow, startCol, endRow, endCol)` instead of fetching all merges + `rangesOverlap`.
- Reconcile the return type: confirm whether `MergeRegion` (spatial) carries the same resolved fields consumers need as `ResolvedMergedRegion`. If equivalent, normalize one to the other in a small mapper inside `merges.ts`; if not, surface the spatial type on the public signature and update the (currently zero) consumers. Document the chosen mapping.
- Have `getInRange` delegate to the same spatial query (range == viewport rectangle) rather than scanning all merges.
- Point `getForCell`/`isOrigin` at `getMergeAtCellSpatial` unless there is a deliberate reason `getMergeAtCellQuery` is preferred; if the two differ semantically, document why and keep the correct one.
- Keep `getAll` (full-sheet) as the one place that legitimately calls `getAllMergesInSheet`.
- Delete the now-unused local `rangesOverlap` helper once no read path needs it.

### Step 2 — Consolidate direct-bridge consumers onto the module
- Update `api/worksheet/structure.ts` and `domain/sorting/sorting.ts` to call `Merges.getAll(ctx, sheetId)` (or the appropriate ranged getter) instead of `ctx.computeBridge.getAllMergesInSheet(...)` directly, so the domain module is the single chokepoint. These edits are minimal call-site swaps; the module API already matches.

### Step 3 — Propagate `MutationResult` on writes
- Change `mergeRange`, `unmergeRange`, `mergeAndCenter`, and `mergeAcross` to return the `MutationResult` (or an aggregate for the looped variants) instead of `void`.
- Update `merge-operations.ts` to build its `OperationResult<MergedRegion>` from the real `mergeChanges` in the returned `MutationResult` rather than optimistically. This makes overlap rejection / data-loss visible to API callers — closing the gap that `checkMergeDataLoss` pretended to cover.

### Step 4 — Remove dead/misleading surface
- Delete `checkMergeDataLoss`, `validateAndClean`, and `subscribe` (verified no repo callers). The data-loss concern is now answered by `MutationResult` (Step 3); merge-change subscription is the event bus via `MutationResultHandler`.
- Remove `getInRange`/`getInViewport` only if Step 1+2 leave them with no consumers; otherwise keep them in their spatial-backed form. Prefer keeping a coherent, spatial-backed ranged getter over deleting useful API.

### Step 5 — Batch fan-out where supported
- For `clearAll`, if a single bridge "clear all merges in sheet" / batch unmerge exists or can be requested, use it; otherwise keep the loop but `log`/document that it is N sequential round-trips and gate it behind the import-reset use case only.
- For `mergeAcross`, evaluate whether a single multi-region merge call exists; if not, keep the per-row loop but return an aggregated `MutationResult`. Do **not** add a TS-side batching shim that re-implements Rust semantics.

### Step 6 — Rename or rescope `mergeAndCenter`
- Either (a) make `mergeAndCenter` actually apply center alignment (call into the format mutation path so the name matches behavior), or (b) if centering must stay a caller responsibility, rename to reflect "merge (caller centers)" and update `merge-operations.ts`. Pick (a) if a format mutation is reachable from `DocumentContext` without violating the pure-delegation invariant; document the decision.

### Step 7 — Make `format-registry.ts` enforced, not decorative
- Decide ownership: since the only value-consumers are re-export shims and there are no production callers of the query helpers, either
  - **(preferred)** add a unit/snapshot test (in the appropriate kernel test location, not in this folder) that consumes `FORMAT_PROPERTY_REGISTRY` to assert invariants — e.g. every `render:true` property has a corresponding case in the render path, no property regresses to `contract:false` without an explicit allowlist — turning the registry into a guardrail; or
  - relocate the constant to where it is actually used and leave a typed re-export, if no enforcement is wanted.
- Close the `patternBackgroundColor` `contract:false` gap on the production path (contract definition) so the registry has no standing falsehoods, or annotate it as an explicit, tracked non-goal.
- Scrub "Excel"-named comments/descriptions to the repo-preferred phrasing ([[no-excel-in-code]]) while keeping the property semantics intact.

## Tests and verification gates

- **Read-path equivalence:** for representative sheets (sparse merges, dense merges, merges straddling viewport edges, empty sheet) assert `getInViewport`/`getInRange` via spatial query return the same set as the old all-merges+filter path. This is the safety net for Step 1.
- **Write-path observability:** assert `mergeCells` surfaces failure when Rust rejects an overlapping merge, and that `MutationResult.mergeChanges` flows into the API `OperationResult`.
- **Consumer migration:** existing tests for `structure.ts` and `sorting.ts` (which already mock `getAllMergesInSheet`) must be updated to mock through the module path; confirm no behavior change.
- **Dead-stub removal:** grep-verify zero remaining callers of `checkMergeDataLoss`/`validateAndClean`/`subscribe` before deletion (already confirmed during planning; re-confirm at edit time).
- **Registry guardrail:** the new registry-driven test (Step 7) passes and fails loudly if a property's status drifts from reality.
- **Type fidelity:** typecheck across kernel + the contracts/types re-export chain; if registry types move, rebuild `@mog-sdk/contracts` so consumers typecheck ([[mog-contracts-declaration-rollup]]).
- **Standard gates:** kernel lint, typecheck, and the merge-related app-eval/api-eval scenarios. (Per task constraints, this plan does not itself run build/test commands.)

## Risks, edge cases, and non-goals

- **Spatial vs. non-spatial return-type mismatch** (`MergeRegion` vs `ResolvedMergedRegion`) is the highest-risk item; resolve it explicitly (Step 1) before deleting the client-side filter, with the equivalence test as the gate.
- **Hidden callers via re-export.** `merges.ts` types are re-exported; confirm no external package depends on the soon-to-be-removed function names before deleting them.
- **`getMergeAtCellQuery` vs `getMergeAtCellSpatial` semantics** may differ (e.g. origin resolution). Verify against Rust behavior before switching `getForCell`/`isOrigin`.
- **Event-emission invariant.** Do not let `MutationResult` propagation tempt event emission into this layer; emission stays in `MutationResultHandler`.
- **Non-goals:** moving merge validation/semantics into TS; adding a TS-side caching layer for merges; reformatting unrelated files; broad renames across the formatting type packages; introducing compatibility shims or test-only patches in place of the real fixes above.

## Parallelization notes and dependencies on other folders

- **Independent / parallelizable:** the `format-registry.ts` work (Step 7) is orthogonal to the `merges.ts` work and can proceed concurrently by a different worker.
- **Cross-folder edits required (coordinate):**
  - `mog/kernel/src/api/worksheet/operations/merge-operations.ts` and `api/worksheet/structure.ts` — for `MutationResult` propagation and consumer consolidation.
  - `mog/kernel/src/domain/sorting/sorting.ts` — consumer consolidation.
  - `mog/contracts/src/formatting/*` and `mog/types/formatting/*` — only if the registry relocates; requires a contracts declaration rebuild ([[mog-contracts-declaration-rollup]]).
- **Downstream-only (no edits expected here):** the generated bridge files (`compute-bridge.gen.ts`, `manifest.gen.ts`, `compute-types.gen.ts`) are the contract this folder consumes; the spatial queries already exist, so no Rust/codegen change is required for Steps 1–4.
- **Sequencing:** Step 1 (spatial reads) before Step 2 (consumer migration) before Step 4 (deletions). Step 3 can land independently. Step 7 anytime.
