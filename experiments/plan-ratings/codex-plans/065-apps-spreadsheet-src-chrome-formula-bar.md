# 065 - Formula Bar Editing and Display Path Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/chrome/formula-bar`

Queue item: 65

Scope reviewed:

- `FormulaBarContainer.tsx`, the production bridge from workbook/worksheet data, editor state, focus state, formula autocomplete, and UI store state into the formula bar surface.
- `FormulaBar.tsx`, the presentational input/textarea, formula highlighter overlay, edit controls, formula bar panel controls, IME handlers, and local keyboard behavior.
- `NameBoxDropdown.tsx`, the name box display, dropdown, navigation, name creation, sheet/table/name lookup, validation, and context menu surface.
- `FormulaBarContextMenu.tsx`, the right-click menu for formula bar text operations and Insert Function.
- `name-box-display.ts` and `__tests__/name-box-display.test.ts`, the only current local unit coverage.
- Adjacent production contracts consumed by this folder: `FormulaBarProps` in `apps/spreadsheet/src/internal-api.ts`, `useFormulaAutocomplete`, `FunctionSuggestions`, `FormulaArgumentHint`, `FormulaHighlighter`, `formula-bar-refresh` events, editor state/actions, focus and pane-focus commands, `Worksheet`/`Workbook` active cell APIs, `name-completion`, `formula-metadata-cache`, and UI store visibility/expand/NL formula-bar state.

Out of scope for this folder-specific plan:

- Rewriting the editor state machine, keyboard coordinator, workbook storage, compute formula evaluation, or canvas grid renderer.
- Replacing the natural-language formula bar implementation except where this folder toggles or refreshes it.
- Moving name-range, table, or sheet durable state into this folder. The formula bar may display and navigate that state, but Workbook/Worksheet APIs remain the source of truth.

This is public Mog source work in `../mog`. The planning artifact stays only in `mog-internal`.

## Current role of this folder in Mog

`chrome/formula-bar` is the spreadsheet app's top chrome path for active-cell readback and source editing. It is not only a text field. It coordinates four user-visible contracts:

- Active cell source display: formulas, raw values, date edit text, forced-text apostrophe display, protected hidden formulas, CSE/Data Table brace display, calculated-column formulas, and source refresh after workbook mutations.
- Formula editing: clicking the formula bar enters editor-machine Edit Mode with formula-bar focus ownership, mirrors DOM text/caret/selection into the editor actor, routes autocomplete and argument hints, supports IME composition, and leaves Enter/Tab/Escape navigation to the keyboard coordinator except for Ctrl/Cmd+Enter newline insertion.
- Name box navigation: displays the active selection, defined name, range, full row/column, whole sheet, or multi-range; navigates to A1/range/sheet-qualified references, defined names, tables, and sheets; can define a new workbook name from the current selection.
- Chrome controls: confirm/cancel/fx buttons, hide/reopen integration through the View ribbon, formula bar expand/collapse, AI formula bar toggle, context menu, and read-only/viewer behavior.

The current implementation already has several important production foundations:

- `FormulaBarContainer` uses granular active-cell and editor subscriptions rather than broad selection subscriptions, preserving drag/render isolation.
- Formula-bar entry calls `editorActions.startEditing(..., 'formulaBar', cursorPosition)`, preserving Edit Mode semantics where arrow keys move the caret rather than inserting formula references.
- Active cell data comes through `Worksheet`/`Workbook` APIs, including `ws.getCell`, `ws.getRawCellData`, `ws.refreshActiveCellData`, and `ws.viewport.getActiveCellData`.
- Formula hidden/protected display, `forcedTextMode`, and `metadata.region.kind` are already recognized in the display path.
- Formula refresh events exist for mutation paths where the active cell position does not change.
- Name-box display formatting has pure unit coverage for whole-sheet, full-column, full-row, ordinary range, and multi-range display.

