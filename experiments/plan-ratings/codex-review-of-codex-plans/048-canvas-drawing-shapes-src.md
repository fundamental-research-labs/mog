Rating: 8/10

Summary judgment

This is a strong, source-aware plan. It correctly treats `canvas/drawing/shapes/src` as production geometry infrastructure rather than a fixture folder, and its main diagnosis matches the current code: `preset-shape-data.json` has 186 shapes while the Rust/bridge `ShapePreset` inventory is 187 OOXML presets plus `textBox`; `ooxml-coverage.test.ts` explicitly exempts `upArrow`; the JSON data has the cited 319 paths, 2,907 commands, 3,612 geometry guides, 298 adjustment defaults, and 172 shapes with 848 connection points; and `connection-points.ts` duplicates the OOXML guide evaluator.

The plan is high quality because it proposes a structural fix: canonical catalog contract, deterministic generator, shared formula evaluator, validated metadata, stronger fidelity tests, downstream fallback cleanup, and production renderer/hit-test verification. It loses points because several key contracts are still deferred instead of specified, and some verification/golden-data language risks tautological tests unless tightened.

Major strengths

- The scope is accurate and production-path relevant. It names the shape-engine entrypoints, generated preset data, diagnostics, drawing-canvas renderer path, kernel shape computation path, diagram output path, and Rust/bridge canonical preset sources.
- The plan avoids a one-off `upArrow` patch. It asks for a generator and inventory contract that would close the full category of catalog drift.
- The architectural direction is mostly sound: keep shape-engine pure, move shared OOXML math down to `@mog/geometry`, keep public dependency direction clean, and expose metadata so downstream UI code can stop duplicating support/category/display-name lists.
- The current weak test posture is identified well. Existing tests are mostly count, no-NaN, non-degenerate, and snapshot checks; the proposed semantic coverage for bounds, arcs, subpaths, fill/stroke behavior, text insets, connection points, renderer output, and hit testing is the right upgrade.
- The verification gates are broad enough to catch most production regressions, including shape-engine, geometry, drawing-engine, drawing-canvas, diagram, kernel, Rust OOXML types, and real UI/browser exercise for representative shape families.

Major gaps or risks

- The most important catalog decisions are still deferred. The plan says to decide whether `textBox`, `connector`, `circle`, `pill`, `banner`, `lineArrow`, `lineDoubleArrow`, and `curve` belong in the shape-engine registry, but a plan at this level should provide the expected classification table or an explicit discovery task that produces one before implementation. This matters because `circle` and `pill` are registered in shape-engine but are not in the public `ShapeType` union, while `connector` is in `ShapeType` and drawing-canvas support metadata but is also rendered through a separate connector scene path.
- The generator provenance contract is not precise enough. The existing scripts reference missing or stale source paths, and the plan says to accept a checked-in spec XML path or environment override. It should state the intended source artifact policy, command, manifest schema, checksum behavior, and error message contract. A generation timestamp also conflicts with deterministic/reproducible output unless it is omitted, source-derived, or kept out of committed generated files.
- The golden-metrics proposal needs a non-tautological acceptance model. If expected metrics are generated from the same production generator under test, they become useful regression baselines only after review, not independent fidelity evidence. The plan should say how baselines are approved, what tolerance rules apply, and whether any external OOXML/spec-derived or visual reference is used for initial acceptance.
- Moving guide math to `@mog/geometry` is directionally right but underspecified. The plan should define the exported evaluator API and exact semantics for unknown guide names, invalid formulas, division by zero, missing args, angle units, adjustment overrides, repeated adjustment names, `NaN`, and out-of-range adjustment values. Current shape-engine and geometry evaluators already differ subtly in implementation style, so the migration needs exact behavior contracts, not only operation coverage.
- The plan is very broad. That is acceptable for this code area, but the sequencing should define phase-level acceptance checkpoints. Without that, implementers could land generator changes, evaluator changes, metadata exports, downstream fallback removal, and diagnostics in an order that makes regressions hard to attribute.
- Downstream fallback removal is correctly identified but risky. The plan should explicitly protect renderer-only primitives and custom shapes during the migration, especially values that drawing-canvas currently reports as supported through the hardcoded set but that may not be valid `createDrawingObject()` inputs.

Contract and verification assessment

The contract section is one of the plan's strongest parts. It preserves the pure-computation boundary, avoids silent rectangle fallback, keeps `generateShapePath()` as the production geometry path, calls out adjustment-default behavior, preserves path command ordering and fill/stroke semantics, and requires connection points to use the same guide values as paths. Those are the right invariants.

The verification section is also strong, especially the requirement to exercise real Canvas/SVG rendering, hit testing, representative shape insertion, and connector snapping through user-facing paths. The missing pieces are narrower contract gates: a generator integrity test that compares JSON keys to Rust/bridge `ShapePreset` tokens, a checked manifest test, a bridge/generated-type consistency check if `ShapePreset` assumptions change, and type gates for the public object types if `ShapeType` is edited.

The typed JSON validation step should be made crisper. "At module load or test time" is too loose: production module-load validation may be acceptable for cheap structural checks, but expensive canonical coverage and metric validation should live in tests/diagnostics. The plan should state which invariants are enforced in production imports and which are CI-only.

Concrete changes that would raise the rating

- Add an explicit catalog table before implementation: `ooxmlPreset`, `mogCustomShape`, `rendererOnlyPrimitive`, and `importAlias`, with the exact expected registry behavior for every non-OOXML token currently in shape-engine, `ShapeType`, bridge output, and drawing-canvas fallback metadata.
- Specify the generator contract: source XML location policy, override env var name, command, parser root/namespace handling, duplicate handling, manifest fields, checksum algorithm, committed outputs, and exact failure messages/counts.
- Remove or qualify volatile generated timestamps so regenerated files are deterministic.
- Define the shared OOXML evaluator API in `@mog/geometry`, including edge-case semantics and a cross-package test matrix that proves shape paths and connection points receive identical guide values.
- Split the implementation into acceptance checkpoints: catalog contract, generator/upArrow coverage, evaluator migration, metadata API validation, fidelity tests, downstream fallback removal, diagnostics/docs.
- Make golden metrics reviewed fixtures with named tolerances and baseline-update rules, not merely values regenerated from the same production generator.
- Add explicit verification gates for generator integrity, Rust/bridge/JSON token parity, public `ShapeType` impacts, and browser/UI smoke around fallback removal and renderer-only primitives.
