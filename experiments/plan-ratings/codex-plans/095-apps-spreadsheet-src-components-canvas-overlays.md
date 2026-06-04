# 095 - Apps Spreadsheet Canvas Overlays Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/components/canvas-overlays`

Queue item: 95

Scope reviewed:

- `CanvasInteractiveOverlay.tsx`, which subscribes to `ISheetViewInteractiveElements` and renders DOM hit targets over canvas-painted filter buttons, checkbox cells, comment indicators, and validation dropdown affordances.
- `CheckboxOverlay.tsx`, `CommentIndicatorOverlay.tsx`, `FilterButtonOverlay.tsx`, and `ValidationDropdownOverlay.tsx`, the current type-specific DOM triggers for canvas interactive elements.
- `OutlineToggleOverlay.tsx`, the independent DOM hit-target layer for outline level buttons and row/column grouping +/- toggles.
- `form-controls/*`, the visible HTML overlay layer for worksheet form controls: checkbox, button, combo box, and list box controls anchored to cells.
- `HarnessOverlayMirrors.tsx`, an app-eval DOM mirror for canvas-only validation circles and flash-fill previews that is mounted from `chrome/layers/OverlayLayer.tsx`.
- Mounting and adjacent contracts in `components/grid/SpreadsheetGrid.tsx`, `components/grid/layout/OverlayLayers.tsx`, `hooks/view/use-interactive-element-positions.ts`, `hooks/shared/use-grid-mouse.ts`, `views/sheet-view`, `types/rendering`, and `canvas/grid-renderer/src/cells/interactive-elements.ts`.

Adjacent production folders that must be considered during implementation:

- `mog/canvas/grid-renderer/src`, because it emits interactive element bounds and owns the canonical painted geometry for checkboxes, filter buttons, comments, validation indicators, and outline controls.
- `mog/views/sheet-view/src` and `mog/types/rendering/src`, because they publish the public `ISheetViewInteractiveElements` and `InteractiveElementInfo` contracts consumed by this folder.
- `mog/apps/spreadsheet/src/components/grid`, because it mounts the overlay layers and owns grid focus, scrollbars, editor overlays, and layout ordering.
- `mog/apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts` and `src/hooks/grid-mouse/use-cell-interaction.ts`, because legacy canvas click paths still overlap with some DOM overlay responsibilities.
- `mog/apps/spreadsheet/src/systems/grid-editing`, `src/components/filter`, `src/components/comments`, and Worksheet form-control APIs, because overlays should dispatch production actions rather than own business logic.

This is public Mog source work in `../mog`. The planning artifact stays only in `mog-internal`.

## Current role of this folder in Mog

`components/canvas-overlays` bridges canvas rendering with browser-native DOM interaction. The canvas renderer paints fast visual affordances, while this folder creates the real DOM inputs, buttons, popovers, focus targets, and accessible surfaces that canvas pixels cannot provide.

Observed production roles:

- `CanvasInteractiveOverlay` renders a viewport-relative overlay container offset by row and column headers. It relies on `ISheetViewInteractiveElements` snapshots emitted after render frames.
- The standard interactive element overlays are intentionally thin wrappers around production behavior: filter buttons open `FilterDropdownContent`, checkbox cells call `coordinator.grid.toggleCheckbox`, comment indicators signal the comment actor and hover coordinator, and validation dropdowns currently show a placeholder list.
- `OutlineToggleOverlay` is a separate canvas-origin overlay because outline gutters live before row/column headers. It recomputes outline button rects from grouping state, renderer geometry, and constants that mirror `canvas/grid-renderer/src/features/outline-renderer.ts`.
- `FormControlLayerContainer` uses a document-space model: it resolves form controls from `Worksheet.formControls`, converts cell anchors to document-space coordinates by adding scroll position, and keeps the layer aligned during scroll through an imperative `translate3d`.
- Individual form controls are visible HTML controls, not invisible triggers. Their linked cells are the value source of truth.
- `HarnessOverlayMirrors` is not part of the user interaction path. It exposes selected canvas-only states to app-eval through invisible DOM sentinels.

