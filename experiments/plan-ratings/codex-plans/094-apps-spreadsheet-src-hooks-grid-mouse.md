# 094 - Spreadsheet Grid Mouse Input Path Improvement Plan

## Source folder and scope

Source folder: `mog/apps/spreadsheet/src/hooks/grid-mouse`

Required public scope: pointer, drag, hover, double-click, and context-menu input paths for the spreadsheet grid.

Files inspected in the target folder:

- `index.ts`: barrel export for extracted grid-mouse types, helpers, and hooks.
- `types.ts`: public hook options, return type, context-menu payload, and `GridMouseEvent`.
- `use-cell-interaction.ts`: cell-local click and double-click behaviors for comment indicators, checkboxes, validation dropdowns, sparklines, editor entry, and word selection.
- `use-context-menu-handler.ts`: right-click target classification for cells, row headers, column headers, selections, and floating objects.
- `use-cursor-manager.ts`: direct DOM cursor updates and cursor priority for ink, format painter, object interaction, selection drag, fill handle, validation, hyperlink, and resize affordances.
- `use-formula-range-drag.ts`: formula reference box hit testing, drag preview state, and commit of updated formula references by CellId.
- `use-warp-adjust-interaction.ts`: exported warp-handle drag primitive for TextEffect objects.
- `helpers/click-detection.ts`: hit boxes for filter buttons, validation dropdowns, comment indicators, and selected row/column expansion helpers.
- `helpers/cursor-position.ts`: text cursor placement from a click coordinate.
- Existing tests under `grid-mouse/__tests__` and `grid-mouse/helpers/__tests__`.

Production neighbors inspected because they compose or constrain this folder:

- `mog/apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts`: the current 2,139-line production `useGridMouse` hook that imports the target folder and still owns most routing, native pointer listeners, pending drag refs, table hit logic, page-break routing, range-picker routing, and double-click handling.
- `mog/apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`: the grid component that creates `useGridMouse`, wires context menus, clipboard events, hyperlink hover/click, comments, grouping, sparklines, input handlers, and renderer dependencies.
- `mog/apps/spreadsheet/src/systems/input/coordination/pointer-capture-coordination.ts` and `systems/input/input-system.ts`: coordinator-owned pointer capture and input routing infrastructure.
- `mog/apps/spreadsheet/src/hooks/shared/__tests__/use-grid-mouse-scrollbar.test.ts`: tests that mirror scrollbar guard code outside the production hook.

The inspected area is about 8.6k lines including the target hooks, helpers, tests, the composed production hook, and the scrollbar guard test. The target folder itself is not yet the full owner of grid mouse behavior; it is an extracted helper package consumed by `hooks/shared/use-grid-mouse.ts`.

This plan targets production paths only. It does not propose test-only fixes, compatibility shims, benchmark-only changes, or temporary reduced-scope work.

## Current role of this folder in Mog

`grid-mouse` is the partially extracted mouse interaction layer for the spreadsheet grid. It provides the typed support code used by `useGridMouse`, but the production input lifecycle is still split across this folder, `hooks/shared/use-grid-mouse.ts`, `systems/input`, object interaction, grid-editing selection/editor actors, Radix context menus, canvas overlays, and renderer hit-test capabilities.

The current production flow is roughly:

- `SpreadsheetGrid.tsx` calls `useGridMouse(...)` from `hooks/shared/use-grid-mouse.ts`.
- `useGridMouse` registers native `pointerdown`, `pointermove`, `pointerup`, and `pointercancel` listeners on the grid container.
- Those native listeners normalize focus, skip `[data-no-grid-pointer]` overlays, guard scrollbar regions, special-case right-click fill handle, special-case native double-click on cells, set the active pointer id, and delegate to `handleMouseDown` or `handleMouseMove`.
- `handleMouseDown` routes by priority through object insertion and object hit tests, page-break preview, range-picker selection, object deselection, grouping outlines, table resize handles, formula range boxes, cells, headers, frozen top-left selection, resizers, and hidden row/column boundaries.
- Cell handling then layers triple-click text selection, format painter, hyperlink activation, editing interception, comment/checkbox/validation handlers, table header/corner/total/row handling, fill handle, selection-border drag, and normal selection.
- `handleMouseMove` owns hover, page-break drag, range-picker drag, object drag, object cursor feedback, header resize, table resize, formula range drag, cursor feedback, validation dropdown cursor lookup, hyperlink tooltip hover, fill drag, right-fill drag, cell drag/drop, and selection drag.
- `useContextMenuHandler` owns the Radix-compatible right-click path for cells/headers/selections and delegates floating-object context menus.
- `useCursorManager` writes cursors directly to the DOM for performance and returns a React fallback cursor.