The main weakness is that the folder's contracts are implicit and mixed across React components. Formula source projection, display formatting, edit-text mapping, async refresh generation, DOM text control behavior, autocomplete rendering, and name-box directory lookup are all embedded in component bodies. This has led to repeated production fixes in adjacent reports: formula-bar click focus ownership, cursor mirroring, autosum refresh, cross-sheet formula-bar activity, structured-reference versus A1 calculated-column readback, and name-box cache/race behavior.

Concrete observed gaps in this source snapshot:

- Multiline formula rendering switches to `Textarea`, but formula text can remain `text-transparent` while the syntax highlighter overlay is only rendered for non-multiline formulas.
- `inputRef`, context-menu actions, and handler casts still mostly assume `HTMLInputElement`, even though expanded or newline-containing formulas render a `HTMLTextAreaElement`.
- Formula autocomplete computes both function suggestions and name/table/sheet suggestions, but the formula-bar popup only mounts when function suggestions exist and only passes function suggestions to `FunctionSuggestions`.
- `NameBoxDropdown` caches named ranges, tables, and sheets with loose `any` types and only refreshes named ranges on events; table and sheet directory freshness is implicit.
- Name-box navigation and name creation still build some references by string concatenation instead of a single typed range/reference formatter, which is fragile for quoted sheet names and future multi-range naming.
- Formula-bar text operations mutate the DOM input and dispatch an `input` event; caret placement and editor-machine cursor updates can drift, especially for async clipboard and textarea paths.
- Local tests do not cover `FormulaBar`, `FormulaBarContainer`, context menu text mutations, autocomplete, focus/pane ownership, hidden formulas, brace display, forced text, refresh events, or name-box navigation behavior through real UI input.

## Improvement objectives

1. Make active-cell formula-bar readback an explicit, typed view-model contract that separates durable source, edit text, display text, protection/hidden state, formula region metadata, forced text, calculated-column source policy, and cursor-offset mapping.
2. Replace input-versus-textarea casts with one `FormulaBarTextControl` contract that supports both DOM element types for value changes, selection mirroring, composition, context menu, autocomplete anchoring, multiline scrolling, and focus restoration.
3. Fix formula rendering as a complete family: single-line formulas, multiline formulas, wrapped long formulas, brace-wrapped array/data-table formulas, forced text, hidden formulas, and formula range colors must all display legibly and keep caret/highlight alignment.
4. Complete formula-bar autocomplete by rendering the same function/name/table/sheet suggestion set that the shared autocomplete hook computes, with consistent selection indexes and accept behavior.
5. Replace ad hoc refresh counters with a named formula-bar projection/invalidation layer that subscribes to workbook, worksheet, editor, and explicit refresh signals with generation guards.
6. Make the name box a typed navigator over Workbook/Worksheet directory data rather than a loosely typed cache with fallback races.
7. Make popovers, context menus, argument hints, and dropdowns non-disruptive to formula editing, toolbar clicks, and keyboard mode ownership.
8. Add focused unit/contract tests and browser-backed app-eval coverage that exercise the production UI paths through keyboard, mouse, clipboard, IME/composition where feasible, and real Workbook/Worksheet APIs.

## Production-path contracts and invariants to preserve or strengthen

