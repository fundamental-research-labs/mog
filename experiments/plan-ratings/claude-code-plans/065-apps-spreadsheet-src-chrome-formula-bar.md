# Plan 065 — Improve `mog/apps/spreadsheet/src/chrome/formula-bar` (formula bar editing & display path)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/chrome/formula-bar`
- **Public source folder (read):** `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/chrome/formula-bar`
- **Files in scope:**
  - `index.ts` (18 lines) — barrel; exports the four components + their prop types.
  - `FormulaBar.tsx` (456 lines) — presentational component: name box mount, confirm/cancel/fx/hide/AI/expand controls, the `<Input>`/`<Textarea>` value editor with the syntax-highlight overlay.
  - `FormulaBarContainer.tsx` (739 lines) — the container that bridges the editor state machine + Workbook/Worksheet ONE API to the presentational bar, derives the displayed value, and wires autocomplete / context menu / IME.
  - `FormulaBarContextMenu.tsx` (225 lines) — right-click Cut/Copy/Paste/Select All/Insert Function menu over the input.
  - `NameBoxDropdown.tsx` (850 lines) — interactive name box: A1/range navigation, named-range & table & sheet navigation, inline define-name, validation, context menu.
  - `name-box-display.ts` (52 lines) — pure formatter: `CellRange[] + activeCell → name-box string` (full-column/row/whole-sheet/multi-range).
  - `__tests__/name-box-display.test.ts` (59 lines) — the **only** unit test in the folder; covers `formatNameBoxSelection` exclusively.
- **Out of scope (depended on, not changed here):**
  - `../../internal-api` (`FormulaBarProps`, `ReferenceColorRange`, the `use*` hooks) — a contract this plan preserves; any prop change is called out explicitly.
  - `../../components/editor/*` (`FormulaHighlighter`, `FunctionSuggestions`, `FormulaArgumentHint`), `../../domain/editor/*` (`formula-range-parser`, `name-completion`), `../../hooks/editing/use-formula-autocomplete`, `../../hooks/toolbar/use-formula-bar-context-menu-actions`, the editor state machine / coordinator, `@mog-sdk/kernel` parsers, `@mog/spreadsheet-utils`. These are consumed; the plan may *move logic into* the `domain/editor` layer but does not redesign it.

## Current role of this folder in Mog

This folder is the **formula bar chrome** — the strip above the grid that shows the active cell's reference (name box) and its formula/value, and is one of the two entry points into cell editing (the other being the in-cell inline editor). The production data flow:

```
selection / active cell  ──useActiveCell──┐
editor state machine      ──useEditorState─┤
Workbook/Worksheet ONE API ───────────────┤
   ws.getCell / getRawCellData             │
   ws.viewport.getActiveCellData           ▼
                          FormulaBarContainer  (derives displayValue, referenceColors)
                                   │ FormulaBarProps
                                   ▼
                               FormulaBar  (Input/Textarea + FormulaHighlighter overlay)
                                   │ onChange/onCommit/onCancel/onFocus/IME
                                   ▼
                          editorActions / dispatch('COMMIT_IN_PLACE' | 'CANCEL_EDIT')
```

The name box is a parallel, self-contained sub-feature: `NameBoxDropdown` reads the (debounced) selection, formats it via `name-box-display.ts`, and on input/Enter resolves the typed token to a navigation (A1 range → defined name → table → new-name definition) through `selectionCommands.setSelection` and `wb.names.*`.

Key structural facts established by inspection (read-only):

