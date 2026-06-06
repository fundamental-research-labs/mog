# 013 - Kernel Domain Cells Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/cells`

Scope:
- Core cell identity lookup and creation (`cell-identity.ts`).
- Single-cell value writes and readback adapters (`cell-values.ts`, `cell-reads.ts`).
- Range traversal, clearing, relocation, current-region helpers, and data-bounds narrowing (`cell-iteration.ts`, `cell-viewport-iteration.ts`).
- Cell format/properties/style/hyperlink/domain data operations (`cell-properties.ts`, `built-in-styles.ts`, `cell-hyperlinks.ts`, `cell-data-operations.ts`).
- Public barrel exports in `index.ts` and production callers that depend on this folder's contracts.

Out of direct source scope, but required for the correct implementation path:
- `kernel/src/api/worksheet/operations/*`, `kernel/src/api/namespaces/*`, `kernel/src/api/worksheet/internal.ts`, chart/table/record callers that consume these domain functions.
- Compute bridge generated contracts and Rust compute-core storage/query/mutation endpoints where the TypeScript domain layer currently compensates for missing wire fields.
- Public contract types for `StoreCellData`, `RangeCellData`, `RegionMeta`, `CellFormat`, `CellProperties`, and `CellId`.

## Current role of this folder in Mog

This folder is the TypeScript domain boundary for spreadsheet cell semantics. It sits between public worksheet/kernel APIs and Rust compute-core, translating stable cell identity, raw/computed values, formulas, region metadata, formats, hyperlinks, and range mutations into TypeScript contract shapes.

The current implementation is split across newer and older paths:
- `cell-reads.ts` is the richer production single-cell read adapter. It handles `getCellIdAt -> getActiveCell`, materialized/range-backed `getCellData` fallback, dynamic-array spill-member anchor formula lookup, `RegionMeta`, and external formula readback.
- `cell-values.ts` still carries legacy read adapters plus value write helpers. Its reads omit region/projection/materialized-cell behavior, while its writes are often fire-and-forget.
- `index.ts` exports read functions from `cell-values.ts`, so barrel consumers can receive stale semantics even though worksheet operations, records, and charts import `cell-reads.ts` directly.
- `cell-iteration.ts` wraps `queryRange` but reimplements some logic that Rust already owns, including current-region detection and query-then-clear range clearing.
- `cell-properties.ts` is the domain facade for formats, metadata, styles, protection helpers, and custom styles, but some metadata operations are currently routed through a format-only bridge path.
- `cell-data-operations.ts` wraps remove-duplicates and text-to-columns while also implementing preview/header heuristics locally, creating drift risk from Rust production behavior.

## Improvement objectives

1. Make `cell-reads.ts` the single canonical mapper for single-cell read semantics.
2. Preserve and strengthen the stable identity model: real cells have stable `CellId`; projection/materialized/format-only cells must not be represented by fake valid-looking IDs.
3. Move region/projection/formula-bar read semantics into Rust-backed production endpoints instead of multi-call TypeScript compensation.
4. Make all domain mutations awaitable and failure-propagating so API callers do not observe success before Rust mutation completion.
5. Align range and iteration semantics with the same Rust query chokepoints used by viewport and worksheet APIs.
6. Give properties and metadata a real bridge contract instead of passing metadata through `CellFormat`.
7. Unify remove-duplicates and text-to-columns result/preview semantics with Rust production behavior.
8. Keep the domain folder as a thin contract-preserving adapter, not a second spreadsheet engine.

## Production-path contracts and invariants to preserve or strengthen

- `CellId` is stable identity. Row and column are mutable positions stored on the cell, and the grid index maps position to `CellId`.
- Structural operations move positions and grid-index entries atomically through Rust; TypeScript must not rewrite identity formulas or mutate positions directly.
- Empty cells, projection members, generated values, pivot/materialized cells, and format-only cells are distinct states. They must not be collapsed into `toCellId('')` or placeholder IDs.
- Formula cells expose the formula text separately from the computed result. Effective value for formulas uses `computed`; effective value for literals uses `rawToCellValue(raw)`.
- Region metadata is part of the public read contract. `region: null` means known plain/no-region; `region: undefined` means region evidence was not present in the wire payload.
- CSE and data-table formulas require region-aware brace/formula-bar policy. Dynamic-array spills do not use CSE brace policy.
- Rust compute-core remains the source of truth for values, formatting, projections, merges, data tables, current regions, text-to-columns, duplicate removal, hyperlink storage, and format inheritance.
- Mutation result handling remains centralized through the compute bridge/mutation handler; domain helpers should await bridge mutations but not hand-emit duplicate events.
- Styles remain copy-on-apply. Built-in styles are static constants; custom styles are persisted and managed through Rust.
- Hyperlinks remain metadata separate from cell value and must preserve value/formula/format when set or removed.
- Format inheritance must match Rust's actual cascade, including default, column, row, format range, table, conditional formatting where applicable, and cell-level overrides.
- External formula readback must remain equivalent between single-cell reads and range/query reads.

