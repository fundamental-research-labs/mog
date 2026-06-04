# 064 - Apps Spreadsheet Grid Component Tree Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/components/grid`

Queue item: 64

Scope: the spreadsheet app's main grid React component tree, including:

- `SpreadsheetGrid.tsx`, the app-level composition root for renderer lifecycle, input binding, render context wiring, scrollbars, overlays, editors, dialogs, tooltips, accessibility, and context menu mounting.
- `effects/*`, which bridge React state, workbook/worksheet APIs, coordinator state machines, renderer execution, sparkline/conditional-format/table integrations, input listeners, sheet switching, resize, visibility, and zoom.
- `editors/*`, `ValidationDropdown.tsx`, `DatePicker.tsx`, and `SliderEditor.tsx`, which own the in-cell DOM editing surfaces and picker overlays.
- `layout/*`, including custom scrollbars, split divider DOM overlays, status overlays, and overlay composition.
- `hooks/*` and `providers/*`, which adapt viewport data, search highlights, trace arrows, validation input messages, scroll dimensions, and print page-break data.
- `AccessibilityAnnouncer.tsx`, `InputMessageTooltip.tsx`, `HyperlinkTooltip.tsx`, `PasteOptionsButton.tsx`, and dialog wrappers that expose canvas state through DOM and assistive surfaces.

Adjacent production folders that must be considered, but are not the write scope for this folder-specific plan:

- `mog/apps/spreadsheet/src/hooks`, especially grid mouse, keyboard, renderer actions/status, editor state/actions, scroll sync, and data cache hooks consumed by this folder.
- `mog/apps/spreadsheet/src/coordinator` and `mog/apps/spreadsheet/src/systems`, because this folder mostly registers capabilities and data-source callbacks into coordinator-owned state machines.
- `mog/apps/spreadsheet/src/components/canvas-overlays`, because `SpreadsheetGrid` mounts `CanvasInteractiveOverlay` and outline button overlays over canvas-rendered affordances.
- `mog/canvas/grid-canvas/src`, `mog/canvas/grid-renderer/src`, and `mog/views/sheet-view/src`, because this folder consumes renderer geometry, render context, viewport layout, binary readers, and invalidation contracts from those public packages.
- `mog/print-export`, because automatic page-break visualization currently adapts `ViewportReader` through `ViewportTableDataProvider`.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`components/grid` is the app-facing spreadsheet surface. It does not paint cells itself; it binds the React app, workbook APIs, coordinator state machines, and public canvas renderer packages into the user-visible grid experience.

Observed responsibilities:

- `SpreadsheetGrid.tsx` is the top-level grid surface. It subscribes to granular editor, renderer, input, grouping, workbook settings, view options, active sheet, remote cursors, sparkline, conditional-format, table, filter, hyperlink, object, and UI-store state, then mounts the canvas-adjacent DOM UI.
- `useRendererDependencies` gives the coordinator the active `ViewportReader`, sheet-aware cell callbacks, `SheetStateProvider`, total sheet bounds, initial scroll restoration, and InputCoordinator scroll reset callback.
- `useRenderContextConfig` registers the large callback surface used by render-context coordination: cell value/format, tables, filters, page breaks, sparklines, validation errors, floating objects, search highlights, grouping, formula trace arrows, paste/flash fill/table/font preview state, chart rendering, binary cell readers, and remote cursors. It also has direct `updateContext()` effects for floating objects, trace arrows, page breaks, shimmer state, and remote cursors.
- `useRendererLifecycle` and `useRendererSync` drive mount/layout readiness, ResizeObserver updates, visibility suspend/resume, sheet switching, zoom sync, scrollbar visibility resize, InputCoordinator dependencies, and cleanup.
- `useInputListeners` attaches native wheel/touch/keyboard listeners, including long-press context-menu support, because passive event control and global keyboard/pan behavior cannot be handled only through React synthetic events.
- `ScrollContainer` owns custom scrollbar UI and syncs the scroll physics bounds used by InputCoordinator. It uses continuous expansion based on current scroll position and viewport size.
- `SplitDividersLayer` reads computed `ViewportLayout.dividers` from the renderer and dispatches split-position changes after drag; `ScrollContainer` still renders "split view coming soon" split-box stubs even though split dividers now exist elsewhere.
- Inline editors are separate DOM overlays: plain textarea with WYSIWYG text positioning and IME handling, rich text contentEditable wrapper, slider editor, validation dropdown, and date picker. These use renderer geometry in both container-relative and page-relative modes.
- Tooltip and overlay components expose validation input messages, hyperlinks, paste options, chart DOM sentinels, pivot/slicer/form-control overlays, chart title editing, protection dialogs, validation dialogs, formula errors, toasts, and accessibility live regions.
- Existing local tests cover `AccessibilityAnnouncer` helper text, custom scrollbar continuous expansion, scrollbar click/selection isolation, and broader component-level overlay coordinate linting outside this folder. The folder does not yet have comparable contract coverage for the main grid composition surface, editor routing, async render-context refreshes, or real browser input flows.

