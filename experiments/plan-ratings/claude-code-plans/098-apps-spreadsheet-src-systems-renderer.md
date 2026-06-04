# 098 — Improve `mog/apps/spreadsheet/src/systems/renderer` (renderer actor coordination, subscriptions & view sync)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/systems/renderer`
- **Files in scope (~6,850 lines across 21 source files + 7 test files):**
  - `render-system.ts` (888 lines) — `RenderSystem` class implementing `IRenderSystem`. Owns the two XState actors, builds the actor-access layer, exposes the capability accessors, and is the public facade the coordinator calls.
  - `types.ts` (588 lines) — `IRenderSystem`, `RenderActorAccess`, `RenderSystemConfig`, `RendererUIStore`, `RendererSnapshot`, and the **placeholder** `RenderContextConfig`.
  - `renderer-actions.ts` (76 lines) — free functions `mountRendererAction`/`layoutReadyAction`/… over an `ActorManager`.
  - `machines/grid-renderer-machine.ts` (560 lines) — pure lifecycle machine (`unmounted → waitingForLayout → initializing → ready → switchingSheet/suspended/error/disposing`) + emitted `scrollToActiveCellRequested`.
  - `machines/page-break-machine.ts` (258 lines) — pure `idle/dragging` drag machine.
  - `execution/renderer-execution.ts` (616 lines) — subscribes the lifecycle machine to `@mog-sdk/sheet-view` lifecycle calls (attach/start/suspend/resume/switchSheet/dispose), scroll persistence, freeze/split application.
  - `execution/render-context-coordination.ts` (970 lines) — subscribes selection/editor/clipboard/object-interaction/page-break actors and builds `Partial<RenderContextConfig>` updates; "interaction lane" (immediate) + "follower lane" (deferred reads of page breaks/print/search).
  - `subscriptions/event-subscriptions.ts` (857 lines) — Workbook EventBus → renderer invalidation/context (freeze, view options, split, hidden, structural, settings, theme, merge, sort, filter, table, comment) + lazily-attached sparkline/CF/table-auto-expansion sub-configs.
  - `subscriptions/slicer-integration.ts` (259 lines) — slicer cache-invalidation subscriptions + cache rebuild helpers.
  - `coordination/` — `layout-coordination.ts` (398), `viewport-follow-coordination.ts` (118), `sparkline-coordination.ts` (92), `cf-coordination.ts` (95), `sparkline-selection-coordination.ts` (160), `index.ts` (33).
  - `features/page-break/page-break-coordination.ts` (447) — `PageBreakCoordinator` (hit test, drag, store writes).
  - `actor-access/renderer-commands.ts` (79) + `index.ts`, `debug/debug-lifecycle.ts` (327), `testing/renderer-simulator.ts`.
- **Out of scope (named only for coupling, not edit targets):**
  - `mog/apps/spreadsheet/src/coordinator/sheet-coordinator.ts:36,164,134` — constructs `new RenderSystem(...)`, calls `.start()`, wires `setSelectionActorForViewportFollow`.
  - `components/grid/effects/useRenderContextConfig.ts` — calls `setContextConfig`/`updateContext` (identifiers minified in this app file).
  - `hooks/view/use-renderer-actions.ts`, `hooks/shared/use-grid-mouse.ts` — consume renderer commands / page-break hit testing.
  - `@mog-sdk/sheet-view` (the rendering substrate) and `@mog-sdk/contracts/{rendering,actors,viewport,api}`.

> **Source-visibility caveat.** Several *consumer* files in this app (`components/grid/effects/*`, `hooks/shared/use-grid-mouse.ts`) are shipped with minified identifiers (`coordinator.renderer.ln(...)`, `.n(...)`). The renderer folder itself is clean source, so all in-folder findings below are exact; claims about *who calls* a renderer method across that minified boundary are flagged "verify."

## Current role of this folder in Mog

