# Improve `mog/kernel/src/domain/tables`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/tables`

Queue item: 18, `kernel/src/domain/tables`, table domain, structured references, filtering, and sorting.

Files in scope:

- `auto-expansion.ts`
- `calculated-columns.ts`
- `core.ts`
- `custom-styles.ts`
- `hit-testing.ts`
- `operations.ts`
- `range-resolution.ts`
- `selection.ts`
- `style-normalization.ts`

Adjacent production contracts and implementation surfaces that must be considered, but not treated as owned by this folder:

- Public worksheet table API: `kernel/src/api/worksheet/tables.ts`
- Worksheet operation helpers: `kernel/src/api/worksheet/operations/table-operations.ts`, `filter-operations.ts`, `sort-operations.ts`
- Compute bridge: `kernel/src/bridges/compute/compute-bridge.gen.ts`, `compute-wire-converters.ts`
- Rust table owner: `compute/core/src/storage/engine/tables.rs`, `compute/core/src/storage/engine/services/tables/*`, `compute/core/crates/compute-table/*`
- Structured reference rewrite owner: `compute/core/src/storage/cells/structured_ref_updater/*`
- Contracts: `types/data/src/data/tables.ts`, `types/data/src/data/filter.ts`, `types/data/src/data/sorting.ts`, `types/api/src/api/worksheet/tables.ts`
- Production consumers: records, slicers, charts, app kernel API, spreadsheet grid table layout/cache/rendering, filter dropdowns, and table UI input flows.

This plan targets the production table path. It does not propose test-only harness changes, compatibility shims, or local TypeScript reimplementations of behavior that Rust compute already owns.

## Current role of this folder in Mog

`kernel/src/domain/tables` is currently a mixed table-domain facade over Rust `ComputeBridge`, a set of pure geometry/style helpers, and several legacy compatibility shims. Its comments generally say Rust compute is the source of truth, but not every function follows that contract.

Current responsibilities by file:

- `core.ts` exposes table creation, lookup, validation, update, delete, convert-to-range, and range queries. It delegates many reads and writes to `ComputeBridge`, but `createTable` fabricates and returns a local `TableConfig` rather than querying the canonical Rust table. `updateTable` only applies name/style and silently ignores most `TableConfig` fields.
- `operations.ts` wraps resize, totals, table rename, column rename, and column delete. Several async bridge calls are fire-and-forget. `renameColumn` currently does not call `renameTableColumn`; it performs a no-op `renameTable(tableName, tableName)` and relies on a TypeScript structured-ref updater that is now intentionally a no-op.
- `calculated-columns.ts` exposes calculated-column formula helpers. Mutations are also fire-and-forget, and reads rely on `columns[].calculatedFormula` coming through bridge conversion.
- `auto-expansion.ts` locally detects adjacency and expands by resizing tables. It depends on `resizeTable` and `renameColumn`, so its right-expansion path inherits their ordering and no-op rename problems.
- `custom-styles.ts` exposes workbook-level custom table style CRUD over compute. It has partial validation and a likely name-vs-id mismatch with at least one workbook API duplicate path.
- `hit-testing.ts` locally classifies table hit regions and edge/corner zones. Rust also exposes `getTableHitRegion`, and UI production paths use separate table layout and grid logic.
- `range-resolution.ts` returns `table.range` directly, while contracts still describe CRDT-safe `rangeIdentity`. Its `createTableCellIdRange` returns empty placeholder IDs, and migration helpers are no-ops.
- `selection.ts` provides pure progressive table-selection ranges. It assumes valid table geometry and should remain pure.
- `style-normalization.ts` maps public style presets, compute IDs, table-engine IDs, and event-facing style names. This is one of the more coherent helpers and is used by bridge/API code.

