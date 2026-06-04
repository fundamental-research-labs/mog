# 051 - Charts Grammar Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/charts/src/grammar`

Queue item: 51

Scope: the public `@mog/charts` grammar compiler, including `ChartSpec` types, transform dispatch, scale and encoding resolution, layout calculation, axis and legend generation, unit and layered compilation, mark generation, layout snapshots, and geometry or fidelity traces emitted through `CompileResult`.

Files and integration points inspected:

- `charts/src/grammar/spec.ts`
- `charts/src/grammar/types.ts`
- `charts/src/grammar/compiler.ts`
- `charts/src/grammar/layer-compiler.ts`
- `charts/src/grammar/encoding-resolver.ts`
- `charts/src/grammar/layout.ts`
- `charts/src/grammar/path-cartesian-reconcile.ts`
- `charts/src/grammar/axis-generator.ts`
- `charts/src/grammar/legend-generator.ts`
- `charts/src/grammar/legend-layout.ts`
- `charts/src/grammar/layout-snapshot.ts`
- `charts/src/grammar/marks/*`
- `charts/src/grammar/transforms/*`
- `charts/src/grammar/*-trace.ts`
- `charts/src/grammar/__tests__/*`
- `charts/src/grammar/marks/__tests__/*`
- `charts/__tests__/grammar/*`
- `charts/__tests__/integration/full-pipeline.test.ts`
- `charts/src/core/chart-engine.ts`
- `charts/src/dom/chart-engine.ts`
- `charts/src/index.ts`
- `charts/src/export/ooxml/image-fallback.ts`
- `kernel/src/domain/charts/bridge/chart-compiler.ts`
- `mog-internal/plans/active/experiments/plan-ratings/codex-plans/050-charts-src-core.md` as the adjacent upstream conversion plan

Scope this plan does not cover:

- Replacing the public `ChartConfig -> ChartSpec` conversion owned by `charts/src/core`; this folder consumes the resulting `ChartSpec`.
- Moving workbook range resolution, chart object lifecycle, render cache invalidation, or live range extraction into the grammar compiler.
- Adding compatibility shims around broken grammar behavior; production compile contracts should be made explicit and verified.
- Optimizing benchmark-only paths or test-only fixtures.

## Current role of this folder in Mog

`charts/src/grammar` is the production lowering layer from declarative chart grammar to renderable primitive marks. It sits after `charts/src/core/config-to-spec` and before DOM canvas rendering, OOXML image fallback, kernel chart snapshots, and layout extraction.

Observed responsibilities:

- `spec.ts` defines the public `ChartSpec`, `UnitSpec`, `LayerSpec`, `EncodingSpec`, `ChannelSpec`, `ScaleSpec`, `AxisSpec`, `LegendSpec`, `MarkSpec`, `MarkType`, layout hint, transform, stock glyph, surface, 3D, and chart frame grammar contracts exported from `@mog/charts`.
- `compiler.ts` resolves inline or caller-provided data, applies transforms, reconciles path-axis layout, sanitizes data for scale domains, creates scales, resolves encodings, generates data marks, clips plot-area marks, emits axes/legends/title/background marks, and builds geometry or fidelity traces.
- `layer-compiler.ts` handles layered specs with merged shared encodings, shared scales, independent y-axis support, per-layer transforms, layer-local mark configs, and combined traces.
- `encoding-resolver.ts` creates `ChartScale` implementations for position, color, fill, stroke, size, opacity, shape, theta, and radius channels, including default zero-domain behavior based on mark type.
- `layout.ts` computes chart and plot rectangles, margins, title area, legend area, manual layout hints, data table area, axis reservations, label gutters, pie/doughnut square plot preference, and legend reservation.
- `path-cartesian-reconcile.ts` performs a bounded multi-pass reconciliation for imported path-axis evidence, tick skipping, category pitch, and axis reservation metadata.
- `axis-generator.ts`, `legend-generator.ts`, `legend-layout.ts`, and `title-generator.ts` turn layout and guide specs into primitive marks plus trace metadata. Axis marks also carry `datum.role` and `datum.axisPart`, which downstream collection uses to separate gridlines from foreground axes.
- `marks/*` contains the mark family implementations: bar and bar3d, line and line3d, area and area3d, point/symbol, arc and arc3d, rect, rule, text, tick, stock glyph, histogram, boxplot, violin, radar, contour, and surface3d. Several generators consume core chart IR fields from `charts/src/core/chart-ir/fields.ts`.
- Trace builders emit production evidence: Cartesian geometry, bar rectangles, stock glyph geometry, legend flow, pie/doughnut data-label layout, 3D approximation, and surface/contour approximation. These traces are exported publicly from `@mog/charts`, copied through kernel chart compilation, and embedded in resolved chart spec snapshots.
- `layout-snapshot.ts` is the sole pixel-to-point conversion path for `ChartLayout` snapshots consumed by `@mog-sdk/contracts/bridges`.
- `transforms/*` provides the TypeScript transform engine while the kernel bridge may pre-apply transforms with WASM and then call the TS grammar compiler.

