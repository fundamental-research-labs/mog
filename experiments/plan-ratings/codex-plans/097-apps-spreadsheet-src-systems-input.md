# 097 - Spreadsheet Input Systems Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/systems/input`

Queue item: 97

Scope: input actor machines and event coordination for the public spreadsheet app. This folder owns the app-local input facade, keyboard shortcut coordination, gesture physics, pointer and touch event routing, F6 pane focus state, DOM focus coordination, pointer capture helpers, auto-scroll helpers, actor access for pane focus, and test utilities.

Primary files and subareas inspected:

- `input-system.ts` and `types.ts`: public `IInputSystem` facade, lifecycle, focus actor wiring, pointer state, scroll/zoom subscriptions, coordinator ownership, and actor-access exposure.
- `coordination/input-coordination.ts`: production wheel, touch, pointer, pan, scroll, zoom, hit-test, animation-loop, renderer callback, and sheet event forwarding path.
- `keyboard/keyboard-coordinator.ts`: keyboard normalization, shortcut matching, context cascade, read-only policy, action dependency assembly, keytip/chord state, IME guards, selection-mode pre-handlers, and keyup handling.
- `machines/grid-input-machine.ts`, `machines/pane-focus-machine.ts`, and `machines/input-types.ts`: pure XState machines and event contracts for gestures and pane navigation.
- `coordination/focus-coordination.ts`, `pane-navigation-coordination.ts`, `initial-focus-coordination.ts`, and `pointer-capture-coordination.ts`: DOM focus restoration, F6 DOM focus execution, initial grid focus, and pointer capture side-effect coordinators.
- `physics/scroll-physics.ts`, `physics/zoom-physics.ts`, and `coordination/auto-scroll-service.ts`: passive scroll/zoom engines and drag auto-scroll service.
- `input-events.ts`, `actor-access/pane-focus-accessor.ts`, `shared-types.ts`, and `testing/*`: sheet event routing, actor boundary, narrow UI-store type, and current harness/tests.

Adjacent production paths that must be treated as part of the contract:

- `apps/spreadsheet/src/app/CoordinatorProvider.tsx` installs document-level keyboard capture and injects keyboard dependencies.
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`, `components/grid/effects/useInputListeners.ts`, `components/grid/effects/useRendererSync.ts`, and `hooks/editing/use-input-event-handlers.ts` bind native wheel/touch/keyboard handlers and wire renderer capabilities into `InputCoordinator`.
- `apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts` still owns much of the production pointer selection/object path, active pointer ID tracking, pointer-capture container registration, grid focus on pointer down, double-click edit, table click, and drag termination.
- `apps/spreadsheet/src/coordinator/sheet-coordinator.ts` creates `InputSystem`, owns the shared shell focus actor, starts systems, wires scroll-commit, and dispatches drag terminators on pointer up/cancel.
- `apps/spreadsheet/src/actions/handlers/navigation.ts` consumes pane-focus commands for F6 actions.
- `apps/spreadsheet/src/systems/grid-editing` consumes input-driven selection, editing, drag, fill, resize, auto-scroll, and scroll-commit outcomes.
- `@mog-sdk/sheet-view` capabilities are the public renderer boundary for hit testing, geometry, viewport bounds, commands, and scroll publication.

This plan targets production paths only. It does not propose mock-only improvements, direct state mutation shortcuts, compatibility shims, or test-only optimizations.

## Current role of this folder in Mog

`systems/input` is the spreadsheet app's input operating layer. It is the boundary where raw browser input and app-level focus state become spreadsheet gestures, shortcut actions, sheet events, scroll/zoom changes, and DOM focus transitions.

The current architecture already separates several concerns correctly:

- `InputSystem` is the public facade. It creates and owns `InputCoordinator`, `KeyboardCoordinator`, `PointerCaptureManager`, and the pane-focus actor. It wraps the shared shell focus actor with `FocusCoordination` after `SheetCoordinator` supplies it.
- `InputCoordinator` owns the grid-input actor, scroll and zoom physics, wheel/touch/pan normalization, hit testing, scroll/zoom publication, and its own requestAnimationFrame loop for physics updates.
- `KeyboardCoordinator` owns the production shortcut path from raw `KeyboardEvent` to unified action dispatch. It delegates normalization and matching to the kernel keyboard layer, derives app context from actors, owns Alt/keytip chord state, blocks IME composition, applies read-only policy, and builds `ActionDependencies`.
- `grid-input-machine` and `pane-focus-machine` are intended to stay pure: they mutate only serializable context and leave physics, DOM focus, pointer capture, timers, and renderer calls to coordinators.
- `FocusCoordination` owns DOM focus restoration and grid focus side effects around the shared shell focus stack.
- `pane-focus-accessor.ts` is the actor-access layer for pane focus: fresh snapshot reads through accessors and typed sends through commands.
- `ScrollPhysics` and `ZoomPhysics` are passive engines, with the coordinator deciding when to update and how to publish state.
- `auto-scroll-service.ts` exposes reusable edge detection and drag auto-scroll loop logic that grid-editing features can consume.

There are also important production gaps and ambiguity:

- `useRendererSync` wires `InputCoordinator.forwardToSheet` as a no-op even though `InputCoordinator` can already emit cell, header, fill-handle, and resize events. Production selection and edit pointer logic still largely lives in `use-grid-mouse.ts`.
- `SheetInputEvent` includes `COLUMN_RESIZE_START` and `ROW_RESIZE_START`, and `InputCoordinator` emits them, but `handleInputEventAction()` has no cases for them.
- Header click routing uses fixed bounds (`endRow: 999`, `endCol: 25`) instead of sheet dimensions or a selection command contract.
- `setupPointerCaptureCoordination()` is defined but appears unwired in production; the pointer capture manager is mounted and active pointer IDs are stored, but actor drag transitions do not drive capture start/end.
- Auto-scroll APIs are similarly under-wired: `InputSystem.setLastMousePosition()` exists, but production pointer move does not appear to update it, and `setupAutoScrollFeature()` is exported from grid-editing but not installed on the production path.
- F6 pane navigation is conceptually present but not fully connected. `KeyboardCoordinatorDependencies` has a `paneFocusActor`, and `CoordinatorProvider` passes it, but `buildActionDependencies()` does not pass it to the access-layer builder, so navigation handlers can miss `deps.commands.paneFocus`. Pane DOM registration also appears incomplete.
- `setupInitialFocusCoordination()` has no call sites, so the "renderer ready plus grid container registered" focus contract is currently not active.
- Tests cover much of the coordinator mechanics, but several tests/helpers can drift from production types because test TS is not part of the app typecheck gate.

## Improvement objectives

1. Establish a single production input ownership contract.

   Define which input layer owns wheel/touch/pan, cell/header/fill/resize pointer events, object pointer events, DOM focus, pane focus, keyboard shortcuts, context menus, long press, pointer capture, auto-scroll, and drag termination. Remove no-op bridges and duplicated routing where they create ambiguity.

2. Complete the pointer-to-sheet event bridge.

   Make `InputCoordinator.forwardToSheet` route all emitted `SheetInputEvent` variants to grid-editing/object/resize/fill handlers through typed production commands. The target state is not "all pointer code moves into InputCoordinator"; it is one explicit bridge where hit-test classification, gesture ownership, and downstream grid-editing semantics compose without parallel behavior.

3. Make input events exhaustive and dimension-aware.

   Replace stringly switch gaps and fixed header selection ranges with typed event handlers, compile-time exhaustiveness checks, and sheet dimension/range contracts from workbook, renderer geometry, or selection commands.

4. Wire F6 pane navigation end to end.

   The production path should be raw F6/Shift+F6 key input -> keyboard coordinator -> unified action -> pane focus command -> pane actor transition -> registered DOM element focus. Missing actor-access wiring and missing pane element registration should be fixed as a complete set.

5. Turn pointer capture and auto-scroll from dormant helpers into active production coordination.

   Install pointer capture coordination after the relevant actors and container are available, update last mouse position through the same native pointer path users exercise, and install drag auto-scroll for selection, fill handle, row/column header selection, formula range dragging, and object operations where appropriate.

6. Make physics and gesture timing deterministic and policy-driven.

   Keep scroll/zoom engines passive, but remove mixed clock semantics (`ScrollPhysics.animateTo()` using `performance.now()` while momentum uses `deltaTimeMs`). Add explicit reduced-motion, trackpad/discrete wheel, snapping, rubber-band, and bounds policies that tests and production wiring consume.

7. Strengthen keyboard/chord policy as a typed state contract.

   Preserve current kernel-normalizer/matcher delegation, but move coordinator-owned chord and read-only behavior toward explicit, testable policies so Alt-tap, Alt-held disambiguation, register-transition keys, cascade preemption, and read-only blocks cannot drift as shortcuts/actions grow.

8. Make focus initialization and restoration observable and deliberate.

   Wire or remove `setupInitialFocusCoordination`; do not leave stale contracts. Grid focus, editor focus, sheet-tab focus, dialog restoration, formula bar focus, and body/html fallback routing must have one documented state-machine plus DOM side-effect path.

9. Upgrade verification to real input paths.

   Unit tests should keep pure machines and services stable, but browser/app-level gates must use real keyboard, mouse, touch/clipboard where applicable, and DOM focus behavior. E2E tests must not mutate actors directly to assert input behavior.

## Production-path contracts and invariants to preserve or strengthen

- Public repo dependency direction remains strict: `mog` must not depend on `mog-internal`.
- Machines remain pure. `grid-input-machine` and `pane-focus-machine` must not touch DOM, renderer objects, workbook APIs, timers, global document/window, or physics engines.
- Coordinators own side effects. DOM focus, pointer capture, requestAnimationFrame loops, scroll publication, renderer invalidation, keyboard dispatch, and native event cancellation live in coordinator or hook wiring, not in machines.
- `InputSystem` remains the public facade for spreadsheet input. Other systems should interact through `IInputSystem`, actor accessors/commands, or explicit `SheetCoordinator` wiring.
- `InputCoordinator.setScrollPosition` is the single owner path for input-driven scroll publication into renderer execution. `scrollTo`, `scrollBy`, wheel, touch pan, momentum, snap-to-cell, and auto-scroll must publish through it. `resetScrollPosition` intentionally must not publish callbacks.
- `requestFrame` is preferred for scroll frames when available; `requestRender` remains a fallback. Scroll changes should dirty the renderer through the same production path that recomputes layout.
- Wheel input must keep trackpad vs discrete wheel discrimination. Trackpad inertial events must not receive duplicate app momentum. Shift+wheel horizontal scrolling, deltaMode normalization, and page/line scroll behavior must remain cross-platform.
- Reduced-motion preference disables app-driven momentum/animations where the input layer owns them.
- Programmatic `animateScrollTo()` is not momentum and must not trigger snap-to-cell side effects intended only for inertial user scroll.
- Zoom commands must clamp to configured min/max and publish through `sheetView.commands.dispatch({ type: 'set-zoom', ... })`.
- Pointer event ownership must be explicit. Scrollbar regions, DOM overlays marked `data-no-grid-pointer`, inline editor pointer events, object pointer operations, and grid cell selection must not race each other.
- Pointer capture starts only after an active pointer ID exists and a selection/object drag state is entered. It releases on drag exit, pointer cancel, pointer up, or window blur. Capture side effects must follow actor state, not speculative DOM events.
- Auto-scroll uses viewport bounds already adjusted for frozen panes and split/frozen regions. It must clamp velocity to configured bounds and support diagonal edge/corner scrolling when both axes are near edges.
- `SheetInputEvent` handling is exhaustive. Adding an event variant must fail a compile-time/test gate until it is routed, explicitly ignored with reason, or removed.
- Header selection ranges must use real sheet dimensions or a selection command that owns whole-row/whole-column semantics, not hard-coded 1000-row/26-column defaults.
- F6 pane state is single-source. If both XState `state.value` and `context.currentPane` remain, tests must prove they cannot diverge; preferably derive one from the other.
- F6 keyboard path must dispatch through the unified action system and typed pane-focus commands, not a separate key listener.
- Pane DOM focus executes only for registered, still-mounted elements and must fall back predictably when a pane is absent.
- Focus stack restoration preserves editor/dialog contracts. `focusGrid()` should not steal focus from newly mounted sheet-tab rename or other top-layer inputs.
- IME composition remains the first keyboard guard. Non-Escape events during composition must not enter shortcut or chord handling.
- Autocomplete and picker dropdowns own Tab, Enter, and Escape while open. Keyboard coordinator routes those keys only when these overlays are closed.
- Read-only keyboard policy remains default-deny for mutating actions and must come from an auditable action/shortcut metadata source or a generated completeness gate.
- Chord/keytip UI remains display-only through `useChordModeSnapshot`; UI consumers do not mutate coordinator chord state directly.
- Lifecycle cleanup is deterministic. Timers, document/window listeners, rAFs, subscriptions, pointer capture, callback sets, and actors must be cleaned up on dispose. A disposed coordinator/system must not accept further events.
- Test helpers must match production dependencies. Stale `coordinateSystem`-style mocks must not silently pass when production uses `hitTest`, `viewport`, `geometry`, and `commands` capabilities.

## Concrete implementation plan

### 1. Write an input ownership contract map

Add source-local contracts that describe the production input boundary:

- `contracts/input-ownership.ts`: ownership for keyboard, wheel, touch, pan, cell pointer, object pointer, scrollbar pointer, long press, context menu, pointer capture, drag termination, and focus.
- `contracts/sheet-input-events.ts`: exhaustive `SheetInputEvent` routing metadata, owner system, expected downstream command, and ignored-event policy if any.
- `contracts/focus-contracts.ts`: focus stack layers, pane focus targets, DOM registration requirements, and focus restoration rules.
- `contracts/gesture-policy.ts`: wheel/momentum/snap/reduced-motion/rubber-band/trackpad/scroll-bounds policies.

Use these contracts in implementation and tests. Do not create documentation-only files that production code ignores.

### 2. Complete `SheetInputEvent` routing

Make `handleInputEventAction()` exhaustive over `SheetInputEvent`.

Implementation details:

- Add explicit handling for `COLUMN_RESIZE_START` and `ROW_RESIZE_START`, routing to the existing grid-editing resize coordinator or typed selection/resize commands.
- Replace direct inline `SET_SELECTION` for headers with a command such as `selectEntireColumn(col, sheetDimensions)` / `selectEntireRow(row, sheetDimensions)` or an actor command that carries `isFullColumn` / `isFullRow` semantics.
- Replace fixed `endRow: 999` and `endCol: 25` with workbook/sheet dimension capability, renderer bounds, or a selection-machine full-row/full-column representation.
- Add an exhaustive `never` default so new event variants cannot be silently dropped.
- Update `InputEventDependencies` to include only real production capabilities needed by event routing, and make missing optional capabilities explicit in return results or metrics.

### 3. Replace the no-op `forwardToSheet` bridge

In `useRendererSync`, replace the no-op `forwardToSheet` callback with a real bridge into grid-editing and object systems.

The bridge should:

- Preserve existing `use-grid-mouse.ts` behavior while moving classification/routing into one typed adapter in phases.
- Route cell pointer down/move/up to selection, formula range picking, fill handle, drag-drop, and commit-on-click-away workflows through grid-editing commands.
- Route double-click edit through the current edit entry path, preserving selection-border and fill-handle reserved gestures.
- Route resize starts to the resize coordinator, preserving header hit-test source and active pointer ID.
- Route right-fill-handle start so the context menu and right-drag workflow still use the same release behavior.
- Route header clicks to table-specific selection when the hit is inside a table header/corner/data region, not only plain row/column selection.
- Leave object hit handling with `ObjectSystem` where object interaction is the owner, but make the ownership decision explicit before forwarding.

Do this as a production-path migration, not by adding a second pointer implementation. During migration, keep a clear split: hit-test classification can live in input, but domain-specific mutation semantics remain in grid-editing/object systems.

### 4. Wire pointer capture coordination

Install `setupPointerCaptureCoordination()` in the real composition path after the selection actor, object actor, pointer capture manager, and grid container are available.

Implementation details:

- Move pointer capture setup out of a passive container setter only and into a lifecycle node owned by `InputSystem` or `SheetCoordinator`.
- Keep `pointerCaptureManager.setContainerElement(container)` from the grid DOM registration path, but add actor subscription setup and cleanup.
- Ensure `setActivePointerId()` is called before actor transitions into drag states for selection, fill, resize, drag-drop, formula range picking, table resize, and object operations.
- Clear active pointer ID on pointer up/cancel after terminators run.
- On window blur, send the existing reset/cancel events through selection/object actors, release capture via actor transition, and clear active pointer ID.
- Add tests that prove capture starts on actual actor drag transitions and releases on pointer up, pointer cancel, window blur, and actor reset.

### 5. Wire drag auto-scroll on production paths

Make auto-scroll an installed feature, not an exported helper that is rarely reached.

Implementation details:

- Update native pointer move handling to call `input.setLastMousePosition()` with viewport coordinates for every grid-owned pointer move that can feed drag auto-scroll.
- Install `setupAutoScrollFeature()` with selection and object actors, viewport capability, `input.getLastMousePosition`, `input.inputCoordinator.scrollBy`, and renderer frame request.
- Include formula range drag auto-scroll either by reusing the same installed feature with formula-specific thresholds or by installing a dedicated formula range auto-scroll controller through the same service.
- Fix `getScrollVelocity()` so negative distances/outside-viewport positions cannot produce speeds above `maxSpeed`.
- Add diagonal/corner auto-scroll support by computing both horizontal and vertical proximity instead of returning only the single closest edge.
- Ensure auto-scroll stops on drag end, cancel, pointer capture release, sheet switch, unmount, and dispose.
- Preserve frozen-pane adjusted viewport bounds from `ISheetViewViewport.getViewportBounds()`.

### 6. Complete F6 pane navigation

Fix the complete F6 path rather than only the action handler.

Implementation details:

- Update `KeyboardCoordinatorDependencies.createAccessLayer` input shape to include `paneFocusActor`, or provide input-system actor access directly to action dependencies.
- Ensure `buildActionDependencies()` passes the pane focus actor so `deps.commands.paneFocus.focusNextPane()` and `focusPreviousPane()` are present.
- Register real pane elements for toolbar/ribbon, formula bar, grid, and status bar using `PaneNavigationSetup` or a replacement provider that is actually consumed.
- Make each pane target focusable and assign stable data attributes for tests and focus restoration.
- Make pane focus fallback behavior explicit when optional panes are hidden, disabled, or unmounted. Decide whether F6 skips missing panes or keeps logical pane state with no DOM focus change; encode that policy in tests.
- Remove unused `PaneNavigationProvider`/`usePaneElementRefs` layers if they are not part of the real production path after wiring.
- Add table-driven tests for `paneFocusMachine` cycles and state/context identity.

### 7. Decide and wire initial focus coordination

`setupInitialFocusCoordination()` should either become production wiring or be removed/replaced.

Preferred implementation:

- Wire it from `SheetCoordinator` or `InputSystem` after renderer actor and focus coordination are both available.
- Treat renderer ready plus grid container registration as the one-time condition for initial grid focus.
- Preserve user intent: if a user clicked or focused another element during initialization, do not steal focus.
- Coordinate with `focusGrid()` and sheet switch focus restoration so multiple rAF focus calls do not fight.
- Add tests for ready-before-container, container-before-ready, already-focused element, dispose-before-ready, and sheet switch not re-triggering initial focus.

### 8. Make scroll and zoom physics deterministic

Refactor `ScrollPhysics` so both momentum and smooth animation are driven by `deltaTimeMs` or an injected clock, matching the determinism of `ZoomPhysics`.

Implementation details:

- Replace `performance.now()` inside `ScrollPhysics.update()` / `animateTo()` with accumulated elapsed time driven by `update(deltaTimeMs)` or a clock dependency.
- Preserve ease-out behavior and bounds clamping.
- Keep `animateScrollTo()` marked as programmatic so snap-to-cell is not triggered.
- Add reduced-motion policy handling for programmatic scroll animations if product behavior calls for immediate jumps under reduced motion.
- Clarify rubber-band behavior: if enabled, ensure user dragging state is actually set from pan/touch lifecycle; if not production-ready, gate it behind explicit config instead of silently existing as partial behavior.
- Add tests for deterministic animation with fixed frame deltas, clamping, interrupt, reduced motion, snap-to-cell after momentum only, and no snap after programmatic animate.

### 9. Extract keyboard chord and read-only policies into explicit contracts

Keep the public `KeyboardCoordinator` API stable while making its most sequence-sensitive state easier to test.

Implementation details:

- Extract Alt-tap/chord transition logic into a pure reducer or small state machine that returns effects such as `dispatchDefault`, `dispatchShortcut`, `armTimer`, `clearTimer`, `notify`, and `fallThrough`.
- Keep kernel `KeyboardEventProcessor` and `ShortcutMatcher` as the stateless matching authority.
- Add typed reasons for policy blocks, especially read-only blocks, instead of overloading `wrong_context`.
- Generate or validate the read-only allowlist from action metadata once the action registry exists; until then, add a completeness test that fails when new `ActionType`s are not classified.
- Preserve `useChordModeSnapshot()` as read-only display state and keep `useSyncExternalStore` snapshot identity stable.
- Add integration tests that cover document-level capture, grid bubbling, body/html fallback, dialog target bypass, editable target bypass, IME composition, formatting shortcuts inside editor selection, and paste-options keyup.

### 10. Type-check tests and align test utilities with production dependencies

Update test harnesses so they cannot drift from production contracts.

Implementation details:

- Replace stale test dependency helpers that pass `coordinateSystem` / `getActiveSheetId` to `InputCoordinator` with helpers that implement `hitTest`, `viewport`, `geometry`, `commands`, `forwardToSheet`, `setScrollPosition`, `requestFrame`, and `requestRender`.
- Add a test tsconfig or package test gate that type-checks `src/systems/input/**/__tests__` and `src/systems/input/testing/**`.
- Move any production-useful simulators to match real event paths: native `KeyboardEvent`, `PointerEvent`, `WheelEvent`, `TouchEvent` where possible, not direct actor sends unless the unit under test is the actor.
- Keep pure service tests for physics and auto-scroll, but add browser-level tests for DOM focus and pointer capture.

### 11. Add observability for input workflow failures

Use the existing `onMetric` shape or add a narrow input metric surface for production diagnostics.

Metrics should include:

- Unhandled `SheetInputEvent` variant or explicit ignored-event reason.
- Missing input dependencies at the time an event is received.
- Pointer capture start/end/failure and blur cancel.
- Auto-scroll start/stop and velocity clamp.
- F6 action disabled because pane-focus commands or DOM element registration are missing.
- Chord cancel/preempt reasons and read-only action blocks.
- Scroll publish latency and animation completion/cancel.

Metrics must not leak private/internal data and must not become required dependencies for normal app operation.

## Tests and verification gates

Do not rely only on typecheck or direct actor mutation. The eventual implementation should run behavior gates that exercise the same paths users use.

Focused unit and integration gates:

- `pnpm --filter @mog/app-spreadsheet test -- src/systems/input`
- `pnpm --filter @mog/app-spreadsheet test -- src/systems/input/keyboard/__tests__/keyboard-coordinator.test.ts src/systems/input/keyboard/__tests__/keyboard-coordinator-chord.test.ts`
- `pnpm --filter @mog/app-spreadsheet test -- src/systems/input/testing/__tests__/keyboard-dispatch.test.ts src/systems/input/__tests__/input-events.test.ts`
- `pnpm --filter @mog/app-spreadsheet test -- src/systems/input/coordination/__tests__/auto-scroll-service.test.ts src/systems/input/physics/__tests__/scroll-physics.test.ts`
- Existing coordinator/input tests outside the folder, including `src/coordinator/__tests__/input-coordinator.test.ts`, when `InputCoordinator` behavior or dependencies change.
- If kernel matcher/chord contracts change: `pnpm --filter @mog-sdk/kernel test -- src/keyboard/shortcuts`.

Type gates:

- `pnpm --filter @mog/app-spreadsheet typecheck`
- Repo-level `pnpm typecheck` for public contract, action dependency, keyboard registry, or `@mog-sdk/sheet-view` capability changes.
- Add and run a test typecheck gate for input tests and testing utilities so stale mocks cannot compile only by being excluded from the package tsconfig.

Browser/UI gates through real input:

- Run the spreadsheet dev server and exercise wheel scroll, shift+wheel horizontal scroll, trackpad-like wheel, Ctrl/Cmd+wheel zoom, touch pan, pinch zoom, middle-click pan, and space+drag pan.
- Exercise cell click, selection drag, fill-handle drag, right-fill-handle drag, row/column header selection, row/column resize start, double-click edit, click-away commit, and table header/corner selection using real pointer events.
- Exercise pointer leaving the grid/window, pointer cancel, window blur during drag, and capture release.
- Exercise edge auto-scroll for selection/fill/object drags, including diagonal corner movement and frozen-pane bounds.
- Exercise F6 and Shift+F6 from the real app through document keyboard capture, confirming focus cycles toolbar, formula bar, grid, and status bar or skips missing panes according to the chosen policy.
- Exercise Alt-tap keytips, Alt-held chord disambiguation, Escape cancel, click-outside cancel, Ctrl/Meta shortcuts during pending chord, and keytip overlay display.
- Exercise IME composition so non-Escape keys are not intercepted.
- Exercise read-only mode with mutating and non-mutating keyboard shortcuts.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Pointer event migration can easily duplicate selection, object, table, and editor behavior. The plan must migrate to one explicit routing bridge, not add another active path beside `use-grid-mouse.ts`.
- Moving hit-test classification into input must not move grid-editing mutation policy into input. Selection, editing, fill, resize, table, and object semantics stay with their owning systems.
- Pointer capture requires precise ordering: active pointer ID must be set before drag state transitions, and released after terminators/cancel paths consume the final event.
- Auto-scroll and input-driven scroll share the same `InputCoordinator.scrollBy()` path; loops must stop deterministically on drag end/dispose to avoid scroll after unmount.
- F6 pane registration depends on chrome components that may mount conditionally. Missing panes need a clear skip/fallback policy.
- Focus restoration rAFs can race sheet-tab rename, dialogs, formula bar edits, and body/html fallback shortcuts. Tests should cover these races explicitly.
- Chord/keytip behavior is highly sequence-sensitive and platform-sensitive. Extracting a reducer should preserve existing behavior before expanding policy.
- Read-only classification can diverge from action dispatcher policy unless both consume the same metadata or a generated completeness gate.
- Test harness changes may reveal stale tests that currently pass because test TypeScript is excluded. Fix the tests to match production contracts instead of weakening production types.
- `ScrollPhysics` determinism changes can subtly affect UX timing. Preserve current curves unless the product explicitly changes them.

Non-goals:

- Do not add direct actor mutation as an E2E shortcut for input behavior.
- Do not introduce compatibility shims around broken input paths.
- Do not optimize test-only handlers, benchmark harnesses, or mock-only paths.
- Do not move public app behavior into `mog-internal`.
- Do not make `systems/input` depend on `ui-store` internals; keep narrow store interfaces where input needs UI state.
- Do not bypass `@mog-sdk/sheet-view` capabilities to reach raw renderer internals.
- Do not remove Excel-parity behaviors such as F6 pane cycling, Alt keytips, End/F8 modes, IME protection, and formula point mode to simplify routing.

## Parallelization notes and dependencies on other folders, if any

Natural parallel workstreams:

- Agent A: event contract and pointer bridge. Own `SheetInputEvent` exhaustiveness, `handleInputEventAction()`, dimension-aware header selection, and `forwardToSheet` replacement in `useRendererSync`.
- Agent B: pointer capture and auto-scroll. Own `setupPointerCaptureCoordination()` production wiring, active pointer lifecycle, last mouse position updates, auto-scroll feature setup, diagonal/clamped velocity, and drag cleanup tests.
- Agent C: F6 and focus. Own pane-focus actor access in keyboard dependencies, pane DOM registration, pane machine invariants, initial focus coordination, and real F6 UI tests.
- Agent D: physics determinism. Own `ScrollPhysics` clock/delta refactor, reduced-motion policy, rubber-band policy, snap-to-cell tests, and scroll/zoom regression tests.
- Agent E: keyboard policy. Own chord reducer extraction, read-only policy metadata/completeness, typed result reasons, `useChordModeSnapshot` tests, and document capture integration tests.
- Agent F: test infrastructure. Own production-shaped input test helpers, test tsconfig/typecheck gate, and UI/E2E scenarios using real input.

Dependencies:

- `mog/apps/spreadsheet/src/systems/grid-editing` for selection, editing, fill, resize, table, formula range, drag-drop, scroll-commit, and auto-scroll behavior.
- `mog/apps/spreadsheet/src/systems/objects` for object pointer operations and object drag capture.
- `mog/apps/spreadsheet/src/actions/handlers` and `mog/contracts/src/actions/types.ts` for pane navigation actions, read-only policy, and typed action dependencies.
- `mog/apps/spreadsheet/src/app/CoordinatorProvider.tsx` for document-level keyboard capture and dependency injection.
- `mog/apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts` and grid components for the current native pointer path.
- `mog/apps/spreadsheet/src/systems/renderer` and `@mog-sdk/sheet-view` for hit testing, geometry, viewport bounds, renderer invalidation, and scroll/zoom commands.
- `@mog-sdk/kernel/keyboard` for keyboard normalization, shortcut matching, and chord matching contracts.
- `@mog/shell` focus machine for shared focus stack state.