The key improvement opportunity is to turn the current large React integration layer into explicit, typed, verifiable contracts. Lower-level renderer geometry and canvas orchestration are covered by adjacent plans; this folder should own the app-level contracts that decide which renderer callbacks exist, which DOM overlays mount, which user input path wins, and how async worksheet data is generation-scoped to the active sheet.

## Improvement objectives

1. Make `SpreadsheetGrid` a thin surface component over a typed `GridSurfaceRuntime` contract rather than a 1000-line mixed subscription, adapter, effect, callback, and render tree.
2. Replace the ad hoc render-context callback registration in `useRenderContextConfig` with an exhaustive typed registry that has one disposition for every renderer data source, direct push, async refresh, and dirty trigger.
3. Eliminate stale-sheet and stale-generation risks across async grid adapters: page breaks, print area, object bounds, search highlights, trace arrow positions, date-picker eligibility, validation input messages, table auto-expansion, and rich-text raw data.
4. Standardize DOM overlay anchoring into one contract: page-coordinate overlays use renderer page geometry; container-local inline editors use renderer viewport/container geometry plus the scroll-sync transform; frozen/split multi-rect cases are explicitly handled.
5. Turn the editor stack into an explicit editor-surface router so plain text, rich text, slider, dropdown, date picker, formula autocomplete, formula highlighting, formula-bar focus, IME composition, and merged-cell handling cannot render conflicting surfaces.
6. Finish split and scrollbar integration at the React boundary: remove stale split-box placeholders, route split creation/adjustment through the same split state and viewport layout contract, and keep InputCoordinator scroll bounds identical to the visible scrollbar model.
7. Remove untyped app-boundary casts and string parsing where public contracts exist, especially `any` coordinator options, actor refs, `sheetId as any`, regex A1 table range handling, and single-letter column increment logic.
8. Make render isolation measurable. `SpreadsheetGrid` should not re-render on high-frequency scroll, selection, cell cache updates, or editor cursor changes except through deliberately small child components.
9. Strengthen accessibility, tooltip, and DOM sentinel contracts so canvas-only state remains discoverable without duplicating production behavior through test-only APIs.

## Production-path contracts and invariants to preserve or strengthen

