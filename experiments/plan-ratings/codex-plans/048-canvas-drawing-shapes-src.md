# 048 - Canvas Drawing Shapes Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/canvas/drawing/shapes/src`

Scope for this plan is the production `@mog/shape-engine` source: preset shape registration, OOXML custom geometry evaluation, path generation, text-in-shape metadata, drawing object output, and shape diagnostics. The folder currently contains the public engine entrypoint, generated preset data, spec-driven preset registration, custom Mog shape presets, shared path primitives, and diagnostics.

Adjacent production dependencies that must be considered:

- `canvas/drawing/geometry/src` because `@mog/shape-engine` depends on `@mog/geometry`, and `connection-points.ts` currently duplicates OOXML guide formula evaluation for connector snapping metadata.
- `canvas/drawing/engine/src` and `canvas/drawing-canvas/src` because they consume shape-engine output for SVG/canvas rendering, hit testing, shape support detection, and fallback decisions.
- `canvas/drawing/diagram/src` and `kernel/src/domain/shapes` because they call `createDrawingObject()` through production diagram and floating-object shape computation paths.
- `file-io/ooxml/types/src/drawings/preset.rs` and `infra/rust-bridge/bridge-ts/generated/ooxml-types.ts` because they define the canonical `ShapePreset` inventory that shape-engine should match.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`@mog/shape-engine` is a pure TypeScript computation package for turning shape preset names, dimensions, adjustments, and visual properties into `DrawingObject` geometry. Its exported surface includes:

- `generateShapePath()`, `isValidShapeType()`, `getRegisteredShapeTypes()`, and default adjustment lookup.
- OOXML custom geometry helpers: `evaluateGuides()`, `resolveOoxmlPath()`, `resolveOoxmlPaths()`, `customGeometryToPath()`, and SVG path parsing.
- Preset registry APIs for generators, defaults, categories, natural ratios, ratio locks, fill behavior, scaling mode, and text insets.
- `computeTextInset()` for shape-aware text boxes.
- `createDrawingObject()` for renderer-ready `DrawingObject` output.
- Diagnostics that validate generated geometry, compare shape data, and produce human-readable reports.

The main production geometry source is `presets/spec-presets.ts`, which loads `presets/preset-shape-data.json` and registers each JSON shape through the custom geometry evaluator. The JSON currently contains 186 shapes, 319 paths, 2,907 path commands, 3,612 computed guides, 298 adjustment defaults, and connection point metadata for 172 shapes with 848 total connection points. The `ooxml-coverage.test.ts` test documents a current gap: `upArrow` is excluded through `UNSUPPORTED_PRESETS` even though the canonical Rust/bridge `ShapePreset` inventory includes 187 OOXML shape types plus Mog's `textBox` extension.

Downstream usage makes this folder part of the production rendering path, not a standalone fixture:

- `canvas/drawing-canvas/src/renderers/shape.ts` calls `createDrawingObject()` while rendering `ShapeScene` objects and registering hit-test bodies.
- `canvas/drawing/engine` integration tests exercise `shape-engine -> DrawingObject -> drawing-engine -> SVG` and hit-test path construction for all registered shapes.
- `kernel/src/domain/shapes/shape-computation.ts` wraps `createDrawingObject()` for kernel shape computation with caching and theme color resolution.
- `canvas/drawing-canvas/src/shape-rendering-info.ts` still unions the shape-engine registry with a hardcoded fallback set and explicitly says that fallback can be removed once shape-engine has full coverage.

## Improvement objectives

1. Make the shape catalog complete and canonical.

   - Register every canonical OOXML `ST_ShapeType` represented by `ShapePreset`, especially the currently missing `upArrow`.
   - Decide and document the contract for Mog-specific entries such as `circle`, `pill`, `banner`, `lineArrow`, `lineDoubleArrow`, `curve`, `connector`, and `textBox` so the registry, contracts, and UI support lists do not drift.
   - Remove `UNSUPPORTED_PRESETS` once the generated data and registry are complete.

