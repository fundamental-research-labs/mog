# Plan 049 — Harden `mog/canvas/drawing/geometry/src` (pure 2D geometry primitives for drawing + hit-testing)

## Source folder and scope

- **Folder:** `mog/canvas/drawing/geometry/src`
- **Package:** `@mog/geometry` (`mog/canvas/drawing/geometry`, version `0.1.0`, `private: true`, `"type": "module"`). Dependencies: `@mog-sdk/contracts` only. Header invariant (`src/index.ts:1-6`): *"Pure 2D geometry primitives used by all floating object engines. Zero dependencies beyond contracts. No Yjs, React, Canvas, or DOM."*
- **Files in scope:**
  - `index.ts` — barrel. Re-exports contract types from `@mog-sdk/contracts/geometry`; exposes namespaces `Matrix`, `Transform`, `PathOps`, `Diagnostics`, `ConnectorRouting`, `ConnectionPoints`, `Rect`, plus flat exports from `primitives` and `BoundedCache`.
  - `point.ts` — `Point2D`/`Vector2D` math (add/sub/scale/dot/cross/length/normalize/distance/lerp/angle/rotate/reflect/project/midpoint…).
  - `rect.ts` — `BoundingBox` ops (fromPoints/fromCorners/union/intersection/contains/expand/center/area/overlaps/inset/scaleFromCenter…).
  - `matrix.ts` — 3×3 affine matrix (identity/fromValues/multiply/determinant/invert/transformPoint(s)/isIdentity/equals).
  - `transform.ts` — high-level builders (translate/rotate/scale/skew/compose/**decompose**/flip).
  - `bezier.ts` — cubic/quadratic eval, derivative, De Casteljau split, tight bounding box, Simpson arc-length, nearest-point, quad→cubic.
  - `path.ts` (~970 lines, largest file) — `PathBuilder`, **SVG path parse/serialize**, path metrics (`pathBoundingBox`/`pathLength`/`pointAtLength`), `reversePath`, `splitIntoSubPaths`, `transformPath`.
  - `polygon.ts` — convex hull (monotone chain), shoelace area, centroid, convexity, winding, perimeter, point-on-edge.
  - `primitives.ts` — consolidated point-in-shape / rect-rect / distance hit-testing primitives.
  - `hit-test.ts` — `pointInPolygon` (ray cast), `distanceToSegment`/`distanceToLine`, `pointOnPath`/`distanceToPath`.
  - `connector-routing.ts` — connection-point-on-bbox calc + straight/bend/curve/longCurve routing.
  - `connection-points.ts` — OOXML preset `cxnLst`/guide-formula evaluation → pixel points + snap-to-nearest.
  - `bounded-cache.ts` — generic LRU `BoundedCache<K,V>`.
  - `diagnostics/{index,validators}.ts` — NaN/degenerate/singular validators for `Path`/`AffineTransform`/`BoundingBox`.
- **Contract types consumed (do not fork):** `Point2D`, `Vector2D`, `BoundingBox`, `AffineTransform`, `Path`, `SubPath`, `PathSegment` (`M`/`L`/`C`/`Q`/`Z`) live in `mog/types/viewport/src/geometry.ts`, surfaced via the `@mog-sdk/contracts/geometry` shim (`mog/contracts/src/viewport/geometry.ts:4` → `@mog/types-viewport/geometry`). Any new public shape this plan needs must be added there, not re-declared locally.
- **Existing tests:** `mog/canvas/drawing/geometry/__tests__/` already has one suite per source file (`bezier`, `bounded-cache`, `diagnostics`, `hit-test`, `matrix`, `path`, `point`, `polygon`, `primitives`, `rect`, `transform`) plus `__snapshots__`. Jest config: `jest.config.cjs`. This plan extends that suite; it does not create the harness.

## Current role of this folder in Mog

