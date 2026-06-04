# Plan 064 — Improve `mog/apps/spreadsheet/src/components/grid` (Main grid UI component tree)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/components/grid`
- **Public source folder (read):** `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/components/grid`
- **Scope of this plan:** the React component tree that hosts the canvas spreadsheet grid and all of its DOM overlays. Concretely:
  - The orchestrator component `SpreadsheetGrid.tsx` (1059 lines) and the barrel `index.ts`.
  - `effects/` (8 hooks): `useRenderContextConfig.ts` (481), `useRendererSync.ts` (248), `useInputListeners.ts` (221), `useRendererLifecycle.ts` (180), `useRendererDependencies.ts` (102), `useGroupingIntegration.ts` (81), `useEditorIntegration.ts` (65), `useSparklineCFIntegration.ts` (232) — the integration/lifecycle wiring between React, the `SheetCoordinator`, and the renderer state machine.
  - `editors/` (6): `InlineCellEditor.tsx` (777), `DatePickerOverlay.tsx`, `InlineCellAutocomplete.tsx`, `InlineRichTextEditor.tsx`, `InlineSliderEditor.tsx`, `ValidationDropdownOverlay.tsx` — the in-cell DOM editors layered over the canvas.
  - `layout/` (6 + tests): `ScrollContainer.tsx` (439), `SplitDividersLayer.tsx`, `SplitDivider.tsx`, `OverlayLayers.tsx`, `StatusOverlays.tsx`, `FontWarningToast.tsx`.
  - `hooks/` (5): `useScrollDimensions.ts`, `useSearchHighlights.ts`, `useTraceArrowsForRender.ts`, `useCellDataCallbacks.ts`, `useInputMessageTooltip.ts`.
  - `dialogs/` (`InputMessageOverlay.tsx`, `ProtectionDialogs.tsx`), `providers/` (`ViewportTableDataProvider.ts`), top-level tooltip/announcer components (`AccessibilityAnnouncer.tsx`, `HyperlinkTooltip.tsx`, `CellOverflowTooltip.tsx`, `InputMessageTooltip.tsx`, `ValidationDropdown.tsx`, `DatePicker.tsx`, `PasteOptionsButton.tsx`, `SliderEditor.tsx`), and `accessibility-announcements.ts`.
  - Existing tests in `__tests__/` and `layout/__tests__/`.
- **Out of scope (depended on, not changed here):** the `SheetCoordinator` and its sub-coordinators (`coordinator/*`), the renderer state machine and execution layer (`systems/renderer/*`), the canvas packages (`@mog/grid-canvas`, `@mog/grid-renderer`), the data hooks under `hooks/data/*`, the UI store, and all SDK contracts/types packages. This plan changes only the component tree in `components/grid`; where it needs a new capability from an out-of-scope module (e.g. a renderer context data-source slot), it is called out explicitly as a cross-folder dependency.

## Current role of this folder in Mog

This folder is the **bridge between React and the canvas renderer**. The grid itself is drawn on `<canvas>` by the renderer execution layer; this component tree owns:

1. **Orchestration** — `SpreadsheetGrid.tsx` is a "controller component" that instantiates ~25 hooks and assembles ~15 data callbacks, then feeds them to the renderer through three integration effects (`useRendererDependencies`, `useRenderContextConfig`, `useRendererSync`) and the renderer lifecycle (`useRendererLifecycle`).
2. **DOM overlays over canvas** — inline editors (`editors/`), validation/date/slider pickers, paste-options button, input-message and hyperlink tooltips, the accessibility ARIA live region, custom scrollbars (`ScrollContainer`), split dividers, and status/error overlays. Canvas owns all cell/border painting; these are interactive DOM elements positioned over it.
3. **Input plumbing** — native pointer/wheel/touch listeners (`useInputListeners`), keyboard delegation, long-press → context menu, clipboard events.

The dominant non-functional concern, repeated throughout the code, is **render isolation**: the canvas repaints at up to ~120 fps during scroll, and the comments record that a naive `useInput()` subscription caused "842 re-renders/sec." The folder therefore deliberately uses granular hooks (`useRendererStatus`, `useEditorState`, `useInputState`) and pushes data to the renderer via **getter callbacks read at paint time** rather than via React props/state. The renderer pulls cell values, formats, filter info, outline levels, page breaks, etc. through these callbacks each frame.