The folder already encodes several correct architectural decisions:

- It uses `@mog-sdk/sheet-view` geometry and hit-test capabilities rather than direct renderer internals in many paths.
- It keeps high-frequency drag state in refs instead of React state.
- It delegates durable selection/editor mutations to selection hooks, coordinator methods, dispatch actions, and Worksheet/Workbook APIs.
- It intentionally lets Radix handle default context-menu positioning when a grid context menu should open.
- It keeps raw pointer modifier keys intact so selection machines can combine them with mode flags.
- It routes floating objects before grid cells because objects render above cells.
- It treats formula range drag as a production formula-editing gesture, not a visual-only overlay.

The main problem is that these contracts are implicit and scattered. The target folder has extracted hooks, but no single contract for event phases, pointer ownership, hit priority, coordinate spaces, async side effects, or cursor/action consistency. This makes future input work risky because a change can make the cursor say one thing while pointerdown does another, let stale async hover updates overwrite a newer cursor, or make a unit test pass while the production native listener path still fails.

The current tests also do not fully prove the production path:

- `use-context-menu-handler.test.ts`, `use-cursor-manager.test.ts`, and `use-formula-range-drag.test.ts` exercise real hooks and helpers.
- `use-cell-interaction.test.ts` mostly asserts expected constants and narrative behavior rather than rendering the hook against mocked workbook/coordinator/editor dependencies.
- `benchmarks.test.ts` contains local stubs for timing helpers and reports zero-like stats in places; it is not a reliable production performance gate.
- `hooks/shared/__tests__/use-grid-mouse-scrollbar.test.ts` mirrors the scrollbar guard logic in a synthetic listener instead of mounting the production hook/listener path.

## Improvement objectives

1. Make `grid-mouse` the explicit owner of grid mouse input routing.

   Move the production mouse router out of `hooks/shared/use-grid-mouse.ts` into the `grid-mouse` folder and make `useGridMouse` a composed, folder-local feature hook. `hooks/shared` should stop being the place where new pointer routing logic accumulates.

2. Define a typed pointer lifecycle contract.

   Encode pointer phases, native listener preprocessing, focus rules, scrollbar guards, overlay opt-outs, pointer capture, cancellation, mouse leave, and pending operation cleanup in source-level contracts that implementation and tests share.

3. Establish one hit-priority matrix.

   Replace the current comment-driven ordering with a data-backed priority contract for object hits, page breaks, range-picker mode, outlines, table handles, formula range boxes, cell-local affordances, fill handles, selection borders, headers, hidden boundaries, and default selection.

4. Unify cursor affordances with pointer actions.

   The same hit classification and tolerance constants must drive cursor feedback and pointerdown behavior. There should be no dead zone where the cursor shows move/copy/resize/pointer but pointerdown selects or edits something else.

5. Make async input effects generation-safe.

   Validation dropdown cursor lookup, page-break hit testing, table hit reads, comment CellId resolution, formula CellId conversion, hyperlink/cell hover callbacks, and editor-dependent paths should not apply stale results after the sheet, pointer position, editor session, or active mode changes.

6. Turn cell interaction into a real event-claiming contract.

   Cell-local handlers need to say whether they handled, claimed asynchronously, or ignored an event. A validation dropdown click should not fall through to unrelated selection or editing behavior just because the picker open path is asynchronous.

7. Complete formula range drag across production viewport modes.

   Formula reference drag should be correct for zoom, scroll, frozen panes, split panes, cross-sheet formulas, sheet switching during edit, pointer cancel, and async CellId failures. The current synthesized hit-test region documents that frozen-pane awareness is not handled in the hook.