`@mog/geometry` is the **single, dependency-free math kernel** under every floating-object/drawing surface in Mog. It deliberately has no DOM/Canvas/React/Yjs coupling so it can run identically in the kernel, the renderer, the PDF/print export path, and headless contexts. A repo-wide search finds **59+ importing modules** across at least these consumer families, and the consolidation it advertises is real (consumers delegate rather than re-implement):

- **Hit-testing / picking** — `mog/charts/src/interaction/pick.ts` delegates `pointInRect`/`pointInArc`/`pointInCircle`/`pointInDiamond` to this package (`pick.ts:8-16`, with local wrappers that "Delegate to @mog/geometry"); `mog/canvas/drawing/engine/src/spatial/spatial-query.ts:13` uses `pointInRect`/`rectContains`/`distanceToRect`/`Rect`.
- **Shape geometry** — `mog/canvas/drawing/shapes/src/{shape-to-path,custom-geometry,presets/*}.ts` build `Path`s; `shapes/src/diagnostics/validators.ts` builds on the diagnostics here.
- **Text effects / text-on-path** — `mog/canvas/drawing/text-effects/src/warp/{warp-engine,path-text}.ts` call `PathOps.pointAtLength(...)` **per glyph** (`warp-engine.ts:62`, `path-text.ts:59`) — a latency-sensitive hot path.
- **Drawing engine renderer** — `engine/src/renderer/{svg,path}.ts` and `engine/src/index.ts` consume path + transform ops.
- **Connectors** — `mog/apps/spreadsheet/src/coordinator/connector-rerouting.ts` and `connection-points`/`connector-routing` subpath exports (the package ships dedicated `./connection-points` and `./connector-routing` entry points in `package.json`).
- **File-IO / PDF export** — `mog/file-io/pdf/graphics/src/{render-backend,graphics-state,pdf-canvas}.ts` and the print-export PDF renderers, so geometry bugs reach **persisted/exported output**, not just on-screen render.
- **Kernel** — `kernel/src/domain/shapes/shape-computation.ts`, `domain/charts/chart-manager-bounds.ts`, `domain/drawing/ink-computation.ts`.

Because the same primitives back **on-screen hit-testing, kernel computation, and PDF export**, a numerical or correctness defect here produces *cross-surface* divergence (e.g. a shape that selects on screen but rasterizes differently in export). That blast radius is the central reason to harden this folder.

### Evidence-backed problems found

1. **SVG arc commands (`A`/`a`) are silently wrong, not unsupported.** `path.ts:408-445` consumes the 7 arc parameters but emits a **`lineTo` to the endpoint** ("Full arc-to-bezier conversion is not yet implemented; emit a lineTo … so that position state stays correct"). Any imported/preset SVG path containing an elliptical arc renders, hit-tests, measures (`pathLength`/`pathBoundingBox`), and **exports to PDF** as a straight chord. This is a correctness defect with no error signal. Note the sibling `mog/canvas/drawing/shapes/src/custom-geometry.ts:35,264` already owns an `arcTo`→bezier conversion for its own command list — so the conversion math exists in the monorepo but is **not shared**, and the canonical pure-geometry package is the one missing it.

2. **The SVG tokenizer cannot parse real-world arc flag packing.** `path.ts:87` tokenizes with `/([MLCQZHVSTAmlcqzhvsta])|(-?\d*\.?\d+…)/`. Many SVG producers pack arc large-arc/sweep flags without separators (e.g. `a25 25 0 0150 0`, where `0150` is `0`,`1`,`50`). The current number regex would mis-read these as single numbers. It is moot **only** because arcs are stubbed (problem 1); the moment arc support lands, the tokenizer must special-case the two single-digit flag fields, or arc import will be subtly corrupt.

