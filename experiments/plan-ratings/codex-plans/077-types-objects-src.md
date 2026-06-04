# Plan 077: Harden `@mog/types-objects` Public Contracts

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/objects/src`

Scope: the public type contracts for floating spreadsheet objects, resolved drawing primitives, ink drawings, equation/OMML data, SmartArt/diagram models, and text effects. This includes the subpath exports currently served by `@mog/types-objects` and re-exported through `@mog-sdk/contracts`, especially:

- `objects/*`: floating object variants, anchors, object managers, projections, scene graph readers, mutators, and resolved drawing objects.
- `ink/*`: ink strokes, drawing objects, tool state, recognition results, rendering accessors, and spatial index contracts.
- `equation/*`: equation records, OMML AST, template metadata, and parse/render error contracts.
- `diagrams/*`: runtime diagram models plus OOXML layout/style/algorithm/data model contracts.
- `text-effects/*`: WordArt/text effect configuration, effect descriptors, presets, and rendering bridge contracts.
- `drawing/three-d`: shared 3D geometry, camera, material, and lighting primitives.

The plan intentionally includes dependent production paths that must change with these contracts: `contracts`, `runtime/sdk`, Rust `domain-types` and compute/file-io bridges, kernel floating object projection/mutation, canvas drawing/diagram/text-effect/ink renderers, spreadsheet UI collections, and `typeset/math-engine`.

## Current role of this folder in Mog

`mog/types/objects/src` is a Tier 1 type package. It is private as a package, but its declarations are part of the public SDK because `mog/contracts/src` re-exports these subpaths and the generated SDK/API spec records many `@mog/types-objects` owner packages.

The package is the shared contract layer for the object stack:

- Kernel maps Rust wire floating objects into these TypeScript object variants and exposes them through the spreadsheet object manager and projection interfaces.
- Canvas renderers consume the resolved drawing, scene graph, diagram, text effect, and ink contracts.
- File import/export bridges rely on the same shape, equation, diagram, OLE, slicer, and import-status vocabulary.
- `typeset/math-engine` consumes the equation AST/error/template types while owning actual parsing and rendering behavior.
- Public contracts expose runtime values for object type constants through `@mog-sdk/contracts/objects`, so type-only changes can still affect public declaration and runtime inventory gates.

The folder is already broad enough to be a central source of truth, but several contracts are underspecified or divergent between TypeScript, Rust, renderers, and public SDK surfaces. That makes this folder the right place to define the object taxonomy, serialized/domain/resolved model boundaries, unit semantics, and exhaustive enum lists.

## Improvement objectives

1. Make the floating object taxonomy exhaustive and cross-language aligned. Every object kind accepted from Rust, importers, UI collections, and public API surfaces should have an explicit TypeScript contract, mapper behavior, renderer/projection behavior, and editability/import-status policy.
2. Replace loose optional bags with discriminated contracts for anchors, positions, serialized payloads, and variant-specific patches so invalid states are rejected at compile time.
3. Split raw OOXML, persisted domain data, public API data, and resolved render primitives where they currently share one loose type.
4. Establish one canonical value table for repeated object vocabularies: object kinds, shape types, line dash styles, arrowheads, gradient units, bevel/material/light presets, text warp presets, SmartArt algorithm parameters, and OOXML style labels.
5. Make Map-vs-Record serialization boundaries explicit for drawing and diagram data instead of relying on ad hoc bridge casts.
6. Clarify package export policy. The package root currently exports nothing while subpaths carry the real contract; this should become either an intentionally empty, tested root or a collision-free namespace root.
7. Preserve the public SDK contract while improving accuracy. Public re-exports, declaration output, runtime export inventory, and generated API reports must change together.
8. Add verification that runs through production code paths: Rust wire hydration, TypeScript mappers, kernel projection/mutation, canvas rendering, spreadsheet UI operations, XLSX import/export, and SDK contract generation.

## Production-path contracts and invariants to preserve or strengthen

- `@mog/types-objects` must remain dependency-light. It may depend on core identity/result types and viewport geometry, but it must not create cycles by importing high-level kernel, canvas, spreadsheet app, or internal packages.
- `mog` must not depend on `mog-internal`; all production implementation remains in the public repo.
- Public SDK exports must stay intentional. Any runtime export moved into or out of contracts must update `tools/contracts-runtime-inventory.json` and the generated contract artifacts.
- Flat root exports must not introduce name collisions such as `ShapeType` across object and diagram domains. If a root export is retained, it should use namespaces or another collision-proof shape.
- `CanvasObject.id`, `type`, `containerId`, `anchor`, `zIndex`, `locked`, `printable`, and optional accessibility metadata remain the common base for renderable scene objects.
- `FloatingObjectBase.sheetId` must remain an alias of `containerId`, and `position` must remain an alias of `anchor` until the public migration is explicitly completed. Mappers should preserve this by construction, not by convention.
- Anchor contracts must encode valid shapes:
  - two-cell anchors require `from` and `to`.
  - one-cell anchors require `from` plus explicit extent.
  - absolute anchors require absolute origin and extent.
  - rotation and flips are transform properties with explicit units.
- Unsupported or degraded imports must preserve source intent through `ImportObjectStatus`; they must not silently become generic shapes.
- Slicers must respect the current workbook-level slicer model. If a sheet draw-layer marker is needed, it must be an explicit reference/anchor contract, not a revived JSON blob.
- Camera objects must have an explicit contract matching the Rust `CameraData` source reference and error state, even if initial rendering is a preserved placeholder.
- Object creation/update interfaces must be complete for all supported variants or explicitly delegated to a domain-specific manager such as ink drawings. Missing methods should be a deliberate contract, not drift.
- Scene graph readers and projection views remain synchronous read surfaces for renderers; mutations stay behind manager/mutator APIs.
- Serialized wire data and in-memory authoring data must be separate when their structures differ, especially `Map` versus `Record` for ink strokes, recognition results, and diagram nodes.
- Units must be named at the type boundary. Pixels, EMUs, points, percentages, degrees, radians, and OOXML fixed-point percentages cannot share unqualified `number` fields in new or revised contracts.
- Raw OOXML values, persisted domain values, and resolved render values may differ, but adapters must be exhaustive and tested.
- Equation storage remains OMML-first. LaTeX, AST, and image data are derived/cache fields unless the owning feature explicitly promotes them to canonical state.

## Concrete implementation plan

1. Inventory and freeze the exported surface before changing it.
   - Generate a symbol and subpath inventory for `@mog/types-objects` and the `@mog-sdk/contracts` re-export layer.
   - Classify each export as raw OOXML, persisted domain model, public API model, resolved render primitive, manager/projection interface, or bridge-only helper.
   - Decide the root export policy. Prefer either removing the unused package root export or replacing the empty root with namespace-only type exports such as object, ink, equation, diagram, and text-effect namespaces. Do not add a flat star barrel.
   - Add declaration/API report fixtures so accidental root expansion and public subpath changes are visible in review.

2. Build the floating object variant matrix and close every gap.
   - Create a single matrix covering `FloatingObjectKind`, TypeScript `FloatingObject`, Rust `FloatingObjectData`, import/export status, kernel mapper output, scene graph handling, worksheet collection/API surface, and UI editability.
   - Add explicit contracts for currently missing variants:
     - `CameraObject` with source reference, cached error/import status, accessibility metadata, and render placeholder policy.
     - `SlicerObjectRef` only if the draw layer needs a sheet-anchored visual marker; otherwise remove `slicer` from the TypeScript floating object union and keep slicers owned by workbook-level slicer state.
   - Replace any mapper fallback that coerces unknown/camera/slicer objects into shapes with exhaustive switches and preserved unsupported placeholders.
   - Align `CANVAS_OBJECT_TYPES`, `SPREADSHEET_OBJECT_TYPES`, Rust `FloatingObjectKind`, contract runtime exports, and SDK declarations from the same value table or generated fixture.

3. Make anchors and object positions discriminated.
   - Replace the optional `ObjectPosition` bag with `TwoCellObjectPosition`, `OneCellObjectPosition`, and `AbsoluteObjectPosition`.
   - Introduce explicit unit aliases for position fields, for example `CssPx`, `Emu`, `Degrees`, and `Radians`, using the least invasive branded or documented type strategy already used in core contracts.
   - Add conversion helpers at the Rust mapper/importer/exporter boundary so EMU wire anchors normalize into the public position contract once.
   - Keep backward-compatible alias fields only where they are already public, and mark the canonical field in documentation and type names.

4. Separate serialized, persisted, and in-memory models.
   - Add `SerializedDrawingObject` and `DrawingObject` conversion contracts for ink strokes, recognition results, tool state, and metadata. Serialized forms use plain records; in-memory authoring/rendering forms may use `Map`.
   - Add the same split for diagrams: serialized/public API diagram payloads use JSON-safe records or arrays, while runtime layout/editing may use `Map`.
   - Make `SceneObjectSnapshot.data` either variant-keyed or explicitly typed as an opaque payload with a discriminant so renderers can exhaustively narrow it.
   - Move duplicate `ImportObjectStatus` definitions behind one shared public contract and update file-io bridge imports to consume it.

5. Complete manager and mutator contracts for all supported object variants.
   - Align `IFloatingObjectManager`, `IFloatingObjectsView`, `IObjectMutator`, worksheet object collections, and command/action APIs.
   - Add missing production creation/update paths for shape, connector, chart, camera, drawing, and any retained slicer visual reference, or document and enforce delegation to `IDrawingObjectManager` or the chart/slicer owner.
   - Replace `Partial<FloatingObject>` update shapes with variant-safe patch types that cannot change immutable discriminants or corrupt variant-specific payloads.
   - Preserve synchronous render read APIs and asynchronous mutation APIs as separate contracts.

6. Normalize drawing, shape, and text-effect vocabularies.
   - Consolidate line dash styles, line caps, line joins, arrowhead styles, fills, gradient stops, bevel presets, materials, light rigs, and shadow/glow/reflection descriptors into canonical value tables with adapters for OOXML names and canvas-renderer names.
   - Reconcile `lgDash`/`longDash`, kebab-case/camelCase bevel names, and 0..1/0..100/0..100000 gradient stop offsets with explicit raw-versus-resolved types.
   - Cross-check shape types against Rust `domain-types`, DrawingML presets, and the canvas shape registry. Generate `const` arrays and unions from one source, or add exhaustive `satisfies` fixtures if generation is not yet available.
   - Keep `DrawingObject` as the resolved render primitive, not a persisted storage contract.

7. Tighten chart, slicer, and OLE boundaries without dependency cycles.
   - Replace `ChartObject.chartConfig: Record<string, unknown>` with an owned, typed shell that does not import high-level chart packages. The chart domain can provide a typed augmentation or reference payload from `types-data` or another correct owner.
   - Keep slicer canonical data in workbook-level slicer state. Any floating object involvement should be an anchor/reference, not the source of slicer configuration.
   - Preserve OLE payload import details with explicit renderability/editability and source-package metadata so export/import round trips do not depend on opaque unknown bags.

8. Make diagram and SmartArt OOXML contracts complete and self-checking.
   - Validate `QUICK_STYLE_IDS`, color themes, algorithm parameter IDs, constraint/axis/element/function enums, style labels, and DrawingML data model unions against the intended OOXML reference lists and current importer fixtures.
   - Replace comments like "exactly 14" or "all 41" with computed counts or generated documentation so drift is caught by type tests.
   - Split `Diagram` runtime authoring/layout data from OOXML layout/style/data-model definitions, then add adapters that are exhaustive over algorithm and style identifiers.
   - Ensure layout engine defaults and parser/importer output use the same contracts rather than parallel local copies.

9. Clarify equation and OMML ownership.
   - Keep `Equation` OMML-first, with LaTeX, AST, and cached images marked as derived data unless persisted ownership changes.
   - Decide whether OMML type guards belong in the public contract package or remain owned by `typeset/math-engine`. If public consumers need runtime guards, add them through the contracts runtime inventory instead of hiding them in a type package barrel.
   - Expand OMML AST coverage and parse error codes from real import/render cases, then add fixtures that verify unsupported nodes degrade through explicit error contracts.

10. Update public contract and generated SDK surfaces as part of the same change.
    - Update `mog/contracts/src` re-export shims and `contracts/package.json` subpaths together with `types/objects/package.json`.
    - Update `tools/contracts-runtime-inventory.json` for any runtime value movement.
    - Regenerate or refresh SDK API spec/report artifacts only through the established contract generation scripts.
    - Add migration notes for public declaration changes, especially if a root package export is removed or namespace-only exports replace the empty root.

## Tests and verification gates

Run these gates on the implementation branch before claiming the improvement complete:

- `pnpm --filter @mog/types-objects typecheck`
- Contract package build/type gates for `@mog-sdk/contracts`, including declaration output and the runtime export inventory check.
- SDK/API report generation for the public contract surface, verifying no unexpected `@mog/types-objects` owner-package drift.
- Type-level fixtures that assert:
  - every object kind maps to exactly one supported/preserved object contract.
  - every Rust wire variant has an exhaustive TypeScript mapper case.
  - anchor discriminants require the correct fields.
  - serialized drawing/diagram payloads are JSON-safe and round-trip to runtime `Map` forms.
  - canonical value tables cover shape, dash, bevel, material, text warp, SmartArt algorithm, and OOXML style identifiers.
- Kernel tests for Rust-to-TypeScript floating object mapping, object manager mutations, projection snapshots, ordering/grouping, and scene graph snapshots.
- Canvas tests for resolved drawing objects, shapes/connectors, text effects, diagrams/SmartArt, ink strokes, and unsupported placeholder rendering.
- Spreadsheet app E2E tests driven through real UI input paths for creating/editing shapes, connectors, pictures, text boxes, charts, ink drawings, equations, diagrams, text effects, camera objects, OLE placeholders, and slicer visuals if retained.
- XLSX import/export round-trip fixtures for OOXML anchors, SmartArt, equations, ink, camera objects, OLE objects, unsupported objects, and workbook-level slicers.
- `cargo test -p domain-types` and the relevant compute/file-io crates that own floating object wire hydration, plus their `cargo clippy -p <crate>` gates when those crates are touched.
- A manual browser verification pass on the production spreadsheet UI after starting the dev server, confirming imported and newly created objects render, select, move, resize, edit, and preserve import-status metadata.

## Risks, edge cases, and non-goals

Risks and edge cases:

- The package is private but public declarations flow through `@mog-sdk/contracts`; accidental declaration churn can become an SDK break.
- `types-objects` cannot simply import chart or slicer domain types if that creates package cycles. Ownership boundaries need to be solved structurally.
- Legacy XLSX files may contain camera, slicer, OLE, SmartArt, or unsupported drawing shapes that must be preserved even when Mog cannot fully edit them.
- Current `Map`-based TypeScript models are convenient for editing but unsafe as public serialized payloads. Conversions must be lossless and deterministic.
- OOXML value spaces are large and easy to partially copy. Generated lists or exhaustive fixtures are safer than manual unions.
- Unit changes can expose latent bugs in existing renderers because pixels, EMUs, points, degrees, radians, and fixed percentages are currently mixed in several contracts.
- Runtime exports from type-adjacent packages must not appear accidentally; contract runtime inventory is the source of truth.

Non-goals:

- Do not move renderer, parser, importer, or spreadsheet UI implementation into `types/objects`.
- Do not add compatibility shims that silently coerce invalid object variants into shapes.
- Do not revive slicer JSON blobs inside floating objects.
- Do not optimize test harnesses or mock paths instead of production object import, mapping, projection, rendering, and editing paths.
- Do not leak internal planning or private repo content into public packages.

## Parallelization notes and dependencies on other folders, if any

This work should be split across parallel agents after the initial export/variant inventory is committed, because the boundaries are clean:

- Contract surface agent: `types/objects`, `contracts`, package exports, runtime inventory, SDK/API reports.
- Floating object matrix agent: Rust `domain-types`, compute/file-io hydration, kernel mapper, object manager, projection, and unsupported placeholder policy.
- Anchor/serialization agent: position discriminants, unit aliases, drawing/diagram serialized-versus-runtime models, conversion helpers, and type fixtures.
- Drawing/text-effect/shape agent: canonical value tables, line/gradient/effect normalization, canvas drawing engine and shape registry adapters.
- Diagram/SmartArt agent: OOXML layout/style/algorithm/data-model completeness, importer fixtures, layout engine defaults, and diagram renderer contracts.
- Equation agent: OMML AST/error contracts, math-engine parser/type-guard ownership, equation import/render fixtures.
- Product verification agent: spreadsheet UI E2E coverage through real input paths and manual browser verification.

Important dependencies:

- `mog/contracts/src` and `contracts/package.json` for public SDK exposure.
- `runtime/sdk/src/generated/api-spec.json` and the SDK generation/report workflow.
- `mog/domain-types/src/domain/floating_object`, compute hydration, and file-io XLSX bridges for Rust wire alignment.
- `mog/kernel/src/bridges/compute/floating-object-mapper.ts`, `mog/kernel/src/floating-objects`, and public API worksheet/object collection code for production mapping and mutation.
- `mog/canvas/*`, especially drawing, diagram, text-effect, ink, and scene graph renderers.
- `mog/types/data` for chart and slicer ownership boundaries.
- `mog/typeset/math-engine` for equation parsing, OMML type guards, and render error behavior.
