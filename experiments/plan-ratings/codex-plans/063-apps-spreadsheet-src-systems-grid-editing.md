# 063 - Grid Editing Production Workflow Improvement Plan

## Source folder and scope

Source folder: `mog/apps/spreadsheet/src/systems/grid-editing`

Scope: production UI editing workflows and input coordination for the spreadsheet grid. This folder is a large app subsystem, not a leaf component: the inspected tree contains 167 TypeScript files and about 43k lines across state machines, actor-access wrappers, cross-machine coordination, feature coordinators, subscriptions, and local testing harnesses.

Primary files and subareas inspected:

- `grid-editing-system.ts`: constructs and owns the internal XState actors, public `IGridEditingSystem` API, actor-access boundary, lifecycle wiring, commit/paste/layout integration, drag terminator, and feature coordinator setup.
- `types.ts`: defines `GridEditingConfig`, `IGridEditingSystem`, `GridEditingActorAccess`, `GridEditingUIStore`, editor dependencies, clipboard dependencies, and feature coordinator contracts.
- `machines/`: selection, editor, clipboard, find/replace, comment, draw-border, slicer machines. The selection and editor machines are decomposed into event/action/guard modules.
- `coordination/`: editor-selection-clipboard coordination, editor validation/commit coordination, paste integration, structure/sheet/merge/undo/range coordination, scroll commit, auto-scroll, table auto-expansion, and related tests.
- `features/`: fill, drag-drop, resize, table, table-resize, checkbox, comments, draw-border, find-replace, flash-fill, pivot, validation, toolbar, split, structure, autofit, and auto-scroll feature modules.
- `actor-access/`: accessor/command factories that are the intended opaque boundary for other systems.
- `testing/`: `GridInteractionSimulator`, `integration-simulator`, mock workbook, key action map, and broad unit/integration tests for editing lifecycle, formula range selection, read-only mode, layout callbacks, async commits, paste, navigation, and related flows.

Neighboring production dependencies to account for:

- `mog/apps/spreadsheet/src/coordinator/sheet-coordinator.ts` creates `GridEditingSystem` and wires cross-system concerns such as find/replace, sheet switch restore, scroll commit, merge anchor coordination, flash fill, renderer invalidation, and toolbar format updates.
- `mog/apps/spreadsheet/src/systems/input` owns keyboard normalization and dispatch through `KeyboardCoordinator`.
- `mog/apps/spreadsheet/src/app/CoordinatorProvider.tsx` owns document-level keyboard capture while editing and forwards to the keyboard coordinator except when autocomplete or pickers own the key.
- `mog/apps/spreadsheet/src/components/grid/editors/InlineCellEditor.tsx` owns the DOM editor surface and explicitly avoids blur-as-commit outside the IME carveout.
- `mog/apps/spreadsheet/src/actions/handlers/clipboard.ts`, `hooks/editing/use-clipboard.ts`, and `domain/clipboard` own copy/cut capture and paste execution data modeling that must stay consistent with grid-editing paste integration.
- `mog/apps/spreadsheet/src/exports.ts` publicly exports several grid-editing machines, events, selectors, and types, so actor/event/type changes can affect public package consumers and publish-readiness boundaries.

This plan targets production paths only. It does not propose test-harness-only optimizations, compatibility shims, or temporary fallbacks.

## Current role of this folder in Mog

`grid-editing` is the spreadsheet app's cell interaction operating system. It owns the live editing actors for:

- Cell selection, including keyboard navigation, mouse selection, range extension, additive selection, full row/column selection, merge navigation, hidden row/column skipping, formula range picking, fill handle state, cell drag-drop state, resize state, and table resize state.
- Cell editing, including typing entry, edit mode, formula enter/edit modes, rich text editing, cursor movement, validation, async commit, date picker commit, picker/dropdown editing, IME composition, formula autocomplete, CSE array formulas, remote change conflicts, and structure-change cancellation.
- Clipboard state, including copy/cut/paste machine state and paste-preview targets.
- Comment, draw-border, find/replace, and slicer actors.

`GridEditingSystem` creates seven actors (`selection`, `editor`, `clipboard`, `findReplace`, `comment`, `drawBorder`, `slicer`), exposes an actor-access boundary, and wires high-impact coordination:

- Editor to selection: entering formula mode starts formula range selection; exiting formula mode restores the edit-start range when appropriate; completing a commit moves selection according to commit key and workbook settings.
- Selection to editor: selection changes in formula range mode insert or update A1/cross-sheet/structured references.
- Editing input interception: clicking another cell during a regular edit commits the original edit, then moves selection after commit completion; formula enter mode clicks insert references instead.
- Editor commit coordination: validating -> committing -> inactive is driven by async validation and an XState invoke that awaits the bridge write.
- Paste integration: observing the clipboard machine entering `pasting` executes copy/cut/external paste, protection checks, merge overlap checks, overwrite confirmation, hidden-row skipping, undo grouping, selection-after-paste, and cut source clearing/relocation.
- Structure/sheet/layout coordination: structure changes update actors; sheet switches re-push layout callbacks; an authoritative merge index feeds selection navigation.
- Feature coordination: fill, resize, drag-drop, table selection, pivot selection, validation circles, comments, flash fill, find/replace, and toolbar/sheet coordination are split between this system and `SheetCoordinator`.

The folder already has strong architectural intent:

- Machines should not import each other directly; cross-machine communication goes through coordination modules.
- Actor accessors/commands are the programmatic boundary; raw actor access is exposed primarily for React `useSelector` subscriptions.
- Async commit must be awaited by the editor machine before it becomes inactive.
- DOM blur is not a commit signal except in the IME composition state.
- Selection state must preserve pending drag/fill/resize contexts until coordinators consume them.
- Sheet-scoped layout predicates must be synchronous inside the selection machine.

The main opportunity is to turn those mostly-local comments and scattered tests into enforceable subsystem contracts and to remove production API ambiguity where public methods are no-ops, coordinator wiring is implicit, or tests validate implementation text instead of behavior.

## Improvement objectives

1. Make the grid-editing lifecycle explicit and typed.

   Replace the monolithic `GridEditingSystem.start()` sequence and scattered `cleanupFns.push(...)` calls with a typed lifecycle graph of actors, coordinators, feature modules, subscriptions, async readiness tasks, and cleanup ownership. The graph should document dependency order, start/stop behavior, optional capabilities, and production invariants in code.

2. Establish a single edit transaction model.

   Consolidate edit session entry, source text resolution, protection checks, cut-range blocking, validation editor configuration, formula/rich-text/date/picker entry, commit validation, commit execution, stale-session invalidation, and input interception around an explicit edit transaction/session identity. Dialog callbacks and async validators must not be able to commit or cancel a superseded edit.

3. Centralize input intent routing.

   Move the high-level interpretation of pointer, keyboard, scroll, paste, sheet switch, and dialog events into a grid-editing input intent router that exposes production intents instead of relying on separate DOM comments, hook-level branching, and coordinator subscriptions to keep behavior aligned. `systems/input`, `CoordinatorProvider`, grid mouse hooks, and inline editors should call a common contract.

4. Complete or narrow public APIs.

   `IGridEditingSystem` currently exposes methods that are placeholders or weakly defined in production, including `subscribeToCellPropertyChanges()` returning a no-op and `getSlicerCache()` returning null. Replace these with real workbook-backed implementations or move them out of the required public interface into optional capability interfaces that are only present when wired.

5. Make read-only behavior a first-class mutation policy.

   The read-only behavior is currently distributed across dispatcher read-only allowlists, `beginEditSession`, fill coordination, drag-drop gating, and source-inspection tests. Introduce a central grid-editing mutation policy that every human-triggered mutation path consults: edit session entry, commit, paste, fill, drag-drop, resize, table resize, checkbox toggle, draw-border, comments, validation edits, toolbar formatting, and keyboard-dispatched actions.

6. Unify clipboard capture and paste contracts.

   Copy/cut/paste behavior is spread across `grid-editing` paste integration, `actions/handlers/clipboard.ts`, `hooks/editing/use-clipboard.ts`, and `domain/clipboard`. Define a shared clipboard intent/capture service so keyboard actions, React hooks, and grid-editing machines use one production data flow for internal/external clipboard detection, pending paste tracking, undo grouping, protected cells, hidden rows, merge overlap, cut relocation, conditional formats, validation, comments, hyperlinks, and paste defaults.

