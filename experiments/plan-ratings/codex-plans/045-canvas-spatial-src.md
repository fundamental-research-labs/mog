# 045 - canvas/spatial/src Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/spatial/src`

Scope reviewed:

- `types.ts`: `SpatialEntry<T>`, `SpatialIndex<T>`, and `NarrowPhaseTest<T>` public contracts.
- `grid-index.ts`: sparse grid implementation, oversized-entry fallback, point and rectangle queries, update/remove/all/clear APIs.
- `pipeline.ts`: broad-phase plus optional narrow-phase hit testing, rectangle selection, and proximity search.
- `canvas-hit-test.ts`: Canvas2D/OffscreenCanvas Path2D helpers that reset transforms before hit testing.
- `index.ts`: package exports for `@mog/spatial`.

Observed production consumers:

- `canvas/drawing-canvas/src/hit-testing/hit-map.ts` uses `createSpatialIndex`, `hitTestPipeline`, and `testPointInPath` for drawing-object hit tests.
- `charts/src/primitives/renderer/hit-tester.ts` uses `createSpatialIndex` and `findNearby` for chart mark picking.
- `canvas/overlay/src/handle-hit-testing.ts` uses `testPointInPath` for selection handles.
- `canvas/drawing/ink/src/spatial-index.ts` re-exports `@mog/spatial` as the canonical ink-engine spatial index.
- `kernel/src/domain/drawing/spatial-index.ts` still has a separate min/max ink spatial index with string cell keys and a different interface.

## Current role of this folder in Mog

`@mog/spatial` is the shared TypeScript spatial indexing and hit-test acceleration package for canvas-facing object interaction. Its current responsibilities are:

- Maintain an incremental sparse grid from stable object IDs to axis-aligned `BoundingBox` entries.
- Provide fast broad-phase point, rectangle, and radius candidate lookup for drawings, ink, and charts.
- Provide a reusable hit-test pipeline that sorts broad-phase candidates by caller-supplied z-index and runs optional narrow-phase geometry checks.
- Centralize Canvas2D Path2D hit-test helpers that neutralize current canvas transforms before calling `isPointInPath` or `isPointInStroke`.

The package is pure TypeScript except for Canvas2D type usage in `canvas-hit-test.ts`. It currently depends only on `@mog-sdk/contracts`, while nearby consumers and `@mog/geometry` already define matching point-in-rect, inclusive intersection, containment, and distance helpers.

## Improvement objectives

1. Make `@mog/spatial` a collision-free production index for the full document/world coordinate range, not only cell coordinates that fit into 16 bits.
2. Specify and enforce the bounding-box contract: finite `x/y/width/height`, non-negative dimensions, negative coordinates allowed, zero-size boxes allowed, and inclusive point/edge hit semantics where the current tests already require them.
3. Replace accidental implementation behavior with explicit contracts for oversized entries, oversized queries, duplicate IDs, update semantics, stable hit priority, and query result determinism.
4. Use one canonical set of geometry semantics for point containment, inclusive rectangle intersection, containment, and point-to-rect distance.
5. Strengthen the Canvas Path2D helpers so they always restore context state and support the fill/stroke options needed by real shape hit testing.
6. Reduce production duplication by making canvas-facing drawing, ink, and chart hit testing compose through `@mog/spatial`; treat the kernel ink index as a package-boundary decision, not an implicit dependency shortcut.
7. Add oracle-based tests that prove correctness across large coordinates, negative coordinates, zero-size entries, edge-touching boxes, oversized entries, and random mutation/query sequences.

## Production-path contracts and invariants to preserve or strengthen

