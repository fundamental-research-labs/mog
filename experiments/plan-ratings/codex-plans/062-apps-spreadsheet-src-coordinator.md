# 062 - Spreadsheet Coordinator Production-Path Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/coordinator`

Scope for this plan:

- `sheet-coordinator.ts`, the app-level composition root for grid editing, rendering, objects, input, and ink systems.
- Coordinator-local lifecycle and event projection modules: `receipt-processing.ts`, `connector-rerouting.ts`, `editor-transition-handlers.ts`, `actor-access/`, and `features/`.
- Feature mutation helpers under `mutations/`, table calculated-column helpers, and `sparklines/sparkline-manager.ts`.
- `shell-coordinator.ts` and `view-clipboard-data.ts` insofar as they currently live in this folder and share exported coordinator surface area.

Out of scope for this folder-specific plan:

- Rewriting workbook storage, recalculation, undo history, or durable data ownership. Rust compute and the Workbook/Worksheet APIs remain the source of truth.
- Replacing the five app systems (`GridEditingSystem`, `RenderSystem`, `ObjectSystem`, `InputSystem`, `InkSystem`) with a new coordinator model.
- Fixing unrelated feature bugs outside the coordinator production path.

## Current role of this folder in Mog

`SheetCoordinator` is documented as a composition root, but it now contains a large amount of production behavior in addition to system construction. It creates and starts the five spreadsheet systems, wires selection/object exclusivity, editor focus transitions, active-cell metadata refresh, cross-sheet formula return, pending-cell-format replay, Flash Fill, scroll-commit, render invalidation, named-range recalculation, merge-anchor snapping, find/replace navigation, sheet-switch state restore, toolbar format sync, floating-object cache projection, and object receipt processing.

The folder also exposes the coordinator's public app API through `index.ts` and `types.ts`; composes actor access across systems; keeps feature-level mutation helpers for diagram, equation, and calculated-column actions; bridges sparkline writes to the Worksheet API while maintaining sync render caches; and contains shell-level view/clipboard coordination that is adjacent to, but not the same as, sheet coordination.

Docs in `docs/internals/spreadsheet/state.md` define the key architectural boundary: persistent workbook data is Rust-owned, while coordinator state is session-local orchestration, cache projection, and invalidation. The current folder mostly follows that model, but several contracts are implicit, duplicated, or only partially tested.

## Improvement objectives

1. Keep `SheetCoordinator` as a true composition root with narrow, auditable responsibilities: construct systems, start systems in dependency order, install named coordination modules, expose stable app capabilities, and dispose everything deterministically.
2. Make floating-object projection a single production-path service that handles both EventBus push events and `ActionResult.receipts` pull results through one batch/patch contract.
3. Make coordinator lifecycle deterministic under async work: no cache writes, renderer patches, object commands, animation-frame callbacks, or devtools reports after disposal.
4. Replace ambient host dependencies in this folder with explicit coordinator host capabilities: clock, microtask scheduler, animation-frame scheduler, confirmation, and devtools receipt reporting.
5. Tighten actor-access and coordinator exports so consumers use system-owned access capabilities instead of legacy actor bundles or broad `Record<string, unknown>` merging.
6. Make feature mutation helpers consistently production-path: all writes go through Workbook/Worksheet handles, all user-visible events use injected clock/source metadata, and all returned receipts flow through the dispatcher/coordinator receipt contract.
7. Preserve sparkline renderer ergonomics while making cache hydration, write ordering, and invalidation behavior explicit and tested.
8. Separate sheet coordination from shell/view coordination: either move shell coordination into the shell/view lifecycle layer or give it a typed, narrow export contract that does not blur sheet-state ownership.

## Production-path contracts and invariants to preserve or strengthen