2. Make generated preset data reproducible from one authoritative source.

   - Replace the split `extract-preset-shapes.py` and `extract-connection-points.ts` flow with a single deterministic generator that extracts adjustment guides, geometry guides, paths, fill/stroke attributes, and connection points in one pass.
   - Fix stale or incorrect source-path assumptions in the extraction scripts. Current inspected paths for the script's documented sources were absent in this checkout, so the generator should accept a checked-in spec XML path or explicit environment override and fail with a precise missing-source message.
   - Add generated-data integrity checks: expected canonical count, duplicate handling, sorted output, source checksum, command counts, and connection point counts.

3. Unify OOXML geometry math across path generation and connector metadata.

   - Move the shared OOXML guide formula evaluator to the lowest correct public package boundary, preferably `@mog/geometry`, because shape-engine already depends on geometry and geometry's `connection-points.ts` currently has its own evaluator.
   - Use the same evaluator for shape paths, text/connection metadata, diagnostics, and connector snapping.
   - Preserve all ECMA-376 guide operations already implemented in shape-engine: `val`, `*/`, `+-`, `+/`, `sin`, `cos`, `tan`, `at2`, `cat2`, `sat2`, `?:`, `min`, `max`, `abs`, `sqrt`, `mod`, and `pin`.

4. Turn preset metadata into a validated source of truth.

   - Keep categories, natural ratios, ratio locks, scaling modes, unfilled/stroke-only behavior, text insets, and connection points as declarative metadata with coverage validation.
   - Ensure every metadata key corresponds to a registered preset and every canonical preset has either explicit metadata or an intentionally documented default.
   - Expose read-only metadata APIs so downstream UI code can stop carrying duplicated support/category/display-name lists.

5. Strengthen geometry fidelity beyond snapshot stability.

   - Add semantic contract tests for bounding boxes, closed/subpath semantics, finite coordinates, adjustment bounds, stroke-only paths, arc conversion, multi-path shapes, and fill/stroke filtering.
   - Add multi-size and multi-adjustment golden metrics for every shape, not just 100x100 snapshots.
   - Verify representative shapes through the production rendering and hit-test path, not through a test-only path generator.

6. Make diagnostics useful for systematic audits.

   - Extend diagnostics to report catalog coverage, missing metadata, generated-data provenance, path command statistics, connection point counts, text inset coverage, and per-shape geometry metrics.
   - Make comparison diagnostics path-aware enough to compare normalized segment streams and numeric tolerances, not just shallow object fields.

## Production-path contracts and invariants to preserve or strengthen

- `@mog/shape-engine` remains pure computation: no React, DOM, Canvas, Yjs, kernel, or `mog-internal` dependency.
- Public dependency direction stays `@mog/shape-engine -> @mog/geometry`, `@mog-sdk/contracts`, and `@mog/bridge-ts`; never the reverse unless the shared code is moved to a lower-level package.
- `generateShapePath()` stays the single production path for preset geometry. Tests and diagnostics should call the same generator used by renderers.
- `createDrawingObject()` continues to sanitize invalid dimensions for drawing object output and to map geometry, visual properties, 3D properties, and text body data into contracts.
- Unknown shape types remain explicit errors from `generateShapePath()` and `null` from kernel `computeShape()` after validation; do not silently fall back to rectangles in the renderer path.
- Adjustment defaults and names come from OOXML `avLst`; user-provided adjustments override defaults without changing the registered default catalog.
- OOXML path commands preserve command order and coordinate spaces. `path.w`/`path.h` scaling, `fill="none"`, `stroke=false`, compound subpaths, and close commands must survive conversion.
- Arc conversion must preserve visual-angle semantics for non-circular ellipses and continue splitting large sweeps into cubic Beziers.
- Text inset computation must be deterministic for any registered shape and must not produce negative usable dimensions after clamping.
- Natural ratios, ratio locks, and uniform scaling must not change the geometry contract of fill-mode shapes.
- Connection point resolution must use the same guide values as the shape path for the same dimensions and adjustments.
- The canonical TS `ShapePreset` type exported from bridge output and the Rust `ooxml-types` `ShapePreset` inventory must agree with the shape-engine canonical OOXML registry.
- `canvas/drawing-canvas` support detection should eventually trust shape-engine metadata rather than a hardcoded fallback set for covered shapes.

## Concrete implementation plan