- `SpatialIndex<T>` entries are keyed by unique string IDs. Inserting an existing ID replaces its data and bounds atomically and leaves no stale grid cells.
- Bounds are document/world-space axis-aligned boxes using `@mog-sdk/contracts/geometry` `BoundingBox`.
- Valid bounds have finite coordinates and finite non-negative dimensions. `width === 0` and `height === 0` are valid point/line-like boxes; negative dimensions are invalid and should fail fast before reaching cell enumeration.
- Negative `x` and `y` coordinates are valid and must index/query correctly.
- Large coordinates are valid. Cell-key generation must be collision-free for coordinates beyond `[-32768, 32767]`.
- Point containment is inclusive: points on `x`, `x + width`, `y`, or `y + height` count as hits.
- Rectangle `query()` uses inclusive edge-touching intersection because existing `canvas/spatial` tests assert that touching edges intersect. This is different from `@mog/geometry` `Rect.overlaps()`, which uses non-empty intersection through `intersection()`.
- Rectangle `selectInRect(..., 'contains')` returns only entries fully contained by the selection rectangle, using the same inclusive boundary convention as existing tests.
- `findNearby()` returns entries whose bounding-box edge distance is within the radius, sorted by ascending distance; entries containing the point have distance `0`.
- Oversized entries are always queryable, including by point queries, without enumerating unbounded cell ranges.
- Oversized queries remain correct and may fall back to scanning indexed entries, but the fallback threshold must be explicit and tested.
- `hitTestPipeline()` must return the visually topmost accepted candidate. Equal-priority ties should be deterministic and caller-controlled or documented.
- `testPointInPath()` and `testPointInStroke()` must preserve canvas context state even if the underlying Canvas2D call throws.
- `@mog/spatial` must not depend on private/internal code, and no public package may depend on `mog-internal`.

## Concrete implementation plan

1. Define the spatial geometry contract in code.
   - Add internal helpers for `assertValidBounds`, `assertValidPoint`, `containsPointInclusive`, `intersectsInclusive`, `containsBoundsInclusive`, and `distanceToBounds`.
   - Prefer importing `pointInRect`, `rectIntersects`, `rectContains`, and `distanceToRect` from `@mog/geometry` if package ownership accepts `@mog/spatial -> @mog/geometry`; otherwise keep equivalent helpers local and document that their semantics mirror `@mog/geometry` primitives, not `Rect.overlaps()`.
   - Export a small `normalizeBoundsFromCorners()` helper only if callers currently pass drag rectangles that can have negative width/height. Keep `SpatialIndex` itself strict: invalid boxes should not be silently indexed.

2. Replace the packed numeric cell key.
   - Remove `packCellKey(cellX, cellY)` because it masks both coordinates to 16 bits and can collide for cells separated by `65536`.
   - Use a collision-free cell storage model: either `Map<number, Map<number, Set<string>>>` keyed by numeric `cellX` then `cellY`, or a dedicated string key with no coordinate truncation. Prefer nested numeric maps for explicit unbounded integer coordinates and easier diagnostics.
   - Add a `CellRange` helper that computes min/max cells once from valid bounds and can separately enforce insert and query thresholds.
   - Store each indexed entry's current cell membership or oversized status so remove/update never recomputes from stale or invalid state and can clean cells precisely.

3. Make index operations atomic and explicit.
   - Introduce `upsert(id, bounds, data)` or redefine `insert()` as the documented atomic replacement path and implement it through one shared replacement routine.
   - Add `update(id, bounds, data)` if production consumers need metadata changes without remove-plus-insert. Update `HitMap.updateInIndex()` and dirty-sync code to use the atomic API once it exists.
   - Keep `updateBounds(id, bounds)` as a bounds-only operation only if there is a real caller; otherwise replace it with the clearer atomic update contract.
   - Add optional `has(id)` and `get(id)` only if consumers need them for correctness; avoid convenience APIs that do not remove duplication or strengthen contracts.