The actual user-facing production table API is concentrated in `kernel/src/api/worksheet/tables.ts`, which already calls Rust compute directly for many operations. It uses `createTableLifecycle`, while this domain folder still uses older `createTable`. Rust compute already has stronger lifecycle support: `create_table_lifecycle`, real `rename_table_column`, `convert_table_to_range`, table-owned filters, table option setters, and structured-reference rewrite hooks.

The improvement should therefore make this folder an honest, awaited, canonical table domain boundary over compute, or retire stale wrappers from production use. The correct direction is not to duplicate table logic in TypeScript.

## Improvement objectives

1. Make Rust compute the unambiguous source of truth for table lifecycle, structured-reference rewrites, filtering, sorting, calculated columns, custom styles, and table geometry.

2. Remove stale or misleading TypeScript behavior from `domain/tables`:
   - no locally fabricated table configs after mutations,
   - no fire-and-forget bridge mutations in functions that return `Promise`,
   - no no-op column rename path,
   - no TypeScript expectations that structured-ref updater stubs return meaningful counts,
   - no fake CellId ranges.

3. Reconcile production API and domain boundaries:
   - either route public table API mutations through a coherent `domain/tables` facade, or explicitly shrink `domain/tables` to pure helper modules plus canonical read wrappers,
   - avoid duplicate lifecycle logic split between `kernel/src/api/worksheet/tables.ts` and `kernel/src/domain/tables/*`.

4. Strengthen table/filter/sort identity contracts:
   - table ID, table name, table filter ID, and table filter `tableId` must stay consistent across create, rename, delete, convert, import, export, undo, and redo,
   - table ranges must survive structural edits through the compute-owned identity/range-binding model,
   - public APIs may accept A1/position ergonomics, but persisted and mutation-owner semantics must not pretend position ranges are CRDT-stable.

5. Make table structured references production-correct:
   - table rename, column rename, column delete, table delete, and convert-to-range must invoke Rust compute paths that update formulas atomically,
   - column rewrites must be scoped to the target table and column, not broad string replacement,
   - conversion to range must return the actual converted count from Rust rather than the TypeScript no-op stub.

6. Bring table filtering and sorting onto production compute paths:
   - table filters should remain table-owned Rust filter records keyed by stable header CellIds where applicable,
   - table sort should use compute sort/row-move semantics rather than local value rewrite paths that bypass row identity, formulas, formatting, and filter state.

7. Preserve pure helper value where appropriate:
   - `style-normalization.ts` can remain a focused conversion helper,
   - `selection.ts` can remain pure geometry if backed by canonical table configs,
   - hit-testing should either delegate to compute/renderer-owned table layout or be tested as a pure helper with documented coordinate semantics.

## Production-path contracts and invariants to preserve or strengthen

Table lifecycle invariants:

- Table names are workbook-scoped, case-insensitively unique, and validated by the same rules Rust compute enforces.
- Table creation is one user-visible lifecycle operation: header generation, header cell writes, name allocation, initial style, table binding, table-owned filter creation, and implicit structured-ref reparsing are atomic for undo/redo.
- After any table mutation returns, a read of that table through `getTable`, `getTableByName`, `getTablesInSheet`, public worksheet API, records, slicers, and UI layout must observe the compute-canonical state.
- Table deletion removes the table definition and table-owned filter but preserves cell data.
- Convert-to-range removes the table definition and table-owned filter, preserves cell data/formatting, and rewrites structured references to A1 where Rust compute can resolve them.
- Resize never changes the table start cell unless the compute contract explicitly grows through an owned operation; overlapping table ranges remain invalid.
- A table must have at least one column and a valid data-body geometry under header/total-row settings.

Identity and range invariants:

- Do not mint placeholder `CellIdRange` values in TypeScript.
- Do not persist or expose fake range identity data.
- Range reads should be derived from compute-canonical table bindings and should remain correct after row/column insert/delete, undo/redo, and collaborative structural edits.
- If public contracts still expose deprecated `range`, it should be a resolved view of canonical compute state, not a second source of truth.