1. Write the shape catalog contract before changing generation code.

   - Define a canonical catalog split into `ooxmlPreset`, `mogCustomShape`, and `nonShapeRendererPrimitive`.
   - Treat the 187 OOXML `ShapePreset` tokens as required shape-engine coverage, and treat `textBox` as a required documented extension. If `textBox` should render as rectangle geometry, register it as a rectangle alias with text-specific metadata; if text boxes remain a separate object type, encode that as a non-shape renderer primitive and keep it out of `generateShapePath()`.
   - Decide whether `connector` belongs in shape-engine. Current contracts list `connector` as a `ShapeType`, but canvas has a separate connector renderer. Keep it out of the preset registry unless connectors should be renderable through `generateShapePath()`.
   - Update stale comments such as "all 186" and "188 OOXML" once the canonical count is formalized.

2. Replace the preset data generation pipeline.

   - Create one generator under `canvas/drawing/shapes/scripts` that reads `presetShapeDefinitions.xml` and outputs `src/presets/preset-shape-data.json`.
   - Parse root names robustly, including the OOXML root typo `presetShapeDefinitons`, namespace/no-namespace XML variants, and duplicate top-level entries such as the documented `upDownArrow` duplicate.
   - Extract `avLst`, `gdLst`, `pathLst`, `cxnLst`, path width/height, fill, stroke, and all supported command types in one pass.
   - Fail fast if the source spec file is missing, if unique canonical shape count is not 187, if any Rust/bridge `ShapePreset` token is absent, or if any JSON key is not canonical.
   - Emit deterministic sorted JSON plus a small generated-data manifest with source path, source checksum, shape count, path count, command count, adjustment count, guide count, connection point count, and generation timestamp if the repo's generated-file conventions allow it.
   - Regenerate the JSON so `upArrow` is present and the connection point merge cannot skip shapes because the base JSON is incomplete.

3. Add typed JSON validation at the shape-engine boundary.

   - Replace ad hoc `as Record<string, JsonShapeDef>` casting in `spec-presets.ts` with a typed loader that validates required arrays and command payloads at module load or test time.
   - Represent `cxnLst` in the public internal type, not as an unused optional field.
   - Add validation helpers that check every path has at least one command, every command has the fields required by its type, every guide has a name/formula, and every shape key is unique and canonical.
   - Keep runtime overhead low in production by running expensive validation in tests or behind diagnostics, but keep the TypeScript types precise.

4. Move guide math to a shared production module.

   - Extract built-in variable creation, argument resolution, OOXML angle conversion, and formula evaluation into `@mog/geometry`.
   - Replace shape-engine's local `evaluateGuides()` internals with the shared evaluator while preserving the existing public export for compatibility.
   - Replace `canvas/drawing/geometry/src/connection-points.ts` evaluator internals with the same shared implementation.
   - Add evaluator tests that run the same formula cases through shape paths and connection point resolution to catch drift.

5. Rebuild preset registration around data plus validated metadata.

   - Keep `spec-presets.ts` as the single registration entry for OOXML presets, but split it into small modules: data loading, path generator creation, and metadata registration.
   - Register `upArrow` and remove every test exemption and comment that encodes the extraction gap.
   - Convert category, ratio, scaling, unfilled, and text-inset tables into declarative metadata maps with automated coverage tests.
   - Ensure every shape in metadata is registered and every registered OOXML shape has a category. Intentional defaults for ratio, scaling, fill, and text inset should be explicit in tests.
   - Keep current custom shape presets in `basic.ts`, but move their metadata into the same validation framework so custom shapes do not become untracked exceptions.

6. Add connection point APIs in the right package boundary.

   - Keep low-level point resolution math in `@mog/geometry`.
   - Add shape-engine APIs such as `getPresetConnectionData(shapeType)`, `getPresetConnectionPoints(shapeType, bounds, adjustments?)`, and `getPresetConnectionPointCount(shapeType)` if consumers need preset-owned data.
   - Ensure connection point guide evaluation uses the same adjustment defaults and user overrides as path generation.
   - Add contract tests for simple edges (`rect`, `line`), curved shapes (`ellipse`, `cloud`), adjusted arrows, and high-count shapes such as `star16`.
   - Wire downstream connector snapping only through the production data API once callers are ready.

