# 062 — Improve `mog/apps/spreadsheet/src/coordinator` (spreadsheet state & mutation coordination root)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/coordinator`
- **Size:** ~9,244 lines of `.ts` across 25 files (including `__tests__`). Production top files: `sheet-coordinator.ts` (1,173), `mutations/diagram.ts` (583), `connector-rerouting.ts` (456), `types.ts` (429), `shell-coordinator.ts` (437), `actor-access/index.ts` (338), `mutations/equation.ts` (292), `editor-transition-handlers.ts` (291), `sparklines/sparkline-manager.ts` (978), `mutations/tables.ts` (191).
- **In scope (edit targets):**
  - **Composition root:** `sheet-coordinator.ts` (`SheetCoordinator` — creates the 5 systems, wires cross-system events, owns the floating-object projection), `factory.ts`, `index.ts` (barrel).
  - **Type surface:** `types.ts` (`SheetCoordinatorConfig`, `RendererDependencies`, `SheetStateProvider`, `PointerCaptureManager`, shell/toolbar dependency interfaces).
  - **Cross-system wiring helpers:** `editor-transition-handlers.ts`, `receipt-processing.ts`, `connector-rerouting.ts`.
  - **Shell view coordination:** `shell-coordinator.ts`, `view-clipboard-data.ts`.
  - **Actor access façade:** `actor-access/index.ts`.
  - **Mutation/feature helpers owned here:** `mutations/` (`index.ts`, `types.ts`, `tables.ts`, `equation.ts`, `diagram.ts`), `tables/calculated-column-context.ts`, `sparklines/` (`index.ts`, `sparkline-manager.ts`), `features/index.ts`.
  - `__tests__/` (`input-coordinator.test.ts`, `sheet-coordinator-receipts.test.ts`) and the colocated unit tests under `mutations/__tests__` and `sparklines/__tests__`.
- **Out of scope (named for coupling, not edit targets):**
  - The 5 systems under `apps/spreadsheet/src/systems/*` (`grid-editing`, `renderer`, `objects`, `input`, `ink`) — the coordinator composes them but they are owned by their own folders/plans. Coordination modules re-exported through `features/index.ts` (e.g. `setupSheetSwitchCoordination`, `setupFlashFillCoordination`, `setupFindReplaceCoordination`) live under `systems/` and are only referenced here.
  - `apps/spreadsheet/src/cache/floating-object-cache.ts` (the `FloatingObjectCache` Zustand store) — consumed here, owned elsewhere.
  - `@mog-sdk/contracts/*`, `@mog-sdk/sheet-view`, `@mog/shell`, `@mog/geometry`, `@mog-sdk/api` (`WorkbookInternal`/`Worksheet`/handle APIs) — type/contract packages reached across the boundary; changes that ripple into them are flagged as cross-folder dependencies, not done here.
  - React consumers (`app/CoordinatorProvider.tsx`, `views/grid/*`, `hooks/*`, `components/grid/effects/*`) that call into `SheetCoordinator` / `ShellCoordinator` — they define the public method contract this plan must preserve.

## Current role of this folder in Mog

This folder is the **composition root and cross-system nervous system** of the spreadsheet app. It owns four concerns:

1. **System composition (`SheetCoordinator`).** Constructs the five systems (`GridEditingSystem`, `RenderSystem`, `ObjectSystem`, `InputSystem`, `InkSystem`) with narrow per-system configs, starts them in dependency order, and holds the shared `FloatingObjectCache` and a `focusMachine` actor. It exposes `handlePointerUp/Cancel` (fanned out to each system's `DragTerminator`), `setRendererDependencies` (late-arriving React deps), `processReceipts`, `deleteSheet`, and `dispose`.

2. **Cross-system event wiring (`wireCrossSystemEvents`, `editor-transition-handlers.ts`).** Subscribes to actor transitions and `workbook` events to keep otherwise-decoupled systems in sync: selection/object selection mutual-exclusion, editor↔input focus handoff, active-cell read-model warming, return-to-origin-sheet on cross-sheet formula commit, pending-format re-apply after commit, flash-fill preview lifecycle, scroll-commit, named-ranges recalc, merge-anchor snapping, find-replace highlight invalidation, sheet-switch view-state save/restore, and toolbar format/range sync into `UIStore`.

3. **Floating-object projection.** Two parallel paths keep the renderer and the `FloatingObjectCache` in sync with kernel floating-object state: a **push path** (`wireFloatingObjectManager` — EventBus subscriptions + microtask-coalesced batch fetch + generation-guarded async flush + `applyPatches`) and a **pull path** (`receipt-processing.ts` / `processReceipts` — synchronous receipt-driven cache + patch application). `connector-rerouting.ts` re-routes connector endpoints when connected shapes move.

4. **View-level shell coordination & helpers (`ShellCoordinator`).** View lifecycle with adapter caching, cross-view clipboard conversion, focus-layer stack. Plus mutation helpers (`mutations/tables.ts`, `tables/calculated-column-context.ts`), the `SparklineManager`, and the `actor-access` façade that merges per-system accessor/command/selector bundles for handlers and hooks.

## Evidence (observed in the current tree)

- **The "composition root" is a 1,173-line god-file whose own header is false.** `sheet-coordinator.ts:4` documents it as a "~250-line pure composition root … All domain logic lives inside the systems. The coordinator only … wires cross-system events." In reality `wireCrossSystemEvents` spans `sheet-coordinator.ts:331-711` (~380 lines) and `wireFloatingObjectManager` spans `:724-1067` (~340 lines). Together they are 60%+ of the file and contain real domain logic (active-cell cache warming `:363-385`, toolbar format/range derivation `:638-709`, floating-object batch coalescing `:748-952`).

- **The floating-object projection is duplicated across two divergent paths.** The push path (`wireFloatingObjectManager`, `:830-952`) and the pull path (`receipt-processing.ts:19-66`) both: snapshot existing object IDs, classify `created` vs `updated`, call `store.getState().applyBatch(...)`, build `FloatingObjectPatch[]`, and call `renderer.getObjects()?.applyPatches(...)`. The push path additionally handles bounds-only updates, generation guards, and a Rust `computeAllObjectBounds` bounds-backfill (`:888-906`); the pull path does none of that. The push-path comment at `:1116-1118` admits the duplication is provisional ("A future dispatcher middleware … will make this automatic"). Two implementations of the same projection invariant can (and will) drift.

- **~875 lines of orphaned production code + ~2,181 lines of orphaned tests.** `mutations/equation.ts` (292) and `mutations/diagram.ts` (583) are **not** exported from `mutations/index.ts` (only `Tables` is — `mutations/index.ts:24`), and a tree-wide search finds **zero** importers of `mutations/equation` or `mutations/diagram` anywhere outside their own colocated tests (`mutations/__tests__/equation.test.ts:28` and `diagram.test.ts:31` import `'../equation'` / `'../diagram'`). The live equation/diagram write paths used by `actions/handlers`, `dialogs`, and `ObjectContextMenu` resolve to a *different* module, not these. These two files and their 2,181 lines of tests are dead weight that still cost build/typecheck/test time and mislead readers about the live write path.

- **`ShellCoordinator` ships unfinished, partly-dead wiring.** Five `TODO`s mark incomplete UIStore integration: `shell-coordinator.ts:130` passes `uiStore: undefined` to every adapter; `:141-149` subscribes to `onToolbarContextChange` and `getToolbarContext` but the handlers are commented out, so the subscription does nothing; `:152` sends `FOCUS_GRID` with a note it should be a renamed `FOCUS_BASE_VIEW`. The toolbar-context plumbing is wired-but-no-op — a latent correctness gap for non-grid views.

- **`actor-access` "new path" is fully untyped.** `actor-access/index.ts:229-338` — the coordinator-based overload of `createActorAccessLayer` types every system's `access.{accessors,commands,selectors}` as `Record<string, unknown>` and merges them with object spreads (`:315-337`). Key collisions across systems are silently last-wins, and all downstream type safety on accessors/commands is lost. The typed implementation (`createActorAccessLayerFromBundle`) is marked `@deprecated` (`:143`), so the supported path is the unsound one.

- **Cross-system wiring is silently gated on optional config with no diagnostics.** `wireCrossSystemEvents` guards nearly every feature behind `if (this.workbook && this.config.sheetSwitchDependencies)` / `if (this.config.toolbarDependencies)` (e.g. `:353, :396, :408, :425, :485, :504, :544, :630`). If a dependency is omitted, the corresponding feature (return-to-origin sheet, pending-format reapply, flash-fill, merge-anchor, find-replace, sheet-switch, toolbar sync) silently does not wire — no warning, no metric. Misconfiguration is indistinguishable from "feature off."

- **Dangling documentation references throughout.** Headers cite docs that do not exist in the tree: `COORDINATOR-DECOMPOSITION.md` (`index.ts:7`, `factory.ts:6`), `07-SHEET-COORDINATOR-DECOMPOSITION.md` (`factory.ts:7`), `COORDINATOR-MODULE-EXTRACTION.md` (`types.ts:7`), `SHEET-AWARE-CELL-DATA-CALLBACKS.md` (`types.ts:166,169`), `coordinator-dependency-decoupling.md` (`types.ts:333`). `factory.ts:16-21` still describes config fields as "optional … In these will become required," a half-finished sentence describing a migration that never landed.

- **`mutations/tables.ts` does O(sheets) linear scans, fire-and-forget.** `setCalculatedColumn` (`:49-69`), `clearCalculatedColumn` (`:81-102`), and `applyCalculatedFormulasToNewRow` (`:151-191`) each iterate `workbook.sheetNames`, `await getSheet(name)` then `await ws.tables.list()` per sheet to locate a table by name, inside a `void (async () => …)()` whose rejections are unobservable by the caller. A table-name lookup is O(sheets × tables) and any error is swallowed; the caller cannot await completion or learn of failure.

- **Devtools reach through `window as any`.** `sheet-coordinator.ts:1122` does `(window as any).__OS_DEVTOOLS__?.reportReceipt?.(receipts)` inside the hot `processReceipts` path. Untyped global access in production code; same `as unknown as` casting appears at `:436` for the UIStore superset cast.

- **Cleaner aspects (preserve, don't churn).** The generation-guard concurrency machinery in `wireFloatingObjectManager` (`projectionGeneration`/`projectionDisposed` re-checks after every `await`, `:868, :897, :910`) is actually correct and defends against dispose/sheet-switch races; the microtask coalescing preserves structural sharing as documented (`:730-746`). `connector-rerouting.ts` is well-factored (incremental `ConnectionIndex`, microtask debounce, handles both TS-native and OOXML-import connection shapes). `editor-transition-handlers.ts` already extracts the transition handlers into named, testable functions. `view-clipboard-data.ts` is correctly marked `@deprecated` with a migration target. The DAG-violation avoidance (local `CoordinatorViewAdapter`, `view-clipboard-data.ts` extraction) is deliberate and documented.

## Improvement objectives

1. **Unify the floating-object projection into one source of truth.** Collapse the push-path (`wireFloatingObjectManager` flush) and pull-path (`receipt-processing.ts`) onto a single `FloatingObjectProjection` module that owns cache-classification, bounds-backfill, patch construction, and `applyPatches`, so push and pull cannot diverge.
2. **Shrink `SheetCoordinator` to an actual composition root.** Extract the cross-system wiring and the floating-object projection out of the class into dedicated, individually-testable wiring modules (mirroring the existing `editor-transition-handlers.ts` pattern), and make the file's header accurate.
3. **Delete orphaned code.** Remove `mutations/equation.ts`, `mutations/diagram.ts`, and their tests after confirming zero live importers, eliminating ~3,000 lines that misrepresent the live write path.
4. **Make wiring configuration explicit and observable.** Replace silent `if (deps)` gating with a single resolved, validated wiring config that emits a diagnostic (via `onMetric`/`console.warn`) when an expected dependency is absent, so misconfiguration is visible.
5. **Restore type safety to `actor-access`.** Make the coordinator-based `createActorAccessLayer` path strongly typed (or formalize the merge), and resolve the `@deprecated`-but-canonical inversion.
6. **Finish or formally retire `ShellCoordinator`'s UIStore wiring.** Either wire toolbar-context propagation through to `UIStore` or remove the dead subscription and document the gap.
7. **Fix doc rot.** Remove/replace dangling doc references and stale "~250-line"/"will become required" claims with accurate, in-tree pointers.

## Production-path contracts and invariants to preserve or strengthen

- **Public method surface of `SheetCoordinator`** consumed by React/hooks: `grid/renderer/objects/input/ink` (readonly system handles), `floatingObjectCache`, `workbook`, `uiStore`, `setRendererDependencies`, `handlePointerUp`, `handlePointerCancel`, `processReceipts`, `deleteSheet`, `dispose`, `isActive`. **No signature changes** without updating all consumers; this plan keeps them stable.
- **Construction-time wiring order** must remain: build infra → create 5 systems → `start()` in `grid, renderer, objects, input, ink` order (`sheet-coordinator.ts:292-296`) → `setSelectionActorForViewportFollow` → wire cross-system events. Dispose runs in reverse (`:1146-1150`). Reordering risks first-frame/teardown bugs.
- **Floating-object projection invariants:** (a) subscribe-before-populate so events during async hydration coalesce safely (`:989-1010`); (b) per-flush generation guard so a dispose or sheet-switch mid-flush aborts cleanly; (c) `created` vs `updated` classification keyed on cache membership at apply time; (d) bounds-backfill for object types Rust omits bounds for (e.g. pictures, `:888-906`); (e) structural sharing preserved (granular per-object set, not whole-sheet re-read). The unified module must keep all five.
- **Single-source-of-truth for "scroll active cell into view":** the selection actor's `userSelectionChanged` emit (`:298-301`). Do not add competing viewport-follow triggers.
- **Cross-sheet formula return semantics:** only `formulaEditing` (not plain `editing`) triggers return-to-origin (`editor-transition-handlers.ts:99-138`); a sheet-switch during plain editing is an intentional navigation. Preserve exactly.
- **Pending-format reapply guard:** re-apply only on the `committing → inactive` path and only when committed cell/sheet match the pending format's cell/sheet (`editor-transition-handlers.ts:254-285`); always clear on edit end. Preserve.
- **Connector re-routing:** must continue to accept both TS-native (`{shapeId, siteIndex}`) and OOXML-import (`{shapeId, idx}`) connection shapes (`connector-rerouting.ts:144-163`) and only re-route on position/size field changes (`POSITION_FIELDS`, `:47-57`).
- **DAG/boundary constraints:** no `coordinator/ → views/` imports (the reason `view-clipboard-data.ts` and `CoordinatorViewAdapter` exist); `SheetView.gridRenderer` access is `@internal` and allowed from apps/spreadsheet but must not leak into public `@mog-sdk/sheet-view` declarations (`sheet-coordinator.ts:200-208`). Preserve.
- **Read-only mode:** `config.readOnly` flows to `GridEditingSystem` (`:159`); any new wiring that mutates must honor it.

## Concrete implementation plan

Sequenced so each step is independently reviewable and leaves the tree green. No behavior change except where explicitly noted (objective 4 adds diagnostics; objective 6 may add real toolbar wiring).

1. **Confirm-and-delete orphaned mutation modules (objective 3).**
   - Re-verify with a tree-wide search that nothing outside `coordinator/mutations/__tests__` imports `mutations/equation` or `mutations/diagram`, and that the live equation/diagram action handlers resolve elsewhere.
   - Delete `mutations/equation.ts`, `mutations/diagram.ts`, `mutations/__tests__/equation.test.ts`, `mutations/__tests__/diagram.test.ts`, `mutations/__tests__/text-effects-kernel-boundary.test.ts` (if it too targets a deleted module — verify first). Leave `mutations/{index.ts, types.ts, tables.ts}` and `tables/calculated-column-context.ts` (all live).
   - This is the cheapest, highest-signal change and shrinks the surface every later step touches.

2. **Extract a single `FloatingObjectProjection` module (objectives 1, 2).**
   - New file `coordinator/floating-object-projection.ts` exporting a class/factory that owns: the pending-fetch/bounds/delete maps, microtask coalescing, generation guards, async flush, bounds-backfill, and patch construction — i.e. the current body of `wireFloatingObjectManager` (`:724-1067`).
   - Refactor `receipt-processing.ts` to delegate its cache-classification + patch-build to the *same* helper used by the flush path (extract `buildPatchesAndApply(store, renderer, {fetched, deleteIds, bounds})`), so the synchronous pull path and async push path share one classification/apply implementation.
   - `SheetCoordinator` constructs the projection, passes it `floatingObjects`, `workbook`, `floatingObjectCache`, `renderer.getObjects`, and `getActiveSheetId`; keeps `processReceipts` delegating to it. Net: `wireFloatingObjectManager` leaves the class entirely.

3. **Extract cross-system wiring into composable modules (objective 2).**
   - Move the active-cell cache warming, named-ranges, merge-anchor, find-replace, scroll-commit, sheet-switch, and toolbar-format/range blocks out of `wireCrossSystemEvents` into a `coordinator/wiring/` directory of small `wireX(deps): () => void` functions, following the established `editor-transition-handlers.ts` shape (pure function in, cleanup out). `SheetCoordinator` calls them and pushes each returned cleanup to `crossWiringCleanups`.
   - After steps 2–3, `sheet-coordinator.ts` should approach its claimed role (compose, start, wire-by-calling, dispose). Update the file header to describe the real responsibilities and line budget.

4. **Introduce a resolved, validated wiring config (objective 4).**
   - Add an internal `resolveWiringConfig(config)` that computes which features can wire (workbook present, sheetSwitchDeps present, toolbarDeps present) once, returns a typed struct, and emits one diagnostic per expected-but-absent dependency through `config.onMetric` (preferred) or a single `console.warn` with a stable prefix. Replace the scattered `if (...)` guards with reads of this struct. No feature is enabled/disabled differently — only made observable.

5. **Re-type the `actor-access` coordinator path (objective 5).**
   - Replace the `Record<string, unknown>` overload with a generic typed merge over the systems' `access` bundles (the systems already export typed `ActorAccessors`/`ActorCommands`). Add a dev-time assertion (or typed merge that surfaces) for key collisions across systems. Remove the `@deprecated` tag from whichever path becomes canonical, or fully retire `createActorAccessLayerFromBundle` if no caller passes a raw `ActorBundle` (verify importers first).

6. **Resolve `ShellCoordinator` UIStore wiring (objective 6).**
   - Decision point (see Risks): either (a) thread a real `uiStore` through `ShellCoordinatorConfig` and implement `setToolbarContext` propagation + initial context, removing the three toolbar `TODO`s; or (b) if multi-view toolbar context is not yet a product requirement, delete the dead `onToolbarContextChange` subscription and `getToolbarContext` plumbing and leave a single accurate comment. Rename `FOCUS_GRID`→`FOCUS_BASE_VIEW` only in coordination with the `focus-machine` owner (cross-folder; otherwise leave the `TODO` with a tracking note).

7. **Tighten `mutations/tables.ts` (objective adjacency to 4).**
   - Replace the three independent O(sheets) scans with a shared `findSheetContainingTable(workbook, tableId)` helper, and have the public functions return the `Promise` (let callers `void`/await as appropriate) and route failures through a logged channel instead of silent swallow. Do not change the fire-and-forget call sites' observable behavior unless a caller opts to await.

8. **Documentation hygiene (objective 7).**
   - Remove or repoint every dangling doc reference listed in Evidence; fix the truncated `factory.ts:16-21` comment; update `types.ts`/`index.ts` headers to reflect the post-refactor structure.

## Tests and verification gates

> Per task constraints this plan does not run build/test/typecheck commands; the gates below are what a reviewer/CI must execute for the change to land. (No test-only "fixes" — these verify the production refactor.)

- **Typecheck the package** (`apps/spreadsheet` project references resolve, including `@mog-sdk/contracts` declaration rollup per `[[mog-contracts-declaration-rollup]]`).
- **Existing coordinator tests must pass unchanged in intent:** `__tests__/sheet-coordinator-receipts.test.ts` (pull-path projection) and `__tests__/input-coordinator.test.ts`. After step 2, `sheet-coordinator-receipts.test.ts` should target the unified projection helper; add an equivalent push-path test (currently the EventBus flush has no coordinator-level test).
- **New unit tests for extracted modules:** one per `wiring/wireX` function (pure function → assert subscription/cleanup and the documented invariant), and a `FloatingObjectProjection` test covering: created-vs-updated classification, bounds-backfill, generation-guard abort on dispose mid-flush, and coalescing of N synchronous events into one batch.
- **Dead-code deletion gate:** prove zero importers before removing `equation.ts`/`diagram.ts` (grep gate in the PR description); confirm the package still typechecks and the orphaned tests are removed together.
- **App-eval regression sweep** for the cross-system behaviors most at risk: cross-sheet formula return-to-origin, pending-format reapply (Cmd+B on empty cell then type), flash-fill preview lifecycle, sheet-switch selection/scroll restore, toolbar Bold/Italic active state, merge-anchor snap, find-replace highlight, connector re-route on shape move, floating-object insert/move/delete repaint. Use existing app-eval scenarios; see `[[app-eval-usage]]` and the async-overlay readback gotcha `[[app-eval-async-overlay-race]]`.
- **No new lint/`any` regressions:** the `window as any` at `processReceipts` is pre-existing; do not add more. If touched, type the devtools global via a declared interface.
- **Manual smoke** of view switching + clipboard (Grid→Grid paste preserving formulas through `ShellCoordinator.convertPayloadToViewData/convertViewDataToPayload`) if step 6 touches `ShellCoordinator`.

## Risks, edge cases, and non-goals

- **Highest risk: floating-object projection unification (step 2).** The push path's generation guards and bounds-backfill are subtle and currently un-unit-tested at the coordinator level. Mis-merging push/pull could cause ghost objects after sheet switch (the exact failure the `populateAndResync` self-heal at `:1030-1066` defends against) or double-applied patches. Mitigation: land the extracted module as a pure move first (byte-for-byte behavior), add tests, *then* unify the shared helper in a separate commit.
- **`ShellCoordinator` step 6 is a fork in the road, not a foregone change.** Implementing toolbar-context propagation is a real behavior addition that needs product/owner confirmation; deleting it is safe but loses latent intent. Default to (b) delete-and-document unless the owner confirms multi-view toolbar context is required. This is the one decision a human should sign off on.
- **`actor-access` re-typing may surface real key collisions** across systems that the current `unknown` spread hides. If a collision is found, that is a latent bug in a system folder (out of scope to fix here) — flag it, don't paper over it.
- **Orphan deletion edge case:** verify `mutations/__tests__/text-effects-kernel-boundary.test.ts` targets a deleted/orphaned module before removing it; it may legitimately test a live boundary. Do not delete on assumption.
- **`refreshActiveCell`/sheet-deletion races** (`sheet-coordinator.ts:376-384`) are intentionally swallowed because a sheet can disappear during teardown. Preserve the try/catch when extracting; do not "fix" the empty catch into a throw.
- **Cross-folder ripple:** renaming `FOCUS_GRID`, retyping accessor bundles, or changing `WorkbookInternal` usage can touch `systems/*`, `@mog/shell`, and `@mog-sdk/contracts`. Keep those as explicit cross-folder dependencies; this plan changes only the coordinator side of each contract.
- **Non-goals:** rewriting the XState machines or system internals; changing the 5-system decomposition; altering clipboard/paste semantics; replacing the `FloatingObjectCache` store; adding the long-promised "dispatcher middleware" that would auto-wire `processReceipts` (note it as a follow-up — unifying push/pull here is the precondition for it). No reduced-scope or shim approaches: orphaned code is deleted, not stubbed.

## Parallelization notes and dependencies on other folders

- **Internal ordering:** Step 1 (delete orphans) is independent and should land first. Steps 2 and 3 both restructure `sheet-coordinator.ts`; do **2 before 3** (projection is the largest single extraction) to minimize merge churn. Steps 4, 5, 7 are independent of each other and can run in parallel branches once 2–3 land. Step 6 is independent of all others. Step 7 (docs) trails whatever structural changes land.
- **Depends on (consumes contracts owned elsewhere):** `apps/spreadsheet/src/systems/*` (the 5 systems and their `access` bundles + coordination modules re-exported via `features/index.ts`); `apps/spreadsheet/src/cache/floating-object-cache.ts`; `@mog-sdk/contracts/*`, `@mog-sdk/sheet-view`, `@mog/shell` (`focusMachine`), `@mog/geometry` (connector routing), `@mog-sdk/api` (`WorkbookInternal`/handles). Editing `@mog-sdk/contracts` types requires the declaration rollup build before consumers typecheck (`[[mog-contracts-declaration-rollup]]`).
- **Depended on by (must not break):** `app/CoordinatorProvider.tsx`, `views/grid/*`, the `hooks/*` and `components/grid/effects/*` that read `SheetCoordinator` system handles and call `processReceipts`/`setRendererDependencies`; `actions/dispatcher.ts` (calls `coordinator.processReceipts`); `app/Shell.tsx` and `hooks/shared/use-shell-coordinator.ts` (use `ShellCoordinator`). The `actor-access` façade feeds handlers and hooks broadly — its re-typing (step 5) is the change with the widest blast radius and should be reviewed against the full importer list.
- **Coordinate with sibling plans:** the systems folders (`grid-editing`, `renderer`, `objects`, `input`, `ink`) have their own review entries; any contract change at the system boundary (accessor bundle shape, coordination-module signatures) must be agreed with those owners rather than changed unilaterally here.

## Status

Not blocked. The folder exists and evidence is sufficient: 25 files read directly, all consumers and orphan status verified by tree-wide search. The plan is a production-path refactor (unify duplicated projection, decompose the god-file, delete dead code, make wiring observable, restore types) with no reduced-scope or shim alternatives.