The folder is **mature and carefully reasoned** — the comments document subtle bugs (caret occlusion, click-commits-formula, infinite expand/shrink loop, scroll-animation unmount) and their fixes. This plan is **not a rewrite**. The objectives are to (a) finish moving residual domain/computation logic out of the orchestrator and the render-context getter layer, (b) crispen the synchronous render-callback contract that the whole frame loop depends on, (c) remove dead/stub code and stale documentation pointers, and (d) close the most valuable test gaps — without changing any rendered output or input behavior.

### Key structural facts established by inspection (read-only)

- `SpreadsheetGrid.tsx` still contains substantial **non-UI logic** despite the documented decomposition:
  - `getRowOutlineLevels` / `getColumnOutlineLevels` (lines ~216–276): ~60 lines of outline-level math, **duplicated** row-vs-column with only `summaryRowsBelow`/`summaryColumnsRight` and axis-name differences.
  - `getAutoPageBreaks` (lines ~674–783): ~110 lines mapping `PrintSettings → PrintOptions`, including an incomplete `paperSizeMap` (`{1,5,9,8}` only) that silently falls back to `'letter'`, the `ViewportTableDataProvider` construction, and the pagination-layout → break-position extraction loop.
  - `getFloatingObjectState` (lines ~516–537): insertion-preview bounds math plus an **inline `import(...)` type cast** to `ObjectInteractionState`.
  - `handleCommentIndicatorClick`, `hasTableColumnFilter` (async list scan), `renderChart` wiring, etc.
- `useRenderContextConfig.ts` is a **god effect** (481 lines): one `setContextConfig` call wiring 30+ getter callbacks via an `optionsRef` indirection, **plus four additional `useEffect`s** that each push a *partial* context update out-of-band (floating objects, trace arrows, page breaks, remote cursors). One of these carries an explicit **"migration pending"** workaround (lines ~396–411): floating-object callbacks must be re-pushed via `updateContext` because `setContextConfig` "needs the same data-source capability."
- **Sync/async ambiguity in the paint-path contract:** several render callbacks are typed `T | Promise<T>` — `getTableAtCell`, `getFilterHeaderInfo`, `hasTableColumnFilter`, `getPrintArea`, `getAutoPageBreaks`. The render loop is synchronous (canvas paint); these are resolved through caches/precomputation elsewhere, but the union return type leaves the contract under-specified and invites an `await` in the frame path.
- **Module-level mutable singletons** in `InlineCellEditor.tsx`: `_lastKnownCellRect` and `_measurementCanvas`/`_measurementContext` are module globals shared across every grid instance. Documented as intentional (survive unmount during scroll animation), but they are process-global and would cross-contaminate if two grid instances (e.g. split panes, multi-workbook) ever mount concurrently.
- **Dead/stub code:** `ScrollContainer.tsx:215,251` ship `console.log('[SpreadsheetGrid] Split view not yet implemented …')` while `SplitDivider`/`SplitDividersLayer` exist and are wired — split view is a half-landed feature. `useCellMetadataCache` is called with hardcoded bounds (`startRow:0, endRow:200, endCol:50`) that the comment says the cache ignores (it reads real `ViewportBuffer.getBounds()`), i.e. misleading dead params.
- **Type-safety holes:** `as unknown as SplitViewportConfig | null` on the mirror split-config (SpreadsheetGrid:430), the inline-import floating-object cast (SpreadsheetGrid:531), two `eslint-disable react-hooks/exhaustive-deps` in `InlineCellEditor.tsx` (lines ~230, ~386).
- **Incomplete production feature:** `InlineRichTextEditor.tsx` has TODOs noting it stores **plaintext, not rich-text segments**, and has no character-level selection / partial formatting — rich-text in-cell editing silently degrades to plaintext on commit.
- **Stale documentation pointers:** the code's `@see` references point at docs that **no longer exist**. Verified: only `ARCHITECTURE.md` exists (at `mog/docs/internals/spreadsheet/ARCHITECTURE.md`). Missing across the repo: `ARCHITECTURE-CHECKLIST.md`, `HOOKS-ARCHITECTURE-CONSOLIDATION.md`, `RENDERER-INSTANCE-OWNERSHIP.md`, `SHEET-AWARE-CELL-DATA-CALLBACKS.md`, `STREAM-H-EDITOR-PROTECTION.md`, `FOCUS-BASED-KEYBOARD-HANDLING.md`, `09-SPREADSHEET-GRID-DECOMPOSITION.md`, `ISSUE-16-REACT-STRICT-MODE-AND-DIMENSIONS.md`. ~9 `@see` lines point into the void.
- **Test coverage:** only 3 test files exist, all over **pure helper math** — `buildBaseSelectionAnnouncement` (`AccessibilityAnnouncer.test.ts`), `computeContinuousExpansion`/`computeScrollbarDragPosition` (`continuous-expansion.test.ts`), and the scrollbar click-isolation guard. None of the 8 effects, 5 hooks, 6 editors, 6 layout components, dialogs, or providers have any test. The most intricate logic (IME composition, caret/expansion in `InlineCellEditor`, outline-level computation, the print-settings mapping) is untested.

