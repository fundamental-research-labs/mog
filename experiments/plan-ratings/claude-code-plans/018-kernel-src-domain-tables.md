# Improve `mog/kernel/src/domain/tables`

## Source folder and scope

Public source folder reviewed: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/tables`

Queue item 18 covers the kernel-side **table domain**: the TypeScript layer that sits between the public worksheet/workbook API and the Rust compute-core (`ComputeBridge`) for Excel-style tables, structured references, calculated columns, table styling, hit-testing, and table-scoped selection. Filtering and sorting themselves live in the sibling folder `mog/kernel/src/domain/sorting` (`filters.ts`, `sorting.ts`); the tables folder couples to them only at delete time (`core.ts:402-405`) and via structured-ref propagation in `mog/kernel/src/domain/formulas/structured-ref-updater.ts`.

Files in scope:

- `core.ts` — table CRUD, validation, naming, range queries (header/data/total), overlap detection, delete + #REF! propagation, convert-to-range.
- `operations.ts` — resize, total row, per-column total function, rename table, rename column, delete column.
- `calculated-columns.ts` — calculated column formula get/set/clear and data-cell enumeration.
- `auto-expansion.ts` — Excel-style auto-expansion (adjacent-cell detection, row/column expansion).
- `hit-testing.ts` — click-region classification (header/data/total/edges/corner/resize) for table chrome.
- `selection.ts` — Ctrl+Space progressive selection ranges (column data, column+header, full column, row, table data, full table).
- `range-resolution.ts` — `resolveTableRange` plus legacy CellId/migration no-op stubs.
- `style-normalization.ts` — table style id/preset normalization (the most widely consumed module).
- `custom-styles.ts` — workbook-level custom table style CRUD.

Adjacent production paths that must stay in lockstep:

- `kernel/src/api/worksheet/tables.ts` — the live public table API. It **bypasses** much of this domain folder and calls `ctx.computeBridge` directly (`createTableLifecycle` at `:292`, `setTableAutoExpand` at `:528`, `setTableTotalsFunction` at `:1013`, `resizeTable` at `:668`/`:1099`, `clearAllColumnFilters`/`applyFilter` at `:585`/`:651`).
- `kernel/src/bridges/table-bridge.ts`, `bridges/slicer-table-bridge.ts`, `bridges/compute/compute-wire-converters.ts` — consume `style-normalization` and `core` read helpers; `compute-wire-converters` owns `wireTableToTableConfig` used throughout `core.ts`.
- `kernel/src/api/namespaces/records.ts`, `api/app/app-kernel-api.ts`, `api/worksheet/operations/describe-operations.ts`, `api/worksheet/slicers.ts`, `api/workbook/table-styles.ts` — consume `core`/`range-resolution`/`custom-styles` read helpers.
- `kernel/src/bridges/compute/compute-bridge.gen.ts` — the canonical `ComputeBridge` method surface (`renameTableColumn`, `setTableTotalsFunction`, `createTableLifecycle`, `setTableAutoExpand`, `setTableAutoCalculatedColumns`, `toggleHeaderRow`, `setTableBoolOption`, `addTableColumn`, `addTableDataRow` …), most of which this folder does not yet use.
- `kernel/src/domain/sorting/filters.ts` and `domain/formulas/structured-ref-updater.ts` — cross-domain collaborators on delete/rename.
- Contracts: `@mog-sdk/contracts/tables` (`TableConfig`, `TableColumn`, `TableStyle`, `TableStylePreset`, `TotalFunction`, `CreateTableOptions`) and `@mog-sdk/contracts/core` (`CellRange`, `SheetId`).

Out of scope: the Rust `compute-table` implementation, sorting/filter internals (separate queue items), UI chrome, and slicer logic beyond the table read helpers they consume.

## Current role of this folder in Mog

This folder is the kernel's TypeScript **table semantics layer** over Rust compute-core. Rust owns the authoritative table state; the folder is meant to be the single place that (a) validates and shapes table operations, (b) translates between the public `TableConfig` contract and bridge calls, and (c) computes derived geometry (data/header/total ranges, hit regions, selection ranges) that the bridge does not expose directly. Read helpers in `core.ts` and the pure functions in `style-normalization.ts`, `selection.ts`, and `hit-testing.ts` are genuinely load-bearing and consumed across the API and bridge layers.

The folder has drifted into a **partially-stale, partially-bypassed** state. Three structural problems dominate:

1. **Fire-and-forget mutations.** Every write in `operations.ts` and `calculated-columns.ts` discards the bridge promise with `void` (`operations.ts:47,69,109,134,167,206`; `calculated-columns.ts:30,47`). `ComputeBridge` mutations return `Promise<MutationResult>` and `core.mutate()` performs real async work after the transport call — it awaits `mutateCore` and then `notifyForwardMutation()` for undo tracking (`compute-core.ts:950-957`). Voiding the promise means: errors become unhandled rejections, undo ordering is not awaited, and any read-after-write (e.g. the `getTable` re-read inside `autoExpandTableColumn`, `auto-expansion.ts:97`) can race ahead of the not-yet-applied mutation. `core.ts` writes (`createTable`, `deleteTable`) correctly `await`; the operations modules do not. The behavior is inconsistent within the same domain.

2. **Workarounds instead of the dedicated bridge methods.** The bridge already exposes precise methods, but this folder uses approximations:
   - `operations.ts renameColumn` performs a **no-op** `renameTable(tableName, tableName)` "to trigger sync" and only updates formulas (`operations.ts:164-176`). The actual column-name change is **never persisted** even though `renameTableColumn(tableName, columnIndex, newColumnName)` exists (`compute-bridge.gen.ts:425`). This is a live correctness bug.
   - `operations.ts setColumnTotalFunction` hand-builds a `=SUBTOTAL(<n>,[Col])` string from a hardcoded function-number map (`operations.ts:90-109`) instead of calling `setTableTotalsFunction(tableName, columnId, func)` (`compute-bridge.gen.ts`, used correctly by the API at `api/worksheet/tables.ts:1013`).
   - `core.ts createTable` calls the older `createTable` bridge method and then **fabricates** a `TableConfig` locally with `Date.now()`/`Math.random()` ids and `Column${i+1}` names (`core.ts:236-285`), rather than `createTableLifecycle(... style)` (`compute-bridge.gen.ts:409`) which the API uses (`api/worksheet/tables.ts:292`). The returned config's `id`, column `id`s, and applied style can diverge from Rust's truth; subsequent `getTable(id)` lookups key on the fabricated id.
   - `core.ts updateTable` only forwards `name` and `style.preset` (`core.ts:359-374`), silently ignoring `hasTotalRow`, `range`, `columns`, `autoExpand`, `autoCalculatedColumns`, `showFilterButtons` — for which dedicated bridge setters exist (`setTableAutoExpand`, `setTableAutoCalculatedColumns`, `setTableBoolOption`, `toggleTotalsRow`).

3. **Duplication and dead code.** Because the API layer (`api/worksheet/tables.ts`) already talks to the bridge directly with awaited, correct calls, the folder's write paths are a **second, drifting implementation** of the same operations. No production caller imports `operations.ts`, `auto-expansion.ts`, or `calculated-columns.ts` (only tests do); production imports are limited to `style-normalization`, `core` read helpers, `range-resolution`, and `custom-styles.duplicateCustomTableStyle`. Meanwhile `range-resolution.ts` ships dead no-op stubs (`createTableCellIdRange`, `needsMigration`, `migrateLegacyTable`, `core.ts:hasMergedCellsInRange` always returns `false`). Diagnostics use raw `console.log` (`core.ts:395,436`; `operations.ts:139,171,201`).

Additional smaller issues: `getTable`/`getAllTables` are O(sheets × tables) per call and are invoked at the start of nearly every operation (`core.ts:296-312,340-349`); `isValidTableName`'s reserved-name guard is convoluted and likely both over- and under-rejects (`core.ts:158-164`); IDs use `Date.now()`/`Math.random()` (non-deterministic, collision-prone, and forbidden in some replay contexts).

## Improvement objectives

1. Make the table domain the **single, correct kernel service** for table mutations, so the API layer and bridges route through it instead of re-implementing bridge calls. Eliminate the duplicated, drifting write paths.
2. Convert all writes to **awaited, result-aware** calls that surface `MutationResult` (success/error, affected cells) and preserve undo ordering. No `void`-discarded mutations remain.
3. Replace every workaround with the dedicated bridge method (`renameTableColumn`, `setTableTotalsFunction`, `createTableLifecycle`, `setTableAutoExpand`, `setTableAutoCalculatedColumns`, `setTableBoolOption`, `toggleTotalsRow`/`toggleHeaderRow`).
4. Make `createTable` return the **bridge-authoritative** `TableConfig` (read back via `getTableByName`/`getTableAtCell` after `createTableLifecycle`) so ids, column ids, names, and applied style match Rust.
5. Make `updateTable` honor the full `Partial<TableConfig>` it advertises, or narrow its type to exactly the fields it supports — no silent no-op fields.
6. Fix the `renameColumn` persistence bug and the `autoExpandTableColumn` read-after-write race.
7. Remove dead stubs and centralize derived-geometry math (data/header/total row boundaries) that is duplicated across `core.ts`, `hit-testing.ts`, `selection.ts`, `calculated-columns.ts`, and `auto-expansion.ts`.
8. Replace `console.log` diagnostics with the kernel logger; replace `Date.now()`/`Math.random()` id generation with the kernel's id strategy where the folder still owns id creation.
9. Strengthen `isValidTableName` to match the documented Excel-style naming rules with explicit, testable predicates.
10. Keep `style-normalization`, `selection`, and `hit-testing` (the healthy modules) behavior-stable while hardening their shared geometry through the centralized helper.

## Production-path contracts and invariants to preserve or strengthen

- **Rust is the source of truth.** Every table read returns bridge-derived data via `wireTableToTableConfig`; the domain never invents authoritative state. Strengthen by removing locally-fabricated `TableConfig` in `createTable`.
- **Mutation ordering & durability.** A table mutation is not complete until its `MutationResult` resolves and undo notification has run. Any read that depends on a mutation must await it. Strengthen by awaiting all writes and threading `MutationResult`.
- **`TableConfig` shape contract** (`@mog-sdk/contracts/tables`) is preserved: `id`, `name`, `sheetId`, `range`, `hasHeaderRow`, `hasTotalRow`, `columns[]`, `style`, `autoExpand`, `autoCalculatedColumns`, `showFilterButtons`, timestamps. No field semantics change.
- **Range geometry invariants:** data rows = range minus header (1) minus total (1); `dataRows >= 1`; `colCount >= 1`; start corner is immutable across resize (`core.ts:101-123`). Centralize these so all five consumers compute them identically.
- **Naming invariant:** table names are case-insensitively unique, start with letter/underscore, are valid identifiers, and must not collide with A1/R1C1 cell references. Make these explicit predicates.
- **Structured-ref & filter coupling on lifecycle:** deleting a table deletes its filter first (`core.ts:402-405`) and can propagate `#REF!`; renames update referencing formulas; convert-to-range rewrites structured refs to A1. These ordering guarantees must be preserved exactly.
- **Hit-testing & selection geometry** (region classification, Ctrl+Space stages) must remain pixel- and stage-identical — pure refactor only.
- **Style normalization round-trips:** `light/medium/dark` family ranges (28/28/11), `none`, `TableStyle*` canonicalization, and fallbacks (`style-normalization.ts`) must be byte-stable for import/export fidelity.