4. Separate oversized-entry and oversized-query thresholds.
   - Replace private constants with `GridSpatialIndexOptions`:
     - `cellSize`
     - `maxCellsPerEntry`
     - `maxCellsPerQuery`
   - Validate `cellSize > 0` and finite.
   - Ensure query enumeration uses `maxCellsPerQuery`, not the entry threshold. The current `query()` path can treat a query spanning more than `MAX_CELLS` but not more than `MAX_QUERY_CELLS` as a full scan because `getCellsForBounds()` is tied to the entry threshold.
   - Keep oversized entries in a separate set/map and always include them in point and rectangle queries.

5. Make query output and hit priority deterministic.
   - Preserve deterministic query order by tracking insertion sequence on entries and using it consistently when returning `all()`, `query()`, and `queryPoint()` if callers rely on stable ordering.
   - Replace `hitTestPipeline(index, point, getZIndex, narrowPhase?)` with an options shape that can accept either `getZIndex` plus stable tie-break behavior or a full comparator.
   - Keep topmost-first behavior for drawing-canvas. For equal z-index objects, use caller-provided render/order metadata where available; otherwise use insertion sequence and document it.

6. Harden Canvas2D Path2D hit-test helpers.
   - Wrap `save/resetTransform/isPointInPath|isPointInStroke/restore` in `try/finally` so context state is restored on exceptions.
   - Add `fillRule?: CanvasFillRule` support for `testPointInPath` because compound paths and holes need explicit nonzero/evenodd behavior.
   - Add a documented stroke option path if callers need to set stroke width or line joins before `isPointInStroke`; do not hide context mutation inside the helper.
   - Keep coordinates explicit: helpers receive coordinates in the same coordinate space as the `Path2D` after transform reset.

7. Consolidate production consumers without crossing architecture boundaries blindly.
   - Update `canvas/drawing-canvas` `HitMap` to use the atomic update API and deterministic priority contract. Keep the real UI input path intact: screen point -> viewport transform -> document point -> spatial pipeline -> narrow phase.
   - Keep `canvas/overlay` on `testPointInPath`, but add coverage for context restoration and fill-rule behavior if overlay paths need it.
   - Update `charts` hit testing to rely on the strengthened `findNearby()` contract and add tests for zero-radius, radius, and large-coordinate marks.
   - Keep `canvas/drawing/ink/src/spatial-index.ts` as a thin re-export if it remains the compatibility entrypoint for ink-engine.
   - For `kernel/src/domain/drawing/spatial-index.ts`, do not simply import a canvas-layer package into kernel unless package ownership approves it. Either keep it as a separate kernel implementation with matching tests, or extract a lower-level pure spatial core if kernel and canvas both need the same implementation.

8. Add diagnostics and observability hooks where useful.
   - Export or expose debug-only snapshots for indexed entry count, oversized count, populated cell count, and max bucket size if consumers need performance diagnostics.
   - Ensure diagnostics do not become production dependencies for hot path queries.
   - Align `canvas/drawing/ink/src/diagnostics.ts` index validation with the strengthened bounds contract.

## Tests and verification gates

Add or update tests before changing consumers:

- `canvas/spatial/__tests__/grid-index.test.ts`
  - collision regression: two entries in cells whose coordinates differ by `65536` must not collide.
  - large positive and negative world coordinates.
  - finite/non-finite bounds validation.
  - negative width/height rejection.
  - zero-size point and line boxes remain queryable.
  - duplicate ID replacement updates both data and bounds.
  - normal-to-oversized, oversized-to-normal, and oversized-to-oversized updates.
  - query threshold path uses `maxCellsPerQuery`, not `maxCellsPerEntry`.
  - randomized differential tests comparing index output to a linear oracle for insert/remove/update/query/queryPoint.
- `canvas/spatial/__tests__/pipeline.test.ts`
  - deterministic z-order with equal z-index ties.
  - narrow-phase rejection continues to the next candidate.
  - `findNearby()` radius sorting and zero-distance behavior across overlapping boxes.
  - inclusive selection behavior at edges.
- `canvas/spatial/__tests__/canvas-hit-test.test.ts`
  - `restore()` runs through `finally` when `isPointInPath` or `isPointInStroke` throws.
  - `fillRule` is forwarded to `isPointInPath`.
  - transform reset order remains `save -> resetTransform -> hit test -> restore`.
