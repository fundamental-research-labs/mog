# Plan 013 — Harden and unify the kernel Cells domain (`mog/kernel/src/domain/cells`)

## Source folder and scope

- **Folder:** `mog/kernel/src/domain/cells`
- **Files in scope:**
  - `cell-values.ts` — single/batch set, read accessors, count, properties-by-CellId
  - `cell-reads.ts` — canonical read path (region metadata, spill/projection anchors, materialized cells, external formulas)
  - `cell-iteration.ts` — clear range, relocate, iterate, current-region detection, value-conversion helpers
  - `cell-identity.ts` — CellId-at-position, get-or-create, position update stub
  - `cell-properties.ts` — format/metadata/style operations (largest module, ~1100 lines)
  - `cell-hyperlinks.ts` — hyperlink get/set/remove
  - `cell-data-operations.ts` — Remove Duplicates, Text-to-Columns + preview
  - `built-in-styles.ts` — static built-in style catalog
  - `index.ts` — barrel re-exports
  - `__tests__/` — `cell-properties-query.test.ts`, `cell-reads-region.test.ts`
- **Layer:** This is the kernel **domain** layer that sits between the public worksheet/cells API (`mog/kernel/src/api/...`) and the Rust compute core (reached through `ctx.computeBridge`). All persistence, formula parsing, evaluation, and event emission live in Rust; these modules are thin orchestrators that translate between the API edge and bridge calls.
- **Out of scope (referenced, not edited here):** the `ComputeBridge` interface (`mog/kernel/src/bridges/compute/*`), wire/contract types (`@mog-sdk/contracts/*`), and Rust compute-core. Where a defect's root cause is in Rust or in the bridge contract, this plan calls for a contract/bridge change and notes the cross-folder dependency rather than papering over it in TS.

## Current role of this folder in Mog

This folder is the canonical set of cell-level domain operations. The public `Cells`/`Worksheet` API namespaces and several services (records, charts, schema bridge, styles, validation) call into it. Writes delegate to `ctx.computeBridge` and rely on `MutationResultHandler` to emit change events; reads query the bridge and normalize the wire shape into `StoreCellData`/`CellProperties` for callers.

Importantly, consumers **deep-import** individual modules rather than going through `index.ts`: e.g. `api/namespaces/cells.ts` and `worksheet-impl.ts` import from `cell-reads`, `api/worksheet/internal.ts` imports `getData` from `cell-values`, `cell-styles.ts`/`styles.ts`/`validation.ts`/`format-utils.ts` import directly from `cell-properties`, and `cell-operations.ts` imports from several modules at once. The barrel is therefore not the real public surface, and it is incomplete (it re-exports `cell-values`, `cell-identity`, `cell-iteration`, `cell-hyperlinks`, `built-in-styles`, `cell-data-operations` — but **not** `cell-reads` or `cell-properties`).

## Improvement objectives

1. **Eliminate the duplicated, divergent read API.** `getData`, `getValue`, `getRawValue`, `getEffectiveValue`, and `getCellIdAt` exist in **both** `cell-reads.ts` and `cell-values.ts` (and `getCellIdAt` again in `cell-identity.ts`), with materially different semantics. `cell-reads.getData` handles region membership, dynamic-array spill members, materialized (pivot/array) cells with no CellId, and tracked external formulas; `cell-values.getData` does none of this. Callers silently get different answers for the same cell depending on which module they imported. Converge on one canonical read implementation.

2. **Make writes awaitable and stop swallowing failures.** `setValue`, `setValues`, `setFormulaDirect` (in `cell-values.ts`), `clearRange` (in `cell-iteration.ts`), and the `setProperties`/`setFormat*`/`setMetadata` family (in `cell-properties.ts`) launch their bridge work inside fire-and-forget `void (async () => { … })()` IIFEs (or bare `void ctx.computeBridge.…`). They return synchronously — before the mutation is even enqueued — and any rejected bridge promise is discarded with no logging. This produces races (the returned `CellAddress` is reported before the write lands), un-surfaced errors, and ordering hazards. Give these functions a `Promise` return that resolves after the bridge call settles, and route errors through the kernel error path.