## Concrete implementation plan

**Phase 0 — Establish ground truth and consolidation direction.**
Confirm (via tests + call-graph) that `api/worksheet/tables.ts` is the canonical write path and the domain write modules are test-only. Decide the consolidation target: the table domain becomes the canonical service and the API delegates to it (recommended), so there is exactly one path to the bridge. Document the chosen direction at the top of the refactor.

**Phase 1 — Awaited, result-aware mutations.**
- Change `operations.ts` (`resizeTable`, `setTotalRow`, `setColumnTotalFunction`, `renameTable`, `renameColumn`, `deleteTableColumn`) and `calculated-columns.ts` (`setCalculatedColumnFormula`, `clearCalculatedColumnFormula`) to `await` the bridge call and return/propagate `MutationResult` (or throw `KernelError` on failure).
- Audit each function's signature: where they currently return `void`/`Promise<void>`, widen to surface success/affected-cell info if a caller needs it, otherwise await internally.

**Phase 2 — Use dedicated bridge methods.**
- `renameColumn`: replace the no-op `renameTable(name,name)` with `await ctx.computeBridge.renameTableColumn(tableName, columnIndex, newName)`, then run `updateFormulasForColumnRename`. Persistence bug fixed.
- `setColumnTotalFunction`: replace the SUBTOTAL string builder with `await ctx.computeBridge.setTableTotalsFunction(tableName, columnId, func)` (resolve `columnId` from `existing.columns[columnIndex].id`, matching `api/worksheet/tables.ts:1013`). Delete the hardcoded function-number map.
- `createTable`: switch to `createTableLifecycle(sheetId, options?.name ?? null, …, style)`; after it resolves, read the created table back via `getTableByName`/`getTableAtCell` and return that bridge-authoritative `TableConfig`. Remove local id/column fabrication (`core.ts:234-270`).
- `updateTable`: route `autoExpand` → `setTableAutoExpand`, `autoCalculatedColumns` → `setTableAutoCalculatedColumns`, `hasTotalRow` → `toggleTotalsRow` (guarded by current state), `showFilterButtons`/banded flags → `setTableBoolOption`/`toggleBandedRows`/`toggleBandedCols`, in addition to existing name/style. If full coverage is out of reach in one pass, **narrow the parameter type** to the supported subset rather than accepting and dropping fields.