- Rust compute and the Workbook/Worksheet API remain the durable workbook state owner. Coordinator caches are projections and must be rebuildable from workbook APIs.
- EventBus notifications are downstream semantic notifications; coordinator listeners must not become the mechanism that persists workbook writes.
- `dispatch(action, deps, payload)` must process non-empty `ActionResult.receipts` through `deps.coordinator.processReceipts(...)` for both sync and async handlers. Tests should exercise the real dispatcher path, not a copied snippet of dispatcher logic.
- EventBus floating-object events and receipt processing must produce equivalent `FloatingObjectCache.applyBatch(...)` updates and equivalent `renderer.getObjects()?.applyPatches(...)` patches for create, update, bounds-only update, and remove.
- Sheet switching must preserve per-sheet selection and scroll state, restore layout callbacks, keep cross-sheet formula editing active while selecting references, and return to the origin sheet only for formula-edit completion/cancel paths that require it.
- Grid selection and object selection remain mutually exclusive; entering one selection context must notify the other system without causing loops.
- Editor-start and editor-end focus transitions must route through `InputSystem` and must not steal focus from modal/dialog or formula-range-selection paths.
- Pending cell format replay applies only after commit, never after cancel, and always clears the pending format when editing ends.
- Toolbar active-cell format and toolbar ranges are derived from the active sheet and selection actor; they must not mirror stale sheet data after deletion, import, or sheet switch.
- Floating-object initial load, sheet-switch load, and event coalescing must be generation-guarded and disposal-safe.
- Connector re-routing must be triggered only by position/size changes of connectable objects, use current cache bounds, and write connector geometry through the Worksheet connector API.
- Sparkline sync reads must never invent durable state. Cache misses may schedule hydration, but render data is computed only from Worksheet-backed sparkline metadata and cell values.
- Read-only mode remains enforced through dispatcher/editor/input gates; coordinator extraction must not add new mutating bypasses.
- Public `mog` code must not depend on `mog-internal`, and coordinator modules must not import kernel internal barrels or view internals outside intentional app-internal capability boundaries.

## Concrete implementation plan

1. Add explicit coordinator contract tests before refactoring.

   - Add focused tests for `SheetCoordinator` construction/start/dispose order using production system interfaces and lightweight fakes for workbook, UI store, renderer objects, and actors.
   - Add tests for cleanup registration: every installed wiring returns a cleanup, disposal calls each cleanup exactly once, and disposal prevents pending microtask/animation-frame work from mutating caches or renderer objects.
   - Replace the current dispatcher receipt-propagation snippet test with tests that call real `dispatch(...)` for one sync receipt handler and one async receipt handler and assert `coordinator.processReceipts(...)` is called exactly once.
   - Extend receipt tests to cover update-vs-create detection, delete-after-pending-update, bounds-only updates, empty/no-op receipts, renderer absence, and repeated receipt batches.

2. Extract floating-object projection from `SheetCoordinator`.

   - Create a coordinator-local `floating-object-projection` module with a `FloatingObjectProjectionService`.
   - Inputs: `workbook`, `floatingObjects`, `cache`, `rendererObjects`, `objectCommands`, `chartCommands`, `getActiveSheetId`, `initialSheetId`, `uiStore` sheet-switch subscription, `scheduler`, and `onMetric`.
   - Responsibilities: subscribe to `floatingObject:created`, `floatingObject:updated`, `floatingObject:deleted`; coalesce fetches; hydrate initial sheet; hydrate active sheet on sheet switch; apply renderer patches; notify object/chart systems on remote deletion; guard all async work by generation.
   - `SheetCoordinator` should only create the service, call `start()`, register `dispose()`, and expose `floatingObjectCache`.

3. Unify EventBus projection and receipt projection.

   - Replace the duplicated cache/patch logic in `wireFloatingObjectManager()` and `processCoordinatorReceipts()` with a shared pure reducer that accepts normalized projection events.
   - Normalize inputs from both sources into create/update/remove/bounds-only records with object id, optional object data, optional bounds, and optional changed fields.
   - Keep fetch orchestration in the projection service, but keep cache/patch derivation pure and unit-tested.
   - Make duplicate push/pull delivery idempotent where possible: if a receipt is processed synchronously and the EventBus later emits the same object state, unchanged cache objects should retain references and renderer patches should not regress object bounds.

4. Replace ambient host calls with `CoordinatorHost`.

   - Add a required host capability object at the coordinator boundary with `clock.now()`, `scheduler.queueMicrotask()`, `scheduler.requestAnimationFrame()`, `devtools.reportReceipt()`, and `confirm(message)`.
   - Thread the host through `createSheetCoordinator(...)`, `CoordinatorProvider`, mutation helpers, `SparklineManager`, and projection services.
   - Remove direct `Date.now()`, `window.confirm`, `(window as any).__OS_DEVTOOLS__`, global `queueMicrotask`, and global `requestAnimationFrame` usage from this folder.
   - Update `tools/platform-dependency-allowlist.jsonc` after the implementation to remove coordinator entries that become obsolete.

