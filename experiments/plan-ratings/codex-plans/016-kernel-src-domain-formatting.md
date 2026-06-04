# 016 - Kernel Domain Formatting Improvement Plan

## Source folder and scope

Source folder reviewed: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/formatting`

Queue item 16 covers formatting semantics shared by UI, compute, and file IO. The folder currently contains:

- `format-registry.ts`: runtime Excel-style format property registry plus summary/query helpers.
- `merges.ts`: TypeScript domain wrappers for merged-cell operations.

Adjacent production paths that must be treated as part of the contract surface:

- `types/core/src/core.ts` and `domain-types/src/cell_format.rs` for the public TypeScript and Rust `CellFormat` shapes.
- `kernel/src/bridges/wire/__tests__/cell-format-drift.test.ts` and `kernel/src/bridges/wire/constants.gen.ts` for existing TS/Rust field drift detection.
- `kernel/src/bridges/compute/compute-bridge.gen.ts` for generated merge and format bridge methods.
- `kernel/src/api/worksheet/structure.ts`, `kernel/src/api/worksheet/operations/merge-operations.ts`, and spreadsheet merge action handlers for public/UI merge flows.
- `compute/core/src/storage/sheet/merges/*` and `domain-types/src/domain/merge.rs` for canonical identity-backed merge semantics.
- `file-io/xlsx/parser/src/domain/styles/*`, `canvas/grid-renderer`, `file-io/print-export`, and clipboard style paths for import/export/render coverage.

Implementation belongs in the public `mog` repo. This plan remains internal.

## Current role of this folder in Mog

`domain/formatting` has two partially related responsibilities.

First, `format-registry.ts` claims to be the single source of truth for Excel format property coverage across contracts, import, export, and render. In practice it is a hand-maintained advisory table. It is not consumed outside itself, does not cover all current `CellFormat` fields, and does not drive tests, docs, import/export, render, or API behavior. Notable missing or ambiguous fields include `fontTheme`, tint fields, `autoIndent`, `forcedTextMode`/Rust `quotePrefix`, `extensions`, Rust-only OOXML preservation fields such as `fontCharset` and `fontFamilyType`, and richer nested border fields such as vertical/horizontal/outline/diagonal flags.

Second, `merges.ts` is a thin wrapper over `ctx.computeBridge` for core merge reads and writes, but it still contains TypeScript-side behavior that should now be owned by compute. It locally filters all merges for range/viewport queries, sequentially loops `mergeAcross` and `clearAll`, returns conservative no-op results for `checkMergeDataLoss` and `validateAndClean`, and exposes a no-op `subscribe`. The generated compute bridge already has production methods for `mergeAcross`, `mergeAndCenter`, `checkMergeDataLoss`, `isMergeOrigin`, `clearAllMerges`, and `validateAndCleanMerges`.

The public worksheet structure API currently bypasses this domain module for merge/unmerge and adds viewport invalidation/refresh itself. Older operation helpers can still call through `domain/formatting/merges` without the same refresh behavior. Spreadsheet UI merge warnings also detect data loss from viewport data, so off-viewport cells can be missed even though compute has a full-sheet data-loss query.

## Improvement objectives

1. Make `domain/formatting` an executable contract layer for formatting coverage, not a stale status table.
2. Reconcile the registry against the real TypeScript contract, Rust wire fields, compute storage/resolution behavior, file-IO import/export, canvas rendering, PDF export, and clipboard/style-transfer support.
3. Replace merge compatibility stubs and TypeScript loops with production compute bridge methods.
4. Centralize merge mutation side effects so every public merge path refreshes viewport merge indexes consistently.
5. Route UI merge data-loss warnings through compute-backed full-sheet queries rather than viewport-only inspection.
6. Add range/viewport merge query contracts that avoid fetching and filtering all merges in JavaScript for production callers.
7. Fix the public packaging story for the runtime registry so type-only contracts exports do not advertise moved runtime APIs.
8. Document the folder's ownership clearly: formatting contract metadata and merge orchestration only; persisted state and validation authority remain in compute/Rust.

## Production-path contracts and invariants to preserve or strengthen

- `CellFormat` remains sparse: undefined fields mean "no local override"; cascade merging remains compute-owned.
- Format cascade order must stay explicit and testable: defaults, column, row, range formats, table style, cell format, theme resolution, conditional formatting, and value-dependent number-format color where applicable.
- Every registry entry must be either a real public `CellFormat` path, a documented nested subfield, a Rust-only OOXML preservation field, or an explicit file-IO alias such as pattern background mapped through `backgroundColor`.
- Registry status must be evidence-backed. A field cannot claim import/export/render support unless a corresponding production reader/writer/render path or test fixture covers it.
- TS/Rust field drift remains guarded by generated Rust field constants and TypeScript exhaustive maps, with documented allowed exceptions.
- Theme references and tint fields must survive import, compute storage, viewport/readback, rendering, export, and clipboard/PDF projection where those surfaces claim support.
- Merged-cell coordinates are zero-based and inclusive across TS, Rust, viewport, file IO, and UI.
- Rust compute remains the authority for merge validity, overlap checks, identity resolution, data-loss detection, value clearing, and invalid merge cleanup.
- Merge storage remains identity-backed through CellIds and resolves to positions for read paths. The top-left origin retains content; covered cells are cleared according to compute's merge mutation contract.
- Single-cell merge behavior must be defined once at the API boundary and tested. Public APIs may reject it; lower compute operations may return no-op, but callers must not report a successful merge receipt for a no-op.
- Merge mutations that affect grid geometry must invalidate prefetch and refresh affected viewports before UI selection/interaction reads the merge index.
- Merge warning UI must detect non-origin data outside the viewport.
- Domain functions must not keep their own state or emit manual events. Mutation events continue to flow through compute mutation results and `MutationResultHandler`.
- Public dependency direction is unchanged: `mog` must not depend on `mog-internal`.

## Concrete implementation plan

1. Define the formatting folder contract.

   - Update `kernel/src/domain/README.md` so `formatting/` is no longer described as only "Merges".
   - Add a short module-level README or `index.ts` comment describing the two owned surfaces: format coverage metadata and merge orchestration.
   - Declare that compute/Rust is the source of persisted formatting state and merge validation; TypeScript domain code prepares calls, adapts contracts, and exposes verified metadata.

2. Replace the advisory registry with an executable coverage matrix.

   - Extend `FormatPropertyDef` or add a kernel-local richer type with `cellFormatPath`, `rustField`, `ooxmlReadPath`, `ooxmlWritePath`, `computeStorage`, `viewportRead`, `canvasRender`, `pdfRender`, `clipboardHtml`, `notes`, and `evidence`.
   - Keep simple summary helpers, but compute them from evidence-backed statuses rather than unsupported booleans.
   - Model nested fields explicitly: `borders.top.style`, `borders.top.color`, `borders.top.colorTint`, all edges, diagonal flags, vertical/horizontal borders, and outline.
   - Add current missing fields: `numberFormatType`, `fontTheme`, `fontColorTint`, `backgroundColorTint`, `patternForegroundColorTint`, `autoIndent`, `forcedTextMode`, `extensions`, Rust `quotePrefix`, `fontCharset`, and `fontFamilyType`.
   - Represent `patternBackgroundColor` as an OOXML/file-IO alias mapped to public `backgroundColor`, not as a fake missing contract field that inflates summary counts.
   - Use `satisfies readonly FormatPropertyDef[]` and literal unions so invalid category/property names fail typecheck.

3. Connect registry coverage to existing drift infrastructure.

   - Reuse `RUST_CELL_FORMAT_FIELDS` from `kernel/src/bridges/wire/constants.gen.ts` and the existing `cell-format-drift.test.ts` field maps as the base field inventory.
   - Add registry tests that fail when a TS field, Rust field, nested border field, or documented allowed exception is not represented in the registry.
   - Keep explicit allowlists for TS-only, Rust-only, renamed, derived, and extension fields with reasons.
   - Add tests that ensure `getMissing*` helpers and `printRegistrySummary()` reflect the new richer statuses deterministically.

4. Audit and align production format coverage.

   - For XLSX read/write, trace fields through `file-io/xlsx/parser/src/domain/styles/read/*`, `file-io/xlsx/parser/src/domain/styles/write/*`, parse-output lowering, and export.
   - For compute, trace `CellFormat` validation, storage, range format cascade, row/column formats, resolved format reads, displayed format reads, viewport palette/wire encoding, and undo/redo payloads.
   - For UI render, trace `canvas/grid-renderer` and spreadsheet dialogs/toolbars.
   - For non-canvas output, trace PDF export and clipboard HTML/style transfer.
   - Update registry statuses only when the production path and focused tests support the claim. Unknown fields should remain explicit gaps with the smallest owner and verification target.

5. Fix runtime packaging for the registry.

   - Decide the supported runtime import path for the registry, likely under `@mog-sdk/kernel/domain/formatting/format-registry` or a public kernel barrel if such subpaths are intentionally published.
   - Remove or runtime-proof any `@mog-sdk/contracts/format-registry` package export that appears to expose moved runtime code while the contracts file is type-only.
   - Add a package/API test or publish-readiness check for the chosen behavior so consumers cannot accidentally import a missing runtime registry from contracts.

6. Consolidate merge write operations on compute bridge methods.

   - Make `mergeRange`, `unmergeRange`, `mergeAcross`, `mergeAndCenter`, `clearAll`, and `validateAndClean` use the generated compute bridge methods directly.
   - Preserve that "merge and center" alignment formatting is applied separately by API/UI callers; the compute merge method only unmerges overlaps and creates the merge unless compute explicitly grows to own alignment.
   - Define all-or-nothing versus best-effort behavior for `mergeAcross` and `clearAll`. Prefer one compute mutation result per user command and avoid TypeScript loops that can leave partial results after failure.
   - Return or internally inspect `MutationResult` enough to know whether a no-op occurred, instead of blindly reporting success for invalid, overlapping, or single-cell merges.

7. Replace merge compatibility stubs with real production queries.

   - Change `checkMergeDataLoss` to an async compute-backed query returning `{ hasDataLoss, cellsWithData }` from `computeBridge.checkMergeDataLoss`.
   - Update UI merge-warning action handlers to call the full-sheet query. If the dialog needs cell coordinates, add a compute query that returns representative or complete cell coordinates rather than falling back to viewport reads.
   - Change `isOrigin` to use `computeBridge.isMergeOrigin` when only the boolean is needed.
   - Change `validateAndClean` to call `computeBridge.validateAndCleanMerges` and return the removed count from mutation result data.
   - Remove or formally deprecate `subscribe`; production callers should subscribe to event bus or viewport services, not a no-op domain callback.

8. Add production range/viewport merge queries.

   - Add generated compute bridge methods for `getMergesInRange` and `getMergesInViewport`, backed by `compute/core/src/storage/sheet/merges::get_merges_in_range` and `get_merges_in_viewport`.
   - Update `domain/formatting/merges.getInRange()` and `getInViewport()` to use those bridge calls instead of fetching every merge and filtering in JavaScript.
   - Migrate range-overlap consumers in sorting, clipboard paste, renderer selection, and dialogs to the range-scoped query where appropriate.
   - Keep the local `rangesOverlap` helper only in tests or delete it once no production path uses it.

9. Centralize merge viewport refresh behavior.

   - Add a single helper in the public merge/structure production path that performs the compute mutation, invalidates viewport prefetch, and forces viewport refresh when the merge set changed.
   - Use it from `WorksheetStructureImpl.merge/unmerge`, worksheet operation helpers, and any internal domain-based merge callers.
   - Avoid double refreshes by making direct bridge callers either opt into the helper or explicitly document why they are not UI-visible.
   - Add tests around immediate post-merge selection/click behavior so stale `ViewportMergeIndex` regressions are caught.

10. Tighten public merge API receipts and errors.

   - Normalize public receipts from actual resolved merge results or mutation data, not just the requested range.
   - Make overlap/no-op/single-cell behavior consistent across `WorksheetStructureImpl`, `kernel/src/api/worksheet/operations/merge-operations.ts`, app actions, and any SDK facade.
   - Preserve typed public errors where they already exist and avoid stringly `operationFailed(String(e))` when compute returns structured error data.

11. Documentation and migration cleanup.

   - Document merge identities: `MergeRegion`, `IdentityMergedRegion`, `ResolvedMergedRegion`, and `CellMergeInfo`.
   - Document which formatting properties are semantic, display-only, OOXML-preservation-only, derived, or extension fields.
   - Remove comments that say stubs are kept for compatibility once callers are migrated.

## Tests and verification gates

Add focused tests for future implementation work:

- Registry exhaustiveness against TypeScript `CellFormat`, Rust generated fields, nested border subfields, and documented exceptions.
- Registry summary/helper tests for each status dimension and category.
- Registry evidence tests for fields that claim XLSX read/write, compute storage/readback, viewport wire, canvas render, PDF render, and clipboard transfer support.
- XLSX roundtrip fixtures for tints, theme fonts, quote prefix/forced text, auto indent, nested borders, gradient fills, pattern fills, protection, and number formats.
- Compute storage tests for set/get/resolved/displayed formats across default/row/column/range/table/cell/CF layers.
- Kernel merge tests for single-cell, inverted range, overlap, merge across, merge and center without alignment side effects, unmerge by origin, clear all, validate/clean, data-loss query, and range/viewport query behavior.
- Spreadsheet UI tests for merge warning on off-viewport data, merge-and-center alignment, unmerge, merge-across, immediate click/selection after merge, and undo/redo receipts. E2E coverage must drive real UI input paths.
- File-IO merge fixtures for normal merged cells, wide empty covered cells, imported invalid merges, and roundtrip export ordering.

Verification gates to run when implementing:

- Relevant kernel package tests for `kernel/src/domain/formatting`, `kernel/src/api/worksheet/structure.ts`, worksheet merge operations, and wire drift tests.
- `pnpm typecheck` for TypeScript changes.
- `cargo test -p compute-core` and `cargo clippy -p compute-core` if compute merge or format storage/query code changes.
- Relevant file-IO parser/export Rust tests if XLSX style or merge read/write coverage changes.
- Spreadsheet dev server browser exercise for UI-visible merge and format changes.

No build, test, typecheck, formatter, cargo, rustc, pnpm, npm, or yarn commands were run for this planning-only worker because the queue explicitly forbids them.

## Risks, edge cases, and non-goals

Risks:

- Making the registry executable can expose many existing gaps at once. Treat that as the point of the work; do not hide gaps behind broad "implemented" statuses.
- Changing `checkMergeDataLoss` from sync/no-op to async/compute-backed will require caller migration and UI loading/error handling.
- Merge viewport refresh centralization can double-refresh if direct bridge callers are not audited.
- Compute `mergeAcross` currently has best-effort characteristics; changing it to all-or-nothing may affect imported or overlapping selections unless the contract is specified first.
- Public package export changes can break consumers if type-only and runtime paths are not migrated together.
- Format properties such as `extensions`, `numberFormatType`, and forced text are not all the same kind of property; modeling them as identical visual fields would create false guarantees.

Edge cases to cover:

- Theme colors with tint on font, fill, and pattern foreground.
- Theme font references with fallback font family.
- Quote prefix / forced text mode through edit, compute storage, XLSX import/export, and display.
- Border diagonal up/down, vertical/horizontal inside borders, outline flag, and partial border-side updates.
- Gradient path and linear fills, pattern foreground/background mapping, and `gray125`/`none` patterns.
- Merges on empty cells, covered cells with formulas, off-viewport covered data, overlapping existing merges, invalid CellId-backed merges after structure changes, hidden rows/columns, tables, autofit, sort/fill/clipboard interactions, and immediate post-mutation selection.

Non-goals:

- Do not move compute-owned format cascade, merge storage, or validation into TypeScript.
- Do not add a TypeScript shadow store for merges or formatting.
- Do not optimize test-only paths, mocks, or benchmark harnesses.
- Do not add compatibility shims that preserve no-op merge/data-loss behavior.
- Do not reduce the registry to a documentation-only table after calling it a contract.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the contracts are written.

- Agent A: registry field inventory and executable registry schema against TS/Rust fields.
- Agent B: XLSX/file-IO, clipboard, PDF, and canvas evidence audit for registry statuses.
- Agent C: merge bridge consolidation, data-loss query migration, and range/viewport query additions.
- Agent D: viewport refresh centralization and public worksheet/API receipt/error cleanup.
- Agent E: UI tests and browser verification for merge warnings, immediate merge-index refresh, and formatting readback.

Dependencies:

- `types/core/src/core.ts`, `contracts/src/formatting/*`, and `types/formatting/src/formatting/*` for public type/export behavior.
- `domain-types/src/cell_format.rs`, `domain-types/src/domain/merge.rs`, and `domain-types/src/yrs_schema/*` for canonical Rust domain models.
- `kernel/src/bridges/compute/compute-bridge.gen.ts`, bridge manifest/codegen, and compute API handlers for any new merge query methods.
- `compute/core/src/storage/sheet/merges/*` and `compute/core/src/storage/engine/services/structural/merges.rs` for merge query/mutation authority.
- `compute/core/src/storage/engine/formatting/*`, `compute/core/src/storage/properties/*`, and `compute/core/crates/compute-wire` for format storage/readback/wire behavior.
- `file-io/xlsx/parser`, `canvas/grid-renderer`, `file-io/print-export`, and spreadsheet clipboard/style-transfer code for cross-surface format support claims.
- `apps/spreadsheet/src/actions/handlers/formatting/merge-operations.ts`, grid-editing merge coordination, and toolbar/dialog formatting code for UI-visible behavior.
