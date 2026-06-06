# 049 - Canvas Drawing Geometry Src Improvement Plan

## Source folder and scope

Source folder: `mog/canvas/drawing/geometry/src`

Scope inspected:

- `index.ts`, `point.ts`, `rect.ts`, `matrix.ts`, `transform.ts`
- `path.ts`, `bezier.ts`, `hit-test.ts`, `polygon.ts`
- `connection-points.ts`, `connector-routing.ts`
- `bounded-cache.ts`
- `diagnostics/validators.ts`, `diagnostics/index.ts`

Related package context:

- Package: `@mog/geometry`
- Package root: `mog/canvas/drawing/geometry`
- Current package dependencies: `@mog-sdk/contracts` only
- Current public package exports: main `@mog/geometry`, plus `@mog/geometry/connection-points` and `@mog/geometry/connector-routing`
- Existing tests: module-level Jest tests under `mog/canvas/drawing/geometry/__tests__`

This plan targets the production geometry source package. It does not include generated `dist`, local `node_modules`, or one-off test-only rewrites.

## Current role of this folder in Mog

`@mog/geometry` is the shared pure-math layer below Mog's drawing stack. Its root export describes the intended contract clearly: pure 2D geometry used by floating object engines, with no Yjs, React, Canvas, or DOM dependencies. It re-exports geometry contract types from `@mog-sdk/contracts/geometry` and provides namespaces for matrix operations, transforms, paths, diagnostics, connector routing, connection points, rect operations, primitive hit-test helpers, and a bounded cache.

Observed production consumers include:

- `canvas/drawing/engine/src/spatial/spatial-query.ts`, which delegates broad-phase hit testing, selection overlap, containment, and proximity to geometry primitives.
- `canvas/drawing/engine/src/renderer/path.ts` and `renderer/svg.ts`, which use `PathOps.pathToSvgString` for drawing output.
- `canvas/drawing/shapes/src/custom-geometry.ts`, `shape-to-path.ts`, preset generators, and shape diagnostics, which use `PathOps` for shape path generation and metrics.
- `canvas/drawing/text-effects/src/warp/path-text.ts` and related text effect presets, which use path length, point-at-length, transforms, and matrices for glyph placement.
- `canvas/drawing/diagram/src/engine/algorithms/connector.ts`, which imports `@mog/geometry/connector-routing` to route diagram connectors.
- `apps/spreadsheet/src/coordinator/connector-rerouting.ts`, which uses connection-point routing when shapes move or resize.
- `charts/src/interaction/pick.ts`, which delegates point-in-rect, circle, diamond, and arc tests to geometry.
- `kernel/src/domain/shapes/shape-computation.ts`, `canvas/drawing/diagram/src/styles/effects.ts`, and `diagram/src/gallery/preview-generator.ts`, which use `BoundedCache`.
- PDF/print rendering packages that import geometry path and transform types from `@mog/geometry`.

This package is therefore not just a helper collection. It is the contract boundary for path generation, hit-testing, connector behavior, chart picking, text-on-path layout, and drawing diagnostics.

## Improvement objectives

1. Make geometry contracts explicit and shared.

   Replace scattered local numeric tolerances, implicit degenerate behavior, and silent fallbacks with a small, documented set of geometry invariants. The package should define what a valid point, vector, bounding box, affine transform, path, segment, guide formula, and route result means.

2. Implement complete production SVG path semantics.

   `parseSvgPath` currently supports many commands but converts SVG `A/a` arc commands to straight lines and silently substitutes `0` for missing numbers. Replace this with a real parser and arc-to-cubic conversion so imported/custom paths, renderer output, path metrics, hit testing, and text effects operate on the same geometry.

3. Use one OOXML guide and connection-point evaluator.

   `connection-points.ts` and `canvas/drawing/shapes/src/custom-geometry.ts` duplicate built-in guide variables and formula operations. Move the common evaluator into geometry and have both shape path generation and connection site resolution use the same implementation and diagnostics.

4. Make path metrics and hit testing consistent.

   `pathLength`, `pointAtLength`, `distanceToPath`, Bezier nearest-point helpers, and hit-test sampling currently use separate approximations. Replace fixed sampling with one shared curve flattening/metric engine so length, tangent, bounds, and distance agree within a declared tolerance.

5. Strengthen connector routing as a shape-geometry contract.

   Connector routing currently handles named bounding-box points plus simple auto/radial behavior. Add a contract for resolving actual connection sites by index when preset `cxnLst` data is available, with target-aware fallback behavior for non-preset objects.