- `components/grid` remains a public app package folder and must not import `mog-internal` or private-only code.
- The folder composes public renderer packages; it must not reimplement cell painting, canvas layer ordering, viewport layout math, hit testing, binary-buffer parsing, or drawing object rendering.
- State machines and coordinator capabilities remain the source of user intent. React effects may register dependencies and mirror state into renderer context, but should not become independent business-logic owners.
- Renderer data callbacks must be sheet-aware. A callback invoked by renderer execution must use the renderer/coordinator's current sheet identity, not a stale React closure over a previous active sheet.
- Binary viewport data remains the production source for visible cell display text, values, resolved formats, flags, and dimensions where the lower renderer path supports it. App callbacks should only supply metadata that has not moved into the binary payload.
- All async data pushed into render context must be scoped by active sheet, renderer current sheet, and a monotonic generation or cancellation token. Late results from a previous sheet, previous selection, previous editor, or previous page-break mode must not repaint the current sheet.
- DOM overlays must use the right coordinate space by construction: page-coordinate API for Popover/fixed/portal surfaces, and container-local geometry for inline editors rendered inside the grid container.
- Frozen panes and split panes must be represented as multiple rects when the renderer geometry returns multiple rects. Picking `rects[0]` is allowed only when the caller has a tested reason that the anchor is single-region.
- Custom scrollbars are the only visible scroll controls in this surface. InputCoordinator scroll state, scrollbar thumb geometry, dynamic expansion bounds, restored scroll position, wheel/trackpad gestures, and programmatic scroll must stay in sync.
- E2E coverage for this folder must use real UI input paths: keyboard, mouse, pointer, wheel, touch/long press where applicable, clipboard events, and DOM focus. Tests must not mutate renderer state directly to simulate a successful interaction.
- Inline editor focus and caret behavior must preserve native browser text input, IME composition, formula autocomplete interception, Home/End selection semantics, Alt+Enter newline insertion, formula-bar focus behavior, and click-inside-editor pointer isolation.
- Accessibility live-region announcements must be correct for single cells, ranges, multi-ranges, mode changes, explicit action announcements, async table context, and repeated identical messages.
- Render isolation is a production contract: cache updates should invalidate canvas through coordinator/renderer invalidation, not force full `SpreadsheetGrid` React re-renders.

## Concrete implementation plan

1. Create a grid surface contract inventory.

   Add an executable inventory near the spreadsheet app tests that enumerates every production concern registered or mounted by `components/grid`: renderer dependencies, render-context callbacks, direct context pushes, cache invalidation callbacks, event listeners, overlay components, editor surfaces, dialogs, tooltips, and accessibility announcers. For each item record owner module, source state, target coordinator/renderer capability, invalidation behavior, coordinate space, async policy, and verification coverage. The inventory should fail when a new `RenderContextConfig` field, editor type, overlay type, or coordinator dependency is introduced without an explicit disposition.

2. Extract a `GridSurfaceRuntime` composition layer from `SpreadsheetGrid`.

   Move grouped setup out of `SpreadsheetGrid.tsx` into focused hooks or factories:

   - workbook and sheet runtime: active sheet, worksheet, viewport, sheet state provider, scroll restoration snapshot;
   - render data adapters: cell callbacks, table/filter caches, sparklines, conditional formatting, grouping, page breaks, print area, floating objects, charts, search, trace arrows;
   - input surface: keyboard, mouse, native listeners, long-press context menu, focus container registration, clipboard event attachment;
   - overlay surface: scrollbars, canvas interactive overlay, outline overlay, object/pivot/slicer/form-control layers, paste options, split dividers, dialogs, tooltips, accessibility;
   - editor surface: inline editor router and picker overlays.

   `SpreadsheetGrid` should mostly bind the returned props to the DOM tree. It should not contain inline table parsing, print pagination, render-context registration details, or effect-specific race handling.

3. Replace `useRenderContextConfig` with a typed render data-source registry.

   Introduce a public app-side registry, for example `GridRenderDataSourceRegistry`, with one typed entry per renderer data source. Each entry should declare:

   - whether it is a stable callback, a push value, an async refresh, or a direct render-state update;
   - which renderer/coordinator capability consumes it;
   - whether `undefined` means leave unchanged and `null` means clear;
   - what dirty/invalidation signal must follow a value change;
   - how it is scoped to sheet, selection, active renderer generation, or workbook revision.

   Remove the "migration pending" comments by implementing the intended data-source capability on the SheetView/coordinator path instead of pushing 30+ loosely related callbacks through one effect. Direct `updateContext()` effects for floating objects, trace arrows, page breaks, remote cursors, and shimmer should either become registry entries or a small, named push-channel with tests.

