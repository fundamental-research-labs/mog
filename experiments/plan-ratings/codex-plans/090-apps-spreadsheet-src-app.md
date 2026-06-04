# 090 - Spreadsheet App Composition and Coordinator Wiring Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/app`

This plan covers the spreadsheet app-level React composition and coordinator wiring modules:

- `CoordinatorProvider.tsx`
- `coordinator-keyup-capture.ts`
- `__tests__/coordinator-keyup-capture.test.ts`
- `Shell.tsx`
- `ViewSwitcher.tsx`
- `RecordDetailSidebar.tsx`
- `SpreadsheetIndicators.tsx`

Adjacent production files that define the actual boundary for this folder:

- `apps/spreadsheet/src/index.tsx`, which currently imports `SpreadsheetCoordinatorProvider` and `SpreadsheetIndicators` and owns the live toolbar, formula bar, grid, layers, status bar, sheet tabs, and dialog composition.
- `apps/spreadsheet/src/hooks/shared/use-coordinator.tsx`, which creates the `SheetCoordinator` that `CoordinatorProvider.tsx` wraps.
- `apps/spreadsheet/src/components/navigation/PaneNavigationProvider.tsx`, which consumes `usePaneNavigation()` from this folder but is not currently mounted by the production entrypoint.
- `apps/spreadsheet/src/infra/context/shell-context.tsx`, `apps/spreadsheet/src/views/**`, and `apps/spreadsheet/src/coordinator/shell-coordinator.ts`, which are dependencies for view switching, shell store state, and view adapter lifecycle.

Out of scope for this folder-specific plan:

- Deep `SheetCoordinator` internals, receipt processing, floating-object projection, and actor access refactors covered by plan 062.
- Action handler registry, payload typing, and dispatcher normalization covered by plan 061.
- Formula bar internals, toolbar command implementation, grid canvas behavior, kernel/workbook persistence, and Rust compute behavior.
- Any work in `mog-internal` other than this planning artifact.

## Current role of this folder in Mog

`src/app` is intended to be the spreadsheet application composition boundary, but the live production entrypoint only uses part of it. `SpreadsheetCoordinatorProvider` is production-critical: it wraps `BaseCoordinatorProvider`, injects workbook/UI/platform/read-only/host command dependencies, installs document-level keyboard capture, wires undo selection restoration, range selection coordination, pane navigation registration, collab presence broadcasting, validation dialogs, formula error dialogs, circular-reference handling, clipboard overwrite/protection callbacks, and editor commit dependencies.

The provider is currently large enough to hide several distinct contracts in one component. It contains global keyboard routing logic, dependency construction for `KeyboardCoordinator`, editor dependency construction for workbook writes and validation, UI dialog bridges, and multiple child bridge components. The only directly tested app module is `createKeyUpCapture`, which locks the Windows bare-Alt keyup suppression contract.

`Shell.tsx`, `ViewSwitcher.tsx`, and `RecordDetailSidebar.tsx` appear to be app-shell scaffolding rather than mounted production UI. `Shell.tsx` renders `ViewContainerById` with the placeholder assumption that `viewId` is the view type. `ViewSwitcher.tsx` lists `VIEW_REGISTRY` entries and writes the selected view type into `activeViewId`. `RecordDetailSidebar.tsx` reads shell-store `recordDetail` state but only displays table/row ids and a TODO for workbook-backed fields. These modules are misleading if left as app composition code while `index.tsx` owns the real spreadsheet layout.

`SpreadsheetIndicators.tsx` is mounted in the production grid container, but `index.tsx` currently passes `exportState={{ progress: 0 }}` and `exportNotification={null}`, so it is not yet connected to a real export/calculation/status source.

## Improvement objectives