**Phase 3 — Fix auto-expansion race.**
With Phase 1 making `resizeTable` awaited, `autoExpandTableColumn` (`auto-expansion.ts:95-103`) can safely re-read. Prefer expressing column addition via `addTableColumn(tableName, name, position)` (`compute-bridge.gen.ts`) so the new column's name is set atomically, eliminating the resize-then-rename two-step entirely.

**Phase 4 — Centralize derived geometry.**
Extract a single helper (e.g. `tableRowBands(table, range) -> { headerRow?, dataStartRow, dataEndRow, totalRow? }`) and reuse it in `core.ts` (`getDataRange`/`getHeaderRange`/`getTotalRange`), `hit-testing.ts:103-108`, `selection.ts`, `calculated-columns.ts:82-83,111-112`, and `auto-expansion.ts:40-42`. Identical math, one definition.

**Phase 5 — Remove dead code and harden helpers.**
- Delete `createTableCellIdRange`, `needsMigration`, `migrateLegacyTable` (`range-resolution.ts:49-79`) and `hasMergedCellsInRange` (`core.ts:195-201`) after confirming no production callers; keep `resolveTableRange`.
- Replace `console.log` diagnostics with the kernel logger used elsewhere in `domain/`.
- Replace `Date.now()`/`Math.random()` id/name generation in `custom-styles.ts:200-201` and any remaining `core.ts` paths with the kernel's id utility (deterministic where required).
- Rewrite `isValidTableName` (`core.ts:149-174`) as explicit predicates: identifier rule, reserved single/double/triple-letter+digits guard expressed as an A1-cell-reference test, R1C1 guard, and case-insensitive uniqueness; add a documented allow/deny table.