6. Expand diagnostics from passive validators into actionable production checks.

   Diagnostics should identify malformed paths, unsupported guide operations, unknown guide references, non-finite numbers, inconsistent subpath closure, invalid transforms, degenerate curves, invalid cache configuration, and connector routes that cannot be resolved.

7. Preserve package independence.

   `@mog/geometry` must remain pure and must not depend on drawing-engine, shapes, diagram, spreadsheet app, Canvas APIs, DOM APIs, or internal/private packages. Consumers may depend on geometry, but geometry must not reach upward.

## Production-path contracts and invariants to preserve or strengthen

- Dependency invariant: `@mog/geometry` depends only on `@mog-sdk/contracts` and local TypeScript modules.
- Purity invariant: functions are deterministic and side-effect-free, except `BoundedCache` instance state.
- Coordinate invariant: exported geometry operations accept and produce finite numeric coordinates unless a specific diagnostic API is documenting invalid input. Production computation paths should not silently create `NaN`, `Infinity`, or unknown-reference `0` coordinates.
- Bounding box invariant: `BoundingBox` dimensions are non-negative. Add explicit normalization helpers for callers that receive arbitrary corner pairs or negative-width rectangles. Keep edge-inclusive point-in-rect behavior for zero-width and zero-height boxes because existing tests assert those line/point cases.
- Matrix invariant: affine transforms use the documented layout `| a c tx | | b d ty | | 0 0 1 |`, and multiplication means `B` is applied first, then `A`. Inversion must reject singular matrices through a shared epsilon.
- Path invariant: a valid drawable path starts each subpath with `M`; `Z` closes to the current subpath start; `closed` reflects the final segment; `subPaths` preserves per-subpath closure for compound paths.
- SVG parser invariant: all SVG path commands accepted by the parser are converted to Mog `PathSegment` values. Since the contracts do not have an arc segment, SVG arcs must be converted to cubic Beziers, not downgraded to lines.
- Arc invariant: SVG endpoint arcs (`A/a`) and OOXML visual-angle arcs are different coordinate systems. Keep separate conversion helpers with tests proving both conventions.
- Metric invariant: `pathLength`, `pointAtLength`, `distanceToPath`, `pointOnPath`, and Bezier nearest-point helpers share the same tolerance and curve subdivision policy.
- Hit-test invariant: broad-phase bounding boxes stay fast and conservative; narrow-phase path tests and chart picking become more precise only where geometry can prove the same result without Canvas.
- OOXML guide invariant: all ECMA-376 guide formula operations used by preset/custom shapes and connection points resolve identically. Unknown formula ops and unknown references must be diagnostics or hard errors in strict APIs, not silent zeros.
- Connector invariant: a connector endpoint resolved by site index must select the exact resolved connection point when `cxnLst` exists; fallback named points (`tCtr`, `midR`, etc.) remain defined for generic rectangles and objects without preset geometry.
- Cache invariant: `BoundedCache<K,V>` works for any key and value type permitted by `Map`, including `undefined` values and `undefined` keys, and eviction is based on actual iterator state rather than sentinel checks.
- Public API invariant: package subpath exports remain intentional. If modules such as `hit-test`, `polygon`, `bezier`, `point`, or guide evaluation are needed by production callers, expose them deliberately through the root namespace or explicit subpath exports instead of relying on deep source imports.

## Concrete implementation plan

### 1. Establish a shared numeric and validation core

Add a small internal module, for example `numeric.ts`, that centralizes:

- `GEOMETRY_EPSILON`, `SINGULAR_MATRIX_EPSILON`, `PATH_FLATTENING_TOLERANCE`, and route/guide tolerances.
- `isFiniteNumber`, `assertFiniteNumber`, `isFinitePoint`, `isFiniteBox`, `clamp`, `nearlyEqual`, `normalizeAngleRadians`, and `normalizeBox`.
- Squared-distance helpers to avoid duplicated `Math.sqrt` work in hot paths.

Refactor `point.ts`, `rect.ts`, `matrix.ts`, `transform.ts`, `polygon.ts`, `hit-test.ts`, `bezier.ts`, `diagnostics/validators.ts`, and `primitives.ts` to use the shared helpers. This is not just cleanup: it makes tolerance-sensitive behavior identical across transforms, path metrics, hit testing, and diagnostics.