Current risk profile:

- Unit and layered compilation duplicate important production logic: frame generation, clipping, title/background/legend emission, trace construction, and datum assertions.
- `MarkType` includes `trail`, but `generateMarks` has no trail generator and silently returns `[]` in the default branch. This is a public grammar contract gap.
- Transform dispatch falls back to unchanged data for unknown transforms. This hides invalid production specs instead of surfacing a deterministic compile diagnostic.
- The legend layout path considers color, fill, shape, and size channels, but `generateLegends` only renders the color legend. Non-color legend channels can reserve space and appear in traces without matching rendered marks.
- Scale implementations expose behavior through ad hoc callable objects and optional methods. Trace builders, axes, marks, and layout code infer scale kind from optional methods and channel shape instead of a typed scale contract.
- Many mark generators duplicate datum-field extraction, opacity clamping, style resolution, direct positioning, invalid-coordinate handling, and renderable-row filtering.
- Some fidelity checks are comments or no-ops, including the datum assertion that is documented as critical for the chart fidelity invariant library.
- `CompileResult` trace types are public and used by kernel snapshots, but trace schema versioning is inconsistent across trace families.

## Improvement objectives

1. Make the grammar compiler a typed production pipeline with shared unit and layer phases instead of parallel orchestration paths.

2. Make every public `MarkType` and every transform variant exhaustive: either implemented with a real production generator or rejected through an explicit compile diagnostic contract, with no silent empty output for supported-looking specs.

3. Define scale, encoding, layout, mark, guide, clipping, and trace contracts as typed internal schemas that can be verified systematically.

4. Preserve deterministic, pure compilation while improving error reporting, trace evidence, and downstream snapshot stability.

5. Unify data normalization for scale domains, render rows, blank semantics, non-finite values, and layer field extension so unit and layered charts obey the same rules.

6. Make axis and legend generation match layout reservation, trace output, and rendered marks across all supported guide channels.

7. Consolidate mark-generator common behavior so every mark family consistently handles datum provenance, invalid positions, styles, plot clipping, direct positions, and chart IR fields.

8. Strengthen layout snapshot extraction so bounds and point conversion are renderer-equivalent where possible and clearly marked as estimated where exact text/path geometry is unavailable.

9. Keep public `@mog/charts` exports stable unless an intentional public contract update is made with coordinated kernel/export tests.

## Production-path contracts and invariants to preserve or strengthen

Purity and ownership:

- `compile(spec, data?, options?)` remains a pure synchronous function with no DOM dependency.
- The grammar compiler must not read workbook state, resolve ranges, mutate chart configs, or depend on `mog-internal`.
- DOM rendering remains in `charts/src/dom`, pure mark collection remains in `charts/src/core/chart-engine.ts`, and kernel range/chart lifecycle remains in `kernel/src/domain/charts`.
- `layout-snapshot.ts` remains the only conversion point from internal pixels to contract points.