8. Resolve warp-adjust ownership.

   `use-warp-adjust-interaction.ts` is exported from `grid-mouse`, while the object interaction machine and object hook also contain warp-adjust concepts. Decide one production owner: either route warp-adjust pointer gestures through `grid-mouse` into the object interaction machine, or remove the duplicate hook from this folder's public surface after moving any needed logic into the object system.

9. Replace snippet and narrative tests with behavior gates.

   Tests should mount or call the same router/listener/hook paths that production uses. E2E coverage must drive real pointer, keyboard, and context-menu input through the UI instead of direct state mutation.

10. Keep high-frequency pointer performance explicit.

   Cursor updates and pointermove routing should remain direct and allocation-conscious, but performance tests must measure production routing units or realistic mounted hooks rather than local stubs.

## Production-path contracts and invariants to preserve or strengthen

- Source boundary: public Mog code stays in `mog`; internal planning stays in `mog-internal`. `mog` must not depend on `mog-internal`.

- Capability boundary: grid mouse routing uses SheetView geometry and hit-test capabilities, Worksheet/Workbook APIs, coordinator methods, selection/editor hooks, and dispatch actions. It should not deep-import renderer internals just to make pointer code convenient.

- Native pointer path: primary grid mouse input goes through native pointer listeners registered by the production hook. React synthetic handlers remain return values for compatibility with component props and fallback paths, but correctness must be proven on the native pointer path.

- Overlay opt-out: any DOM overlay with `[data-no-grid-pointer]` owns its pointer behavior. Native listeners must continue to honor this opt-out because React `stopPropagation()` cannot block the native listener timing.

- Scrollbar guard: pointerdown and pointermove inside the vertical or horizontal scrollbar region must not trigger cell selection, selection extension, drag/drop, or hover side effects.

- Focus guard: pointerdown should focus the grid container for shortcuts when not editing. While editing, pointerdown must not steal focus from the inline editor; it should prevent browser focus theft so formula reference insertion and edit interception remain possible.

- Button contract: left button owns normal grid gestures; right button owns context menu and right-fill-handle drag; other buttons should not start grid selection. Right-click fill-handle behavior must still prevent the browser menu only when the right-drag operation starts.

- Pointer capture: active pointer id must be set before drag states that require capture. Selection and object drag states continue to drive capture via `PointerCaptureManager`. Pointer cancel, window blur, mouse leave, and unmount release or cancel active operations deterministically.

- Hit priority: floating objects and object insertion remain above cell interactions. Page-break handles in page-break preview remain above normal grid selection. Range-picker mode captures grid clicks before normal selection. Formula range boxes capture formula-editing drags before normal cell selection. Fill handles and selection borders keep their Excel-like precedence over normal selection.

- Coordinate spaces: client coordinates, container-relative viewport coordinates, data-layer coordinates, cell-local coordinates, and screen coordinates are distinct types or explicitly named structures. Header offsets, scroll, zoom, frozen panes, and split panes must not be mixed by ad hoc `{ x, y }` values.

- Selection modifiers: raw `shiftKey`, `ctrlKey`, and `metaKey` pass through unchanged to selection/grid-editing machines. The hook does not pre-apply mode flags; machines compose modifiers with mode state.

- Editor interception: clicking another cell while editing must route through `coordinator.grid.handleCellClick(...)` synchronously before any awaited work. Formula editing uses clicks to insert or update references; regular editing commits and then moves selection according to the grid-editing contract.

- Hyperlink contract: plain click can activate hyperlinks through `onHyperlinkClick`; modified clicks should not. Hyperlink cursor and tooltip are based on the visible cell under the latest pointer position and must not survive after pointer leaves or moves to another cell.

- Comment contract: hover goes through comment-hover coordination; comment indicator click resolves CellId through Worksheet API and sends the comment actor event for the clicked cell. Stale async CellId resolution should not open a popover for a cell/sheet no longer targeted by the current pointer action.

- Validation dropdown contract: the dropdown indicator is only active for the active cell and only if the cell has list/date validation. Pointerdown on the indicator should claim the event before asynchronous picker work so the grid does not also perform an unrelated selection/edit action.

- Checkbox contract: checkbox clicks use coordinator/Worksheet-backed checks and set selection to the toggled cell only after a successful toggle.