The main opportunity is to turn these overlay families into explicit contracts instead of parallel ad hoc coordinate, event, accessibility, and dispatch rules. The folder is already close to the right architectural shape, but it has important contract gaps: accessibility is hidden by `aria-hidden` ancestors, focus outlines are invisible when the target is fully transparent, validation dropdown selection is a placeholder, outline geometry duplicates renderer logic, form-control resolution is async and sequential, and legacy mouse paths still overlap with DOM overlay ownership.

## Improvement objectives

1. Define one typed overlay contract per coordinate space: cell-viewport interactive elements, canvas-origin gutter elements, document-space form controls, and page/fixed popovers.
2. Make canvas renderer emission and DOM overlay placement share canonical geometry rather than duplicating constants and offset math in React.
3. Complete DOM overlay ownership of interactive canvas affordances so filter, checkbox, comment, validation dropdown, and outline controls dispatch through exactly one production path.
4. Replace invisible-but-inaccessible targets with native DOM controls that remain keyboard reachable, screen-reader visible, and visibly focused without changing canvas visuals during normal idle state.
5. Finish validation dropdown overlays as real cell mutation UI, not a placeholder that logs selections.
6. Make form controls robust across scroll, zoom, hidden rows/columns, merged cells, sheet switches, linked-cell edits, large item ranges, and async races.
7. Standardize event isolation and focus restoration for every overlay that opts out of grid pointer handling through `data-no-grid-pointer`.
8. Separate production DOM overlay responsibilities from eval-only DOM mirrors so test observability does not shape the interaction architecture.
9. Preserve high-frequency render performance by avoiding unnecessary React rerenders on scroll/render frames and by diffing overlay snapshots before updating state.

## Production-path contracts and invariants to preserve or strengthen

- Canvas remains the visual source for grid affordances unless the feature is explicitly a visible HTML form control. DOM triggers should align with canvas visuals; they should not paint competing default UI.
- `ISheetViewInteractiveElements` is the source of visible per-cell interactive element snapshots. Its bounds must declare their coordinate space by contract and must be valid for the mounted overlay container without caller-side inference.
- Coordinate spaces must be branded or otherwise explicit:
  - cell viewport coordinates for regular canvas interactive elements after headers;
  - canvas viewport coordinates for outline gutters and header-adjacent controls;
  - document/grid-content coordinates for scroll-transformed form controls;
  - page coordinates for fixed or portal popovers.
- Header visibility, row/column header sizes, outline gutters, frozen panes, split panes, zoom, device pixel ratio, fractional pixels, hidden rows/columns, and scroll position must not introduce manual offset guesses in overlay code.
- Event ownership must be single-path. When a DOM overlay owns a click, the native grid pointer listener must ignore it, and the canvas hit-test path must not also dispatch a duplicate action.
- Overlay controls that can receive focus must not sit inside `aria-hidden="true"` ancestors. If a target is keyboard focusable, its focus state must be visible even when the idle visual is transparent.
- Grid focus and shortcut behavior remain coordinator-owned. Overlays may opt out of grid pointer handling, but they must define whether focus stays in the grid, moves into a popover/control, or returns to the grid after close/commit.
- Worksheet, coordinator, and state-machine APIs remain the source of mutations. Overlay components should not parse or mutate workbook state directly except through public Worksheet/coordinator commands.
- Form-control linked cells are the single source of truth for form-control values. Overlay local state may only represent transient UI state such as an open combo box.
- Async resolution of form-control anchors, linked cells, and dynamic item ranges must be sheet-scoped and generation-scoped. Late results from a previous sheet, scroll model, or control revision must be discarded.
- App-eval mirrors must not become a second production state path. If DOM sentinels are required for product observability, define them as a separate non-interactive observability contract; otherwise keep them out of production overlay architecture.

## Concrete implementation plan

1. Add an overlay contract inventory.

   Create a test-backed inventory for every overlay family in this folder. For each entry, record owner component, source state, coordinate space, mount point, z-index/layer ordering, event ownership, accessibility role, focus policy, mutation target, and verification coverage. The inventory should fail when a new interactive element type, form-control type, or overlay coordinate space appears without an explicit disposition.

