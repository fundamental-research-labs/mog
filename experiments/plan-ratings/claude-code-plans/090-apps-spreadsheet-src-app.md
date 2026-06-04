# 090 — Improve `mog/apps/spreadsheet/src/app` (app composition and coordinator wiring)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/app`
- **Size:** 7 files, ~975 lines. Breakdown:
  - `CoordinatorProvider.tsx` (833 lines) — the live composition root that bridges the XState coordinator to React/DocumentContext.
  - `coordinator-keyup-capture.ts` (21 lines) + `__tests__/coordinator-keyup-capture.test.ts` (50 lines) — the only extracted, unit-tested piece of the keyboard layer.
  - `SpreadsheetIndicators.tsx` (60 lines) — export-notification overlay.
  - `Shell.tsx` (52 lines), `ViewSwitcher.tsx` (65 lines), `RecordDetailSidebar.tsx` (82 lines) — a partially-built multi-view shell.
- **In scope (edit targets):**
  - **Composition root:** `CoordinatorProvider.tsx` — `SpreadsheetCoordinatorProvider`, the four internal setup wrappers (`PaneNavigationSetup`, `UndoSelectionCoordinatorSetup`, `KeyboardCaptureSetup`, `RangeSelectionCoordinatorSetup`), `CollabPresenceBridge`, the `PaneNavigationContext`/`usePaneNavigation` surface, the inline `editorDependencies` factory, and the document-level keydown/keyup capture.
  - **Keyboard capture modules:** `coordinator-keyup-capture.ts` (and a new sibling for keydown, see plan).
  - **Indicators:** `SpreadsheetIndicators.tsx`.
  - **Multi-view shell:** `Shell.tsx`, `ViewSwitcher.tsx`, `RecordDetailSidebar.tsx` (production-path decision — see Objective 5).
- **Out of scope (named for coupling, not edited here):**
  - `index.tsx` — the app entry that renders `SpreadsheetCoordinatorProvider` (`:758`) and `SpreadsheetIndicators` (`:817`). It is the call site of two wiring defects diagnosed below; touching it is a *cross-folder* dependency (the file lives in `src/`, not `src/app/`), flagged in Parallelization.
  - `systems/input` (`KeyboardCoordinator`, `setupRangeSelectionCoordination`, `setupUndoSelectionCoordination`, `isGlobalShortcut`) — the routing engine this folder *configures*; treated as a fixed contract (it is the subject of plan 097).
  - `coordinator/` (`createActorAccessLayerFromBundle`, `sheet-coordinator.ts`, `coordinator/types.ts`), `hooks/shared/use-coordinator.tsx` (`BaseCoordinatorProvider`), `actions/dispatcher`, `selectors`, `dialogs/formulas` (`CircularReferenceDialog`), `coordinator/mutations/tables`, `coordinator/tables/calculated-column-context`, `@mog/shell`, `@mog-sdk/contracts/*` — contracts consumed by the composition; changes that ripple into them are noted as dependencies.
  - `views/` (`ViewContainerById`, `HybridViewContainer`, `VIEW_REGISTRY`) — the *other* view-composition surface that the orphaned `Shell.tsx` duplicates; relevant to Objective 5.

## Current role of this folder in Mog

This folder is the **composition root** of the spreadsheet app: the layer where the headless XState coordinator (actors for selection, editor, clipboard, renderer, objects, focus, paneFocus) is married to the React tree, the CRDT `Workbook`, the UI store, platform/shell services, and the modal-dialog surface. It is "wiring," not feature logic — but it is the wiring through which *every* keystroke, every editor commit, and every cross-machine coordination flows.

Concretely, `SpreadsheetCoordinatorProvider` (the only production export, rendered once at `index.tsx:758`) does five things:

