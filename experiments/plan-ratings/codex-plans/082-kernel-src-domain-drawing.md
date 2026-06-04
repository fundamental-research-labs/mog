# Improve `mog/kernel/src/domain/drawing`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/drawing`

Queue scope: kernel drawing object domain behavior.

This plan covers the TypeScript source under `kernel/src/domain/drawing`:

- `drawing-manager.ts`: drawing object creation, stroke mutation helpers, tool state helpers, recognition result helpers, and storage serialization.
- `drawing-operations.ts`: read/query helpers, spatial index caching, hit testing, lasso/rectangle selection, bounds, Bezier control points, pressure detection, drawing hit tests, and stroke ordering.
- `spatial-index.ts` and `ink/ink-spatial-index.ts`: grid index implementation, ink bounding boxes, point/stroke distance utilities, and hit predicates.
- `ink-recognition-bridge.ts`: local shape recognition and browser handwriting recognition bridge.
- `ink-computation.ts`: kernel adapters around `@mog/ink-engine` and `@mog/geometry`.
- `spatial-operations.ts`: kernel adapters around `@mog/drawing-engine` for z-order, grouping, hit testing, selection, anchors, snapping, alignment, and distribution.
- `ink/ink-tool-defaults.ts` and `ink/ink-schema-defaults.ts`: runtime defaults and schema metadata exported through `@mog-sdk/kernel/internal`.
- `index.ts` and `ink/index.ts`: package-local public surface for this domain folder.

Required integration context:

- `kernel/src/api/worksheet/operations/drawing-operations.ts`, `kernel/src/api/worksheet/objects.ts`, `kernel/src/api/worksheet/collections/drawing-collection-impl.ts`, and `kernel/src/api/worksheet/handles/drawing-handle-impl.ts`, which expose the production worksheet drawing API.
- `kernel/src/bridges/compute/floating-object-mapper.ts` and `kernel/src/bridges/compute/compute-types.gen.ts`, which convert persisted wire `Record` data into runtime `Map<StrokeId, InkStroke>` drawing objects.
- `kernel/src/context/kernel-context.ts` and workbook APIs, which expose the `IInkRecognitionBridge`.
- `apps/spreadsheet/src/systems/ink` and `apps/spreadsheet/src/actions/handlers/ink.ts`, which drive drawing creation, stroke persistence, erasing, selection, transforms, and recognition from real UI input.
- `canvas/drawing/ink`, `canvas/spatial`, `canvas/drawing/engine`, `types/objects`, `types/bridges`, and `contracts`, which define adjacent geometry, spatial, and public type contracts.

Out of scope for the planning artifact itself: production code edits, test edits, generated output, package metadata, lockfiles, commits, branches, worktrees, or verification commands.

## Current role of this folder in Mog

`kernel/src/domain/drawing` is the kernel's domain layer for spreadsheet ink drawings. It is not a renderer. It defines how drawing floating objects are created, how strokes are stored and queried, how drawing-local geometry is transformed, and how ink is recognized as shapes or text before worksheet/app layers decide what to do with the result.

Observed production path:

1. Spreadsheet UI actions call `ws.drawings.add()` or drawing handles from `WorksheetDrawingCollectionImpl`.
2. `WorksheetObjectsImpl` delegates to `kernel/src/api/worksheet/operations/drawing-operations.ts`.
3. The worksheet operation creates or fetches a `DrawingObject`, applies helpers from `domain/drawing`, serializes `Map` fields into `Record` fields, and persists through `ComputeBridge.setFloatingObject()`.
4. Rust/compute storage remains the persisted source of truth. `floating-object-mapper.ts` maps wire `DrawingData.strokes: Record<string, InkStroke>` and `recognitions: Record<string, RecognitionResult>` back into runtime `Map`s.
5. Ink coordination in the spreadsheet app captures real pointer input, builds `InkStroke` values, injects mutations/queries, and uses `findStrokesAtPoint()` for eraser hit testing.
6. Recognition goes through `workbook.ink`, backed by `createInkRecognitionBridge()` in this folder.