This folder is the **app-side renderer subsystem**: the single owner of the canvas renderer's *lifecycle state* and the coordination glue that keeps `@mog-sdk/sheet-view` (the rendering substrate that owns the canvas engine, grid layers, VPI/VMI, viewport regions, scroll math) in sync with the app's editing actors and the Workbook event bus.

Its declared architecture (`render-system.ts:18–24`):

- **Pure state machines, side effects outside.** `rendererMachine` and `pageBreakMachine` hold only context; they perform no DOM/coordinate access. `RenderSystem` subscribes to transitions and `renderer-execution.ts` performs the SheetView side effects.
- **Constructor-complete, single-owner.** `RenderSystem` creates, starts, and stops both actors; nothing else holds actor refs except through the opaque `access` layer.
- **Three coordination lanes feed the renderer:** (1) `render-context-coordination` projects selection/editor/clipboard/object/page-break state into render context; (2) `event-subscriptions` maps Workbook mutation events to invalidation/context; (3) `viewport-follow-coordination` scrolls the active cell into view after *user-initiated* selection changes via the machine's emitted event.

It is the "actor coordination, subscriptions, and view sync" hub: the place where pure machine state, Workbook events, and the SheetView capability surface are reconciled.

## Evidence (observed in the current tree)

The lifecycle machine and the three live coordination lanes are well-factored and genuinely production-wired. The problems are concentrated in **(a) a band of unwired/dead coordination modules, (b) two correctness gaps in lifecycle recovery and page-break injection, and (c) production hygiene (always-on debug logging, placeholder types, an unfinished deprecation).**

1. **`layout-coordination.ts` (398 lines) is dead — and may mask a real missing-recompute gap.** A repo-wide search for `setupLayoutCoordination` finds **only its definition and the `coordination/index.ts` re-export** — no instantiation anywhere in `mog/`. It is the module designed to call `recomputeLayout()` + `syncOutlineGutter()` on `group:created/deleted/collapsed`, `outline:level-changed`, `row:height-changed`, `column:width-changed`, `filter:applied/cleared`, and `activeSheetId` changes (`layout-coordination.ts:219–370`). Correspondingly, `IRenderSystem.syncOutlineGutter()` (`render-system.ts:695`) has **zero callers** repo-wide. So either SheetView's internal `ResizeObserver` + `event-subscriptions` fully cover these cases, or outline-gutter width / layout recompute on dimension+outline changes is silently missing in production. This must be resolved, not left ambiguous.

2. **`sparkline-coordination.ts` and `cf-coordination.ts` are dead.** `buildSparklineCoordination` and `buildCFCoordination` have **no callers** repo-wide (only definition + barrel re-export). Their job — calling `eventSubscriptions.setSparklineConfig()` / `setCFConfig()` — is instead performed directly: sparkline wiring goes through `RenderSystem.setSparklineManager` → `eventSubscriptions.setSparklineConfig` (`render-system.ts:624–634`), and CF wiring is done by a consumer. These two thin wrappers are superseded duplication.

3. **`renderer-actions.ts` (76 lines) is entirely dead.** None of `mountRendererAction`, `layoutReadyAction`, `rendererInitializedAction`, `switchSheetAction`, `sheetSwitchedAction`, `suspendRendererAction`, `resumeRendererAction`, `unmountRendererAction`, `queueRendererActionAction` is referenced anywhere in `mog/`. They duplicate the typed `createRendererCommands` factory (`actor-access/renderer-commands.ts`) and the `RenderSystem` lifecycle methods.

4. **Error recovery is a broken invariant: `error → RETRY → initializing` cannot re-initialize.** The machine's `initializing` state re-runs the SheetView creation side effect, but `renderer-execution.ts:239` guards with `if (!rendererContainer || !rendererDependencies || sheetView) break;`. On entering `error`, **`sheetView` is never disposed** — `executeStateTransition` has no `case 'error'` (`renderer-execution.ts:215–437`), and a creation failure may leave a partially-constructed `sheetView` set. The machine's `RETRY` guard (`canRetry`) sends it back to `initializing`, but the truthy `sheetView` makes the side effect `break` immediately, so `INITIALIZED` is never re-sent and the renderer is stuck in `initializing`. The user-facing `retry()` command (`renderer-commands.ts:67`, surfaced via `use-renderer-actions.ts:246`) therefore cannot recover a failed renderer.

