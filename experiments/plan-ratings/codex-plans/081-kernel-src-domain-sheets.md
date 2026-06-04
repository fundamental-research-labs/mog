# 081 - Kernel Domain Sheets Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/sheets`

Queue item: 81, `kernel/src/domain/sheets`, sheet lifecycle, structure, visibility, and metadata rules.

Files in direct scope:

- `dimensions.ts`
- `sheet-meta-defaults.ts`
- `sheet-meta.ts`
- `structures.ts`
- `__tests__/structures.test.ts`

Adjacent production contracts and implementation surfaces that must be considered, but not treated as owned by this folder:

- Workbook sheet lifecycle API: `kernel/src/api/workbook/sheets.ts`
- Current workbook lifecycle helpers: `kernel/src/api/workbook/operations/sheet-crud-operations.ts`
- Worksheet structure/layout/view APIs: `kernel/src/api/worksheet/structure.ts`, `kernel/src/api/worksheet/layout.ts`, `kernel/src/api/worksheet/view.ts`, `kernel/src/api/worksheet/operations/sheet-management-operations.ts`
- Low-level namespace facade: `kernel/src/api/namespaces/sheets.ts`
- Kernel state mirror: `kernel/src/document/state-mirror.ts`, `kernel/src/document/__tests__/mirror-coverage.test.ts`, `kernel/src/document/__tests__/state-mirror.test.ts`
- Compute bridge: `kernel/src/bridges/compute/compute-bridge.ts`, `compute-bridge.gen.ts`, `types.ts`, generated `SheetMeta` and `StructureChange` types
- Rust sheet owners: `compute/core/src/storage/engine/services/mutation_handlers/sheet_mutations.rs`, `compute/core/src/storage/engine/services/delegations/sheet_lifecycle.rs`, `compute/core/src/storage/sheet/{properties,visibility,order,view,dimensions,structural}`
- Public contracts: `types/api/src/store/store-types.ts`, `types/api/src/store/sheet-meta-schema.ts`, `types/api/src/api/state-mirror.ts`, `domain-types/src/domain/sheet.rs`
- Production consumers: spreadsheet sheet tabs, workbook facade, app actions, file import/export, print/PDF paths, renderer frozen panes and dimension reads, table row insertion/removal, paste/filter row hiding, undo/redo, collaboration replay, and startup hydration.

This plan targets production sheet behavior only. It does not propose test-only adapters, compatibility shims that preserve duplicate semantics, or TypeScript reimplementations of behavior Rust compute already owns.

## Current role of this folder in Mog

`kernel/src/domain/sheets` is currently a partial TypeScript sheet-domain facade, not the complete sheet lifecycle boundary implied by the queue description.

Current responsibilities by file:

- `sheet-meta.ts` provides async metadata reads by composing multiple `computeBridge` queries (`getSheetName`, frozen panes, tab color, hidden flag, default dimensions). It also exposes sheet order/name helpers, used range helpers over `getDataBounds`, frozen pane writes, page break diffing, and per-sheet print settings stored under the workbook setting key `sheetPrintSettings`.
- `sheet-meta-defaults.ts` owns the runtime `SHEET_META_SCHEMA` and default/copy/required-field utilities. The public `SheetMetaField` union lives in `types/api/src/store/sheet-meta-schema.ts`; this file is the runtime schema counterpart inside kernel.
- `structures.ts` is a thin awaited wrapper over `computeBridge.structureChange` for insert/delete rows and columns. It correctly delegates structural semantics to Rust and returns the bridge `MutationResult`.
- `dimensions.ts` wraps row/column dimension and visibility operations. Its sync getters read `BinaryViewportBuffer` for rendering-path O(1) access, fall back to a local process cache for headless read-back, then return defaults. Its async hidden-row/column enumerators scan `getDataBounds` and call per-row/per-column bridge queries.
- `__tests__/structures.test.ts` only verifies that the four structure helpers await `structureChange`, return the mutation result, and no-op on non-positive counts.