1. **Builds `editorDependencies`** (`CoordinatorProvider.tsx:613-782`) — the bridge that lets the headless editor machine write cells (`setCellValue`/`setDateValue`/`setArrayFormula`), run validation (data-validation rules, circular-reference detection, formula-syntax checks), and surface modal dialogs (validation strict/warning/info, formula-error, circular-reference) by calling UI-store actions.
2. **Mounts `BaseCoordinatorProvider`** (`:786`) with `initialSheetId`, platform OS, `uiStoreApi`, clipboard dependencies (cut-overwrite confirm, protection-error alert), `workbook`, `readOnly`.
3. **Installs document-level keyboard capture** (`KeyboardCaptureSetup`, `:224-500`) — the single capture-phase `keydown`/`keyup` entry point for navigation keys during editing.
4. **Wires four coordination setups** as nested wrappers: undo-selection restore, range-selection mode, F6 pane navigation, collab-presence broadcast.
5. **Owns the circular-reference dialog** (`:603-609`, `:824-829`) and the pane-navigation context (`:62-101`).

The remaining files split into one live helper (`SpreadsheetIndicators`, an export-notification overlay) and a **non-wired multi-view shell** (`Shell`/`ViewSwitcher`/`RecordDetailSidebar`) — see Evidence.

## Evidence (observed in the current tree)

- **`CoordinatorProvider.tsx` is an 833-line god-file mixing four unrelated concerns, of which only the trivial one is extracted and tested.** The 21-line keyup handler was pulled into `coordinator-keyup-capture.ts` with a dedicated regression test precisely because "the `preventDefault`/`stopPropagation`-on-`handled=true` contract is unit-testable independently of the heavyweight `KeyboardCaptureSetup` useEffect" (`coordinator-keyup-capture.ts:1-10`). The far larger and far riskier **keydown** routing tree (`:292-450`, ~160 lines) was *not* extracted and has **no unit test**. The same justification applies with more force.

- **The keydown routing tree is a dense, branch-heavy decision policy with subtle `preventDefault`/`stopPropagation` semantics and no isolation.** `handleKeyDownCapture` (`:292-450`) interleaves: an IME guard (`:294`), an editor-state read (`:301-306`), a not-editing branch with four sub-cases (global shortcut on non-editable/non-dialog target `:313-324`; BODY/HTML focus with an Escape-bubbles-for-open-dialog carve-out `:328-345`; Ctrl+PageUp/Down sheet nav from chrome `:350-358`), and an editing branch with five more sub-cases (focus-layer exclusion `:365-380`; formatting shortcuts B/I/U with text selection `:389-405`; printable-into-formula `:408-423`; Ctrl+Enter newline `:430-433`; suggestions/picker-open deferral `:437-440`). Each branch independently decides whether to call `preventDefault()`/`stopPropagation()`. The duplicated `isEditableKeyboardTarget`/`isDialogKeyboardTarget`/`keyboardEventTargetElement` helpers (`:75-89`) hint that this is reusable policy trapped inside a `useEffect` closure. This is the highest-complexity, lowest-coverage code in the folder and gates correctness of well-known regressions (the "Enter moves down 2 cells" bug, `:218`; Windows Alt-menu focus theft, `:464-475`; `dismissCommentPopover`, `:330-336`).

- **The `editorDependencies` factory (170 lines, `:613-782`) is inlined in the provider and is therefore not independently testable.** It owns nontrivial product logic that has nothing to do with React composition: the data-validation `errorStyle` → `enforcement` vocabulary translation (`:668-673`), the datetime fraction-preservation path that dynamically imports `@mog/spreadsheet-utils/datetime` (`:634-650`), the calculated-column auto-fill on `=`-prefixed commits (`:627-632`), and the implicit structured-reference qualification used to decide whether a syntax error is real (`:696-715`). It deliberately uses `async`/`await` (not `.then(() => {})`) so the editor machine can route Rust rejections like `ComputeError::PartialArrayWrite` through `onError` (`:618-624`) — a load-bearing contract buried inside a `useMemo`.

- **`RangeSelectionCoordinatorSetup` ships two TODO no-op callbacks; the range-picker dialog collapse/restore behavior is unimplemented.** `onDialogMinimize`/`onDialogRestore` are empty bodies with comments "TODO: Implement actual dialog minimize/restore callbacks … For now, these are no-ops" (`:527-534`). The Excel-parity behavior where a range-argument dialog collapses to a thin range-picker while the user drags a selection, then restores, is wired through the coordinator but never executed.