5. **`PageBreakCoordinator.setDependencies()` is never called — page-break hit testing/drag is inert.** `RenderSystem` constructs `new PageBreakCoordinator()` (`render-system.ts:268`) but never injects dependencies; a repo-wide search for a `setDependencies` call passing `pageBreakActor`/`getRowFromPosition` finds **none** (only the docstring). With `this.deps === null`, `hitTest()` returns `{ hit: false }` (`page-break-coordination.ts:232`), and `startDrag`/`updateDrag`/`endDrag`/`isDragging`/`getDragState` all early-return. `RenderSystem.hitTestPageBreak` (`render-system.ts:582`) consequently always resolves `null`, so Page-Break-Preview drag is non-functional through this seam. (Consumer call sites in `use-grid-mouse.ts` are minified — *verify* there is no alternate injection path before treating this as a hard product bug; the dependency set, `getRowFromPosition`/`getColFromPosition`/`getActiveSheetId`, is geometry-derived and would naturally be wired here.)

6. **Debug logging is hardcoded ON in production, with an unbounded buffer and a global handle.** `debug/debug-lifecycle.ts:24` sets `export const ENABLE_LIFECYCLE_DEBUG = true` and `:30` `DEBUG_LOG_LEVEL = 2`. `RenderSystem` calls `lifecycleDebug.stateEvent(...)` on **every** mount/unmount/layout/switch/suspend/resume (`render-system.ts:291,303,…`), and `render-context-coordination` logs on every context update (`:519`). Each log `push`es to a module-level `eventTimings` array that is **never trimmed** (`debug-lifecycle.ts:60,82`) — an unbounded memory growth over a session — and `window.__lifecycleDebug` is always assigned (`:325`). This is console spam, a steady allocation leak, and global-namespace pollution shipped to users.

7. **`RenderContextConfig` in `types.ts` is a placeholder `{ [key: string]: unknown }`.** `types.ts:122–126` carries a `TODO: Extract from contracts/src/rendering/render-context.ts`, so `IRenderSystem.updateContext(config: Partial<RenderContextConfig>)` (`:347`) and `RenderSystem.updateContext` (`render-system.ts:481`) are effectively untyped — every field cast through `as Partial<RenderContextConfig>` (`render-system.ts:483`). The real contract type already exists and is imported elsewhere in the same folder (`@mog-sdk/contracts/rendering` `RenderContextConfig` in `render-system.ts:41`).

8. **The `getRenderer()` deprecation is stalled.** `getRenderer()` is marked `@deprecated` in three places (`render-system.ts:491`, `types.ts:369`, `renderer-execution.ts:83`) "until callers in sheet-coordinator, use-grid-mouse, use-renderer-actions, and event-subscriptions are migrated." It is still backed by an out-of-band escape hatch: `renderer-execution.ts:45,266` reads the full `GridRenderer` off SheetView via the magic key `INTERNAL_GRID_RENDERER_KEY = '__mogInternalGridRenderer'`. `sheet-coordinator.ts` and `use-renderer-actions.ts` still call `getRenderer()` (confirmed) — the migration to capability accessors is incomplete and the private back-channel persists.

9. **Module-boundary smell: `slicer-integration.ts` lives under `renderer/subscriptions` but is consumed by grid-editing.** `setupSlicerEventSubscriptions`/`rebuildAllSlicerCaches`/`getSlicerCache` are referenced from `systems/grid-editing/grid-editing-system.ts` (+ `grid-editing/types.ts`), not from the renderer system. It emits `slicer:cacheInvalidated` events and touches no renderer/SheetView surface — it is data/feature plumbing misfiled in the renderer folder.