The actual sheet lifecycle API is outside this folder:

- `kernel/src/api/workbook/sheets.ts` enforces write gates, workbook protection, last-visible-sheet rules, active sheet updates, worksheet cache refresh, event emission for activation, and public receipts.
- `kernel/src/api/workbook/operations/sheet-crud-operations.ts` calls `createSheet`, `removeSheet`, `renameSheet`, `copySheet`, `moveSheet`, and `setSheetHidden` on `computeBridge`, but converts several compute failures to `false` or `null`.
- Rust compute is the durable source of truth. Create/copy build hydration-shaped `MutationResult`s; delete removes compute/mirror/grid/layout state and emits reconcile hints; rename updates persisted formula text and compute formula state; structural changes rebuild grid, mirror, layout, formulas, named ranges, ranges, merges, and metadata.

There are also duplicate or divergent access paths:

- Public worksheet structure and layout APIs often call `computeBridge` directly instead of routing through `domain/sheets`.
- `api/worksheet/operations/sheet-management-operations.ts` has its own frozen pane and print/page helpers that overlap `sheet-meta.ts`.
- `dimensions.ts` fire-and-forget write helpers do not validate inputs or propagate bridge failures, while high-level worksheet layout methods await bridge calls and validate arguments.
- `getHiddenRows`/`getHiddenColumns` in `dimensions.ts` scan the used data bounds, while public layout APIs use bulk `computeBridge.getHiddenRows`/`getHiddenColumns`.
- `getFirstId` assumes `getAllSheetIds()[0]` exists without expressing the empty-workbook error contract, even though Rust and workbook APIs treat at least one sheet as an invariant.
- `setUsedRange` is a no-op compatibility stub because Rust owns data bounds. Keeping it public without a stronger contract makes import/recompute callers easy to mislead.

The strongest existing guard is mirror coverage: `kernel/src/document/__tests__/mirror-coverage.test.ts` classifies every `SHEET_META_SCHEMA` field against mirror/event coverage. That should be extended, not bypassed.

## Improvement objectives

1. Make `kernel/src/domain/sheets` the canonical TypeScript sheet domain boundary for sheet lifecycle, metadata, dimensions, visibility, view settings, and structural row/column mutations.

2. Move or route workbook lifecycle helpers through a new domain-owned lifecycle module so create, remove, rename, copy, move, hide, show, and visibility-state operations have one TypeScript facade over Rust compute.

3. Preserve Rust compute as the durable source of truth for sheet order, names, visibility, metadata, dimensions, page breaks, print settings, used ranges, structural edits, formulas, indexes, undo/redo, collaboration, and hydration.

4. Make all domain mutations await bridge completion and propagate failures through documented result or error contracts. Domain helpers should not return success before Rust mutation completion.

5. Separate three related but distinct metadata surfaces:
   - public `SheetMeta` bridge/store view: id, name, default dimensions, frozen panes, tab color, hidden, optional used range;
   - runtime `SHEET_META_SCHEMA`: wider persistence/settings/default/copy schema;
   - mirror `MirrorSheetMeta`: sync UI read view for name, order, hidden, tab color, and frozen panes.

6. Replace local hidden-row/column enumeration and headless dimension cache drift with Rust-backed bulk read contracts and explicit cache invalidation rules.

7. Strengthen sheet visibility semantics: visible, hidden, and veryHidden must be a governed contract, and the "at least one visible sheet" invariant must be enforced consistently.

8. Unify frozen panes, split view, view options, scroll position, page breaks, print area, print titles, and print settings around Rust-owned mutation/result shapes and mirror hydration.

9. Keep `structures.ts` a thin structure-change adapter, but expand its contract tests to cover bounds, return shape, metadata shifting, and production callers rather than only awaiting behavior.

10. Add high-signal verification gates that exercise public workbook/worksheet APIs, Rust compute-core, generated bridge contracts, state mirror hydration, and real spreadsheet UI flows.