2. Strengthen the public interactive element contract.

   Update `types/rendering`, `contracts/rendering`, and `views/sheet-view` so `InteractiveElementInfo` includes enough metadata for app overlays to avoid inference:

   - explicit `coordinateSpace`;
   - `sheetId` for every element type, including filter buttons;
   - row/col and stable cell identity where applicable;
   - optional viewport/pane identifier when frozen or split panes can expose multiple visible rects;
   - action semantics or target identity that lets the app dispatch without reconstructing state.

   Keep the app and renderer on one direct contract. Do not add compatibility shims around stale element shapes.

3. Create shared overlay geometry primitives.

   Add a small production helper layer in the spreadsheet app or shared sheet-view package with branded coordinate types and conversion helpers. It should expose primitives such as `ViewportOverlayRect`, `CanvasOverlayRect`, `DocumentOverlayRect`, and `PageOverlayAnchor`, plus helpers for applying header/gutter offsets and scroll transforms.

   Replace inline `left/top/width/height` calculations in `CanvasInteractiveOverlay`, `OutlineToggleOverlay`, and `FormControlLayerContainer` with these primitives. The intent is not a cosmetic refactor; it is to make it impossible to position a DOM overlay in the wrong coordinate space without a type/test failure.

4. Move outline geometry to a canonical renderer-owned source.

   `OutlineToggleOverlay` currently mirrors renderer constants and math. Replace that with either:

   - a renderer/sheet-view capability that emits outline interactive elements with the same geometry used for painting; or
   - a shared public `computeOutlineControlRects` helper used by both canvas rendering and DOM overlays.

   Cover row and column outline level buttons, +/- toggles, summary-before/summary-after settings, hidden headers, hidden grouped rows/columns, collapsed groups, scroll, zoom, and split/frozen panes. Once the DOM path covers all outline inputs, remove duplicate outline dispatch from the canvas mouse path.

5. Extract reusable DOM hit-target components.

   Introduce a small set of primitives such as `CanvasOverlayButton`, `CanvasOverlayCheckbox`, and `CanvasOverlayPopoverTrigger`. They should centralize:

   - absolute positioning from typed rects;
   - `data-no-grid-pointer`;
   - pointer and keyboard event isolation;
   - visible focus ring behavior without idle visual noise;
   - `aria-label`, `aria-haspopup`, `aria-expanded`, and disabled/protected state;
   - focus return on close or commit.

   Replace the repeated invisible button/input style blocks in checkbox, comment, filter, validation, and outline overlays with these primitives.

6. Fix accessibility of overlay containers and transparent targets.

   Remove `aria-hidden="true"` from any ancestor of focusable controls. Use presentational wrappers or `role="presentation"` where needed, but keep children in the accessibility tree.

   Replace `opacity: 0` on focusable targets with an approach that preserves focus visibility, such as transparent backgrounds/borders with an explicit focus pseudo-visual, or a separate focus proxy outline. Add accessible names that use user-facing A1-style references where possible, and ensure `aria-expanded`/`aria-checked` states update for popovers and checkboxes.

7. Complete validation dropdown production behavior.

   Replace `ValidationDropdownPlaceholder` with a real validation list picker:

   - resolves and displays all list-validation options through the same validation/data model used by the renderer;
   - supports keyboard navigation, mouse selection, typeahead/search where Excel parity requires it, Escape/Tab/Enter behavior, and focus return;
   - writes the selected value through Worksheet/coordinator mutation APIs;
   - respects sheet protection, read-only state, blank allowance, dynamic ranges, hidden rows/columns in the source range, and large option sets;
   - closes or repositions correctly on scroll, sheet switch, row/column resize, and validation rule changes.

   Remove console logging and artificial option truncation from the production path.

8. Unify interactive overlay dispatch with grid mouse behavior.

   Define an `OverlayInteractionDispatcher` that routes overlay clicks to the same production commands used by grid input:

   - checkbox cell toggle and selection/undo semantics;
   - comment indicator click and hover state;
   - filter dropdown open/close and active filter state;
   - validation dropdown commit;
   - outline level collapse and group toggle.

   Then remove duplicate legacy click branches from `use-cell-interaction` and `use-grid-mouse` for the interactions now fully owned by DOM overlays. Keep canvas hit testing only for interactions that still require pixel-region handling.

