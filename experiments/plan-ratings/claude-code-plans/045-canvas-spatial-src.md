# 045 — Improve `mog/canvas/spatial/src` (grid spatial index + hit-test pipeline)

## Source folder and scope

- **Folder:** `mog/canvas/spatial/src` (`@mog/spatial`, v0.1.0, `private`, bundle-only)
- **Files (5 production `.ts`, ~14 KB; 3 test files, ~22 KB):**
  - `grid-index.ts` (359 lines) — `GridSpatialIndex<T>` and the `createSpatialIndex` factory. The core data structure: a sparse bit-packed grid of cell → `Set<string>` plus an `entries` map and an `oversized` map.
  - `pipeline.ts` (95 lines) — pure broad+narrow composition helpers: `hitTestPipeline` (queryPoint → z-sort → narrow phase), `selectInRect` (`intersects`/`contains`), `findNearby` (radius query, distance-sorted).
  - `canvas-hit-test.ts` (33 lines) — `testPointInPath` / `testPointInStroke`, DPR-safe wrappers around `isPointInPath` / `isPointInStroke` that `resetTransform` between save/restore.
  - `types.ts` (22 lines) — `SpatialEntry<T>`, `SpatialIndex<T>` interface, `NarrowPhaseTest<T>`.
  - `index.ts` (5 lines) — barrel.
- **In scope (edit targets):** all five files above and the three `__tests__` files. The package is a pure-computation seam: no DOM/React/Yjs (the canvas wrappers only touch a `CanvasRenderingContext2D`-like object passed in). It is the shared spatial-indexing/hit-test substrate for all canvas packages.
- **Out of scope (named for coupling, not edited here):**
  - **`@mog-sdk/contracts/geometry`** — supplies `BoundingBox` (`{x,y,width,height}`) and `Point2D` (`{x,y}`). Read-only dependency; no contract change is required by this plan. `@mog/spatial`'s only runtime/dev dependency is `@mog-sdk/contracts`, and the `import-boundaries` rule pins it to the **`hardware`** layer (`mog/tools/eslint-plugin-mog/import-boundaries.cjs:101`). Keeping the dependency set at exactly `{@mog-sdk/contracts}` is an invariant.
  - **Consumers** (do not edit; verify they still typecheck and behave):
    - `mog/canvas/drawing-canvas/src/hit-testing/hit-map.ts` — `createSpatialIndex` + `hitTestPipeline` + `testPointInPath` for drawing-object selection; index maintained incrementally, **not** rebuilt per frame.
    - `mog/charts/src/primitives/renderer/hit-tester.ts` — `GridHitTester` builds the index per `build(marks)` and uses `findNearby` for radius queries.
    - `mog/canvas/overlay/src/handle-hit-testing.ts` — `testPointInPath` for handle hit testing (note: plan 044 proposes **removing** this dependency in favor of closed-form math; see Parallelization).
    - `mog/canvas/drawing/ink/src/spatial-index.ts` and `mog/kernel/src/domain/drawing/spatial-index.ts` — re-export `GridSpatialIndex` / `createSpatialIndex` / types as the canonical location.

## Current role of this folder in Mog

This folder is **Layer 2 of the canvas hit-test stack** (per `mog/docs/architecture/README.md:347`): a grid-based broad-phase index plus the broad→narrow→z-order pipeline used by drawing objects, chart marks, ink strokes, and overlay handles. The grid maps each item's bounding box to every cell it overlaps; `queryPoint` returns the candidates in the point's cell, `query` unions candidates over all overlapped cells, and both then filter candidates by an exact overlap/containment test before returning. Items whose box spans more than `MAX_CELLS` (1000) cells are kept in a separate `oversized` map that is scanned on every query. The design is deliberately pure (no canvas/DOM in the index itself) so it can run in workers and tests.

The architecture is sound and widely depended upon. The improvements below harden three real weaknesses — **silent broad-phase degradation at large coordinates**, **a dead query-size threshold that forces full scans**, and **nondeterministic topmost selection on z-ties** — plus input-validation and hot-path allocation hardening, without changing the public `SpatialIndex<T>` shape.

## Evidence (observed in the current tree)