3. **Make value/error normalization lossless and consistent.** `computeValueToRaw` (`cell-iteration.ts`) collapses error values (`{ type:'error', value }`) to `null`, so a cell showing `#DIV/0!` reads back as empty through the `cell-values` path, while `cell-reads`/`parseMirrorValue` preserves the error string. Unify on a single, lossless conversion used by every read path.

4. **Push heuristic, full-range scans into Rust primitives.** `getCount` materializes the entire data-bounds range via `queryRange` just to read `cells.length`; `getCurrentRegion` issues a fixed-window query with hardcoded magic offsets (`±100`, `+1000`, `+200`, defaults `10000`/`500`) and then does a BFS expansion in TS that can miss data outside the sampled window. Replace these with bridge primitives (`countCells`, `currentRegion`) so correctness no longer depends on a sampling window and large sheets don't pay an O(n) round-trip.

5. **Make Text-to-Columns preview match its commit.** `previewTextToColumns` reimplements delimiter/fixed-width splitting in TS (`splitByDelimiter`, `splitByFixedWidth`, `buildDelimiterRegex`) while `textToColumns` performs the real split in Rust. The two can diverge, and `splitByDelimiter` uses a stateful global `RegExp` with `.test(char)` whose `lastIndex` handling is fragile. Drive preview from the same Rust split logic so preview and result are guaranteed identical.

6. **Type the wire boundary.** `cell-reads.ts` and `cell-iteration.ts` hand-parse untyped JSON (`cellData as Record<string, unknown>`, `Map<string, any>`, `parseMirrorValue`, `readRegionField`/`readRegion`). Replace with the generated bridge/contract types so the compiler enforces the wire shape and the `obj.value ?? obj.raw` / `cell_id ?? cellId` snake/camel guessing disappears.

7. **Remove dead/stub code and fix the public surface.** `updateCellPosition` is an exported no-op stub. The barrel omits `cell-reads` and `cell-properties` while consumers deep-import them. Decide the intended public surface, export it consistently, and drop the stub.

## Production-path contracts and invariants to preserve or strengthen

These must hold after the change (several are currently honored only by `cell-reads`, not `cell-values`):

- **Cell identity is stable and Rust-owned.** Positions are stored in cell data; the grid index maps position→CellId. TS never mints CellIds; structural moves go through `relocateCells`/Rust. Preserve this (it justifies removing `updateCellPosition`).
- **Formula vs value effective-value rule.** For formula cells, the effective value is always `computed` (even when null); a formula evaluating to null reports `0` (parity behavior); for value cells it is `rawToCellValue(data.raw)`. This single rule must be defined once and shared.
- **Region membership on every read.** Per the D4 comments in `cell-reads.ts`, every successful read carries `region` (`null` for plain cells, populated for CSE/spill/Data-Table). The unified read path must keep this for *all* callers, including those currently using `cell-values.getData`.
- **Spill/materialized resolution.** A non-anchor spill member shows the anchor's formula but its own materialized value; pivot/array output with no CellId still reads back. The unified path must retain `resolveProjectionAnchorFormula` and the `getCellData` fallback (both currently only in `cell-reads`). Note `resolveProjectionAnchorFormula` is also imported by `cell-operations.ts` — keep it exported.
- **Clear semantics.** Clearing converts cells to marker cells (preserving CellId for formula references) and preserves format; full delete is the `clearRangeAndReturnIds` path. Today three different clear mechanisms exist (`batchClearCells` after `getCellIdAt`, Rust empty-input handling in `setCellsByPosition`, and `clearRangeByPosition`); unify the empty-input → clear policy so `setValue('')`, `setValues([…,''])`, and `setValueAsText('')` behave identically.
- **Event emission stays with `MutationResultHandler`.** Making writes awaitable must not introduce manual event emission in these modules.
- **Forced-text mode.** `setValueAsText` must continue to bypass coercion (no number/leading-zero/formula interpretation).

