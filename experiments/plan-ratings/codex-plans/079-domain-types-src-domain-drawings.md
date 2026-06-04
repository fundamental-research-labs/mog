# 079 - Domain Types Drawings Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/domain-types/src/domain/drawings`

Queue item: 79

Scope: the Rust `domain-types` drawing primitives under `src/domain/drawings`, including persistent DrawingML/VML/OLE sidecar models, converters to and from `ooxml_types`, serde JSON shape, and the schema/persistence contracts used by floating objects, chart layout, XLSX import/export, Yrs storage, and generated bridge types.

Files inspected in this folder:

- `mod.rs`
- `audits.rs`
- `black_white_mode.rs`
- `blip_effect.rs`
- `color.rs`
- `compression.rs`
- `drawing_fill.rs`
- `effect_properties.rs`
- `effects.rs`
- `fill_mode.rs`
- `group_shape.rs`
- `hyperlink.rs`
- `locking.rs`
- `manual_layout.rs`
- `ole_object.rs`
- `outline.rs`
- `scene.rs`
- `shape_3d.rs`
- `shape_style.rs`
- `source_rect.rs`
- `text_body.rs`
- `text_body_convert.rs`
- `transform.rs`
- `vml_shape.rs`

Adjacent production paths inspected:

- `mog/domain-types/Cargo.toml`
- `mog/domain-types/src/domain/floating_object/{drawing.rs,objects.rs,ooxml.rs,style.rs,mod.rs}`
- `mog/domain-types/src/yrs_schema/floating_object.rs`
- `mog/domain-types/src/yrs_schema/floating_object/types/{drawing.rs,shapes.rs,fields.rs,mod.rs,common.rs}`
- `mog/domain-types/src/yrs_schema/floating_object/tests.rs`
- `mog/domain-types/src/domain/floating_object/tests/*`
- `mog/file-io/xlsx/parser/src/output/to_parse_output/features/floating_objects.rs`
- `mog/file-io/xlsx/parser/src/write/drawing_writer_helpers.rs`
- `mog/file-io/xlsx/parser/src/domain/drawings/types.rs`
- `mog/file-io/xlsx/parser/src/write/from_parse_output/{form_controls.rs,ole_objects.rs}`
- `mog/kernel/src/bridges/compute/compute-types.gen.ts`

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal in `mog-internal`.

## Current role of this folder in Mog

`domain-types/src/domain/drawings` is the shared Rust vocabulary for persistent drawing state that must survive XLSX import, collaborative Yrs storage, bridge serialization, and XLSX export without depending on parser-private structs. It is the typed preservation layer between two different views of drawing objects:

- Full-fidelity OOXML-adjacent state such as `DrawingFill`, `DomainDrawingColor`, `TextBody`, `Outline`, `ShapeStyle`, `Transform2D`, `DrawingLocking`, `SceneSettings`, `Shape3DSettings`, `GroupShapeData`, `OleObjectProperties`, and `VmlShapeProps`.
- UI-facing floating object projections such as `ObjectFill`, `ShapeOutline`, `ShapeText`, and `DrawingData` in `domain/floating_object`.

The folder currently supports these production responsibilities:

- Provides lossless or near-lossless domain mirrors for DrawingML primitives, with camelCase serde and `From<&ooxml_types::...>` / `From<DomainType> for ooxml_types::...` converters for many mirrored types.
- Gives `ShapeOoxmlProps.group_shape`, `OleObjectOoxmlProps.object_pr`, and `FormControlOoxmlProps.vml_shape` typed fields instead of parser-owned `serde_json::Value` blobs.
- Provides `DrawingContent` and `GroupShapeData` so group children, SmartArt references, content parts, graphic frames, and unsupported raw object choices can be preserved outside `xlsx-parser`.
- Supplies `ManualLayout` to chart domain types and chart extraction/reconstruction paths.
- Supplies full rich text body preservation through `TextBody` and conversion code, separate from simplified `ShapeText`.
- Supplies typed fill, outline, color, locking, 3D, effect, hyperlink, crop/source-rect, compression, and black/white-mode primitives used by drawing parse/write, charts, floating objects, and generated TS bridge surfaces.

Important observed evidence:

- `DrawingData` has `ooxml: Option<DrawingObjectOoxmlProps>` and generated TS includes `DrawingData.ooxml`.
- The XLSX import path creates `FloatingObjectData::Drawing(DrawingData { ooxml: Some(...) })` for `xdr:contentPart` and non-chart `xdr:graphicFrame` objects.
- The XLSX writer consumes `DrawingData.ooxml` in `build_sheet_drawing_data` to re-emit content parts and opaque graphic frames and to preserve drawing-owned relationships.
- The Yrs drawing schema currently writes strokes, tool state, recognitions, and background color, but does not write or read `DrawingData.ooxml`; `known_fields("drawing")` lists legacy `data` but not `ooxml`.
- Several sidecar structs in this folder do not yet match the module-level contract that drawing primitives have camelCase JSON and default values emit no keys. `group_shape.rs` has no serde rename/default-skip attributes, while `ole_object.rs` and `vml_shape.rs` have camelCase names but default values still serialize required/default fields.
- Known typed preservation TODOs remain in effect/custom geometry surfaces: `CT_FillOverlayEffect`, `CT_PresetShadowEffect`, `CT_EffectContainer`, and custom geometry path trees.

## Improvement objectives

1. Make drawing OOXML sidecars persist through the full production path: XLSX import -> `ParseOutput` -> Yrs storage -> bridge/kernel access -> XLSX export.

2. Convert the folder's stated invariants into executable contracts: camelCase serde, default-emits-no-keys where promised, no silent lossy converters, and stable bridge JSON shapes.

3. Finish the current typed preservation migration by replacing remaining untyped or raw-only drawing gaps with explicit typed structures, or by isolating raw XML fields behind named, tested preservation contracts when the OOXML shape is intentionally opaque.

4. Make conversion completeness auditable across every mirrored OOXML primitive in this folder rather than relying on scattered local unit tests.

5. Keep the split between lossless domain sidecars and UI projections explicit. `DrawingFill`/`TextBody`/OOXML sidecars remain the source of truth for round-trip fidelity; `ObjectFill`/`ShapeText` remain named editable projections.

6. Strengthen group, content-part, graphic-frame, VML form-control, and OLE persistence because those are the paths most likely to lose workbook fidelity while appearing visually acceptable in the UI.

7. Ensure generated TypeScript bridge declarations and public kernel mappers reflect the Rust serde shape without hand-maintained drift.

8. Preserve dependency direction: `domain-types` may depend on `ooxml-types`; `xlsx-parser` may depend on `domain-types`; `domain-types` must not depend on parser/write implementation code or `mog-internal`.

## Production-path contracts and invariants to preserve or strengthen

- `domain-types` remains the single Rust source of truth for drawing domain types shared by parser output, Yrs storage, writer input, and compute/kernel bridge serialization.
- Drawing sidecars used for package fidelity must survive storage and bridge round trips. `DrawingData.ooxml`, `ShapeOoxmlProps.group_shape`, `OleObjectOoxmlProps.object_pr`, and `FormControlOoxmlProps.vml_shape` are not UI-only hints.
- Imported `xdr:contentPart` objects must retain content-part relationship ids, anchor metadata, client-data flags, extent EMUs, editAs, and drawing-owned relationships.
- Imported non-chart `xdr:graphicFrame` objects must retain raw graphic XML and its relationships. Chart graphic frames stay chart-owned and must not be duplicated as opaque drawing objects.
- Group shapes must retain nested child order, nested group hierarchy, non-visual properties, group transform, fill/effects/black-white mode, and opaque unsupported children with relationship ids.
- VML form-control shape properties and OLE `objectPr` properties must remain typed domain fields, not JSON blobs or parser-private structs.
- The simplified UI projection must never be the only persisted source for information that OOXML export needs. Projection functions should be named and one-way where they intentionally discard detail.
- Default serde behavior must be intentional. If a type represents optional sidecar metadata, its default should serialize as `{}` or be documented as an explicit non-empty OOXML payload.
- Serde names crossing the bridge must be camelCase unless a deliberate wire exception is documented and tested.
- Converter behavior must not hide lossy mappings. A lossy or choice-only converter must either be completed, carry the missing raw/typed sidecar, or be named as a projection rather than a round-trip conversion.
- Unknown OOXML tokens, relationship ids, raw extension XML, and unsupported object choices must either round-trip byte-relevant data or produce explicit import diagnostics.
- `ManualLayout` remains the chart layout domain type and must preserve empty `<c:layout/>`, all position modes, coordinates, dimensions, and extension payloads.
- Generated `compute-types.gen.ts` and kernel mappers must agree with Rust serde shapes for every bridge-exposed drawing field.