- Context menu contract: Radix must receive unprevented native `contextmenu` events when a grid or object menu should open. The hook prevents the browser menu only when there is no Mog menu target or the target is outside supported grid areas. Right-clicking inside a multi-cell selection keeps the selection; right-clicking outside updates selection first. Row/column header context menus keep existing selection only for full-row/full-column selections that include the target.

- Double-click contract: native double-click and React double-click paths should not double-handle the same cell. Column/row border double-click auto-fit, fill-handle double-click fill, selection-border double-click edge jump, hidden-boundary double-click unhide, object double-click editing, sparkline editing, and cell edit entry keep their existing semantics.

- Formula range drag contract: range boxes only intercept refs belonging to the visible sheet or the formula origin sheet as appropriate. Cross-sheet refs must not consume clicks intended to add a new reference on another sheet. Drag completion updates formulas by CellId, not unstable row/col text, and cancels cleanly if CellIds cannot be resolved.

- Cursor contract: ink cursor has highest priority, then format painter, active object operations, object hover, active drag cursors, resize/fill/selection affordances, validation/hyperlink pointer, and default. Direct DOM cursor updates remain the high-frequency path. Debug `console.log` statements do not belong in cursor computation.

- Table contract: table header, corner, data-left-edge, total row dropdown, and resize handle behavior should share one table hit model between pointerdown, double-click, cursor feedback, and tests. Async table reads must not race with pointer movement or sheet changes.

- Cleanup contract: pointercancel, pointerup, mouseleave, unmount, sheet switch, and editor exit clear pending refs for page-break drag, range-picker drag, formula drag, format painter target, table click selection, and cursor hover when those refs no longer apply.

## Concrete implementation plan

### 1. Create grid-mouse contracts and routing types

Add source-local contracts under `apps/spreadsheet/src/hooks/grid-mouse` and make them implementation inputs, not documentation-only:

- `event-types.ts`: `GridPointerPhase`, `GridPointerButton`, `GridPointerModifiers`, `GridPointerEventInfo`, `GridContextMenuEventInfo`, `GridDoubleClickEventInfo`, and `GridEventClaim`.
- `coordinate-space.ts`: typed helpers for `clientToViewportPoint`, `viewportToCellLocalPoint`, scrollbar region checks, screen position calculation, and header/data area offsets.
- `hit-priority.ts`: a declarative ordered list of routable hit categories and the preconditions for each category.
- `routing-result.ts`: a discriminated union for `handled`, `claimedAsync`, `ignored`, `cancelled`, and `deferToBrowser`, plus side-effect command types.
- `input-mode-snapshot.ts`: a single snapshot shape for editing state, object operation state, selection drag state, format painter, ink mode, page-break mode, range-picker mode, and active sheet identity.

These contracts should be imported by `useGridMouse`, sub-hooks, and tests. The goal is to make the input layer explainable by types and test cases rather than by reading 2,000 lines of branch ordering.

### 2. Move production `useGridMouse` ownership into the target folder

Move the implementation from `apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts` into `apps/spreadsheet/src/hooks/grid-mouse/use-grid-mouse.ts` as part of the same production change that updates imports and exports. Do not keep two owners of the hook.

After the move:

- `hooks/index.ts` exports `useGridMouse` from `./grid-mouse`.
- `hooks/shared` no longer owns mouse routing logic.
- The existing `grid-mouse/index.ts` exports `useGridMouse`, `UseGridMouseOptions`, and `UseGridMouseReturn` from the folder-local implementation.
- Any shared helper that truly belongs outside mouse routing moves to an appropriate shared folder only if another production owner needs it.

This is a structural change, not a path compatibility exercise. The public behavior stays the same, but new mouse behavior should land in `grid-mouse`, not in `hooks/shared`.

### 3. Extract native pointer listener lifecycle

Create `use-grid-pointer-listeners.ts` inside `grid-mouse` to own the native listener setup currently embedded near the bottom of `use-grid-mouse.ts`.

The extracted hook should take stable callbacks and explicit dependencies:

- container ref
- pointer capture manager container setter
- active pointer id setter
- editor snapshot getter
- scrollbar guard helper
- overlay opt-out predicate
- left/right button handlers
- pointermove handler
- pointerup cleanup handler
- pointercancel cleanup handler

It should preserve:

- `[data-no-grid-pointer]` opt-out
- edit-mode focus preservation
- grid focus when not editing
- scrollbar guard
- right-click fill-handle start
- native double-click cell handling
- active pointer id assignment before drag-producing routing
- pointerup and pointercancel cleanup order
- listener removal on unmount

Tests should mount this hook or a thin component using this hook. The current scrollbar test that mirrors snippet logic should be replaced with a production listener test so drift is impossible.

### 4. Build a pure routing layer and an effect executor

Split route decision from effect execution:

- `routePointerDown(snapshot, hit, geometry, eventInfo) -> GridMouseRouteResult`
- `routePointerMove(snapshot, hit, geometry, eventInfo) -> GridMouseRouteResult`
- `routePointerUp(snapshot, eventInfo) -> GridMouseRouteResult`
- `routeDoubleClick(snapshot, hit, geometry, eventInfo) -> GridMouseRouteResult`
- `routeContextMenu(snapshot, hit, eventInfo) -> GridMouseRouteResult`

Route functions should classify the input and return explicit commands such as:

- `StartObjectDrag`
- `StartPageBreakDrag`
- `UpdateRangePickerSelection`
- `ToggleOutlineGroup`
- `StartTableResize`
- `StartFormulaRangeDrag`
- `InterceptEditorCellClick`
- `ActivateHyperlink`
- `OpenComment`
- `ToggleCheckbox`
- `OpenValidationPicker`
- `SelectCell`
- `SelectRow`
- `SelectColumn`
- `StartFillHandleDrag`
- `StartCellDrag`
- `StartHeaderResize`
- `UnhideHiddenBoundary`
- `OpenContextMenu`
- `ResetCursor`

The executor should be the only layer that calls coordinator methods, dispatch, Worksheet APIs, UI store actions, object interaction, or DOM cursor writes. This keeps branch ordering testable without mocking the whole app, while preserving the real production side effects.

For async commands, the executor should attach a generation token containing sheet id, pointer sequence id, editor session identity when relevant, and current pointer target. When the async result resolves, it applies only if the token still matches.

### 5. Define and enforce the hit-priority matrix

Create a table-driven priority contract with tests for every branch:

1. Overlay opt-out and scrollbar rejection.
2. Object insertion and floating object hit.
3. Page-break handles in page-break preview mode.
4. Dialog/range-picker selection mode.
5. Object deselection on empty grid click.
6. Grouping outline buttons.
7. Table resize handle.
8. Formula range box/handle.
9. Cell-local editor/formula interception.
10. Format painter target selection.
11. Hyperlink activation.
12. Comment indicator.
13. Checkbox.
14. Validation dropdown.
15. Table header/corner/row/total interactions.
16. Fill handle.
17. Selection border drag or edge jump.
18. Normal cell/header selection.
19. Header resize and hidden boundary actions.
20. Empty/unsupported area.

The pointerdown route and pointermove cursor route should consume the same hit model and tolerance values. Tests should assert both the action and cursor for the same coordinates.

### 6. Consolidate table pointer handling

Move the local table hit region logic currently embedded in `use-grid-mouse.ts` into a grid-mouse module such as `table-hit-routing.ts`, or into a table feature module if a better production owner already exists.

The table hit module should expose:

- A sync path for cached table ranges used by cursor feedback and resize handle checks.
- An async Worksheet API path for authoritative table metadata when a click needs column names, total functions, or current table identity.
- A single `TablePointerRegion` enum used by pointerdown, double-click, cursor feedback, tests, and table selection dispatch.
- Cache invalidation tied to table layout updates, active sheet changes, and workbook mutations rather than only an effect that lists tables on sheet change.

The implementation should preserve the current delayed table click selection behavior: header/corner/data-left-edge selection is staged on pointerdown and only dispatched on pointerup if the pointer did not move beyond the drag threshold.

### 7. Strengthen cell interaction outcomes

Refactor `useCellInteraction` around explicit outcomes:

```ts
type CellInteractionOutcome =
  | { kind: 'ignored' }
  | { kind: 'handled' }
  | { kind: 'claimedAsync'; promise: Promise<void> };
```