Important current characteristics:

- The intended runtime contract is CRDT-friendly `Map<StrokeId, InkStroke>` for strokes and `Map<string, RecognitionResult>` for recognitions, while persisted/wire data is plain JSON records.
- Strokes use drawing-local CSS pixel coordinates. Object anchoring and sheet-space bounds live in the floating object host contract.
- The folder duplicates spatial types and a grid spatial index even though public `@mog/spatial` and `@mog/ink-engine` also expose spatial indexing.
- `drawing-manager.ts` invalidates the spatial cache for add/erase/clear, but worksheet-level move/transform code mutates strokes outside those helpers and manually invalidates after persistence.
- Drawing creation can fall back to a placeholder `CellId` when no resolver is supplied and the caller did not provide a `from` anchor. The worksheet creation path currently passes `resolver: null` under the assumption that callers provide `position.from`, while spreadsheet ink actions pass only `anchorType`, `x`, `y`, `width`, and `height`.
- The direct test surface for this folder is thin. Existing coverage mainly tests recognition in `kernel/src/bridges/__tests__/ink-recognition-bridge.test.ts`, shape/ink engine integration in `kernel/src/domain/shapes/__tests__/shape-computation-e2e.test.ts`, and handle delegation in `kernel/src/api/worksheet/handles/__tests__/handle-impl.test.ts`.

## Improvement objectives

1. Make drawing creation anchor-safe in the production worksheet path.
   - Remove placeholder anchors from normal drawing creation.
   - Require either a concrete `from` anchor, an explicit absolute anchor, or a resolver-backed conversion from requested sheet pixels to a real `CellId`.
   - Preserve `position` and `anchor` equivalence on every persisted drawing object.

2. Establish a single drawing domain mutation contract.
   - Centralize add, erase, clear, move, transform, tool-state, and recognition mutations in domain helpers instead of splitting geometry mutation across worksheet operations.
   - Return structured mutation results with changed stroke IDs, affected bounds, `updatedAt`, and cache invalidation requirements.
   - Make no-op and missing-stroke behavior explicit.

3. Make serialization and deserialization a verified boundary.
   - Replace scattered record/map conversions and permissive casts with typed `serializeDrawingObject()` and `deserializeDrawingObject()` helpers.
   - Validate finite numeric fields, tool settings, stroke IDs, recognition payloads, and map key consistency before persistence and after wire hydration.
   - Keep transient UI fields such as `selected` out of persisted stroke data.

4. Replace manual spatial cache assumptions with a production cache contract.
   - Use versioned or content-aware index entries so remote hydration, undo/redo, and direct compute updates cannot leave a stale index keyed only by drawing ID.
   - Bound cache lifetime and expose disposal/clear semantics for document close and test isolation.
   - Align the index implementation with `@mog/spatial` or `@mog/ink-engine` through an adapter instead of maintaining a divergent kernel-only grid implementation unless there is a documented kernel-specific reason.

5. Strengthen hit testing and selection semantics.
   - Make point, rectangle, lasso, and nearest-stroke queries precise and mode-explicit.
   - Treat stroke width, pressure policy, zero/one-point strokes, negative coordinates, and non-finite values consistently.
   - Use deterministic stroke ordering when timestamps tie.
   - Use z-index ordering, not array reverse order, for drawing object hit tests.

6. Turn recognition into a production conversion contract.
   - Keep local shape recognition host-safe and deterministic.
   - Make text recognition injectable and browser/API safe.
   - Persist recognition results or convert recognized output into real shape/text objects through the worksheet API, not only app-emitted events.
   - Cover all recognized shape categories systematically instead of tuning isolated examples.

7. Keep kernel drawing adapters narrow and explicit.
   - `ink-computation.ts` should be a clear adapter around `@mog/ink-engine` types, not a second ink model.
   - `spatial-operations.ts` should remain a pure bridge to `@mog/drawing-engine`, with tests proving kernel wrappers preserve engine semantics.
   - Internal schema/default exports should stay exhaustive against public `InkTool` and drawing object contracts.