- **The display path is unit-test dark.** Only `name-box-display.ts` has a test. The two highest-risk computations — `FormulaBarContainer.displayValue` (brace-wrap, forced-text apostrophe, formula-hidden fallback) and `NameBoxDropdown.navigateToAddress` (the full token-resolution priority chain + inline define-name) — have **zero** unit coverage and are embedded inside React components, so they can only be exercised through app-eval today.
- **`FormulaBarContainer` coordinates five independent refresh signals into one `structureVersion` counter** (`structureChanged`, `sheet:renamed`, clipboard `pasting→idle`, `cellChanged` for the active cell, and the `FORMULA_BAR_REFRESH_REQUESTED` window event), which then force-re-runs **two separate async fetch effects** (`activeCellData` and `cellData`). The two effects are independent and can land out of order, so `displayValue` can briefly read a fresh `cellData` against a stale `activeCellData` (or vice versa) — a tearing window for the brace/forced-text/hidden derivations.
- **There is a real display bug in the multi-line formula path.** In `FormulaBar.tsx`, the highlight overlay is gated `isFormula && !isMultiLine` (line ~295), but the `<Textarea>` still applies `text-transparent` when `isFormula` (line ~340) with `caretColor` forced visible. So an expanded formula bar (`isExpanded`) or any formula containing a newline renders **transparent text with no highlighter overlay → the formula is invisible**, only the caret shows. This compounds the caret-occlusion / transparent-overlay class of issues already recorded in memory (`formula-edit-caret-occlusion`, `formula-edit-click-commits`).
- **Element identity changes mid-edit.** `isMultiLine = isExpanded || value.includes('\n')` swaps the editor between `<Input>` and `<Textarea>` during editing (e.g. when Ctrl+Enter inserts a newline), which remounts the DOM node, forcing the `setTimeout(0)` caret-restore hack at line ~161 and risking focus/caret loss and re-fire of the focus→startEditing path.
- **`NameBoxDropdown` eagerly loads all names + all tables across all sheets on mount** (`loadData`, lines ~187–242: iterates every sheet, calls `ws.tables.list()` per sheet) regardless of whether the dropdown is ever opened, and re-runs on every `wb` identity change. The navigation/resolution business logic (`navigateToAddress`, `navigateToNamedRangeRef`, table-range parsing, inline define-name) lives in the component and duplicates the "resolve sheet → setSelection" block three times.
- **Type weaknesses at boundaries:** `cachedNamedRanges: any[]` and the `createStoreAdapter(cachedNamedRanges: any[], …)` parameter (NameBoxDropdown), and `activeCellData?.metadata as Record<string, unknown>` → `region as { kind?: string }` casts in the container's `shouldBraceWrap`. `ActiveCellData.metadata.region` has no typed surface here.
- **Dead/empty code:** the `useEffect` at `FormulaBar.tsx:89–98` has an empty body (only comments) and never runs anything — a leftover focus hook.
- **Discipline that is good and must be preserved:** no `any` in the container/highlight path, IME composition is correctly threaded for CJK, navigation/escape keys are deliberately delegated to `KeyboardCoordinator` (documented contract), async effects use `cancelled` guards, and the name box reads typed values straight from the DOM on Enter for Playwright/`fill` robustness.

This plan is **not a rewrite**. The components are functional and shipped. The objectives are to (a) fix the concrete multi-line-formula invisibility bug, (b) extract the untested display/navigation business logic into pure, tested `domain/editor` modules, (c) collapse the fragile multi-signal refresh + dual-async-fetch coordination into one coherent read, and (d) close type and accessibility gaps — all without changing observable behavior for existing inputs except where a behavior is currently wrong.

## Improvement objectives

