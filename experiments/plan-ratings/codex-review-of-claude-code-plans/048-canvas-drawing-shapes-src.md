Rating: 8/10

## Summary judgment

This is a strong, production-relevant plan. It correctly treats `@mog/shape-engine` as a pure geometry contract package, identifies real fidelity gaps in the preset catalog, custom geometry conversion, metadata drift, connection points, text insets, and diagnostics, and proposes verification that would turn several current allow-lists and silent fallbacks into hard contracts.

The plan loses points because a few implementation details are not precise enough for the cross-package work it asks for. It leaves the JSON extraction pipeline as an investigation even though the repo already has `canvas/drawing/shapes/scripts/extract-preset-shapes.py` and `extract-connection-points.ts`; it overstates the direct impact of guide evaluation in `customGeometryToPath` because the public `CustomPathCommand` type is already numeric; and its fill/stroke fidelity stage does not account for the extractor currently persisting only `fill: "none"` and `stroke: false`, so richer OOXML fill modes are already lost before `customGeometryToPath` runs.

## Major strengths

- The defect inventory is concrete and mostly source-backed: the catalog has 186 entries, the generated `ShapePreset` union includes `upArrow` and `textBox`, `customGeometryToPath` evaluates guides and discards the map, `compareShapes` recurses through arrays after strict element inequality, and stale side-effect stub imports exist.
- The plan sets the right architectural boundary: keep shape generation pure, dependency-light, deterministic, and owned by `@mog/shape-engine`, with downstream renderers and routing treated as consumers rather than mixed into this package.
- The proposed invariants are the right ones: typed preset totality, no metadata for non-shapes, finite non-empty generated geometry, metadata completeness, and catalog reproducibility.
- Sequencing is mostly sensible: high-confidence totality and custom-geometry fixes first, then metadata/connection/text fidelity, then diagnostics and cleanup.
- Verification is much stronger than a compile-only gate. The plan calls for parametrized preset coverage, metadata drift tests, all-preset render validation, guide-resolution fixtures, multipath snapshots, connection point checks, arc edge cases, text containment, diagnostics tolerance tests, reproducibility, downstream integration, and type/lint gates.

## Major gaps or risks

- Stage A should name and audit the existing extraction scripts instead of treating the generator as unknown. The scripts already exist, and their documented source paths appear inconsistent with current repo layout, so the real first step is to make extraction reproducible and scripted, not merely "locate" it.
- The guide-evaluation objective needs a sharper API contract. `customGeometryToPath(guides, paths)` accepts `CustomPathCommand[]`, whose coordinates are numeric. If external OOXML callers need guide-name strings, the plan should specify either a typed overload accepting `GeometryPath[]`, a higher-level `customOoxmlGeometryToPath` wrapper, or required use of `resolveOoxmlPaths`; otherwise the fix risks becoming another internal-only cleanup.
- The fill-mode stage is under-specified. The JSON currently records only `fill: "none"` and `stroke: false`; `extract-preset-shapes.py` discards other fill values. Preserving `norm`/`lighten`/`darken` modes requires extractor, JSON schema, contracts, renderer, and tests, not just subpath assembly changes.
- Connection-point work should reuse or reconcile with `canvas/drawing/geometry/src/connection-points.ts`, which already resolves `cxnLst` data. A new shape-engine registry/accessor is still reasonable, but the plan should avoid duplicating guide evaluators and should include adjustments in the accessor contract.
- The plan should explicitly update the existing `canvas/drawing/shapes/__tests__/presets/ooxml-coverage.test.ts` unsupported `upArrow` allow-list, not only add a new totality test.
- The text-inset proposal is directionally right but algorithmically vague. "Largest axis-aligned inscribed rectangle" over Beziers/compound paths can be expensive and brittle; it needs bounded sampling rules, cache strategy, fallback behavior, and acceptance tolerances before implementation.
- `textBox` remains a product/contract decision. The plan flags it, but because totality depends on it, Stage A should state the owner/consumer evidence needed to choose rect-equivalent geometry versus documented non-geometry allow-list.

## Contract and verification assessment

The plan is strong on contracts at the shape-engine boundary: typed preset totality, metadata-to-generator consistency, deterministic path output, finite geometry, no disallowed dependencies, and downstream renderer awareness are all appropriate. It also correctly treats `Path`/`SubPath` fill metadata as a contracts-package change rather than a local field that can be smuggled into objects.

The main contract weakness is that some proposed APIs are underspecified. Connection sites should be exposed as either raw OOXML data plus a resolver or as `getConnectionSites(shapeType, bounds, adjustments)`; a shape-only map cannot represent width/height/adjustment-dependent guide resolution. Similarly, guide-name coordinates cannot be "fixed" in the current `CustomPathCommand` type without either changing the accepted input type or adding a separate OOXML custom-geometry entry point.

The verification plan is comprehensive, but it should include exact package commands such as `pnpm --filter @mog/shape-engine test` and `pnpm --filter @mog/shape-engine typecheck`/`check-types`, plus targeted downstream gates for any renderer/contract changes. For fill-mode work, snapshots of shape-engine data are not enough; at least one renderer-level assertion should prove the new metadata is consumed or intentionally staged behind a documented follow-up.

## Concrete changes that would raise the rating

- Replace "locate the generator" with an explicit audit/fix of `canvas/drawing/shapes/scripts/extract-preset-shapes.py`, `extract-connection-points.ts`, source XML provenance, package scripts, and byte-stable regeneration.
- Define the exact public API for unresolved OOXML custom geometry instead of relying on numeric `CustomPathCommand` to carry guide names.
- Expand Stage B objective 3 to include extractor preservation of all OOXML path fill modes, JSON schema updates, `@mog-sdk/contracts/geometry` changes, renderer consumption, and migration tests.
- Rework Stage C around existing `@mog/geometry` connection-point resolver or deliberately move that resolver into shape-engine with one shared guide evaluator.
- Add "remove `upArrow` from existing `UNSUPPORTED_PRESETS`" and "add/resolve `textBox` allow-list semantics" to the totality gate.
- Specify the text-inset derived algorithm in terms of sampling resolution, tolerance, caching, degenerate shapes, compound paths/holes, and measured performance bounds.