Column and calculated-column invariants:

- Column IDs remain stable across rename and reorder where compute supports stability.
- Column indices are contiguous and reflect table order after add/remove/resize.
- Column rename must update the table definition and structured references atomically through Rust `rename_table_column`.
- Column deletion must remove the table column and propagate `#REF!` only for formulas that reference the deleted table column.
- Calculated formulas apply only to table data rows, never header or totals rows.
- New data rows inherit calculated-column formulas according to the table's `autoCalculatedColumns` setting.

Structured-reference invariants:

- `TableName[Column]`, `TableName[[#Headers],[Column]]`, `[#This Row]`/`[@Column]`, column ranges, escaped names, cross-sheet contexts, deleted references, and table conversion all follow the Rust parser/updater contract.
- Table rename rewrites only references to the renamed table.
- Column rename rewrites only references to the renamed column in the target table.
- Column delete/table delete produces `#REF!` where the referenced object is no longer valid.
- Convert-to-range resolves to the correct A1 ranges for all/data/header/total/this-row cases where possible.

Filter and sort invariants:

- Table creation creates or binds the table-owned `tableFilter` exactly once.
- Filter criteria are keyed by stable header CellIds or resolved through compute-owned mapping, not stale column indices.
- Table filter deletion follows table deletion/conversion.
- Slicers derive selection from table filter state and remain connected across table/column mutations when their source header CellId still exists.
- Table sort moves rows through compute sort semantics, preserving formulas, formatting, identities, hidden-row/filter state, dependencies, and emitted mutation events.
- Reapplying a table sort uses persisted or compute-owned sort state, not process-local cache if persistence is expected by the public API contract.

Style and rendering invariants:

- All 67 built-in table styles round-trip between public preset names and compute/table-engine IDs.
- Custom table style IDs/names survive create, duplicate, update, delete, event emission, rendering, and workbook defaults.
- Unknown custom style names are not silently converted into built-in presets.
- `none` style handling is normalized consistently.
- Table layout cache and renderer use the same canonical table identity and range as the API.

Error and async invariants:

- Domain `Promise` mutations await the compute mutation and propagate compute errors as `KernelError` or documented operation errors.
- No function should return success before the compute mutation has completed unless it is explicitly fire-and-forget event subscription work.
- Missing table/column behavior must be consistent: either throw for public mutation APIs or return documented no-op values for compatibility helpers, but not a mix that hides failed mutations.

## Concrete implementation plan

### 1. Define the intended table boundary before changing behavior

Write a short internal architecture note or code-level module comment for `kernel/src/domain/tables` that states the boundary:

- Rust compute owns durable table state, table filters, range identity, structured-reference rewrites, table geometry after structural edits, and row/column mutations.
- `domain/tables` owns TypeScript API adaptation, validation preflights that are cheaper or more user-friendly than compute errors, pure selection/style helpers, and consumer-facing composition.
- Public worksheet APIs should not independently reimplement table lifecycle semantics if `domain/tables` exposes the same operation.

Then choose and enforce one of two shapes:

- Preferred: make `domain/tables` the canonical TypeScript facade for table operations, and route `kernel/src/api/worksheet/tables.ts`, app API, records, slicers, and operation helpers through it where it improves consistency.
- Acceptable only if cleaner after audit: keep public worksheet API as the primary facade and shrink `domain/tables` to canonical read wrappers plus pure helper modules. In that case, delete or stop exporting stale mutation helpers rather than leaving misleading wrappers.

The plan below assumes the preferred shape: a coherent awaited TypeScript table-domain facade over compute.

### 2. Replace older lifecycle calls with compute lifecycle APIs

Update `core.ts` table creation to use `ctx.computeBridge.createTableLifecycle` rather than `createTable`.

Implementation details:

- Pass `requestedName` as `options?.name ?? null`.
- Pass style through `tableStyleIdForCompute(options?.style?.preset)` or the custom style name if the contract path supports custom styles.
- Let Rust allocate the final table name when the requested name is absent.
- After the mutation completes, query the created table back from compute. If a requested name was provided, `getTableByName` is sufficient. If Rust generated the name, locate the created table by sheet/range and most recent table change data if available; if mutation result lacks the created name, extend the bridge/result contract rather than guessing.
- Return `wireTableToTableConfig` of the canonical compute table. Do not synthesize `id`, column IDs, timestamps, style flags, or range locally.

Also align public worksheet `add` behavior and app insert behavior with this facade so the same lifecycle path is used for:

- table creation from range,
- generated headers,
- initial style,
- table-owned filter,
- implicit structured-reference reparsing,
- undo/redo grouping,
- emitted table/filter changes.

### 3. Make mutation wrappers awaited and result-aware

Replace all mutation `void ctx.computeBridge.*` calls in `domain/tables` with awaited calls:

- `operations.ts`: `resizeTable`, `setTotalRow`, `setColumnTotalFunction`, `renameTable`, `renameColumn`, `deleteTableColumn`
- `calculated-columns.ts`: `setCalculatedColumnFormula`, `clearCalculatedColumnFormula`
- `auto-expansion.ts`: any path depending on resize/rename must await the underlying operation before rereading

For each wrapper, decide whether it should:

- throw `KernelError` on invalid input or compute failure, for mutation APIs;
- return a documented boolean/count when it is a compatibility helper;
- return the compute `MutationResult` or decoded data where downstream consumers need counts or event metadata.

Do not keep a `Promise<void>` function that starts a mutation and returns before the mutation completes.

### 4. Use real compute table column APIs

Replace `operations.ts` column logic with generated bridge methods:

- `renameColumn` must call `ctx.computeBridge.renameTableColumn(existing.name, columnIndex, newName)` and await it.
- `deleteTableColumn` must call and await `removeTableColumn`.
- `setColumnTotalFunction` should use `setTableTotalsFunction(tableName, columnId, func)` where the compute bridge and contract support it, not `setCalculatedColumnFormula`.
- Add or route through `addTableColumn` where domain auto-expansion/right expansion needs to create metadata, not only resize.

After compute mutation, query the table if the caller needs updated metadata.

Structured-reference formula updates should be treated as Rust side effects of these mutations. Remove TypeScript log messages that imply the no-op stubs computed counts, or change counts to come from compute mutation data when Rust exposes them.

### 5. Wire convert-to-range through Rust compute

Replace `core.ts` `convertToRange` with `ctx.computeBridge.convertTableToRange(existing.name)` and read the converted count from the returned mutation result data.

Required behavior:

- The Rust path rewrites structured refs to A1, removes the table, removes the associated table filter, emits table changes, and returns the converted count.
- TypeScript should not call `convertStructuredRefsToA1` directly; that function is currently a documented no-op.
- Public worksheet `convertToRange` and any domain compatibility path should share this compute path.

If `MutationResult` data decoding is not already ergonomic in TypeScript, add a typed helper near compute bridge result handling rather than parsing ad hoc in table code.

### 6. Replace local name validation with compute validation

`core.ts` implements TypeScript table-name validation that may drift from Rust. Replace or back it with `ctx.computeBridge.tableValidateTableName(name, existingNames)`:

- `isValidTableName` should ask compute validation after collecting existing names, or a compute API should validate against workbook state directly.
- `generateTableName` should prefer compute's table-name generator or creation lifecycle's generated name.
- `renameTable` and `createTable` should rely on compute errors for final authority even if TypeScript performs a friendly preflight.

This avoids Excel-style name-rule drift and keeps case-insensitive uniqueness centralized.

### 7. Resolve range identity drift honestly

`types/data/src/data/tables.ts` describes `rangeIdentity`, while this folder resolves `table.range` directly and returns placeholder Cell IDs.

Implementation work:

- Audit the compute `CanonicalTable` and Yrs table binding shape to identify what range identity data is available through the bridge.
- If bridge output can include resolved identity corners, extend `wireTableToTableConfig` to populate `rangeIdentity` from canonical compute data.
- If not, keep `range` as a resolved view but remove or quarantine `createTableCellIdRange` so production code cannot mistake empty IDs for real identity data.
- Change `needsMigration`/`migrateLegacyTable` to either be deleted from production imports or explicitly documented as legacy dead APIs with tests proving they are not used by production mutation paths.
- Any production range resolution after row/column insert/delete must query compute-canonical tables, not rely on stale TypeScript-held configs.

Do not invent CellIds in TypeScript. If a required CellId is missing, extend Rust compute/bridge.

### 8. Normalize table update semantics

`core.ts` `updateTable` accepts `Partial<TableConfig>` but only handles name/style. This is dangerous because callers can pass columns, range, header flags, total flags, filter buttons, auto options, and style flags without effect.

Replace it with one of these explicit contracts:

- Split into targeted functions: `renameTable`, `setTableStyle`, `setTableBoolOption`, `setTableAutoExpand`, `setTableAutoCalculatedColumns`, `setShowFilterButtons`, `setHeaderRow`, `setTotalRow`, `resizeTable`, `renameColumn`, etc.
- Or make `updateTable` exhaustive: handle every mutable `TableConfig` field through compute APIs and throw for unsupported fields.

Preferred production approach: targeted functions plus a strict `updateTable` adapter used only by public update APIs. The adapter should:

- diff supported fields,
- call compute setters in deterministic order,
- await each mutation or use a compute batch if one exists,
- throw on unsupported updates,
- query and return canonical final table state when useful.

### 9. Unify table filtering paths

Table filter behavior spans `domain/tables/core.ts`, `domain/sorting/filters.ts`, `kernel/src/api/worksheet/tables.ts`, slicers, and Rust compute.

Implementation work:

- Ensure table creation never creates duplicate filters. The Rust lifecycle path should own table filter creation.
- Replace any table-filter creation that passes `table.range` from TypeScript with a compute-owned table filter creation path or a query that returns the table-owned filter.
- Add a `getTableFilterByTableNameOrId` helper that resolves through canonical table state and compute filters, so callers do not mix table name and table ID.
- Fix `domain/sorting/filters.ts` simplified lookup helpers that return the first filter for containment/range queries if production callers depend on them. If production does not depend on them, make that explicit and route production callers to compute-resolved filter details.
- Ensure slicer table binding uses the same table ID and header CellId mapping as compute filter state.
- Confirm table delete and convert-to-range delete table-owned filters through Rust only once.

### 10. Move table sort onto compute row-move semantics

The current `WorksheetTablesImpl.sort.apply` path should not sort locally and write values back with `setCellsByPosition`. That bypasses row identity, formula references, formatting, dependencies, filters, undo semantics, and sorting events.

Implementation work:

- Add or use a compute table-sort API that accepts table name and sort fields, resolves table data range and headers in Rust, and applies row movement through the existing compute sort machinery.
- Persist table sort state if `WorksheetTableSort.reapply` is expected to survive reload or undo/redo. If persistence is not part of the public contract, update the contract text; however, durable sort state is the right long-term production path.
- Update `WorksheetTablesImpl.sort.apply`, `sort.clear`, and `sort.reapply` to call the compute/domain sort path.
- Keep filter sort state (`FilterSortState`) aligned with table sort state where dropdown sort controls apply.
- Add tests for formulas, formatting, hidden rows, and multi-key table sort to prevent regressions from value-rewrite sorting.

### 11. Make auto-expansion a compute-owned table operation

Auto-expansion currently has split production paths and Rust stubs/TODOs. Complete the production path through compute:

- Implement Rust detection/application for adjacent writes using canonical table ranges, `autoExpand`, headers, totals, and current sheet data.
- Use compute table operations for new rows/columns, not TypeScript resize plus no-op rename.
- For row expansion, apply calculated-column formulas to the new row when `autoCalculatedColumns` is enabled.
- For column expansion, create a real table column with a canonical ID/name and update filter/header metadata.
- Ensure expansion rejects overlap with other tables and respects total-row boundaries.
- Update app grid-editing coordination to call one compute/domain operation after real UI input writes, then query canonical state.
- Remove stale duplicate app coordinator paths after the compute path is verified.

### 12. Tighten custom table style contracts

Improve `custom-styles.ts` as a real adapter to compute custom styles:

- Validate non-empty names and case-insensitive uniqueness through compute or a shared validator.
- Validate stripe sizes `1..9`.
- Validate color strings and border enum values against the compute style contract.
- Clarify whether public duplicate/update/delete APIs accept style ID or style name; make all call sites match.
- Define behavior when deleting a style that is currently applied to tables: either compute rejects, or tables fall back to workbook default style through a single documented path.
- Preserve custom style names through `style-normalization.ts`, event config, renderer table layout, and file import/export.

### 13. Consolidate hit-testing and selection geometry

Decide the production owner for table hit-testing:

- If Rust `getTableHitRegion` and app table layout cache own hit-testing, deprecate `domain/tables/hit-testing.ts` from production use and keep only tested pure helpers where needed.
- If TypeScript hit-testing remains necessary for renderer sub-cell regions, update it to take zoom/DPR-aware thresholds from the UI layout system rather than fixed magic numbers.

For `selection.ts`:

- Add guard behavior for no-data tables, header+total-only tables, and invalid ranges.
- Keep returned ranges valid and monotonic for progressive selection.
- Back all table geometry with canonical compute table configs.

### 14. Make style normalization exhaustive and tested

Keep `style-normalization.ts`, but harden it:

- Test all built-in styles: Light 1-28, Medium 1-28, Dark 1-11.
- Normalize case and zero padding consistently.
- Normalize `none` case-insensitively.
- Preserve custom style IDs/names without fallback loss.
- Ensure public event config, table-engine rendering, compute bridge conversion, workbook default style, and worksheet API all use the same helpers.

### 15. Remove misleading TypeScript structured-ref updater dependencies

`domain/formulas/structured-ref-updater.ts` is intentionally a no-op because Rust owns formula rewrites. Table code should reflect that:

- Stop importing updater stubs in `domain/tables` for mutation counts.
- If consumers need counts, extend Rust mutation results to return counts for table rename, column rename, delete, and convert-to-range.
- Keep the no-op module only as compatibility for legacy imports, or delete it if no production imports remain.
- Add tests that prove TypeScript table mutations call compute APIs that trigger Rust updater paths.

### 16. Align records, slicers, charts, and app API consumers

After the domain facade is corrected, update consumers so they do not hold stale assumptions:

- Records should resolve table and data range through canonical table reads and avoid stale row-index-as-ID assumptions where row identity is available.
- Slicers should use table filter state and header CellIds from compute, not table range snapshots.
- Chart table links should use canonical table ID/name/range and update on table resize/rename/delete.
- App kernel API should stop relying on `updateTable(... { columns })` if `updateTable` is made strict.
- Spreadsheet UI table layout cache should use stable table identity consistently and not mix table name as ID where filter state uses `tableId`.

### 17. Add direct domain tests only where they prove production contracts

There are currently no direct tests under `kernel/src/domain/tables`. Add them where the domain facade itself has logic:

- mutation wrappers await bridge calls and propagate errors,
- `createTable` returns canonical queried table, not fabricated data,
- `updateTable` throws on unsupported fields or handles all supported fields,
- `renameColumn` calls `renameTableColumn`,
- `convertToRange` calls `convertTableToRange` and returns compute count,
- selection helpers handle header/total/no-data edge cases,
- style normalization is exhaustive.