## Concrete implementation plan

### 1. Inventory and lock the public cell read contract

- Add focused tests that prove the current intended read semantics at every ingress:
  - `domain/cells/index.ts` barrel `getData`, `getRawValue`, `getValue`, and `getEffectiveValue`.
  - `api/namespaces/cells.ts`.
  - `api/worksheet/operations/cell-operations.ts`.
  - `WorksheetInternal.getCellStoreData`.
  - `Worksheet.cells.get`.
  - chart cell accessor and records/table callers where they depend on cell values.
- Cover normal literal cells, formulas with non-null computed values, formulas with `computed: null`, errors, rich text, hyperlinks, hidden formulas, dynamic-array anchors, dynamic-array members, CSE/data-table anchors and members, materialized cells with no `CellId`, region-only payloads, and format-only cells.
- Define the canonical empty-cell return contract once: public high-level worksheet APIs should continue returning `null` values for empty cells where documented, while low-level domain/namespace helpers should consistently distinguish `undefined` for no `StoreCellData` from `null` cell values.

### 2. Make `cell-reads.ts` canonical and retire duplicate read mapping

- Change `domain/cells/index.ts` so read exports come from `cell-reads.ts`, not `cell-values.ts`.
- Update `cell-values.ts` read functions to delegate to `cell-reads.ts`, or split writes into a new explicit mutation module and remove duplicated read functions after callers migrate.
- Migrate `WorksheetInternal.getCellStoreData` from `cell-values.getData` to `cell-reads.getData`.
- Centralize conversion helpers for bridge active-cell/range-cell/mirror payloads into one adapter module so error values, formulas, raw values, computed values, hyperlinks, and regions are normalized identically.
- Remove duplicate `getCellIdAt` wrappers or keep one canonical identity wrapper and re-export it.

### 3. Remove fake identity sentinels

- Replace `toCellId('')` and other placeholder identity uses with an explicit contract shape for identity-less read results.
- Preferred public shape: keep `StoreCellData.id` only for real cell identities, and add/validate a contract-level optional identity or `cellId?: CellId` if `id` cannot be optional without broader migration. If the existing contract requires `id`, introduce a clearly branded `VirtualCellId`/`ReadCellIdentity` union instead of manufacturing invalid `CellId`.
- Decide projection-member identity behavior explicitly:
  - For read-only projection members, return no own cell identity and include anchor coordinates/region metadata.
  - For operations requiring identity, resolve to the anchor only when the operation is semantically anchor-scoped.
- Centralize `getOrCreateCellId` result parsing and remove duplicate local parsing/fallbacks in form-control and floating-object anchor code.

### 4. Push region/projection/formula-bar evidence into Rust wire contracts

- Extend a Rust single-cell endpoint, preferably `compute_get_raw_cell_data` or a new canonical active-cell read, to return:
  - raw value,
  - computed value,
  - formula text,
  - formatted/display string where needed,
  - edit text,
  - format/effective format where needed,
  - formula-hidden flag,
  - hyperlink,
  - `RegionMeta | null`,
  - projection anchor formula for spill members.
- Remove the current TypeScript 3-4 roundtrip spill-member fallback once the bridge returns anchor formula and region directly.
- Add `region?: RegionMeta | null` to `RangeCellData` and populate it through the existing Rust `cell_render_at`/query serialization chokepoint.
- Ensure `queryRange`, viewport reads, range APIs, chart/table bulk reads, clipboard reads, and records can become region-aware without per-cell `getActiveCell` calls.
- Preserve merge redirection and projection/materialized-cell behavior by testing through the Rust query path, not TypeScript mocks only.

### 5. Make domain mutations awaitable and production-path aligned