## Production-path contracts and invariants to preserve or strengthen

- Rust/compute storage remains the persistent source of truth for floating objects.
- Runtime `DrawingObject.strokes` and `DrawingObject.recognitions` are `Map`s; persisted wire data is JSON-compatible `Record`s.
- Every persisted stroke key must match `stroke.id`.
- Stroke IDs remain stable across transforms and are unique within a drawing.
- Strokes are immutable at the domain boundary: updates produce a new `Map` and new stroke records for changed strokes.
- `createdAt`, `createdBy`, tool, color, opacity, pressure, tilt, and timestamp metadata must survive move, rotate, scale, flip, serialize, deserialize, undo, redo, and remote sync.
- `updatedAt` changes for every semantic drawing mutation and does not change for documented no-ops.
- `position` and `anchor` represent the same object position. `sheetId` and `containerId` represent the same sheet.
- Drawing-local coordinates remain drawing-local. Sheet-space conversion belongs to the object host/resolver path, not stroke mutation helpers.
- Spatial indexes never return false negatives for broad-phase queries. Precise hit testing may filter false positives.
- Lasso selection has explicit semantics for points inside the polygon, segments crossing the polygon boundary, and strokes fully enclosing or fully outside the polygon.
- Rectangle selection distinguishes `intersects` and `contains` behavior where callers need both.
- Eraser hit testing uses the same tolerance semantics in app coordination, worksheet query APIs, and domain utilities.
- Drawing object hit tests are deterministic by z-order and stable tie-breaker.
- Shape recognition thresholds are applied per shape type and are not silently shared with unrelated local geometry constants.
- Text recognition does not touch `window` in non-browser hosts.
- Kernel must not depend on `mog-internal`, app UI state, React, DOM-only rendering internals, or private test harnesses.

## Concrete implementation plan

1. Add executable drawing domain contracts first.
   - Add direct tests under `kernel/src/domain/drawing/__tests__` or the repo's established kernel test layout for `drawing-manager`, `drawing-operations`, `spatial-index`, tool defaults, schema defaults, and serializers.
   - Add worksheet operation tests for create, add, erase, clear, move, transform, query, and not-found errors using the production `ComputeBridge`/object-manager shape where possible.
   - Add mapper tests proving wire `Record` data hydrates to runtime `Map`s and serializes back without losing metadata.
   - Add app-level ink tests only where UI behavior is involved; keep domain invariants covered in kernel tests.

2. Introduce a domain-level serialization boundary.
   - Create `drawing-codec.ts` or equivalent in this folder with `serializeDrawingObject()`, `deserializeDrawingObject()`, `serializeStrokesMap()`, `deserializeStrokesRecord()`, `serializeRecognitionsMap()`, and `deserializeRecognitionsRecord()`.
   - Normalize records into `Map`s with branded `StrokeId` keys and reject or diagnose mismatches between record key and `stroke.id`.
   - Validate all stroke points and bounds are finite before inserting into indexes or persisting.
   - Preserve the current compact serialized point format where used by `@mog/spreadsheet-utils/ink/types`, but make conversion explicit and tested.
   - Update `drawing-manager.ts`, worksheet drawing operations, and `floating-object-mapper.ts` to use the same codec.

3. Fix drawing creation anchoring.
   - Replace `normalizePosition()` fallback behavior with an explicit contract:
     - If `position.anchorType === 'absolute'`, allow explicit `x`/`y`/`width`/`height` without a cell anchor.
     - If a cell-anchored drawing has `from`, use and validate it.
     - If a cell-anchored drawing lacks `from`, require a resolver and derive a real `CellId` from requested sheet pixels.
     - If no resolver is available, fail with a kernel error rather than persisting `__placeholder__`.
   - Update worksheet creation to supply the spreadsheet resolver or convert viewport/sheet pixels to a resolved position before calling `createDrawingInternal()`.
   - Update spreadsheet ink actions that create drawings at viewport center so the position represents the actual viewport center and has a real anchor.
   - Add regression tests that no production create path persists `__placeholder__`, `cell-0-0`, or other synthetic fallback anchors unless the object truly anchors there.