Data and transforms:

- Inline data in `spec.data.values` wins over caller-provided `data`; caller-provided data remains the fallback for specs without inline values.
- Top-level transforms apply before layer dispatch; layer transforms apply to the layer's own data or inherited transformed data.
- TS and WASM transform behavior must remain equivalent for shared transform variants.
- Transform dispatch must be exhaustive over `TransformType`; invalid transform specs should produce deterministic errors or diagnostics rather than unchanged data.
- Scale-domain sanitation must keep non-finite numeric values out of domains without mutating source rows used by marks and traces.
- Blank row semantics using grammar/core internal fields must remain stable for lines, areas, bars, arcs, radar, labels, and traces.

Scales and encodings:

- Position scales must keep Excel-compatible category centering: bars use band leading edges and sizes; line/area/point/text/rule/tick positions use category centers.
- Quantitative default zero inclusion must remain mark-aware: bar, area, arc, and radar default to zero; line/scatter/path-style marks should not expand domains unless requested.
- Explicit scale domains must not be widened by automatic zero inclusion or nicening.
- Shared layered scales must include all fields that contribute to a shared channel, not only the first layer's field.
- Independent y scales and axes must preserve primary/secondary orientation behavior and legend/axis ordering.
- Scale metadata used by traces must agree with the actual scale used by marks.

Layout and guides:

- Chart bounds, plot area, title area, legend area, data table area, and manual layout hints must stay in chart pixels internally.
- Manual layout hints must clamp to chart bounds and preserve minimum plot size.
- Axis reservations, bottom margin hints, imported path-axis evidence, category pitch, tick skip, and axis status metadata must survive layout reconciliation.
- Axis gridlines must render before data marks and foreground axis parts after data marks via `collectMarks`.
- Legend area reservation, legend trace entries, and legend marks must agree for color, fill, stroke, shape, and size guide channels.
- Text measurement should use `CompileOptions.textMeasurementContext` when supplied and deterministic estimates only when no canvas measurement context exists.

Marks and clipping:

- Data marks must carry enough datum provenance for fidelity checks, tooltips, layout extraction, and kernel snapshots.
- Plot-area clipping must be explicit per mark family. Data marks that intentionally escape the plot area must opt out through a documented clipping contract rather than hidden datum flags.
- Generated marks must not contain `NaN`, infinite coordinates, negative dimensions after clipping, or invalid paths unless the primitive renderer has a defined contract for that value.
- Style resolution should preserve paint, line, shadow, effects, opacity, per-datum style fields, and mark-level defaults consistently across mark families.
- 3D approximations and surface/contour approximations must continue to emit evidence traces that describe approximation status rather than pretending to be exact Excel geometry.

Compile result and downstream snapshots:

- `CompileResult` shape remains the production object consumed by DOM rendering, kernel chart compilation, layout snapshots, OOXML image fallback, and public exports.
- Public trace objects must carry stable schema versions where they are persisted or copied to resolved chart snapshots.
- `compileChartMarks` in kernel must continue to identify `configToSpec`, `compile`, `collectMarks`, and `layout` stages for error reporting.
- `ResolvedChartSpecSnapshot` hashes must remain deterministic for equivalent inputs and render sizes.

## Concrete implementation plan

### 1. Introduce a typed grammar pipeline core

Add a `compiler-pipeline.ts` module that owns the shared production steps currently duplicated by `compiler.ts` and `layer-compiler.ts`.

Define:

- `ResolvedCompileInput`: original spec, resolved data rows, transformed top-level data, dimensions, and compile options.
- `ReconciledSpecLayout`: reconciled spec plus layout after path-axis reconciliation.
- `ScaleBuildContext`: encoding, scale-domain rows, render rows, layout, mark type, and scale metadata.
- `MarkLayerContext`: layer index, mark type, mark spec, data rows, encoding, resolved encodings, scales, layout, layer config, and clipping policy.
- `CompiledLayer`: data marks, per-layer trace inputs, scale metadata, and diagnostics.
- `CompiledGuides`: axes, legends, title, background, guide traces.
- `CompiledChartAssembly`: final clipped marks, guides, traces, layout, bounds, scales, and diagnostics.

