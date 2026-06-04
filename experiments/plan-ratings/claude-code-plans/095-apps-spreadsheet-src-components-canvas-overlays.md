# 095 — Make the Canvas Overlay Layer Correct, Aligned, and Accessible

## Source folder and scope

- **Source folder:** `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/components/canvas-overlays`
- **Package:** `@mog/spreadsheet` (the desktop spreadsheet app, `mog/apps/spreadsheet`).
- **In scope (10 files, ~860 LOC):**
  - Top level: `index.ts`, `CanvasInteractiveOverlay.tsx` (factory/container), `CheckboxOverlay.tsx`, `CommentIndicatorOverlay.tsx`, `FilterButtonOverlay.tsx`, `ValidationDropdownOverlay.tsx`, `OutlineToggleOverlay.tsx`, `HarnessOverlayMirrors.tsx`.
  - `form-controls/`: `index.ts`, `FormControlLayerContainer.tsx`, `FormControlLayer.tsx`, `CheckboxOverlayControl.tsx`, `ButtonOverlayControl.tsx`, `ComboBoxOverlayControl.tsx`, `ListBoxOverlayControl.tsx`.
- **Out of scope (non-goals):**
  - The canvas renderer geometry these overlays mirror (`canvas/grid-renderer/src/features/outline-renderer.ts`, `views/sheet-view` interactive-element collectors). Changes there are coordinated dependencies, not edits owned by this folder (see Parallelization).
  - The `ISheetViewInteractiveElements` capability contract in `mog/views/sheet-view/src/public-types.ts` — referenced as an invariant, extended only where this plan calls for new element metadata.
  - The legacy `FilterDropdown.tsx` and `FilterDropdownContent.tsx` under `components/filter/` (separate folder).
  - The `coordinator.grid` / worksheet `formControls` business logic in `systems/grid-editing` and `types/api` — invoked, not rewritten.

This is a planning artifact in `mog-internal`. It references public source by path only; no internal terminology is introduced into the public `canvas-overlays` source.

## Current role of this folder in Mog

The grid renders cells, filter buttons, checkboxes, comment triangles, validation-dropdown carets, and outline gutters to a single `<canvas>` for speed. Canvas pixels cannot be DOM nodes, but Radix popovers, screen readers, keyboard focus, touch handling, and the Playwright app-eval harness all require real DOM. This folder is the **DOM overlay bridge**: it paints invisible, pixel-aligned, `pointer-events: auto` DOM elements on top of the canvas at the exact positions the renderer drew the interactive visuals, and routes interaction back into the coordinator/worksheet.

Three structurally distinct overlay subsystems live here, mounted in three places:

1. **`CanvasInteractiveOverlay`** (mounted in `components/grid/SpreadsheetGrid.tsx:981`) — subscribes via `useInteractiveElementPositions(rendererActions.getInteractiveElements())` and dispatches per element `type` to `CheckboxOverlay`, `CommentIndicatorOverlay`, `FilterButtonOverlay`, `ValidationDropdownOverlay`. Container is offset by `headerOffset` so child bounds are in cell-viewport space. The capability emits positions each render frame; the hook (`hooks/view/use-interactive-element-positions.ts`) is an observer with a snapshot default — no per-frame polling in React.
2. **`OutlineToggleOverlay`** (mounted in `SpreadsheetGrid.tsx:991`) — a parallel DOM input layer for the row/column grouping gutter. It **re-derives** the renderer's outline geometry client-side (`computeOutlineRects`, mirroring `outline-renderer.ts`) and dispatches the **same** grouping actions the canvas hit-tester in `use-grid-mouse.ts` already dispatches. The canvas hit-tester remains live, so both layers fire (documented as acceptable because the actions are idempotent).
3. **`form-controls/FormControlLayerContainer`** (mounted via `components/grid/layout/OverlayLayers.tsx:91`) — resolves `ws.formControls.list()` anchors to pixel positions and renders visible (not invisible) Excel-style checkbox/button/comboBox/listBox controls in document space, scroll-synced by an imperative CSS `translate3d` transform. The linked cell is the single source of truth for each control's value.
4. **`HarnessOverlayMirrors`** — invisible, zero-size, `aria-hidden` DOM shadows of canvas-only surfaces (validation circles, flash-fill ghost preview) that exist solely so the app-eval harness can `querySelectorAll` rendered state.