## Improvement objectives

1. **O1 — Extract residual domain/computation logic out of `SpreadsheetGrid.tsx` into pure, testable modules.** Outline-level computation, print-settings → print-options mapping (incl. a complete paper-size table), and floating-object insertion-preview/snapshot mapping become pure functions (or thin data hooks) with no React/coordinator coupling. The component shrinks toward the "Pure UI rendering" its own header claims.
2. **O2 — Consolidate the render-context wiring into one coherent push path.** Eliminate the four out-of-band `updateContext` effects in `useRenderContextConfig.ts` by giving `setContextConfig` the data-source/getter capability the "migration pending" comment requires, so floating objects, trace arrows, page breaks, and remote cursors flow through the same getter contract as everything else. One config object, one subscription lifecycle.
3. **O3 — Make the render-callback contract crisply synchronous.** The paint loop is synchronous; the data getters it reads must be synchronous. Replace every `T | Promise<T>` render-context getter with a synchronous `T` backed by the existing caches (`useFilterHeaderCache`, `useTableLayoutCache`, cell-metadata cache, a new memoized print/page-break cache). Async refresh stays where it belongs — in the cache hooks that `invalidate()` the renderer — never in a getter the frame loop calls.
4. **O4 — Remove module-global editor state.** Replace `InlineCellEditor`'s module-level `_lastKnownCellRect` and shared measurement canvas with per-instance state scoped to the grid (context- or ref-based), preserving the unmount-survival behavior without process-global cross-contamination, so split panes / multiple grids are safe.
5. **O5 — Remove dead code and stale documentation pointers.** Delete the split-view `console.log` stubs (and either finish-wire or explicitly gate the split-box UI), drop the misleading hardcoded `useCellMetadataCache` bounds, and fix or remove every dangling `@see` doc reference — repointing live ones to `mog/docs/internals/spreadsheet/ARCHITECTURE.md` and the `renderer/` docs that do exist.
6. **O6 — Close type-safety holes at the React⇄kernel boundary.** Replace the `as unknown as SplitViewportConfig` mirror cast and the inline-import floating-object cast with declared adapter functions / shared types, and remove the two `exhaustive-deps` disables in `InlineCellEditor` by restructuring the effects (or documenting the precise invariant in a typed comment helper, not a blanket disable).
7. **O7 — Complete rich-text in-cell editing (production feature gap).** `InlineRichTextEditor` must round-trip rich-text **segments** (not collapse to plaintext) and support character-level selection for partial formatting, matching the rest of the rich-text pipeline. This is the only objective that changes user-visible behavior, and it closes a silent data-loss path (formatting dropped on commit).
8. **O8 — Establish a test baseline for the extracted logic and the editor/overlay positioning math.** Characterization + unit tests for everything O1 extracts, for the synchronous getter adapters from O3, and for `InlineCellEditor` width-expansion and vertical-alignment math, locking current behavior before and after the refactors.

## Production-path contracts and invariants to preserve or strengthen

These must hold across every change in this plan:

- **C1 — Rendered output is unchanged.** For any workbook state, the canvas paints identically before and after O1–O6. Outline levels, page-break positions, filter funnel icons, floating-object previews, search highlights, trace arrows, and remote cursors must be byte-for-byte the same. O1/O2/O3 are pure refactors under this invariant.
- **C2 — Render isolation is preserved or strengthened, never regressed.** No change may reintroduce a subscription that re-renders `SpreadsheetGrid` (or any editor/overlay) on scroll or cell selection. The granular-hook discipline (`useRendererStatus`, `useEditorState`, `useInputState`, internal `useActiveCell` in `InputMessageOverlay`/`InlineCellAutocomplete`) is a hard constraint. Any new code that subscribes to high-frequency state must do so in an isolated child or via a getter read at paint time.
- **C3 — The render-context getter contract is synchronous after O3.** Every getter the renderer invokes during a frame returns a resolved value with no `await`. This *strengthens* an invariant that is today only honored by convention. Async data acquisition happens in cache hooks that signal the renderer via `coordinator.renderer.invalidate(...)`.
- **C4 — Editor focus and keystroke integrity are preserved.** The documented behaviors must not regress: the editor stays mounted and keyboard-focused during the `animateScrollTo` window (O4 must keep the unmount-survival fallback); the `data-no-grid-pointer` opt-out keeps clicks inside the edited cell from committing the formula; the no-`onBlur` policy (commit only on explicit intent) stands; IME composition for CJK continues to work; the transparent-textarea-over-highlighter caret-visibility fix stays intact.
- **C5 — WYSIWYG positioning stays single-sourced.** Canvas and DOM editors must continue to compute text position from the same `TextMeasurementService.computeTextPosition()` / `getCellDOMStyle` source. Any extraction of editor math (O8) must not fork the positioning computation.
- **C6 — Renderer lifecycle ordering is preserved.** The state-machine sequence `unmounted → MOUNT → waitingForLayout → LAYOUT_READY → initializing → INITIALIZED → ready`, the dimension sanity check (reject > 16384px, wait for `ResizeObserver`), suspend/resume on visibility change, sheet-switch scroll restoration, and the "mirror reads are synchronous, no race window" guarantee must all be unchanged. Renderer-dependency setup must still run before `MOUNT`.
- **C7 — Accessibility surface is preserved.** `role="grid"`, `aria-rowcount`/`aria-colcount`/`aria-multiselectable`, the `AccessibilityAnnouncer` live region, and the keyboard-driveable DOM overlays (`CanvasInteractiveOverlay`, `OutlineToggleOverlay`) that app-eval / Playwright drive through the real input path must keep their roles and `data-testid`s. Test-facing markers (`data-testid="spreadsheet"`, `"inline-cell-editor"`, `"formula-edit-overlay"`, `data-spreadsheet-container`, `data-no-grid-pointer`, `data-page-break-preview-mode`) are a de-facto contract with the eval harnesses and must not be renamed or removed.
- **C8 — Print/paper-size fidelity improves, never regresses.** Completing `paperSizeMap` (O1) must keep the existing four mappings (`1→letter, 5→legal, 9→a4, 8→a3`) identical and only *add* previously-missing sizes; no currently-correct page layout may change.
- **C9 — Rich-text round-trip is lossless after O7.** Editing a rich-text cell and committing must preserve all segment formatting that the underlying rich-text model supports; plaintext cells stay plaintext. No regression to the plaintext-editing path.

## Concrete implementation plan

Ordered so behavior-locking precedes refactoring, pure extractions precede the wiring consolidation, and the one behavior-changing feature (O7) is isolated last.

### Phase 0 — Characterization safety net (do first; supports O8)
- 0.1 Add unit tests that lock current behavior of the logic Phase 1 will extract, calling it through its present location where possible:
  - Outline-level computation: feed representative `rowGroups`/`columnGroups` + `groupingConfig` (nested groups, collapsed groups, summary-above vs summary-below) and snapshot the `OutlineLevel[]` for both axes.
  - `PrintSettings → PrintOptions` mapping inside `getAutoPageBreaks`: assert the mapping for each paper-size code, orientation, margins (incl. the default-margins branch), scale, fit-to, and header/footer.
  - Floating-object insertion-preview bounds math: assert `{x,y,width,height}` for start/current permutations (including negative-delta drags).
- 0.2 Add positioning-math characterization tests for `InlineCellEditor`: width expansion (`EXPANSION_PADDING`, `MAX_EXPANSION_WIDTH`, `MIN_EDITOR_WIDTH`, the expand→shrink hysteresis that previously infinite-looped) and `verticalPaddingTop` for top/middle/bottom alignment across line counts and zoom.
- These become the C1/C5 oracle for later phases.