4. Add generation-scoped async adapters.

   Implement a shared `useSheetScopedAsyncValue` or non-React adapter utility for this folder's async reads. It should capture `sheetId`, a caller-provided dependency key, and a generation token, then expose only the latest successful value for the current sheet.

   Apply it to:

   - `getAutoPageBreaks`, `getPageBreaks`, and `getPrintArea` refreshes in render context;
   - `getAllObjectBounds` and per-object bounds callbacks during sheet switch;
   - `useSearchHighlights` batch CellId resolution;
   - `useTraceArrowsForRender` position cache refresh;
   - `useInputMessageTooltip` validation-rule fetches;
   - `DatePickerOverlay` eligibility, validation, and settings reads;
   - `InlineRichTextEditor` raw-cell data loading.

   The goal is one race policy across the folder: stale async data is discarded, missing data is represented explicitly, and fallback values are distinguishable from real empty results.

5. Centralize overlay geometry.

   Add a small `grid-overlay-geometry` module for this app boundary. It should expose typed helpers such as:

   - `useCellPageAnchor(cell, options)` for Popover/fixed overlays;
   - `useRangePageAnchors(range, options)` for merged/frozen/split ranges;
   - `useCellContainerRect(cell, options)` for inline editors rendered inside the grid container;
   - `useScrollSyncedEditorAnchor(...)` for editor surfaces that must remain mounted through scroll animations.

   Update `ValidationDropdownOverlay`, `DatePickerOverlay`, `InputMessageOverlay`, `PasteOptionsButton`, `InlineCellEditor`, `InlineRichTextEditor`, `InlineSliderEditor`, and split divider consumers to use these helpers. Handle multiple rects explicitly rather than silently taking `rects[0]` in every component. Keep the existing overlay coordinate lint, but extend it so new grid overlay files must choose page or container coordinates through the helper.

6. Build a single editor surface router.

   Replace the current unconditional mounting sequence of `InlineSliderEditor`, `InlineRichTextEditor`, `InlineCellEditor`, `ValidationDropdownOverlay`, and `DatePickerOverlay` with an explicit `GridEditorSurface` that routes by editor state:

   - `slider` cells render slider only;
   - rich-text cells render rich text editor only;
   - plain/formula cells render the WYSIWYG textarea, formula highlighter, and autocomplete path;
   - dropdown/date picker overlays attach to the active editor only when their picker state is open;
   - formula-bar focus renders the inline visual surface without stealing focus;
   - IME composition prevents shortcut and autocomplete paths from consuming composition events.

   Preserve the existing plain-text editor contracts before the refactor: no blur commit, `data-no-grid-pointer`, cursor mirror no-op guard, Home/End handling, Alt+Enter newline, formula autocomplete Escape semantics, and transparent formula overlay caret stacking.

7. Complete rich-text editing as a real editor, not a lossy overlay.

   `InlineRichTextEditor` currently converts edited segments back to plain text and has TODOs for segment storage and selection tracking. Implement the correct rich-text editor contract:

   - editor machine state can hold rich-text segments and selection ranges;
   - `RichTextEditor` exposes caret/selection offsets;
   - partial formatting commands operate on selected segments;
   - commit writes rich-text data through Worksheet API without flattening;
   - cancel restores the original rich-text value;
   - formula/plain-text paths are unaffected.

   Add tests for mixed-format cell editing, partial selection formatting, commit/cancel, sheet switch during edit, and scroll/frozen-pane positioning.

8. Strengthen picker and validation surfaces.

   For `ValidationDropdown` and `DatePicker`:

   - move list/date math into pure helpers with exhaustive unit tests;
   - reset focused/highlighted state when opening on a different cell or when filtered items change;
   - make Escape, Tab, Enter, Home/End, PageUp/PageDown, arrow keys, mouse selection, and search input behavior match the editor machine contract;
   - preserve validation `allowBlank`, strict date bounds, 1900/1904 date system, locale, RTL, and read-only/protected behavior;
   - make picker commit direction explicit and test-covered.

   For `DatePickerOverlay`, avoid host-timezone ambiguity in tests by injecting `todayIso` through a testable date provider while keeping production behavior based on the user's current locale/time zone.