Use this outcome for comment, checkbox, validation dropdown, and future cell-local affordances. `handleCellClick` should claim the validation dropdown event synchronously once the click is in the active cell's dropdown hit box, then perform picker/edit startup asynchronously with generation checks and protection-alert handling.

Also make word-boundary logic testable without narrative placeholder tests:

- Export pure word-boundary helpers from a local helper file, or test through the hook with real editor action mocks.
- Include punctuation, whitespace, unicode-ish text if the editor supports it, formulas, rich text display text, and empty values.
- Keep cell edit entry using `ViewportBuffer.editText` and formula fallback behavior.

### 8. Make cursor management deterministic

Refactor `useCursorManager` into two layers:

- A pure `resolveCursor(snapshot, hitAffordance) -> CursorStyle | undefined`.
- A DOM writer with last-written cursor tracking.

Remove debug `console.log` calls from cursor computation. Add tests for priority and for no redundant DOM writes when the cursor value has not changed.

For async cursor producers:

- Page-break cursor lookup should not set a resize cursor if a newer pointermove has left the page-break target.
- Validation dropdown cursor lookup should not set pointer if a newer pointermove targets another cell or the dropdown items resolve after the active cell changes.
- Hyperlink and validation cursor paths should not race with `resetCursor`.

Add a generation token per pointermove or a small cursor request id in the cursor executor.

### 9. Complete formula range drag production behavior

Upgrade `useFormulaRangeDrag` so it uses the same rendered-region model as the formula range overlay. The current synthetic region preserves prior main-pane behavior, but production needs explicit support for:

- frozen panes
- split panes
- zoom
- header visibility
- scroll offsets
- multiple visible regions
- cross-sheet formula editing
- active sheet switching while editing
- pointercancel and mouseleave cancellation
- CellId lookup failures

The formula drag API should return a command/outcome instead of directly mutating cursor and storing all state internally. The drag state can remain in refs for performance, but start/move/end/cancel should participate in the shared pointer lifecycle cleanup.

On drag completion:

- Resolve start/end CellIds with the active editor session and sheet generation.
- Update formula only if the editor session and active formula range index still match.
- Surface failures through the same error/notification path used by other grid-editing async failures rather than silently dropping them.

### 10. Resolve warp-adjust integration

Audit TextEffect warp-adjust production behavior across:

- `grid-mouse/use-warp-adjust-interaction.ts`
- `hooks/objects/use-object-interaction.ts`
- `systems/objects/machines/object-interaction-machine.ts`
- object render hit regions

Then make one owner explicit.

Preferred path: object interaction remains the state-machine owner for warp-adjust, while `grid-mouse` routes pointer hits on `warp-adjust` regions into object interaction commands. If `useWarpAdjustInteraction` is redundant after that, remove it from `grid-mouse` exports and keep pure geometry helpers only if the renderer or object system uses them.

Required behavior gates:

- Hovering the warp handle shows `ns-resize`.
- Pointerdown starts warp adjustment without selecting the underlying cell.
- Pointermove previews without committing.
- Pointerup commits once.
- Pointercancel/mouseleave clears preview and does not commit.
- Switching selected object during drag cancels or commits according to the object interaction contract.

### 11. Rebuild tests around production behavior

Replace weak tests with behavior tests that use the real modules:

- `use-cell-interaction.test.ts`: render the hook with mocked Workbook, Worksheet viewport, coordinator, editor actions, selection commands, active cell, and UI store. Assert comment, checkbox, validation picker, sparkline double-click, edit entry, protection alert, and word selection effects.
- `use-grid-pointer-listeners.test.ts`: mount the listener hook and fire real `PointerEvent`s for scrollbar rejection, overlay opt-out, focus preservation, right-fill-handle start, double-click native handling, pointercancel cleanup, and listener cleanup.
- `grid-mouse-router.test.ts`: test the hit-priority matrix with pure route inputs and expected commands.
- `cursor-routing.test.ts`: assert cursor/action consistency for resize, hidden boundaries, fill handle, selection border, validation dropdown, hyperlink, table resize, object handles, format painter, and ink mode.
- `formula-range-drag.test.ts`: add frozen/split/zoom/cross-sheet/session-stale/cancel cases, not only main-pane A1/B2 cases.
- `context-menu-handler.test.ts`: keep Radix default-prevention tests and add object fallback, empty area, sheet switch, full-row/full-column selection preservation, and keyboard context-menu dispatch if that path targets this hook.
- Replace `benchmarks.test.ts` stubs with a real microbenchmark-style unit that measures production pure route functions and DOM cursor writes, or move benchmark reporting to a non-gating perf harness. Do not keep tests that always return zero-like stats.