## Concrete implementation plan

Sequence the work so the lowest-risk consolidations land first.

### Phase 1 — Consolidate the read path (objective 1, 3, 6)
1. Treat `cell-reads.ts` as the canonical read module (it is the richer, invariant-complete one). Add to it any read accessor currently unique to `cell-values.ts` if one exists (audit shows the `cell-values` versions are strict subsets).
2. Replace `cell-values.ts`'s `getData`/`getValue`/`getRawValue`/`getEffectiveValue` with re-exports from `cell-reads.ts`, then update the two `cell-values` importers (`api/worksheet/internal.ts` `getData`, and `cell-operations.ts` `getDisplayValue`) to import the canonical functions. Remove the duplicated `getCellIdAt` from `cell-reads.ts`/`cell-values.ts` in favor of the `cell-identity.ts` one (or vice-versa — pick one home), updating imports.
3. Replace `computeValueToRaw`'s error→null collapse with a lossless conversion shared by `cell-reads` and `cell-iteration` (single helper module). Define the formula/effective-value rule once and import it everywhere.
4. Introduce a typed view of the bridge JSON: extend the generated bridge types (cross-folder dependency on `bridges/compute`) so `getCellData`/`getActiveCell` responses are typed, then delete `parseMirrorValue`/`readRegionField`/`readRegion` hand-parsing and the `Map<string,any>` in `forEachInRange`.

### Phase 2 — Awaitable, error-surfacing writes (objective 2)
5. Change `setValue`, `setValues`, `setFormulaDirect` to `async` returning `Promise<CellAddress|CellAddress[]>` that `await` the bridge call(s). Remove the `void (async()=>{})()` IIFEs. Wrap bridge rejections in `KernelError` (already imported in `cell-properties.ts`) and propagate. For `setValue`, fold the `getCellIdAt`→`setCell` race into a single ordered `await`.
6. Apply the same treatment to `clearRange` (`cell-iteration.ts`) and the `setProperties`/`setFormat*`/`setMetadata`/`setLocked*`/`set*Format` family in `cell-properties.ts`.
7. Update the API-edge callers (`worksheet-impl.ts`, `cell-operations.ts`, `cells.ts`/`records.ts` namespaces, `styles.ts`, `validation.ts`, `format-utils.ts`, `schema-bridge.ts`) to `await` the now-async functions. This is the largest blast-radius step; do it module-by-module.
8. Unify empty-input clearing: make `setValue`/`setValues`/`setValueAsText` route empty input through one clear policy (preferring the Rust-side empty handling already used by `setCellsByPosition`, eliminating the extra `getCellIdAt` round-trip in `setValue`).

### Phase 3 — Push heuristics into Rust primitives (objective 4, 5)
9. Add bridge methods `countCells(sheetId)` and `currentRegion(sheetId,row,col)` to the compute bridge + Rust (cross-folder), and reimplement `getCount` and `getCurrentRegion` as thin delegations. Delete the magic-number window/BFS once the primitive lands; keep `getDataBoundsForRange`'s full-column/row constraint logic but source the region from the primitive.
10. Drive `previewTextToColumns` from the same Rust split used by `textToColumns` (add a `previewTextToColumns` bridge call or a pure `splitTextToColumns` core fn exposed to TS). Remove `splitByDelimiter`/`splitByFixedWidth`/`buildDelimiterRegex` (and the fragile global-regex `.test`) from the domain layer.

### Phase 4 — Surface and dead-code cleanup (objective 7)
11. Remove `updateCellPosition` and update its (no-op-reliant) callers to use `relocateCells`.
12. Make `index.ts` the complete, intentional public surface: add `cell-reads` and `cell-properties` exports (de-duplicating names with `cell-values`), and migrate deep importers to the barrel where practical. If deep imports are intentional for tree-shaking, document that and remove the misleading partial barrel entries instead — pick one model and apply it.