4. Centralize stroke mutation helpers.
   - Move `moveDrawingStrokes()` and `transformDrawingStrokes()` logic from worksheet operations into `drawing-manager.ts` or a new `drawing-mutations.ts`.
   - Make every mutation return a result such as `{ drawing, changedStrokeIds, removedStrokeIds, affectedBounds, didChange }`.
   - Preserve all stroke metadata while changing only point coordinates for geometry transforms.
   - Define no-op behavior for empty selections, missing stroke IDs, zero deltas, identity scale, zero rotation, and flips with no valid selected bounds.
   - Update `updatedAt` only when at least one existing stroke changes.
   - Invalidate spatial indexes before exposing the changed drawing, or include invalidation in the structured mutation result so persistence callers cannot forget it.

5. Make transform math complete and safe.
   - Compute transform centers from valid selected stroke bounds using the same `computeStrokesBounds()` helper used elsewhere.
   - Reject or no-op when all selected stroke IDs are missing or all bounds are invalid; do not derive centers from `Infinity`/`-Infinity`.
   - Support rotate, scale, flip-horizontal, and flip-vertical as a systematic category with tests for one-point strokes, multi-point strokes, negative coordinates, pressure/timestamp preservation, and non-uniform scale.
   - Add deterministic handling for stroke order after transforms: render order remains `createdAt`, then stable ID tie-breaker.

6. Replace or adapt the kernel spatial index.
   - Audit the kernel-only `GridSpatialIndex` against `@mog/spatial` and `canvas/drawing/ink/src/spatial-index.ts`.
   - Prefer a thin adapter over the shared `@mog/spatial` `createSpatialIndex<T>()` so point and rectangle query semantics are shared across kernel, canvas, charts, and ink packages.
   - If the kernel keeps a custom index, add contract tests that compare it against the shared index for insert, remove, update, query, queryPoint, queryNearest, bulkInsert, negative coordinates, invalid bounds, and large drawings.
   - Add `DrawingSpatialIndexCache` with explicit `get(drawing)`, `invalidate(drawingId)`, `invalidateIfStale(drawing)`, `clear()`, and `disposeDocument(documentId)` semantics.
   - Tie cache freshness to a drawing revision signal. If no revision exists, derive a cheap signature from `updatedAt`, stroke count, and changed stroke IDs returned by mutations.

7. Strengthen selection and hit algorithms.
   - Update `findStrokesAtPoint()` to use the shared spatial adapter for broad phase and the domain stroke-distance helper for precise phase.
   - Update `findStrokesInRect()` to support both `intersects` and `contains`; keep the existing default only if it is explicitly documented.
   - Update `findStrokesInLasso()` to consider:
     - Any stroke point inside the polygon.
     - Any stroke segment intersecting polygon edges.
     - Optional full-containment mode for future selection behavior.
   - Make `getDrawingAtPoint()` sort or scan by z-index with deterministic tie-breakers instead of assuming caller array order.
   - Add tests for lasso self-intersection policy, degenerate polygons, open strokes crossing the lasso, zero-size bounds, and tolerance extremes.

8. Make recognition host-safe and conversion-ready.
   - Guard all browser access with `typeof window !== 'undefined'`.
   - Introduce an injectable text-recognition provider so tests and non-browser hosts can exercise the bridge without global browser assumptions.
   - Ensure recognizers are closed or disposed if the browser API exposes cleanup.
   - Split local geometry recognizers into pure functions with typed diagnostics for why a candidate was rejected.
   - Add a support matrix for line, rectangle, ellipse, triangle, arrow, and star recognition with thresholds, minimum stroke/point requirements, multi-stroke rules, and expected parameters.
   - Coordinate with worksheet/app code so shape recognition creates real shape objects using worksheet object APIs and records source stroke IDs/undo metadata, rather than only deleting strokes and emitting an app event.
   - Coordinate text recognition so recognized text is inserted into the intended cell or textbox through the production worksheet API and source strokes/recognition metadata remain undoable.