## Production-path contracts and invariants to preserve or strengthen

Sheet lifecycle invariants:

- A workbook always has at least one sheet after initialization and after every user-visible mutation.
- A workbook must always have at least one visible sheet. Hiding or deleting the last visible sheet must either fail or atomically reveal/select another sheet according to the documented public behavior.
- Sheet order is workbook-scoped, zero-based, unique, and Rust-owned. Moves and reorders must not create duplicate IDs, drop sheets, or silently accept invalid IDs.
- Sheet names are workbook-scoped and case-insensitively unique. Empty names supplied by callers are resolved by Rust's unique `SheetN` generator. Rename must update persisted formula text and compute formula state atomically.
- Sheet IDs are stable. Copy creates a new sheet ID; rename/move/hide/show preserve the existing ID.
- Create/copy/delete lifecycle mutations must emit `MutationResult` data sufficient for the state mirror and runtime provider to reconcile active sheet state without extra ad hoc UI state patches.
- Public workbook receipts (`sheetRemove`, `sheetMove`, `sheetRename`, `sheetHide`, `sheetShow`) must be derived from post-mutation canonical state.

Visibility invariants:

- Boolean `hidden` remains the public narrow metadata facet.
- Tri-state visibility (`visible`, `hidden`, `veryHidden`) remains available where workbook protection, XLSX, or UI logic require it.
- `veryHidden` counts as non-visible for last-visible-sheet rules and visible-sheet counts.
- Showing a hidden or veryHidden sheet must clear the hidden state consistently and emit the correct runtime focus/reconcile hint.
- Visibility reads must return canonical Rust state, not mirror or cache guesses, when the API is async.

Metadata and defaults invariants:

- `types/api/src/store/store-types.ts` `SheetMeta`, generated bridge `SheetMeta`, and `domain-types/src/domain/sheet.rs` `SheetMeta` must stay wire-compatible.
- `SHEET_META_SCHEMA` remains the kernel runtime schema for sheet metadata/settings defaults, copy behavior, and required fields. Contract type unions must not drift from runtime schema keys.
- Default row height and default column width must match Rust/domain defaults and platform layout defaults. Pixel-vs-character width conversion must be explicit at the boundary.
- `getMeta` must either return the complete public `SheetMeta` view, including `usedRange` when contractually expected, or document that used range is intentionally read through `getUsedRange`.
- Public metadata reads for nonexistent sheets must be consistent: either `undefined`/`null` for missing sheet metadata or default singleton values for settings-style getters, matching the existing Rust/mirror distinction.
- Returned default objects and arrays must not expose mutable singleton state to callers.

Dimension and visibility invariants:

- Async layout APIs are Rust-owned and must await bridge results.
- Sync rendering-path row/column getters must remain O(1) and must prefer current viewport buffer data when available.
- Headless sync fallback must not outlive a sheet deletion, sheet copy, undo/redo, or remote hydration in a way that returns stale dimensions for a reused sheet ID.
- Hidden rows/columns read as zero height/width in rendering-path getters.
- Manual row hiding and filter-driven row hiding must compose according to Rust's dimension model.
- Bulk hidden-row/column APIs must return all hidden rows/columns, including hidden dimensions outside the current data bounds.

Structural invariants:

- Structural row/column operations are Rust-owned and pass through `StructureChange`.
- TypeScript must not rewrite formulas or directly mutate cell positions. Stable cell identity, row/col identity, grid index, layout index, merge cleanup, range metadata shift, formula writeback, and named range regeneration remain Rust responsibilities.
- Deleting rows/columns must validate bounds against Rust grid dimensions and produce deterministic errors for invalid deletes.
- Inserted rows should inherit explicit row height where Rust defines that behavior.
- Structure mutation completion must mean all downstream `MutationResult` handling and invalidation available through the bridge has completed for the caller's awaited operation.

View, print, and used range invariants:

- Frozen panes are sheet-scoped, non-negative, and represented consistently across `SheetMeta`, mirror `frozen`, generated bridge `FrozenPanes`, and renderer coordinates.
- Split view and frozen panes remain mutually exclusive if that is the sheet view contract; enabling one must clear or reject the other through a single owner.
- Page breaks, print area, print titles, and print settings are Rust/mirror-backed per-sheet state. TypeScript should not maintain a workbook-settings blob as a shadow source if Rust has first-class sheet print settings.
- Used range/data bounds are Rust-owned. TypeScript `setUsedRange` must not claim to mutate used range unless a real bridge contract exists.

Error and async invariants:

- Domain helpers that return `Promise` must await the underlying bridge call.
- Domain helpers that return synchronous values must be pure reads from the mirror/viewport cache or explicitly documented sync fallbacks.
- Compute failures should not be collapsed to `false`/`null` unless the public API contract explicitly says so and preserves the original failure reason somewhere useful.
- Write-gate and workbook/sheet protection checks belong at public API boundaries, but the domain facade should make it easy for those callers to use one mutation path after checks pass.

## Concrete implementation plan

### 1. Establish the sheet domain boundary

- Add a module-level architecture comment and, if useful, a short internal README for `kernel/src/domain/sheets`.
- State that Rust compute owns durable sheet state and `domain/sheets` owns TypeScript adaptation, validation preflight shared by public APIs, and sync rendering fallbacks.
- Add a barrel `index.ts` only if it becomes the governed public-internal entrypoint. If added, export lifecycle, metadata, dimensions, structures, and defaults intentionally; do not create a loose wildcard export that hides duplicate paths.
- Decide final module shape:
  - `lifecycle.ts`: create, remove, rename, copy, move, hide/show, set/get visibility, visible-sheet queries.
  - `sheet-meta.ts`: metadata, order/name reads, used range reads, frozen panes, print/page state if retained here.
  - `dimensions.ts`: row/column sizes and row/column hidden state.
  - `structures.ts`: row/column insertion/deletion.
  - `sheet-meta-defaults.ts`: runtime schema/default utilities.

### 2. Move lifecycle helpers into the domain facade

- Move or re-home the logic from `kernel/src/api/workbook/operations/sheet-crud-operations.ts` into `domain/sheets/lifecycle.ts`.
- Keep `WorkbookSheetsImpl` responsible for public API concerns: write gate, workbook protection, worksheet instance cache refresh, active-sheet selection, public receipts, and activation event emission.
- Make the domain lifecycle functions await and return typed results:
  - `createSheet(ctx, requestedName): Promise<{ sheetId; resolvedName; mutationResult? }>`
  - `removeSheet(ctx, sheetId): Promise<{ removed: true; mutationResult }>` or throw a typed error on failure
  - `renameSheet(ctx, sheetId, newName): Promise<MutationResult | void>`
  - `copySheet(ctx, sourceSheetId, requestedName): Promise<{ sheetId; resolvedName; sourceSheetId; mutationResult? }>`
  - `moveSheet(ctx, sheetId, toIndex): Promise<MutationResult | void>`
  - `setSheetVisibility(ctx, sheetId, state): Promise<MutationResult | void>`
- Stop converting compute failures to `false` or `null` in the domain layer. Let public APIs map typed errors to public receipt/error language.
- Preserve Rust as final authority for name generation, uniqueness, copy hydration, formula rename, last-sheet deletion, and runtime lifecycle hints.

### 3. Centralize last-visible-sheet and active-sheet policy

- Write one helper that reads canonical Rust visibility and returns:
  - ordered sheet IDs,
  - visible sheet IDs,
  - hidden and veryHidden IDs,
  - whether a target operation would violate the at-least-one-visible-sheet invariant,
  - a candidate replacement active sheet when delete/hide requires reconciliation.