3. **`pointAtLength` is an accuracy-vs-cost hot path implemented naively.** For each `C`/`Q` segment, `path.ts:660-695` / `:702-731` runs a 30-iteration binary search where **each iteration re-samples the curve from t=0 in 20 sub-steps** — ~600 `evaluateCubic` calls *per curve segment per query* — and it first computes `cubicLength` separately, so the curve is effectively traversed twice. text-effects calls this **once per glyph** (`warp-engine.ts:62`, `path-text.ts:59`), so a long text-on-path string multiplies this cost. The binary search also measures partial length by re-integrating rather than reusing a cumulative table, compounding both cost and drift.

4. **Magic-number tolerances are scattered and inconsistent.** Distinct epsilons appear with no shared definition: `1e-10` (`point.ts:8`, `matrix.ts:83`, `polygon.ts:144`), `1e-12` (`matrix.ts:55` invert/singular, `hit-test.ts:53,76`, `bezier.ts:126`, `polygon.ts:111,213`), `1e-8` (`polygon.ts:188` `pointOnPolygonEdge` default tolerance), `1e6` (`diagnostics` TRANSFORM_EXTREME) and `1e8` (`diagnostics` BBOX_EXTREME). Some functions accept an `epsilon` parameter (`point.equals`, `rect.equals`, `matrix.equals/isIdentity`); peers that need one don't. The **singular-matrix threshold** `1e-12` in `matrix.invert` (`matrix.ts:55`) and in `validateTransform` (`diagnostics/validators.ts:150`) are independent literals that must agree but are not linked — drift here means `invert` returns a matrix that the validator calls singular, or vice-versa.

5. **`BoundedCache` cannot safely store `undefined`, and conflates "absent" with "present-but-undefined".** `bounded-cache.ts:18-26`: `get` returns `V | undefined` and only performs the LRU recency bump when `value !== undefined`. If `V` includes `undefined` (or any falsy sentinel a caller stores), recency tracking silently breaks and a hit is indistinguishable from a miss. The cache is documented as backing `drawing-engine`, `Diagram`, and bridge caches of computed `DrawingObject`s / SVG filter strings (`bounded-cache.ts:3-6`), where a memoized `undefined`/empty result is plausible. It is a latent correctness bug, not just a style nit.

6. **`connector-routing` return contract is positional and untyped.** Every routing function returns a bare `Point2D[]` whose meaning depends on the style: `routeStraight` → 2 points, `routeBend` → 3 **or** 4 points (`connector-routing.ts:211-235`), `routeCurve`/`routeLongCurve` → 4 points interpreted as cubic Bézier control points. `routeConnector` (`:298-315`) hides the style behind the same `Point2D[]`, so the caller (`apps/spreadsheet/.../connector-rerouting.ts`) must independently re-derive whether the array is a polyline or Bézier control net. There is no discriminated result type tying point-count/semantics to the requested `RoutingStyle`; this is an easy mis-interpretation surface for any new consumer.

7. **`pathToSvgString` has a non-exhaustive switch and is not round-trip faithful.** `path.ts:458-475` switches over segment types with **no `default`/`never` guard**; a future `PathSegment` variant (e.g. arc, once problem 1 is fixed) would `map` to `undefined` and serialize the literal `"undefined"` into path data with no compile-time error. Separately, serialization ignores `Path.closed` and `Path.subPaths`, and `parseSvgPath`→`pathToSvgString`→`parseSvgPath` is not asserted to be stable.

8. **`reflect` documents a precondition it does not enforce or help satisfy.** `point.ts:151-162`: *"normal — Must be a unit vector … Non-unit normals produce incorrect results."* There is no `reflectUnsafe`/`reflect` split, no internal normalize option, and no debug assertion, so the most error-prone call in the file is guarded only by a comment.

9. **Boundary/edge semantics for hit-testing are undocumented and double-claiming.** `primitives.pointInRect` (`primitives.ts:17-24`) and `rect.containsPoint` (`rect.ts:73-80`) are inclusive on **all four** edges, so two adjacent rects both claim a shared edge pixel (ambiguous picking). `hit-test.pointInPolygon` (`hit-test.ts:19-41`) is standard even-odd ray casting whose on-edge result is implementation-defined. For a picking kernel feeding selection, the half-open vs closed convention is a real product behavior that is currently neither chosen nor written down — and `primitives.pointInRect` duplicates `rect.containsPoint` with no stated relationship.

