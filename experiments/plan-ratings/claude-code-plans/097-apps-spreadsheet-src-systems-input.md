# 097 — Improve `mog/apps/spreadsheet/src/systems/input` (input actor machines and event coordination)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/systems/input`
- **Size:** ~7,511 lines of production `.ts` (excluding `__tests__/` and `testing/`). Top files: `keyboard/keyboard-coordinator.ts` (1,752), `coordination/input-coordination.ts` (1,268), `machines/grid-input-machine.ts` (706), `physics/scroll-physics.ts` (520), `input-system.ts` (475), `coordination/focus-coordination.ts` (463), `types.ts` (412), `machines/pane-focus-machine.ts` (315), `coordination/auto-scroll-service.ts` (303), `coordination/pointer-capture-coordination.ts` (295), `physics/zoom-physics.ts` (231), `machines/input-types.ts` (215), `coordination/pane-navigation-coordination.ts` (141), `coordination/initial-focus-coordination.ts` (105), `input-events.ts` (94).
- **In scope (edit targets):**
  - **System facade:** `input-system.ts` (`InputSystemImplements IInputSystem`), `types.ts` (`IInputSystem`, `InputDependencies`, `InputActorAccess`, `InputSystemConfig`), `shared-types.ts` (`KeyboardUIStore`).
  - **Actor machines:** `machines/grid-input-machine.ts` (the `inputMachine`: idle/scrolling/momentum/panning/pinching/zooming), `machines/pane-focus-machine.ts` (F6 pane cycle), `machines/input-types.ts` (context/event/config types).
  - **Gesture coordination + physics:** `coordination/input-coordination.ts` (`InputCoordinator`), `physics/scroll-physics.ts`, `physics/zoom-physics.ts`.
  - **Keyboard coordination:** `keyboard/keyboard-coordinator.ts` (`KeyboardCoordinator` + chord/alt-tap state machine + selection-mode routing + read-only allowlist), `keyboard/use-chord-mode-snapshot.ts`.
  - **Focus / pane / pointer-capture coordination:** `coordination/focus-coordination.ts`, `coordination/pane-navigation-coordination.ts`, `coordination/pointer-capture-coordination.ts`, `coordination/initial-focus-coordination.ts`, `coordination/auto-scroll-service.ts`, `actor-access/pane-focus-accessor.ts`.
  - **Pointer→sheet routing:** `input-events.ts` (`handleInputEventAction`), and the `SheetInputEvent`/`routePointerToSheet`/`hitTest`/`handlePointerDown|Move|Up` surface inside `input-coordination.ts`.
  - `coordination/index.ts`, `physics/index.ts`, `keyboard/index.ts`, `actor-access/index.ts`.
- **Out of scope (named for coupling, not edit targets):**
  - **`@mog-sdk/kernel/keyboard`** (`KeyboardEventProcessor`, `ShortcutMatcher`, `matchChordStart/Continuation`, `PendingShortcut`) — the stateless normalizer/matcher the keyboard coordinator delegates to. Treated as a fixed contract; the chord *buffer* state lives here.
  - **`apps/spreadsheet/src/keyboard`** (`KEYBOARD_SHORTCUTS`, `ShortcutContext`, `KeyboardShortcut`) — the shortcut registry. Read-only dependency.
  - **`@mog-sdk/contracts/{machines,actors,rendering,viewport}`, `@mog-sdk/sheet-view`** — `FocusActor`, `PaneFocusAccessor`, `PointerCaptureManager`, `ISheetView*` capabilities, physics-config/state types. Contracts to preserve.
  - **`@mog/shell`** — `focusMachine`/`getFocusSnapshot` (the focus state machine itself lives outside this folder; `FocusCoordination` only wraps it).
  - **`hooks/shared/use-grid-mouse.ts`, `hooks/editing/use-input-event-handlers.ts`, `components/grid/effects/{useInputListeners,useRendererSync}.ts`** — the React listener layer that *attaches* the coordinator's handlers and (for pointers) currently owns grid pointer handling directly. Named because the dead-code finding below straddles this boundary; not edited here except where a follow-up wiring decision requires it.
  - **`selectors`** (`inputSelectors`, `paneFocusSelectors`), **`coordinator/sheet-coordinator.ts`**, **`coordinator/actor-access/`** — consumers/composers; changes rippling into them are flagged as cross-folder dependencies.