- Use this helper in `WorkbookSheetsImpl.remove`, `hide`, `show`, and any low-level namespace or app path that mutates sheet visibility.
- Keep final enforcement in Rust where possible. If Rust currently allows `setSheetHidden` to hide the last visible sheet, add a compute-side invariant and tests rather than relying only on TypeScript preflight.
- Ensure deleting the last visible sheet while hidden sheets exist atomically reveals/selects the replacement or fails with a deterministic public error. Do not let UI state observe a workbook with zero visible sheets.

### 4. Make metadata reads one coherent contract

- Prefer a single bridge query for public `SheetMeta` if generated `getSheetMeta` is available or can be added cleanly. Avoid five separate roundtrips in `getMeta` when Rust already has `SheetMeta`.
- If `getMeta` continues composing query calls, make the composition explicit and parity-tested against Rust `SheetMeta`.
- Decide whether `getMeta` should include `usedRange`. The public `SheetMeta` type allows it, while generated Rust `SheetMeta` does not currently include it. The correct choices are:
  - add `usedRange` to the bridge/public metadata contract if callers need one complete metadata read; or
  - keep used range as `getUsedRange`/`getUsedRangeEnd` only and document that `SheetMeta.usedRange` is legacy/optional.
- Replace `getFirstId`'s unchecked `ids[0]` return with a typed invariant helper. In normal production initialization it should never fail; if it does, throw a clear kernel error rather than returning `undefined` as `SheetId`.
- Normalize nonexistent sheet behavior:
  - `getName` and `getMeta` return `undefined` for missing sheets.
  - settings-style getters return documented defaults only when the underlying Rust/mirror contract defines default-on-miss semantics.
- Add schema parity checks between `Object.keys(SHEET_META_SCHEMA)` and `SheetMetaField`, with a documented exclusion list only where a field is intentionally not part of public `SheetMeta`.

### 5. Govern `SHEET_META_SCHEMA` as a runtime contract

- Keep `sheet-meta-defaults.ts` in kernel, because it owns runtime defaults and cannot live in type-only contracts.
- Add a small test suite for:
  - every `SheetMetaField` key exists in `SHEET_META_SCHEMA`;
  - every `SHEET_META_SCHEMA` key is either in `SheetMetaField` or in an explicit exclusion list;
  - default values are immutable or cloned when returned through public defaults;
  - copy strategies match lifecycle behavior for create/copy: id/name skipped, hidden reset visible on copy if that remains the intended contract, deep arrays/objects cloned.
- Align `SHEET_SETTINGS_FIELDS` in `domain/workbook/core-defaults.ts` with the schema and with Rust `SheetSettings`.
- Extend `mirror-coverage.test.ts` for any newly governed field so mirror/state hydration failures are caught as contract failures, not UI bugs.

### 6. Fix dimension APIs around Rust bulk reads and cache lifecycle

- Convert `setRowHeight`, `setColWidth`, `hideRows`, `unhideRows`, `hideColumns`, and `unhideColumns` into awaited async domain helpers, or clearly split sync optimistic rendering cache updates from async mutations with different function names.
- Validate row/column indices and finite positive dimensions consistently with `WorksheetLayoutImpl`.
- Replace `getHiddenRows` and `getHiddenColumns` scans over `getDataBounds` with bulk bridge calls (`getHiddenRows`, `getHiddenColumns`) so hidden dimensions outside the used range are included.
- Add cache invalidation for `rowHeightCache` and `colWidthCache` on sheet deletion, sheet copy, undo/redo, hydration, and remote sync. The cleanest implementation is to make the cache owned by document context or mutation handler rather than module-level process state.
- If module-level cache remains, key it by document identity plus sheet ID, not only sheet ID, so concurrent/opened documents cannot leak dimensions into each other.
- Prefer Rust query endpoints for async public reads. Keep `BinaryViewportBuffer` reads only for rendering-path sync APIs where async is impossible.
- Add tests that prove hidden rows/columns return zero in sync getters when BVB has hidden dimensions, and that headless fallback does not override canonical Rust data after a mutation result arrives.