7. Strengthen live layout/navigation contracts.

   `refreshLayoutCallbacks()` pre-fetches hidden row/column bitmaps and merge regions, then supplies synchronous callbacks to the selection machine. That is correct for selection-machine performance, but the file documents a known limitation: mid-session row-hide/column-hide changes do not refresh until a sheet switch/bootstrap. Add workbook layout/filter event wiring and coalesced refresh so navigation tracks live layout changes in the production app.

8. Replace implementation-text tests with behavior gates.

   The folder has broad tests, but at least `read-only-mode.test.ts` intentionally reads source text because importing the production graph was problematic. Replace these with behavior tests using real system instances and workbook-shaped mocks, and add browser-level UI tests for the actual input layer whenever the behavior depends on DOM keyboard, pointer, focus, clipboard, composition, or canvas interaction.

9. Add observability around user-visible editing workflows.

   Use the existing optional `onMetric` shape to report edit session start/commit/cancel, validation latency, commit latency, paste latency, denied mutations, stale session cancellation, layout refreshes, and coordinator errors. These metrics should identify production workflow regressions without relying on devtools-only actor inspection.

## Production-path contracts and invariants to preserve or strengthen

- Actor ownership: `GridEditingSystem` remains the owner of the grid editing actors. Other systems interact through `GridEditingActorAccess`, public methods, or explicit SheetCoordinator wiring. Machines must not import each other directly.

- Actor-access boundary: accessors provide point-in-time reads, commands send typed events, selectors support React subscriptions, and raw actors are exposed only for reactive hooks and explicitly documented coordinator needs.

- Edit identity: an edit has a stable origin sheet, origin cell, entry mode, pre-edit selection ranges, source text, cursor hint, merge bounds, literal-formula flag, and optional rich text/date/picker state. Selection may move during formula point mode, but commit must target the stored editing cell and stored pre-edit range when required.

- Async entry and validation: source text reads, protection checks, validation editor config resolution, formula syntax validation, circular-reference validation, data validation dialogs, and schema/picker resolution must be generation-checked. Responses from superseded sessions must be ignored.

- Commit lifecycle: user commit transitions through `validating` and `committing`; bridge writes are awaited in `committing`; `onDone` or `onError` is the production completion path. Manual `COMMIT_COMPLETE` remains a compatibility event only if still needed for tests, not the production path.

- Commit navigation: after commit completion, selection moves according to the commit key and workbook Enter-direction setting. Tab/Enter should route through selection-machine tab/enter events so tab origin and hidden-cell skipping stay correct. Arrow commit should use hidden row/column predicates.

- CSE array formulas: Ctrl+Shift+Enter commits to the pre-edit selected range, not the visible active-cell-only range after editing starts. Partial writes to array projection members remain enforced by compute-core, not suppressed by UI pre-checks.

- Formula point mode: entering formula editing activates selection range mode; clicks/arrows insert or update references in formula enter mode; formula edit mode arrow keys move the text cursor. Cross-sheet references include the correct sheet name and return to origin sheet when the edit completes.

- Blur contract: normal edit/formula/rich-text blur is a side effect, not user intent. Only IME composition uses blur as an OS-level commit signal. Regular click-away commit uses explicit interception and a `COMMIT` event.

- DOM editor pointer contract: clicks inside the active inline editor must position the caret or select text, not bubble into grid pointer handling and commit. Clicks on other cells must still reach grid-editing for commit-and-move or formula reference insertion.

- Input ownership: autocomplete and picker dropdowns own Tab/Enter/Escape while open. When closed, document-level keyboard capture routes navigation and commit keys to `KeyboardCoordinator`.

- Selection-mode matrix: extend, additive, and end mode priority remains stable. Pending ranges and committed ranges must obey the documented matrix. Protected states such as formula range picking, fill drag, cell drag, and resize ignore external selection deactivation until their operation terminates or is explicitly cancelled.

- Drag/fill/resize context retention: fill handle, right-fill handle, cell drag-drop, header resize, and table resize contexts must survive the transition back to idle until the corresponding coordinator reads them and sends the clear event. User cancel clears immediately.

- Paste semantics: active sheet is resolved from workbook ground truth where available, not stale UI state. Cut-paste uses relocation to preserve cell IDs when possible. Cut-paste is atomic under protection. Copy-paste may skip protected cells where Excel parity expects it. Paste is grouped into one undo operation, updates selection to the affected range, clears system clipboard text after successful cut relocation, and keeps cut state alive while awaiting overwrite confirmation.