### Phase 1 — Extract pure logic out of `SpreadsheetGrid.tsx` (O1)
- 1.1 Create `grid/logic/outline-levels.ts` exporting one parameterized `computeOutlineLevels(indexStart, indexEnd, groups, summaryAfter)` that both row and column callers use, eliminating the row/column duplication. The component's `getRowOutlineLevels`/`getColumnOutlineLevels` become two-line adapters passing the axis-specific summary flag.
- 1.2 Create `grid/logic/print-options.ts` with `printSettingsToPrintOptions(settings)` and a **complete** `PAPER_SIZE_BY_CODE` table (preserving `1/5/9/8`, adding the remaining OOXML codes Mog supports), plus `extractAutoPageBreaks(layout, manualBreaks)`. `getAutoPageBreaks` in the component reduces to: guard on preview mode → gather (`getSettings`, `getArea`, `getPageBreaks`) → call the pure mapper → call `printHandler.calculateLayoutWithEngine` → `extractAutoPageBreaks`.
- 1.3 Create `grid/logic/floating-object-preview.ts` with `computeInsertionPreview(start, current)` and `toFloatingObjectRenderState(snapshot)` — the latter owning the type mapping so the inline `import(...)` cast (O6) is removed from the component.
- 1.4 Replace the bodies in `SpreadsheetGrid.tsx` with calls to these modules. No behavior change (locked by Phase 0).

### Phase 2 — Make render getters synchronous (O3, prerequisite for O2)
- 2.1 Audit every render-context getter typed `T | Promise<T>`: `getTableAtCell`, `getFilterHeaderInfo`, `hasTableColumnFilter`, `getPrintArea`, `getAutoPageBreaks`. For each, confirm the backing cache hook (`useTableLayoutCache`, `useFilterHeaderCache`, the table-filter list, print settings) already precomputes the value and signals via `onCacheUpdate` → `invalidate`.
- 2.2 For getters whose data is currently fetched async *inside the getter* (notably `hasTableColumnFilter`, which `await`s `ws.filters.list()`, and the page-break getters), move the async acquisition into a cache hook keyed by `activeSheetId` that stores the resolved value in a ref and calls `onCacheUpdate`. The render getter becomes a synchronous ref read returning `T`.
- 2.3 Narrow the getter type signatures in the `UseRenderContextConfigOptions` interface from `T | Promise<T>` to `T`. This is the type-level enforcement of C3; TypeScript then surfaces any remaining async caller.

### Phase 3 — Consolidate render-context wiring (O2)
- 3.1 Coordinate with the renderer-context owner (out-of-folder: `coordinator/renderer` + `systems/renderer`) to add the "data-source capability" the migration-pending comment references — i.e. let `setContextConfig` accept the floating-object getters as part of the one config object. (Dependency: see Parallelization notes.)
- 3.2 Fold the four out-of-band `useEffect`s (floating objects, trace arrows, page breaks, remote cursors) into the single `setContextConfig` getter set, all reading from `optionsRef.current` at paint time. Push-on-change cases that genuinely need eager propagation (remote cursors arriving from the collab sidecar between actor transitions; shimmer entries) remain as **explicit subscriptions** that call `invalidate`/`update`, but documented as such — not as duplicate context configs.
- 3.3 Result: one `setContextConfig`, one subscription-cleanup return, and a short list of clearly-labeled push subscriptions. The `optionsRef` indirection stays (it is the mechanism that keeps the effect dep array at `[coordinator]` and preserves C2).

### Phase 4 — Per-instance editor state (O4, O6)
- 4.1 Replace `InlineCellEditor`'s module-level `_lastKnownCellRect` with state scoped to the grid instance: a ref provided through a small grid-scoped context (or hoisted into a hook keyed by grid instance), preserving the unmount-survival fallback (C4) without process-global sharing.
- 4.2 Replace the module-level measurement canvas with a per-grid-instance memoized canvas (created once per mount via `useRef`/lazy init), keeping the SSR/test guard. Measurement is read-only, so this is purely about removing the global.
- 4.3 Remove the `as unknown as SplitViewportConfig` cast (SpreadsheetGrid:430) by adding a declared `mirrorSplitConfigToPublic(cfg)` adapter (in `grid/logic/` or alongside the mirror types) with an explicit field map; remove the inline-import floating-object cast via the O1.3 mapper. Remove both `exhaustive-deps` disables in `InlineCellEditor` by splitting the effects so each one's dependencies are honestly complete (e.g. separate the `value`-driven measurement from the `effectiveCellRect`-driven reposition), or, where a dependency is genuinely intentionally-omitted, encode the captured value in a ref so the dep array is truthful.