### 7. Consolidate structural operations

- Route `WorksheetStructureImpl` through `domain/sheets/structures.ts` after public validation/protection checks, or explicitly document why it bypasses the domain facade. The preferred shape is one structure-change adapter used by worksheet structure and table row add/delete paths.
- Keep `structures.ts` thin: it should build typed `StructureChange` values, call `ctx.computeBridge.structureChange`, await, and return the mutation result.
- Add domain-side validation only for immediate TypeScript API ergonomics, not as a replacement for Rust bounds validation. Rust remains final authority.
- Expand tests beyond awaiting:
  - negative start index rejected by public worksheet API;
  - non-positive count returns a zero-count public receipt without bridge call;
  - invalid delete beyond grid bounds is rejected by Rust and propagated;
  - insert/delete rows/cols return `MutationResult.structureChanges` with sheet ID, at, and count;
  - row height inheritance on inserted rows is visible after mutation;
  - metadata ranges, merges, named ranges, formulas, tables, comments, and validations shift through Rust production tests.
- Remove unused `_maps` arguments only if all callers can migrate cleanly. If retained for compatibility, document that they are ignored and not a source of sheet structure state.

### 8. Unify frozen panes, split view, and view options

- Pick one TypeScript owner for frozen pane operations. `sheet-meta.ts`, `compute-bridge.ts` overrides, and `api/worksheet/operations/sheet-management-operations.ts` currently overlap.
- Make public worksheet view APIs call the same domain function after validation/protection checks.
- Ensure `setFrozenPanes` awaits `computeBridge.setFrozenPanes`; do not fire and forget.
- Validate non-negative finite integer row/column counts. Clamping negative values to zero hides caller bugs; public APIs should reject invalid input unless a specific UI affordance intentionally normalizes it before calling the domain.
- If split view and freeze panes are mutually exclusive, enforce that in the Rust mutation owner and expose one TypeScript operation that preserves the invariant.
- Extend mirror tests so `SheetChange.field === "frozen"` updates both `getFrozenPanes` and `getSheetMeta().frozen` before event handlers run.

### 9. Move page breaks and print settings onto first-class sheet state

- Audit whether `sheet-meta.ts` should own page break and print settings APIs or whether `api/worksheet/operations/sheet-management-operations.ts` should be the sole sheet-management facade. Prefer `domain/sheets` as the shared owner.
- Replace workbook-setting blob writes for per-sheet print settings with first-class Rust sheet print settings if the bridge already exposes them. If not, add the Rust bridge contract rather than extending the blob pattern.
- Keep `setPageBreaks` diffing only if Rust exposes add/remove primitives but no set-snapshot endpoint. If a set-snapshot endpoint exists or can be added, prefer an atomic set operation to avoid partial success across multiple add/remove calls.
- Normalize page break shapes at the bridge boundary (`min` default, `pt` default) consistently with `state-mirror.ts`.
- Cover print settings field renames and nullable-vs-optional semantics in tests so `printComments`, DPI, page order, errors, and printer defaults do not drift.

### 10. Retire misleading used-range mutation APIs

- Replace `setUsedRange` with one of:
  - a real bridge operation that sets/recomputes Rust data bounds atomically, if import or repair workflows truly need it; or
  - an explicit deprecated no-op with no production callers, plus a plan to remove it from public namespace exports.
- Search all import/recompute paths before removal. The production contract should be "Rust data bounds update with cell writes and clears."
- Add tests for `getUsedRangeEnd` and `getUsedRange` on empty sheets, single-cell sheets, cleared sheets, and sheets with formatting-only or hidden rows/columns, using Rust production data bounds.

### 11. Align generated bridge and public contract surfaces