- Layout predicates: selection-machine row/column hidden and merge lookup callbacks are synchronous. The callbacks close over sheet-scoped pre-fetched bitmaps/indexes. Merge lookup uses the authoritative structure event/index path, not stale viewport merge data.

- Read-only policy: read-only blocks all human UI mutation paths by default and allows navigation, selection, copy, find, and other non-mutating actions. It must not claim to block direct kernel/API calls outside human UI paths.

- Lifecycle cleanup: all subscriptions, async coordinators, feature coordinators, actor subscriptions, timers, pending paste trackers, and caches must be disposed in deterministic reverse dependency order. `start()` remains idempotent; a disposed system cannot restart.

- Dependency direction: public `mog` code must not depend on `mog-internal`. Systems should avoid importing UI-store internals directly; narrow interfaces such as `GridEditingUIStore` are the correct pattern.

## Concrete implementation plan

### 1. Create a grid-editing contract map

Add a small set of source-local contract files that define the subsystem in terms of production capabilities, not comments:

- `contracts/actor-topology.ts`: actor IDs, actor ref types, actor ownership, actor-access surfaces, and which actors may be exposed to external coordinators.
- `contracts/lifecycle.ts`: lifecycle node type, dependency IDs, start/dispose contract, optional async readiness task, error policy, and cleanup ownership.
- `contracts/input-intents.ts`: user-level editing intents such as `StartEdit`, `CommitEdit`, `CancelEdit`, `CellPointerDown`, `CellPointerUp`, `HeaderResizeStart`, `FillHandleStart`, `KeyboardCommit`, `PasteAtSelection`, `SheetSwitch`, `ScrollCommit`, `DialogOpened`, and `ExternalSelectionActive`.
- `contracts/mutation-policy.ts`: human UI mutation categories and read-only allow/deny behavior.
- `contracts/edit-session.ts`: edit session identity, generation, origin target, source text state, validation state, dialog continuation state, and commit snapshot fields.

These contracts should be imported by implementation and tests. They are not documentation-only.

### 2. Refactor `GridEditingSystem` around lifecycle nodes

Extract the current `start()` wiring into deterministic lifecycle nodes:

- `actors`: start the seven actors and stop them in reverse order.
- `policy`: configure read-only settings such as disabling fill handle and exposing the mutation policy to coordinators.
- `trio-coordination`: selection/editor/clipboard coordination.
- `structure-coordination`: workbook structure changes into selection/editor/clipboard.
- `paste-integration`: clipboard machine to paste executor.
- `editor-commit`: validation and commit coordination.
- `layout-callbacks`: bootstrap and event-driven layout predicate refresh.
- `feature-coordinators`: fill, resize, drag-drop, validation circles, table selection, pivot selection, comments, checkbox, draw-border, slicer, and any optional tool modes.
- `notifications`: public callback sets and state change subscriptions.

Each node should declare required capabilities (`workbook`, `uiStoreApi`, `getHitTest`, `editorDeps`, `clipboardDeps`, `getActiveSheetId`) and a clear skip reason when optional dependencies are absent. Skips should be observable in development metrics/logging, not silently become no-ops for public API methods.

Keep `GridEditingSystem` as the public facade, but move construction and lifecycle implementation into helpers such as:

- `createGridEditingActors(config)`
- `createGridEditingActorAccess(actors)`
- `createGridEditingLifecycleGraph(runtime)`
- `GridEditingRuntime`, a private object containing actors, access, config, callbacks, caches, policy, and cleanup manager.

This reduces the current single class from being actor factory, coordinator registry, mutation executor, layout index, public API, and test harness at once.

### 3. Implement a real edit session controller

Promote `edit-entry-service.ts` into an edit session controller that owns the entire start-to-commit lifecycle:

- Generate an edit session ID for every `beginEditSession()` or `startEditing()` path, including the no-workbook fallback.
- Store origin sheet/cell, pre-edit selection ranges, entry mode, initial text hint, cursor hint, merge region, `formulaInputIsLiteral`, dropdown intent, and cached rich text segments.
- Move stale generation handling from only source-text resolution into all async continuations: protection checks, format reads, validation editor config, formula syntax validation, circular reference validation, validation dialogs, picker resolution, and commit retries.
- Make validation dialog callbacks session-bound. `Retry`, `RetrySelectAll`, `Proceed`, `AcceptAsText`, `EnableIterative`, and `Cancel` must no-op if their session is no longer current.
- Have the editor machine receive explicit session metadata in `START_EDITING` and `COMMIT` events so commit coordination can verify it is committing the current session.
- Keep the editor machine simple: it models UI state; the controller owns async session validity and capability resolution.

This should preserve the current machine states but make stale async behavior explicit and testable.

### 4. Centralize input intent routing

Introduce a `GridEditingInputRouter` that consumes `GridEditingInputIntent` and performs the same state-aware routing that is currently split across `handleCellClick`, `setupEditingInputInterception`, `CoordinatorProvider`, inline editor DOM handlers, grid mouse hooks, and `KeyboardCoordinator` context selection.

Production consumers should call the router instead of duplicating state branching:

- Grid mouse/pointer hooks send cell/header/fill/resize/table/draw-border pointer intents.
- Document keyboard capture sends commit/navigation/cancel/formula printable intents after focus and autocomplete/picker ownership checks.
- Inline editor sends editor-owned text, selection, composition, and autocomplete intents.
- SheetCoordinator sends scroll-commit, sheet-switch, external selection, and dialog lifecycle intents.
- Clipboard hooks/actions send copy/cut/paste/paste-special intents or route through the shared clipboard service.

The router must preserve current behavior:

- Formula enter mode cell click inserts references when the cursor is at a reference position.
- Formula edit mode and normal edit click-away commit first, then move selection.
- Pointer events inside the inline editor are ignored by grid pointer logic.
- Autocomplete/picker open state owns Tab/Enter/Escape.
- IME composition suppresses shortcuts and only commits through the IME carveout.

### 5. Complete public API capabilities

Audit every method on `IGridEditingSystem` and decide whether it is a guaranteed capability or an optional feature capability. Then implement or narrow it.

Required production implementations:

- `subscribeToCellPropertyChanges(sheetId,row,col,onChange)`: wire to workbook events such as value changes, format changes, validation/schema changes, comments/hyperlinks where applicable, and cleanly unsubscribe. If the workbook event surface is incomplete, add the missing typed event upstream instead of returning a no-op.
- `getSlicerCache(slicerId)` and `rebuildAllSlicerCaches()`: either back them with workbook/slicer APIs and the slicer actor, or move slicer cache access to an optional `SlicerEditingCapability` returned only when wired.
- `findReplace`, `drawBorder`, `commentHover`: replace placeholder coordinator interfaces with concrete command/query methods that map to production workflows. If full wiring correctly belongs in `SheetCoordinator`, the public interface should reflect a capability object installed by the coordinator rather than a placeholder cleanup-only object.
- `setCheckboxCoordination()`: avoid repeated calls leaking old coordination. Dispose and replace prior checkbox coordination before installing a new one, and define whether this method is a one-shot lifecycle dependency or a runtime reconfiguration point.

Public methods should never imply working production behavior while returning null/no-op because a dependency is missing.

### 6. Implement a central mutation policy

Create a `GridEditingMutationPolicy` that exposes:

- `canStartEdit`
- `canCommitEdit`
- `canPaste`
- `canFill`
- `canDragDrop`
- `canResize`
- `canTableResize`
- `canToggleCheckbox`
- `canDrawBorder`
- `canEditComment`
- `canApplyValidation`
- `canFormat`

The default policy should be permissive. A read-only policy should block mutating human UI actions by default and explicitly allow non-mutating actions. The policy should return structured denial reasons so UI can surface consistent messages and metrics can record denied attempts.

Wire this policy into:

- `beginEditSession` and `startEditing`
- editor commit and date/picker/rich-text commit
- paste integration, including paste-special
- fill and right-fill
- drag-drop
- resize and table resize
- checkbox toggles
- draw-border and comment operations
- keyboard-dispatched mutating actions through action dependencies

Then replace source-text read-only tests with behavior tests that create a `GridEditingSystem` with read-only policy and assert that each mutating workflow is blocked while navigation/copy remain allowed.

### 7. Unify clipboard capture and paste

Create a shared clipboard workflow service used by both keyboard action handlers and React hooks:

- `captureSelectionForClipboard({ operation: 'copy' | 'cut', ranges, sheetId })`
- `writeCapturedClipboardToSystemClipboard(capture)`
- `routePasteIntent({ targetCell, pasteOptions, source })`
- `awaitPendingPaste()`
- `awaitPendingCapture()`

Use one implementation for:

- full-shape sparse copy/cut
- hidden row/column filtering
- merge metadata
- formats, formulas, validation rules, conditional formats, comments, hyperlinks, images/charts where supported
- internal/external clipboard distinction
- saved paste defaults
- image-only clipboard routing
- stale internal clipboard suppression

Keep paste execution in the production paste integration, but pass it a normalized paste intent so external paste, internal copy, internal cut, and paste special share one transaction path. The service should preserve the current `trackPendingClipboardPaste` behavior but make it a typed part of the contract.

### 8. Make layout predicates live

Extend layout callback refresh beyond bootstrap and sheet switch:

- Add workbook event subscriptions for row hidden/unhidden, column hidden/unhidden, filter visibility changes, sheet deletion, and merge changes. If the workbook does not expose typed events for layout visibility changes, add them in the correct public repo layer and consume them here.
- Coalesce rapid layout events per sheet into one refresh microtask.
- Maintain per-sheet hidden row/column bitmaps and merge indexes in a `LayoutPredicateIndex`.
- Re-push callbacks when the active sheet's index changes.
- Keep callbacks synchronous for the selection machine.
- Preserve the current defensive behavior: fetch failures should not crash navigation, but they should emit a metric and keep prior known-good data where safer than clearing.

Also replace the selection-machine Ctrl+Arrow test fallback with an injected production `DataEdgeResolver` contract where possible. The machine can still have a no-capability fallback for direct tests, but production paths should not rely on placeholder jump amounts.

### 9. Type the coordinator dependencies and remove `as any` seams

The inspected source has casts around table/pivot coordination and tests. Replace broad casts with narrow actor facade interfaces:

- `SelectionActorFacade`
- `EditorActorFacade`
- `ClipboardActorFacade`
- `WorkbookFacade` for each coordinator family
- `GridEditingUIStoreFacade` per feature rather than one growing catch-all when a feature only needs two methods.

Feature coordinators should declare exactly what they read/write and should not accept the whole system unless they genuinely coordinate across the whole system. This preserves package boundaries and makes parallel implementation safer.

### 10. Add workflow observability

Use `GridEditingConfig.onMetric` consistently:

- `edit.session.start`, `edit.session.superseded`, `edit.session.cancel`, `edit.commit.validation.start/end`, `edit.commit.write.start/end/error`
- `paste.start`, `paste.defer.sizeMismatch`, `paste.defer.cutOverwrite`, `paste.block.protection`, `paste.block.merge`, `paste.complete`, `paste.error`
- `mutation.denied` with policy reason and workflow
- `layout.refresh.start/end/error`
- `coordinator.start/skip/error/dispose`

Metrics should include sheet ID where appropriate, but avoid cell/range payloads large enough to be noisy. This is not performance optimization; it is production workflow visibility.

### 11. Migration sequence

1. Add contract types and behavior tests that lock current production behavior before refactoring.
2. Extract lifecycle graph while keeping public API behavior unchanged.
3. Add edit session identity and generation checks across async entry/validation/dialog paths.
4. Add mutation policy and wire read-only through every mutating grid-editing path.
5. Complete or narrow public API capabilities.
6. Unify clipboard capture/paste service and migrate hooks/actions to it.
7. Add live layout predicate refresh.
8. Replace placeholder fallback paths with injected production resolvers where applicable.
9. Remove source-inspection tests and any test-only compatibility paths that are no longer needed.
10. Run the full verification gates below and fix production failures, not just tests.

## Tests and verification gates

Do not rely on direct actor event shortcuts alone for behavior that depends on the real UI input layer. Add tests in layers:

### Unit and coordinator tests