## Concrete implementation plan

### 1. Build an executable drawing contract inventory

Add a source-owned inventory test or fixture in `domain-types` that classifies every type exported from `domain::drawings`:

- OOXML mirror with bidirectional converters: `BlackWhiteMode`, `CompressionState`, `DomainDrawingColor`, `DrawingFill`, `FillMode`, `HyperlinkRef`, `DrawingLocking`, `ManualLayout`, `Outline`, `SceneSettings`, `Shape3DSettings`, `ShapeStyle`, `SourceRect`, `Transform2D`, and text-body conversion types.
- Typed sidecar without direct OOXML converter because parser/writer owns the element envelope: `GroupShapeData`, `DrawingContent`, `OpaqueDrawingContent`, `SmartArtGraphicFrame`, `OleObjectProperties`, and `VmlShapeProps`.
- Known projection or opaque tier: effect DAGs, fill overlay, preset shadow, custom geometry paths, raw extension lists, and unsupported object choices.

For each row, record the required serde casing, default serialization expectation, converter expectation, bridge exposure status, and production owner. Use this inventory to drive tests rather than duplicating knowledge across modules.

### 2. Fix drawing OOXML sidecar persistence in Yrs

Update the floating-object Yrs drawing schema so `DrawingData.ooxml` behaves like the other object sidecars:

- `append_drawing_entries` writes `"ooxml"` as a sub-object when `DrawingData.ooxml` is present.
- `read_drawing_or_legacy` reads `"ooxml"` into `DrawingData.ooxml` for the current schema.
- `known_fields("drawing")` lists `"ooxml"` as a sub-object and keeps legacy `"data"` as read/migration-only if that legacy field is still needed.
- Existing stroke/tool/recognition/background behavior remains unchanged.
- Legacy `data` migration must not erase a separately present modern `"ooxml"` field.

Add Yrs tests that construct imported drawing objects with:

- `DrawingObjectOoxml::ContentPart` plus relationships and anchor metadata.
- `DrawingObjectOoxml::GraphicFrame` with non-chart raw graphic XML and relationship ids.
- Existing freehand strokes and recognitions in the same `DrawingData`.

Assert that `to_yrs_prelim -> from_yrs_map` preserves the full sidecar, not only editable ink data.

### 3. Make serde/default contracts explicit and complete

Systematically audit the folder against the module-level docs:

- Add camelCase serde attributes and default-skip behavior where the type is part of bridge/Yrs JSON.
- For types that intentionally serialize non-empty defaults because they are full OOXML payloads, document the exception in the type docs and inventory test.
- Add local tests for sidecar structs currently lacking direct coverage: `GroupShapeData`, `OpaqueDrawingContent`, `SmartArtGraphicFrame`, `OleObjectProperties`, `OleObjectAnchor`, `OleAnchorPoint`, and `VmlShapeProps`.
- Ensure fields such as `grp_sp_pr`, `nv_grp_sp_pr`, `raw_xml`, `kind_hint`, `r_id`, `col_off`, and `row_off` have stable intended JSON names.
- Keep raw XML fields as strings only when they are true writer preservation payloads; do not allow arbitrary `serde_json::Value` bags to return.

This step should produce a clear list of intentional non-empty defaults rather than weakening the default-emits-no-keys invariant globally.

### 4. Complete or isolate remaining typed preservation TODOs

Resolve the known drawing TODO family as a set, not one marker at a time:

- Type `CT_FillOverlayEffect` and `CT_PresetShadowEffect` in `EffectListSpec` so effect lists no longer depend on raw XML for named child elements.
- Type `CT_EffectContainer` enough to represent effect DAG/tree/sibling containers, nested effect choices, container attributes, and extension payloads, or move the raw DAG preservation into a named `OpaqueEffectDag` sidecar with parser/writer tests that prove byte-relevant round trip.
- Type `CT_CustomGeometry` path trees behind `ShapeGeometry::Custom` instead of a single raw string, including guide lists, adjust handles, connection sites, text rect, and path list.
- Revisit text-body raw fallbacks for effect list, underline line/fill, preset text warp guides, and extension lists. Replace raw tiers with typed fields where `ooxml-types` already has a structure available.

Every remaining opaque field after this step should have:

- A named type, not a generic JSON value.
- A production writer path that consumes it.
- A test fixture showing preservation across import/export or parser/writer round trip.
- A diagnostic story for unsafe or unsupported replay.

### 5. Add exhaustive converter parity tests

Create a converter test matrix that exercises every `From<&ooxml_types::...>` and reverse `From<DomainType>` implementation in this folder:

- Enum tests cover every OOXML token and every domain variant, including unknown-token fallback behavior where applicable.
- Struct tests set every optional field at least once and assert round-trip equality or documented projection loss.
- Collection tests cover ordering for gradient stops, color transforms, group children, text paragraphs/runs, tabs, bullets, extension lists, and relationships.
- Numeric-unit tests cover EMUs, angles in 60,000ths of a degree, percentages, alpha/transparency, source rect percentages, coordinates, rotations, and text spacing.

Do not accept "choice shape only" tests for converters documented as lossless. If a converter only preserves the top-level choice, rename/document it as a projection or complete the missing field conversion.

### 6. Define named projection boundaries to UI-facing floating object types

Add or tighten named conversion/projection helpers between lossless drawing types and editable UI types:

- `DrawingFill` -> `ObjectFill` for resolved UI fills, with theme/color-resolution inputs made explicit.
- `Outline` -> `ShapeOutline` for editable stroke controls.
- `TextBody` -> `ShapeText` for simplified text editing and back only when the user explicitly overwrites rich text.
- `SceneSettings` and `Shape3DSettings` -> UI render hints where the canvas can consume them.

Kernel and canvas code should call these projections by name. They should not read arbitrary `unknown` values from generated bridge payloads where Rust domain types already define the contract.

### 7. Tie bridge schema generation to Rust serde contracts

Strengthen generated TypeScript and bridge schema coverage:

- Ensure every bridge-exposed drawing sidecar type either derives/describes schema through the Rust bridge system or is covered by generated-type fixture tests.
- Add generated TS contract assertions for `DrawingData.ooxml`, `DrawingObjectOoxml`, `ManualLayout`, `ShapeOoxmlProps.groupShape`, `OleObjectOoxmlProps.objectPr`, and `FormControlOoxmlProps.vmlShape`.
- Add a drift check that fails when Rust serde field names or enum tags change without updating generated TS and kernel mappers.
- Update kernel mappers to consume typed generated structures where available instead of `unknown` property reads for fields that now have Rust contracts.

### 8. Add production XLSX round-trip fixtures for drawing preservation

Build real XLSX fixtures or focused generated workbooks that cover the production cases this folder owns:

- Content part object with drawing relationships.
- Non-chart graphic frame preserved as opaque drawing data.
- Chart graphic frame that remains chart-owned and is not emitted twice.
- Group shape with nested shape, picture, connector, nested group, opaque unknown child, fill/effects, and black-white mode.
- Shape/textbox with full `TextBody`: bullets, tabs, run hyperlinks, body props, list style, scene/sp3d, and extension payloads.
- Picture/shape/connector styling with solid, gradient, pattern, blip, group fill, outlines, arrowheads, custom dash, hyperlinks, locks, source rect, compression, and blip effects.
- Form control with VML shape props and worksheet control properties.
- OLE object with `objectPr`, anchor, embedded package identity, preview identity, and VML relationship metadata.

Verification should parse, hydrate/store through the same Yrs path production uses, export, and reparse. Assertions should inspect typed domain fields and package relationships, not only file existence or visual output.

## Tests and verification gates

After implementation, run these gates in order:

1. `cargo test -p domain-types`
2. `cargo clippy -p domain-types`
3. `cargo test -p xlsx-parser`
4. `cargo clippy -p xlsx-parser`
5. `cargo test -p compute-core`
6. `cargo clippy -p compute-core`
7. The focused XLSX parser/writer round-trip tests for drawing fixtures, including any slow/corpus feature only if the implementation touches corpus-owned behavior.
8. Regenerate bridge TypeScript artifacts through the repo's established bridge generation command, then run the relevant generated-type drift check.
9. `pnpm --filter @mog-sdk/kernel test` for floating-object mapper and bridge paths affected by drawing sidecar changes.
10. `pnpm typecheck` for TypeScript changes caused by regenerated bridge types or kernel mapper changes.
11. For UI projection changes, run the spreadsheet dev server and exercise imported drawing objects through real browser/UI paths before export.

Expected new tests:

- Unit tests in `domain-types/src/domain/drawings` for serde/default behavior and converter parity.
- Yrs schema tests in `domain-types/src/yrs_schema/floating_object/tests.rs` proving `DrawingData.ooxml` persists.
- Floating-object facade JSON tests proving bridge-visible sidecar shapes are stable.
- XLSX parser/writer round-trip tests proving content parts, opaque graphic frames, groups, form controls, OLE objects, rich text, fills, effects, and relationships survive the production path.
- Generated TS contract tests or declaration snapshots proving bridge output contains the intended drawing fields.

## Risks, edge cases, and non-goals

Risks:

- Adding serde rename/default attributes to sidecar structs can change existing JSON/Yrs wire names. Migrations or explicit compatibility reads may be required for already-stored data.
- Completing effect DAG and custom geometry typing can expose missing structures in `ooxml-types`; that work belongs in `ooxml-types` first, then `domain-types`, then parser/writer.
- Treating raw XML as safe replay without relationship closure checks can preserve malformed or stale package state. Relationship ownership and diagnostics must be part of the contract.
- Generated TS changes can break kernel mappers that currently read drawing fields as `unknown`. The fix is typed mapper updates, not weakening Rust serde.
- Rich text editing can intentionally overwrite imported `TextBody` detail. That transition must be an explicit edit-authority event, not an accidental projection during load.

Edge cases to cover:

- Empty but present OOXML elements, especially `<c:layout/>`, `<a:effectLst/>`, empty list styles, empty group fills, and empty relationship files.
- Unknown OOXML enum tokens for colors, black-white mode, compression, presets, line joins, dash styles, tile align/flip, and layout modes.
- Relationship-bearing raw XML with multiple `r:id` references, duplicate relationship ids, external relationships, and missing target relationships.
- Nested groups with mixed typed and opaque children, including child order after export.
- Chart graphic frames versus non-chart graphic frames.
- Form controls that have both VML and modern `controlPr` data.
- OLE linked objects versus embedded package objects, with and without preview media.
- Defaults where OOXML default semantics differ from Rust `Default`.
- Large enum variants and large sidecar structs crossing bridge serialization without stack or clone-heavy hot-path regressions.

Non-goals:

- No compatibility shim that stores drawing fidelity in a test-only path.
- No conversion of lossless DrawingML sidecars into simplified UI projections as the persisted source of truth.
- No reintroduction of parser-private structs or `serde_json::Value` blobs into `domain-types` for known OOXML structures.
- No changes to private/internal planning docs in the public `mog` repo.
- No visual-only tests as the sole proof of drawing fidelity; package relationships and typed domain fields must be asserted.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable with explicit package boundaries:

- Agent A: `domain-types/src/domain/drawings` contract inventory, serde/default audit, and converter parity tests.
- Agent B: Yrs persistence fix for `DrawingData.ooxml`, `known_fields("drawing")`, legacy migration tests, and floating-object facade JSON tests.
- Agent C: `ooxml-types` plus `domain-types` typing for effect containers, fill overlay, preset shadow, and custom geometry.
- Agent D: `file-io/xlsx/parser` import/export fixtures for content parts, graphic frames, groups, VML form controls, OLE objects, rich text, fills, effects, and relationships.
- Agent E: bridge generation and kernel mapper cleanup so generated TS types replace ad hoc `unknown` drawing reads.
- Agent F: UI projection verification for canvas/kernel paths that consume simplified fills, outlines, text, 3D hints, and shape style updates.

Dependencies:

- `file-io/ooxml/types` owns canonical OOXML vocabulary structs that should be widened before `domain-types` invents parallel deep structures.
- `file-io/xlsx/parser` owns XML parsing/writing and package relationship closure. It must consume the typed sidecars added here.
- `domain-types/src/domain/floating_object` owns `DrawingData`, `ShapeOoxmlProps`, `OleObjectOoxmlProps`, and `FormControlOoxmlProps`, so sidecar changes must update those aggregates.
- `domain-types/src/yrs_schema/floating_object` owns persistent Yrs storage for drawing/floating-object data.
- `compute/core` and generated bridge artifacts own the Rust-to-TypeScript surface consumed by kernel.
- `kernel/src/bridges/compute/floating-object-mapper.ts` and worksheet shape APIs own UI-facing projections from generated bridge data.
- Canvas drawing packages should remain consumers of resolved/projection data, not owners of persistence fidelity.
