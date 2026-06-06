# Plan 019 — Harden Anchoring & Projection in `kernel/src/floating-objects`

## Source folder and scope

- **Folder:** `mog/kernel/src/floating-objects`
- **Public source path:** `/Users/guangyuyang/Code/mog-all/mog/kernel/src/floating-objects`
- **Description (queue):** Anchoring and projection for charts, shapes, and images.

In scope (files inspected for this plan):

- `spreadsheet-object-manager.ts` — the `IFloatingObjectManager` facade.
- `spreadsheet-object-mutator.ts` — `IObjectMutator` impl over `ComputeBridge`.
- `object-store.ts` — `ComputeBridgeObjectStore` / `ComputeBridgeGroupStore`.
- `spreadsheet/cell-anchor-resolver.ts` — the **only** cell-grid ↔ pixel math.
- `projection/floating-objects-projection.ts` + `projection/setup.ts` — the kernel-side TS mirror (`IFloatingObjectsView`) and its event-bus population pipeline.
- `core/positioning.ts` and the rest of `core/`, `managers/`, `spreadsheet/` adapters.

Out of scope: Rust compute-core internals, `domain/` content (chart marks, shape geometry, equation typesetting), `apps/spreadsheet/` canvas rendering, and the `bridges/compute` IPC surface itself — except where this folder's contract with those layers must change (called out explicitly in Dependencies).

## Current role of this folder in Mog

This module is the **app-agnostic hosting layer** for canvas objects (charts, shapes/drawings, pictures, text boxes, equations, diagrams, OLE embeds). It owns *how* objects live on a sheet — position, anchor, size, rotation, z-order, grouping, clipboard, CRUD persistence — while object *content* lives in `domain/`.

Two distinct data paths, both important to keep straight:

- **Writes** flow async through `SpreadsheetObjectManager` → `SpreadsheetObjectMutator` / `ComputeBridgeObjectStore` → Rust compute-core (single source of truth). Rust bundles per-domain changes into a `MutationResult`, and `MutationResultHandler` re-emits `floatingObject:created|updated|deleted` on the workbook event bus.
- **Reads** are sync, off a kernel-owned mirror. `FloatingObjectsProjection` (implementing `IFloatingObjectsView`) is populated *only* by `setupFloatingObjectsProjection`, which subscribes to those bus events, coalesces them into one microtask flush, and applies one atomic batch. Both the canvas renderer and React (`useSyncExternalStore`) read from this projection synchronously.

The **anchoring core** is `spreadsheet/cell-anchor-resolver.ts` — the single file allowed to translate a `CellAnchor` (`cellId` + pixel offsets) to/from pixel bounds via `ComputeBridge` row/col/cell position queries. Renderers no longer call it on the hot path (they consume pre-computed bounds from `computeAllObjectBounds` / `FloatingObjectChange.bounds`), but hit-testing, drag-start capture, selection bounds, group bounds, and text-editor overlays still call `computeObjectBounds` per object.

The module is consumed by `api/` (public kernel API), `domain/` (chart/drawing/equation/diagram bridges), and `services/clipboard/`. It is a load-bearing layer with broad blast radius.

## Improvement objectives

Grounded in concrete findings from the current code:

1. **Eliminate sentinel-anchor corruption in production.** `absoluteToAnchorPosition` (line 87), `fromPixelsAsync` (line 366), and `getOrCreateCellIdViaBridge` (line 417) fall back to `toCellId('__placeholder__')` when `computeBridge` is missing; `normalizePosition` (line 236) hardcodes `toCellId('cell-0-0')`; `managers/*` and `ole-object-manager.ts` use `toCellId('n')`. In dev these throw, but in prod they *persist* objects anchored to a cellId that will never resolve — the object is then unpositionable and silently dropped by bounds resolution. This is a latent data-corruption bug, not a cosmetic one.
2. **Make anchor resolution batched/parallel.** `computeObjectBounds` and `resolveAnchorAsync` issue a serial IPC waterfall (`getCellPosition` → `getColPosition` → `getRowPosition`, ×2 for two-cell anchors). Every non-renderer consumer (hit-test, drag, selection, group) pays N×(3–6) sequential round-trips. Collapse to parallel/batched bridge calls.
3. **Define and enforce orphaned-anchor behavior.** When an anchor cell is deleted, resolution returns `null` and the object vanishes from bounds with no recovery path. Specify a deterministic re-anchoring/fallback contract so charts/images don't silently disappear on row/column delete.
4. **Tighten projection notification scoping.** `applyBatch` admits ("For simplicity…") it cannot attribute pure deletes or cross-sheet moves to a sheet, so deletes fire a workbook-scoped `notify(null)`, forcing *every* sheet subscriber to re-read. Track the deleted object's owning sheet so notifications stay sheet-scoped.
5. **Batch destructive and bulk operations.** `mutator.deleteMany` loops `await delete(id)` serially, each doing a separate `getContainerId` read + delete IPC. Provide a batched path.
6. **Remove dead/misleading API surface.** `hitTest` and `resolvePosition` on the manager are permanent `return null` no-ops that still satisfy the contract; `updateTextEffect` sends the *entire* object as "partial updates" (clobber + IPC bloat). Clean both on the production path.
7. **Centralize magic constants & generate collision-safe IDs.** Default dims (`?? 100`) are duplicated across resolver branches; `MIN_DIMENSION`, `HANDLE_SIZE`, `DEFAULT_DUPLICATE_OFFSET` live in three places; `generateObjectId` uses `Date.now()` + a *module-global* counter shared across every manager instance (collision + non-determinism risk across documents/replay).