Specific fixes to include:

- Replace repeated hardcoded `1e-10`, `1e-12`, and `1e-8` values with named tolerances.
- Use `Number.isFinite` consistently instead of global `isFinite`.
- Keep `pointInRect` and `Rect.containsPoint` edge-inclusive, including zero-area boxes.
- Add `Rect.normalize`, `Rect.fromCenter`, and `Rect.transformBounds` if production consumers need normalized boxes or transformed axis-aligned bounds.
- Make `Rect.intersection` and `Rect.overlaps` document whether touching edges count as overlap. Keep both variants if necessary: `intersectsInclusive` for broad-phase hit-testing and `overlapsArea` for non-empty area.

### 2. Replace the ad hoc SVG path parser with a grammar-backed parser

Rewrite `parseSvgPath` around a real tokenizer/parser state machine instead of token skipping:

- Tokenize commands and numbers with source offsets.
- Parse repeated argument groups per command according to SVG path arity.
- Support `M/m`, `L/l`, `H/h`, `V/v`, `C/c`, `S/s`, `Q/q`, `T/t`, `A/a`, and `Z/z`.
- Preserve implicit `L/l` after `M/m`.
- Reject or diagnose malformed input such as missing coordinates, incomplete command groups, invalid flags, unexpected tokens, command streams before `M`, and unterminated exponent numbers.
- Return `Path` for valid input and expose a structured parse API for diagnostics, such as `parseSvgPathWithDiagnostics`, while making the main production parser fail clearly rather than substituting zero.

Implement SVG arc conversion:

- Convert endpoint-parameterized SVG arcs to one or more cubic Bezier segments.
- Apply the SVG radii correction algorithm when radii are too small.
- Respect `xAxisRotation`, `largeArcFlag`, and `sweepFlag`.
- Treat zero radii or same-point arcs according to SVG semantics: line or no-op as specified, with diagnostics where useful.
- Split arcs at 90 degrees or less for cubic accuracy.
- Add direct tests for absolute and relative arcs, rotated ellipses, large-arc/sweep flag combinations, degenerate arcs, and round trips through `pathToSvgString`.

Because Mog's `PathSegment` contract does not include arcs, the output should remain only `M`, `L`, `C`, `Q`, and `Z`.

### 3. Make path metric computation one shared engine

Introduce a path segment iterator and curve metric helper:

- Iterate over normalized drawable segments with `start`, `end`, `segment`, `subpathStart`, and `subpathIndex`.
- Convert line, quadratic, cubic, and close segments to metric records.
- Build adaptive flattened polylines for curves with a configurable tolerance.
- Cache per-path metric tables where safe, or expose a `buildPathMetrics(path, options)` helper for callers that repeatedly query the same path, such as text-on-path layout.

Refactor:

- `pathLength` to sum the shared metric records.
- `pointAtLength` to use the same cumulative-length table as `pathLength`.
- `distanceToPath` and `pointOnPath` to use the same flattening tolerance and segment-distance logic.
- Bezier nearest-point helpers to use adaptive subdivision plus Newton/ternary refinement on narrowed candidates rather than fixed sampling alone.
- `pathBoundingBox` to use exact Bezier extrema for curves and include close segments consistently.
- `reversePath` to preserve compound subpaths, closed status, and quadratic/cubic reversal across multiple `M` segments.

Expected production benefit:

- Text effects no longer get tangents from an approximation that disagrees with `pathLength`.
- Drawing hit tests and distance checks stop missing high-curvature Bezier segments because of fixed sample counts.
- Shape diagnostics and bounds become stable for paths generated from OOXML and SVG arcs.

### 4. Move OOXML guide formula evaluation into geometry

Create a geometry-owned guide module, for example `guides.ts` or `ooxml-guides.ts`, that exports:

- Built-in OOXML guide variables for width/height.
- Angle conversion helpers for OOXML 60000ths-of-a-degree units.
- A strict formula evaluator for ECMA-376 operations currently duplicated in `connection-points.ts` and `shapes/src/custom-geometry.ts`: `val`, `*/`, `+-`, `+/`, `?:`, `min`, `max`, `abs`, `sqrt`, `at2`, `sin`, `cos`, `tan`, `cat2`, `sat2`, `mod`, and `pin`.
- Structured diagnostics for unknown operations, missing arguments, unknown references, division by zero, non-finite results, and invalid dimensions.
- A resolver for coordinate references that distinguishes numeric literals from guide names and reports unknown names.