Refactor `compile` and `compileLayered` to assemble these pipeline objects instead of each owning private copies of frame generation, clipping, guide generation, and trace construction. Keep public exports from `compiler.ts` stable by re-exporting the new helpers only when they are intentionally public.

Acceptance criteria:

- Unit and layered specs share the same background, clipping, title, legend, trace, and datum-provenance code paths.
- Layer-specific behavior remains isolated to data inheritance, per-layer transforms, scale sharing, and independent axis policy.
- Existing `CompileResult` fields are still populated for unit and layered charts.

### 2. Make mark compilation exhaustive

Replace the `generateMarks` switch with a `MARK_COMPILERS` registry:

```ts
const MARK_COMPILERS = {
  bar: { ... },
  bar3d: { ... },
  line: { ... },
  line3d: { ... },
  area: { ... },
  area3d: { ... },
  point: { ... },
  circle: { ... },
  square: { ... },
  arc: { ... },
  arc3d: { ... },
  rect: { ... },
  rule: { ... },
  text: { ... },
  tick: { ... },
  stockGlyph: { ... },
  trail: { ... },
  boxplot: { ... },
  histogram: { ... },
  violin: { ... },
  contour: { ... },
  radar: { ... },
  surface3d: { ... },
} satisfies Record<MarkType, MarkCompilerContract>;
```

Each entry should declare:

- Required scale channels.
- Optional scale channels.
- Output primitive mark types.
- Datum provenance policy.
- Plot clipping policy.
- Trace families it contributes to.
- Whether invalid positions are skipped, converted to zero-size marks, or reported as diagnostics.
- Whether the mark is exact, approximate, or preservation-only.

Implement the missing `trail` mark as a production variable-width path family rather than leaving a public `MarkType` unsupported. If primitive support needs a richer path stroke contract, add it through the primitive mark contract and renderer path used by production rendering, not a test-only branch.

Acceptance criteria:

- TypeScript fails if a `MarkType` lacks a registry entry.
- Unknown runtime mark types produce deterministic compile diagnostics or errors.
- No supported mark type silently returns `[]` because it is missing from dispatch.

### 3. Add compile diagnostics without weakening existing output

Introduce a `CompileDiagnostic` type in `types.ts` and an optional `diagnostics?: CompileDiagnostic[]` field on `CompileResult`.

Use diagnostics for production-relevant non-fatal conditions:

- Unsupported or invalid transform specs.
- Mark family missing required channels.
- Non-finite positions skipped or converted to zero-size marks.
- Layout reconciliation that hits the pass limit.
- Legend reservation without renderable legend entries.
- Trace mismatch between generated marks and trace inputs.
- Approximation status for 3D/surface families when not already represented by the trace.

Do not hide bugs behind diagnostics. Fatal conditions that make the spec invalid should still fail compilation so kernel stage error reporting can identify `compile`.

Acceptance criteria:

- Existing consumers can ignore `diagnostics`.
- Kernel snapshot generation can include diagnostics later without changing the first implementation slice.
- Tests assert diagnostics for invalid public grammar specs instead of relying on empty marks.

### 4. Normalize scale and encoding contracts

Add a `scale-contract.ts` module that wraps every generated `ChartScale` with stable metadata:

- `kind`: `continuous`, `log`, `time`, `band`, `point`, `ordinalColor`, `sequentialColor`, `size`, `opacity`, `shape`, `constant`, or `empty`.
- `field`, `fieldType`, `channel`, `domain`, `range`, `zeroPolicy`, `explicitDomain`, `nice`, `reverse`, `clamp`, `padding`, and `markType`.
- `positionSemantics`: `bandStart`, `bandCenter`, `continuous`, or `constant`.
- `invalidValuePolicy`: fallback pixel, `NaN`, skip, or diagnostic.