## Production-path contracts and invariants to preserve or strengthen

Must be preserved:

- **Single source of truth.** Rust owns persistent object state; all writes go through `ComputeBridge`. The projection is a derived mirror with exactly one writer (the population pipeline). No direct projection field mutation.
- **Cell-grid math is confined to `cell-anchor-resolver.ts`.** No new cell↔pixel arithmetic anywhere else (`core/` stays pure pixel math).
- **One notification per logical mutation.** `applyBatch` coalesces a batch and fires per-affected-sheet (or workbook-scoped) notifications exactly once. Sync reads via `IFloatingObjectsView` must remain synchronous and allocation-light enough for per-frame use.
- **Sync reads / async writes split.** Reads never touch IPC; writes never block the render path.
- **Event-driven population only.** The projection never polls; it reacts to `floatingObject:*` and `dimension:*` events plus the initial seed.

To strengthen (new/clarified invariants):

- **No object is ever persisted with an unresolvable sentinel anchor.** Either resolve a real `cellId`, or reject the operation (dev *and* prod) — no silent `__placeholder__`/`cell-0-0`/`n` writes.
- **Deterministic orphaned-anchor fallback:** a documented, tested resolution result when `from`/`to` cells are deleted (re-anchor to nearest surviving cell + retained pixel offset, or convert to absolute) instead of returning `null`.
- **Notification minimality:** a delete or cross-sheet move notifies only the sheets it actually touched.

## Concrete implementation plan

The phases are independently shippable; later phases assume earlier ones but do not require them.

### Phase 1 — Kill sentinel anchors (correctness)
- Introduce a single typed result for "anchor could not be resolved" (e.g. `AnchorResolution = { ok: true; position } | { ok: false; reason: 'no-bridge' | 'cell-deleted' }`) instead of returning `null` / fabricating placeholders.
- In `absoluteToAnchorPosition`, `fromPixelsAsync`, `getOrCreateCellIdViaBridge`, and `normalizePosition`: when no real cell can be obtained, **fail the operation** (throw `FloatingObjectError('OBJ_INVALID_CONFIG', …)`) in both dev and prod rather than persisting a sentinel. The manager-level create paths translate that into a rejected promise the API layer can surface.
- Audit `managers/picture-manager.ts`, `managers/textbox-manager.ts`, `spreadsheet/ole-object-manager.ts` for the `toCellId('n')` default; replace with the same resolve-or-reject path or a single named `DEFAULT_ORIGIN_ANCHOR` constant that is *resolved* through the bridge, never stored raw.

### Phase 2 — Batch/parallelize anchor resolution (performance)
- Rewrite `computeObjectBounds` and `resolveAnchorAsync` so independent bridge lookups run via `Promise.all` (col-left + row-top are independent of each other; two-cell `from`/`to` resolve concurrently).
- Add a batched bounds path for the multi-object consumers (selection bounds, group bounds): resolve all member `cellId`s through the existing `computeBridge.resolveCellPositions` batch call (already used by `getObjectsInViewport`) instead of per-object waterfalls.
- Reconcile the README/code claim that `computeAllObjectBounds` "falls back to empty map if unavailable" — either implement the guard in `SpreadsheetObjectManager.computeAllObjectBounds` or correct the comment.

### Phase 3 — Orphaned-anchor policy (correctness)
- Define the fallback in `cell-anchor-resolver.ts`: on `getCellPosition` miss for `from`, attempt re-anchor (clamp to last valid row/col, preserve pixel offset → effectively absolute); for two-cell `to` miss, the current "fall back to explicit dimensions" stays but is documented and tested.
- Emit a `dimension:*`-driven bounds update so the projection reflects re-anchoring without a data mutation (the projection already supports bounds-only batches via `pendingBoundsOnly`).

### Phase 4 — Projection notification scoping (correctness + perf)
- In `applyBatch`, capture each deleted object's `sheetId` *before* `deleteObject` removes it (read from the pre-mutation `objects` map), and add those sheets to `affectedSheets`. Reserve `notify(null)` strictly for `clear()` and genuinely workbook-scoped changes.
- For cross-sheet moves (`upsertObject` already detects `previous.sheetId !== obj.sheetId`), ensure *both* old and new sheets are notified.
- Consider maintaining per-sheet sorted order or a cached sorted view so `getInSheet` does not `sort()` on every sync read (hot path). Keep the public ordering contract (ascending `zIndex`) identical.