9. Fix split view and scrollbar composition at the app boundary.

   Remove the "split view coming soon" split-box placeholders from `ScrollContainer` or wire them into real split creation commands. The visible split affordances should come from one source of truth: workbook split config plus renderer `ViewportLayout.dividers`.

   Strengthen custom scrollbar contracts:

   - `ScrollContainer` reads viewport dimensions from a reactive renderer capability rather than a potentially stale render-time `getViewport()` call;
   - scroll bounds update when used range, hidden rows/columns, row heights, column widths, zoom, viewport dimensions, scrollbar visibility, sheet switch, split panes, or freeze panes change;
   - thumb drag and track click use pointer events consistently and do not leak to grid selection;
   - dynamic expansion remains continuous and bounded by Excel row/column limits.

10. Replace local string parsing and untyped casts with public contracts.

   In `useSparklineCFIntegration` table auto-expansion, replace regex A1 parsing and `String.fromCharCode()` column increment with shared A1/range helpers that support multi-letter columns, quoted sheet names if relevant, and full Excel bounds. Type the workbook and sheet IDs instead of using `as any`.

   Type `useSearchHighlights` with `SheetCoordinator` instead of `any`. Type selection actor refs passed into sparkline selection coordination so the `as any` cast disappears. Type table context in `AccessibilityAnnouncer` with the Worksheet table contract instead of `let table: any`.

11. Make print/page-break preview a dedicated adapter.

   Move `ViewportTableDataProvider`, print option construction, paper size mapping, page setup mapping, manual/automatic break reconciliation, and page-break render-context refresh into a `grid-print-preview-adapter`.

   The adapter should:

   - use viewport data only where the print engine contract requires synchronous reads;
   - make "ViewportReader bounds approximate used range" an explicit contract or replace it with a workbook/kernel used-range source;
   - cover manual/automatic break deduplication, first-page exclusions, fit-to-page settings, margins, headings/gridlines, orientation, 1904 date system where relevant, hidden rows/columns, and print area changes;
   - report calculation failures through renderer diagnostics without silently pretending the sheet has no automatic breaks unless that is the intended fallback.

12. Add render isolation instrumentation and tests.

   Add a lightweight dev-only render counter or test harness for `SpreadsheetGrid` and major child surfaces. Contract tests should prove:

   - selection changes re-render only active-cell-dependent overlays and accessibility announcer, not the whole grid surface;
   - scroll changes update scrollbars and scroll-synced editor transforms without a `SpreadsheetGrid` render per frame;
   - cell metadata, filter header, table layout, chart cache, sparkline, and CF cache updates call renderer invalidation without forcing parent React rerenders;
   - editor cursor changes re-render only the editor surface and autocomplete where required.

13. Strengthen accessibility and DOM discovery contracts.

   Extend `AccessibilityAnnouncer` coverage to async table context, repeated identical announcements, mode transitions, pending assertive/polite messages, formatted values, errors, blank cells, table headers/totals/filter state, and stale async table lookups after selection changes.

   Keep chart DOM sentinels intentionally invisible and non-interactive, but define the sentinel contract in tests: one marker per chart on the active sheet, no stale markers after sheet switch, no pointer/focus impact, and no leakage for non-chart floating objects.

14. Update production callers directly.

   When the registry, overlay geometry helpers, editor router, split affordance, or print adapter changes require updates outside this folder, update the production caller in the same workstream. Do not keep duplicate old/new APIs, compatibility shims, or test-only routes. With no external users, wrong contracts should be replaced directly.

## Tests and verification gates

Required focused package gates for implementation:

- `cd mog/apps/spreadsheet && pnpm test`
- `cd mog/apps/spreadsheet && pnpm typecheck`
- `cd mog && pnpm typecheck` for TypeScript contract changes that affect shared package exports or cross-package callers.