The folder's named theme — "DOM overlay alignment and interactive controls" — makes **pixel alignment with the canvas** and **faithful interaction routing** its two load-bearing correctness properties.

### Observed defects and risks from this pass

- **D1 — `ValidationDropdownOverlay` ships a non-functional placeholder.** `ValidationDropdownOverlay.tsx:90-146` renders `ValidationDropdownPlaceholder`, whose select handler is a `console.log` with `// TODO: Wire this to actual cell mutation` and `// Future: Mutations.setCellValue(...)`. A fully-built, keyboard-navigable, type-ahead data-validation picker already exists at `components/grid/ValidationDropdown.tsx`. So a user clicking a validation caret in the grid gets a dead list that logs to the console and never writes the cell. This is a shipped-but-broken production path, not a stub behind a flag.
- **D2 — Focusable children under an `aria-hidden` container are invisible to assistive tech.** `CanvasInteractiveOverlay`'s container sets `aria-hidden="true"` (`CanvasInteractiveOverlay.tsx:92`) and `OutlineToggleOverlay`'s container sets `aria-hidden="true"` (`OutlineToggleOverlay.tsx:219`), while their children are focusable `<button>`/`<input>` elements carrying carefully-written `aria-label`s. `aria-hidden` on an ancestor removes the entire subtree from the accessibility tree, so those labels are never announced and the focusable controls become "focusable but hidden" — an invalid-ARIA state. The folder's accessibility rationale (its whole reason for existing) is silently defeated.
- **D3 — Two scroll-sync strategies, one of them re-renders React every frame.** `FormControlLayerContainer` scrolls via imperative `translate3d` with zero React re-render (`FormControlLayerContainer.tsx:119-135`), but `OutlineToggleOverlay` (`:138-143`) and `ValidationCirclesMirror` (`HarnessOverlayMirrors.tsx:45-50`) force a full component re-render + geometry recompute on **every** `onScrollChange` tick via a `scrollTick` counter. During fast scroll with grouping or validation circles visible, this is a per-frame React render + `getGeometry()` sweep over all groups/cells.
- **D4 — `OutlineToggleOverlay` duplicates renderer geometry and double-dispatches.** `computeOutlineRects` re-implements outline-renderer pixel math (level-button corners, gutter offsets, summary-index resolution) in app code (`OutlineToggleOverlay.tsx:300-389`). Any change to `outline-renderer.ts` silently desyncs the DOM hit targets from the painted buttons (alignment regression). The component's own doc admits both the canvas hit-test and the overlay fire on one click and calls de-duplication "a future cleanup."
- **D5 — `FormControlLayerContainer` does N+1 sequential async cell lookups.** `resolveControlPositions` (`FormControlLayerContainer.tsx:195-302`) awaits `ws._internal.getCellPosition` per control for anchor and linked cell, then for comboBox/listBox dynamic ranges iterates `ws.getCell(row, col)` **cell-by-cell** in nested loops (`:293-299`). `getCellPosition` is per-call async (`types/api/src/api/worksheet/internal.ts:40`). For a sheet with many controls or large item ranges this is a serialized await chain on every refresh (and refresh fires on `cellChanged`, row/col resize, and every form-control event). Position resolution is also racy: a `cancelled` flag guards the final `setState`, but in-flight awaits keep running.
- **D6 — Massive duplication of the "invisible hit target" pattern.** `CheckboxOverlay`, `CommentIndicatorOverlay`, `FilterButtonOverlay` (trigger), `ValidationDropdownOverlay` (trigger), and both `OutlineToggleOverlay` button maps each hand-repeat the same inline style block (`position:absolute; opacity:0; cursor:pointer; pointerEvents:auto; border:none; background:transparent; padding:0; margin:0`) plus the same `data-no-grid-pointer` + focus-ring className. Five+ copies; any change to the hit-target contract (e.g. touch sizing, focus ring token) must be made in five places.
- **D7 — Hardcoded styling and brand references instead of design tokens.** `ButtonOverlayControl`, `ComboBoxOverlayControl`, `ListBoxOverlayControl` hardcode hex colors (`#ababab`, `#f0f0f0`, `#217346` "Excel green"), `Calibri` font, and inline SVG arrows, bypassing the `ss-*` design tokens used by the invisible overlays. These controls will not respond to theme/dark-mode and are visually inconsistent. Comments also reference the spreadsheet competitor by name ("Excel green", "approximate Excel appearance", "Matches Excel behavior") which violates the repo convention against naming it in source (memory: [[no-excel-in-code]]).
- **D8 — ComboBox is not keyboard-operable and uses fragile timing.** `ComboBoxOverlayControl` opens a custom div-listbox with `role="option"` items but no arrow-key navigation, no `aria-activedescendant`, and closes via `setTimeout(150)` on blur (`ComboBoxOverlayControl.tsx:79-82`) and per-item inline `onMouseEnter/Leave` background mutation. It is mouse-only and timing-dependent.
- **D9 — Declared element types are unhandled.** The capability type includes `'sparkline-edit'` and `'hyperlink'` variants (`views/sheet-view/src/public-types.ts`), but `InteractiveElementRenderer` only `console.warn`s for them (`CanvasInteractiveOverlay.tsx:123-134`). If the renderer ever emits them, they are dropped silently in prod.
- **D10 — Naming collision.** `CheckboxOverlay` (cell-rendered boolean checkbox, writes via `coordinator.grid.toggleCheckbox`) and `form-controls/CheckboxOverlayControl` (form-control object, writes a linked cell with `checkedValue`/`uncheckedValue`) are two different things one folder apart with near-identical names — a maintenance trap.