1. Make `src/app` the actual spreadsheet app composition boundary instead of leaving the live layout embedded in `index.tsx` while `Shell.tsx` remains unused scaffolding.
2. Split `CoordinatorProvider.tsx` into named app bridge modules with explicit contracts: coordinator creation, editor dependencies, keyboard dependencies, keyboard event routing, pane navigation, undo selection, range selection, collab presence, clipboard UI callbacks, validation dialogs, and circular-reference dialogs.
3. Make document-level keyboard capture testable as a production routing contract, not as a long inline `useEffect`. Preserve IME, dialog, editable target, body-focus, formula editing, keytip, sheet navigation, and autocomplete/picker behavior.
4. Wire pane navigation through the real toolbar, formula bar, grid, and status bar DOM wrappers, or remove the unused `PaneNavigationProvider`/`Shell` scaffolding if the production layout should own registration directly.
5. Resolve view shell ownership. If multi-view spreadsheet shell is product-live, make `Shell`, `ViewSwitcher`, and view adapter mounting use real view instances/configs and the shell coordinator. If it is not product-live, delete or move the scaffolding so it does not imply a working production path.
6. Make app-level UI side effects explicit and injectable where they cross React, browser globals, shell services, platform services, workbook APIs, and coordinator state.
7. Connect `SpreadsheetIndicators` to real app state or replace it with the correct status surface so mounted UI does not carry inert notification props.
8. Add focused unit/integration tests for app composition and bridge contracts, then verify the behavior through real browser input paths.

## Production-path contracts and invariants to preserve or strengthen

- `BaseCoordinatorProvider` owns one `SheetCoordinator` for one workbook/document session. Document switches must dispose the old coordinator and create a fresh one; app bridge refactors must not hot-swap workbook dependencies into an existing coordinator.
- Durable spreadsheet state remains owned by the Workbook/Worksheet APIs and Rust compute pipeline. App bridge code may coordinate UI and session-local state, but it must not invent durable workbook state in React or shell stores.
- Editor commits continue to route through the public worksheet APIs: cell values, date values, validation, circular-reference checks, formula syntax checks, calculated-column autofill, and CSE array formulas.
- Read-only mode must block mutating paths through the existing coordinator/dispatcher/editor/input gates. App bridge extraction must not add a new mutating bypass.
- Exactly one document-level `keydown` capture and one document-level `keyup` capture listener should be attached for an active coordinator provider, and both must be removed on unmount.
- IME composition must never be intercepted by keyboard capture.
- The editor state machine remains the source of truth for edit mode. DOM ancestry must not decide whether formula bar or inline edit navigation is active.
- Dialog and editable targets must retain their own keyboard behavior except for explicit spreadsheet-global shortcuts that are intentionally routed.
- Bare Alt keyup handling must continue to call `preventDefault()` and `stopPropagation()` when the keyboard coordinator reports handled, preserving Windows keytip behavior.
- `Enter`, `Tab`, and `Escape` during editing must route once through the keyboard coordinator and must not also reach the input element when handled.
- `Ctrl/Cmd+PageUp/PageDown` sheet switching must work when focus is on the grid, body, formula editor, or spreadsheet chrome elements.
- Formula autocomplete and picker dropdowns must receive `Tab`, `Enter`, and `Escape` when open.
- F6 pane navigation must register only currently mounted panes and must unregister stale DOM elements when panels are hidden, unmounted, or document sessions change.
- Validation, formula error, circular-reference, paste overwrite, and protection dialogs remain user-visible UI bridges. Refactoring must preserve callback ordering, cancellation behavior, and async error handling.
- Collab presence broadcasting remains tied to coordinator selection state and must clean up on provider unmount.
- App-level shell/view code must not depend on `mog-internal`, must not import private kernel internals, and must not make public package declarations depend on app-internal types.

## Concrete implementation plan

1. Establish an app composition contract inventory.

   - Add focused tests around the production app provider tree showing which components must be inside `SpreadsheetCoordinatorProvider` and which components require `useCoordinator()`, `usePaneNavigation()`, `useWorkbook()`, `useUIStoreApi()`, shell services, and platform identity.
   - Add tests that `SpreadsheetCoordinatorProvider` renders children only after a coordinator is created, disposes the coordinator on unmount, and does not leave global devtools/test handles or document listeners behind.
   - Add a source-level contract test that fails if app shell scaffolding remains exported or documented as production composition while unused by `index.tsx`.