- Consumer tests:
  - `canvas/drawing-canvas/__tests__/hit-map.test.ts` for dirty sync, visibility, path narrow phase, and equal z-index priority through the production HitMap path.
  - `charts` hit-tester tests for exact point and radius picking after the stronger index contract.
  - `canvas/overlay` handle hit-testing tests for Path2D helper behavior if fill rules or context restoration affect handle paths.
  - `canvas/drawing/ink` spatial-index re-export tests should either be deduplicated against `canvas/spatial` fixtures or kept as package-boundary smoke tests.

Verification gates for the eventual implementation:

- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/spatial && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/spatial && pnpm typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/drawing/ink && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/drawing-canvas && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/canvas/overlay && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/charts && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm typecheck`
- For UI-affecting hit-test changes, run the spreadsheet/dev app and exercise real pointer input paths for selecting drawing objects, selecting handles, and chart picking. E2E coverage should drive keyboard/mouse/clipboard events through the UI, not mutate state directly.

This planning worker did not run these gates because the task explicitly disallowed test, build, typecheck, and verification commands.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Changing rectangle intersection semantics can alter selection. Preserve `@mog/spatial` inclusive edge-touching behavior unless a broader product contract explicitly changes it.
- Adding an `@mog/geometry` dependency to `@mog/spatial` is architecturally reasonable only if `@mog/geometry` is treated as a lower-level pure geometry package. If that dependency direction is disputed, keep helpers local and document semantic parity.
- Stable hit priority needs caller data. A package-level insertion-order tie-break is deterministic but may not match visual order if the consumer omits render-order metadata.
- Strict invalid-bound rejection can surface existing caller bugs. That is desirable, but the implementation should first add tests and update known callers that may generate drag rectangles with negative dimensions.
- Very large coordinates can still produce very large cell ranges. The plan preserves correctness through thresholded oversized handling and full-scan fallback, not unbounded enumeration.
- `Path2D` behavior is browser/canvas implementation dependent. Unit tests can verify wrapper contracts, but real hit behavior still needs browser exercise for UI paths.

Non-goals:

- Do not optimize a benchmark-only or test-only path; changes must hit the production `@mog/spatial` package and its real consumers.
- Do not introduce a temporary compatibility shim that preserves the 16-bit packed-key limitation.
- Do not make `mog` depend on `mog-internal`.
- Do not silently normalize invalid negative dimensions inside `SpatialIndex` inserts. Normalize gesture rectangles at caller boundaries; keep the index contract strict.
- Do not migrate kernel drawing to `@mog/spatial` unless package layering is explicitly resolved.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contracts above are accepted:

- Agent A: implement and test the `GridSpatialIndex` keying, validation, oversized thresholds, and oracle tests in `canvas/spatial`.
- Agent B: implement and test pipeline priority/options and proximity/selection semantics in `canvas/spatial`.
- Agent C: harden `canvas-hit-test.ts` and update overlay/drawing-canvas tests for Path2D helper behavior.
- Agent D: update drawing-canvas and charts production consumers to the strengthened API and verify their package tests.
- Agent E: audit kernel drawing spatial index and ink-engine diagnostics for semantic alignment, then either keep explicit parity tests or propose a lower-level extracted spatial core.

Dependencies:

- `@mog-sdk/contracts/geometry` remains the public type source for `BoundingBox` and `Point2D`.
- `@mog/geometry` is the likely source for canonical pure geometry helpers if dependency direction is approved.
- `canvas/drawing-canvas`, `canvas/overlay`, `canvas/drawing/ink`, and `charts` are direct production consumers that must be verified with package tests after API changes.
- `kernel/src/domain/drawing` has a similar but separate spatial index; any consolidation must respect kernel/package layering rather than importing canvas code by convenience.