### 12. Add real UI input gates

Add or update app-level scenarios that drive the visible spreadsheet UI with real input events:

- drag-select cells with mouse and touch-like pointer tolerance
- fill-handle drag and right-drag
- cell drag/drop with copy modifier and invalid target cursor
- double-click fill handle
- double-click selection border to jump to data edge
- column/row resize and double-click auto-fit
- hidden row/column boundary unhide
- right-click cell, selection, row header, column header, and floating object
- formula range insertion and formula range drag, including cross-sheet references
- validation dropdown click on active cell
- checkbox click
- hyperlink hover/click
- comment indicator hover/click
- table header/corner/data-left-edge/total-row interactions
- page-break drag in page-break preview mode
- object drag/resize/rotate and TextEffect warp adjustment
- scrollbar track/thumb pointerdown/move rejection
- overlay clicks marked `[data-no-grid-pointer]`
- editing mode click interception and formula reference insertion without editor blur

These tests must use browser-level pointer, mouse, keyboard, context-menu, and clipboard paths. They should not call coordinator methods or mutate stores directly to reach a target condition.

## Tests and verification gates

The implementation should run the smallest relevant gates first, then broaden before declaring done.

Required local gates for TypeScript and unit behavior:

- `pnpm --filter @mog/app-spreadsheet test -- src/hooks/grid-mouse src/hooks/shared/__tests__/use-grid-mouse-scrollbar.test.ts`
- `pnpm --filter @mog/app-spreadsheet test -- src/components/grid src/systems/input src/systems/objects`
- `pnpm --filter @mog/app-spreadsheet typecheck`

Required broader gates after moving the production hook or changing exports:

- `pnpm typecheck`
- `pnpm --filter @mog/app-spreadsheet test`
- Any existing publish/readiness gate that covers app package exports if `hooks/index.ts` or public package entrypoints change.

Required UI gates:

- Run the spreadsheet dev server and exercise the affected flows in a browser.
- Run the relevant app-eval or Playwright scenarios for mouse, pointer, context-menu, formula editing, tables, objects, page breaks, and overlays.
- Any new E2E tests must use real UI input paths. Direct state mutation is not a valid proof for this folder.

Performance gates:

- Pointermove route and cursor resolution should be measured on production routing functions, not local stubs.
- Verify no React render loop is introduced during pointermove, drag, or hover. Cursor writes should remain direct DOM writes or otherwise be proven render-isolated.
- Confirm async cursor generation checks do not create unbounded promises during rapid pointermove.

Manual verification checklist:

- Cursor affordance and click action match at boundaries for fill handle, selection border, row/column resize, hidden boundaries, table resize, validation dropdown, hyperlink, and object handles.
- Active editor focus is preserved while clicking formula references.
- Pointercancel and mouseleave leave no stuck cursor, stuck drag, pending table click, pending range-picker drag, pending formula drag, or pending format painter target.
- Right-click context menus open at the native pointer position and retain Radix positioning behavior.
- Drag operations still complete when the pointer leaves the grid container through pointer capture.

## Risks, edge cases, and non-goals

Risks:

- Moving `useGridMouse` ownership can expose hidden import cycles between `hooks/shared`, `grid-mouse`, `systems/grid-editing`, `coordinator`, and components. Resolve cycles by extracting pure contracts or pushing side effects to existing coordinator boundaries, not by adding workaround imports.
- Changing pointer routing can subtly reorder Excel-like behaviors. The priority matrix and E2E scenarios must lock down current intended behavior before refactoring large branches.
- Async table, validation, page-break, comment, and formula CellId work can race with pointer movement, sheet switch, and editor exit. Generation checks are required, not optional.
- Radix context menu behavior depends on `preventDefault`; over-eager prevention will stop menus from opening, while under-prevention can show the browser menu in unsupported areas.
- Direct DOM cursor writes are intentionally used for performance. Replacing them with React state would regress high-frequency pointermove behavior unless proven otherwise.
- Formula range drag coordinate fixes can break existing main-pane behavior if coordinate spaces are not typed and tested.
- Object, ink, format painter, and TextEffect modes all compete for cursor and pointer ownership. Their priority must be explicit.
- Tests that mount production hooks may require better mocks for Workbook, Worksheet, SheetView capabilities, UI store, and coordinator actor access.