### Phase 5 — Batch bulk ops & trim dead surface
- Add `ComputeBridge.deleteFloatingObjects(sheetId, ids[])` consumption (or group deletes by resolved `containerId` and issue one IPC per sheet) so `deleteMany` is not O(n) serial round-trips.
- Remove `hitTest`/`resolvePosition` no-ops from the manager and the `IFloatingObjectManager` contract (coordinate with `api/` and contracts — see Dependencies), or, if a caller still depends on them, make them real. No permanent `return null` stubs left in the production interface.
- Fix `updateTextEffect` to send only the changed `textEffects` field via `updateObject`, not the whole `TextBoxObject`.

### Phase 6 — Constants & IDs
- Create a single `constants.ts` (or extend `types.ts`) owning `MIN_DIMENSION`, default object width/height, `HANDLE_SIZE`, `ROTATION_HANDLE_OFFSET`, `DEFAULT_DUPLICATE_OFFSET`; replace the scattered `?? 100` / `Math.max(10, …)` literals with references.
- Replace `generateObjectId` (`Date.now()` + module-global counter) with a collision-resistant, per-document id source threaded through `SpreadsheetObjectManagerDeps` (or delegate id minting to Rust, which already returns created ids in `floatingObjectChanges`). Eliminate cross-instance shared mutable state.

## Tests and verification gates

(Authoring only — this plan does not run builds/tests; gates below define what the implementing change must satisfy.)

- **Existing tests must stay green:** `projection/__tests__/floating-objects-projection.test.ts` and `projection/__tests__/setup-disposal.test.ts`. Notification-scoping changes (Phase 4) will require updating/adding assertions there.
- **New unit tests:**
  - Resolver rejects (never returns a placeholder) when bridge is absent — dev and prod paths.
  - Parallelized `computeObjectBounds` returns identical bounds to the serial version for one-cell and two-cell anchors.
  - Orphaned-anchor fallback produces the documented deterministic result when `from`/`to` cells are deleted.
  - `applyBatch` fires a sheet-scoped (not `null`) notification for a pure delete and notifies both sheets on a cross-sheet move.
  - `deleteMany` issues batched IPC (assert call count) and returns the correct deleted count.
  - `updateTextEffect` sends only `textEffects` in the update payload.
- **Eval coverage:** add/extend `app-eval` scenarios for chart/image insert → row/column delete that intersects the anchor → object re-anchors (does not vanish), and for multi-object delete + undo. (Per memory `app-eval-async-overlay-race`, readbacks must `waitFor` async overlays; per `resize-sheetnotfound-misleading`, anchor/axis-identity failures are data-dependent — seed fixtures with real anchored objects.)
- **Verification gates the implementer runs:** `pnpm --filter @mog-sdk/contracts build` if any contract type changes (per memory `mog-contracts-declaration-rollup`), kernel typecheck, the floating-objects unit suite, and the new evals. No behavior change to public `ws.objects.*` semantics beyond the documented orphaned-anchor improvement.

## Risks, edge cases, and non-goals

**Risks**
- Changing the sentinel-fallback to a hard rejection (Phase 1) could surface latent callers that relied on objects being created even without a bridge. Mitigate by auditing all create call sites first and routing failure through the API error channel rather than swallowing.
- Removing `hitTest`/`resolvePosition` touches a public contract; must land contracts + api + this folder together to avoid a broken build (`@mog-sdk/contracts` declaration rollup).
- Notification-scoping changes risk *under*-notifying (stale canvas) more than over-notifying. Favor correctness: when in doubt about affected sheets, keep the broader notification and add a test before narrowing.

**Edge cases**
- Two-cell anchors where only one endpoint cell is deleted.
- Cross-sheet move *and* delete in the same coalesced batch.
- Hydration/undo/remote-CRDT paths all funnel through the same event bus — every change must be validated against `setup.ts`'s coalescing + generation-guard logic so a sheet-switch mid-flush doesn't apply stale data.
- Absolute-positioned objects must bypass anchor resolution entirely (already handled; preserve).

**Non-goals**
- Rewriting the dual read/write architecture or moving the projection out of `kernel/`.
- Changing Rust compute-core anchor storage or the `MutationResult` shape.
- Touching `domain/` content logic or `apps/spreadsheet` rendering.
- No compatibility shims or test-only fixes — every change lands on the production path.

## Parallelization notes and dependencies on other folders

- **Independent / parallelizable:** Phase 2 (resolver batching), Phase 4 (projection scoping), and Phase 6 (constants/IDs) are internal to this folder and can proceed concurrently.
- **Cross-folder coordination:**
  - Phase 5's `deleteFloatingObjects` batch and any new bounds-batch call depend on `bridges/compute/compute-bridge` (and the Rust binding behind it).
  - Removing `hitTest`/`resolvePosition` requires changes in `@mog-sdk/contracts` (`IFloatingObjectManager`) and `api/`; sequence contracts → this folder → api, with a contracts declaration rebuild between.
  - Phase 3's orphaned-anchor fallback should be checked against `dimension:*` event emission owned by the mutation pipeline / `MutationResultHandler` to confirm bounds-only updates reach the projection.
- **Ordering:** Phase 1 (no sentinel writes) should land first — it is the highest-severity correctness fix and de-risks the data that later phases read.