- Lifecycle graph tests: start order, skip reasons, idempotent start, reverse cleanup, dispose-after-start, dispose-before-async-layout-refresh-resolution.
- Edit session tests: stale source text ignored, stale validation ignored, stale dialog callback ignored, session invalidation on sheet deletion/import, cut-range edit blocked, protected cell edit blocked, rich text cache preserved only for current session.
- Editor commit tests: async commit remains in `committing`, commit errors re-read/reset, CSE pre-edit range preserved, signed numeric literals do not trigger formula syntax validation, formula syntax/circular/data validation dialog flows are session-bound.
- Input router tests: formula enter click inserts references, formula edit click commits/moves, regular edit click commits/moves, same-editor pointer events are ignored, autocomplete/picker owns Tab/Enter/Escape, IME blocks shortcuts.
- Mutation policy tests: every mutating workflow is blocked in read-only, and navigation/copy/find/select remain allowed.
- Clipboard tests: internal/external paste intent normalization, cut overwrite confirmation, protection full/partial behavior, hidden-row paste, merge overlap, undo grouping, system clipboard clear after cut, selection-after-paste.
- Layout tests: hidden row/column events refresh predicates without sheet switch; merge events update per-sheet index; fetch failure keeps prior known-good merge data where appropriate.
- Public API tests: no public `IGridEditingSystem` method returns placeholder null/no-op for a declared required capability.

### Integration tests

Use `GridInteractionSimulator` and the newer `systems/testing-foundation/SheetSimulator` for production-shaped headless tests, but make sure they exercise the same public API and coordinator wiring production uses.

Required scenarios:

- Type into a cell, press Enter/Tab/Shift+Enter/Shift+Tab, verify commit and selection movement with hidden rows/columns.
- Double-click edit mode, click another cell, verify commit-then-move and no blur commit.
- Formula `=` entry, click and shift-click ranges, switch sheets while formula editing, verify cross-sheet reference and return-to-origin behavior.
- Start edit, open validation warning/error/info dialogs, trigger stale session by starting another edit, verify old dialog callbacks do not mutate the new edit.
- Copy/cut/paste across sheets after active sheet changes, verifying workbook active sheet wins over stale UI state.
- Fill, drag-drop, resize, and table resize read context after drag termination and then clear it.
- Read-only mode blocks all mutating grid-editing workflows behaviorally.

### Browser/UI tests

For workflows whose correctness depends on DOM focus, keyboard capture, pointer bubbling, composition, native clipboard, or canvas hit testing, add browser tests that drive real user input:

- Inline editor caret click inside the editing cell does not commit.
- Click another cell during regular edit commits and moves selection.
- Formula enter mode cell click inserts a reference rather than committing.
- Tab/Enter/Escape route to autocomplete/picker while open and to grid commit/cancel when closed.
- IME composition does not trigger shortcuts and commits only through the intended composition completion path.
- Copy/cut/paste use real keyboard shortcuts and clipboard APIs where the test environment supports them.
- Read-only fill handle, drag-drop, checkbox, and paste attempts are blocked through actual pointer/keyboard paths.

### Commands for a real implementation

Run these after implementation, not during this planning worker:

- `cd mog && pnpm --filter @mog/app-spreadsheet test -- src/systems/grid-editing`
- `cd mog && pnpm --filter @mog/app-spreadsheet test -- src/systems/input src/actions/handlers src/hooks/editing src/components/grid`
- `cd mog && pnpm --filter @mog/app-spreadsheet typecheck`
- If public contract/types packages change: run the relevant `pnpm typecheck` and `pnpm test` in those packages.
- If public exports, package boundaries, or publishable contracts change: run the relevant boundary/publish-readiness gate, for example `cd mog && pnpm check:publish-readiness:fast` when that gate covers the touched packages.
- For UI behavior changes: start the app dev server, exercise the affected workflows in a browser, and add/execute the corresponding browser-driven E2E or app-eval scenarios with real keyboard, pointer, and clipboard paths.

## Risks, edge cases, and non-goals

Risks:

- Refactoring lifecycle wiring can accidentally change coordinator order. Mitigate with lifecycle graph tests and transition tests before moving code.
- Centralizing input routing can break subtle DOM ownership contracts, especially caret clicks inside the inline editor and autocomplete/picker key ownership. Mitigate with browser-level tests.
- Session IDs added to editor events can create churn if applied too broadly. Keep machine state additions focused on async validity and commit targeting.
- A central mutation policy can over-block if it treats all workbook calls as user mutations. Scope it to human UI workflows and keep direct kernel/API calls out of scope.
- Clipboard unification touches multiple call sites and can regress external paste, image paste, cut relocation, or paste defaults. Migrate behind a shared service with old and new callers tested side by side before deleting duplicated paths.
- Live layout refresh needs upstream workbook events. If those events are missing, the correct fix is to add typed events at the workbook/kernel boundary, not to poll from the UI.
- Removing placeholder fallback behavior may expose tests that were asserting non-production behavior. Replace those tests with production-path tests rather than preserving fake behavior.