10. **The follower lane uses a magic `setTimeout(120)` on a per-keystroke path.** `render-context-coordination.ts:687–722` defers page-break/auto-page-break/print-area/search-highlight reads by a hardcoded `120` ms after each `sendContextUpdate`. The generation guard (`contextUpdateGeneration`) correctly drops stale results, and timers are tracked and cleared on dispose (`:502,963`), but the magic number is undocumented and a `setTimeout` on the formula/selection hot path is fragile vs. a coalesced microtask/RAF.

11. **`updateContext` cannot dynamically clear culture / there is a culture-DTO split.** `renderer-execution.ts:340` pushes culture via the internal `sheetView.locale.setCulture`, while `event-subscriptions.ts:448–453` pushes culture via `updateRendererContext({ culture })` on `workbook:settings-changed`. Two paths, two shapes, for one concern — minor, but a coherence risk noted for the contracts pass in objective 5.

## Improvement objectives

1. **Resolve the dead coordination band** (`layout-coordination`, `sparkline-coordination`, `cf-coordination`, `renderer-actions`) — for each, either *wire it on the production path* (if it covers a real gap) or *delete it* (if superseded), leaving no unreferenced coordination surface.
2. **Make renderer error-recovery actually recover** — `RETRY` from `error` must re-initialize SheetView reliably.
3. **Restore page-break drag** — inject `PageBreakCoordinator` dependencies from `RenderSystem`, or remove the inert seam if the feature is intentionally deprecated.
4. **Production hygiene for debug logging** — gate it behind a build/env flag (default off), bound the timing buffer, drop the unconditional global.
5. **Type the renderer context contract** — replace the placeholder `RenderContextConfig` with the real contract type and drop the corresponding casts.
6. **Finish the `getRenderer()` → capability-accessor migration** and remove the `INTERNAL_GRID_RENDERER_KEY` back-channel.
7. **Relocate `slicer-integration`** to its consuming subsystem (grid-editing) to honor the folder's DAG/role.
8. **Harden the follower lane** — replace the magic `setTimeout(120)` with a documented, coalesced scheduler.

Objectives 1–4 are correctness/footprint and should land first; 5–8 are coherence/maintainability and can follow.

## Production-path contracts and invariants to preserve or strengthen

- **Machine purity.** `rendererMachine`/`pageBreakMachine` must remain side-effect-free (no DOM, no coordinate system, no SheetView). Error-recovery work (objective 2) must keep disposal in the execution layer, not in machine actions. The existing emitted-event pattern (`scrollToActiveCellRequested`, `grid-renderer-machine.ts:283`) is the sanctioned way to keep coordinate access out of the machine — reuse it, don't bypass it.
- **Single-owner lifecycle.** `RenderSystem` remains the sole creator/starter/stopper of both actors and the sole holder of the SheetView handle; external access stays through the opaque `access` layer (`types.ts:84`) and capability accessors.
- **"Update only when ready."** `sendContextUpdate` must keep its `rendererState.value !== 'ready'` guard (`render-context-coordination.ts:522`) and the initial-immediate-send for the late-subscription race (`:951–959`). Any scheduler change in objective 8 must preserve the generation guard so stale follower reads never overwrite fresh context.
- **Transition-detection subscriptions.** The per-actor `previous*State` diffing that prevents render storms (`render-context-coordination.ts:727–933`) must be preserved; new wiring must not subscribe naively to every emission.
- **Cleanup completeness.** `dispose()` must continue to tear down every subscription/timer it creates (`render-system.ts:790–845`); any module that is *newly wired* (objective 1) must register cleanup, and any module *deleted* must not orphan a cleanup expectation.
- **Viewport-follow user-intent classification.** The `userSelectionChanged` emit gate (only user-initiated selections scroll into view, `viewport-follow-coordination.ts:28–35,100`) must remain — do not regress to `actor.subscribe`.
- **Scroll/physics sync invariant.** Every scroll mutation that bypasses the persistence path must still call `onScrollPositionReset` to resync the InputCoordinator physics engine (the pattern at `render-system.ts:884`, `renderer-execution.ts:322,408,520`). Preserve this when touching the scroll seams.

## Concrete implementation plan