5. Extract named cross-system wiring modules.

   - Move each wiring group out of `sheet-coordinator.ts` behind explicit setup functions:
     - selection/object exclusivity
     - editor focus transitions
     - active-cell metadata refresh
     - formula origin-sheet return
     - pending cell format replay
     - Flash Fill commit/dismiss
     - scroll commit
     - render invalidation
     - named ranges and merge-anchor integration
     - find/replace renderer integration
     - sheet-switch view-state coordination
     - toolbar format/range sync
   - Introduce a small `CoordinatorWiringRegistry` that installs named cleanups and records metrics/debug labels for failed cleanup, duplicate installation, or late events after disposal.
   - Keep system/domain logic in the owning systems; extracted modules should only bridge already-public system capabilities.

6. Tighten actor access.

   - Migrate current callers of `createActorAccessLayerFromBundle(...)` to `createActorAccessLayer(coordinator)` or directly to system access objects.
   - Delete the actor-bundle overload after all callers are migrated.
   - Replace broad `Record<string, unknown>` merge types with a typed aggregate interface that preserves each system's accessors, commands, selectors, and actors.
   - Ensure action dependencies and keyboard coordinator dependencies consume the typed aggregate rather than recreating actor bundles.

7. Normalize feature mutation modules.

   - Replace positional `workbook, sheetId, ...` signatures for diagram/equation/table helpers with typed mutation contexts containing workbook, active sheet resolver, clock, and event emitter.
   - Audit every helper for fire-and-forget writes. Operations that are part of user actions should return a promise and an `ActionResult`/receipt path so callers can surface errors and dispatcher receipt processing stays complete.
   - Keep all durable writes on the Worksheet API (`ws.objects`, `ws.diagrams`, `ws.equations`, `ws.tables`, `ws.sparklines`), not EventBus side effects.
   - Add tests that event timestamps come from the injected clock and that undo descriptions are set before the write for every mutation function.

8. Harden `SparklineManager`.

   - Inject clock and scheduler through `SparklineManagerConfig`.
   - Make hydration idempotence observable: concurrent `hydrateSheet()` calls for the same sheet should share the same in-flight work or return a deterministic result, not silently return `0` when work is pending.
   - Add tests for update/delete/group operations, cache rollback or error behavior when the Worksheet API rejects, render data invalidation for source range edits, group same-axis min/max, empty values, booleans, strings, and win/loss axis behavior.
   - Verify that cache misses schedule bounded hydration and that `dispose()` prevents late hydration from emitting events.

9. Resolve sheet-vs-shell coordinator ownership.

   - Decide whether `ShellCoordinator` belongs in `shell/` or as a typed app shell module under `apps/spreadsheet/src/app`.
   - If moved, update exports and `use-shell-coordinator` to point at the new owner and delete `view-clipboard-data.ts` after converting clipboard-machine interop to canonical `ClipboardPayload`.
   - If retained in this folder, give it a typed React provider/hook, remove `any`, and make clipboard conversion behavior covered by tests.

10. Update documentation and dependency inventory.

   - Update `docs/internals/spreadsheet/state.md` to describe the extracted projection service, receipt reducer, host capabilities, and typed actor-access aggregate.
   - Update coordinator comments that currently describe future receipt wiring; the dispatcher already processes receipts for sync and async action results.
   - Update platform dependency inventory once host globals are removed.

## Tests and verification gates

Do not rely on mocked shortcuts alone. The implementation should be verified through both package tests and real UI paths.

Required package gates:

- `pnpm --filter @mog/app-spreadsheet test -- src/coordinator`
- `pnpm --filter @mog/app-spreadsheet test -- src/actions/dispatcher.ts src/actions/handlers/__tests__/receipt-propagation.test.ts`
- `pnpm --filter @mog/app-spreadsheet typecheck`

Focused coordinator tests to add or extend:

- Floating-object projection service: create/update/remove, bounds-only updates, create-vs-update detection, sheet-switch hydration, initial hydration, delete notification to object/chart actors, renderer absence, duplicate receipt/event delivery, and disposal during pending fetch/animation-frame work.
- `processReceipts`: no-op receipts, mixed receipt families, no cache, no renderer objects, batched object changes, and devtools host reporting.
- Cross-system wiring registry: cleanup count, duplicate-install protection, and no late side effects after disposal.
- Editor transition handlers: commit/cancel distinction, cross-sheet formula origin return, pending-cell-format replay, Flash Fill dismiss on active-cell movement.
- Toolbar sync: active-cell format read on selection change and format event, normalized multi-range toolbar ranges, missing sheet during deletion/import.
- Sparkline manager: all CRUD/group operations, hydration races, render data invalidation, group axis scaling, and disposal safety.
- Shell coordinator or moved shell module: adapter cache lifecycle, clipboard payload conversion, focus stack behavior, typed hook/provider contract.

Production-path UI/eval gates:

- Existing app-eval scenarios that exercise cross-sheet editing and sheet-switch coordination, including `cross-sheet/navigation/*formula*`, `cross-sheet/navigation/sheet-switch-commits-normal-edit.spec.ts`, and `cross-sheet/navigation/sheet-switch-during-async-commit-waits-for-completion.spec.ts`.
- Existing drawing/object scenarios such as `rendering/drawings/image-anchor-after-row-insert.spec.ts`, `rendering/drawings/imported-drawingml-shape-fill-border.spec.ts`, `rendering/drawings/smartart-rendered.spec.ts`, and chart object render/import scenarios.
- Existing sparkline scenario `sparklines/line-sparkline-insert.spec.ts`, with real ribbon/dialog input and canvas pixel/readback assertions.
- A new E2E scenario for deleting/duplicating an object through the real toolbar/context-menu/keyboard path and verifying the dispatcher receipt path updates the renderer before relying on the EventBus fallback.

## Risks, edge cases, and non-goals

Risks:

- Receipt pull-path and EventBus push-path can double-process the same object mutation. The reducer must be idempotent and preserve cache structural sharing.
- Sheet switching can interleave with floating-object hydration, editor commit, find/replace navigation, and renderer scene rebuilds. Generation guards and deterministic scheduler tests are required.
- Removing legacy actor-bundle access can affect keyboard setup, action dependencies, tests, and exports. Migrate all callers in one change set and typecheck the package.
- Replacing host globals touches many tests that currently assume real `Date.now()` or global scheduler behavior. Use injected deterministic hosts in unit tests and browser-backed hosts in the app provider.
- Fire-and-forget mutation helpers can currently hide rejected writes. Converting them to returned promises may require action handlers to surface errors instead of ignoring them.
- Moving shell coordination may touch shell/view adapter boundaries outside this folder. Keep dependency direction `contracts -> shell/views -> apps` explicit and avoid importing app internals into public packages.

Edge cases to explicitly test:

- Disposal between scheduled microtask and object fetch completion.
- Disposal between sheet-switch hydration and animation-frame scene resync.
- Object delete arriving after a queued update for the same id.
- Object update arriving after a queued delete for the same id.
- Bounds available in events but object data unavailable.
- Imported objects whose ids collide across sheets.
- Missing active sheet during sheet deletion/import teardown.
- Formula editing while active sheet changes more than once before commit/cancel.
- Pending empty-cell format after regular edit, formula edit, cancel, and cross-sheet formula commit.
- Sparkline cache miss for a cell whose Worksheet API returns no sparkline.
- Sparkline group update when some member sparklines are not cached.

Non-goals:

- Do not move durable workbook data into UIStore, React state, or coordinator caches.
- Do not optimize benchmark-only or test-only paths.
- Do not add compatibility shims for old coordinator access shapes; migrate callers to the new typed contract in the same workstream.
- Do not use EventBus emission as a substitute for Worksheet API writes.
- Do not weaken read-only mode or bypass dispatcher/editor/input mutation gates.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contracts above are written.

- Agent A: floating-object projection service, shared reducer, receipt/event tests, and `sheet-coordinator.ts` integration.
- Agent B: cross-system wiring extraction, lifecycle registry, editor/toolbar/sheet-switch tests.
- Agent C: host capability threading through coordinator, mutation helpers, sparkline manager, app provider, and platform dependency inventory cleanup.
- Agent D: actor-access migration and shell coordinator ownership cleanup.
- Agent E: package-level verification and app-eval coverage for cross-sheet editing, drawings, receipts, and sparklines.

Dependencies:

- `apps/spreadsheet/src/actions/dispatcher.ts` and `apps/spreadsheet/src/actions/types.ts` for receipt and typed coordinator/action dependency contracts.
- `apps/spreadsheet/src/app/CoordinatorProvider.tsx` and `apps/spreadsheet/src/hooks/shared/use-coordinator.tsx` for host capability injection and coordinator construction.
- `apps/spreadsheet/src/systems/*` for system access contracts and wiring boundaries.
- `apps/spreadsheet/src/ui-store/` for sheet switch, toolbar, pending format, and Flash Fill state.
- `kernel/src/api/**`, `kernel/src/context/event-bus.ts`, and `@mog-sdk/contracts/api` for Workbook/Worksheet events, mutation receipts, and handle APIs.
- `tools/platform-dependency-allowlist.jsonc` for removing coordinator host-global allowlist entries after implementation.
- `mog-internal/dev/app-eval/scenarios/**` for UI verification through real input paths.