**Phase 6 — Consolidate the API path.**
Point `api/worksheet/tables.ts` write operations at the now-correct domain functions, removing its direct duplicate bridge calls so there is a single implementation. Keep read helpers as-is.

## Tests and verification gates

(Plan only — this worker writes no code or tests. The implementing change must add/extend these.)

- **Unit (kernel domain):** for each mutation, assert the correct bridge method is invoked with correct args (especially `renameTableColumn`, `setTableTotalsFunction`, `createTableLifecycle`) and that the function awaits — a rejecting bridge mock must surface as a rejected promise / `KernelError`, not an unhandled rejection.
- **Regression for the `renameColumn` bug:** after rename, `getTable` reflects the new column name (currently fails — the change is never persisted).
- **Auto-expansion race:** column auto-expansion followed by an immediate read returns the expanded column without flakiness.
- **`createTable` authority:** returned `TableConfig.id`/column ids/style equal the bridge's `getTableByName` result.
- **`updateTable` coverage:** every accepted field produces a bridge call (or the type is narrowed so unsupported fields cannot be passed).
- **Naming table:** parametrized accept/reject cases for `isValidTableName` including `A1`, `XFD1`, `R1C1`, `_x`, leading-digit, duplicates (case-insensitive).
- **Geometry golden tests:** `tableRowBands` against header-only, total-only, both, neither; consumers produce identical ranges to today.
- **Style normalization round-trip** unchanged (existing tests must stay green).
- **Gates:** `pnpm --filter @mog/kernel typecheck` + lint; kernel unit suite; the `@mog-sdk/contracts` build if any contract type is touched (per repo rule, contracts must be rebuilt before consumers typecheck); relevant `dev/api-eval` filter/table scenarios and `dev/app-eval` table scenarios. Do not run these as part of authoring this plan.