- Convert domain write helpers in `cell-values.ts`, `cell-iteration.ts`, and `cell-properties.ts` from `void ctx.computeBridge...` fire-and-forget calls to `async` functions that await bridge mutations.
- Thread errors back to public API callers instead of hiding rejected promises.
- For single and batch value writes, route through `setCellsByPosition` with typed `CellInput`; avoid per-cell `getCellIdAt` before writes unless a specific identity-scoped operation requires it.
- Align clear operations:
  - value-only clear should use the Rust path that preserves format when required,
  - full clear should use `clearRangeByPosition`,
  - format-only clear should use `clearFormatForRanges`,
  - hyperlink clear should use dedicated hyperlink bridge operations.
- After writes that affect filtering, validation, or cached UI state, keep the same production invalidation/reapply behavior currently present in worksheet operations.

### 6. Replace TypeScript range semantics with Rust-owned range contracts

- Replace `cell-iteration.getCurrentRegion` with the compute bridge `getCurrentRegion` endpoint.
- Replace `getDataBoundsForRange`'s TypeScript scan/window logic with the compute bridge `getDataBoundsForRange` endpoint.
- Replace query-then-clear helpers with direct Rust range clear endpoints unless the return of cleared identities is a real public requirement. If cleared IDs are needed, add a bridge endpoint that returns them atomically with the clear.
- Update `forEach` and `forEachInRange` to use the canonical range-cell adapter from step 2 and preserve region/external-formula/error semantics.
- Optimize chart and records/table reads by batching through `queryRange` or dedicated 2D endpoints once range cells carry the same semantics as single-cell reads.

### 7. Give cell properties and metadata first-class contracts

- Stop routing metadata writes through `setFormatForRanges`, which accepts `CellFormat`, not full `CellProperties`.
- Add or use dedicated Rust bridge methods for metadata/property updates, clears, and reads:
  - set/merge cell metadata,
  - clear cell metadata while preserving format,
  - read direct cell metadata,
  - read effective properties if callers need merged format plus metadata.
- Create one TypeScript adapter from Rust metadata wire shape to public `CellMetadata`/`CellProperties`; remove ad hoc casts from `activeCell.metadata`.
- Replace `getRowFormat` and `getColFormat` stubs with real bridge methods if callers require direct row/column formats, or remove these helpers from production-facing contracts if only effective format is supported.
- Route `getEffectiveFormat` through Rust's resolved-format path and make conditional-format inclusion explicit (`getCellFormat` vs `getCellFormatWithCf`).
- Keep the existing empty `cellId` guard for format-only cells and extend tests for large formatted ranges so property queries do not call `getActiveCell` per format-only cell.

### 8. Consolidate data operations with Rust behavior

- Make `removeDuplicates` result parsing match the bridge transport's actual result shape and remove snake_case/camelCase drift.
- Either implement `caseSensitive` in Rust or remove it from the domain options until a real bridge contract exists. The right solution is to add the Rust option and test both modes.
- Move text-to-columns preview to the Rust bridge endpoint so the dialog preview and committed mutation use identical delimiter, qualifier, fixed-width, consecutive-delimiter, and custom-delimiter behavior.
- Remove local regex splitting as production logic after the Rust preview endpoint is available.
- Normalize text-to-columns and remove-duplicates entrypoints across `cell-data-operations.ts`, `worksheet/operations/cell-operations.ts`, and `worksheet/structure.ts` so all public APIs observe the same result contracts and viewport mutation patches.

### 9. Clean exports and dependency boundaries

- Keep `mog` independent of `mog-internal`.
- Keep this folder depending on public contracts and compute bridge surfaces, not app UI code.
- Update `index.ts` to export only supported production contracts. Deprecated wrappers can remain only when they delegate to the canonical path and have tests proving equivalent behavior.
- Refresh public type declarations/API snapshots if exported signatures change.

## Tests and verification gates

Initial characterization tests before implementation:
- `pnpm --filter @mog-sdk/kernel test -- kernel/src/domain/cells/__tests__/cell-reads-region.test.ts`
- `pnpm --filter @mog-sdk/kernel test -- kernel/src/domain/cells/__tests__/cell-properties-query.test.ts`
- Add tests for barrel exports and `WorksheetInternal.getCellStoreData` before changing call sites.

TypeScript/kernel gates after implementation:
- `pnpm --filter @mog-sdk/kernel test`
- `pnpm --filter @mog-sdk/kernel typecheck`
- Targeted worksheet/API tests for:
  - `kernel/src/api/worksheet/__tests__/cells-get.test.ts`
  - formula-array/formula-bar/edit-source coverage,
  - range operations clear/set tests,
  - worksheet styles and workbook cell styles,
  - hyperlink operations,
  - text-to-columns and remove-duplicates API tests,
  - chart accessor and records/table value reads after batch-read migration.