### Phase A — Dead-code resolution (objective 1)

1. **`layout-coordination.ts`: decide wire-vs-delete with evidence.** Determine whether the layout effects it owns are already produced elsewhere:
   - `recomputeLayout` is `sheetView.viewport.invalidateLayout()` (`renderer-execution.ts:590`); SheetView's internal `ResizeObserver` and the `switchingSheet` recompute (`renderer-execution.ts:378–426`) cover resize + sheet switch.
   - The *uncovered* candidates are outline-gutter sync (`syncOutlineGutter`, zero callers) and explicit recompute on `group:*`/`outline:level-changed`/`row:height-changed`/`column:width-changed`. Cross-check `event-subscriptions.ts:392–398` (which explicitly says row/col dimension events *no longer* invalidate here — handled by `patchRowDimension/patchColDimension`) and confirm whether gutter width is recomputed when outline groups change.
   - **If a gap exists:** wire `setupLayoutCoordination` from `RenderSystem.start()` (passing `recomputeLayout`/`updateHeaderVisibility`/`syncOutlineGutter`/`getLayoutInputs` adapters over the execution layer), register its `dispose` in `RenderSystem.dispose()`, and keep `syncOutlineGutter`.
   - **If no gap (SheetView already recomputes on these):** delete `layout-coordination.ts`, its `coordination/index.ts` re-exports, the `syncOutlineGutter` method from `IRenderSystem`/`RenderSystem`, and its test. Record the determination in the PR description.
2. **Delete `sparkline-coordination.ts` and `cf-coordination.ts`** plus their `coordination/index.ts` re-exports — the live path (`setSparklineManager` → `setSparklineConfig`; consumer-driven `setCFConfig`) supersedes them. Verify no minified consumer references first (grep `buildSparklineCoordination`/`buildCFCoordination` already returns nothing; re-grep including `dist`/build outputs to be safe).
3. **Delete `renderer-actions.ts`** — fully superseded by `createRendererCommands` and `RenderSystem` methods. Remove any barrel export.

### Phase B — Lifecycle error recovery (objective 2)

4. **Dispose SheetView on entering `error`.** Add a `case 'error':` to `executeStateTransition` (`renderer-execution.ts`) that disposes a partially/ fully constructed `sheetView` and nulls `underlyingRenderer`, mirroring `case 'unmounted'`/`'disposing'`. This makes the `initializing` guard's `sheetView` precondition false on retry, so re-initialization runs.
5. **Make the `initializing` guard explicit about retry.** Confirm `rendererContainer` and `rendererDependencies` survive an error (they do — only `clearResources` on `disposing` nulls them, `grid-renderer-machine.ts:270,495`). After step 4, `RETRY → initializing` will re-create SheetView and re-send `INITIALIZED`. Add a regression test (Phase F).
6. **Surface bounded-retry exhaustion.** When `canRetry` is false (`retryCount >= maxRetries`, `grid-renderer-machine.ts:294`) the machine stays in `error`. Ensure `RendererSnapshot`/selectors expose `canRetry`/`error` (already in `RendererAccessor`, `render-system.ts:117–118`) so the UI can present a terminal-failure affordance rather than a silent stuck state.

### Phase C — Page-break dependency injection (objective 3)

7. **Verify the consumer seam.** Confirm via the (minified) `use-grid-mouse.ts` path that page-break preview drag is expected to flow through `RenderSystem.hitTestPageBreak/startPageBreakDrag/...`. If yes:
8. **Inject `PageBreakCoordinator` deps from `RenderSystem`.** After the renderer is ready (in the `onReady`/ready-transition path, `render-system.ts:763`), call `this.pageBreakCoordinator.setDependencies({...})` with: `pageBreakActor: this.pageBreakActor`, `workbook: this.config.workbook`, `getActiveSheetId` (from render capability), and `getRowPosition/getColPosition/getRowFromPosition/getColFromPosition` derived from `getGeometry()`/`getViewport()`. Tear down in `dispose()` (already calls `pageBreakCoordinator.dispose()`, `render-system.ts:814`). Guard re-injection on sheet switch if geometry closures must rebind.
9. **If the feature is intentionally retired,** remove the inert `PageBreakCoordinator` construction, the `hitTestPageBreak`/`startPageBreakDrag`/`updatePageBreakDrag`/`isPageBreakDragging`/`getPageBreakDragState` facade methods, and the page-break drag-state lane in `render-context-coordination.ts:907–933` — but only after confirming no live consumer.