Update `createScales`, `createScaleForChannel`, `resolveEncodings`, axis generation, mark generators, and trace builders to consume metadata rather than probing optional methods or re-inferring scale kind.

Unify scale-domain row construction:

- Unit specs use sanitized transformed data for domain rows and original transformed rows for rendering.
- Layered specs use an explicit `buildLayerScaleDomainRows` helper that extends rows for all layer fields participating in shared channels.
- Independent y scales use the same helper scoped to one layer.
- Color/fill/stroke/shape/size domains include explicit legend entries and scale domains when supplied.

Acceptance criteria:

- Scale metadata in Cartesian, bar, stock, and guide traces matches the scale used by marks.
- Explicit domains and zero policies are test-covered for unit and layered specs.
- Non-finite scale-domain values cannot poison any scale.

### 5. Replace ad hoc layout passes with a layout contract solver

Create `layout-contract.ts` to separate layout responsibilities:

- `collectLayoutInputs(spec)`: axes, secondary axes, legends, title, data table, manual hints, chart frames, pie/doughnut hints.
- `measureLayoutReservations(inputs, dimensions, measurementContext?)`: title, axis labels/titles, tick labels, legend entries, data table, and imported reservations.
- `solveLayout(inputs, reservations)`: chart bounds, plot area, guide areas, and clamp/min-size decisions.
- `reconcileLayoutEvidence(spec, layout, data)`: path-axis tick skip, category pitch, visible label count, and status metadata.

Keep `calculateLayout` as the public function but delegate to the new solver. Replace the fixed `MAX_RECONCILE_PASSES = 2` loop with a convergence loop that records a diagnostic if the spec/layout pair does not stabilize within a small bounded pass count.

Use `CompileOptions.textMeasurementContext` for layout measurement where possible. When no context is available, keep deterministic estimates and record the authority in layout or trace metadata.

Acceptance criteria:

- Existing manual layout, axis reservation, bottom margin, legend overlay, data table, and pie square-plot tests still pass.
- Path-axis reconciliation has tests for convergence, pass limit diagnostics, imported auto tick skip, and layer-level data sources.
- Layout trace or diagnostics state whether text bounds were canvas-measured or estimated.

### 6. Align guide rendering with guide reservation and traces

Refactor guide generation into a `guides/` subfolder or equivalent modules:

- `axis-contract.ts`: axis orientation, crossing, tick streams, minor ticks, gridlines, display units, multi-level labels, label positions, and axis roles.
- `legend-contract.ts`: source channels, entry vocabulary, symbol contracts, flow layout, clipping, reservation, and trace entry identity.
- `title-contract.ts`: title/subtitle rich text, measured bounds, orientation, and style authority.

Expand `generateLegends` so every channel that can reserve legend area can render a corresponding legend:

- `color`
- `fill`
- `stroke`, if retained as a guide-capable channel
- `shape`
- `size`

When multiple guide-capable channels exist, the guide contract should define ordering, combined entries, or explicit multiple legends. The layout, marks, and `LegendTrace` must all use the same resolved guide plan.

Acceptance criteria:

- A non-color legend channel cannot reserve layout without rendered marks or an explanatory diagnostic.
- `LegendTrace.renderedEntries` matches rendered legend marks by entry index, value, label, symbol type, and source identity.
- Axis mark roles continue to support `collectMarks` gridline ordering and `layout-snapshot.ts` grouping.

### 7. Consolidate mark-generator common logic

Add shared mark runtime helpers:

- `datumNumber`, `datumString`, `datumBoolean`, and `datumPaint`.
- `resolveDatumStyle` for fill, stroke, line, paint, opacity, effects, shadow, point style, and per-series chart IR fields.
- `resolvePosition` for scaled, centered, direct, chart-fraction, plot-fraction, plot-radius-fraction, data-table, and pixel positions.
- `resolveBarSlotPosition` shared by bars, labels, rules, and overlays.
- `filterRenderableRows` with explicit blank policy.
- `validatePrimitiveMark` to detect non-finite coordinates, invalid dimensions, and invalid paths before returning marks.