## Tests and verification gates

- **Existing unit tests must stay green:** `__tests__/cell-reads-region.test.ts` (region/spill/materialized semantics) and `__tests__/cell-properties-query.test.ts`, plus the API-layer suites that mock these modules (`worksheet-impl*.test.ts`, `worksheet-styles.test.ts`, `worksheet-pivots.test.ts`, `cells-get.test.ts`, `schema-bridge.test.ts`).
- **New unit tests:**
  - Read parity: assert `getData`/`getValue`/`getRawValue` return identical results for plain cells, formula cells (incl. null→0), error cells (`#DIV/0!` no longer lost), spill members, and materialized/pivot cells — exercising the single canonical path.
  - Error normalization: error value round-trips through `computeValueToRaw` and `getData`.
  - Awaitable writes: a mocked bridge that rejects causes `setValue`/`setValues`/`setFormatForRanges` to reject (not silently swallow); a resolving bridge resolves after the mutation call is observed.
  - Empty-input clear parity across `setValue('')`, `setValues` with `''`, and `setValueAsText('')`.
- **Behavioral parity gates:** Text-to-Columns preview equals committed output for delimited (incl. quoted/escaped qualifiers, consecutive delimiters) and fixed-width inputs; `getCurrentRegion` matches the prior behavior on small sheets and is *correct* (no window miss) on sheets with data beyond the old sampling window.
- **Full-run determinism:** run the kernel test suite and the relevant `app-eval`/`api-eval` scenarios (cell edit, paste, fill, cut-move, remove-duplicates, text-to-columns, pivot/spill formula-bar readback) to catch the await-conversion blast radius. (Per task constraints these commands are listed as the verification plan, not executed by this planning worker.)
- **Typecheck gate:** `@mog-sdk/contracts` declaration rollup must rebuild before kernel typecheck when bridge/contract types change (see project memory on contracts declaration rollup).

## Risks, edge cases, and non-goals

- **Async conversion blast radius (highest risk).** Turning sync writes async changes many call sites. Mitigate by converting one consumer module at a time, keeping return shapes (`CellAddress[]`) identical, and leaning on the existing API-layer mocks. Watch for callers that currently rely on synchronous return ordering (e.g. fill operations using `setFormulaDirect`).
- **Behavioral parity for `null`/error/0.** The formula-null→0 rule and error preservation are observable in the formula bar and downstream formulas; parity tests must lock current visible behavior before refactor.
- **Spill/projection regressions.** Consolidating onto `cell-reads` must not drop the `resolveProjectionAnchorFormula`/`getCellData` fallbacks; `cell-operations.ts` imports the former directly.
- **Cross-folder coupling.** Objectives 4–6 require bridge + Rust changes (`countCells`, `currentRegion`, text-to-columns split, typed wire responses). Those land in `bridges/compute` and compute-core; this folder only delegates. Coordinate so the TS delegation merges after the bridge method exists.
- **Non-goals:** no change to the Rust storage/identity model itself; no new user-facing cell features; no rewrite of `built-in-styles.ts` (static data); no compatibility shims or test-only patches — divergences are fixed on the production path.

## Parallelization notes and dependencies on other folders

- **Phase 1 (read consolidation)** is mostly self-contained within this folder + light edits at `cell-values` importers; can proceed first and in parallel with Phase 4 cleanup.
- **Phase 2 (awaitable writes)** touches many `api/...` modules; coordinate with any concurrent worker editing `mog/kernel/src/api/worksheet` or `api/namespaces` to avoid churn collisions.
- **Phase 3** depends on `mog/kernel/src/bridges/compute` and Rust compute-core landing the new primitives (`countCells`, `currentRegion`, text-to-columns split). These are the only hard external dependencies; until they exist, Phase 3 is blocked and the TS heuristics remain.
- Contract/type changes (objective 6) depend on the `@mog-sdk/contracts` declaration rollup ordering noted above.