Edge cases to enumerate explicitly:

- Editing while switching sheets, deleting sheets, or receiving remote structure changes.
- Formula editing across sheets with sheet names requiring quoting.
- CSE array formula commit from a multi-cell selection after selection visually collapses.
- Dynamic array spill member edits, which must remain possible so blockers can be created.
- Protected sheet with partially protected paste target; cut-paste must remain atomic.
- Merged cells during selection navigation, paste target overlap, copy/cut source, and active-cell merge anchor snapping.
- Hidden rows/columns during Tab, Enter, arrow commit navigation, fill, paste, and copy/cut.
- IME composition on blur, Escape, Enter, and remote changes.
- Autocomplete/picker open while document-level keyboard capture is active.
- Read-only mode for mutating workflows that are not keyboard-dispatched, including pointer-driven fill/drag/drop/resize and checkbox toggles.
- Stale async validation/dialog callbacks after a new edit starts.
- Disposing the system while paste, layout refresh, validation, or edit-source reads are pending.

Non-goals:

- Do not change compute-core formula evaluation, array formula semantics, or protection semantics except through explicit public contracts needed by grid-editing.
- Do not optimize benchmark-only or simulator-only paths.
- Do not add compatibility shims for old grid-editing APIs. Public APIs should either work in production or be narrowed to optional capabilities.
- Do not move private/internal planning content into the public `mog` repo.
- Do not make `mog` depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable if contracts are established first.

Suggested parallel workstreams:

- Worker A: lifecycle graph and actor-access contracts in `systems/grid-editing`, with no behavior changes beyond start/dispose equivalence.
- Worker B: edit session controller and async generation checks in `edit-entry-service.ts`, editor commit coordination, and editor machine event metadata.
- Worker C: input intent router plus integration with `CoordinatorProvider`, inline editor, grid mouse hooks, and `systems/input`.
- Worker D: mutation policy/read-only coverage across edit, paste, fill, drag-drop, resize, checkbox, draw-border, comments, and keyboard actions.
- Worker E: clipboard workflow service spanning `systems/grid-editing/coordination/paste-integration.ts`, `actions/handlers/clipboard.ts`, `hooks/editing/use-clipboard.ts`, and `domain/clipboard`.
- Worker F: live layout predicate index and upstream workbook layout/filter event wiring.
- Worker G: tests and E2E coverage, split into headless simulator tests and browser-driven UI tests.

Dependencies:

- Worker A should land before broad coordinator changes so other workers can plug into the lifecycle graph cleanly.
- Worker B and Worker C can proceed in parallel after the edit/input contracts are agreed, but they must share the same session identity and input intent types.
- Worker D depends on the mutation policy contract but can audit and enumerate all mutation paths independently.
- Worker E depends on clipboard intent shapes and may need changes in `domain/clipboard`, `actions/handlers/clipboard.ts`, and `hooks/editing/use-clipboard.ts`.
- Worker F may require typed workbook events from kernel/contracts. If those do not exist, add them in the public repo boundary first.
- Worker G should start early by locking current behavior and then continue as an integration verifier for each worker's changes.

Cross-folder dependencies to keep explicit:

- `apps/spreadsheet/src/coordinator/sheet-coordinator.ts` for cross-system wiring.
- `apps/spreadsheet/src/systems/input` and `app/CoordinatorProvider.tsx` for keyboard and focus routing.
- `apps/spreadsheet/src/hooks/grid-mouse` and `components/grid/editors` for pointer and DOM editor ownership.
- `apps/spreadsheet/src/actions/handlers/clipboard.ts`, `hooks/editing/use-clipboard.ts`, and `domain/clipboard` for clipboard capture/paste.
- `apps/spreadsheet/src/systems/renderer` for invalidation and viewport-follow contracts.
- `apps/spreadsheet/src/exports.ts` for public machine/event/type export compatibility.
- `@mog-sdk/contracts` only when public actor/event/capability contracts need to change.