## Risks, edge cases, and non-goals

- **Behavior shift from awaiting:** making mutations awaited can expose previously-swallowed errors and change perceived timing for callers that relied on fire-and-forget. Mitigate by auditing all (test-only) callers and updating the API path in the same change.
- **`createTableLifecycle` name semantics:** passing `requestedName: null` triggers Rust auto-naming; the read-back must use the actual assigned name. Verify auto-name parity with `generateTableName`.
- **`setTableTotalsFunction` column identity:** depends on stable `column.id`; confirm wire converter populates it (`compute-wire-converters.ts`).
- **Removing `updateTable` fields** could break a caller passing them today expecting a no-op; narrowing the type makes that a compile error (preferred, surfaces the gap).
- **Edge cases to preserve:** single-row tables (`dataRows >= 1`), tables with no header, total-only tables, resize that would overlap a neighbor (`findOverlappingTable`), delete with active filter + structured refs, convert-to-range formula rewrite counts.
- **Non-goals:** changing Rust compute-table behavior; redesigning the filter/sort domains (separate queue items); altering `TableConfig`/contract shapes; touching UI chrome; introducing compatibility shims or test-only patches; performance rewrites of the bridge transport.

## Parallelization notes and dependencies on other folders

- **Independent, do first:** Phase 4 (geometry helper) and Phase 5 (dead-code removal, logger, `isValidTableName`) are internal to this folder and parallelizable.
- **Coordinated with `kernel/src/api/worksheet`:** Phase 6 consolidation touches `api/worksheet/tables.ts`; sequence after Phases 1–3 land so the API delegates to corrected domain functions. This is the main cross-folder dependency.
- **Depends on `bridges/compute`:** relies on existing `ComputeBridge` methods (`renameTableColumn`, `setTableTotalsFunction`, `createTableLifecycle`, `setTableAutoExpand`, etc.) — all already present in `compute-bridge.gen.ts`; no bridge changes required. If `MutationResult` handling conventions change there, re-sync.
- **Coupled with `domain/sorting/filters` and `domain/formulas/structured-ref-updater`:** delete/rename/convert ordering must stay aligned; note that `filters.ts` exhibits the same non-awaited write pattern (`setColumnFilter`/`clearColumnFilter` are not `async`) — a candidate for the same fix in that folder's queue item, but out of scope here.
- **Consumers to retest, not edit beyond Phase 6:** `bridges/slicer-table-bridge.ts`, `api/namespaces/records.ts`, `api/app/app-kernel-api.ts`, `api/worksheet/slicers.ts`, `api/workbook/table-styles.ts` (all use read helpers / `duplicateCustomTableStyle`).