- The editor state machine remains the source of editing state, value, caret, text selection, formula context, IME composition state, and commit/cancel behavior.
- Formula-bar entry must stay `entryMode: 'formulaBar'`, which means Edit Mode. Arrow keys move within text unless autocomplete/pickers intentionally intercept them.
- Document-level keyboard coordination continues to own Enter, Tab, Escape, and sheet-switch shortcuts during editing. The formula bar only owns formula-bar-specific text input behavior such as Ctrl/Cmd+Enter newline insertion.
- The formula bar must not write cells directly. Commits, cancels, formula insertion, function dialogs, and protected edit feedback go through the unified action/editor/coordinator path.
- Workbook/Worksheet APIs remain the durable data source for active-cell raw value, computed value, formula, edit text, table calculated-column metadata, names, sheets, tables, and protection metadata.
- Protected hidden formulas display the calculated result, not the formula source, while the protected state is active.
- `metadata.region.kind` drives array/data-table display policy: `cseArray` and `dataTable` show `{=...}` braces; dynamic array spill formulas do not gain legacy braces.
- Formula source readback for projected or non-per-cell-source cells must be systematic: calculated columns, CSE arrays, dynamic arrays, data tables, pivot-derived formulas where exposed, and future projection families need one source-resolution policy rather than case-by-case display hacks.
- Forced text mode shows the leading apostrophe in the formula bar while preserving literal text behavior.
- Display text and edit text may differ. Cursor positions passed from display-only chrome into edit mode must be mapped to the editor value, especially for brace-wrapped formulas, apostrophe prefixes, hidden formulas, and any future source indicators.
- `useActiveCell` granularity and avoidance of full selection subscriptions are production performance contracts. Selection drag, fill-handle drag, scroll, row/column resize, and range selection should not re-render the entire formula bar unless the active cell or editor state requires it.
- Formula-bar refresh after same-cell mutations must be reliable and targeted. Mutation paths should not need to know React implementation details to keep source display current.
- Focus stack and pane-focus state must agree. Formula-bar focus suppresses inline editor DOM focus; commit/cancel or failed protected edit returns focus predictably to the grid.
- Name-box navigation must use selection commands and sheet switching commands, then return focus to the grid through production input coordination.
- Name-box and formula-bar tests must use real UI input paths for E2E coverage. Direct state mutation or direct handler invocation is useful for unit tests only, not as proof that the feature works.
- Read-only mode hides or disables edit affordances and must prevent formula bar, name box, and context-menu write paths from mutating workbook state.

## Concrete implementation plan

1. Add a formula-bar contract inventory.

   - Create a test-backed inventory for all display/edit cases this folder owns: blank cell, literal value, date/time edit text, formula, formula error, forced text, hidden formula, CSE array, dynamic array spill, Data Table, structured-reference calculated column, A1 calculated column, protected/read-only cell, multiline formula, and cross-sheet formula reference.
   - For each case, record source API, display text, edit text, formula-highlighting eligibility, cursor mapping, refresh trigger, and expected tests.
   - Use this inventory to prevent future changes from adding a formula source family without a formula-bar disposition.

2. Extract active-cell projection into a typed view model.

   - Add a module such as `formula-bar-cell-view-model.ts` or `use-formula-bar-cell-view-model.ts`.
   - Inputs: workbook, active sheet id, active cell, editor state, read-only state, formula-bar refresh stream, and relevant worksheet/workbook revisions.
   - Output a typed model with fields like `cellAddress`, `displayText`, `editText`, `isFormula`, `formulaSourceKind`, `shouldHideFormula`, `calculatedDisplayText`, `regionKind`, `shouldBraceWrap`, `isForcedText`, `formulaHidden`, `readOnly`, `referenceColors`, and `displayToEditCursor(position)`.
   - Keep `FormulaBarContainer` as a composition layer that wires the model to `FormulaBar`, autocomplete, focus, dispatch, and context menu.
   - Replace the broad `structureVersion` counter with named invalidation sources: active-cell position, targeted formula-bar refresh events, same-cell cell changes, sheet rename/reference rewrite, paste completion, structural changes affecting the active cell, and active-cell metadata refresh.
   - Guard all async reads with sheet/cell/generation checks so late `getCell`, `getRawCellData`, table-context, or active-cell metadata reads cannot repaint the formula bar for a newer active cell.

3. Normalize formula source resolution.

   - Define a single source-resolution order for formula-bar readback. It should distinguish selected-cell raw formula, structured-reference calculated-column formula, A1 calculated-column raw formula, array/data-table region source, and future projected-cell source metadata.
   - Promote any missing region/source metadata requirement to the Worksheet API contract instead of reconstructing it in chrome.
   - Add regression coverage for the known calculated-column distinction: structured-reference formulas can use table metadata; A1-style calculated columns must show the selected row's adjusted raw formula.
   - Add coverage for source families whose durable source is not simply `rawData.formula`, especially CSE arrays, dynamic array spills, and Data Table member cells.