## Current role of this folder in Mog

This folder is the spreadsheet app's **input subsystem**: it decides *where* keyboard and pointer/gesture input goes and *how* it is processed. Four layered concerns:

1. **Gesture physics (live).** `InputCoordinator` owns the `inputMachine` actor plus `ScrollPhysics`/`ZoomPhysics` engines and a single `requestAnimationFrame` loop. It consumes raw `wheel`/`touch`/space-key events (attached natively in `components/grid/effects/useInputListeners.ts:198-207` via `hooks/editing/use-input-event-handlers.ts`), runs momentum/snap-to-cell/pinch-zoom physics, and pushes results out through `setScrollPosition`/`onScrollChange`/`onZoomChange` to the renderer (`useRendererSync.ts:207-223`).

2. **Keyboard routing (live).** `KeyboardCoordinator` normalizes events through the kernel processor, determines a `ShortcutContext` from machine snapshots, matches against the registry, and dispatches into the Unified Action System. It additionally owns a hand-rolled **chord/alt-tap state machine** (Excel KeyTip `Alt+H,L…` parity), a **selection-mode pre-handler** (End/Extend mode action rewriting), an **IME composition guard**, and a **read-only allowlist**.

3. **Focus & pane navigation (live).** `FocusCoordination` wraps the shared `focusMachine` and executes all DOM focus side effects (capture/restore, dialog-during-edit notifications, context-menu dispatch). The `paneFocusMachine` + `PaneNavigationCoordination` implement F6 pane cycling (toolbar→formulaBar→grid→statusBar). `InitialFocusCoordination` establishes first-input focus once the renderer is ready. `PointerCaptureCoordination` keeps drag operations alive outside the window by subscribing to selection/object-interaction drag states.

4. **Pointer→sheet routing (largely dead — see Evidence).** `InputCoordinator.handlePointerDown/Move/Up` → `hitTest` → `routePointerToSheet` emit `SheetInputEvent`s through a `forwardToSheet` callback, and `input-events.ts::handleInputEventAction` is the matching consumer. In production this path is inert.

The folder follows a consistent **"machines own state, coordinators own execution"** pattern: every XState machine here is pure (no DOM, no I/O), and a sibling coordinator subscribes and performs side effects.

## Evidence (observed in the current tree)