Edge cases to include in implementation and tests:

- Touch pointer tolerance versus mouse/pen tolerance for selection border.
- `metaKey` on macOS as copy/additive modifier equivalent where current behavior expects it.
- Pointerdown with active inline editor, including formula mode, edit mode, and picker/autocomplete ownership.
- Double-click where native pointerdown handles the cell and React double-click later fires for the same coordinates.
- Cross-sheet formulas with unqualified refs from the formula origin sheet and qualified refs on the visible sheet.
- Hidden rows/columns at resize boundaries.
- Frozen top-left select-all region.
- Split/frozen panes where the same logical cell may have different rendered regions.
- Table total-row dropdown clicks near validation/comment/checkbox affordances.
- Empty grid areas, headers hidden by view options, and scrollbars.
- Unmounted container or null SheetView capabilities during async work.
- Object insertion mode, selected object deselection, and click on a diagram object.

Non-goals:

- Do not optimize a benchmark-only or test-only route. Performance work must target the production pointermove/cursor path.
- Do not bypass selection/editor/object state machines to make pointer tests easier.
- Do not add compatibility shims that preserve two independent `useGridMouse` implementations.
- Do not introduce dependencies from public `mog` code to `mog-internal`.
- Do not rewrite unrelated keyboard, clipboard, renderer, or object systems except where their existing public contracts are necessary for grid mouse routing.
- Do not convert canvas-rendered affordances into DOM overlays unless the production design explicitly calls for DOM ownership, as filter buttons already did.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the route/result contracts are defined.

Suggested parallel slices:

- Agent A: Contract and router extraction. Own `event-types.ts`, `coordinate-space.ts`, `hit-priority.ts`, `routing-result.ts`, and pure route tests.
- Agent B: Native pointer lifecycle. Own `use-grid-pointer-listeners.ts`, scrollbar/overlay/focus/right-click/double-click/cancel tests, and removal of snippet-mirroring tests.
- Agent C: Cell/context/formula interactions. Own `useCellInteraction` outcomes, context-menu target tests, formula range drag coordinate/session/cancel behavior, and async generation checks.
- Agent D: Cursor and performance. Own pure cursor resolver, DOM writer, async cursor request generation, removal of debug logging, cursor/action consistency tests, and real production microbenchmarks.
- Agent E: Object/table/page-break integration. Own table hit routing, page-break generation-safe cursor/drag, object priority, and warp-adjust ownership with object-system tests.
- Agent F: UI verification. Own app-eval/Playwright scenarios that drive real browser input for the matrix above.

Dependencies and coordination points:

- `apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts`: current production owner to move or dissolve.
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`: creates `useGridMouse` and supplies callbacks for hyperlink, context menu, grouping, sparklines, comment click, and container ref.
- `apps/spreadsheet/src/systems/input`: pointer capture, panning, focus, and active pointer id.
- `apps/spreadsheet/src/systems/grid-editing`: selection/editor actors, drag/drop, fill handle, resize, table selection, formula range picking, and edit interception.
- `apps/spreadsheet/src/systems/objects` and `hooks/objects`: floating object hit priority, object drag/resize/rotate, diagram click/double-click, TextEffect editing, and warp adjustment.
- `apps/spreadsheet/src/components/canvas-overlays`: DOM overlays that use `[data-no-grid-pointer]`, including filter and validation-related overlays.
- `@mog-sdk/sheet-view` and `@mog/grid-renderer`: geometry, hit testing, formula range hit testing, selection/fill/table affordance helpers, and text measurement.
- `mog-internal/dev/app-eval` or the active browser scenario harness: real UI input verification.

The first implementation dependency is the shared route/result contract. After that lands, pointer lifecycle, cursor routing, cell/context/formula behavior, and UI scenarios can proceed in parallel without each agent editing the same large production hook at the same time.