## Improvement objectives

1. **Make every overlay's interaction actually work end-to-end** — eliminate the dead `ValidationDropdownOverlay` placeholder and route validation selection to a real cell mutation using the existing picker UI.
2. **Restore accessibility** — overlays exist *for* a11y; fix the `aria-hidden`-over-focusables defect so labels are announced and the focus model is valid.
3. **Guarantee pixel alignment is single-sourced** — the DOM hit targets must derive from the same geometry the canvas paints, with a mechanism that fails loudly when the two drift, and the double-dispatch on the outline gutter must be resolved.
4. **Unify scroll synchronization** — one imperative, no-React-re-render scroll strategy across all overlay containers so scroll stays at 60fps regardless of which overlays are visible.
5. **Collapse duplication into shared primitives** — one `OverlayHitTarget` for invisible triggers and one positioning/coordinate convention, so the alignment + hit-target contract lives in exactly one place.
6. **Tokenize and de-brand the visible form controls** — drive styling from `ss-*` tokens (theme/dark-mode correct) and remove competitor-name references from source per repo convention.
7. **Make form-control position resolution efficient and race-free** — batch cell-position/value lookups and key the resolution so stale async results can never land.

## Production-path contracts and invariants to preserve or strengthen

- **Alignment is the contract.** DOM hit targets must occupy the same viewport rectangle the canvas painted the visual at. Today this holds for capability-emitted elements (bounds come from the renderer) but is *re-derived* for the outline gutter (D4). Strengthen: outline overlay must consume renderer-emitted geometry, not a parallel re-computation, OR a single shared geometry module must be the source for both paint and overlay.
- **Coordinate-space conventions per container.** `CanvasInteractiveOverlay` children are in cell-viewport space (container offset by `headerOffset`); `OutlineToggleOverlay` children are in canvas-origin space (gutters live before/above headers); `FormControlLayer` children are in document space (scroll handled by ancestor transform); `HarnessOverlayMirrors` uses page-fixed rects. These four conventions are real and must be preserved or explicitly documented in one shared module — never silently merged (the comment at `OutlineToggleOverlay.tsx:51-59` explains why a shared container would force invalid negative coordinates).
- **`pointer-events` discipline.** Containers are `pointer-events: none`; only interactive leaves opt back in with `pointer-events: auto`. This keeps canvas hit-testing working everywhere except over a live control. Must be preserved by any shared `OverlayHitTarget`.
- **`data-no-grid-pointer="true"`** on every interactive leaf is load-bearing: it tells grid `pointerdown` handling not to treat the click as a grid selection/commit (cf. memory: [[formula-edit-click-commits]]). Any new/refactored interactive element must carry it.
- **Linked cell is the single source of truth** for all form controls — render reads the cell, interaction writes the cell, never local state-of-record. Preserve through any resolution refactor.
- **Idempotent action routing.** Overlays must dispatch the *same* coordinator/worksheet actions the canvas path dispatches (`grid.toggleCheckbox`, comment actor `clickCell`, `groupingState.setLevelCollapsed/toggleGroupCollapsed`, `ws.setCell`). No business logic may be duplicated into overlays — they are input shims. Strengthen by removing the redundant canvas-side outline hit-test so there is one dispatch per click (D4).
- **Harness mirror stays in sync with what the renderer reads.** `HarnessOverlayMirrors` must read the same `UIStore` state the renderer reads (it does today) and must remain `aria-hidden`, zero-size, `pointer-events:none`, never affecting layout/hit-testing. Its `data-testid`/`data-row`/`data-col` contract is consumed by `getValidationCircles`/`getFlashFillPreviewCells` observers and must not change shape without updating those observers.
- **Stable `data-testid`s** (`column-filter-{col}`, `filter-dropdown-popover`, `outline-{axis}-toggle-{index}`, `form-control-{type}-{id}`, etc.) are an external contract with app-eval scenarios. Treat as API: do not rename without a coordinated harness update.