9. Align schema/default exports with public contracts.
   - Make the tool list a single exhaustive constant so `InkTool` additions fail typecheck until defaults, pressure support, and schemas are updated.
   - Validate `CreateDrawingOptions.toolState` by deep-merging per-tool settings with defaults instead of accepting partial structures that can remove required tool keys.
   - Sync `DRAWING_OBJECT_SCHEMA` with current `FloatingObjectBase` fields, including `anchor`, `containerId`, visibility/accessibility fields if they are required for persisted drawing objects.
   - Add tests that public `DEFAULT_RECOGNITION_THRESHOLDS`, internal `SHAPE_RECOGNITION_THRESHOLDS`, and bridge threshold handling do not drift silently.

10. Clarify adapter boundaries.
   - Keep `spatial-operations.ts` as a pure wrapper around `@mog/drawing-engine`, but add wrapper tests proving z-order, grouping, hit-test, selection, anchor resolution, snap, align, and distribute results match engine outputs.
   - Keep `ink-computation.ts` as a pure wrapper around `@mog/ink-engine`, but document and test the type conversion between engine `Stroke` and contracts `InkStroke`.
   - Remove duplicate or unused exports from `index.ts` only after consumers have migrated. Do not introduce compatibility shims that preserve an inconsistent model.

11. Update production UI integration after kernel contracts are stable.
   - Wire spreadsheet ink coordination to the new mutation/query results so local state, renderer invalidation, and persisted storage observe the same changed stroke IDs and affected bounds.
   - Replace app-side point-only erase fallback in `ERASE_INK_AT_POINT` with the worksheet/domain `findStrokesAtPoint()` query so eraser behavior is consistent across pointer coordination and action handlers.
   - Ensure recognition conversion uses real worksheet object/cell APIs and real undo descriptions.
   - Add browser coverage that uses real pointer/keyboard paths for drawing, erasing, lasso/rectangle selection, moving/transforms, and recognition actions.

## Tests and verification gates

Tests to add or strengthen:

- `drawing-manager` tests for creation defaults, tool-state deep merge, no placeholder anchors, add/erase/clear, move/transform, recognition add/remove, `updatedAt`, metadata preservation, and immutable `Map` updates.
- `drawing-codec` or mapper tests for `Map` to `Record` and `Record` to `Map` round trips, invalid stroke IDs, transient `selected` omission, finite number validation, and default tool-state recovery.
- `drawing-operations` tests for point hit, rectangle selection modes, lasso segment crossing, pressure data detection, bounds union, Bezier control points, z-index drawing hit tests, and deterministic stroke ordering.
- Spatial index/cache tests for insert/remove/update/bulk rebuild, stale cache after remote-style replacement, clear/dispose, negative coordinates, empty strokes, one-point strokes, huge coordinates, and invalid bounds.
- Worksheet operation tests for create/add/erase/clear/move/transform/query through production object manager and persistence serialization.
- `ink-recognition-bridge` tests for host-safe text recognition, injected text provider, cleanup, threshold drift, and pure recognizer rejection diagnostics.
- Spreadsheet UI tests using real input paths for drawing a stroke, erasing with the eraser, selecting strokes, moving/translating selected strokes, recognizing a shape, and recognizing text where the host supports it or where a test provider is injected.

Verification gates for the implementation workstream:

- From `/Users/guangyuyang/Code/mog-all/mog/kernel`: `pnpm test`
- From `/Users/guangyuyang/Code/mog-all/mog/kernel`: `pnpm typecheck`
- From `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet`: `pnpm test` for ink/action/coordinator coverage touched by the work.
- From `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet`: `pnpm typecheck` for TypeScript app integration changes.
- From `/Users/guangyuyang/Code/mog-all/mog`: root `pnpm typecheck` after any public contract, package export, or cross-package type changes.
- If compute wire/storage structs change: `cargo test -p compute-core` and `cargo clippy -p compute-core`.
- If shared canvas/drawing/spatial packages change: run the relevant package `pnpm test` and `pnpm typecheck` gates for `canvas/spatial`, `canvas/drawing/ink`, `canvas/drawing/engine`, and `canvas/drawing-canvas`.
- UI changes require running the spreadsheet dev server and exercising the actual feature in a browser with real pointer/keyboard input.