Then refactor:

- `connection-points.ts` to call the shared guide evaluator.
- `canvas/drawing/shapes/src/custom-geometry.ts` to import the shared evaluator from `@mog/geometry` instead of maintaining a second copy.
- Shape custom-geometry arc conversion to reuse a geometry-owned OOXML visual-angle arc-to-cubic helper, separate from SVG endpoint arcs.

This reduces a high-risk duplicated contract: custom geometry paths and connection points currently evaluate the same OOXML guide language independently, and both silently fall back to zero for unknown names/ops.

### 5. Strengthen connection point and connector routing APIs

Extend the connection point contract:

- Keep `resolveConnectionPoints` for simple point arrays.
- Add a strict/diagnostic variant that returns points plus guide/coordinate issues.
- Add `resolveConnectionPointByIndex(data, bounds, index)` so connector rerouting can use actual preset connection sites when data is available.
- Add a typed fallback for generic rectangles that maps standard site indexes `0..3` to top/right/bottom/left and documents the fallback for `4+`.
- Include angle/orientation metadata from `ConnectionPointDef.ang` when present so arrowhead orientation and route heuristics can eventually use it.

Improve `connector-routing.ts`:

- Validate route inputs and normalize non-finite/degenerate bounds through diagnostics rather than producing accidental centers.
- Keep straight, bend, curve, and longCurve outputs but add route metadata where useful: start, end, control points, bend points, and bounding box.
- Support source/target connection-site data as an option to `routeConnector` so diagram and spreadsheet callers do not need to reimplement endpoint resolution.
- Ensure `auto` and `radial` behaviors are deterministic for coincident centers, zero width/height, and negative or normalized bounds.

Consumer updates:

- `apps/spreadsheet/src/coordinator/connector-rerouting.ts` should call the new site-index resolver when a shape exposes preset connection data, with the current generic rectangle mapping as a documented fallback.
- `canvas/drawing/diagram/src/engine/algorithms/connector.ts` should route through the unified `routeConnector` entry point rather than manually switching on route style.

### 6. Expand diagnostics into a production contract

Upgrade `diagnostics/validators.ts` so validators cover the full geometry surface:

- Path diagnostics:
  - no initial `M`
  - drawable segment before a current point
  - `Z` before a subpath start
  - inconsistent `closed` and `subPaths`
  - non-finite coordinates in every segment type
  - zero-length lines, degenerate curves, duplicate consecutive points
  - self-intersection warnings for closed polygons where cheap enough
  - malformed parse diagnostics from SVG parsing
- Transform diagnostics:
  - non-finite values
  - singular and near-singular matrices
  - extreme scaling/shear/translation
  - reflection/negative determinant info when consumers care about winding
- Bounding-box diagnostics:
  - non-finite values
  - negative dimensions
  - zero-area, zero-width, and zero-height boxes
  - extreme values
  - normalization suggestions
- Guide diagnostics:
  - unknown guide references
  - unknown formulas
  - missing arguments
  - division by zero
  - non-finite formula output
- Connector diagnostics:
  - unresolved source/target connection site
  - route with non-finite endpoint/control point
  - route whose computed bounding box is empty or inconsistent

Expose diagnostics through a stable namespace, and use it from shapes/text-effects/diagram tests that currently only assert basic path validity.

### 7. Fix `BoundedCache` as a generic utility

Patch `BoundedCache` with the same rigor as math primitives:

- Constructor validates `maxSize` is a finite positive integer.
- `get` checks `this._map.has(key)` first so cached `undefined` values still count as hits and refresh recency.
- Eviction uses the iterator result's `done` flag, not `firstKey !== undefined`, so `undefined` can be a valid key.
- Add optional introspection helpers only if production consumers need them: `maxSize`, `keys()`, `values()`, or `entries()`.
- Keep it dependency-free and small.

Add tests for `undefined` values, `undefined` keys, non-integer/NaN/Infinity max sizes, recency refresh, updates, deletes, and clearing.

### 8. Make the public API surface intentional

Audit root and subpath exports after the implementation:

- Root namespaces should include all production-safe modules consumers are expected to use: `Matrix`, `Transform`, `PathOps`, `Rect`, `Diagnostics`, `ConnectorRouting`, `ConnectionPoints`, and any new `Guides`/`Arc`/`Metrics` namespace.
- Avoid exposing internals solely for tests.
- If production callers need `HitTest`, `Bezier`, `Polygon`, or `Point`, export them intentionally rather than allowing deep imports.
- Update package `exports` for new subpaths only when there is a real public package boundary need. Do not add subpath exports as compatibility shims.