Dependent package gates when touched:

- `cd mog/canvas/grid-canvas && pnpm test`
- `cd mog/canvas/grid-canvas && pnpm typecheck`
- `cd mog/canvas/grid-renderer && pnpm test` if renderer context, geometry, or binary-reader contracts are changed.
- `cd mog/views/sheet-view && pnpm test` if SheetView data-source capabilities, viewport layout, or renderer execution contracts are changed.
- `cd mog/print-export && pnpm test` if the print preview adapter changes print/export contracts.

Specific tests to add or strengthen:

- Render data-source registry exhaustiveness over all render-context callbacks and direct push channels.
- Generation-scoped async refresh tests for page breaks, print area, object bounds, search highlights, trace arrow positions, validation input messages, date-picker eligibility, and rich-text raw data.
- Overlay geometry tests for page vs container coordinate helpers under toolbar/formula-bar offsets, sidebars, high-DPR/fractional zoom, frozen panes, split panes, hidden headers, merged cells, and off-viewport cells.
- Editor router tests proving only the intended editor surface renders for plain text, formula, rich text, slider, dropdown, date picker, formula-bar focus, IME composition, and merged cells.
- Plain editor behavior tests for cursor mirroring, Home/End with Shift, Alt+Enter, formula highlighter/caret alignment, autocomplete Tab/Escape/arrow behavior, click-inside-editor pointer isolation, and scroll animation focus retention.
- Rich-text editor tests for segment preservation, partial selection formatting, commit/cancel, caret tracking, and no plain-text flattening.
- Validation dropdown tests for dedupe, allow-blank clear option, live search, type-ahead, keyboard direction commits, mouse commit staying on cell, focus behavior, and empty result behavior.
- Date picker tests for 1900/1904 serial conversion, validation bounds, locale/RTL navigation, Today behavior, blocked dates, keyboard direction commits, and protected/read-only affordance hiding.
- Scrollbar/split tests for pointer isolation, thumb drag, track click, dynamic expansion, bounds sync, hidden dimensions, sheet switch, split creation/removal/drag/double-click, and no stale split-box placeholders.
- Accessibility tests for base announcements, async table context refinement, stale async suppression, repeated identical messages, mode changes, pending announcements, formatted/error values, and active descendant cleanup.
- Print/page-break preview adapter tests for paper size mapping, print settings, manual plus automatic break reconciliation, print area changes, viewport bounds fallback, and failure diagnostics.

Required browser verification for UI-facing changes:

- Run the spreadsheet dev server and exercise the real grid in a browser.
- Verify selection, keyboard navigation, editing, formula editing, formula autocomplete, IME input, copy/cut/paste, paste options, validation dropdowns, date picker, slider cells, rich text cells, hyperlinks, input messages, protection and validation dialogs, context menus, scrollbars, freeze panes, split panes, sheet switching, zoom, page-break preview, chart cache repaint, and accessibility live-region behavior.
- Browser/E2E tests must drive real UI input paths through keyboard, mouse, pointer, wheel, clipboard, touch/long press where practical, and DOM focus. They must not seed renderer state through private method calls or direct state mutation.

Performance verification must target the production app path. Measure React render counts, scroll frame behavior, context update frequency, cache invalidation count, async refresh generation drops, and editor overlay paint stability in the real spreadsheet grid, not isolated mocks.

No verification commands were run for this planning task because the queue item explicitly forbids build, test, typecheck, and verification commands.

## Risks, edge cases, and non-goals

Risks:

- Refactoring `SpreadsheetGrid` can accidentally widen subscriptions and reintroduce high-frequency React renders during scroll, selection, or editor cursor changes. Add render isolation tests before moving large blocks.
- A typed data-source registry may expose renderer context fields that currently update through incidental effects. The correct outcome is an explicit disposition for each field, not silent no-ops.
- Generation-scoped async adapters can reveal real loading gaps that stale callbacks currently mask. Tests should distinguish correct empty/loading state from stale previous-sheet data.
- Multi-rect overlay handling for frozen and split panes may change anchor choice for dropdowns, date pickers, paste options, and editors. Define the anchor policy before changing code.
- Consolidating editor routing can break subtle native input behavior. Preserve the browser-owned textarea path and IME composition behavior with focused tests.
- Replacing table range regex parsing may require a public table range helper if none exists. Add the helper in the appropriate public package rather than keeping local parsing.
- Print page-break calculations may be expensive if moved into a more reactive adapter. Keep refresh triggers explicit and cancellable.