10. **`decompose` is under-specified for reflected/degenerate matrices.** `transform.ts:75-109` extracts rotation from `atan2(b,a)`, `sx` from the first column length, and `sy = det/sx`. For matrices with negative determinant (a reflection, produced by `flipX`/`flipY` in the same file) the rotation+skew+sign split is ambiguous and not documented; for near-singular matrices `sx≈0` falls back to `skew=0`/`sy=0` silently. No invariant ("compose(decompose(m)) ≈ m within ε") is asserted anywhere.

11. **No package README/CHANGELOG and no allocation/perf contract for the hot primitives.** Every op allocates fresh `{x,y}` objects (e.g. `transformPoints` maps→new array of new points; `distanceToPath` allocates 30 sample points *per cubic segment*, `hit-test.ts:128-146`). For per-frame hit-testing and per-glyph text-on-path this is real GC pressure, yet there is no documented "these are the hot functions; here is the allocation budget / scratch-buffer variant" guidance, and no benchmark gate to catch regressions.

## Improvement objectives

1. **Make SVG arc handling correct** — replace the `A`/`a`→`lineTo` stub with a proper elliptical-arc→cubic-Bézier conversion (endpoint-parameterization per the SVG/ECMA-376 arc spec), reusing/sharing the conversion already proven in `shapes/src/custom-geometry.ts` so the monorepo has **one** arc implementation, and fix the tokenizer to parse packed arc flags.
2. **Make `pointAtLength`/`distanceToPath` fast and accurate** — introduce a per-curve cumulative arc-length lookup (flatten-once, reuse) so a length query is O(samples) not O(iterations×subsamples), and so repeated queries along the same path (text-on-path) share work.
3. **Centralize numerical tolerances** — one internal `epsilon` module with named, documented constants (`POINT_EPS`, `SINGULAR_DET_EPS`, `EDGE_TOLERANCE`, `EXTREME_TRANSFORM`, `EXTREME_BBOX`), referenced by both `matrix.invert` and `diagnostics.validateTransform` so the singular threshold is provably consistent; keep all current `epsilon`-parameter signatures as overrides defaulting to the shared constant.
4. **Fix `BoundedCache` semantics** — make recency tracking and hit detection independent of the stored value (use `Map.has` for membership; bump recency on any hit, including stored `undefined`), preserving the existing `get/set/has/delete/clear/size` surface and LRU eviction order.
5. **Strengthen the connector-routing contract** — return a discriminated result (`{ kind: 'polyline'; points } | { kind: 'cubic'; start; cp1; cp2; end }`) from `routeConnector` (keeping the lower-level `routeStraight/Bend/Curve` helpers, optionally as thin wrappers) so consumers cannot mis-read a Bézier net as a polyline.
6. **Make serialization total and round-trip-safe** — add a `never`-exhaustiveness guard to `pathToSvgString`, decide and document handling of `closed`/`subPaths`, and assert parse↔serialize stability.
7. **Document and decide hit-test boundary semantics** — choose a convention (recommended: keep `containsPoint`/`pointInRect` closed for containment queries, but document it; collapse the `primitives.pointInRect`↔`rect.containsPoint` duplication to one implementation), and document `pointInPolygon` on-edge behavior.
8. **Tighten `decompose`/`reflect` and other under-specified math** — document the decomposition convention, handle the reflection (`det<0`) case explicitly, assert the `compose(decompose(m))≈m` round-trip in tests, and either enforce or self-normalize `reflect`'s unit-normal precondition.
9. **Add a perf/allocation contract and benchmarks** for the hot functions (`pointAtLength`, `distanceToPath`, `transformPoints`, `pointInPolygon`, picking primitives) plus a package `README` documenting the zero-dependency charter and namespace map.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (must not regress):**
- **Zero runtime dependencies beyond `@mog-sdk/contracts`; no DOM/Canvas/React/Yjs import** (`index.ts:4-5`). No new dependency, no global state, all functions pure and deterministic.
- **All geometry shapes (`Point2D`, `BoundingBox`, `AffineTransform`, `Path`, `PathSegment`, `SubPath`) remain the contract types** from `@mog-sdk/contracts/geometry`; this package adds operations, never forks the data model. New public shapes (e.g. an arc segment, if introduced) must be added to `mog/types/viewport/src/geometry.ts` and flow through the contracts shim, coordinated with contract consumers.
- **Public export surface** (`index.ts` namespaces + flat exports, and the `./connection-points` / `./connector-routing` package subpath entry points) stays backward-compatible: existing named exports keep their names and call signatures. New behavior is additive or behind a wider-but-compatible signature.
- **Matrix layout and conventions:** column/row layout `|a c tx; b d ty; 0 0 1|` and "multiply(A,B) applies B first" (`matrix.ts:1-9,30-43`); `transform.compose(A,B,C)=A*B*C` right-to-left (`transform.ts:46-49`). Angle convention in `pointInArc` (0 at 12 o'clock, clockwise, `primitives.ts:36-43`) must not silently change — chart picking depends on it.
- **Diagnostics severity/codes** (`diagnostics/validators.ts`) are an observable contract for `shapes/src/diagnostics`; codes (`PATH_NAN_COORDINATE`, `TRANSFORM_SINGULAR`, `BBOX_NEGATIVE_WIDTH`, …) and the `valid = no error-severity issue` rule must be preserved or only extended.

**Strengthen:**
- **Singular-matrix threshold is a single shared constant** used by both `invert` and `validateTransform` (closes problem 4).
- **`pathToSvgString` is total** over `PathSegment` (compile-time `never` guard) (closes problem 7).
- **`BoundedCache` membership/recency is value-agnostic** (closes problem 5).
- **`routeConnector` result is self-describing** (closes problem 6).
- **`pointAtLength` accuracy is bounded and documented** (max error vs sample count) (closes problem 3).
- **New invariant tests:** `compose(decompose(m)) ≈ m`; `parse(serialize(p)) ≈ p`; arc-conversion endpoint/tangent continuity; `transformPath` ∘ `invert` round-trip.

## Concrete implementation plan

Ordered so each step is independently shippable and test-gated.

1. **Tolerances module (foundational, low-risk).** Add `src/epsilon.ts` exporting named constants and re-point the scattered literals (`point.ts`, `rect.ts`, `matrix.ts`, `polygon.ts`, `hit-test.ts`, `bezier.ts`, `diagnostics/validators.ts`) at them. Keep every existing `epsilon`-parameter default equal to the shared constant so behavior is byte-identical until intentionally changed. Make `matrix.invert` and `validateTransform` import the **same** `SINGULAR_DET_EPS`.

2. **`BoundedCache` fix.** Rewrite `get`/`set` to use `Map.has` for membership and to bump recency on any hit. Preserve eviction order semantics and the `maxSize >= 1` guard. Add tests covering stored-`undefined`, LRU eviction order, and update-in-place recency.

3. **`pathToSvgString` exhaustiveness + round-trip.** Add a `default: { const _x: never = seg; return ''; }` guard; document `closed`/`subPaths` handling; add `parse∘serialize` stability tests on a representative corpus (the preset shapes used by `shapes/src/presets`).

4. **Arc support (largest, highest-value).**
   - Add an internal `arcToBeziers(...)` (endpoint-parameterization: compute center, θ1/Δθ, split into ≤90° cubic segments) — factor it so it can be shared with / replace the duplicate in `shapes/src/custom-geometry.ts` (coordinate with the shapes package; do not silently leave two copies).
   - Replace `path.ts` `A`/`a` branches to emit the resulting `C` segments instead of an `L`.
   - Fix the tokenizer (problem 2): parse arc parameters field-by-field with single-digit flag handling, not the generic number regex.
   - Decide the data-model question: emit cubic `C` segments (no contract change — recommended for minimal blast radius) **vs.** add a first-class arc `PathSegment` to `@mog-sdk/contracts/geometry` (larger, touches every `switch` over `PathSegment` across the monorepo). Default to the cubic-emission approach unless an arc segment is independently justified.

5. **Arc-length LUT for `pointAtLength`/`distanceToPath`.** Introduce a per-curve flattening helper that produces a cumulative `(t, arcLength, point)` table once, then resolves a target length by table lookup + single local refinement. Use it in `pointAtLength` (replacing the nested re-integration loop) and let `distanceToPath` reuse the same flattening instead of its independent fixed sampling. Document the accuracy/segment-count trade-off and expose an optional tolerance parameter.

6. **`connector-routing` discriminated result.** Introduce the discriminated return type; have `routeConnector` return it; keep `routeStraight/Bend/Curve/LongCurve` (either returning the raw points as today for backward compat, or thin adapters), and migrate `apps/spreadsheet/.../connector-rerouting.ts` to the discriminated form (coordinated edit, separate PR if needed). Mark the bare-array form as the legacy shape in docs.

7. **Hit-test boundary semantics + dedup.** Collapse `primitives.pointInRect` and `rect.containsPoint` to one implementation (one re-exports the other), document the closed-boundary convention, and document `pointInPolygon` on-edge behavior. Do **not** change picking results without an explicit decision — if a half-open convention is adopted, it must be a deliberate, separately-reviewed product change with charts/engine sign-off.

8. **`decompose`/`reflect` robustness.** Handle `det<0` explicitly in `decompose` (document the sign convention), guard the near-singular fallback, and add the `compose(decompose(m))≈m` invariant test. For `reflect`, add a self-normalizing variant or a dev assertion; keep the fast unit-normal path.

9. **Docs + perf contract.** Add `README.md` (charter, namespace map, "hot functions / allocation budget" section) and a micro-benchmark file gated in CI (step 4 of verification) covering the hot functions named in objective 9.

## Tests and verification gates

- **Reuse the existing per-file Jest suites** in `__tests__/`; extend rather than replace. New/strengthened cases:
  - `bounded-cache.test.ts`: stored-`undefined` hit, LRU eviction order, recency bump on update.
  - `path.test.ts`: arc parse → cubic emission (endpoint + tangent continuity, bounding box vs. analytic ellipse), packed-flag tokenizer cases, `pathToSvgString` exhaustiveness + `parse∘serialize` stability, `pointAtLength` accuracy table (error bound vs sample count) and equivalence with pre-change values on non-arc paths.
  - `transform.test.ts`: `compose(decompose(m))≈m` across translate/rotate/scale/skew/**reflection**/composite matrices; near-singular fallback.
  - `matrix.test.ts`: `invert` and `validateTransform` agree at the shared singular threshold.
  - `hit-test.test.ts`/`primitives.test.ts`: documented boundary convention pinned by tests; `pointInRect`↔`containsPoint` equivalence after dedup.
  - `connector-routing` (add a suite): discriminated result kind/point-count per style; `routeConnector` equals the lower-level helpers.
- **Snapshot suites** in `__tests__/__snapshots__` must be re-reviewed: arc support will change snapshots for any fixture path containing arcs — those diffs are the *evidence the fix works* and must be inspected, not blindly accepted.
- **Cross-consumer regression:** run the dependent package suites that exercise this code — `charts` pick tests, `drawing/engine` spatial-query, `text-effects` (`warp-engine`/`path-text`/`presets`), `shapes` preset tests, and the `file-io/print-export` + `file-io/pdf/graphics` PDF renderer tests — to confirm no behavioral drift in picking or export. (These suites already import `@mog/geometry` per the consumer search.)
- **Gates (per package scripts):** `pnpm --filter @mog/geometry test`, `pnpm --filter @mog/geometry typecheck` (`tsc --noEmit`). If a contract type is added in step 4's alternative, also `pnpm --filter @mog-sdk/contracts build` before consumers typecheck (declaration rollup — see internal note on contracts builds). Add the micro-benchmark as a non-blocking informational gate first, then a regression threshold.
- **Determinism check:** all functions remain pure — add a test asserting no input mutation for the array-taking ops (`transformPoints`, `convexHull`, `fromPoints`).
- *(This planning task itself runs no build/test commands; the above are the gates the implementing PR must pass.)*

## Risks, edge cases, and non-goals

- **Risk — arc support changes rendered/exported output.** This is the intended fix, but it alters geometry that previously rendered as straight chords; any golden-image / PDF snapshot containing arcs will diff. Mitigation: land arc conversion behind thorough fixture tests, review every snapshot diff, and confirm with charts/shapes/export owners.
- **Risk — `pointAtLength` numerical drift.** Replacing the re-integration loop with a LUT changes floating-point results slightly even where it's "more correct." text-on-path placement (`path-text.ts`) is visually sensitive. Mitigation: bound the error, pin accuracy tests, and visually verify a text-on-path scenario before/after.
- **Risk — boundary-convention change.** Touching `pointInRect`/`pointInPolygon` edge behavior can flip selection results in charts/engine. Non-goal for this plan to *change* the convention silently; only to **document and dedup**. Any actual convention change is a separate, owner-approved change.
- **Edge cases to keep covered:** zero-length segments, degenerate (collinear/duplicate) polygons in `convexHull`/`polygonCentroid`, singular/near-singular matrices in `invert`/`decompose`, empty paths, `expand` over-shrink axis collapse (`rect.ts:82-95`), NaN/Infinity inputs (diagnostics path), full-circle and wrap-around arcs in `pointInArc`.
- **Non-goals:** introducing a non-object (typed-array/SoA) point representation (would fork the contract — out of scope); adding DOM/Canvas helpers (violates charter); SVG features beyond path data (no `transform`/`style` parsing); GPU/SIMD; changing matrix or angle conventions; broad refactors of consumer code beyond the minimal coordinated edits in steps 4 and 6.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now (no other folder needed):** steps 1 (epsilon), 2 (`BoundedCache`), 3 (`pathToSvgString`), 8 (`decompose`/`reflect`), 9 (docs/bench). These touch only this package and its own tests.
- **Cross-folder coordination required:**
  - **Step 4 (arc):** shares/replaces the arc→bezier logic in `mog/canvas/drawing/shapes/src/custom-geometry.ts`; if the contract-type alternative is chosen, it edits `mog/types/viewport/src/geometry.ts` (`@mog-sdk/contracts/geometry`) and ripples to **every** `switch (seg.type)` over `PathSegment` across charts/engine/shapes/file-io. Recommended path (emit cubics) avoids the contract change and keeps the blast radius inside this package.
  - **Step 5 (LUT):** behavior-visible to `text-effects` (`warp-engine`, `path-text`) — coordinate a visual check.
  - **Step 6 (connector result):** requires a paired edit in `mog/apps/spreadsheet/src/coordinator/connector-rerouting.ts`.
- **Sequencing:** do steps 1–3 first (cheap, de-risking, no downstream impact), then 4→5 (5 builds on the flattening introduced for 4), then 6/7 as coordinated changes, with 8/9 anytime. The `@mog/geometry` package sits at the bottom of the drawing dependency graph, so its consumers (charts, drawing/engine, shapes, text-effects, file-io PDF, kernel drawing/charts) should be re-tested after any change here regardless of which step shipped.

## Status

Actionable (not blocked). The folder exists with full source and an existing per-file test suite; consumers, contract types, and the duplicate arc implementation in `shapes` were all located, so every objective above is backed by concrete file:line evidence.