7. Strengthen path generation contracts for all presets.

   - Replace "at least 150 presets" tests with exact canonical counts for OOXML plus documented custom shapes.
   - For every registered shape, generate paths at square, wide, tall, tiny, zero, and representative natural-ratio dimensions.
   - For every shape with adjustments, test defaults plus min/max/extreme user values. If the OOXML default has no explicit min/max, derive safe bounds from formula semantics or mark the default as unconstrained.
   - Assert finite coordinates for finite dimensions, no `NaN` control points, non-empty non-close segments, stable subpath closure, and expected bounding-box tolerances.
   - Add specific arc regression tests covering positive and negative sweeps, non-circular radii, full/semi sweeps, and current-point center reconstruction.
   - Add multi-path tests for shapes such as `cloud`, `bevel`, and action buttons where fill/stroke path filtering can accidentally drop visible geometry.

8. Replace broad snapshots with layered fidelity fixtures.

   - Keep snapshots only as a coarse regression guard for normalized segment streams.
   - Add compact golden metrics per shape and size: segment type sequence, segment count, subpath count, closed subpath count, bounding box, total path length range, connection point count, and text inset margins.
   - Generate expected metrics from the production generator and review changes as data updates, not as one-off hand assertions.
   - Add visual smoke coverage through `drawing-engine` SVG output for all registered shapes and a smaller browser/canvas smoke set for shape families.

9. Remove downstream fallback duplication after catalog completion.

   - Update `canvas/drawing-canvas/src/shape-rendering-info.ts` to consume shape-engine metadata for support, category, and display name instead of unioning the registry with `HARDCODED_SHAPE_TYPES`.
   - Keep renderer-specific primitives such as `connector` outside shape-engine if they are not generated through `createDrawingObject()`, but document them separately in the drawing-canvas layer.
   - Update kernel shape computation tests so `upArrow` and all other canonical shapes validate through `computeShape()`.
   - Update diagram output tests for shape types parsed from OOXML `prstGeom` so import/render paths exercise the canonical registry.

10. Upgrade diagnostics and reports.

   - Add a catalog validation report that returns counts, missing canonical tokens, unknown JSON tokens, missing metadata, duplicated categories, unsupported custom entries, and stale fallback entries.
   - Extend `validateShape()` to include subpath counts, fill/stroke status, normalized bounding box, connection point count, and text inset result when requested.
   - Extend `compareShapes()` with path-aware comparison for arrays of path segments using numeric tolerances and stable property paths.
   - Add tests that diagnostics flag the exact class of issue, not just that a report string contains a line.

11. Clean up docs and comments.

   - Update `canvas/drawing/README.md` from "80+ OOXML presets" to the new exact catalog contract.
   - Document the generation command, source XML requirement, and expected generated-data counts.
   - Document why custom shapes are separate from OOXML presets and why connector/textbox objects may have separate renderer semantics.

## Tests and verification gates

Required focused tests during implementation:

- `pnpm --filter '@mog/shape-engine' test`
- `pnpm --filter '@mog/shape-engine' typecheck`
- `pnpm --filter '@mog/geometry' test` and `pnpm --filter '@mog/geometry' typecheck` if guide math or connection-point utilities move into geometry.
- `pnpm --filter '@mog/drawing-engine' test` for SVG and hit-test integration after shape path changes.
- `pnpm --filter '@mog/drawing-canvas' test` for support metadata, shape renderer, and fallback removal.
- `pnpm --filter '@mog/diagram-engine' test` if diagram layout/output wiring changes.
- Relevant kernel shape tests, including `kernel/src/domain/shapes/__tests__/shape-computation-e2e.test.ts`, after kernel shape computation or `ShapeType` behavior changes.
- `cargo test -p ooxml-types shape_preset_spec_xml_roundtrip` after changing the canonical OOXML inventory contract.

Required final gates:

- `pnpm --filter '@mog/shape-engine' test`
- `pnpm --filter '@mog/shape-engine' typecheck`
- `pnpm typecheck` for TypeScript contract integrity across downstream consumers.
- `cargo test -p ooxml-types` if the implementation touches Rust OOXML preset contracts or generated bridge type assumptions.

UI and production-path verification:

- Run the app or drawing lab and exercise shape insertion/rendering for representative families: rectangles, arrows including `upArrow`, flowcharts, stars, callouts, connectors, text-heavy shapes, and custom shapes.
- Verify through real rendering paths that `createDrawingObject()` output renders in Canvas/SVG, participates in hit testing, and does not rely on `drawing-canvas` fallback support for covered shape types.
- For connector snapping work, exercise real connector endpoint interactions against resolved connection points rather than direct state mutation.