Edge cases to cover:

- React StrictMode double mount/unmount and cleanup ordering.
- Sheet switch while editing, while page-break preview is calculating, while object bounds are loading, or while trace/search CellIds are resolving.
- Rapid active-cell movement while validation input messages, date picker eligibility, rich-text data, accessibility table context, or search highlights are loading.
- Frozen panes and split panes where an edited or selected range spans multiple regions.
- Hidden row/column boundaries adjacent to active cells, dropdown affordances, split dividers, and scrollbars.
- Merged cells for editor surfaces, dropdowns, date picker, paste options, input messages, and accessibility active descendant.
- Scroll animation that temporarily moves the editor cell out of the rendered viewport.
- Formula bar focus while inline editor visuals remain visible.
- IME composition with autocomplete suggestions, keyboard shortcuts, and sheet-switch/cancel paths.
- Multi-letter table columns during table auto-expansion.
- Empty sheets, very large used ranges, maximum Excel row/column bounds, and dynamic scrollbar expansion contraction.
- High-DPR displays, fractional zoom, and browser font fallback differences.
- Screen reader repeated announcements and delayed async table context after selection changes.

Non-goals:

- Do not rewrite cell rendering, layer composition, dirty rect logic, or hit testing in this folder; those belong to `canvas/grid-renderer`, `canvas/grid-canvas`, and `views/sheet-view`.
- Do not optimize mocks, test-only paths, or app-eval sentinels as the primary outcome.
- Do not keep compatibility shims for wrong app/renderer contracts. Update the production contract and its callers directly.
- Do not add a separate DOM spreadsheet grid or duplicate canvas-rendered state for convenience.
- Do not redesign the spreadsheet UI chrome or visual language beyond changes required by correct grid behavior.
- Do not add dependencies from `mog` to `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contract inventory and intended registry shape are agreed.

- Agent A: build the grid surface contract inventory and render data-source registry tests.
- Agent B: extract `GridSurfaceRuntime` from `SpreadsheetGrid` while preserving the render tree and subscription behavior.
- Agent C: implement generation-scoped async adapters and migrate page breaks, search highlights, trace arrows, input messages, date picker eligibility, and rich-text loading.
- Agent D: build overlay geometry helpers and migrate page-coordinate overlays plus container-local editor anchors.
- Agent E: implement the editor surface router and then complete rich-text segment/selection editing.
- Agent F: replace table auto-expansion parsing and untyped casts with public typed helpers and coordinator contracts.
- Agent G: finish scrollbar/split affordance integration and expand pointer/scroll tests.
- Agent H: add accessibility, DOM sentinel, and render isolation tests.
- Agent I: run browser verification against the production spreadsheet app and record regressions with exact input paths.

Dependencies:

- The geometry helper work should align with the planned `canvas/grid-renderer` and `canvas/grid-canvas` geometry contract improvements so app overlays do not codify a soon-to-be-replaced coordinate API.
- The render data-source registry depends on coordinator and SheetView capabilities. If those capabilities do not exist, add them in public app/sheet-view code rather than widening `useRenderContextConfig`.
- Rich-text editor completion depends on the editor machine and Worksheet API accepting rich-text segment values without flattening.
- Split affordance cleanup depends on workbook split actions, renderer `ViewportLayout.dividers`, and InputCoordinator scroll bounds staying in sync.
- Print/page-break adapter work depends on `@mog/print-export` pagination contracts and a reliable used-range source if `ViewportReader.getBounds()` remains only an approximation.