- **The cell key collides for large coordinates, silently degrading the broad phase to O(n).** `packCellKey` (`grid-index.ts:58-60`) is `((cellX & 0xffff) << 16) | (cellY & 0xffff)`. Two facts follow: (1) `& 0xffff` masks each axis to 16 bits, so cells whose coordinate differs by a multiple of 65536 **alias to the same key**; (2) `<<` is a 32-bit signed op, so `cellX << 16` overflows for `cellX > 32767`. The doc comment claims a supported range of `[-32768, 32767]` cells — at the default `cellSize = 50` that is only `±1,638,400` px. Spreadsheet/drawing document space routinely exceeds this (a tall sheet's drawing layer, a large chart canvas, a zoomed-out scene). Beyond the range, distinct cells share one `Set`, so a `queryPoint`/`query` pulls candidates from unrelated regions. The final `boxesOverlap`/`boundsContainPoint` filter (`:286`, `:311`) still returns correct results, so this is **not a wrong-output bug — it is a silent selectivity collapse**: the more the scene exceeds the range, the closer the broad phase gets to scanning every entry, exactly when performance matters most. There is no assertion, log, or test guarding the boundary.

- **`MAX_QUERY_CELLS` is dead — queries above `MAX_CELLS` full-scan instead of enumerating their own cells.** `query` gates on `isQueryOversized` (`MAX_QUERY_CELLS = 10_000`, `:255`) but then calls `getCellsForBounds`, which independently returns `null` when `isOversized` (`MAX_CELLS = 1000`, `:131`). So any query spanning **1001–10000 cells** takes the `cellKeys === null` branch (`:266-273`) and scans *all* grid-indexed entries — the higher `MAX_QUERY_CELLS` threshold never takes effect on the cell-enumeration path. The comment there ("Item bounds itself is oversized", `:267`) is also wrong: it is the *query* bounds, not an item. A 60×60-cell rubber-band select (3600 cells) full-scans the index even though enumerating 3600 cells would usually be far cheaper.

- **Topmost hit on a z-index tie is nondeterministic.** `hitTestPipeline` sorts candidates by `getZIndex(b) - getZIndex(a)` (`pipeline.ts:20`). The candidate list comes from `Set` iteration order over `queryPoint` (`grid-index.ts:309`), and the sort is not a total order — two overlapping objects with equal z resolve in whatever order the `Set` happened to yield. `drawing-canvas/hit-map.ts` relies on this to pick the visually frontmost object for selection; with equal `zIndex` (common right after creating stacked objects before z is normalized), *which* object is selected can change between sessions or after an unrelated insert/remove reshuffles the cell `Set`. No tie-break invariant is documented or tested.

- **No input validation; non-finite bounds and degenerate `cellSize` fail silently and inconsistently.** `insert` with a `NaN` field → `getCellCoords` yields `NaN` → `cellCount` is `NaN` → `isOversized` is `false` (`NaN > 1000` is `false`) → the `for` loops `cellX = NaN; NaN <= NaN` never run → the item lands in `entries` but in **zero** grid cells and **not** in `oversized`. It is then invisible to `queryPoint` and normal `query`, but *appears* in the full-scan fallback and in `all()` — an inconsistent ghost. `Infinity` bounds route to `oversized` and match almost everything. `createSpatialIndex(0)` (or negative) makes every coordinate map to `±Infinity` cells. None of these are caught.

- **Per-query allocation on the pointer-move hot path.** `getCellsForBounds` allocates a fresh `number[]` (`:135`) for every `insert`/`remove`/`updateBounds`/`query`; `query` then allocates a `Set` and copies ids into it (`:253`, `:261-263`). For continuous gestures (drag, rubber-band at pointer-move rate, chart hover) this is avoidable GC churn — the cell keys can be visited inline.

- **The `oversized` map is linearly scanned on every `query` and `queryPoint`** (`:292-296`, `:318-322`) with no cap or telemetry. Fine when there are a handful of huge items; pathological if a scene accumulates many (e.g. many full-canvas backgrounds), and there is nothing to surface it.

- **Tests are thorough on small-coordinate behavior but encode none of the above boundaries.** `grid-index.test.ts` covers basic ops, oversized items, dup-id re-index, and negative coords — but the largest coordinate tested is `±10000` px (well inside the 16-bit range), there is no test that two far-apart cells stay distinct, no test that a mid-size query avoids full scan, and `pipeline.test.ts` has no equal-z tie-break case.

## Improvement objectives

1. **Collision-free, allocation-light cell keys over a realistic coordinate range.** Replace 16-bit bit-packing with a scheme that is a true bijection across any coordinate a Mog canvas can produce, while keeping integer `Map` keys (no per-cell string allocation).
2. **Make the query-size threshold real.** Let queries enumerate up to `MAX_QUERY_CELLS` cells before falling back to a full scan; keep the smaller `MAX_CELLS` only for the insert/oversized decision.
3. **Deterministic topmost selection.** Define and enforce a total order for `hitTestPipeline` (and document candidate-order guarantees for `query`/`queryPoint`).
4. **Defined behavior for invalid input.** Specify and enforce invariants for non-finite bounds and for `cellSize`.
5. **Reduce hot-path allocation** via an internal cell-visitor used by all index mutations and queries — no public API change.
6. **Observability for degenerate scenes** (oversized-count / full-scan-fallback) without coupling to any logging framework.

## Production-path contracts and invariants to preserve or strengthen

- **`SpatialIndex<T>` interface (`types.ts`) is stable.** No method signatures change. All current consumers (drawing-canvas, charts, ink, kernel, overlay) must compile unchanged. New capabilities (visitor, telemetry) are additive on the concrete class, not the interface, unless a consumer needs them.
- **Result-set correctness is exact and unchanged:** `query(b)` returns every entry whose bounds intersect `b` (inclusive edges, matching `boxesOverlap`), and only those; `queryPoint(p)` returns every entry whose bounds contain `p` (inclusive). The grid is an acceleration structure only — correctness must never depend on the key scheme or thresholds.
- **Idempotent re-index:** `insert` of an existing id replaces it; `updateBounds` moves it across the grid/oversized boundary cleanly (covered by existing tests `grid-index.test.ts:341-372` — must stay green).
- **Purity:** `grid-index.ts`/`pipeline.ts` stay free of DOM/Canvas/React/Yjs; `canvas-hit-test.ts` touches only the passed-in 2D context. Dependency set stays exactly `{@mog-sdk/contracts}`; layer stays `hardware`.
- **New invariant — total hit order:** `hitTestPipeline` returns the candidate with the **greatest `getZIndex`**, breaking ties by a **stable, documented secondary key** (insertion sequence, latest-inserted wins to mirror "drawn last = on top"). Same inputs ⇒ same hit, regardless of grid history.
- **New invariant — coordinate domain:** document the exact finite coordinate range the index supports and the defined behavior outside it (no aliasing within range; clamp-or-oversized outside).
- **New invariant — input domain:** `cellSize` must be a finite number `> 0` (else the factory throws); bounds fields must be finite (else defined, documented handling — see plan).

## Concrete implementation plan

### Step 1 — Collision-free cell key (`grid-index.ts`)
Replace `packCellKey` with arithmetic packing that uses JS's 53-bit safe-integer range instead of 32-bit bitwise ops:
- Choose a stride `S` that comfortably bounds realistic cell counts per axis (e.g. `S = 2**26` ⇒ ±~33.5M cells per axis ⇒ ±1.6 *billion* px at `cellSize = 50`), and a bias `B = S/2`. Key = `(cellX + B) * S + (cellY + B)`. Both terms stay in `[0, S)`, the product stays `< 2**52` (within `Number.MAX_SAFE_INTEGER`), and the mapping is a bijection — **no aliasing** anywhere in range.
- Add a single guard: if a cell coordinate falls outside `[-B, B)`, route the item to `oversized` (treat as effectively unbounded) rather than aliasing. This is a safe, correct fallback and should essentially never trigger.
- Update the doc comment to state the real supported range. Keep keys as plain integers so the `Map<number, Set<string>>` shape and its performance are unchanged.
- *Alternative considered:* nested `Map<number, Map<number, Set>>` (also collision-free, no packing) — rejected as the primary because it doubles map lookups on the hot path; arithmetic packing keeps single-lookup access. *Also considered and rejected:* string keys (`` `${x}|${y}` ``) — extra allocation/hashing per cell on the pointer-move path.

### Step 2 — Decouple the query enumeration cap from the insert cap (`grid-index.ts`)
- Give the cell enumerator an explicit max-cells parameter: `getCellsForBounds(bounds, maxCells)` (or a `forEachCell(bounds, maxCells, visit)` per Step 5). Inserts/removes/updates pass `MAX_CELLS`; `query` passes `MAX_QUERY_CELLS`.
- Then `query` enumerates its own cells whenever `cellCount ≤ MAX_QUERY_CELLS` and only full-scans above that. Delete the now-redundant `isQueryOversized` pre-check or fold it into the enumerator. Fix the misleading "Item bounds itself is oversized" comment to "query bounds spans more than MAX_QUERY_CELLS cells — full scan".
- Keep the `oversized`-map scan unconditional (correct: oversized items live only there).

### Step 3 — Deterministic hit order (`pipeline.ts`, `grid-index.ts`, `types.ts`)
- Stamp each entry with a monotonically increasing `seq` at `insert` time (stored in `StoredEntry`; re-`insert` gets a fresh `seq` so "last touched = topmost" on ties). Expose it on `SpatialEntry<T>` as an optional readonly field, or keep it internal and have `hitTestPipeline` accept the index so it can read it — prefer adding `seq` to `SpatialEntry` since it is cheap, additive, and lets all pipeline helpers tie-break uniformly.
- Change the `hitTestPipeline` sort to a total comparator: primary `getZIndex` desc, secondary `seq` desc. Document the rule. This makes the existing `pipeline.test.ts:29-38` deterministic and adds a new equal-z case.
- Document (don't necessarily sort) that `query`/`queryPoint`/`selectInRect` return order is unspecified beyond set membership; consumers that need order must sort. (`findNearby` already sorts by distance — keep, and add a `seq` tie-break for equal distances to make it total too.)

### Step 4 — Input validation and defined invalid-input behavior
- **Factory (`createSpatialIndex` / constructor):** throw `RangeError` if `cellSize` is not a finite number `> 0`. This is a programming-error guard, cheap, once per index.
- **`insert` / `updateBounds`:** require finite `x,y,width,height`. Pick the production-correct policy and document it: **reject non-finite bounds** (throw in dev, and in production route to `oversized` so the item is at least always discoverable rather than a ghost) — the key point is to eliminate the current "in `entries`, in zero cells, in no `oversized`" inconsistency. Negative width/height should be normalized or rejected (currently they silently produce inverted ranges).
- Add focused tests for each policy.

### Step 5 — Hot-path allocation reduction (`grid-index.ts`)
- Introduce a private `forEachCell(bounds, maxCells, visit: (key:number)=>void): boolean` (returns `false` when the cell count exceeds `maxCells`, signaling the caller to take the oversized/full-scan path). Rewrite `insert`, `remove`, `updateBounds`, and the `query` cell loop to use it — no intermediate `number[]`.
- In `query`, when enumerating cells, accumulate candidate ids directly and dedup with a reused `Set` (or skip the Set when a single cell is involved, mirroring `queryPoint`). Keep output semantics identical.
- This is an internal refactor; public behavior and signatures are unchanged. Confirm `all()`, `size()`, `clear()` untouched.

### Step 6 — Observability (lightweight, framework-free)
- Add an optional `stats()` method on `GridSpatialIndex` (not on the interface) returning `{ entries, oversized, cells, lastQueryFullScan }`. This lets consumers/diagnostics (e.g. ink `diagnostics.test.ts`, charts) detect when a scene has degenerated into full scans or accumulated many oversized items, without `@mog/spatial` importing any logger. Purely additive.

### Step 7 — Docs sync
- Update the file-level comment in `grid-index.ts` (range claim, thresholds) and the package's row in `mog/docs/architecture/README.md:353` only if a claim there becomes inaccurate (it currently says "O(1) average" — still true within range; mention the documented coordinate domain). Doc edits outside `canvas/spatial/src` are a follow-up coordinated with the docs owner, not part of the code change here.

## Tests and verification gates

> The agent does not run these; this section specifies the gates a reviewer/CI must pass. The package uses **jest** (`jest.config.cjs`, `pnpm --filter @mog/spatial test`) and **`tsc --noEmit`** (`check-types`).

New/updated unit tests (in `__tests__`):
- **Key collision regression:** insert two items whose cells differ by exactly the old 65536 stride (e.g. at `cellSize 50`, boxes near `x=0` and `x=65536*50`); assert `queryPoint`/`query` at the first does **not** return the second, and (via `stats()`) that they occupy distinct cells. Add a large-but-in-range coordinate test (e.g. `±10_000_000` px) proving correct, non-full-scan behavior.
- **Query enumeration vs full scan:** build an index, issue a query spanning ~3600 cells (1001–10000 range), assert results are correct and `stats().lastQueryFullScan === false`; issue a query above `MAX_QUERY_CELLS` and assert `lastQueryFullScan === true`. Guards Step 2 against regression.
- **Deterministic tie-break:** two overlapping boxes with equal `zIndex`; assert `hitTestPipeline` returns the later-inserted id, and that the result is stable after inserting/removing an unrelated third item (which would reshuffle `Set` order). Add the symmetric `findNearby` equal-distance case.
- **Invalid input:** `createSpatialIndex(0)` / negative / `NaN` throws; `insert` with a `NaN`/`Infinity` field follows the chosen documented policy and the item is never a "ghost" (either rejected or discoverable via every query path).
- **Allocation/behavior parity:** all existing `grid-index.test.ts`, `pipeline.test.ts`, `canvas-hit-test.test.ts` stay green unchanged (proves the Step 5 refactor is behavior-preserving).

Verification gates:
1. `pnpm --filter @mog/spatial test` — all suites green.
2. `pnpm --filter @mog/spatial check-types` and the composite build (`tsc -b`, since `composite: true` + `declaration` in `tsconfig.json`) emit clean `dist` + `.d.ts`.
3. **Consumer typecheck:** `@mog/drawing-canvas`, `@mog/charts`, `@mog/canvas-overlay`, `@mog/drawing` (ink), and `@mog/kernel` typecheck against the new `dist` (especially if `SpatialEntry.seq` is added — confirm no consumer destructures `SpatialEntry` exhaustively in a way that breaks).
4. Existing consumer unit tests stay green: `drawing-canvas/__tests__/hit-map.test.ts`, `drawing/ink/__tests__/spatial-index.test.ts` + `diagnostics.test.ts`, and the charts hit-tester suite.
5. **Integration (optional, owner-run):** a drawing/ink hit-test app-eval scenario exercising stacked equal-z objects to confirm deterministic selection end-to-end (see `[[app-eval-usage]]`); not a code gate for this folder.

## Risks, edge cases, and non-goals

- **Risk — behavior change masquerading as a refactor.** Steps 1, 2, 5 must be provably output-identical for in-range coordinates; the parity tests (existing suites unchanged) are the safety net. The only intended *observable* changes are: large-coordinate correctness, faster mid-size queries, and deterministic tie-breaks.
- **Risk — adding `seq` to `SpatialEntry<T>`** is a public type change. Audit consumers for exhaustive object construction/spread of `SpatialEntry`; if any break, fall back to keeping `seq` internal and passing the index into `hitTestPipeline`. (drawing-canvas/charts consume entries read-only, so this is expected to be safe.)
- **Edge cases:** zero-size boxes (point items) — preserved (existing tests `:159-165`, `:255-262`); boxes exactly on the in-range/out-of-range boundary; `cellSize` very small (many cells) interacting with `MAX_CELLS`; negative width/height normalization choice.
- **Non-goals:** (a) replacing the grid with an R-tree/quadtree/BVH — the grid is adequate for Mog's near-uniform mark/object distributions and a structural rewrite is out of scope; (b) GPU/worker-offloaded hit testing; (c) changing `SpatialIndex<T>` method signatures or removing any helper; (d) reworking `testPointInPath`/`testPointInStroke` semantics (only relevant if plan 044's overlay change lands — coordinate, don't duplicate); (e) reduced-scope/test-only patches — the key scheme and threshold are production-path fixes.

## Parallelization notes and dependencies on other folders

- **Self-contained core.** Steps 1, 2, 4, 5, 6 touch only `grid-index.ts` (+ tests) and can land as one PR with no cross-folder edits. Step 3 touches `pipeline.ts`/`types.ts` (+ tests) and is independent of Steps 1–2; it can be parallelized but should land with its determinism tests.
- **Cross-folder, coordinate-only (no edits required here):**
  - **Plan 044 (`canvas/overlay/src`)** proposes removing overlay's dependency on `testPointInPath`. If both proceed, do not change `canvas-hit-test.ts` signatures until 044's direction is settled; the two plans are otherwise non-conflicting.
  - **`@mog-sdk/contracts/geometry`** is read-only here; no contracts rollup (`[[mog-contracts-declaration-rollup]]`) is needed unless a future step moves `SpatialEntry`/`SpatialIndex` into contracts (explicitly *not* proposed).
  - **Consumers** (drawing-canvas, charts, ink, kernel) only need a re-typecheck/rebuild after the `dist`/`.d.ts` regenerates; no source edits.
- **Ordering:** land the core PR (Steps 1–2, 4–6) first, then the pipeline determinism PR (Step 3), then run the consumer typecheck/build gate. Docs sync (Step 7) is a final, owner-coordinated follow-up.