### Phase 5 — Dead code and documentation hygiene (O5)
- 5.1 Remove the two `console.log('[SpreadsheetGrid] Split view not yet implemented …')` stubs in `ScrollContainer.tsx`. Decide, with the renderer owner, whether the split-box scrollbar UI is (a) wired to `SplitDividersLayer` and should render, or (b) not shipping yet and should be behind an explicit feature gate rather than dead console output. Implement the chosen path (no silent stub).
- 5.2 Remove the misleading hardcoded `startRow/startCol/endRow/endCol` args to `useCellMetadataCache` (or, if the hook signature requires them, make them the documented real bounds source rather than dead defaults the comment says are ignored). Coordinate with the hook owner under `hooks/data`.
- 5.3 Fix every dangling `@see`: repoint references that have a live target to `mog/docs/internals/spreadsheet/ARCHITECTURE.md` (and the `renderer/` subfolder docs that exist), and delete references whose target no longer exists rather than leaving phantom pointers. Where a comment documents a real invariant (render isolation, focus handling), keep the *prose* and drop only the broken doc path.

### Phase 6 — Complete rich-text in-cell editing (O7) — behavior change, isolated
- 6.1 Wire `InlineRichTextEditor` to read and write rich-text **segments** through the same rich-text model the rest of the pipeline uses, instead of converting to/from plaintext on mount/commit. Resolve the three TODOs (store segments directly; track character selection; support partial formatting).
- 6.2 Add character-level `onSelectionChange` so toolbar formatting applies to the active selection within the cell.
- 6.3 Guard the plaintext path: non-rich cells must continue using `InlineCellEditor` unchanged; only cells whose content is rich-text route here. Lossless round-trip is the C9 acceptance bar.

## Tests and verification gates

- **Unit / characterization (Phase 0 + O8):**
  - `outline-levels.ts`: nested/collapsed/summary-above/summary-below permutations for both axes; assert identical `OutlineLevel[]` to the pre-extraction snapshot.
  - `print-options.ts`: full paper-size table (incl. preservation of `1/5/9/8` and the newly-added codes), orientation, margins/default-margins, scale, fit-to, header/footer; `extractAutoPageBreaks` page-iteration and manual-vs-auto dedup.
  - `floating-object-preview.ts`: insertion-preview bounds incl. negative deltas; snapshot→render-state mapping.
  - `InlineCellEditor` math: width-expansion hysteresis (the previously-infinite-loop case), `verticalPaddingTop` per alignment/line-count/zoom.
  - O3 synchronous getter adapters: each returns a resolved value (no Promise) and refreshes on cache `invalidate`.