No verification command should be run while writing this plan because this queue task explicitly forbids cargo, rustc, pnpm, npm, yarn, build, test, typecheck, and formatter commands.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Placeholder anchor removal will expose callers that relied on incomplete `Partial<ObjectPosition>` values. The correct fix is resolver-backed creation, not a new fallback placeholder.
- Remote CRDT updates, undo/redo, hydration, and imported files can replace drawing data without going through local mutation helpers; spatial cache freshness must handle those paths.
- Multiple users can create strokes with equal timestamps. Rendering and undo ordering need a stable tie-breaker.
- Imported or old drawings may contain malformed records, missing tool settings, string IDs that do not match record keys, non-finite coordinates, or missing optional metadata.
- Lasso selection semantics can surprise users if crossing strokes are excluded. The selection mode must be explicit and covered by UI tests.
- Text recognition API support varies by browser and may be absent in Node, workers, or server hosts.
- Recognition conversion can lose data if strokes are deleted before the replacement shape/text object is successfully persisted. Conversion should be transactional or undo-safe.
- Shared spatial index migration can change candidate ordering. Public query results need deterministic ordering independent of map/set iteration.
- Deep-merging tool defaults can alter persisted partial tool states from old documents. Migration should fill missing required fields without changing explicitly set values.

Non-goals:

- Do not move drawing rendering into the kernel.
- Do not move spreadsheet UI state, React state, or input handlers into `kernel/src/domain/drawing`.
- Do not optimize test-only paths or benchmark-only paths.
- Do not introduce compatibility shims that preserve placeholder anchors or duplicate spatial implementations indefinitely.
- Do not make `mog` depend on `mog-internal`.
- Do not rewrite `@mog/drawing-engine`, `@mog/ink-engine`, or `@mog/spatial` except where a shared contract change is necessary for production drawing behavior.

## Parallelization notes and dependencies on other folders, if any

Recommended parallel workstreams:

- Worker A: drawing domain contracts and mutation helpers in `kernel/src/domain/drawing`, including codec, mutation result types, anchor-safe creation helpers, and direct domain tests.
- Worker B: worksheet API and persistence integration in `kernel/src/api/worksheet`, `kernel/src/floating-objects`, and `kernel/src/bridges/compute/floating-object-mapper`.
- Worker C: spatial index/cache alignment across `kernel/src/domain/drawing`, `canvas/spatial`, and `canvas/drawing/ink`.
- Worker D: recognition bridge and conversion workflow across `kernel/src/domain/drawing/ink-recognition-bridge.ts`, `types/bridges`, and `apps/spreadsheet/src/actions/handlers/ink.ts`.
- Worker E: spreadsheet UI/input verification in `apps/spreadsheet/src/systems/ink` and related app-eval/browser scenarios.
- Worker F: compute wire/storage changes if serialization contracts require Rust-side schema or generated type updates.

Dependency order:

1. Add tests that pin current production behavior and desired contracts.
2. Land codec and mutation helper contracts in the drawing domain.
3. Fix creation anchoring and worksheet persistence integration.
4. Replace or adapt spatial indexing and cache invalidation.
5. Upgrade recognition/conversion workflows.
6. Migrate app/UI callers and remove inconsistent fallback paths.
7. Run package, root type, Rust, and browser verification gates appropriate to the touched folders.

Cross-folder dependency direction must remain public-only: `kernel` may depend on public contracts and workspace drawing/spatial/ink packages, but neither public `mog` source nor public examples/website code may depend on `mog-internal`. This plan stays private in `mog-internal`.