2. Promote the live spreadsheet layout into `src/app`.

   - Extract the layout currently embedded in `apps/spreadsheet/src/index.tsx` into a production component such as `SpreadsheetAppLayout` or replace `Shell.tsx` with that production component.
   - Keep `index.tsx` as the public entrypoint/bootstrap layer that gathers feature gates, workbook hooks, export callbacks, slots, theme attributes, sheet tab actions, and read-only settings, then renders the app layout.
   - Make the app layout own the composition order for toolbar, formula bar, NL formula bar, embed slots, grid, indicators, panel layer, overlay layer, status bar, sheet tabs, and dialog layer.
   - Ensure the layout has stable wrappers for app chrome and pane navigation without changing the grid, toolbar, formula bar, or status bar internals.

3. Wire pane navigation into the production layout.

   - Decide whether `PaneNavigationProvider` should wrap the extracted app layout or whether `SpreadsheetCoordinatorProvider` should expose direct callback refs to the layout.
   - Register toolbar, formula bar, grid, and status bar wrappers with `setPaneToolbarElement`, `setPaneFormulaBarElement`, `setPaneGridElement`, and `setPaneStatusBarElement`.
   - Handle hidden panels explicitly: when ribbon, formula bar, or status bar is hidden, registration should send `null` so F6 skips absent panes.
   - Add tests for mount, unmount, panel hide/show, document remount, and F6/Shift+F6 focus order through real DOM refs.

4. Split `CoordinatorProvider.tsx` into app bridge modules.

   - Keep `SpreadsheetCoordinatorProvider` as a small composition component.
   - Extract `PaneNavigationSetup`, `UndoSelectionCoordinatorSetup`, `RangeSelectionCoordinatorSetup`, and `CollabPresenceBridge` into separate bridge files with package-local tests.
   - Extract editor dependency creation into a pure `createEditorDependencies(...)` factory that accepts workbook, UI dialog callbacks, and circular-reference callbacks.
   - Extract keyboard dependency wiring into a `KeyboardDependenciesBridge` or `useKeyboardCoordinatorDependencies(...)` hook that can be tested without mounting the full app.
   - Extract validation/circular-reference UI bridge logic into a named module so callback contracts are visible and separately tested.

5. Make keyboard capture a pure routing contract.

   - Replace the inline `handleKeyDownCapture` body with a pure decision function plus a thin DOM adapter. Inputs should include the keyboard event shape, active element classification, target classification, editor snapshot, focus stack, and keyboard coordinator result.
   - Keep `createKeyUpCapture` and extend it into a broader `createKeyboardCaptureHandlers(...)` factory that returns `keydown` and `keyup` handlers.
   - Add unit tests for IME, non-editing body focus, editable targets, dialog targets, body-focus Escape with dialog open, global shortcuts, sheet navigation from chrome, editing navigation keys, Ctrl/Cmd+Enter, autocomplete/picker, rich-text formatting shortcuts, formula `enterMode` printable input, and keyup handled/unhandled behavior.
   - Add an integration test that mounts the provider with fake coordinator actors and asserts listener attach/remove counts.

6. Inject host/browser capabilities at the app boundary.

   - Define an app host capability object for `document`, active element lookup, dialog query, confirm, scheduler, console/error reporting, and optional devtools exposure.
   - Thread that capability through `SpreadsheetCoordinatorProvider` and `createSheetCoordinator(...)` rather than using `document`, `window.confirm`, `(window as any).__COORDINATOR__`, or direct `console.error` at scattered call sites.
   - Make browser defaults the production host and deterministic fakes the unit-test host.
   - On unmount, clear any devtools/test global only if this provider set it and it still points to the same coordinator.

