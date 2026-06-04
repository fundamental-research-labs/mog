# Plan 082 — Harden the Kernel Drawing/Ink Domain

## Source folder and scope

- **Folder:** `mog/kernel/src/domain/drawing`
- **Public Mog source.** All internal planning text stays in `mog-internal`.
- **Files in scope:**
  - `index.ts` — barrel re-export of the domain.
  - `drawing-manager.ts` — creation + mutation helpers for `DrawingObject` (create, add/erase/clear strokes, tool-state, recognitions, serialization helpers, type guard).
  - `drawing-operations.ts` — read-only queries + the module-global spatial-index cache, bounds/hit-testing, polygon (lasso) testing, Bézier control points, pressure detection, ordered stroke iteration.
  - `spatial-index.ts` — `GridSpatialIndex` (grid bucket spatial index) + `createSpatialIndex` factory.
  - `spatial-operations.ts` — thin pure-function wrappers delegating to `@mog/drawing-engine` (z-order, grouping, hit test, align/distribute, anchor resolve, snap).
  - `ink-computation.ts` — thin pure-function wrappers delegating to `@mog/ink-engine`/`@mog/geometry` (stroke create/smooth/simplify/erase/intersect, stroke→SVG path, stroke→drawing object).
  - `ink-recognition-bridge.ts` — local geometric shape-recognition algorithms + browser Handwriting-API text recognition, exposed as `IInkRecognitionBridge`.
  - `ink/ink-spatial-index.ts` — `InkBoundingBox`, `ISpatialIndex` interface, bounds math, point/stroke distance + hit utilities.
  - `ink/ink-tool-defaults.ts` — per-tool default width/opacity/color/pressure constants + `SHAPE_RECOGNITION_THRESHOLDS`.
  - `ink/ink-schema-defaults.ts` — storage `Schema` definitions (stroke, drawing, tool-state, recognized shape/text) + schema utility helpers.
  - `ink/index.ts` — barrel for the `ink/` subfolder.

This plan does not modify production code; it specifies the changes to be made and the gates to prove them. It is a production-path plan, not a test-only or shim plan.

## Current role of this folder in Mog

This is the **kernel-side, app-agnostic domain layer for hand-drawn ink and drawing floating objects**. It sits between:

- **Contracts** (`@mog-sdk/contracts/ink`, `@mog-sdk/contracts/bridges`, `@mog-sdk/contracts/store`, `@mog-sdk/contracts/floating-objects`) which define the types/interfaces, and
- **The worksheet API layer** (`mog/kernel/src/api/worksheet/operations/drawing-operations.ts`, `drawing-collection-impl.ts`, `objects.ts`) which orchestrates persistence through `ComputeBridge` and the floating-object store.

Confirmed consumers:
- `api/worksheet/operations/drawing-operations.ts` imports `createDrawing`, `addStrokeToDrawing`, `eraseStrokesFromDrawing`, `clearDrawingStrokes`, `serializeStrokesMap`, `serializeRecognitionsMap`, `findStrokesAtPoint`, `invalidateSpatialIndex`.
- `context/kernel-context.ts`, `api/worksheet/objects.ts`, `api/worksheet/collections/drawing-collection-impl.ts` consume domain exports.
- `apps/spreadsheet/.../object-simulator.ts` and `testing-foundation/sheet-simulator.ts` reference the recognition/drawing surface.

Responsibilities: convert raw pointer strokes into persisted `DrawingObject`s (Maps of strokes serialized to plain Records for CRDT storage), provide spatial hit-testing for erase/lasso/rect selection, supply tool defaults and storage schemas, wrap the lower-level `@mog/drawing-engine` and `@mog/ink-engine` for spatial/geometry math, and recognize freehand strokes as shapes or text.

The code is structurally clean (pure functions, "reads direct / writes orchestrated") but carries several correctness and architecture-debt issues described below.

## Improvement objectives