Do not count a regenerated snapshot suite alone as verification. The acceptance signal is complete catalog coverage plus production renderer, hit-test, text, and connection metadata behavior.

## Risks, edge cases, and non-goals

Risks:

- The current generated-data source path is not present in this checkout. The first implementation step may need to locate or restore the authoritative spec XML before regeneration can proceed.
- `upArrow` may be missing because of a duplicate or parsing edge case in the source XML rather than a simple omission. The generator must prove the full unique token set instead of hand-adding one shape.
- Moving guide math into `@mog/geometry` can change numeric behavior for both paths and connector points. Tolerance-based tests must pin the intended semantics.
- Removing drawing-canvas fallback too early can break renderer support for custom or renderer-only `ShapeType` values such as `connector`.
- Exact geometry snapshots may churn when arc conversion or path filtering improves. Golden metrics should distinguish intentional fidelity improvements from accidental geometry loss.
- `textBox` is present in the Rust/bridge `ShapePreset` extension but is also a distinct floating object concept. Its contract must be explicit before adding or excluding it from the shape registry.

Edge cases to cover:

- Duplicate top-level shape definitions in the OOXML source, especially `upDownArrow`.
- Shape paths with `stroke=false`, `fill="none"`, multiple paths, and multiple closed subpaths.
- Shapes with only open strokes: lines, brackets, braces, connectors, and arcs.
- Shapes with many arcs or high connection-point counts: action buttons, cloud, gears, stars, and circular arrows.
- Wide and tall dimensions for uniform-mode shapes versus fill-mode shapes.
- Zero, negative, `NaN`, `Infinity`, very small, and very large dimensions across `generateShapePath()` and `createDrawingObject()`.
- Adjustments at defaults, user extremes, invalid names, repeated names, `NaN`, and out-of-range values.
- Text inset behavior for narrow shapes, diamond/triangle-like shapes, and shapes with slanted sides.
- Connector points that reference adjustment guides, computed guides, built-in angle constants, or missing guide names.

Non-goals:

- Do not introduce a second renderer or alternate shape generation path.
- Do not patch only `upArrow` by hand while leaving the extraction and coverage contract broken.
- Do not optimize test-only visual harnesses as the primary outcome.
- Do not make `mog` depend on `mog-internal` or use private planning data in public packages.
- Do not preserve downstream hardcoded fallback lists once shape-engine metadata can provide the real production contract.
- Do not hide unsupported shapes behind silent rectangle fallbacks in the production rendering path.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the catalog contract is written down.

- Agent A: catalog and generator contract. Compare `preset-shape-data.json`, Rust `ooxml-types` `ShapePreset`, bridge TS `ShapePreset`, contracts `ShapeType`, and drawing-canvas fallback lists; produce the exact canonical/custom/renderer-only classification.
- Agent B: generator implementation. Build the one-pass XML generator, regenerate JSON, add generated-data integrity tests, and remove the `UNSUPPORTED_PRESETS` gap.
- Agent C: shared guide math. Move formula evaluation into `@mog/geometry`, update shape-engine and connection-points callers, and add cross-package evaluator tests.
- Agent D: metadata and APIs. Refactor categories, ratios, scaling, unfilled state, text insets, and connection points into validated metadata maps and add shape-engine read-only metadata exports.
- Agent E: fidelity tests. Replace weak count/snapshot coverage with semantic geometry, adjustment, arc, text, connection point, and rendering-path tests.
- Agent F: downstream integration. Remove drawing-canvas hardcoded fallback for covered shapes, update kernel/diagram consumers, and run production rendering and hit-test verification.

Dependencies:

- The catalog classification should land before generator or fallback removal work.
- The generator should land before exact-count tests are tightened, otherwise tests will encode the current 186-shape gap.
- Shared guide math can proceed in parallel with generator work, but connection point API tests should wait until regenerated data includes complete `cxnLst` coverage.
- Downstream fallback removal should wait until shape-engine exact coverage and metadata validation pass.
- Any changes to `ShapePreset` in Rust or bridge output must be verified before shape-engine treats the bridge type as authoritative.