- **`SpreadsheetIndicators` is fed constant nulls at its only call site — the export-notification UI is dead.** `index.tsx:817` renders `<SpreadsheetIndicators exportState={{ progress: 0 }} exportNotification={null} />`. With `exportNotification={null}` the component always returns an empty fragment (`SpreadsheetIndicators.tsx:42`). The export flow itself is live (`ToolbarContainer onExport={handleExport} isExporting={isExporting}` at `index.tsx:776`), but its progress/notification state is never threaded into the indicator. The comment at the call site ("calculation progress, export notifications") over-promises a feature that cannot render.

- **`SpreadsheetCoordinatorProvider` is rendered without `onUIAction`, silently disabling a keyboard-routed dialog protocol.** `index.tsx:758` is `<SpreadsheetCoordinatorProvider>` with no `onUIAction` prop, so the prop is `undefined`, flows to `coordinator.input.onUIAction` (`:242`, `:280`, `:793`), and reaches action handlers as `deps.onUIAction === undefined`. Multiple chart-format and name-picker routes guard on this and silently no-op (`actions/handlers/charts.ts:1257,1281,1309,1335,1432,1509,…`; `keyboard/definitions/formula.ts:209` "Routes to onUIAction to show name picker dialog"). The protocol is mid-migration — `charts.ts:271` notes newer handlers "Replace the unwired `onUIAction` JSON-string protocol" with direct state — so the `app/` surface is carrying a half-deprecated prop that is dead on the production path.

- **`Shell.tsx`, `ViewSwitcher.tsx`, and `RecordDetailSidebar.tsx` are an orphaned, half-built multi-view shell with zero render/import callers.** `rg` finds no `<Shell`, no import of `app/Shell`, and no `initialViewId` consumer anywhere outside `Shell.tsx` itself; the same holds for `ViewSwitcher`/`RecordDetailSidebar` (only the `ui-store/slices/navigation` open/close *actions* exist, never the component). They are riddled with placeholders: `Shell.tsx:17-19` "TODO: Once ShellCoordinator is implemented…", `:41` "TODO: Add Toolbar", `:43` "TODO: Use ViewContainer with adapter once coordinator is ready" (it falls back to `ViewContainerById`); `RecordDetailSidebar.tsx:63` "TODO: Load and render record fields using Workbook API" with a hardcoded "Record fields will be displayed here…" stub (`:74-76`); `ViewSwitcher.tsx:38-40` "viewId === viewType … In the future, this will create/select a specific view instance." Meanwhile a parallel, *live* view-composition surface already exists in `views/` (`ViewContainerById`, `HybridViewContainer`, `VIEW_REGISTRY`). The folder therefore hosts a divergent half-architecture that duplicates `views/` and never runs.

- **Two type-safety escapes weaken the DAG boundary.** The keyboard dependency wiring casts an arbitrary string to the action union — `dispatch: (action, deps, payload) => dispatch(action as ActionType, deps, payload)` (`:263`) — and passes the full UI store where a narrower `KeyboardUIStore` is expected, papered over by a comment rather than a typed adapter ("UIState is a superset of KeyboardUIStore — cast for DAG boundary compatibility", `:259-260`). Both move type errors from compile time to runtime.

