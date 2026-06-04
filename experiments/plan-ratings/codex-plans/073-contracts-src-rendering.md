# 073 - Contracts Rendering Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/contracts/src/rendering`

Scope for this plan is the public `@mog-sdk/contracts/rendering` surface: renderer-facing data source contracts, `GridRenderer` facade contracts, render-context update inputs, branded coordinate and viewport contracts, hit-test result contracts, interactive-element contracts, rendering constants, SheetView skin defaults, transient visual feedback defaults, and the public projection from private type shards into the shipped contracts package.

Adjacent folders that must be considered during implementation:

- `mog/types/rendering/src`, because most public rendering types currently originate there and are re-exported through `contracts/src/rendering` as type-only projections.
- `mog/types/viewport/src/rendering`, because leaf viewport primitives, constants, `GridRegionMeta`, `RenderPriority`, `LayerName`, `ObjectBounds`, and page-break primitives live there to avoid type cycles.
- `mog/canvas/grid-canvas/src/renderer`, because it implements `GridRenderer`, adapts `RenderContextConfig`, applies SheetView skin/defaults, and bridges viewport buffer writes to invalidation.
- `mog/canvas/grid-renderer/src`, because it consumes the data source, coordinate, hit-test, region, text measurement, grouping, and skin contracts on the render hot path.
- `mog/views/sheet-view/src`, because it creates SheetView capabilities, wires viewport readers, and maps view-layer DTOs into renderer contracts.
- `mog/apps/spreadsheet/src/systems/renderer`, `mog/apps/spreadsheet/src/systems/input`, and `mog/apps/spreadsheet/src/coordinator`, because they call renderer lifecycle, context, hit-test, pointer-capture, and object-scene methods through these contracts.
- `mog/kernel/src/api/workbook`, `mog/kernel/src/domain/sheets`, and `mog/file-io/print-export`, because they use rendering constants, `FrozenPanes`, `HeaderVisibility`, `RenderScheduler`, and chrome theme contracts outside the canvas packages.

This is public Mog source. Implementation work belongs in `mog`; this plan remains internal in `mog-internal`.

## Current role of this folder in Mog

`contracts/src/rendering` is the public boundary between spreadsheet state and renderer implementations. It is not the renderer itself. It defines the shape of data and commands that kernel, SheetView, spreadsheet systems, canvas packages, print/export, and public SDK consumers use without importing canvas internals.

The folder currently has three different kinds of files:

- Runtime-bearing public values owned by `contracts/src/rendering`: rendering constants, `DEFAULT_CHROME_THEME`, `DEFAULT_SHIMMER_CONFIG`, `RenderPriority`, and `DEFAULT_RESOLVED_SHEET_VIEW_*`.
- Contract type definitions that are duplicated locally or composed locally: `GridRenderer`, data source interfaces, render context DTOs, SheetView skin DTOs, and visual feedback DTOs.
- Re-export shims that point to private type shards: `coordinates`, `hit-test`, `hit-test-service`, `interactive-elements`, `coordinator-interfaces`, `grouping`, `render-context`, `canvas-bridge-types`, `text-measurement-service`, plus viewport leaves such as `primitives` and `grid-region`.

The shipped package currently exposes these rendering subpaths in `contracts/package.json`: `./rendering`, `./rendering/sheet-view-skin`, `./rendering/coordinates`, and `./rendering/constants`. The root `./rendering` barrel is much wider than those leaf subpaths: API snapshots show it exporting `GridRenderer`, `RenderContextConfig`, `CoordinateSystem`, hit-test unions, data sources, interactive elements, text measurement, page break contracts, skin contracts, constants, and runtime defaults.

The folder is therefore a critical contract projection layer. Its main weakness is not missing implementation capacity; it is that source-of-truth, public leaf boundaries, runtime-value ownership, and contract invariants are not executable enough. There is one local test today, covering only `DEFAULT_ROW_HEIGHT`.

## Improvement objectives