Avoid tests that simply assert stale compatibility behavior.

## Tests and verification gates

The implementation should be verified through production paths, not mocks alone.

TypeScript gates:

- `pnpm test -- kernel/src/domain/tables` or the package-local equivalent once direct domain tests are added.
- `pnpm test -- kernel/src/api/worksheet/operations/__tests__/table-operations.test.ts`
- `pnpm test -- kernel/src/api/worksheet/operations/__tests__/filter-operations.test.ts`
- `pnpm test -- kernel/src/api/worksheet/operations/__tests__/sort-operations.test.ts`
- `pnpm test -- kernel/src/api/worksheet/__tests__/protected-table-operations.test.ts`
- `pnpm test -- kernel/src/bridges/__tests__/table-bridge.test.ts`
- Existing worksheet/app API tests that mock or exercise `domain/tables/core`.
- `pnpm typecheck` for TypeScript changes unless an implementation workstream has a narrower explicit type gate.

Rust gates:

- `cargo test -p compute-table`
- `cargo test -p compute-core -- storage::engine::services::tables` or the closest targeted compute-core table lifecycle tests.
- `cargo test -p compute-core -- formula_accuracy_structured_refs` for structured-reference behavior.
- `cargo test -p compute-core -- xlsx_auto_filter_roundtrip` and `cargo test -p compute-core -- xlsx_sort_roundtrip` when filter/sort persistence changes.
- `cargo test -p compute-parser` if structured-reference parsing/normalization changes.
- `cargo clippy -p compute-table` and `cargo clippy -p compute-core` for touched Rust crates, following repo clippy guidance.

UI and end-to-end gates:

- Start the spreadsheet app dev server.
- Exercise real UI input paths for table creation, rename, resize, filter dropdown, table sort, auto-expansion by adjacent typing/paste, calculated columns, convert-to-range, selection, and table deletion.
- Use keyboard/mouse/clipboard paths for E2E tests; do not shortcut table state with direct API calls to establish conditions.
- Verify visible grid behavior: headers, filter buttons, banded styles, total rows, formulas, hidden rows, sort order, and slicer state.

Import/export and persistence gates when touched:

- XLSX import with tables, filters, totals, calculated columns, custom styles, structured references.
- XLSX export/roundtrip preserving table names, ranges, filters, styles, sort state, and formulas.
- Undo/redo for create, rename, resize, sort, filter, column rename/delete, auto-expansion, and convert-to-range.

Minimum behavior scenarios:

- Create table with and without headers; generated name and requested name.
- Reject duplicate/invalid names using compute validation.
- Rename table with formulas referencing it.
- Rename one column in one table when another table has the same column name.
- Delete a referenced column and verify `#REF!` only where appropriate.
- Convert table to range and verify structured refs become correct A1 refs.
- Resize into overlap and verify rejection.
- Add data adjacent below/right and verify auto-expansion, calculated formulas, and filters.
- Sort table with formulas, formats, hidden rows, and multiple keys.
- Apply table filter through dropdown and slicer; verify state stays synchronized.
- Delete table and verify table-owned filter and slicer connectivity update.

## Risks, edge cases, and non-goals

Risks:

- Public APIs currently bypass `domain/tables` in places. Moving them through a facade can expose latent differences in error behavior and event timing.
- `TableConfig` contracts still expose deprecated `range` while describing `rangeIdentity`. Fixing the contract honestly may require bridge and Rust changes, not just TypeScript edits.
- Table IDs and table names are sometimes conflated. Rust canonical tables currently use name-like IDs in some paths; UI and filter state may use different identifiers.
- Structured-reference rewrites are high-risk because broad column-name replacement can corrupt formulas in other tables. Any change must be AST/table-scoped and covered by Rust tests.
- Table sort migration from local value writes to compute row moves may change observable ordering, events, undo/redo entries, and formula dependencies.
- Auto-expansion has multiple existing coordinators. Leaving duplicate paths after adding compute support risks double expansion or stale table layout.
- Custom table style deletion behavior may need a product decision if styles are in use.