4. Build a unified text-control component.

   - Extract `FormulaBarTextControl` from `FormulaBar.tsx` with a ref type of `HTMLInputElement | HTMLTextAreaElement`.
   - Its public contract should include `value`, `isEditing`, `isExpanded`, `readOnly`, selection/caret callbacks, context-menu callback, autocomplete anchor registration, composition callbacks, and a command API for text operations.
   - Replace input/textarea casts in `FormulaBar`, `FormulaBarContainer`, and `useFormulaBarContextMenuActions` with the union element type.
   - Make `onChange` and all DOM text mutations report the post-mutation caret position after selection has been updated.
   - Remove the no-op focus effect in `FormulaBar.tsx` and replace it with explicit focus behavior keyed to formula-bar edit entry. It must not steal focus from cell-based editing.

5. Fix formula highlighting for all text-control modes.

   - Make multiline formulas visible immediately. Either render a textarea-compatible highlighter overlay with synchronized scroll/wrap metrics or keep text visible when multiline highlighting is not available.
   - If multiline highlighting is implemented, synchronize font, padding, line height, scrollTop/scrollLeft, word wrapping, and caret color between the textarea and overlay.
   - Keep single-line highlighting aligned with the input's actual font metrics and horizontal scrolling.
   - Ensure range-color tokens, parenthesis matching, and formula argument hints stay correct as the user edits mid-string, inserts newlines, selects ranges from the grid, or expands/collapses the bar.

6. Complete formula-bar autocomplete rendering.

   - Change the formula-bar popup condition from `functionSuggestions.length > 0` to `totalSuggestionCount > 0`.
   - Pass `nameSuggestions` into `FunctionSuggestions` and make click selection use the same insertion formatting as `acceptCurrentSuggestion`.
   - Verify selected index math across combined function and name/table/sheet lists. The visual list and editor-machine selected index must agree after ArrowUp/ArrowDown.
   - Keep Tab as accept and Enter as commit, matching the current Excel-parity contract.
   - Ensure argument hints and suggestion popovers do not intercept unrelated toolbar/ribbon clicks. If a tooltip overlaps chrome, it should either be pointer-passive, repositioned, or dismissed by the focus transition.

7. Replace context-menu DOM mutation drift with text-control commands.

   - Move cut/copy/paste/select-all logic to a `FormulaBarTextCommandService` that operates on `HTMLInputElement | HTMLTextAreaElement`.
   - Use `setRangeText` or equivalent ordered operations so value, DOM selection, React input event, and editor-machine cursor all agree.
   - Preserve browser activation constraints for clipboard calls; do not insert awaits before activation-sensitive operations.
   - Recompute `hasSelection` when the menu opens, support textarea selection, restore focus after menu actions, and disable write actions in read-only mode.
   - Display platform-appropriate shortcuts where the app already has a platform abstraction.

8. Rework the name-box data and navigation contract.

   - Extract `NameBoxDirectory` and `NameBoxNavigator` modules.
   - Type named ranges, tables, and sheets instead of using `any[]`; adapt `wb.names.list/get`, `wb.getSheetNames/getSheet`, and `ws.tables.list` into one typed directory snapshot.
   - Subscribe to all relevant workbook events: named range changes, sheet add/delete/rename/reorder, table create/update/delete/rename, and structure changes that affect displayed selection.
   - Remove the direct API lookup fallback race by making the directory refresh contract explicit. Direct `wb.names.get` can remain as a deliberate authoritative lookup, but it should be part of the navigator contract, not an emergency cache-miss branch in a component.
   - Make the popover fully controlled so edit mode, dropdown open state, Radix trigger behavior, validation errors, and context menu cannot conflict.
   - Use shared A1/range/reference formatting helpers for name creation and navigation. Sheet names with spaces, quotes, punctuation, and case differences must round-trip correctly.
   - Define exact behavior for typing the current cell address, a valid new name, an invalid name, a full row/column reference, a whole-sheet reference, a multi-range display, a sheet-only suggestion, a table name, and a sheet-qualified range.