Refactor mark families in slices:

- Cartesian basics: bar, line, area, point, rule, tick, text, rect.
- Pie/radial: arc, arc3d, radar, pie/doughnut label-positioned text.
- Financial/statistical: stockGlyph, boxplot, histogram, violin.
- 3D/surface: bar3d, line3d, area3d, contour, surface3d.

Acceptance criteria:

- Mark generators no longer duplicate local style and datum-field helpers except for genuinely family-specific logic.
- Every data mark has a documented datum provenance policy.
- Invalid-coordinate handling is consistent and test-covered across mark families.

### 8. Make trace contracts schema-first

Create `trace-contracts.ts` with a schema and builder contract for each trace emitted by `CompileResult`:

- Cartesian geometry.
- Bar geometry.
- Stock glyph geometry.
- Legend flow.
- Pie/doughnut label layout.
- 3D approximation.
- Surface/contour approximation.

Each trace contract should define:

- `schemaVersion`.
- Coordinate system.
- Chart and plot bounds.
- Layer identity.
- Source mark family.
- Required scale metadata.
- Mark counts and renderable point counts.
- Status vocabulary and status reasons.
- Mismatch handling when marks and trace inputs disagree.

Add `schemaVersion` to Cartesian geometry if the trace is persisted through kernel snapshots. Keep existing version numbers stable for trace families that already have them unless the schema actually changes.

Acceptance criteria:

- Trace builders are called from the shared pipeline and not separately duplicated in unit/layer compile paths.
- Trace mark counts agree with generated marks after clipping policy is applied, or a diagnostic explains the mismatch.
- Kernel chart compiler tests cover trace presence and schema versions for representative chart families.

### 9. Strengthen layout snapshot extraction

Refactor `layout-snapshot.ts` to use the same measurement authority as the compiler:

- Prefer guide traces and data-label traces for bounds where available.
- Use renderer-equivalent text measurement when `textMeasurementContext` was supplied.
- Parse simple path bounds for axis lines/ticks/gridlines instead of treating path marks as one-point bounds.
- Preserve the single pixel-to-point conversion point.
- Include data-label bounds for generated text marks and `pieDoughnutLabelLayoutTrace` entries consistently.

Acceptance criteria:

- Axis bounds reflect path extents, not only path mark origin.
- Legend entry bounds match `LegendTrace.flow.entries`.
- Data-label layout extraction works for layered cartesian labels and pie/doughnut labels.
- Existing point conversion tests continue to assert exact `px * 0.75` behavior.

### 10. Make TS/WASM transform equivalence a contract

Add a transform registry in `transforms/registry.ts`:

- One entry per `TransformType`.
- Runtime validator.
- TS implementation.
- WASM support flag and expected input/output shape.
- Error policy for invalid specs.

Update `applyTransform` to dispatch by `transform.type` and use the registry. Specs that only match a transform structurally but lack the required discriminant should be treated as invalid input with a deterministic compile diagnostic or error.

Add equivalence tests against the kernel WASM transform path where the test environment can load the WASM exports. At minimum, add shared fixture cases that the TS tests and Rust/WASM tests both consume.

Acceptance criteria:

- Unknown transforms cannot silently return original data.
- Calculate/fold/regression/density/bin/sort/filter/aggregate behavior is covered by fixtures with deterministic output.
- Kernel `compilerPathId` behavior remains `ts-grammar` or `wasm-transforms+ts-grammar` as appropriate.

### 11. Preserve public exports while reducing type coupling

Keep `charts/src/grammar/index.ts`, `charts/src/index.ts`, and `compiler.ts` re-exports compatible for existing public imports.

Move internal-only types behind narrower exports where possible, but do not remove public names in the same implementation unless a deliberate public contract update is coordinated with:

- `charts/src/export/ooxml/*`
- `charts/src/core/*`
- `charts/src/dom/chart-engine.ts`
- `kernel/src/domain/charts/bridge/chart-compiler.ts`
- `@mog-sdk/contracts` snapshot types