Edge cases to cover:

- Tables with no header row.
- Tables with total row and one data row.
- Header+total-only invalid resize attempts.
- One-column tables and deleting the last column.
- Duplicate header names and generated unique column names.
- Escaped structured-reference column names with spaces, brackets, quotes, and special characters.
- Case-only table and column renames.
- Tables on multiple sheets with same column names.
- Filters and slicers attached to columns that move or are deleted.
- Hidden/manual-hidden rows combined with filter-hidden rows during sort.
- Undo/redo after table lifecycle operations.
- Concurrent/collaborative row and column structural edits.
- Custom styles with names that resemble built-in style IDs.

Non-goals:

- Do not reimplement Rust table state, formula rewrite, filter evaluation, or sort computation in TypeScript.
- Do not optimize mock/test-only table paths.
- Do not add compatibility shims that preserve stale no-op behavior.
- Do not broaden this folder into a renderer or UI table layout system.
- Do not change private/internal planning content into public docs.
- Do not introduce dependencies from public `mog` source to `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable, but integration must be strict because table lifecycle crosses contracts, Rust compute, kernel APIs, and UI.

Recommended parallel workstreams:

1. Rust table lifecycle and structured refs:
   - Owner folders: `compute/core/src/storage/engine/tables.rs`, `compute/core/src/storage/engine/services/tables`, `compute/core/src/storage/cells/structured_ref_updater`, `compute/core/crates/compute-table`.
   - Deliverables: canonical lifecycle/count results, table-scoped structured-reference rewrites, convert-to-range count, table sort/auto-expansion primitives if missing.

2. Kernel domain facade:
   - Owner folder: `kernel/src/domain/tables`.
   - Deliverables: awaited bridge calls, canonical create/read/update/delete/convert wrappers, strict update semantics, selection/style helper tests.

3. Public worksheet API integration:
   - Owner folder: `kernel/src/api/worksheet`.
   - Deliverables: route table operations through the corrected facade or compute APIs consistently, remove local sort-by-value rewrite, align operation errors and receipts.

4. Filters/slicers/records/charts integration:
   - Owner folders: `kernel/src/domain/sorting`, `kernel/src/domain/slicers`, `kernel/src/api/namespaces/records`, `kernel/src/domain/charts`.
   - Deliverables: stable table/filter identity, table-owned filter lookup, slicer sync, record range resolution, chart link updates.

5. UI production path:
   - Owner folders: `apps/spreadsheet/src/hooks/data`, `apps/spreadsheet/src/components/grid`, `apps/spreadsheet/src/systems/grid-editing`.
   - Deliverables: table layout cache identity alignment, real UI paths for create/filter/sort/auto-expand/selection, removal of duplicate stale auto-expansion coordinator.

6. Contracts and import/export:
   - Owner folders: `types/data`, `types/api`, `contracts`, `file-io`/XLSX paths as needed.
   - Deliverables: honest range identity contract, table sort/filter/style persistence roundtrip, public API docs matching behavior.

Dependency order:

- Start with Rust compute capability and bridge result contracts where missing.
- Then update `domain/tables` wrappers to call those capabilities.
- Then route public worksheet/app consumers through the corrected domain/compute path.
- Then update UI and E2E coverage.
- Finally remove stale helpers/imports and tighten contracts/docs.

Integration rule:

- Do not let parallel workers edit the same files without an explicit owner. In particular, `kernel/src/api/worksheet/tables.ts` and `kernel/src/domain/tables/core.ts` are high-conflict files and should have single owners or staged handoffs.

Verification dependency:

- A final integrator must run both Rust and TypeScript behavior gates and exercise the spreadsheet UI through real input paths before declaring the improvement complete.