9. Clarify chrome control and read-only behavior.

   - Keep confirm/cancel/fx/hide/AI-toggle/expand controls in `FormulaBar`, but give their props typed contracts separate from `FormulaBarProps` if they are app-chrome controls rather than core formula-bar edit props.
   - Ensure read-only mode disables editing, context-menu write actions, name creation, and function insertion while preserving safe navigation/readback where appropriate.
   - Preserve View ribbon reopen behavior for `panel-formula-bar-close` and `panel-formula-bar-reopen`.
   - Use existing icon system components where available for expand/collapse and AI toggle instead of local SVGs if matching icons exist.

10. Update production callers directly.

   - If `FormulaBarProps`, autocomplete, context-menu actions, or name-box helpers need better public types, update the consuming production callers in the same workstream.
   - Do not keep duplicate old/new formula-bar APIs or compatibility shims. There are no external users to preserve in this app-internal chrome boundary.

## Tests and verification gates

Required focused package gates for implementation:

- `pnpm --filter @mog/app-spreadsheet test -- src/chrome/formula-bar`
- `pnpm --filter @mog/app-spreadsheet test -- src/hooks/editing/use-formula-autocomplete.ts src/components/editor/FunctionSuggestions.tsx`
- `pnpm --filter @mog/app-spreadsheet typecheck`

Run repo-level `pnpm typecheck` if public `internal-api`, Workbook/Worksheet contract types, shared autocomplete types, or action dependency types change.

Focused unit and integration tests to add:

- Formula-bar view model: blank, literal, date edit text, formula, formula error, hidden protected formula, forced text, CSE brace display, dynamic-array non-brace display, Data Table brace display, structured-reference calculated column, A1 calculated column, and source/display/edit cursor mapping.
- Async projection: stale `getCell`, `getRawCellData`, `refreshActiveCellData`, table-context, and refresh-event results are ignored after active sheet/cell changes.
- Text control: input versus textarea ref handling, click-to-edit cursor position, mid-string edit, Ctrl/Cmd+Enter newline, expanded/collapsed mode, multiline formula visibility, selection mirroring, IME composition, and read-only behavior.
- Formula highlighting: single-line overlay alignment, multiline/wrapped display, range-color token positions, parenthesis matching, horizontal/vertical scroll synchronization, and transparent-text fallback safety.
- Autocomplete: function-only, name-only, mixed function/name/table/sheet suggestions, ArrowUp/ArrowDown index sync, Tab accept, Enter commit, Escape dismiss, click accept, and formula-bar anchoring.
- Context menu: cut/copy/paste/select-all with input and textarea, post-action caret position, async clipboard path, fallback path, focus restoration, and read-only disabled state.
- Name box: selection formatting, exact named-range reverse lookup, table/sheet/name suggestions, A1/range/sheet-qualified navigation, full row/column navigation, invalid name validation, current-cell no-op validation, valid new name creation, quoted sheet names, table navigation, and focus return to grid.
- Chrome controls: close/reopen, expand/collapse, AI formula-bar toggle, fx dialog routing, confirm/cancel focus reset, and read-only hidden/disabled affordances.

Production-path app-eval/E2E gates must use real UI input:

- Formula-bar edit entry and focus: `formula-bar-click-enters-formula-edit`, `click-formula-bar-edit`, and a mid-string formula-bar edit scenario.
- Cross-sheet formula editing: `cross-sheet-formula-bar-stays-active`, cross-sheet reference insertion from formula-bar focus, sheet switch during edit, and Escape/cancel selection restoration.
- Formula refresh after same-cell mutations: autosum, insert auto function, NL formula accept, data-analysis writes, structure rename/reference rewrite, paste into active cell, and commit/cancel.
- Formula source readback: structured-reference table formulas, A1 calculated columns, CSE arrays, dynamic array spills, Data Table member cells, hidden formulas on protected sheets, and forced text.
- Autocomplete: typing `=SU`, using ArrowDown/ArrowUp, accepting with Tab, accepting a defined name/table/sheet suggestion, and confirming Enter commits rather than accepts.
- Name box: `name-box-jump`, `nr-define-via-name-box`, named range dropdown selection, sheet-qualified range navigation, invalid-name alert, and focus-return typing into the grid after Enter/Escape.
- Context menu and clipboard: right-click formula bar, cut/copy/paste/select-all through the menu and keyboard shortcuts, including expanded multiline mode.
- Chrome visibility: View ribbon formula-bar checkbox, panel close/reopen button, expand/collapse shortcut, and AI formula-bar toggle.