Acceptance criteria:

- `@mog/charts` package exports compile cleanly.
- No new dependency from `mog` to `mog-internal`.
- No public type is renamed without coordinated consuming changes.

## Tests and verification gates

Implementation should add focused tests first, then run package and integration gates on the production path.

Required chart package gates:

- `cd /Users/guangyuyang/Code/mog-all/mog/charts && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/charts && pnpm typecheck`

Targeted grammar tests to add or expand:

- `charts/__tests__/grammar/compiler.test.ts`: shared unit/layer pipeline behavior, diagnostics, background/title/legend/clipping parity.
- `charts/__tests__/grammar/encoding-resolver.test.ts`: scale metadata, explicit domains, zero policy, non-finite sanitation, shared layer field domains.
- `charts/__tests__/grammar/layout.test.ts`: layout solver reservations, convergence, manual hints, measured-vs-estimated authority.
- `charts/src/grammar/__tests__/axis-generator-contracts.test.ts`: axis roles, crossings, tick streams, minor ticks, display units, multi-level labels, gridline ordering.
- `charts/src/grammar/__tests__/layout-snapshot.test.ts`: path bounds, guide trace bounds, data-label bounds, point conversion.
- `charts/src/grammar/marks/__tests__/*`: exhaustive `MarkType` coverage, datum provenance, invalid-coordinate policy, clipping policy, and trail rendering.
- `charts/__tests__/grammar/transforms.test.ts`: registry dispatch, invalid transform handling, calculate/fold/bin/aggregate/regression/density fixture outputs.
- `charts/__tests__/integration/full-pipeline.test.ts`: representative chart families still produce renderable marks through `configToSpec -> compile`.
- `charts/__tests__/golden-master/snapshot.test.ts`: stable mark and trace snapshots for representative chart families after intentional snapshot updates.

Cross-folder production gates when compile result, traces, or layout snapshots change:

- Kernel chart compiler tests covering `compileChartMarks`, `compileChartRenderSnapshotAtSize`, compiler stage error handling, trace copying, and resolved spec hashing.
- OOXML export tests for native export and image fallback decisions that depend on `ChartSpec`, `MarkType`, or `CompileResult`.
- DOM chart-engine smoke coverage for `textMeasurementContext` and resize behavior if layout measurement changes.

Verification expectations:

- No formatter/build/test command should be run for this planning worker. The commands above are the implementation plan gates.
- Future implementation should run the chart package tests and typecheck at minimum; if kernel/export snapshot behavior changes, run the relevant kernel/export tests before claiming done.
- UI-facing behavior changes should be exercised through the real chart rendering path in a browser or canvas-backed test, not by direct state mutation.

## Risks, edge cases, and non-goals

Risks:

- `CompileResult` is public and kernel snapshots depend on trace shape. Trace schema changes need coordinated tests and intentional snapshot updates.
- More precise text measurement can shift layout. The plan should treat changed chart geometry as a contract change, not a harmless visual diff.
- Exhaustive mark dispatch will expose currently silent invalid specs. Kernel error handling already has compile-stage reporting, but upstream callers may rely on empty marks for invalid charts; tests should identify and replace those assumptions with diagnostics or explicit errors.
- `trail` implementation may require primitive renderer support for variable-width paths. That should be solved in the production primitive renderer path if needed.
- Layered scale merging is easy to get wrong for independent y axes, combo charts, stock overlays, and data-label layers because layer data can be inherited, inline, transformed, or field-extended.
- Legend expansion across fill/shape/size channels can affect layout reservation and snapshots. The guide plan must define deterministic channel ordering and combined-vs-separate legend behavior.
- Transform equivalence with WASM can fail because TS and Rust numeric edge cases differ. Shared fixtures should pin exact behavior for NaN, Infinity, blanks, dates, sorting ties, regression, bins, and density.

Edge cases to enumerate explicitly:

- Empty data, single datum, all blanks, all hidden/blank sentinel rows, and all non-finite numeric values.
- Duplicate category labels that need stable domain identity versus display text.
- Positive-only, negative-only, mixed-sign, zero-only, and percent-stacked domains.
- Explicit scale domain with `nice`, `zero`, `reverse`, and `clamp` combinations.
- Log scales with zero or negative data.
- Date/time axes using JS `Date`, ISO strings, and Excel serial numbers.
- Secondary axes, independent y axes, top/right axes, and axes crossing at min/max/custom/category centers.
- Manual plot/title/legend layouts clamped to tiny chart sizes.
- Legends with no entries, explicit entries, reversed entries, point-domain entries, stock role entries, and overlaid legends.
- Layered charts with inherited data, layer-local inline data, layer-local transforms, annotation layers, data-label layers, and mixed mark families.
- Pie/doughnut zero values, near-zero labels, exploded slices, multiple rings, and outside labels.
- Radar charts with fewer than three categories, blank policies, and filled marker visibility.
- Surface/contour missing grid cells, source band formats, wireframe modes, and 3D view metadata.
- Stock HLC/OHLC/volume variants with separate and shared volume axis policies.

Non-goals:

- Do not move `ChartConfig` normalization from `charts/src/core` into `charts/src/grammar`.
- Do not introduce a separate rendering engine or a test-only compiler path.
- Do not replace the primitive renderer or canvas renderer as part of this folder plan.
- Do not add dependencies from public `mog` packages to `mog-internal`.
- Do not preserve broken silent-empty behavior for public mark or transform contracts.

## Parallelization notes and dependencies on other folders, if any

Natural parallel slices:

- Pipeline and compile diagnostics: owns `compiler.ts`, `layer-compiler.ts`, `types.ts`, and shared pipeline helpers.
- Mark registry and common mark runtime: owns `marks/index.ts`, `marks/helpers.ts`, and family-specific mark files.
- Scale and encoding contracts: owns `encoding-resolver.ts` plus scale metadata consumers in axes, marks, and traces.
- Layout and guide contracts: owns `layout.ts`, `path-cartesian-reconcile.ts`, `axis-generator.ts`, `legend-generator.ts`, `legend-layout.ts`, and `title-generator.ts`.
- Trace schemas: owns `types.ts`, `*-trace.ts`, and kernel snapshot integration tests.
- Transform registry: owns `transforms/*`, TS/WASM fixture alignment, and kernel transform-path tests.
- Layout snapshots: owns `layout-snapshot.ts`, guide/data-label trace consumers, and bridge layout tests.

Dependencies:

- `charts/src/core` remains the upstream source of `ChartSpec` construction, chart IR fields, series identity, style authority, pie/doughnut geometry, radar semantics, stock semantics, and bar geometry plans. The adjacent `050-charts-src-core.md` plan should land before or alongside grammar changes that depend on a stronger chart-family or row schema contract.
- `charts/src/primitives` may need coordinated updates if `trail` or richer path bounds require primitive mark or renderer support.
- `kernel/src/domain/charts/bridge` depends on `CompileResult`, layout snapshots, trace objects, compile-stage errors, and resolved spec hashes.
- `charts/src/export/ooxml` depends on `ChartSpec`, `MarkType`, native stock/doughnut layer detection, and image fallback decisions.
- `@mog-sdk/contracts` bridge and chart snapshot types may need coordinated updates if diagnostics or trace schema versions become persisted public snapshot fields.

Recommended sequencing:

1. Add exhaustive registries and diagnostics without changing generated geometry.
2. Refactor unit/layer compilation into the shared pipeline while keeping snapshots stable.
3. Add scale metadata and trace schema contracts, then update trace consumers.
4. Expand guide generation to all reserved legend channels.
5. Consolidate mark runtime helpers and implement `trail`.
6. Upgrade layout solver and layout snapshot extraction with measured bounds.
7. Align TS/WASM transform registry and shared fixtures.