## Concrete implementation plan

### Phase 1 — Fix the broken validation dropdown (D1) [highest user-visible value]
1. Delete `ValidationDropdownPlaceholder` from `ValidationDropdownOverlay.tsx`. Render the real picker from `components/grid/ValidationDropdown.tsx` inside the `PopoverContent`, passing `cellId`, `row`, `col`, and `options` from `element.metadata`.
2. Wire selection to a real mutation: on select, write the chosen option to the cell via the coordinator (mirror how the in-grid validation path commits — reuse the existing setter the in-grid `ValidationDropdown` already calls; do not invent a new mutation entry point). Close the popover on commit.
3. If `components/grid/ValidationDropdown.tsx` is coupled to in-grid mount assumptions, extract its presentational core (list + type-ahead + keyboard nav) into a shared component both call sites consume, so there is one validation-list UI. (Coordinate with folder owning `components/grid`.)
4. Remove the `console.log`; keep the option-count cap behavior only if the real picker already virtualizes — otherwise rely on the picker's own scrolling.

### Phase 2 — Accessibility correctness (D2)
1. Remove `aria-hidden="true"` from the `CanvasInteractiveOverlay` and `OutlineToggleOverlay` **containers**. The container is decorative *layout*, but it wraps focusable, labeled controls — hiding it removes them from the a11y tree.
2. Replace with the correct pattern: container has `role="presentation"`/no role and is **not** aria-hidden; only genuinely non-interactive decorative wrappers get `aria-hidden`. Keep each interactive leaf's `aria-label`, `aria-haspopup`, `aria-expanded`.
3. Audit focus order: invisible hit targets are `position:absolute` with `opacity:0` — confirm they remain in DOM/tab order intentionally and add `tabIndex` review (filter/comment/validation triggers should be reachable; the harness mirror spans must stay out of tab order — they already have no tabindex and `pointer-events:none`).
4. Add `role="dialog"` wiring consistency where `aria-haspopup="dialog"` is declared (filter, comment) and `listbox` where declared (validation).

### Phase 3 — Shared overlay primitives (D6, D10)
1. Add an internal `OverlayHitTarget` component (new file in this folder) encapsulating the invisible-button contract: absolute positioning from a `bounds` prop, `opacity:0`, `pointerEvents:auto`, reset button styles, `data-no-grid-pointer`, and the focus-ring className. Render as `<button>` or `<input type=checkbox>` via a prop/`asChild`.
2. Refactor `CheckboxOverlay`, `CommentIndicatorOverlay`, `FilterButtonOverlay` trigger, `ValidationDropdownOverlay` trigger, and both `OutlineToggleOverlay` button maps to use it. The five duplicated style blocks collapse to one definition.
3. Resolve the naming collision (D10): rename `form-controls/CheckboxOverlayControl` usage to keep the "Control" suffix as the form-control object, and document in `index.ts` headers the difference (cell-checkbox vs form-control-checkbox). Keep public export names stable if anything outside the folder imports them — verify with a usage scan first.
4. Centralize coordinate-space conventions and shared inline-style constants in one small module (`overlay-geometry.ts`) with documented invariants (the four spaces from the invariants section), so future overlays pick the right container by reading one file.