1. Make the rendering public surface explicit and executable: every exported symbol must have a declared source of truth, owner package, public module, runtime/type-only disposition, and production consumer category.
2. Remove drift between `contracts/src/rendering`, `types/rendering/src`, and `types/viewport/src/rendering` by adding parity gates for mirrored runtime values and by eliminating untracked handwritten duplicates.
3. Replace blanket public barrels with deliberate exports and public leaf subpaths for the major rendering contract modules already exposed through the root barrel.
4. Strengthen renderer state contracts so `RenderContextConfig`, typed data sources, `GridRenderer.updateContext()`, and optional dependency clearing have precise semantics instead of relying on broad partial objects.
5. Strengthen viewport and coordinate contracts so branded coordinates are usable from the public package, range conversions can represent multi-region freeze/split layouts, and header/outline/zoom/RTL assumptions are explicit.
6. Make hit-test and interactive-element discriminated unions exhaustive at the public boundary, including every union arm defined in leaf files.
7. Treat runtime defaults as immutable public contract values and verify that SheetView skin, chrome theme, shimmer, zoom, row/column metrics, and render priority values stay consistent across packages.
8. Add contract tests that cover production consumers and public package behavior, not only isolated constants.
9. Keep private implementation details private: public `@mog-sdk/contracts` must not leak runtime imports from private `@mog/types-*` packages or require users to import private helpers.

## Production-path contracts and invariants to preserve or strengthen

- `@mog-sdk/contracts/rendering` remains the only public renderer contract import path. Canvas packages can be private implementation packages; callers should not need `@mog/types-rendering` or `@mog/types-viewport`.
- Runtime exports in the public package must be contracts-owned or explicitly projected into contracts. Type-only imports from private type shards are allowed when they preserve the dependency graph; runtime imports from private shards are not.
- `RenderPriority` numeric ordering is a contract: `CRITICAL = 0`, `USER_BLOCKING = 1`, `NORMAL = 2`, `LOW = 3`, `IDLE = 4`.
- Row, column, header, zoom, outline, scrollbar, and hit target constants must agree between public contracts, private viewport leaves, spreadsheet-utils helpers, canvas packages, kernel defaults, and print/export.
- `DEFAULT_COL_WIDTH` platform detection must remain deterministic in Node/test contexts and must not make public artifacts depend on browser-only globals without guards.
- Default objects (`DEFAULT_CHROME_THEME`, `DEFAULT_SHIMMER_CONFIG`, `DEFAULT_RESOLVED_SHEET_VIEW_OPTIONS`, `DEFAULT_RESOLVED_SHEET_VIEW_SKIN`) are public constants. Consumers may read them as immutable defaults; implementation should prevent accidental mutation or at minimum test that mutation cannot corrupt later resolutions.
- `RenderContextConfig` is the input to a hot production path. Contract changes must keep `updateContext()` O(number of patched fields), avoid serialization/deep cloning, and define whether `undefined`, omitted, and `null` mean "leave unchanged", "use default", or "clear".
- Typed data source interfaces are read contracts. Side-effecting bridges such as chart rendering must stay named and separated from data sources.
- `CellCoord` is zero-indexed `{ row, col }`; `CellRange` values crossing frozen or split regions must be representable without collapsing to a single misleading rect.
- Branded coordinate types remain zero-runtime type safety. Public consumers must have public factory helpers or another public-safe construction path; public docs must not require private `@mog/spreadsheet-utils` imports.
- `CoordinateSystem` conversions must account for scroll, zoom, frozen panes, split regions, hidden headers, outline gutters, hidden rows/columns, merged cells, and device pixel ratio where applicable.
- Hit-test result unions must be exhaustive and exported consistently. If `HitTestResult` can return a result, its interface must be public from the same module.
- `GridRenderer` is the public facade implemented by `grid-canvas`. Its methods must correspond to production behavior, including lifecycle, viewport layout, invalidation, hit testing, scene graph reads, object bounds updates, interactive element collection, and scheduler access.
- `RenderScheduler` preserves "write = invalidate": cell buffer writes mark cells dirty, geometry writes mark geometry dirty, and full buffer/theme swaps mark all dirty.
- SheetView skin contracts are renderer-facing resolved DTOs, not persisted SheetView options. View-layer DTOs must be mapped into these contracts at the boundary.
- Dependency direction remains acyclic: `mog` must not depend on `mog-internal`, `contracts` must not import app or canvas implementations, and public examples/website must not depend on private/internal content.