9. Harden filter popover anchoring and dragging.

   Keep the real DOM trigger approach, but move popover open state, drag offset, and close-on-identity-change behavior behind a tested helper. The helper should key state by sheet/filter/header cell, clamp drag bounds against viewport edges, stop pointer leaks into the grid, restore focus on close, and avoid stale drag listeners after unmount.

   Verify the popover remains aligned after horizontal/vertical scroll, header visibility changes, zoom, filter state changes, and sheet switches. Avoid reliance on timing hacks or virtual anchors.

10. Rework form-control resolution and rendering.

   Turn `FormControlLayerContainer` into a generation-scoped form-control adapter:

   - batch anchor, linked-cell, and dynamic item-range reads instead of resolving each control sequentially;
   - subscribe to all structural events that can move controls: row/column insert/delete, hide/show, resize, sheet switch, zoom, merged cells, view options, scroll model changes, and form-control z-index changes;
   - resolve anchors through a typed geometry API that knows whether a control should use anchor cell size, configured control size, merged-cell bounds, or a range anchor;
   - discard stale async results by sheet id and control revision;
   - virtualize or cap DOM work for very large dynamic list sources while preserving full selection semantics.

   Keep visible HTML form controls as the production surface, but make their styling, focus, keyboard behavior, disabled state, and event isolation consistent.

11. Normalize form-control value semantics.

   Move form-control value conversion into pure helpers with tests:

   - checkbox truthy/falsey handling, `checkedValue`, `uncheckedValue`, and indeterminate/missing linked-cell behavior;
   - button `setValue`, `increment`, `decrement`, `toggle`, disabled macro-only behavior, and undo description;
   - combo box and list box selected-index/value behavior, duplicate item labels, empty values, and dynamic range updates.

   All writes should go through Worksheet/coordinator APIs with protection checks and undo integration, not direct component-local assumptions.

12. Separate eval mirrors from production overlays.

   Do not expand `HarnessOverlayMirrors` as a production improvement. Either move it to a dedicated app-eval observability mount or promote the needed DOM sentinels to a named, non-interactive production observability layer with explicit tests for no pointer, focus, layout, or accessibility impact.

   Validation circles and flash-fill previews should still be verified through production-rendered state. The mirror must never become the source of truth for behavior.

13. Improve render-frame performance.

   `useInteractiveElementPositions` currently updates React state whenever the capability publishes a new array. Add structural diffing keyed by element id, type, bounds, and metadata so unchanged snapshots do not rerender overlays. Preserve microtask batching from the collector, but avoid per-frame React churn when scroll or render invalidation does not change visible elements.

   For overlays that move frequently, prefer container transforms or renderer-emitted rect updates over recomputing React trees. Measure in the production grid, not a synthetic harness.

14. Update production callers directly.

   When the overlay contract, renderer emission, sheet-view capability, grid mouse path, or Worksheet form-control API changes, update the production callers in the same workstream. Remove stale comments about future cleanup once duplicate paths are gone. Do not leave old and new overlay APIs side by side.

## Tests and verification gates

Required focused gates for implementation:

- `pnpm --filter @mog/app-spreadsheet test -- src/components/canvas-overlays src/hooks/view/use-interactive-element-positions.ts`
- `pnpm --filter @mog/app-spreadsheet test -- src/components/__tests__/overlay-canvas-offset-lint.test.ts src/components/__tests__/overlay-coordinate-conversion.test.ts`
- `pnpm --filter @mog/grid-renderer test -- src/cells/interactive-elements.test.ts`
- `pnpm --filter @mog-sdk/sheet-view test -- src/capabilities/interactive-elements.ts`
- `pnpm --filter @mog/app-spreadsheet typecheck`

Run repo-level `pnpm typecheck` when the work changes public contracts in `types/rendering`, `contracts/rendering`, `views/sheet-view`, Worksheet APIs, or coordinator types.

Focused unit and integration tests to add:

- Interactive element contract mapping for filter, checkbox, comment indicator, validation dropdown, future unknown types, sheet ids, coordinate spaces, and metadata exhaustiveness.
- Overlay geometry helpers for header visibility, outline gutters, zoom, fractional pixels, scroll, hidden rows/columns, frozen panes, split panes, and merged/range anchors.
- React overlay rendering with mocked `ISheetViewInteractiveElements`: no focusable child under `aria-hidden`, visible focus indicator, correct `aria-*` state, stable keys, and snapshot diffing.
- Overlay dispatcher tests for checkbox toggle selection/undo semantics, comment click/hover, filter open/close, validation selection write, and outline level/group actions.
- Form-control adapter tests for anchor resolution, linked-cell reads/writes, dynamic item ranges, stale async cancellation, control events, z-index ordering, disabled/protected behavior, and large item sources.
- Accessibility tests for tab order, labels, focus return, screen-reader-visible targets, and controls that are visually transparent while idle.

Production-path browser/app-eval scenarios must use real UI input:

- Click a canvas-painted filter button and verify the real filter popover opens, can be dragged, filters values, closes on Escape/outside click, and does not trigger grid selection.
- Click and keyboard-toggle a canvas-painted checkbox cell; verify cell value, selection, undo, focus, and grid shortcut behavior.
- Hover and click a comment indicator; verify hover affordance and comment popover state without direct actor mutation.
- Open a validation dropdown from a cell, select by mouse and keyboard, verify Worksheet value changes, protected cells do not mutate, and focus returns correctly.
- Toggle row and column outline level buttons and +/- controls through DOM buttons, then verify canvas grouping state and visible rows/columns.
- Insert and interact with checkbox, button, combo box, and list box form controls; verify linked-cell writes, dynamic items, scroll alignment, and no grid pointer leakage.
- Scroll, zoom, resize rows/columns, hide/show headers, freeze/split panes, and switch sheets while overlays are open or focused; verify alignment and cleanup.

UI implementation should also be exercised manually in a browser through the spreadsheet dev server because this folder is a DOM/canvas alignment surface.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Public contract changes across `types/rendering`, `contracts/rendering`, `views/sheet-view`, and app overlays must be integrated atomically or TypeScript will accept stale partial behavior only at the cost of casts.
- Popover triggers are real DOM elements, but popover content may portal outside the grid. Page/container coordinate mistakes can reappear if helpers do not make the boundary explicit.
- Frozen and split panes can make one logical cell visible in more than one rect. The plan should define whether each interactive element emits one target per visible rect or one canonical target.
- Fully transparent focusable controls are easy to make inaccessible. Visual focus must be verified in browser, not assumed from class names.
- Form-control dynamic ranges can be large and can contain duplicate or blank values. Virtualization must not change selection semantics.
- Removing legacy canvas click paths before DOM overlays cover every case would regress mouse users. The transition should be contract-driven: prove coverage, then remove duplicate path.
- Harness mirrors are useful for evals, but treating them as production overlays would hide bugs in the real canvas/DOM interaction path.

Non-goals:

- Rewriting the canvas renderer, grid selection system, filter engine, comments state machine, or Worksheet form-control storage outside the changes required to expose correct overlay contracts.
- Optimizing app-eval mirrors or adding test-only DOM handles as a substitute for production input coverage.
- Creating compatibility wrappers for old interactive element shapes once the public contract is corrected.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contract inventory is written.

- Agent A: renderer and sheet-view contract work in `types/rendering`, `contracts/rendering`, `views/sheet-view`, and `canvas/grid-renderer/src/cells/interactive-elements.ts`.
- Agent B: app overlay primitives, accessibility fixes, snapshot diffing, and standard interactive overlays in `components/canvas-overlays`.
- Agent C: outline geometry capability/helper plus removal of duplicate outline canvas mouse dispatch.
- Agent D: form-control adapter, value helpers, dynamic item-range resolution, and form-control tests.
- Agent E: validation dropdown production implementation and filter/comment/checkbox dispatcher integration with grid-editing systems.
- Agent F: browser/app-eval scenarios and accessibility verification through real UI input paths.

Integration dependencies:

- Contract work must land before app components can stop inferring coordinate spaces and sheet identity.
- Duplicate mouse path removal should wait until browser coverage proves DOM overlays own the interaction family.
- Form-control changes depend on Worksheet form-control API behavior and renderer geometry events.
- Accessibility and focus fixes should be integrated with grid keyboard/focus coordination so shortcut behavior remains deliberate.