7. Resolve `Shell`, `ViewSwitcher`, and `RecordDetailSidebar`.

   - If the multi-view shell is production scope, replace the placeholder `viewId === viewType` path with persisted or workbook-backed view instance configs and use a typed shell coordinator/provider to mount cached adapters.
   - Make `ViewSwitcher` select or create real view instances and validate that table-bound views have a sheet/table binding instead of silently grabbing the first table.
   - Make `RecordDetailSidebar` load fields through the Workbook/Worksheet/table APIs, preserve validation/read-only behavior, and edit fields through normal worksheet mutation paths.
   - If the multi-view shell is not production scope for the spreadsheet app, remove these modules from the app folder or move them to an experimental/view-shell area so `src/app` represents the actual mounted production path.

8. Connect app indicators to real status sources.

   - Replace the inert `SpreadsheetIndicators exportState={{ progress: 0 }} exportNotification={null}` call with a real export lifecycle source or remove the export notification UI from the production tree until it has a source.
   - If export notifications stay here, make export progress/success/error state flow from the same export handler used by toolbar/host commands.
   - Add ARIA live-region behavior for transient notifications and tests for progress, success, error, dismissal, and no-overlap with overlays.

9. Document and enforce the app composition boundary.

   - Add a short app-level architecture note or comments that describe which modules own React composition, coordinator bridging, browser capture, shell/view switching, and app indicators.
   - Update imports so app modules consume coordinator and shell capabilities through typed public app hooks instead of broad `any` contexts.
   - Ensure app code does not import from `mog-internal` and does not leak private implementation details through `@mog/app-spreadsheet` public exports.

## Tests and verification gates

Required package gates for the eventual implementation:

- `pnpm --filter @mog/app-spreadsheet test -- src/app`
- `pnpm --filter @mog/app-spreadsheet test -- src/hooks/shared/use-coordinator.tsx src/components/navigation/PaneNavigationProvider.tsx`
- `pnpm --filter @mog/app-spreadsheet typecheck`

Focused tests to add or extend:

- Provider lifecycle: coordinator creation, child rendering after readiness, dispose on unmount, document remount, listener attach/remove, devtools handle cleanup, and no stale callbacks after dispose.
- Keyboard capture: IME pass-through, body-focus routing, editable/dialog pass-through, Escape with open dialog, global shortcuts, sheet navigation from chrome/body/formula editor, navigation during editing, Ctrl/Cmd+Enter pass-through, autocomplete/picker pass-through, rich-text formatting shortcuts, formula `enterMode` printable input, and keyup handled/unhandled behavior.
- Editor dependency factory: set cell, set date preserving time fraction for datetime values, calculated-column autofill, validation enforcement mapping, circular-reference iterative calculation flow, formula syntax with implicit row structured references, formula error callbacks, and CSE array formulas.
- Pane navigation: wrapper registration for toolbar, formula bar, grid, and status bar; unregister on hidden panels; F6 and Shift+F6 order; document remount cleanup.
- App layout: toolbar/formula/status/sheet-tabs gates, above-grid slot placement, panel/overlay/dialog layer placement, read-only ribbon hiding, and theme attributes.
- View shell, if kept: real view instance selection, adapter mount/unmount/dispose, view switcher keyboard/mouse behavior, table-bound view binding, and record detail field read/edit behavior.
- Indicators: export progress/success/error state and no inert mounted notification surface.

Production-path UI/eval gates:

- Run the app in a browser and exercise the changed flows through real keyboard, mouse, and clipboard input.
- E2E coverage for Alt keytips, Enter/Tab/Escape while editing in grid and formula bar, Ctrl/Cmd+PageUp/PageDown from sheet tabs/chrome/body, F6 pane navigation, validation dialogs, circular-reference warning, paste overwrite/protection dialogs, read-only mode, export notification behavior, and view switching/record detail if that shell remains live.
- Do not use direct state mutation, direct actor sends, or test-only APIs to set up E2E assertions.

## Risks, edge cases, and non-goals

Risks:

- Keyboard capture is a high-risk production path. A small ordering change can swallow dialog keys, break formula editing, disable browser text input, or cause double handling.
- Extracting provider bridge modules can change effect ordering. Tests must pin which bridge installs before keyboard capture starts routing events.
- React development StrictMode can expose duplicate mount/unmount behavior. Provider lifecycle tests should prove listeners and coordinator instances are not leaked.
- Moving the live layout from `index.tsx` into `src/app` can accidentally change feature gate ordering, theme scoping, slot placement, or layer z-order.
- Pane navigation registration can hold stale DOM elements when panels are hidden or documents remount.
- The circular-reference iterative-calculation callback is async and currently logs failure. Moving it behind host reporting must preserve cancel fallback.
- View shell scaffolding may overlap with the separate shell-coordinator ownership plan. Keep the ownership decision explicit before implementing view switching behavior.

Edge cases to test:

- Provider unmount while validation/circular-reference callbacks are pending.
- Document remount with an old keydown event still in flight.
- Focus on `BODY` after a popover closes.
- Focus inside a Radix dialog that deliberately declines autofocus.
- Formula bar editing while sheet switching.
- Formula autocomplete open with `Tab`, `Enter`, and `Escape`.
- Hidden formula bar/status bar/ribbon during F6 navigation.
- Read-only workbook with toolbar hidden but keyboard shortcuts still available.
- Export failure while a previous success notification is visible.
- Record detail opened for a row deleted remotely or a table renamed/imported after opening.

Non-goals:

- Do not rewrite `SheetCoordinator` internals in this workstream.
- Do not change action handler semantics except where app bridge callbacks expose existing behavior.
- Do not add compatibility shims for the placeholder `viewId === viewType` model. Either implement real view instances or remove the scaffold from the production app folder.
- Do not move durable data into React state, shell store state, or coordinator caches.
- Do not optimize benchmark-only or test-only paths.
- Do not use direct state mutations in E2E tests.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the app boundary contract is accepted:

- Agent A: extract production app layout from `index.tsx` into `src/app`, wire pane wrappers, and add layout/gating tests.
- Agent B: extract keyboard capture routing into pure functions and add exhaustive unit/integration tests.
- Agent C: split `CoordinatorProvider.tsx` bridge modules, create editor/keyboard dependency factories, and add provider lifecycle tests.
- Agent D: resolve `Shell`, `ViewSwitcher`, and `RecordDetailSidebar` by either implementing real view instance/record-detail behavior or removing the unused scaffolding.
- Agent E: connect `SpreadsheetIndicators` to real export/status state and add notification accessibility tests.
- Agent F: run package gates and browser E2E scenarios through real UI input paths.

Dependencies:

- `apps/spreadsheet/src/index.tsx` for current live layout, feature gates, slots, export handler, and layer ordering.
- `apps/spreadsheet/src/hooks/shared/use-coordinator.tsx` for coordinator construction, host capability injection, and lifecycle behavior.
- `apps/spreadsheet/src/coordinator` for the `SheetCoordinator` contract, keyboard coordinator, editor actors, and pane focus actors.
- `apps/spreadsheet/src/systems/input/keyboard` for keyboard coordinator semantics and chord/keytip behavior.
- `apps/spreadsheet/src/components/navigation/PaneNavigationProvider.tsx` and `apps/spreadsheet/src/systems/input/coordination/pane-navigation-coordination.ts` for F6 pane registration.
- `apps/spreadsheet/src/chrome/**`, `apps/spreadsheet/src/components/grid/**`, and `apps/spreadsheet/src/chrome/layers` for the production app layout surface.
- `apps/spreadsheet/src/views/**`, `apps/spreadsheet/src/infra/context/shell-context.tsx`, and `apps/spreadsheet/src/coordinator/shell-coordinator.ts` if view switching and record detail remain production scope.
- `mog-internal/dev/app-eval/scenarios/**` for browser-backed app verification through real keyboard, mouse, and clipboard paths.