## Concrete implementation plan

1. Build an executable rendering contract inventory.

   Add a checked manifest for `contracts/src/rendering` that records every public symbol exported by `@mog-sdk/contracts/rendering` and each rendering leaf subpath. For each symbol, record source file, source package, public module, runtime or type-only disposition, owning contract category, and primary production consumers. Drive this from a test so adding a new rendering contract fails until its disposition is explicit.

2. Make public exports explicit.

   Replace the root barrel's broad `export type * from '@mog/types-rendering'` with explicit type exports grouped by leaf contract. Keep runtime value exports local to `contracts/src/rendering`. Add or update public leaf subpaths for the major modules already exposed through the root barrel: `data-sources`, `grid-renderer`, `hit-test`, `hit-test-service`, `render-context`, `interactive-elements`, `text-measurement-service`, `coordinator-interfaces`, `grouping`, `visual-feedback`, `canvas-bridge-types`, and `grid-region`. Update `tools/package-inventory.jsonc` and API snapshots to match the intended public-experimental surface.

3. Lock source-of-truth parity across type shards.

   Add parity tests comparing contracts-owned runtime values with private type-shard values where both currently exist: `constants`, `DEFAULT_CHROME_THEME`, `DEFAULT_SHIMMER_CONFIG`, `DEFAULT_RESOLVED_SHEET_VIEW_*`, `RenderPriority`, and `LayerName`. The right end state is no silent duplicate drift: either one side is generated/projected from a manifest, or tests prove byte-for-byte/object-shape parity for every mirrored runtime value.

4. Fix runtime inventory accuracy.

   Update `tools/contracts-runtime-inventory.json` and its fixture coverage so rendering runtime values are attributed to `contracts/src/rendering` with the correct public modules. Ensure type-only projections from `@mog/types-rendering` are not treated as runtime leaks, and ensure every public runtime value in the rendering root and leaf subpaths is imported by the external runtime fixture.

5. Add public coordinate construction helpers.

   Move zero-runtime branded coordinate factories into a contracts-owned public leaf, or add a `./rendering/coordinates` value surface that exports `documentPoint`, `documentRect`, `viewportPoint`, `viewportRect`, `layerPoint`, and `layerRect`. Update internal callers that currently use `@mog/spreadsheet-utils/rendering/coordinates` when they are crossing public contract boundaries. Public docs should show only public package imports.

6. Strengthen viewport geometry result contracts.

   Introduce explicit rect-list and primary-rect types for conversions that can cross frozen or split regions. Update `CoordinateSystem.rangeToViewport`, `GridRenderer.getRangePageBounds`, and related docs to distinguish "all visible rects" from "primary rect for anchoring". Add contracts for hidden headers and outline gutters so row/column header dimensions are derived from `HeaderVisibility` plus grouping state rather than assumed constants.

7. Make `RenderContextConfig` field disposition exhaustive.

   Add a type-level and test-level inventory for every `keyof RenderContextConfig`: owner data source, update semantics, default value, clear semantics, dirty/invalidation effect, and production producer. Replace ambiguous optional fields where needed with explicit nullable fields or patch wrapper types. Do not preserve stale optional dependency behavior; update production callers to the clearer contract.

8. Align typed data sources with render-context patches.

   Ensure every data source interface has a corresponding render-context patch input or an explicit reason it does not. Remove duplicate method shapes where `RenderContextConfig` and data-source interfaces diverge. For example, page break, grouping, shimmer, table/filter metadata, floating object bounds, and overlay contracts should use the same DTO names and readonly/read-write semantics at both boundaries.