### Phase D — Debug-logging hygiene (objective 4)

10. **Gate logging behind a flag, default off.** Replace `ENABLE_LIFECYCLE_DEBUG = true` with a value read from the app's existing env/flag mechanism (e.g. `import.meta.env.DEV` or a debug-flag util), defaulting to disabled in production builds. Keep the rich API so it remains usable when enabled.
11. **Bound `eventTimings`.** Cap the array (ring buffer, e.g. last 500 entries) so an always-on (dev) session can't grow it without limit (`debug-lifecycle.ts:60,82`).
12. **Drop the unconditional global.** Only assign `window.__lifecycleDebug` when the flag is on (`debug-lifecycle.ts:325`).

### Phase E — Coherence (objectives 5–8)

13. **Replace placeholder `RenderContextConfig`.** In `types.ts:122`, alias/extend the real `@mog-sdk/contracts/rendering` `RenderContextConfig` (or the dynamically-updatable subset) and update `IRenderSystem.updateContext`/`RenderSystem.updateContext` to use it; remove the `as Partial<RenderContextConfig>` cast at `render-system.ts:483`. Run the contracts declaration rollup if the consuming types span packages (see project note on `@mog-sdk/contracts` builds).
14. **Finish `getRenderer()` migration.** Enumerate remaining callers (`sheet-coordinator.ts`, `use-renderer-actions.ts`, plus any minified hook); move each to the relevant capability accessor (`getGeometry`/`getHitTest`/`getRenderCapability`/`getViewport`/…). Once zero callers remain, delete `getRenderer()` from `IRenderSystem`/`RenderSystem`/`RendererExecutionResult` and remove `INTERNAL_GRID_RENDERER_KEY` + `underlyingRenderer` (`renderer-execution.ts:45,164,266,469`). This is the largest cross-folder item — stage it after A–D and behind its own PR.
15. **Relocate `slicer-integration.ts`** to `systems/grid-editing/` (or a dedicated data-feature folder) next to its consumer, updating the import in `grid-editing-system.ts`. No behavior change — pure move + import fix.
16. **Replace the follower `setTimeout(120)`** with a single coalesced scheduler (microtask or RAF) and a named constant with a comment explaining why follower reads are deferred (to keep editor-overlay updates off the async page/print/search reads). Preserve the generation guard and dispose-time cancellation.

## Tests and verification gates

- **Existing tests (must stay green):** `testing/__tests__/renderer-lifecycle.test.ts`, `viewport-management.test.ts`, `sheet-switch-viewport.test.ts`, `invalidation.test.ts`, `page-break-drag.test.ts`, `execution/__tests__/render-context-coordination.test.ts`, `subscriptions/__tests__/event-subscriptions-sparklines.test.ts`, `coordination/__tests__/sparkline-selection-coordination.test.ts`. The `renderer-simulator.ts` harness drives the real `RenderSystem` and is the primary vehicle for lifecycle assertions.
- **New: error-recovery regression (Phase B).** Drive `unmounted → … → initializing`, inject a creation failure → `error`, send `RETRY`, assert the machine reaches `ready` (i.e. `INITIALIZED` re-fires) and SheetView was disposed-then-recreated. Also assert that after `maxRetries` the snapshot reports `isError`/`!canRetry`.
- **New: page-break injection (Phase C).** With the simulator at `ready`, assert `hitTestPageBreak` returns a hit for a known break and `getPageBreakDragState` reflects an in-progress drag — proving deps are injected (today these would assert `null`/`false`).
- **New: dead-code/wiring guard (Phase A).** If `layout-coordination` is wired, add a test that an outline group change triggers `recomputeLayout`/`syncOutlineGutter`. If deleted, add an architecture assertion that no exported symbol in `coordination/index.ts` is unreferenced (or rely on the lint pass below).
- **New: debug-flag (Phase D).** Unit-test that with the flag off, `lifecycleDebug.stateEvent` does not `console.log` and `eventTimings` stays empty; with it on, the buffer is capped at its limit.
- **Verification gates (do not run here per task constraints; list for the implementer):**
  - `pnpm --filter @mog/spreadsheet typecheck` (placeholder-type removal + `getRenderer` deletion are type-surface changes).
  - `pnpm --filter @mog-sdk/contracts build` before app typecheck if the `RenderContextConfig` change crosses the contracts package (project note: contracts declaration rollup).
  - Targeted vitest/jest run of the eight in-folder test files.
  - Lint/`knip`-style unused-export check to confirm the dead-code band is gone.
  - App-eval smoke for: renderer first-paint, sheet switch (scroll restore), freeze/split, Page-Break-Preview drag, and a forced renderer-init failure recovering via retry.