1. **Make the spatial-index cache correct and leak-free.** The current `spatialIndexCache` is a process-global `Map<string, ISpatialIndex>` keyed only by drawing id, invalidated only by explicit `invalidateSpatialIndex` calls. This is stale-prone under collaboration and never evicted on drawing deletion or document close.
2. **Remove non-determinism from the write path.** `generateObjectId()` and every `updatedAt: Date.now()` embed wall-clock and `Math.random()` directly in the kernel domain, which is hostile to deterministic replay, undo/redo, and CRDT convergence.
3. **Eliminate the placeholder-anchor failure mode.** `normalizePosition` can persist a drawing anchored to `toCellId('__placeholder__')` with only a `console.warn`, producing an un-resolvable anchor.
4. **Centralize and type drawing serialization** so the Map↔Record round-trip is defined once (not duplicated across `drawing-manager.ts` and the worksheet operations layer) and is type-checked rather than passed as `unknown`.
5. **Decouple text recognition from the browser global** and make `recognizeText` safe in non-DOM environments (worker/SSR/Node) instead of throwing `ReferenceError`.
6. **Reconcile the two recognition-threshold sources** (`SHAPE_RECOGNITION_THRESHOLDS` vs `DEFAULT_RECOGNITION_THRESHOLDS`) and the internal hard-coded `< 0.3` cutoffs, and address the worst recognizer correctness gaps.
7. **Resolve the duplicated spatial-index implementations** (kernel `GridSpatialIndex` vs `@mog/ink-engine`'s `createSpatialIndex`, both re-exported from the same domain barrel) so consumers have one clear choice.
8. **Harden geometric edge cases** (degenerate/huge stroke bounds, lasso containment, stable stroke ordering).

These are ordered by production impact: 1–5 are correctness/robustness; 6–8 are quality and maintainability.

## Production-path contracts and invariants to preserve or strengthen

- **`DrawingObject` in-memory shape uses `Map`; storage uses `Record`.** The Map↔Record boundary (`serializeStrokesMap`, `serializeRecognitionsMap`, and the inverse `toDrawingObject` in `floating-object-mapper.ts`) must remain the single source of truth. Strengthen by adding one `serializeDrawingObject` that produces exactly the `DRAWING_OBJECT_SCHEMA`-shaped storage object.
- **`DRAWING_OBJECT_SCHEMA` / `INK_STROKE_SCHEMA` / `INK_TOOL_STATE_SCHEMA` field names and `valueType`s** are the storage contract for CRDT (`Y.Map`/`Y.Array`). Any new serialization must emit exactly these fields. Do not rename or drop fields.
- **`IInkRecognitionBridge`** (in `contracts/src/bridges/ink-recognition-bridge.ts`) is the public interface; method signatures (`recognizeShape`, `recognizeText`, `isShape/TextRecognitionAvailable`, `set/getThresholds`, `destroy`) and `RecognitionThresholds` keys must be preserved. Threshold reconciliation must keep `DEFAULT_RECOGNITION_THRESHOLDS` as the contract default.
- **`ISpatialIndex`** interface (insert/remove/update/query/queryPoint/queryNearest/clear/size/bulkInsert) is the shared spatial contract; preserve method shapes so both kernel and engine implementations stay swappable.
- **`isDrawing` type guard** and the read-only query functions (`getDrawingById`, `getDrawingsInSheet`, `findStrokesAtPoint`, `findStrokesInLasso`, `findStrokesInRect`, `getOrderedStrokes`) are consumed by the worksheet layer; keep their signatures stable.
- **Purity invariant:** `drawing-operations.ts` is documented as "Read-Only, Universal" and `ink-computation.ts`/`spatial-operations.ts` as stateless wrappers. The only mutable state in the folder is `spatialIndexCache`; the refactor must not introduce additional hidden global state.
- **App-agnostic invariant:** the `domain` layer must not hard-depend on the DOM. Today `ink-recognition-bridge.ts` reads `window`/`window.Handwriting` directly — this violates the invariant and must move behind an injected port.

New invariants to introduce:
- **Stable stroke ordering:** ordered iteration must be a total order (no ties), so render z-order is deterministic for strokes created in the same millisecond.
- **No placeholder anchors persisted:** creating a drawing without a resolvable anchor is a hard error, not a warning.
- **Bounded spatial-index entries:** a cached index entry is keyed by both drawing id and a content version so it can never serve stale results.

## Concrete implementation plan

### Step 1 — Inject identity and clock into the write path (`drawing-manager.ts`)

- Add an injected `DrawingClock`/`IdGenerator` dependency rather than calling `Date.now()`/`Math.random()` inline. Concretely:
  - Replace the private `generateObjectId()` with an `idGenerator: () => string` parameter on `createDrawing` (mirroring the existing optional `nameGenerator`), defaulting—if the kernel already exposes one—to the kernel's canonical id source rather than `Date.now()+Math.random()`.
  - Replace each `updatedAt: Date.now()` in `addStrokeToDrawing`, `eraseStrokesFromDrawing`, `clearDrawingStrokes`, `updateDrawingToolState`, `addRecognitionToDrawing`, `removeRecognitionFromDrawing` with a `now: number` argument threaded from the caller (the worksheet operations layer already runs inside a kernel transaction that has a timestamp).
- Update the only production caller, `api/worksheet/operations/drawing-operations.ts`, to pass the kernel's transaction id/clock. This keeps the helpers pure and deterministic.
- Rationale: `drawing-${Date.now()}-${random}` can collide under rapid creation and is irreproducible; deterministic ids/timestamps are required for replay, undo, and multi-client convergence.

### Step 2 — Make spatial-index caching version-aware and lifecycle-bound (`drawing-operations.ts`)

- Change `spatialIndexCache` value type to `{ version: number | string; index: ISpatialIndex }`.
- `getSpatialIndex(drawing)` must compare a cheap content version derived from the drawing (e.g. `drawing.updatedAt` plus `drawing.strokes.size`, or a monotonically-incremented stroke revision if one is added in Step 1). If the cached version differs from the current drawing, rebuild instead of returning the stale index. This fixes the collaboration bug where a remote stroke add updates `drawing.strokes` without any local `invalidateSpatialIndex` call.
- Add explicit eviction: expose/keep `invalidateSpatialIndex(id)` (already called from move/transform/add/erase) **and** ensure drawing deletion evicts the cache. Wire an eviction call from the floating-object delete path (worksheet layer) so deleted-drawing entries don't leak for the life of the process.
- Keep `clearSpatialIndexCache()` for document teardown and ensure the kernel document close path calls it.
- Guard `getSpatialIndex` against being keyed across documents: include the `sheetId`/`containerId` in the cache key (`${sheetId}:${id}`) to prevent any cross-document id reuse from colliding.

### Step 3 — Replace the placeholder-anchor fallback (`drawing-manager.ts`)

- In `normalizePosition`, when no `from` anchor is supplied and no `resolver` is available, **throw a typed `KernelError`** (reuse the `errors/api` family used by the worksheet ops, e.g. a `drawingAnchorUnresolved` error) instead of fabricating `toCellId('__placeholder__')` and emitting `console.warn`.
- Remove the `console.warn` from the kernel domain entirely.
- Confirm the production caller always supplies either `position.from` or a resolver (it currently passes `null` resolver but always provides `position.from`); document this precondition in the function contract.

### Step 4 — Centralize drawing serialization (`drawing-manager.ts`)

- Add `serializeDrawingObject(drawing: DrawingObject): <storage shape>` that returns exactly the `DRAWING_OBJECT_SCHEMA`-shaped object (spreads scalar fields, converts `strokes` and `recognitions` Maps via the existing `serializeStrokesMap`/`serializeRecognitionsMap`). Type the return against the schema rather than `unknown`.
- Replace the duplicated inline `storageObj = { ...drawing, strokes: ..., recognitions: ... }` blocks in both `createDrawing` (drawing-manager.ts) and `persistDrawing` (worksheet operations) with calls to this one function.
- Co-locate the inverse expectation: add a doc reference (and, if cheaply feasible, a shared type) tying `serializeDrawingObject` to `toDrawingObject` in `floating-object-mapper.ts` so the round-trip stays symmetric.

### Step 5 — Decouple text recognition from the DOM (`ink-recognition-bridge.ts`)

- Introduce a `HandwritingRecognitionPort` (injected) that abstracts the browser Handwriting API. The kernel domain depends on the port interface; the DOM-backed implementation lives in the app/shell layer and is injected via the existing bridge-construction path. This restores the "app-agnostic domain" invariant.
- Until/unless the port is wired, **at minimum** fix the immediate bug: `recognizeText` calls `'Handwriting' in window` without first checking `typeof window !== 'undefined'`, so it throws `ReferenceError` in non-DOM contexts even though `isTextRecognitionAvailable()` guards correctly. Make `recognizeText` short-circuit through the same guard as `isTextRecognitionAvailable()`.
- Keep `isShapeRecognitionAvailable() === true` (local algorithms) and the synchronous shape path unchanged.

### Step 6 — Reconcile recognition thresholds and gating

- There are two unrelated threshold objects: `SHAPE_RECOGNITION_THRESHOLDS` (in `ink/ink-tool-defaults.ts`: `line`, `rectangleAngle`, `ellipse`, `minConfidence`, `multiStrokeWindow`, …) and `DEFAULT_RECOGNITION_THRESHOLDS` (in contracts: per-shape confidence 0.5–0.7). The bridge uses only the contracts one; `SHAPE_RECOGNITION_THRESHOLDS` is effectively dead config that misleads readers.
  - Either wire `SHAPE_RECOGNITION_THRESHOLDS` (the geometric tuning constants like `minStrokeLength`, `multiStrokeWindow`, corner-angle tolerance) into the analyzer functions that currently hard-code `20`, `0.3`, `Math.PI/4`, etc., **or** delete the unused entries. Do not leave two parallel, divergent configs.
- The analyzers reject below a hard-coded `confidence < 0.3` then the bridge re-checks against the public threshold (0.6–0.7). The intermediate 0.3 cutoff is invisible to `setThresholds` callers — lowering a public threshold below 0.3 cannot take effect. Make the single gate the public per-type threshold (or document the 0.3 floor as an explicit constant) so threshold tuning behaves as the contract promises.

### Step 7 — Address the worst recognizer correctness gaps

- **Corner detection** (`findCorners`) iterates `i = 2 .. length-3`, so corners at the very start/end of a stroke (common when a rectangle is drawn starting on a corner) are never detected, biasing rectangle/triangle confidence down. Extend to consider wrap-around for closed strokes.
- **Rotation hard-coded to 0** for rectangle (`// Could compute rotation from corners`) and triangle — compute orientation from the detected corners so recognized shapes match the drawn orientation.
- **Multi-stroke coverage:** only rectangle and star are analyzed for multi-stroke input; line/ellipse/triangle/arrow are silently single-stroke-only. Document this limitation explicitly and, where cheap, extend (e.g. ellipse from combined points).
- These are quality improvements; gate them behind the recognition test suite below and do not regress existing recognized-shape behavior the snapshot tests rely on.

### Step 8 — Resolve duplicated spatial indexes

- The domain barrel (`index.ts`) re-exports both `createSpatialIndex` (kernel `GridSpatialIndex`, `spatial-index.ts`) and `createInkSpatialIndex` (from `@mog/ink-engine`, via `ink-computation.ts`). Two spatial indexes from one barrel invites accidental misuse.
- Decide one owner:
  - If `@mog/ink-engine`'s index is the canonical one (it has its own test suite under `mog/canvas/drawing/ink/__tests__/spatial-index.test.ts`), make the kernel domain delegate to it and remove `GridSpatialIndex`, or
  - If the kernel grid index is intentionally the storage-side index, document why and stop re-exporting the engine index from this barrel.
- Either way, the barrel must expose exactly one spatial-index factory to kernel consumers.

### Step 9 — Harden geometry edge cases (`spatial-index.ts`, `drawing-operations.ts`, `ink/ink-spatial-index.ts`)

- **Degenerate/huge bounds:** `GridSpatialIndex.getCellsForBounds` enumerates every 50px cell a bounds overlaps. A stroke spanning thousands of pixels generates thousands of cell keys (memory blow-up). Add a guard: reject/skip `!isValidBounds(bounds)` before insertion, and cap or special-case strokes whose cell count exceeds a threshold (store in an "oversized" overflow list checked on every query).
- **Stable stroke ordering:** `getOrderedStrokes` sorts only by `createdAt`; ties (same-ms strokes) are order-unstable → render flicker. Add a secondary sort key on `stroke.id` for a total order.
- **Lasso containment:** `findStrokesInLasso` / `isStrokeInPolygon` only test whether any stroke *point* lies inside the polygon. Strokes whose segments cross the polygon without a vertex inside, and large strokes that fully enclose the lasso, are missed. Use segment-vs-polygon intersection (the existing `pointToSegmentDistanceSquared` / ray-cast helpers can be composed) for correct lasso selection.

### Sequencing

Steps 1–5 are independent and can land in parallel. Step 4 depends lightly on Step 1 (shared `now`/id threading). Step 6 precedes Step 7 (gating must be correct before tuning analyzers). Steps 8 and 9 are independent of the rest.

## Tests and verification gates

Existing suites that must stay green (do not modify them as part of the production change beyond additions):
- `mog/kernel/src/bridges/__tests__/ink-recognition-bridge.test.ts` — recognition thresholds/results.
- `mog/kernel/src/domain/shapes/__tests__/shape-computation-e2e.test.ts`.
- `mog/kernel/src/api/__tests__/worksheet-impl.test.ts`, `worksheet-impl-extended.test.ts` — drawing creation/stroke ops through the API.
- `mog/canvas/drawing/ink/__tests__/spatial-index.test.ts` — engine spatial index (relevant to Step 8).

New tests to add (production-path, not workarounds):
1. **Spatial cache staleness (Step 2):** build a drawing, query `findStrokesAtPoint`, then add a stroke to a *new `DrawingObject` instance with the same id* without calling `invalidateSpatialIndex`, and assert the query reflects the new stroke (version-aware rebuild).
2. **Cache eviction (Step 2):** assert a deleted-drawing id no longer holds a cache entry, and `clearSpatialIndexCache` empties it.
3. **Deterministic write path (Step 1):** with an injected fixed clock + id generator, assert `createDrawing` / `addStrokeToDrawing` produce identical objects across runs (stable id and `updatedAt`).
4. **Anchor failure (Step 3):** `createDrawing` with no `from` and no resolver throws the typed error (no `__placeholder__` object persisted, no `console.warn`).
5. **Serialization round-trip (Step 4):** `serializeDrawingObject` → `toDrawingObject` returns a structurally-equal `DrawingObject`; emitted keys exactly match `DRAWING_OBJECT_SCHEMA`.
6. **Non-DOM `recognizeText` (Step 5):** with `window` undefined, `recognizeText` returns `null` (no throw); `isTextRecognitionAvailable()` returns `false`.
7. **Threshold tuning (Step 6):** lowering a per-shape threshold via `setThresholds` actually changes the recognized result for a borderline stroke.
8. **Recognizer corners/rotation (Step 7):** a rectangle drawn starting on a corner is recognized; a rotated rectangle reports non-zero rotation.
9. **Stable ordering (Step 9):** strokes with identical `createdAt` return in a deterministic id order.
10. **Lasso/oversized bounds (Step 9):** a stroke crossing the lasso without an interior vertex is selected; an oversized stroke does not balloon the grid.

Verification gates (run by the implementer, not by this planning worker):
- Typecheck the kernel package and contracts consumers (recall: editing contracts types requires building `@mog-sdk/contracts` before consumers typecheck — see the contracts declaration-rollup note).
- Run the kernel unit suite and the ink-recognition + spatial-index suites.
- Run the relevant `app-eval`/`api-eval` drawing scenarios if any exercise ink creation/erase end-to-end.

## Risks, edge cases, and non-goals

**Risks**
- **Threading `now`/`idGenerator` through callers (Step 1)** touches the public-ish `createDrawing` signature in the domain and its one worksheet caller. Keep the new params optional with safe defaults to avoid breaking other call sites; verify there are no additional callers before changing arity.
- **Recognition tuning (Steps 6–7)** can shift which shapes are recognized; existing recognition tests encode current behavior. Treat any intended behavior change as a deliberate, reviewed snapshot update, not an incidental regression.
- **Spatial-index consolidation (Step 8)** could change performance characteristics; benchmark erase/lasso on a large drawing before/after.
- **Version-aware cache (Step 2)** must use a cheap version signal; computing a hash over all strokes on every query would defeat the cache's purpose — use `updatedAt`+size or an explicit revision counter.

**Edge cases to cover**
- Empty-points strokes (already yield `EMPTY_BOUNDING_BOX`; ensure they are skipped, not inserted with `Infinity` coords).
- Single-point strokes (distance path special-cased in `pointToStrokeDistance`).
- Drawings with zero strokes (`computeStrokesBounds` returns empty bounds; hit-testing fallback in `getDrawingAtPoint`).
- Same-millisecond stroke creation (ordering stability).
- Non-DOM execution (worker/SSR) for recognition.

**Non-goals**
- No change to the CRDT/storage wire format or `DRAWING_OBJECT_SCHEMA` field names/`valueType`s (compatibility-preserving only).
- No new drawing tools, no rendering changes (SVG path generation stays in `ink-computation.ts` delegating to the engine).
- No UI/app-layer work beyond injecting the recognition port and updating the one worksheet operations caller.
- Not a rewrite of `@mog/ink-engine` or `@mog/drawing-engine`; those are separate folders consumed here.

## Parallelization notes and dependencies on other folders

- **Within this folder:** Steps 1–5 parallelizable; 6→7 and the Step-8/Step-9 work are independent tracks.
- **`mog/kernel/src/api/worksheet/operations/drawing-operations.ts`** (folder 084-adjacent worksheet ops) must be updated in lockstep for Steps 1, 3, 4 (passing clock/id, handling the new anchor error, using `serializeDrawingObject`). Also the floating-object delete path must call cache eviction (Step 2).
- **`mog/contracts/src/bridges/ink-recognition-bridge.ts`** — Step 5 may add a `HandwritingRecognitionPort` type here (contracts change → rebuild `@mog-sdk/contracts` before consumers typecheck).
- **`@mog/ink-engine` (`mog/canvas/drawing/ink`)** — Step 8 consolidation decision depends on whether the engine index becomes canonical; coordinate with that folder's owners.
- **`floating-object-mapper.ts`** (kernel floating-objects domain) holds the inverse `toDrawingObject`; Step 4 must keep it symmetric with the new `serializeDrawingObject`.
- No dependency on the pre-existing dirty/untracked paths listed for this run; this plan touches none of them.