- **Five nested wrappers each render `<>{children}</>`.** `KeyboardCaptureSetup → UndoSelectionCoordinatorSetup → RangeSelectionCoordinatorSetup → PaneNavigationSetup → CollabPresenceBridge` (`:814-822`). Each is a thin effect-only component returning its children; the nesting is incidental, not semantic (none depends on another's render output), which makes the composition order look load-bearing when it is not.

## Improvement objectives

1. **Extract the keydown routing policy into a pure, unit-tested module** mirroring the existing `coordinator-keyup-capture.ts`, so the navigation-key interception contract is verifiable independent of a live coordinator/store/workbook.
2. **Extract the `editorDependencies` factory** into its own module with explicit injected callbacks, making the validation/enforcement/commit logic testable and shrinking the provider to actual composition.
3. **Implement the range-selection dialog collapse/restore callbacks** so the range-picker behavior the coordinator already drives actually executes.
4. **Repair the two index-level wiring defects** so they reflect intent: either thread real export-notification state into `SpreadsheetIndicators` (and the live `onUIAction` handler), or remove the dead prop surfaces. The decision is driven by product intent for each feature; both ends of the contract must agree.
5. **Resolve the orphaned multi-view shell** by converging `Shell`/`ViewSwitcher`/`RecordDetailSidebar` onto the canonical, live composition (`SpreadsheetCoordinatorProvider` + the `views/` container family) — completing the wiring on the production path, not leaving two divergent half-shells.
6. **Strengthen the DAG-boundary types** (`dispatch` string cast, UI-store superset cast) with typed adapters/guards.

## Production-path contracts and invariants to preserve or strengthen

- **Keyboard single source of truth.** The capture-phase document listener (`{ capture: true }`, `:480-481`) is the *only* handler for navigation keys (Enter/Tab/Escape) during editing; editors handle text input only (`:214-222`). `preventDefault()`+`stopPropagation()` fire *only* when the coordinator returns `handled = true`. Preserve exactly — this is the "Enter moves down 2 cells" regression guard.
- **IME guard is first.** `e.isComposing || e.keyCode === 229` short-circuits before any routing (`:294`). Must remain the first check in any extracted policy.
- **Windows Alt-menu suppression.** Keyup `preventDefault` on Alt-tap promotion (`:464-475`); already locked by `coordinator-keyup-capture.test.ts`. Any keydown refactor must not regress the keyup contract.
- **Escape-with-open-dialog bubbles.** When focus is on BODY and a `[role="dialog"]` is present, Escape must *not* be consumed here (`:336-338`) so popovers (e.g. `CommentPopover`) can self-dismiss.
- **Editor commit preserves rejections.** `setCellValue`/`setDateValue`/`setArrayFormula` stay `async`/`await` so Rust errors (`PartialArrayWrite`) reach the machine's `onError` (`:618-624`, `:762-773`). Do not reintroduce `.then(() => {})`.
- **Validation enforcement mapping.** `errorStyle` `stop|warning|information|none` → `strict|warning|info|null` (`:662-680`), with `none` auto-succeeding, is a contract with the editor machine; preserve the exact mapping.
- **Circular-reference flow.** `onCircularReferenceWarning` must enable iterative calculation via `workbook.setIterativeCalculation(true)` *before* invoking `onEnableIterative`, and route failures to `onCancel` (`:731-751`).
- **Focus-layer routing.** During editing, only `grid`/`editor`/`formulaBar` focus layers are intercepted; dialog layers handle their own keys (`:365-380`). Preserve.
- **DAG boundary.** `app/` composes the coordinator + UI store; it must not reach past the documented `coordinator.*.access.actors.*` access layer. Strengthen by replacing the string/superset casts with typed adapters (do not widen the surface).

## Concrete implementation plan

### Phase 1 — Extract and test the keydown routing policy (highest value)

1. Add `coordinator-keydown-capture.ts` exporting a **pure** decision function, e.g. `decideKeydownRouting(e, ctx): { route: 'coordinator' | 'ignore'; preventDefaultOnHandled: boolean }`, where `ctx` is a plain snapshot object (`isEditing`, `editorMatches(state)`, `focusLayerType`, `activeTag`, `hasOpenDialog`, `isSuggestionsOpen`, `isPickerOpen`, `editorContext.hasSelection/hasCharSelection`, target-classification booleans). Move the entire branch tree from `:292-450` into this function; it must be free of DOM side effects and of `keyboardCoordinator`.
2. Keep the duplicated helpers (`keyboardEventTargetElement`, `isEditableKeyboardTarget`, `isDialogKeyboardTarget`, `:75-89`) as named exports reused by both the policy and the call site.
3. In `KeyboardCaptureSetup`, reduce `handleKeyDownCapture` to: build `ctx` from live snapshots → call `decideKeydownRouting` → if `route === 'coordinator'`, call `keyboardCoordinator.handleKeyboardEvent(e)` and apply `preventDefault`/`stopPropagation` only when `result.handled`. The effect keeps owning IME guard ordering and listener attach/detach.
4. Add `__tests__/coordinator-keydown-capture.test.ts` covering each branch as a truth table: IME guard, global shortcut on BODY, Escape-bubbles-when-dialog-open, sheet nav from chrome, nav keys during editing, B/I/U with/without selection, printable-into-formula `formulaEditing.enterMode`, Ctrl+Enter newline, suggestions/picker open.

### Phase 2 — Extract the editor-dependencies factory

1. Add `create-editor-dependencies.ts` exporting `createEditorDependencies(deps): EditorDependencies`, where `deps` injects `workbook` and the dialog callbacks (`showValidationError`, `showValidationWarning`, `showFormulaError`, `showCircularReferenceDialog`). Move `:613-782` verbatim, preserving the async-rejection, enforcement-mapping, datetime-fraction, calculated-column auto-fill, and structured-reference-qualification behaviors.
2. In the provider, replace the inline `useMemo` with `useMemo(() => createEditorDependencies({ … }), [workbook, …])` keeping the exact dependency array (`:775-782`).
3. Add unit tests for the pure-ish transforms with a stubbed `workbook`: `errorStyle→enforcement` mapping, `none`→`null` auto-succeed, datetime fraction preservation, and `=`-prefix auto-fill gating.

### Phase 3 — Implement range-selection dialog collapse/restore

1. Replace the no-op `onDialogMinimize`/`onDialogRestore` (`:529-534`) with real UI-store-driven collapse/restore: drive a `rangeSelectionMode.active`-derived dialog-collapsed flag in the UI store and have range-argument dialogs subscribe. Confirm whether the source of truth should live in the store (preferred — dialogs already read `rangeSelectionMode`) and wire accordingly.
2. If the work belongs in the dialog components rather than this callback (the existing comment suggests "Dialog components should handle their own visibility"), make that explicit: either delete the callbacks and document the store-subscription contract, or implement them. Do not leave a TODO no-op.

### Phase 4 — Repair the index-level wiring defects (cross-folder; see Parallelization)

1. **Export indicators:** thread the live export hook's `{ progress }` and current notification into `SpreadsheetIndicators` at `index.tsx:817` instead of `{{ progress: 0 }}`/`null`. If export notifications are intentionally deferred, delete the dead component render and the unused props rather than shipping a permanently-empty overlay.
2. **`onUIAction`:** decide per the in-flight migration (`charts.ts:271`). If the JSON-string protocol is being retired, remove the `onUIAction` prop from `SpreadsheetCoordinatorProviderProps` and its plumbing (`:111-118`, `:242`, `:280`, `:793`) once all handlers route through direct state; otherwise pass the real handler from `index.tsx:758`. Either way, both ends must agree — no silently-undefined prop.

### Phase 5 — Converge the orphaned multi-view shell

1. Determine the canonical view-composition path. The live one is `views/` (`ViewContainerById`, `HybridViewContainer`, `VIEW_REGISTRY`), already consumed by `index.tsx`/`views/grid/GridView.tsx`. `Shell.tsx` duplicates this with placeholders.
2. Converge: rebuild `Shell` on top of `SpreadsheetCoordinatorProvider` + the live `views/` container (replace the `ViewContainerById` placeholder + missing toolbar with the real chrome from `index.tsx`), make `RecordDetailSidebar` read fields through the `Workbook` API (`recordDetail.{tableId,rowId}` → worksheet cells), and have `ViewSwitcher` select/create real view instances via `VIEW_REGISTRY.createAdapter`. Then wire `Shell` into a real entry, or fold these capabilities into the existing `index.tsx` composition and remove the divergent copies. Do not ship two half-shells.

### Phase 6 — Type-boundary hardening

1. Replace `dispatch(action as ActionType, …)` (`:263`) with a typed runtime resolver (validate/narrow the string against the registry before dispatch), keeping the "runtime handler lookup handles unknown actions" behavior but surfacing it as a typed boundary.
2. Replace the UI-store superset cast (`:259-260`) with an explicit `KeyboardUIStore` adapter so the narrower contract is enforced at the boundary.

## Tests and verification gates

- **New Jest unit tests (in `app/__tests__/`):**
  - `coordinator-keydown-capture.test.ts` — full branch truth table (Phase 1).
  - `create-editor-dependencies.test.ts` — enforcement mapping, `none`→null, datetime fraction, auto-fill gating, async rejection propagation (Phase 2).
- **Existing regression to keep green:** `coordinator-keyup-capture.test.ts` (Windows Alt-menu suppression contract).
- **app-eval scenarios (Playwright-driven real app)** — keyboard and composition are integration-critical; cover via app-eval rather than unit tests alone:
  - Editing: Enter/Tab/Escape commit-and-move semantics (no double-move); Ctrl+Enter newline in formula bar; B/I/U formatting during in-cell character selection; printable key entering `formulaEditing.enterMode`.
  - Focus: shortcuts when focus is on BODY (post-context-menu) and on sheet tabs/chrome (Ctrl+PageUp/Down sheet nav); Escape dismissing `CommentPopover` while focus is on BODY.
  - Alt KeyTip promotion on a fresh page (focus on BODY) — guards the keyup path.
  - Range-selection dialog collapse/restore (Phase 3) — open a range-argument dialog, drag a selection, confirm collapse then restore.
  - Export notification surfacing (Phase 4.1) if export is wired.
- **Verification gates (run by the integrator, not in this planning task):** `pnpm` typecheck for `@mog/spreadsheet` (catches the removed casts and any `EditorDependencies` drift); targeted Jest run for `app/__tests__`; the relevant app-eval keyboard/selection scenarios. Per repo convention, contracts/type edits require `pnpm --filter @mog-sdk/contracts build` before consumers typecheck if any contract type is touched.

## Risks, edge cases, and non-goals

- **Risk — keyboard regressions are high-blast-radius and platform-divergent.** The macOS dev/CI environment hides Windows-only behavior (Alt-menu focus theft). Phase 1 must preserve branch order *and* the per-branch `preventDefault`/`stopPropagation` decisions exactly; the truth-table tests are the safety net. Do not "simplify" branches that look redundant without a test proving equivalence.
- **Edge case — IME composition.** The `isComposing`/`229` guard must stay first; extracting policy must not let a non-guarded path run during composition.
- **Edge case — effect dependency arrays.** The keydown effect re-attaches listeners when `featureGates`/`readOnly`/`hostCommands`/etc. change (`:487-497`); preserve so stale closures don't capture old read-only state. The `editorDependencies` `useMemo` array (`:775-782`) must continue to include every captured dialog action.
- **Risk — Phase 5 scope.** Converging the multi-view shell touches `views/` and possibly entry wiring; if product intent for multi-view is unresolved, split Phase 5 into (a) make `RecordDetailSidebar`/`ViewSwitcher` functional against `Workbook`/`VIEW_REGISTRY` and (b) the entry-wiring decision, and sequence (b) behind a product decision. The improvement is still production-path (complete the wiring), never "delete because unused."
- **Non-goals:** rewriting `KeyboardCoordinator` itself (plan 097); changing the action registry or `EditorDependencies` *contract* shape (only its construction moves); restyling indicators/sidebar; introducing a new view system. No test-only or shim fixes — each phase lands real production behavior.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** Phase 1 (keydown extraction + tests) and Phase 2 (editor-deps extraction + tests) are self-contained within `app/` and share no files; they can proceed concurrently.
- **Phase 3** depends on the UI-store `rangeSelectionMode` slice contract and `systems/grid-editing/coordination` (`setupRangeSelectionCoordination`); coordinate with the owners of those modules (range-selection coordination overlaps plan 097's input subsystem).
- **Phase 4** edits `index.tsx` (outside this folder) and the export hook; it is a **cross-folder dependency** and must be sequenced with whoever owns the app-entry composition. The `onUIAction` decision is coupled to the in-flight `actions/handlers/charts.ts` migration — confirm its end state before removing the prop.
- **Phase 5** depends on `views/` (`VIEW_REGISTRY`, `ViewContainerById`, `HybridViewContainer`) and the `Workbook` record-read API; coordinate with the views and kernel/contracts owners. Gated on a product decision about multi-view.
- **Phase 6** may touch `@mog-sdk/contracts/actions` typing and `systems/input` `KeyboardUIStore`; if contract types change, the contracts declaration rollup build is a prerequisite for downstream typecheck.