Rust/bridge gates where wire contracts or compute behavior change:
- `cargo test -p compute-core`
- Focused compute-core tests for active-cell metadata, query-range region output, dynamic array spill members, CSE arrays, data tables, current-region/data-bounds, relocation viewport patches, text-to-columns, remove-duplicates, hyperlink marker cells, and format/property inheritance.
- Regenerate bridge bindings only when bridge contracts change, then run the bridge generation gate used by the repo.

Public contract gates:
- `pnpm typecheck` after TypeScript contract/export changes.
- `pnpm check:publish-readiness:fast` when public exports, declaration surfaces, or package boundary behavior changes.
- API snapshot/declaration rollup checks if `StoreCellData`, `RangeCellData`, metadata, or namespace signatures change.

UI behavior gates for user-visible changes:
- Run the spreadsheet app and exercise real UI input paths for:
  - setting literal/formula/date/rich-text/error-like values,
  - selecting dynamic-array spill members,
  - selecting CSE/data-table members,
  - formula bar source text,
  - hidden formula behavior,
  - hyperlink create/remove,
  - apply/clear styles,
  - clear values vs clear all vs clear formats,
  - text-to-columns preview and apply,
  - remove duplicates with and without headers.

## Risks, edge cases, and non-goals

Risks:
- Public contracts may currently rely on `StoreCellData.id` being present even for identity-less reads. Fixing fake IDs may require contract changes and careful API snapshot updates.
- Moving region fields into `RangeCellData` touches Rust snapshot types, generated bridge types, TypeScript query mappers, and callers that may assume older shapes.
- Awaiting formerly fire-and-forget mutations can expose latent errors and change timing in callers that accidentally depended on optimistic completion.
- Replacing TypeScript current-region scans with Rust endpoints can surface semantic differences; those differences should be resolved in Rust, not papered over in TypeScript.
- Property metadata needs a real bridge contract. Passing arbitrary metadata through `CellFormat` should be removed, but doing so requires Rust support before metadata-write APIs can honestly work.

Edge cases to cover:
- Dynamic-array spill members with no own `CellId`.
- Pivot/generated/materialized cells with values but no cell mirror entry.
- Format-only cells with empty `cellId`.
- Region-only payloads with formula/region but no value.
- CSE/data-table member formula display and brace policy.
- Formula cells whose computed value is `null`.
- Error values across active-cell, range-cell, chart, record, and worksheet APIs.
- External formulas patched into readback.
- Merged cells and effective-position reads.
- Link-only marker cells.
- Row/column/table/conditional/cell format inheritance.
- Cross-sheet relocation and same-sheet overlapping moves.
- Full-row/full-column selections constrained to data bounds.

Non-goals:
- Do not add compatibility shims that preserve stale duplicate read behavior.
- Do not optimize test-only adapters or mocks.
- Do not introduce TypeScript-side spreadsheet semantics when Rust compute-core already owns the behavior.
- Do not change app UI composition except where needed to exercise or consume the corrected production contracts.
- Do not leak internal planning content into public `mog`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the canonical contracts are written down:

- Worker A: read-contract consolidation in `kernel/src/domain/cells`, `kernel/src/api/namespaces/cells.ts`, `kernel/src/api/worksheet/internal.ts`, and direct read callers.
- Worker B: Rust/bridge region and projection read contract updates in compute-core query/active-cell/raw-cell endpoints plus generated bridge types.
- Worker C: mutation contract cleanup for value/range clear/set/relocate helpers and worksheet invalidation behavior.
- Worker D: properties/metadata/style bridge contract implementation and tests.
- Worker E: data operations consolidation for text-to-columns preview/apply and remove-duplicates options/results.
- Worker F: high-cost bulk-read migration for charts, records, and table callers after `RangeCellData` carries the canonical fields.
- Worker G: UI and E2E verification through real spreadsheet input paths after the core/bridge changes land.

Dependencies:
- Contract decisions for identity-less cells and `RangeCellData.region` should land before bulk caller migration.
- Rust bridge additions must land before TypeScript removes projection fallback roundtrips or metadata write workarounds.
- Public type/API snapshot updates should happen after the final TypeScript export surface is stabilized.
- UI verification depends on the production bridge path and generated bindings being current.