- **Component / integration:** add render-isolation regression tests asserting `SpreadsheetGrid` does **not** re-render on simulated scroll-state and cell-selection changes (C2), and that the editor stays mounted across a simulated scroll-animation window (C4).
- **App-eval (existing harness, run by reviewers — not by this plan's author):** the scenarios that drive grid overlays through the real input path (filter-button overlays, outline toggles, inline editor keystreams, paste options, validation/date pickers) must pass unchanged. The `data-testid` contract (C7) is the anchor; any rename would break these and is disallowed.
- **Verification gates (run by the implementer, not in this planning task):** typecheck the spreadsheet app (the narrowed getter types from O3 must compile with no remaining `Promise`-returning render getter), lint clean (no remaining `eslint-disable` for the two removed deps), and the spreadsheet unit-test suite green. Visual/canvas parity is asserted by the app-eval suite above.

## Risks, edge cases, and non-goals

**Risks & edge cases**
- **R1 — Render isolation regression (highest risk).** Any new subscription added while consolidating context (O2) or moving async into caches (O3) could re-render the grid on a hot path. Mitigation: keep `[coordinator]` dep arrays, read mutable inputs via `optionsRef`, and gate with the C2 regression test.
- **R2 — Synchronous-getter conversion exposes a value that was genuinely not ready.** If a cache has not yet resolved on the first frame, the getter must return a safe empty value (`undefined`/`[]`/`null`) and let the subsequent `invalidate` repaint — never block or throw. This mirrors the existing chart `renderCached` "draw placeholder, repaint on cache update" pattern.
- **R3 — `setContextConfig` capability (O2/Phase 3) lives outside this folder.** If the renderer owner cannot add the data-source slot in the same cycle, O2 degrades to keeping the floating-object effect but still folding trace-arrows/page-breaks/remote-cursors — partial consolidation is acceptable and the "migration pending" comment is updated to reference a tracked dependency rather than left vague. (Do not paper over with a shim; either land the capability or document the precise blocker.)
- **R4 — Rich-text round-trip (O7) is the only data-correctness change.** Risk of dropping or mangling segment formatting. Mitigation: lossless round-trip tests (C9) over bold/italic/color/size mixes and partial-cell selections before enabling; keep behind feature scoping until parity is proven.
- **R5 — Module-global → per-instance (O4) could break the documented scroll-animation focus survival** if the new scope unmounts with the component. Mitigation: scope the fallback rect to the grid (context/hoisted ref) so it outlives the editor's own mount cycle but not the grid's.
- **R6 — Paper-size table completion (O1.2) could change a layout** if a previously-unmapped code was relying on the `'letter'` fallback intentionally. Mitigation: C8 keeps existing four exact; new entries only affect codes that today silently mis-map to letter (a fix, not a regression), called out in review.

**Non-goals**
- No rewrite of the renderer, coordinator, canvas packages, UI store, or `hooks/data` internals — only the consuming component tree changes (with the single, explicitly-scoped `setContextConfig` capability request).
- No change to the XState renderer-lifecycle machine, the input/keyboard architecture, or the clipboard pipeline.
- No visual redesign of editors, scrollbars, dividers, or tooltips.
- No reduced-scope shims, compatibility layers, or test-only fixes: O3 narrows the real contract, O7 implements the real feature, and dead stubs are removed rather than silenced.
- "Excel"-style fidelity (paper sizes, page-break semantics) is interop behavior to **match**, not branding to reference in code — keep the no-Excel-in-source-comments rule.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now (no cross-folder dependency):** Phase 0 (tests), Phase 1 (pure extractions O1), Phase 4 (O4 per-instance state + O6 casts/deps), Phase 5.3 (doc-pointer hygiene), and Phase 0/Phase 6 test scaffolding. These touch only files inside this folder.
- **Cross-folder dependencies:**
  - **O2 / Phase 3** depends on the renderer-context owner (`coordinator/renderer`, `systems/renderer`) adding a data-source/getter capability to `setContextConfig` (the "migration pending" item). Sequence: land that capability first, then fold the effects. If unavailable, ship the partial consolidation (R3).
  - **O3 / Phase 2** depends on the cache hooks under `hooks/data` (`use-filter-header-cache`, `use-table-layout-cache`, `use-cell-metadata-cache`) exposing synchronous resolved reads + an `onCacheUpdate` signal. Most already do; `hasTableColumnFilter` needs a new cache hook (can be added within `hooks/data` in parallel).
  - **O5 / Phase 5.1–5.2** needs a decision from the renderer owner on split-view shipping status, and coordination with the `useCellMetadataCache` owner on the bounds parameter.
  - **O7 / Phase 6** depends on the rich-text segment model/contract (rich-text utils + contracts) being able to express the segments the editor reads/writes; confirm the API surface before implementing.
- **Suggested execution order:** Phase 0 → Phase 1 (parallel with Phase 4/O6 and 5.3) → Phase 2 → Phase 3 → Phase 5.1/5.2 → Phase 6. Phases 1, 4, and 5.3 can run concurrently across implementers because they touch disjoint files.

## Status

Active plan. Evidence-complete: the folder exists and was inspected in full (42 files). No blocking missing evidence; the only external unknowns (split-view shipping intent; the exact `setContextConfig` data-source API; the rich-text segment contract) are documented as cross-folder dependencies to confirm at implementation time, not gaps in this plan.