### Phase 4 — Single-source geometry + de-duplicate outline dispatch (D4)
1. Replace `computeOutlineRects` re-derivation with renderer-emitted geometry. Preferred: extend the `ISheetViewInteractiveElements` capability to emit `outline-level-button` and `outline-toggle` element variants with bounds + group metadata, so `OutlineToggleOverlay` consumes the same emitted bounds as every other overlay (eliminates drift). Coordinate with the `views/sheet-view` + `canvas/grid-renderer` owners (Parallelization).
2. If (1) is staged later, the interim is to import the renderer's geometry helpers directly rather than re-implementing the math, so there is one arithmetic source.
3. Decommission the canvas-side outline hit-test in `use-grid-mouse.ts` / `coordinator.objects.hitTestOutline()` once the overlay covers every case, removing the double-dispatch. Gate this behind verification that the overlay handles all group/level/summary-position cases (touch, collapsed groups, hidden headers).

### Phase 5 — Unify scroll synchronization (D3)
1. Convert `OutlineToggleOverlay` and `ValidationCirclesMirror` from `scrollTick`-driven React re-render to the imperative `translate3d` transform model already proven in `FormControlLayerContainer`: position children once in document/scroll-invariant space and translate the container ref on `onScrollChange`.
2. Where geometry genuinely changes (not just scroll) — group collapse, resize, validation-circle set change — keep React re-render but trigger it from the *data* event, not the scroll event.
3. For elements that are scroll-invariant (outline level buttons in the corner) skip the transform entirely; only the per-group/per-cell anchored elements need it.

### Phase 6 — Efficient, race-free form-control resolution (D5)
1. Batch cell-position lookups: add/most-likely-already-exists a bulk `getCellPositions(cellIds[])` on the worksheet internal API (coordinate with `types/api` owner); resolve all anchors + linked cells for all controls in one round trip instead of N sequential awaits.
2. For comboBox/listBox dynamic ranges, read the item range with one range read instead of nested per-cell `getCell` loops.
3. Make resolution race-proof: key each async resolution run with an incrementing token (or `AbortController`) so a late-returning batch from a superseded run is discarded — the current `cancelled` boolean only guards the final `setState`, not interleaved partial state.
4. Keep the imperative-scroll transform; ensure refresh-triggering events (`cellChanged`, resize, form-control CRUD) remain wired (`FormControlLayerContainer.tsx:71-85`).

### Phase 7 — Tokenize and de-brand visible controls (D7, D8)
1. Replace hardcoded hex/font/SVG styling in `ButtonOverlayControl`, `ComboBoxOverlayControl`, `ListBoxOverlayControl` with `ss-*` design tokens / existing UI primitives so controls are theme- and dark-mode-correct.
2. Make `ComboBoxOverlayControl` keyboard-operable: arrow-key navigation, `aria-activedescendant`, Enter/Escape handling, and replace the `setTimeout(150)` blur-close with a focus-within / pointerdown-outside pattern. Prefer the shared Radix `Popover`/listbox primitives already used by `FilterButtonOverlay` and `ValidationDropdownOverlay` rather than a bespoke div-listbox.
3. Remove competitor-name references from comments and identifiers throughout the folder per repo convention (memory: [[no-excel-in-code]]) — describe behavior functionally ("checked when cell value is truthy", "default control chrome").

### Phase 8 — Handle or explicitly reject declared element types (D9)
1. Either implement `sparkline-edit` / `hyperlink` overlays, or — if the renderer never emits them yet — keep the `default` branch but make the unknown-type warning fire in all environments (not only `isDev`) behind a rate-limited logger so a real production emission is not swallowed silently.

## Tests and verification gates

- **Type/build gates (run by owner after edits; do not run here):** `pnpm --filter @mog/spreadsheet typecheck`; if the capability contract is extended, `pnpm --filter @mog-sdk/contracts build` (declaration rollup) before consumers typecheck (memory: [[mog-contracts-declaration-rollup]]); full app build.
- **app-eval scenarios** (the harness is the primary behavioral gate for this folder):
  - **Validation dropdown (new):** open a validation caret, select an option, assert the cell value is committed and the popover closes — covers D1 (currently no scenario can pass because the placeholder never writes).
  - **Filter button:** existing `column-filter-{col}` / `filter-dropdown-popover` open/clear scenarios (cf. pre-existing dirty `imported-autofilter-*` specs) must stay green; add a drag-handle reposition assertion.
  - **Outline toggle:** `outline-{axis}-toggle-{index}` and `outline-{axis}-level-{N}` click → collapse/expand; add a **single-dispatch** assertion after Phase 4 (state changes exactly once per click, not twice).
  - **Form controls:** checkbox toggle writes linked cell; button setValue/increment/decrement/toggle; comboBox/listBox selection writes linked cell; add keyboard-navigation assertion for comboBox (Phase 7).
  - **Harness mirrors:** `getValidationCircles`/`getFlashFillPreviewCells` observers keep returning correct `{row,col}` after the scroll-sync refactor (Phase 5) — these are the existing canvas-only mirror contracts.