## Risks, edge cases, and non-goals

- **Risk — deleting layout-coordination hides a real bug.** Mitigation: Phase A step 1 forces an explicit evidence-based determination (gap → wire; no gap → delete) rather than defaulting to deletion. Outline-gutter width is the highest-risk uncovered case.
- **Risk — error-disposal double-free.** `dispose()` and `case 'unmounted'`/`'disposing'` already dispose SheetView; the new `case 'error'` must null `sheetView` after disposing so subsequent transitions don't double-dispose. Mirror the existing null-guard pattern exactly.
- **Risk — page-break injection on sheet switch.** Geometry closures (`getRowPosition`, etc.) must resolve *current* geometry; bind them to live accessors (`() => this.getGeometry()`), not a captured instance, so they survive sheet switches.
- **Risk — `getRenderer()` removal breaks a minified consumer.** Mitigation: stage objective 6 last, gate behind its own PR, and confirm zero callers (including build output) before deleting the back-channel.
- **Edge case — late dependency arrival.** `setContextConfig`/`setRendererDependencies`/`setSparklineManager` can arrive before or after `start()`/`ready`; the existing deferred-setup guards (`render-system.ts:476,855`) must be preserved when adding page-break injection so it fires regardless of arrival order.
- **Edge case — React Strict Mode double-mount.** `renderer-execution.ts:218–227` notes Strict Mode skips `disposing` and disposes at `unmounted`; the new `error` case must not regress this path.
- **Non-goals:** rewriting the lifecycle machine's state topology; changing SheetView internals (`@mog-sdk/sheet-view` is a separate folder); altering the render-context *field set* or the EventBus event taxonomy; performance tuning of the canvas engine; touching the contracts type definitions beyond importing the existing `RenderContextConfig`.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** Phase A (dead-code), Phase B (error recovery), Phase D (debug logging) are confined to this folder and touch disjoint files — they can proceed concurrently.
- **Phase C (page-break)** is folder-local in implementation but depends on confirming the (minified) `use-grid-mouse.ts`/`useRenderContextConfig.ts` consumer contract first — a read-only investigation, not a code dependency.
- **Phase E objective 5 (`RenderContextConfig`)** depends on `@mog-sdk/contracts/rendering` and may require the contracts declaration rollup before the app typechecks (cross-package).
- **Phase E objective 6 (`getRenderer()` removal)** is the only item with hard cross-folder edits: `coordinator/sheet-coordinator.ts`, `hooks/view/use-renderer-actions.ts`, and possibly `hooks/shared/use-grid-mouse.ts`. Sequence it last and coordinate with whoever owns the coordinator/hooks folders.
- **Phase E objective 7 (slicer relocation)** edits `systems/grid-editing/` — coordinate with the grid-editing folder owner; it is a pure move with an import update.
- No dependency on the pre-existing dirty `dev/` eval scenarios or `dev/fixtures/`; this plan does not touch them.