9. Fix hit-test and interactive-element exhaustiveness.

   Export every union arm that can appear in `HitTestResult` or `UnifiedHitResult`, including outline gutter results. Add an exhaustive switch type test for hit-test consumers and an interactive-element metadata test that fails when `InteractiveElementType` grows without a matching metadata arm. Decide whether future-marked element types such as `sparkline-edit` and `hyperlink` are active public contracts or should be removed until implemented.

10. Harden runtime defaults.

   Freeze or deep-freeze public default objects where safe, or add a resolver that always clones before mutation. Add tests proving a consumer cannot mutate `DEFAULT_CHROME_THEME` or `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` and affect later renderer resolutions. Validate colors, opacity, dimensions, zoom ranges, and shimmer durations in contract tests.

11. Promote scheduler and invalidation contracts.

   Expand `RenderScheduler` and `LayoutInvalidationMode` documentation into tests that bind the public contract to `grid-canvas` behavior. If `invalidateCells`, `markCellsDirty`, and layout updates have different dirty scopes, name those scopes explicitly. The contract should make scroll, structural layout, geometry, cell, theme, and object-scene invalidation distinct.

12. Update production consumers deliberately.

   After the contract changes, update `grid-canvas`, `grid-renderer`, SheetView, spreadsheet renderer/input/coordinator systems, kernel workbook APIs, and print/export imports to use the explicit public leaf modules. Remove deep imports into private type shards from production consumers where public contracts should be the boundary. Do not add compatibility imports; update the call sites directly.

13. Refresh public docs and snapshots.

   Update renderer docs to reflect the actual public contract layout, public coordinate factories, source-of-truth ownership, multi-region rect behavior, and data-source/update semantics. Regenerate API snapshots only after reviewing the intended public diff.

## Tests and verification gates

Required focused tests to add during implementation:

- Rendering contract inventory test: every exported rendering symbol has a source, owner, public module, and runtime/type-only disposition.
- Export parity tests: root `@mog-sdk/contracts/rendering` and leaf subpaths export the intended symbols and no private type-shard runtime values.
- Runtime parity tests for constants, `RenderPriority`, `LayerName`, chrome theme, shimmer defaults, and SheetView skin defaults across `contracts`, `types/rendering`, and `types/viewport` where mirrors remain.
- Public coordinate factory tests for branded point/rect construction, zero runtime overhead shape, and compatibility with `CoordinateSystem` methods.
- `RenderContextConfig` exhaustiveness test covering every key, default, clear semantics, owner data source, and invalidation disposition.
- Hit-test union exhaustiveness tests, including outline gutter, hidden row/column boundary, floating object regions, fill handle, select-all, and comment indicator cases.
- Interactive element metadata exhaustiveness tests for each `InteractiveElementType`.
- Default immutability/resolution tests for `DEFAULT_CHROME_THEME`, `DEFAULT_SHIMMER_CONFIG`, and `DEFAULT_RESOLVED_SHEET_VIEW_SKIN`.
- External fixture tests that import rendering runtime values from the public package and from each new public leaf subpath.

Verification commands for the implementation workstream:

- `cd mog/contracts && pnpm test`
- `cd mog/contracts && pnpm typecheck`
- `cd mog/types/rendering && pnpm typecheck`
- `cd mog/types/viewport && pnpm typecheck`
- `cd mog/canvas/grid-canvas && pnpm test`
- `cd mog/canvas/grid-canvas && pnpm typecheck`
- `cd mog/canvas/grid-renderer && pnpm test`
- `cd mog/canvas/grid-renderer && pnpm typecheck`
- `cd mog/views/sheet-view && pnpm test`
- `cd mog/apps/spreadsheet && pnpm test` for renderer/input/coordinator contract changes.
- `cd mog && pnpm check:contracts-runtime-inventory`
- `cd mog && pnpm check:api-snapshots`
- `cd mog && pnpm check:external-fixtures -- --skip-build` after public artifacts are built by the normal publish-readiness flow.
- `cd mog && pnpm typecheck` for TypeScript contract or cross-package caller changes.

UI-facing contract changes must also be exercised in the browser through the production spreadsheet path. Use real mouse, keyboard, pointer, and clipboard inputs for hit testing, selection, scrolling, freeze panes, split panes, object movement, inline editing, and copy/paste visual feedback. Do not verify renderer behavior by directly mutating private state.