- **Alignment regression gate (Phase 4):** a scenario that scrolls and resizes with grouping active and asserts the DOM toggle's bounding rect matches the painted button center within tolerance — this is what catches geometry drift mechanically instead of by eye.
- **Accessibility gate (Phase 2):** an axe/role assertion that the interactive overlay buttons are present in the accessibility tree with their `aria-label`s (would currently fail due to ancestor `aria-hidden`).
- **Scroll perf (Phase 3/5):** measure no React re-render of `OutlineToggleOverlay` during pure scroll (e.g. render-count probe); scroll stays 60fps with grouping + validation circles + form controls all visible.
- **Async-race gate (Phase 6):** rapidly fire form-control refresh events and assert the rendered controls match the latest state (no stale batch landing).

## Risks, edge cases, and non-goals

- **Capability-contract change (Phase 4 option 1)** is a cross-package change (`views/sheet-view` + `canvas/grid-renderer` + this folder). It is the correct production fix (single geometry source) but must be sequenced; the interim "import renderer helpers" step de-risks it.
- **Removing the canvas-side outline hit-test (Phase 4.3)** risks a coverage gap (collapsed groups, hidden headers, touch). Gate strictly behind scenario coverage of every case before deletion; keep both paths until the overlay is proven exhaustive — but do not leave double-dispatch as the permanent state.
- **`aria-hidden` removal (Phase 2)** could expose the invisible hit targets to screen-reader users as a flood of buttons. Mitigate with precise per-element labels (already present) and ensure non-interactive wrappers stay decorative; verify with a real AT pass, not just axe.
- **Tokenizing form controls (Phase 7)** changes pixel appearance — coordinate visual-diff baselines; the controls are *visible* (unlike the invisible overlays), so screenshots will move intentionally.
- **`data-testid` stability:** any rename breaks app-eval. Treat as a contract; if a rename is unavoidable, update scenarios in the same change set (the harness specs live in `mog-internal/dev/app-eval` — not edited by this worker, but flagged for the implementer).
- **Non-goals (explicit):** no test-only shims, no reduced-scope "leave the placeholder but hide it" for validation, no compatibility wrapper to keep both checkbox-overlay names — the plan removes the defect at its source. Not rewriting the legacy `FilterDropdown` (separate folder), the renderer, or the coordinator business logic.

## Parallelization notes and dependencies on other folders

- **Independent, can start immediately:** Phase 1 (validation wiring, modulo extracting the shared picker), Phase 2 (a11y), Phase 3 (shared primitives), Phase 5 (scroll unify within this folder), Phase 7 (tokenize/de-brand), Phase 8 (unknown types). These touch only this folder plus read-only reuse of `components/grid/ValidationDropdown.tsx`.
- **Cross-folder dependencies:**
  - **Phase 1.3** (extract shared validation picker) touches `components/grid` — coordinate with that folder's owner (queue item for `components/grid`, if any).
  - **Phase 4** (single-source outline geometry + de-dup dispatch) depends on `mog/views/sheet-view` (capability type), `mog/canvas/grid-renderer` (`outline-renderer.ts` geometry), and `apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts` + `coordinator.objects.hitTestOutline`. This is the most coupled phase — sequence after the others.
  - **Phase 6** (batch cell-position/range reads) depends on the worksheet internal API in `mog/types/api` (`worksheet/internal.ts`) and its kernel implementation — add `getCellPositions`/bulk range read there first.
- **Recommended order:** 2 → 3 → 1 → 7 → 5 → 8 (folder-local), then 6 (after API batch lands), then 4 (after capability + renderer coordination). Phases 2/3/7/8 can run concurrently across implementers since they touch disjoint files.