### 9. Update production consumers systematically

After geometry is improved, update consumers that depend on the changed contracts:

- `canvas/drawing/shapes/src/custom-geometry.ts`: remove duplicated guide formula evaluator and duplicated OOXML arc-to-cubic logic; import the geometry-owned evaluator/converter.
- `canvas/drawing/shapes/src/diagnostics/validators.ts`: consume richer geometry diagnostics.
- `canvas/drawing/diagram/src/engine/algorithms/connector.ts`: use the unified connector routing API.
- `apps/spreadsheet/src/coordinator/connector-rerouting.ts`: use indexed connection-site resolution where possible, with explicit generic fallback.
- `canvas/drawing/text-effects/src/warp/path-text.ts`: use precomputed path metrics when laying out many glyphs along the same path.
- `charts/src/interaction/pick.ts`: replace bounding-box approximation for SVG path marks with `PathOps.parseSvgPath` plus path bounds or exact path hit testing where the path is valid.
- `canvas/drawing/engine/src/spatial/spatial-query.ts`: keep broad-phase speed but use clarified inclusive/intersection semantics from `Rect`.

Do not make geometry depend on any of these consumers. The dependency direction must remain consumer -> geometry.

## Tests and verification gates

Geometry package gates:

- `cd mog/canvas/drawing/geometry && pnpm test`
- `cd mog/canvas/drawing/geometry && pnpm typecheck`
- Or equivalent workspace-filter commands if package scripts are wired that way: `pnpm --filter '@mog/geometry' test` and `pnpm --filter '@mog/geometry' run check-types`

New and updated geometry tests:

- SVG parser:
  - all SVG commands, absolute and relative
  - repeated argument groups
  - implicit line segments after move commands
  - malformed input diagnostics
  - exponent/decimal/negative token cases
  - `A/a` arcs converted to cubic Beziers
  - large-arc/sweep flag combinations
  - rotated ellipse arcs
  - degenerate arcs
- Path metrics:
  - length/point-at-length consistency
  - tangent normalization
  - path queries before start, at start, at end, and past end
  - high-curvature quadratic and cubic curves
  - compound paths and close segments
  - adaptive flattening tolerance tests
- Bezier:
  - exact endpoints and derivatives
  - bounding boxes including extrema
  - nearest-point cases near endpoints, inflection-heavy curves, degenerate curves
  - quadratic-to-cubic equivalence
- Rect/primitives:
  - normalized and negative-input boxes
  - zero-width/height boxes
  - inclusive vs area-overlap semantics
  - non-finite diagnostic behavior
- Matrix/transform:
  - multiplication order
  - inverse composition round trips
  - near-singular matrices
  - decomposition with negative scale/reflection
- OOXML guides:
  - every supported formula op
  - built-in variables and angle constants
  - unknown references and unknown ops as diagnostics
  - division by zero behavior
  - match current shape custom-geometry fixtures after migration
- Connection points and routing:
  - connection site index resolution
  - preset `cxnLst` data resolution
  - auto/radial deterministic behavior
  - zero-size and coincident-center cases
  - route metadata and route bounding boxes
- `BoundedCache`:
  - undefined key/value behavior
  - finite positive integer capacity validation
  - LRU refresh on get
  - update/delete/clear semantics

Consumer behavior gates:

- `pnpm --filter '@mog/drawing-engine' test`
- `pnpm --filter '@mog/shape-engine' test`
- `pnpm --filter '@mog/text-effects-engine' test`
- `pnpm --filter '@mog/diagram-engine' test`
- Spreadsheet connector-rerouting tests in `apps/spreadsheet` for moving/resizing shapes with connected connectors.
- Chart picking tests for rect/circle/diamond/arc/path marks if `charts` is touched.
- PDF graphics tests if path serialization or geometry path types affect PDF rendering.

Type gates:

- Run the geometry package typecheck after package source changes.
- Run package typechecks for every touched consumer.
- Run repo-wide `pnpm typecheck` for the final TypeScript integration unless the implementation workstream defines a narrower explicit type gate.

Production UI/e2e gates:

- If connector rerouting or drawing interaction behavior is changed, run the spreadsheet dev server and manually exercise through real UI input:
  - draw or load two shapes and a connector
  - move and resize each connected shape
  - verify connector endpoints remain attached to the expected sites
  - test a non-rectangular preset with multiple connection points
  - test chart/shape hit selection around edges and empty interior regions
- E2E tests should drive keyboard, mouse, and clipboard/UI paths rather than direct state mutation.

## Risks, edge cases, and non-goals

Risks:

- Tightening parser and guide diagnostics will surface malformed existing shape data that was previously hidden by zero fallbacks. The correct response is to fix the upstream data or call site, not to preserve the silent fallback.
- SVG arc conversion is numerically sensitive. The SVG endpoint-arc algorithm must be tested against known reference cases before replacing the current line downgrade.
- OOXML arcs and SVG arcs use different conventions. Sharing only the low-level cubic subdivision helper is safe; conflating their angle systems is not.
- Adaptive path metrics can increase CPU cost if implemented without caching or tolerance controls. Text-on-path and repeated hit-testing need reusable metric tables.
- Changing rect intersection semantics can affect selection and broad-phase hit-testing. Introduce explicit inclusive/area variants if both meanings are needed.
- Export changes can accidentally expand the package API. Add only intentional exports tied to production callers.
- Connector site resolution may require data that spreadsheet floating objects do not currently expose. If so, implement the geometry resolver first and update the smallest public contract needed for shape connection data, while keeping fallback behavior explicit.

Edge cases to cover:

- Empty paths, move-only paths, and compound paths with mixed open/closed subpaths.
- Paths with `Z` followed by another drawable segment before a new `M`.
- Zero-length lines and curves whose control points collapse to one point.
- Very small and very large coordinate values.
- Non-finite input from imported files.
- Negative or zero shape bounds.
- Degenerate transforms, reflections, and near-singular matrices.
- Coincident connector source/target centers.
- Connection point references to unknown guide names.
- Guide formulas with division by zero or missing arguments.
- `BoundedCache` with `undefined` keys/values.

Non-goals:

- Do not move geometry into Rust for this workstream.
- Do not introduce Canvas, DOM, React, Yjs, or drawing-engine dependencies into `@mog/geometry`.
- Do not optimize generated `dist` output directly; update source and let the normal build regenerate outputs.
- Do not add compatibility shims that keep incorrect path or guide behavior alive.
- Do not rewrite the full drawing renderer as part of this package improvement.
- Do not treat test-only helpers or mocks as the production path.

## Parallelization notes and dependencies on other folders, if any

This work naturally splits across parallel agents once the shared numeric contracts are agreed:

- Agent A: numeric core, rect/point/matrix/transform refactor, diagnostics baseline.
- Agent B: SVG parser, SVG arc conversion, path serialization, parser diagnostics.
- Agent C: Bezier/path metrics/hit-test engine and text-on-path metric integration.
- Agent D: OOXML guide evaluator, connection-point resolver, shape custom-geometry migration.
- Agent E: connector routing API and spreadsheet/diagram consumer updates.
- Agent F: verification and golden fixture expansion across geometry, shapes, drawing-engine, text-effects, diagram, charts, and spreadsheet.

Dependency order:

1. Numeric helpers and diagnostics codes should land first because every other slice uses them.
2. SVG arc conversion and path metrics can proceed in parallel after numeric helpers exist.
3. OOXML guide evaluation can proceed in parallel with SVG/path work, but shape custom-geometry migration depends on the new guide module.
4. Connector routing improvements depend on connection-point resolver work.
5. Consumer migrations depend on the relevant geometry APIs being finalized.
6. Full cross-package verification runs after all consumer migrations are integrated.

Cross-folder dependencies:

- `mog/canvas/drawing/shapes/src` for custom geometry, preset path generation, and shape diagnostics.
- `mog/canvas/drawing/engine/src` for spatial query, renderer path serialization, and hit-testing.
- `mog/canvas/drawing/text-effects/src` for text-on-path metrics and transforms.
- `mog/canvas/drawing/diagram/src` for connector algorithm output and routing.
- `mog/apps/spreadsheet/src/coordinator` for connector rerouting in the actual spreadsheet app.
- `mog/charts/src/interaction` for chart pick behavior.
- `mog/file-io/pdf/graphics/src` and `mog/file-io/print-export` for path/transform type compatibility.
- `mog/contracts` only if the implementation requires a new public geometry type, such as structured path parse diagnostics or connection-site metadata. Otherwise, keep all new implementation inside `@mog/geometry`.