1. **O1 — Fix multi-line formula invisibility.** Render formula syntax highlighting (or, at minimum, visible non-transparent text) in the multi-line/`isExpanded` path. The overlay must support the `<Textarea>` branch, or the `text-transparent` class must not be applied when no overlay is present.
2. **O2 — Extract the display-value derivation into a pure, tested module.** Move the `rawValue → displayValue` logic (brace-wrap by `region.kind`, formula-hidden fallback, forced-text apostrophe, date `editText`) out of `FormulaBarContainer` into a pure function in `../../domain/editor` taking an explicit typed input (`{ isEditing, editorValue, raw, computed, formula, region, isFormulaHidden, forcedTextMode, editText }`) and returning the string. Lock it with characterization tests.
3. **O3 — Extract name-box navigation/resolution into a pure, tested resolver.** Move `navigateToAddress`'s priority chain (range-with-colon fast path → defined name → API name fallback → table → A1 parse → inline define-name → invalid) into a pure resolver in `../../domain/editor` that returns a typed **intent** (`{ kind: 'select', ranges, activeCell, sheetSwitch? } | { kind: 'defineName', … } | { kind: 'invalid' }`). `NameBoxDropdown` becomes a thin executor of intents. De-duplicate the three "resolve sheet → setSelection" blocks.
4. **O4 — Collapse the refresh coordination.** Replace the five-signal → `structureVersion` → two-independent-async-fetch pattern with a single active-cell read that fetches `activeCellData` and `cellData` **together** (one async effect, one cancellation guard, atomic state set) so `displayValue` never tears across the two sources. Keep all five invalidation triggers, but route them through one debounced/coalesced refresh.
5. **O5 — Stabilize the editor element identity & caret.** Avoid remounting between `<Input>` and `<Textarea>` mid-edit; prefer always rendering a `<Textarea>` (single-row when collapsed) so newline insertion does not swap node types, eliminating the `setTimeout(0)` caret-restore hack and the focus re-entry risk.
6. **O6 — Make name-box data loading lazy and typed.** Load names/tables/sheets when the dropdown opens (or on first need) instead of eagerly per `wb` change; type `cachedNamedRanges` (drop `any[]`) and the store adapter inputs. Keep the `namedRangeChanged` live-sync.
7. **O7 — Type the region/metadata boundary.** Replace the `as Record<string, unknown>` / `as { kind?: string }` casts on `ActiveCellData.metadata.region` with a typed accessor (a small typed view or guard), removing the untyped read in `shouldBraceWrap`.
8. **O8 — Accessibility & dead-code cleanup.** Add `aria-label`s to the name-box `<input>`/trigger and the `fx` button, remove the empty `useEffect` at `FormulaBar.tsx:89`, and ensure confirm/cancel disabled states expose correct ARIA. No visual change.

## Production-path contracts and invariants to preserve or strengthen

These must hold across every change:

- **C1 — `FormulaBarProps` is the stable boundary.** The interface in `internal-api.ts` (value, isEditing, onChange(value, cursorPosition), onSelectionChange, onCommit, onCancel, onFocus(cursorPosition?), onFxClick, onKeyDown, inputRef, onContextMenu, isExpanded, onToggleExpand, IME trio, referenceColors, readOnly) plus the container-only extensions (`onClosePanel`, `nlBarVisible`, `onToggleNLBar`) keep their names, types, and semantics. The `onChange` caret-mirroring contract (DOM `selectionStart` passed to the machine) is load-bearing — preserve it exactly.
- **C2 — `displayValue` is output-stable for existing inputs.** For every current `(isEditing, raw, computed, formula, region.kind, isFormulaHidden, forcedTextMode, editText)` combination, the extracted pure function (O2) must return the *same* string the inline derivation returns today, including: edit mode shows live `value`; `cseArray`/`dataTable` regions brace-wrap `{=…}`, `arraySpill` does **not**; formula-hidden protected cells show the computed value not the formula; forced-text prefixes a leading apostrophe; numeric date cells use `activeCellData.editText`.
- **C3 — Name-box display formatting is frozen.** `name-box-display.ts` semantics (whole-sheet → active cell, full-column `A:A`, full-row `1:1`, single cell, rectangular `A1:C5`, comma-joined multi-range) stay byte-identical; the existing test must keep passing unchanged.
- **C4 — Name-box navigation priority order is preserved.** The resolution order in O3 must match today exactly: colon-range fast path → defined-name cache → `wb.names.get` API fallback → table name → A1 parse (with no-op single-cell → invalid-name guard) → inline workbook-scoped define-name (qualified to active sheet) → `INVALID_NAME_MESSAGE`. Case-insensitivity, `$`/leading-`=` stripping, and sheet-switch-before-select all preserved.
- **C5 — Focus contract.** A navigator owns focus: after name-box Enter/Escape, focus returns to the grid (`coordinator.input.focusGrid()`); committing/cancelling from the formula bar pops the `formulaBar` focus layer and `resetToGrid()`. Edit entry pushes the `formulaBar` layer *before* `startEditing` (so the inline editor doesn't also render). These orderings are load-bearing and must not change.
- **C6 — Keyboard delegation.** Enter/Tab/Escape navigation stays owned by `KeyboardCoordinator` at document level; the bar only handles Ctrl+Enter (newline) and autocomplete navigation (Arrow/Tab/Escape while suggestions open). Do not move navigation handling into the component.
- **C7 — IME composition correctness.** The `compositionStart/Update/End → editorActions.imeStart/imeUpdate/imeEnd` bridge (Layer-2 shortcut suppression for CJK) must remain wired on whichever element the editor renders after O5.
- **C8 — Performance: no selection-drag re-renders.** `FormulaBarContainer` must keep using `useActiveCell()` (not `useSelection()`) and `NameBoxDropdown` must keep `useDebouncedSelection()`, and the `memo` wrappers stay, so drag/fill/resize don't thrash the bar (the documented "591 re-renders" regression must not return).
- **C9 — Read-only mode.** When `readOnly`, the bar shows no confirm/cancel/fx affordances and the input/textarea takes no edit handlers — preserved exactly.
- **C10 — Graceful degradation.** Name-box data loads must keep degrading silently (empty dropdown) on transient API failure; the formula bar must keep rendering `''` when the active cell has no value/formula.

## Concrete implementation plan

Ordered so behavior-locking tests precede the extractions, and the isolated bug fix lands first.

### Step 1 — Land O1 (multi-line formula visibility) as a standalone fix
- In `FormulaBar.tsx`, either (preferred) extend the highlight overlay to render in the multi-line branch (a wrapping, top-aligned overlay matching the textarea's `white-space: pre-wrap` metrics), or as a guaranteed-correct fallback, only apply `text-transparent` to the textarea when an overlay is actually rendered for it.
- Add an app-eval scenario that types a multi-line formula (Ctrl+Enter) in an expanded formula bar and reads back that the formula text is visible (non-transparent / overlay present). This is the one user-visible bug; ship it first and independently.

### Step 2 — Characterization tests before extraction (O2, O3)
- Add `__tests__/format-formula-bar-display.test.ts` driving the *current* `displayValue` logic through a temporarily-exported pure helper, enumerating: plain text, number, date (`editText`), formula, `cseArray`/`dataTable` brace-wrap, `arraySpill` no-wrap, formula-hidden, forced-text apostrophe, editing-mode passthrough, and empty cell.
- Add `__tests__/resolve-name-box-navigation.test.ts` enumerating each branch of C4 with a stubbed store adapter + `wb.names` (range, defined name hit, cache-miss→API hit, table, A1 single/range, no-op invalid, new valid name → defineName intent, invalid token).

### Step 3 — Extract display derivation (O2)
- Create `../../domain/editor/formula-bar-display.ts` exporting a pure `computeFormulaBarDisplay(input): string` plus the typed `FormulaBarDisplayInput`. Move `rawValue`, `shouldBraceWrap`, `shouldHideFormula`, `calculatedValue`, `isForcedText`, `displayValue` logic there.
- In `FormulaBarContainer`, replace the six `useMemo`s with one call to the pure function fed by the consolidated read from Step 5. Keep the `useMemo` wrapper for referential stability.

### Step 4 — Extract name-box resolution (O3)
- Create `../../domain/editor/name-box-navigation.ts` exporting `resolveNameBoxToken(token, ctx): NavigationIntent`, where `ctx` provides the store adapter, `wb.names.get`, active sheet id/name, and current ranges/activeCell. Return a discriminated `NavigationIntent`.
- Reduce `NameBoxDropdown.navigateToAddress` to: call resolver → `switch` on intent kind → execute (`setActiveSheetId` if `sheetSwitch`, `selectionCommands.setSelection`, `wb.names.add` + refresh, or `setValidationError`). Collapse the three duplicated "resolve sheet → setSelection" blocks into one `applySelectionIntent` helper.

### Step 5 — Consolidate refresh & async reads (O4)
- Replace the two async effects (`activeCellData`, `cellData`) with a single effect keyed on `[ws, wb, activeSheetId, activeCellRow, activeCellCol, refreshTick]` that awaits `refreshActiveCellData`, then reads `getActiveCellData()`, `getCell`, `getRawCellData`, and calculated-column context, and commits **one** atomic state object (`{ activeCellData, cellData }`) under a single `cancelled` guard. `displayValue` derives from that one object → no tearing (strengthens C2).
- Rename `structureVersion` → `refreshTick` and keep all five subscriptions (`structureChanged`, `sheet:renamed`, clipboard pasting→idle, `cellChanged`-touches-active-cell, `FORMULA_BAR_REFRESH_REQUESTED`) bumping it; optionally coalesce bumps within a microtask to avoid redundant fetches. Preserve the `cellChanged` settle re-check (the `setTimeout(0)` against the settled active cell) since it guards a real selection-settle race.

### Step 6 — Stabilize editor element (O5)
- Render a single `<Textarea size="ribbon">` for both collapsed and expanded states (`rows={isExpanded ? 3 : 1}`), styled to look single-line when collapsed, so the DOM node never swaps type when a newline is inserted.
- Remove the `setTimeout(0)` caret-restore in the Ctrl+Enter handler if the node is now stable enough to set the caret synchronously after the controlled update; if React's controlled-value timing still requires it, keep a single well-commented `requestAnimationFrame` and note why. Verify the syntax-highlight overlay (O1) aligns with the textarea metrics in both states.
- Re-validate against the caret-occlusion / click-commits memories: confirm the textarea is the top, focusable, `data-no-grid-pointer` layer and the overlay is `pointer-events-none` beneath the caret.

### Step 7 — Lazy + typed name-box data (O6)
- Type `cachedNamedRanges` with a local `CachedNamedRange` shape and update `createStoreAdapter` params (drop `any[]`).
- Defer the full `loadData()` (sheets + per-sheet tables) until the dropdown opens or the input is focused; keep `namedRangeChanged` → `refreshNamedRanges` live-sync (cheap, names only). Names needed for the `cellAddress` reverse-lookup load eagerly (cheap); the expensive all-sheets table scan goes lazy.

### Step 8 — Type the region boundary (O7) & cleanup (O8)
- Add a typed accessor (e.g. `getRegionKind(activeCellData): RegionKind | undefined`) backed by the contracts' `RegionMeta` type if available, or a narrow local type guard; use it in O2's input mapping. Remove the `as Record<string, unknown>` cast.
- Delete the empty `useEffect` at `FormulaBar.tsx:89–98`. Add `aria-label` to the name-box input ("Name Box"), the name-box trigger button, and the `fx` button ("Insert function"). No visual change.

## Tests and verification gates

- **Unit (vitest, in `__tests__/`):**
  - Existing `name-box-display.test.ts` keeps passing **unchanged** (C3 gate).
  - New `format-formula-bar-display.test.ts` (O2) covering every C2 combination — this is the headline coverage win for the display path.
  - New `resolve-name-box-navigation.test.ts` (O3) covering every C4 branch and the no-op/invalid guards.
- **Component/app-eval (existing harness under `dev/app-eval`):** add scenarios for
  - Multi-line / expanded formula text is visible (O1) — the regression gate for the bug.
  - Type-and-Enter navigation: A1, range, defined name, table, new-name definition, invalid token (validation error shown, focus returns to grid).
  - Forced-text apostrophe, CSE/Data-Table brace display, formula-hidden protected cell, date `editText` display.
  - Ctrl+Enter newline keeps caret position and does not commit; IME composition (CJK) commits correctly; confirm/cancel buttons commit/cancel.
  - Read-only mode hides affordances and rejects edits.
  - No formula-bar re-render storm during selection drag (C8) — assert via the existing render-count instrumentation if available.
- **Static gates:** `tsc` typecheck clean (no new `any`/casts; O6/O7 reduce them), lint clean. Per repo rule, **do not** introduce the literal word "Excel" in new source comments (see `no-excel-in-code` memory) — phrase parity notes neutrally.
- **Manual smoke (app-eval driver):** open the app, edit a formula referencing multiple ranges (highlight colors sync), expand the bar, confirm the formula stays visible and caret stays put; rename a sheet and confirm the cross-sheet reference re-displays.
- *Note: per task constraints this plan does not run any build/test commands; the gates above define what a reviewer/implementer must run.*

## Risks, edge cases, and non-goals

- **Risks**
  - O4 (single consolidated read) changes the timing of two async effects into one; the `cellChanged` settle re-check and the `refreshActiveCellData`-before-read ordering (which fixed stale CSE/Data-Table region metadata) must be preserved or the `{=…}` brace display regresses. Mitigate with the C2 characterization tests + the brace app-eval scenario.
  - O5 (always-textarea) risks subtle layout/caret drift between collapsed and expanded states and must be re-checked against the caret-occlusion memory; ship behind the Step-1/Step-6 app-eval visibility scenarios.
  - O3 moving define-name side effects (`wb.names.add`) behind an intent must keep the explicit `refreshNamedRanges()` after add (event-ordering safety for the test harness, per the existing comment).
- **Edge cases to keep working**
  - Whole-sheet select-all corner → name box shows active cell; full-column/row compact notation; multi-range comma notation.
  - Sheet-qualified references that switch the active sheet before selecting; named range whose refers-to is on another sheet.
  - No-op single-cell re-entry (typing the already-selected cell) → invalid-name message, not silent re-select.
  - Calculated-column structured-reference formula display (`isStructuredReferenceFormula` path).
  - Paste into the currently-selected cell (cellChanged for active position) refreshes the bar.
- **Non-goals**
  - Redesigning the editor state machine, `KeyboardCoordinator`, autocomplete (`use-formula-autocomplete`), `FormulaHighlighter`, or the `name-completion` domain module.
  - Changing `FormulaBarProps`' shape (additions only if strictly required and called out).
  - The AI / NL formula bar (`../nl-formula-bar`) beyond the existing toggle wiring.
  - Any reduced-scope or test-only shim: the display/navigation logic is genuinely extracted into the production `domain/editor` layer, not duplicated for tests.

## Parallelization notes and dependencies on other folders

- **Independent, can land first:** O1 (Step 1) and O8 cleanup — isolated to `FormulaBar.tsx`, no cross-folder coupling.
- **New domain modules:** O2/O3 add files under `mog/apps/spreadsheet/src/domain/editor/` (out of this folder). Coordinate with any concurrent work on that folder (e.g. `name-completion.ts`, `formula-range-parser.ts`) to avoid barrel/export collisions; the new files are additive.
- **Type boundary (O7):** depends on whether `ActiveCellData.metadata.region` has a typed `RegionMeta` in the SDK contracts (`@mog-sdk/contracts/rendering` or `core`). If not yet exported, this couples to the contracts/types packages (plans 001–008 territory) — fall back to a local narrow type guard to stay self-contained.
- **Shared hooks/coordinator:** O4/O5 rely on `ws.refreshActiveCellData`, `ws.viewport.getActiveCellData`, `coordinator.input.focusGrid`, and the editor actions — all consumed unchanged; no edits needed there.
- **Sequencing within this folder:** Step 2 (characterization tests) gates Steps 3–4; Step 5 should precede final wiring of Step 3 (display function consumes the consolidated read). Steps 6–8 are independent of 3–5 and can proceed in parallel by a second implementer once Step 1 lands.

## Status

Actionable. The folder exists and evidence is sufficient; no blocking unknowns except the one optional contracts-package dependency noted in O7 (which has a self-contained fallback).