- **The pointer→sheet routing path is dead code in production.** `useRendererSync.ts:212-216` wires `forwardToSheet` as an explicit **no-op** ("Full event forwarding will be wired in a follow-up"). Grid pointer handling is instead done by native listeners in `hooks/shared/use-grid-mouse.ts:2088-2091` (`pointerdown/move/up/cancel` → selection machine directly). Consequently `InputCoordinator.handlePointerDown/Move/Up` (`input-coordination.ts:424-514`), `hitTest`/`routePointerToSheet` (`:546-620`), the whole `SheetInputEvent` union (`machines/input-types.ts:37-59`), and `input-events.ts::handleInputEventAction` are unreachable on the production path. `rg` confirms `handleInputEventAction` has **zero non-test callers**. It still ships and is still tested (`__tests__/input-events.test.ts`), and it encodes wrong selection bounds (`input-events.ts:82,88`: column-header click selects only `endRow: 999`, row-header click only `endCol: 25` — neither a full column nor full row, and no `isFullRow`/`isFullColumn` flag, vs. the codebase's real max bounds `1048575`/`16383` seen in `merged-navigation.test.ts:549-550`).

- **The input machine holds a dead, drift-prone second copy of scroll/zoom state.** `grid-input-machine.ts` computes `scrollX/scrollY/zoomLevel` via `applyWheelDelta` (`:209-218`), `applyPanDelta` (`:272-284`), `applyZoom` (`:227-234`), `applyPinch` (`:330-348`). But `InputCoordinator` ignores those context values entirely and applies its own `ScrollPhysics`/`ZoomPhysics` (`input-coordination.ts:302-303, 465-466, 286-287`). The machine is used **only for its state name** (`idle`/`scrolling`/`momentum`/`panning`/`pinching`/`zooming`) and `isMomentum`/`isAnimating` derivations. The machine's position math can silently diverge from physics, and the velocity scaling constants disagree across the two owners with no explanation (machine: `×10` wheel `:215`, `×60` pan `:281`; coordinator: EMA-of-`deltaX/dt×1000` `:312`, pan `×0.5` `:935`).

- **`prefers-reduced-motion` is honored on only one of three momentum entry points.** `onMachineStateChange` guards momentum start with `!this.prefersReducedMotion()` (`input-coordination.ts:634-648`), but `handlePointerUp` (`:499-503`) and `handleTouchEnd` (`:408-414`) call `scrollPhysics.startMomentum(...)` directly with no such guard. Pan/touch flicks therefore ignore the accessibility setting that wheel momentum respects — an inconsistency and an a11y defect.

- **Untracked timers can fire against a disposed coordinator.** `scheduleZoomEnd()` (`input-coordination.ts:954-962`) creates a 200ms `setTimeout` that calls `this.inputActor.send(...)`, but `dispose()` (`:1158-1182`) only clears `wheelEndTimeout`, never the zoom-end timer. A wheel-zoom immediately before unmount sends to a stopped actor. (`InputCoordinator.assertNotDisposed()` throws on most public methods, so a late callback path is a latent crash, not just a leak.)

- **`enableKeyboard` config flag is a no-op.** `input-system.ts:187-190` constructs `KeyboardCoordinator` identically in both branches of the `config.enableKeyboard !== false` ternary (the comment even says "Always create"). The documented config knob (`types.ts:135`, `InputSystemConfig.enableKeyboard`) does nothing; callers expecting keyboard to be disabled get it enabled.

- **`focusEditor()` cannot carry a cell identity through the system facade.** `IInputSystem.focusEditor()` (`types.ts:242`) takes no args, and `InputSystem.focusEditor()` (`input-system.ts:279-283`) hardcodes `this.focusCoordination?.focusEditor('')` with the comment "the actual cellId is typically set by the editor system." The `FOCUS_EDITOR` event's `cellId` is therefore always empty on this path — a contract gap, not obviously load-bearing but a smell that masks whether the editor-focus layer ever gets a real cell id.

- **`KeyboardCoordinator` is a 1,752-line multi-responsibility class with a hand-rolled parallel state machine.** It carries: the kernel-delegated matcher, a chord buffer (`chordPending`), an alt-tap detector (`altTap`), a disambiguation timer, a click-outside listener, a subscriber set + snapshot cache for `useSyncExternalStore`, the selection-mode pre-handler, the IME guard, the read-only allowlist, and keyup paste-options handling. Multiple comments explicitly flag that this duplicates state living in `chrome/toolbar/keytips/KeyTipContext.tsx` and anticipate a "listener migration [that] deletes the parallel state machine" (`:425-426, 514-516, 622-632`). The chord logic alone spans ~`740-1455` with intricate Excel-parity branches (Path A/Path B, completed-prefix deferral, alt-held default commit). It is the highest-complexity, lowest-isolation unit in the folder. Every chord machine here is *not* an XState machine, breaking the folder's otherwise-uniform "pure machine + coordinator" pattern.

- **The read-only allowlist is a hand-maintained 120-entry `Set` that duplicates action metadata.** `keyboard-coordinator.ts:226-345` (`READ_ONLY_ALLOWED_ACTIONS`) must be kept in sync by hand with the action registry. New *mutating* actions are correctly blocked-by-default, but a new *safe* navigation/view action is silently blocked until someone remembers to add it here. The source of truth for "is this action read-only-safe" should be the action's own registry metadata, not a parallel set in the input layer.

- **Focus restoration uses CSS-selector capture + multiple rAF hops, with two independent subscriptions tracking `previousStack`.** `FocusCoordination` captures focus as a CSS selector string (`captureReturnFocusTarget`, `:325-345`: `#id` → `[data-focus-id]` → `[data-focus-trap]` → `null`) and restores via `document.querySelector` (`restoreFocus`, `:353-368`), silently falling back to grid on any miss. `setupFocusRestoration` (`:386-410`) and `setupEditorNotifications` (`:416-448`) each subscribe to the focus actor and *independently* maintain their own `previousStack`/`previousStackLength`, so the two bookkeeping copies can desync. `focusGrid()` carries a documented `sheetTabs`-layer rAF race workaround (`:190-213`) and the long comment chain at `:170-205` describes a real, fragile chrome-input-blur edge case. This is the most timing-sensitive code in the folder.

- **Pane-navigation focus has no fallback when the target pane element is unregistered.** `pane-navigation-coordination.ts:91-100`: on a pane transition, if the target element is missing or detached it logs `console.debug` and leaves DOM focus wherever it was, while the machine has already advanced `currentPane`. F6 can then report focus on (e.g.) `statusBar` while DOM focus is still on the grid — a state/DOM divergence with no recovery.

- **`HEADER_CLICK` (dead path) selection ranges are wrong** — already noted above; recorded here because if the forward-to-sheet path is *completed* rather than deleted, this is a correctness bug that must be fixed, not carried forward.

- **Otherwise clean and well-structured.** Zero `TODO`/`FIXME`/`HACK` markers in production files; machines are genuinely pure; coordinators consistently expose `dispose()`/`cleanup()`; subscriptions are tracked in arrays and torn down; physics engines are isolated and unit-tested; selectors are the single extraction path (`getInputSnapshot`/`getPaneFocusSnapshot` compose `inputSelectors`/`paneFocusSelectors`). The improvements below are about **removing a dead parallel path, collapsing duplicated state, closing timer/a11y/focus correctness windows, and de-godclassing the keyboard coordinator** — not redesigning the working physics or focus models.

## Improvement objectives

1. **Resolve the dead pointer→sheet routing path** — make a single, explicit decision (complete the wiring as the single owner, or excise it) so the codebase has exactly one production pointer-routing path. No silently-shipped dead infrastructure.
2. **Collapse the duplicate scroll/zoom state** — make `inputMachine` a pure *phase* machine (states + transitions only) and remove the dead position/velocity math, so physics is the sole source of truth.
3. **Close the gesture-lifecycle correctness windows** — track every timer for disposal, and apply `prefers-reduced-motion` uniformly across all three momentum entry points.
4. **Fix the dead/contradictory config and facade gaps** — make `enableKeyboard` actually gate keyboard handling, and give `focusEditor` a real cell-identity contract (or document that it is intentionally identity-less).
5. **De-godclass `KeyboardCoordinator`** — extract the chord/alt-tap buffer into its own pure machine + coordinator unit consistent with the rest of the folder, and source the read-only-safe determination from action metadata instead of a duplicated allowlist.
6. **Harden focus coordination** — unify the duplicated `previousStack` bookkeeping into one subscription, add an explicit fallback/recovery when pane or restore targets are missing, and reduce reliance on string-selector restoration where a direct element handle is available.

## Production-path contracts and invariants to preserve or strengthen

- **Machines stay pure.** `inputMachine`, `paneFocusMachine`, and any extracted chord machine must remain side-effect-free (no DOM, no timers, no `performance.now()` inside the machine). All side effects stay in coordinators. (Strengthen: moving chord logic into a machine must *not* import DOM/timers into the machine.)
- **Single owner of scroll position.** Scroll position propagates only through `setScrollPosition` (`useRendererSync.ts:222`) / `onScrollChange`; `resetScrollPosition` must continue to *not* fire callbacks or re-enter the save path (`input-coordination.ts:1038-1044`). Preserve.
- **Single owner of pointer routing.** After objective 1, exactly one path turns a grid pointer event into a selection-machine event. No dual dispatch.
- **`ShortcutContext` cascade ordering** (`keyboard-coordinator.ts:656-705`) must be preserved exactly: editing-object-text → formulaEdit/Enter → edit/enter → flashFillPreview → keyTipMode → objectSelected → grid. Any chord extraction must reproduce this ordering and the `preemptChordIfNeeded` cancellation semantics bit-for-bit.
- **Excel KeyTip parity invariants** must be preserved through any refactor: bare Alt-tap ≤ `ALT_TAP_MAX_MS` enters keytip mode; Alt-held leader buffers with single-key default committed on Alt-up or after `CHORD_DISAMBIG_MS`; stray key after a half-typed chord still fires its own shortcut. These are the chord tests' assertions and are behavioral contracts.
- **Read-only safety is fail-closed.** Whatever replaces `READ_ONLY_ALLOWED_ACTIONS` must keep the allowlist semantics: an action is blocked unless *proven* read-only-safe. Never flip to a blocklist.
- **Disposal is idempotent and leak-free.** Every coordinator's `dispose()`/`cleanup()` must clear *all* timers, animation frames, subscriptions, and global listeners. Strengthen to include the zoom-end timer.
- **Focus never silently lands on `<body>`.** The documented contract (`focus-coordination.ts:170-205`) that a navigator both moves selection and returns DOM focus must hold; strengthen the missing-pane case so the machine never reports a pane that DOM focus isn't on.
- **Accessibility:** `prefers-reduced-motion` disables *all* app-driven momentum/animation, not just wheel momentum.

## Concrete implementation plan

### Phase 0 — Decide and resolve the dead pointer path (objective 1)

This is the gating decision; it changes how much of `input-coordination.ts` and all of `input-events.ts` survives.

- **Investigate** (read-only, already partly done): confirm via `rg` that `forwardToSheet` has no non-no-op production producer and `handleInputEventAction` no non-test consumer, and confirm `use-grid-mouse.ts` is the live pointer owner. Document the finding in the PR description.
- **Recommended resolution — excise the dead path** (lower risk, the live path already exists and is battle-tested):
  - Delete `input-events.ts` and `__tests__/input-events.test.ts`; remove `handleInputEventAction`/`InputEventDependencies` from any barrel exports.
  - Remove `handlePointerDown/Move/Up`, `hitTest`, `routePointerToSheet`, `isPointInRect`, and the `getFillHandleBounds` dependency from `InputCoordinator`; drop `forwardToSheet`/`getFillHandleBounds`/`hitTest`/`geometry`-for-routing from `InputCoordinatorDependencies` and `InputDependencies` *only if* not used by the physics/snap path. **Note:** `geometry` is still used by snap-to-cell (`:718-723`) and `commands` by zoom — keep those. Remove the `SheetInputEvent` union and the `pointer*` events from `machines/input-types.ts`.
  - Update `use-input-event-handlers.ts` to stop exposing `onPointerDown` from the coordinator if it is unused by `useInputListeners` (it attaches only wheel/touch/keys), and update `useRendererSync.ts` to drop the no-op `forwardToSheet`.
- **Alternative resolution — complete the wiring** (only if product wants the coordinator to own pointer routing): make `forwardToSheet` dispatch into the selection machine (reusing `use-grid-mouse`'s logic), fix the `HEADER_CLICK` ranges to real full-row/full-column bounds with `isFullRow`/`isFullColumn`, add `CELL_DOUBLE_CLICK` detection (currently never emitted), and *delete* the now-redundant pointer logic in `use-grid-mouse.ts`. This is a larger, higher-risk migration and should be its own plan if chosen.
- Use `AskUserQuestion`/product sign-off to pick a branch; default to excision.

### Phase 1 — Make `inputMachine` a pure phase machine (objective 2)

- Strip `scrollX/scrollY/velocityX/velocityY/zoomLevel/zoomCenterX/zoomCenterY` writes from `applyWheelDelta`/`applyZoom`/`applyPanDelta`/`applyPanDeltaFromTouch`/`applyPinch`/`startMomentum*`/`clearMomentum`. Keep only the context genuinely needed for *transitions/guards*: `activeTouches`, `initialPinchDistance`, `panStartX/Y` (used by touch-pan delta in the coordinator at `:367-368`), and a velocity *threshold* signal if `hasSignificantVelocity` must stay machine-side.
- Move `hasSignificantVelocity` to read a coordinator-supplied value (the physics velocity) rather than dead machine velocity, **or** pass real velocity in the `SCROLL_END`/`PAN_END`/`TOUCH_END` events (PAN_END already carries `velocityX/Y` — `:70-74`). Reconcile so the guard reflects the same velocity the coordinator uses to start momentum.
- Update `getInputSnapshot`/`inputSelectors` consumers: `scrollX`/`zoomLevel` selectors must now read from physics state via the coordinator, not machine context. Audit `hooks/navigation/use-scroll-state.ts` and `hooks/editing/use-input-state.ts` (the live consumers found via `rg systems/input`) and repoint them. This is the main cross-folder ripple; keep the public selector *shape* identical so hook call sites don't change.
- Document the velocity-scaling constants that remain (the `×0.5` pan damping, the EMA wheel velocity) with a one-line rationale each.

### Phase 2 — Gesture lifecycle correctness (objective 3)

- Track the zoom-end timer in a field (`zoomEndTimeout`) and clear it in `dispose()` alongside `wheelEndTimeout`; guard the timer callback with `if (this.isDisposed) return;` before `inputActor.send`.
- Extract a single `private startMomentumIfAllowed(velX, velY, {isMomentumScroll})` helper that checks `momentumEnabled`, the `>50` velocity threshold, **and** `!prefersReducedMotion()`, then starts physics + the animation loop. Call it from all three sites (`onMachineStateChange`, `handlePointerUp`, `handleTouchEnd`) so the a11y guard and threshold are uniform.
- Audit all `requestAnimationFrame`/`setTimeout` in `auto-scroll-service.ts`, `pane-navigation-coordination.ts`, `focus-coordination.ts`, and `initial-focus-coordination.ts` to confirm each is cancelled on dispose (auto-scroll and pane-nav already are; verify the focus rAFs cannot fire post-dispose — add disposed-guards if not).

### Phase 3 — Fix dead config and facade gaps (objective 4)

- Make `enableKeyboard` real: when `false`, either skip `setDependencies` wiring so `handleKeyboardEvent` early-returns `not_found`, or gate `handleKeyboardEvent` on a stored `enabled` flag. Keep the coordinator constructed (other code reads `keyboardCoordinator`), but make the flag observably disable dispatch. Add a test asserting a shortcut is ignored when `enableKeyboard: false`.
- Resolve `focusEditor`: add a `cellId` parameter to `IInputSystem.focusEditor(cellId: string)` and thread the real active cell from the caller, **or** if the editor system is the true owner of editor-focus, delete the `IInputSystem.focusEditor` member and its `input-system.ts` implementation entirely (since it always passes `''`). Pick based on who calls it — `rg` for `\.focusEditor(` across the app; default to deletion if the only caller is dead.

### Phase 4 — De-godclass `KeyboardCoordinator` (objective 5)

- **Extract the chord/alt-tap buffer** into `keyboard/chord-machine.ts` (pure) + keep the coordinator-side glue thin. Two viable shapes:
  - *Preferred:* a real XState `chordMachine` (states: `idle`/`keytipArmed`/`chordPending`) consistent with the folder pattern, with timers injected as coordinator side effects (the disambig deadline and alt-tap window become coordinator-scheduled events, not machine timers — preserving machine purity).
  - *Minimal:* a plain `ChordBuffer` class encapsulating `chordPending`/`altTap`/`chordDisambigTimer` and exposing `onKeyDown`/`onKeyUp`/`getSnapshot`/`subscribe`, leaving the coordinator to wire dispatch.
  - Either way, the coordinator's `handleKeyboardEvent`/`handleKeyUp` shrink to: IME guard → register-transition filter → selection-mode pre-handler → chord-unit → matcher dispatch. Preserve the exact cascade and parity invariants (see Contracts).
- **Replace `READ_ONLY_ALLOWED_ACTIONS`** with a lookup against action-registry metadata. Add a `readOnlySafe: boolean` (or `mutating: boolean`) field to the action/shortcut definition source (in `apps/spreadsheet/src/keyboard` / `@mog-sdk/contracts/actions`) and have the coordinator block any action not flagged safe. This is a cross-folder change; stage it so the allowlist is generated/validated against the registry first (add a test asserting the two agree) before deleting the inline set.
- Keep `getChordSnapshot`/`subscribeChord`/`use-chord-mode-snapshot.ts` API stable — `KeyTipOverlay.tsx`/`KeyTipContext.tsx` consume them.

### Phase 5 — Harden focus coordination (objective 6)

- Unify `setupFocusRestoration` and `setupEditorNotifications` to share **one** subscription and **one** `previousStack` snapshot, deriving both pop-restore and dialog-open/close from the same diff. Removes the desync risk between the two independent trackers.
- In `pane-navigation-coordination.ts`, when the target pane element is missing/detached, fall back to focusing the grid element (or the previous pane) and, if the requested pane genuinely cannot be focused, send the machine back so `currentPane` matches reality — never leave machine state ahead of DOM focus.
- Where a direct element handle is available (grid container, pane elements), prefer focusing the element over CSS-selector round-tripping. Keep selector-based restore only for arbitrary chrome inputs that lack a stable handle, and surface restore misses via the existing `onMetric`/debug channel instead of a silent grid fallback.

## Tests and verification gates

- **Existing suites must stay green** (do not weaken): `testing/__tests__/{grid-input-machine,pane-focus-machine,scroll-zoom-gestures,scroll-callback,scroll-architecture-redesign,focus-stack,focus-stack-backstage,focus-grid-dom-restore,focus-integration,input-system-lifecycle,keyboard-dispatch}.test.ts`, `keyboard/__tests__/{keyboard-coordinator,keyboard-coordinator-chord}.test.ts`, `physics/__tests__/scroll-physics.test.ts`, `coordination/__tests__/auto-scroll-service.test.ts`, and `coordinator/__tests__/input-coordinator.test.ts`.
- **Phase 0 (dead-path):** if excising, delete `__tests__/input-events.test.ts`; add an architecture/lint assertion (or a `rg`-based unit) that `forwardToSheet` has no no-op producer and pointer routing has a single owner. If completing, add tests proving full-column/full-row `HEADER_CLICK` ranges and double-click→edit.
- **Phase 1 (phase machine):** add a test asserting machine context no longer carries scroll/zoom position (or that those fields are removed from the type), and that `useScrollState`/`useInputState` still report correct scroll/zoom sourced from physics. Keep `getInputSnapshot` snapshot tests.
- **Phase 2 (lifecycle/a11y):** unit test that `dispose()` after a Ctrl+wheel zoom does not throw and no timer fires (fake timers); unit test that with `matchMedia('(prefers-reduced-motion: reduce)')` true, a pan/touch flick starts **no** momentum (parametrized across all three entry points).
- **Phase 3 (config/facade):** test that `enableKeyboard: false` makes `handleKeyboardEvent` return `not_found` for a known shortcut; test/assert `focusEditor` either carries a real cellId or is removed.
- **Phase 4 (keyboard split):** the chord-parity test file is the gate — extraction must pass `keyboard-coordinator-chord.test.ts` unchanged. Add a test that the read-only determination derived from registry metadata equals the previous allowlist for every action (regression fence before deleting the set).
- **Phase 5 (focus):** test that a pane transition to an unregistered element does not leave `currentPane` ahead of DOM focus; test the unified subscription still fires both pop-restore and dialog-open/close notifications.
- **Repo gates (run by reviewer, not by this planning worker):** `pnpm --filter @mog/spreadsheet typecheck`, the app's unit suite, `pnpm --filter @mog-sdk/contracts build` if any contract type (e.g. `readOnlySafe`) is added (per the contracts declaration-rollup gotcha), plus app-eval keyboard/scroll/focus scenarios (`keyboard/`, `selection/`, `scale-format/`) to catch interaction regressions. No production builds are run by this worker.

## Risks, edge cases, and non-goals

- **Risk — chord-machine extraction regresses Excel parity.** The chord logic has many subtle branches (Path A vs Path B, completed-prefix deferral, alt-up default commit, click-outside cancel). Mitigation: extract behavior-preserving with the chord-parity suite as the gate; do *not* "improve" parity behavior in the same change.
- **Risk — selector repointing (Phase 1) breaks a hidden scroll/zoom consumer.** Mitigation: keep `inputSelectors` public shape identical; `rg` every selector consumer before changing the backing source; land Phase 1 behind the snapshot tests.
- **Risk — excising the pointer path removes infrastructure someone intends to finish.** Mitigation: this is exactly why Phase 0 is a gated product decision; the alternative branch (complete the wiring) is documented so the work isn't lost, just not silently dead.
- **Edge case — `enableKeyboard` gating must not break pane navigation or chord overlay** (which read the coordinator); gate *dispatch*, not construction.
- **Edge case — reduced-motion uniformity must still allow programmatic `animateScrollTo`/`zoomTo`** (keyboard nav, scroll-to-active); only *inertial momentum* is gated, matching the existing wheel behavior.
- **Edge case — focus restore via element handle vs selector:** chrome inputs that unmount (sheet-tab rename) genuinely need the selector/`returnFocusTarget` path and the `sheetTabs` rAF guard; do not regress those documented cases.
- **Non-goals:** redesigning the physics feel/curves; replacing the focus state machine (`@mog/shell`) itself; changing the kernel matcher/processor; touching the timeline viewport's separate `handleWheel`; altering the shortcut registry contents; adding new gestures. No compatibility shims or test-only fixes — every change lands on the production path or is a clean deletion.

## Parallelization notes and dependencies on other folders

- **Phase ordering:** Phase 0 gates the size of Phases 1–2 (it determines how much of `input-coordination.ts`/`input-types.ts` remains). Phases 2, 3, 4, 5 are mutually independent once Phase 0 lands and can proceed in parallel by different workers. Phase 1 should land before or with Phase 2 since both touch `input-coordination.ts`.
- **Cross-folder dependencies (coordinate with owners):**
  - *Selectors* (`apps/spreadsheet/src/selectors`) and the live hooks `hooks/navigation/use-scroll-state.ts`, `hooks/editing/use-input-state.ts` — Phase 1 repoints the scroll/zoom backing source.
  - *Action/shortcut registry* (`apps/spreadsheet/src/keyboard`, `@mog-sdk/contracts/actions`) — Phase 4 adds the `readOnlySafe`/`mutating` metadata field; this is the same contracts package whose `.d.ts` rollup must be rebuilt for consumers (see `[[mog-contracts-declaration-rollup]]`).
  - *Keytip UI* (`chrome/toolbar/keytips/{KeyTipOverlay,KeyTipContext}.tsx`) — consumes `getChordSnapshot`/`subscribeChord`; the coordinator comments target this as the eventual single owner, so Phase 4 should coordinate with whoever owns the "delete the parallel KeyTipContext state machine" migration.
  - *React listener layer* (`components/grid/effects/{useInputListeners,useRendererSync}.ts`, `hooks/editing/use-input-event-handlers.ts`, `hooks/shared/use-grid-mouse.ts`) — Phase 0 (excision branch) edits `useRendererSync` to drop the no-op and may trim unused handler exports; the *complete-wiring* branch would instead delete pointer logic from `use-grid-mouse.ts` (much larger blast radius).
  - *Sheet coordinator / actor-access* (`coordinator/sheet-coordinator.ts`, `coordinator/actor-access/`) — compose `InputSystem`; verify `enableKeyboard` and any removed `InputDependencies` fields against their wiring.
- **No dependency on the Rust core or compute path** — this folder is browser-side input only.