For browser checks, also inspect DOM readback from `[data-formula-bar] input, [data-formula-bar] textarea` so app-eval helpers prove the actual user-visible text control value.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Display text and edit text can intentionally differ. Cursor mapping around `{=...}`, leading apostrophes, hidden formula results, and future source indicators is easy to get wrong.
- Formula-bar focus and pane-focus must stay synchronized. A partial fix can reintroduce the inline editor stealing focus from formula-bar edits.
- Async active-cell reads can race with sheet switches, selection changes, paste completion, structure changes, and remote/collab updates. Generation checks are mandatory.
- Multiline syntax highlighting is sensitive to font metrics, wrapping, scroll offsets, and textarea browser behavior.
- Clipboard operations are activation-sensitive. Abstractions must preserve synchronous browser permission behavior.
- Name-box navigation can switch sheets and selection in one user action. Tests must prove focus and viewport-follow behavior after both operations.
- Sheet names and defined names have Excel-specific quoting/validation rules. Avoid local string construction when shared helpers or Workbook APIs can own the contract.
- Popovers and argument hints can block toolbar or ribbon clicks if they use pointer-active overlays in the wrong place.
- Completing source readback for projected cells may require Worksheet API metadata that is not yet exposed. If so, the correct fix is to add that public API surface, not to infer durable source from rendered values.

Non-goals:

- Do not move durable workbook, name, table, sheet, or formula state into React state or UI store.
- Do not bypass editor/action/coordinator commit paths from formula-bar UI.
- Do not add test-only formula-bar readback or mock-only navigation paths.
- Do not optimize benchmark-only paths.
- Do not remove Excel-parity behavior to reduce scope.
- Do not make `mog` depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

Natural parallel workstreams after the contracts above are written:

- Agent A: active-cell view-model/projection module, source-resolution inventory, async generation guards, and formula-bar display tests.
- Agent B: `FormulaBarTextControl`, multiline formula visibility/highlighting, input/textarea ref types, IME/caret tests, and context-menu command service.
- Agent C: autocomplete rendering completion, argument-hint/popup behavior, and function/name/table/sheet suggestion tests.
- Agent D: name-box directory/navigator extraction, typed Workbook/Worksheet directory refresh, controlled popover behavior, quoted-reference formatting, and name-box tests.
- Agent E: production UI/eval verification through real keyboard, mouse, clipboard, and focus paths.

Dependencies:

- `apps/spreadsheet/src/internal-api.ts` for `FormulaBarProps` and reference color types.
- `apps/spreadsheet/src/hooks/editing/use-formula-autocomplete.ts`, `apps/spreadsheet/src/components/editor/FunctionSuggestions.tsx`, `FormulaArgumentHint.tsx`, and `FormulaHighlighter.tsx` for suggestion and highlighting behavior.
- `apps/spreadsheet/src/systems/grid-editing/**` and editor hooks for edit state, cursor, selection, IME, formula context, and commit/cancel semantics.
- `apps/spreadsheet/src/systems/input/**`, `useFocus`, and pane-focus commands for focus-stack and F6/pane navigation behavior.
- `apps/spreadsheet/src/actions/handlers/**`, `dispatch`, and `formula-bar-refresh` events for mutation-triggered refresh and dialog actions.
- `apps/spreadsheet/src/domain/editor/name-completion.ts`, `formula-metadata-cache.ts`, and shared A1/named-range helpers for name-box and autocomplete directory behavior.
- Public Workbook/Worksheet APIs in contracts/kernel for active cell data, raw cell data, calculated-column context, names, sheets, tables, formula region metadata, and projected-cell source metadata.
- `apps/spreadsheet/src/chrome/toolbar/**`, `ui-store`, and `nl-formula-bar` for visibility, expand/collapse, and AI formula bar integration.
- `mog-internal/dev/app-eval/scenarios/**` for real-input browser verification scenarios.