- If bridge methods are added or signatures change, regenerate bridge bindings through the repo's bridge workflow and update generated TypeScript intentionally.
- Add parity tests for:
  - TypeScript `StructureChange` union and Rust `formula_types::StructureChange` serde shape;
  - generated `SheetMeta` and public `SheetMeta`;
  - `FrozenPanes` and `SheetLifecycleRuntimeHint` generated/public shapes;
  - visibility strings (`visible`, `hidden`, `veryHidden`) where exposed.
- Prefer structured parsing or generated type surfaces for parity checks; avoid brittle string matching.

### 12. Route production callers through the canonical facade

- Migrate callers in small, verifiable slices:
  - `api/namespaces/sheets.ts` for low-level reads and view operations.
  - `api/workbook/sheets.ts` for lifecycle after public checks.
  - `api/worksheet/structure.ts` for row/column insert/delete after protection checks.
  - `api/worksheet/layout.ts` for dimensions/visibility after format protection checks.
  - `api/worksheet/view.ts` and `api/worksheet/operations/sheet-management-operations.ts` for frozen panes, print, and page state.
  - table row insertion/deletion paths that call structures directly.
- After each migration, delete or make private any duplicate helper that can no longer be called from production.
- Keep app UI code and renderer code consuming public workbook/worksheet/mirror APIs, not domain internals.

## Tests and verification gates

Characterization tests before implementation:

- Add focused Jest tests under `kernel/src/domain/sheets/__tests__/` for current metadata reads, dimension cache behavior, hidden row/column enumeration, frozen pane writes, page break diffing, print settings merge behavior, used range reads, and structure mutation awaiting.
- Add tests that show which public APIs currently bypass `domain/sheets` so migration can be measured.

TypeScript/kernel gates after implementation:

- `pnpm --filter @mog-sdk/kernel test`
- `pnpm --filter @mog-sdk/kernel typecheck`
- Targeted kernel tests for:
  - `kernel/src/domain/sheets/__tests__/*`
  - `kernel/src/api/workbook/__tests__/sheets.test.ts`
  - workbook implementation sheet lookup/name/order tests
  - worksheet structure/layout/view tests
  - state mirror and mirror coverage tests
  - mutation result handler sheet lifecycle tests

Rust/bridge gates where compute behavior or bridge contracts change:

- `cargo test -p compute-core`
- Focused compute-core tests for:
  - create/default/copy/delete/rename/move sheet lifecycle and hydration-shaped mutation results;
  - last sheet and last visible sheet invariants;
  - visible/hidden/veryHidden queries and counts;
  - structural insert/delete bounds, row height inheritance, formula/named range writeback, metadata shift, layout index rebuild, merge cleanup, and deleted virtual cell cleanup;
  - sheet metadata defaults, tab color, frozen panes, page breaks, print settings, split config, and scroll position;
  - undo/redo and observer rebuild lifecycle hints.
- Regenerate bridge bindings if Rust bridge signatures change, then run the repository's bridge generation/parity gate.

Public contract gates:

- `pnpm typecheck` after public TypeScript contract/export changes.
- `pnpm check:publish-readiness:fast` when public exports, declaration surfaces, or package boundary behavior changes.
- Add or update API fixtures/snapshots if `SheetMeta`, visibility state, lifecycle receipts, or namespace signatures change.

UI behavior gates for user-visible changes:

- Run the spreadsheet app and exercise real UI input paths for:
  - add, rename, duplicate, move, hide, show, and delete sheet tabs;
  - cannot hide/delete the last visible sheet;
  - hide/delete active sheet with another sheet selected afterward;
  - freeze rows, freeze columns, freeze panes, unfreeze, and split/freeze exclusivity;
  - resize rows/columns, hide/unhide rows/columns, and verify rendering dimensions;
  - insert/delete rows/columns with formulas, tables, merges, comments, validations, and named ranges present;
  - print area/page breaks/print settings through print/PDF UI if the touched path affects print state;
  - undo/redo of sheet lifecycle, visibility, frozen panes, dimensions, and structural edits.

## Risks, edge cases, and non-goals

Risks:

- Promoting lifecycle helpers into `domain/sheets` touches public workbook APIs and Rust bridge expectations. The migration should preserve public receipts while removing duplicate mutation paths.
- `dimensions.ts` currently uses module-level caches. Changing cache ownership can reveal tests or headless callers that depended on cross-call in-memory read-back before Rust query results were available.
- Switching hidden-row/column enumeration from data-bounds scans to bulk Rust queries can surface previously missed hidden dimensions outside the used range. That is a correctness improvement, but UI tests may need updated expectations.
- Awaiting formerly fire-and-forget mutations can change timing and expose latent bridge errors. Public APIs should already be async, so this should be treated as fixing the contract.
- `SHEET_META_SCHEMA` covers more fields than public `SheetMeta`; forcing them into one shape would create churn and confusion. Keep the distinction explicit.
- Per-sheet print settings currently use a workbook-setting blob in TypeScript. Moving to first-class Rust sheet state may require bridge and mirror updates.

Edge cases to cover:

- Empty workbook during failed initialization or recovery.
- Deleting the active sheet, a hidden sheet, the last sheet, and the last visible sheet.
- Hiding a visible sheet when all others are hidden or veryHidden.
- Showing a veryHidden sheet through public APIs and import/export paths.
- Renaming to the same name with different casing, duplicate names, empty names, names with quotes/spaces, and formulas that reference renamed sheets.
- Copying hidden, protected, colored, frozen, split, printed, filtered, table-heavy, chart-heavy, and formula-heavy sheets.
- Moving sheets to negative, oversized, current, first, and last indices.
- Structural delete beyond row/column bounds, delete all rows/columns attempts, and insert at sheet edges.
- Hidden rows/columns outside used range.
- Formatting-only sheets and sheets with no data bounds.
- Undo/redo and remote collaboration replay for every sheet lifecycle and metadata mutation.
- Hydration from blank workbook, XLSX, CSV, provider replay, deferred hydration, and sync rebuild.

Non-goals:

- Do not move durable sheet state out of Rust compute.
- Do not add TypeScript formula rewriting or grid-index mutation.
- Do not preserve stale duplicate paths for compatibility if production callers can use the canonical domain facade.
- Do not optimize benchmark or test-only sheet paths.
- Do not leak internal planning content into the public `mog` repo.
- Do not change app UI architecture except where needed to consume the corrected production contracts or verify real user flows.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the target contracts are written down:

- Worker A: lifecycle facade in `kernel/src/domain/sheets/lifecycle.ts` plus migration of `api/workbook/sheets.ts` and `sheet-crud-operations.ts`.
- Worker B: metadata/default/schema parity across `sheet-meta.ts`, `sheet-meta-defaults.ts`, `types/api`, generated bridge types, and mirror coverage.
- Worker C: dimensions and row/column visibility cleanup in `dimensions.ts`, `WorksheetLayoutImpl`, Rust bulk queries, and rendering/headless tests.
- Worker D: structural operation consolidation in `structures.ts`, `WorksheetStructureImpl`, table row insertion/deletion callers, and Rust structure-change coverage.
- Worker E: view/print/page state consolidation across `sheet-meta.ts`, `api/worksheet/operations/sheet-management-operations.ts`, state mirror, and Rust sheet view/print modules.
- Worker F: bridge/codegen parity for any new or changed Rust methods and generated TypeScript contracts.
- Worker G: UI/E2E verification through real sheet tab, layout, structure, and print workflows.

Dependencies:

- Lifecycle consolidation depends on preserving `WorkbookSheetsImpl` public receipt and worksheet-cache behavior.
- Metadata consolidation depends on an explicit decision about whether `usedRange` belongs in `getMeta` or remains a separate query.
- Dimension cache cleanup depends on mutation-result or document-lifecycle hooks that can invalidate per-document sheet caches.
- Print settings cleanup depends on whether Rust already has a first-class set-snapshot endpoint or needs one.
- Bridge contract changes must land before callers migrate to new generated methods.