## Risks, edge cases, and non-goals

Risks:

- Changing public leaf exports can expose accidental API snapshot churn. The inventory must separate intended public modules from private shard implementation details before package metadata changes land.
- Removing broad barrel behavior can break internal imports that relied on root re-export drift. Fix those call sites directly and intentionally.
- Parity tests can reveal that contracts and private type shards already disagree on runtime values. Resolve the source-of-truth conflict rather than adding tolerance.
- Freezing public defaults can break code that mutates imported defaults. That mutation is a bug, but production callers should be updated in the same workstream.
- Adding coordinate factories as public runtime values increases the contracts runtime surface. Keep them pure, tiny, and contracts-owned.
- Multi-region rect contracts can change overlay anchoring where old code silently used the first or bounding rect. Add explicit primary-rect APIs for callers that truly need one anchor.
- Clear semantics for `RenderContextConfig` can surface stale-reader bugs in `grid-canvas` or SheetView. Treat those as production bugs, not compatibility requirements.

Edge cases to cover:

- Node, browser, Tauri, and test environments for `DEFAULT_COL_WIDTH` platform detection.
- Fractional zoom, high-DPR canvas, hidden row headers, hidden column headers, and outline gutters.
- Frozen rows, frozen columns, frozen corner, split panes, overlay viewports, and ranges spanning multiple regions.
- Hidden rows/columns adjacent to resize handles and merged cells.
- Sheet switch with stale binary readers, stale scene graph entries, and late async object bounds.
- Page break preview dragging across hidden rows/columns and print areas.
- RTL sheets and culture/theme changes while a renderer is active.
- Public consumers creating branded coordinates without private helpers.
- Mutating default skin/theme objects before creating a renderer.
- Newly added hit-test or interactive-element union members without public exports.

Non-goals:

- Do not edit renderer implementations just to optimize tests; any implementation follow-up must target the production `grid-canvas` and `grid-renderer` path.
- Do not add dependencies from `mog` to `mog-internal`.
- Do not expose `@mog/types-rendering` or `@mog/types-viewport` as public runtime packages.
- Do not preserve ambiguous optional-field behavior behind compatibility shims.
- Do not redesign the spreadsheet UI or renderer visuals beyond what is needed to make contracts truthful.
- Do not replace `@mog/canvas-engine`, `@mog/grid-canvas`, or `@mog/grid-renderer`; this plan strengthens the contracts they already implement.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the rendering contract inventory exists.

- Agent A: build the export/source-of-truth inventory, explicit root barrel, package subpath updates, package inventory updates, and API snapshot expectations.
- Agent B: add runtime parity tests for constants/defaults/enums and fix drift between `contracts`, `types/rendering`, and `types/viewport`.
- Agent C: implement public coordinate factories and update public docs plus internal boundary imports.
- Agent D: define `RenderContextConfig` field dispositions and update `grid-canvas` context routing tests to match.
- Agent E: align data-source DTOs with render-context DTOs and update `grid-renderer`/`grid-canvas` type usage.
- Agent F: fix hit-test and interactive-element exhaustiveness exports and update consumers.
- Agent G: update external fixtures, runtime inventory, API snapshots, and public package readiness gates.
- Agent H: run production browser verification through SheetView and the spreadsheet app after contract consumers are updated.

Dependencies:

- The inventory should land first; every other slice depends on knowing which symbols are public, private, runtime, or type-only.
- Runtime parity and runtime inventory work should land before package subpath expansion so public runtime values do not leak from private shards.
- Coordinate factory changes can run in parallel with render-context disposition work because they touch different contract leaves.
- `RenderContextConfig` disposition work should land before data-source DTO alignment so caller updates have one final patch semantics model.
- Hit-test and interactive-element exhaustiveness can run independently, but API snapshot updates should wait until all export changes are complete.
- Browser verification depends on consumer updates in `grid-canvas`, `grid-renderer`, SheetView, and spreadsheet systems.
