# Plan 051 — Consolidate shared geometry utilities and lock down trace contracts in `mog/charts/src/grammar`

## Source folder and scope

- **Folder:** `mog/charts/src/grammar` (package `@mog/charts`, the grammar-of-graphics compiler that turns a declarative `ChartSpec` + data into renderable marks plus geometry "trace" evidence).
- **In scope (files this plan changes or adds):**
  - Orchestration: `compiler.ts` (514 lines), `layer-compiler.ts` (509), `path-cartesian-reconcile.ts`, `index.ts`.
  - Types/spec: `types.ts` (834), `spec.ts` (1,478), `internal-fields.ts`.
  - Layout/axes/legends: `layout.ts` (837), `layout-snapshot.ts`, `axis-generator.ts` (1,739), `legend-generator.ts`, `legend-layout.ts`, `title-generator.ts`.
  - Scales/encoding: `encoding-resolver.ts` (1,029), `default-colors.ts`.
  - Trace builders: `cartesian-geometry-trace.ts` (983), `bar-geometry-trace.ts`, `stock-glyph-geometry.ts` (754), `stock-glyph-profile.ts`, `approximation-traces.ts` (936), `data-label-trace.ts`.
  - Marks: `marks/*.ts` (≈25 generators incl. `bar`, `area`, `line`, `point`, `rect`, `rule`, `tick`, `arc`, `radar`, `histogram`, `boxplot`, `violin`, `contour`, the 3D/surface family, plus `helpers.ts`, `path-interpolation.ts`, `direct-position.ts`).
  - Transforms: `transforms/*.ts` (`filter`, `sort`, `aggregate`, `bin`, `regression`, `density`, `index`).
  - Tests: `__tests__/*`, `marks/__tests__/*`.
- **Out of scope (read/referenced, not edited):** `mog/charts/src/primitives` (mark/scale/text drawing types and `getTextBounds`), `mog/charts/src/algebra` (`group-by`, `color`, `data-sanitize`), `mog/charts/src/scales`, `mog/charts/src/core/config-to-spec` (producer of specs), `mog/charts/src/dom`/`export`/`components` (downstream of `CompileResult`), and the cross-package consumer `mog/kernel/src/domain/charts/bridge/*`. These define the contracts this plan must preserve; they are not modified here.

## Current role of this folder in Mog

`grammar` is the heart of `@mog/charts`. Its single public entry is `compile(spec, data?, options?) -> CompileResult` (`compiler.ts:217`), re-exported through `index.ts`. The documented pipeline (`compiler.ts:6-17`) is: apply transforms → reconcile path layout → calculate layout → sanitize data → create scales → resolve encodings → generate marks → collect geometry traces → generate axes/legends/title/frame → clip marks to plot area.

Crucially, `CompileResult` carries **two distinct payloads**:

1. **Render output** — `marks`, `axes`, `legends`, `title`, `background`, `bounds`, `layout`, `scales`. Consumed by `dom/chart-engine.ts`, `export/*`, and the statistical `components/*` to actually draw charts.
2. **Geometry/authority "trace" evidence** — `cartesianGeometry`, `barGeometryTrace`, `stockGlyphTrace`, `legendTrace`, `pieDoughnutLabelLayoutTrace`, `threeDApproximationTrace`, `surfaceApproximationTrace`. These are serializable introspection objects (~42 nested interfaces, the majority of `types.ts`) describing *how* geometry was placed.

The trace payload is **not dead weight and not test-only**: it is a load-bearing cross-package contract. `mog/kernel/src/domain/charts/bridge/*` consumes `cartesianGeometry` extensively as chart-"fidelity"/authority evidence — e.g. `xy-family-support.ts` reads `input.cartesianGeometry` ~15 times (`xyCartesianGeometryEvidence`, `scatterPointAuthorityEvidence`, `scatterCoordinateTraceDiagnostics`), `combo-layer-authority.ts:34`, and `chart-family-support.ts:296-374` reference dozens of dotted paths like `resolved.plot.cartesianGeometry.pointAuthority.status`. `mog/kernel/.../__tests__/resolved-spec-snapshot.test.ts:282` asserts on `cartesianGeometry.area`. Any change to trace shape is a kernel-visible API change.

The folder is in good architectural health: zero `as any`/`@ts-ignore`/`FIXME`, pure functions, clean layering on `primitives`/`algebra`. Its weaknesses are **internal-quality**, not correctness: pervasive copy-paste of small numeric helpers, several oversized functions/files, and near-zero unit coverage on the trace builders that the kernel depends on.

## Improvement objectives

1. **Eliminate duplicated numeric/datum helpers.** A bit-identical `clamp(value, min, max)` is hand-redefined in at least 11 modules — `bar-geometry-trace.ts:567`, `stock-glyph-geometry.ts:739`, `stock-glyph-profile.ts:74`, `path-cartesian-reconcile.ts:258`, `layout.ts:311` (`clampNumber`), and `marks/{bar:22, area:30, plot-3d:110, surface-3d:524, depth-3d:528, area-surface-extent:81}.ts` — plus domain variants `clamp01` (`approximation-traces.ts:909`), `clampAxisPosition` (`axis-generator.ts:858`), and `clampYToPlot` (`cartesian-geometry-trace.ts:882`, `marks/area.ts:237`). `normalizePlotX/Y` is duplicated verbatim in `cartesian-geometry-trace.ts:888-892` and `stock-glyph-geometry.ts:726-730`. `datumString`/`datumNumber` accessors are re-declared in ~10 mark files (`bar`, `rect`, `point`, `rule`, `tick`, `arc`, `area`, `radar`, `bar-slot`, `direct-position`) even though `marks/helpers.ts` already exists as the shared home. This duplication is a maintenance and consistency hazard (any future fix — e.g. NaN propagation policy — must be applied 11×).
2. **Decompose the two giant axis routines and the area-geometry collector.** `axis-generator.ts` (1,739 lines) is dominated by `generateXAxis`/`generateYAxis` (~270 and ~485 lines), which interleave tick generation, label layout/collision, multi-level labels, and axis-crossing math. `cartesian-geometry-trace.ts:collectAreaGeometry` (~186 lines) mixes grouping, segmentation, sorting, stacking, and surface-extent capping. Split each into named phase functions to make them reviewable and independently testable.
3. **Raise unit coverage on the trace builders that are a kernel contract.** Only 4 test files exist (`axis-generator-contracts`, `axis-generator-format`, `layout-snapshot`, `marks/depth-3d`) against ~57 modules. The trace builders consumed by `mog/kernel` (`cartesian-geometry-trace`, `bar-geometry-trace`, `stock-glyph-geometry`, `approximation-traces`, `data-label-trace`) and the `compile`/`compileLayered` orchestration have **no** direct tests. Add characterization + contract tests so the kernel-facing trace shape cannot silently regress during the refactors above.
4. **Make trace shape a documented, guarded contract rather than incidental output.** Add an explicit contract note (and a shape-snapshot test) at the trace boundary so future contributors know `types.ts` trace interfaces are consumed cross-package and cannot be reshaped freely.
5. **Pin down floating-point/empty-data edge-case behavior.** The pipeline already uses `Number.isFinite` consistently and `sanitizeDataForScales` strips non-finite domain values (`compiler.ts:251-253`), but empty/single-point/degenerate-domain inputs are untested. Lock current behavior with tests before any helper consolidation changes it.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve (behavioral, not just typed):**

- `compile()` and `compileLayered()` signatures, and the full set + names of `CompileResult` fields (`compiler.ts:375-396`). Downstream (`dom/chart-engine`, `export`, `components/statistical/*`) and the kernel bridge bind to these names.
- The **shape and field names of every trace interface in `types.ts`** consumed by `mog/kernel/.../charts/bridge/*` — especially every `cartesianGeometry.*` path enumerated in `chart-family-support.ts:296-374` (`geometryStatus`, `coordinateSystem`, `pointAuthority.*`, `valueAxes.*`, `series.*`, `bubble.*`, `chartWidth/chartHeight`). Treat these as a frozen surface; consolidation must be internal-only.
- Mark-clipping semantics: only `rect`/`path`/`symbol` marks are clipped to the plot area, and `__mogClipToPlotArea === false` opts out (`compiler.ts:435-462`). The `centeredScalePosition` band-center rule (`marks/helpers.ts:30-38`) — line/area/point/text/rule/tick sit at band center while rect/bar use the leading edge.
- Default fallbacks: missing mark ⇒ `'bar'` (`compiler.ts:471-482`); default size 600×400 (`compiler.ts:245-246`).
- Transform numeric policy, including the division-by-zero ⇒ `null` behavior in `transforms/index.ts` expression evaluation — characterize before touching.
- `skipAxes`/`skipLegend`/`skipTitle` options and `textMeasurementContext` plumbing (`compiler.ts:336-351`).

**Strengthen:**

- A single source of truth for `clamp`, `clamp01`, `normalizePlotX/Y`, `clampToPlot`, and `datumString`/`datumNumber`/`datumNumberArray` so semantics (NaN handling, inclusivity of bounds) are defined once.
- An explicit, tested boundary asserting the kernel-consumed trace shape.

## Concrete implementation plan

**Phase A — Consolidate shared helpers (mechanical, behavior-preserving).**
1. Create `grammar/numeric.ts` exporting `clamp(value, min, max)`, `clamp01(value)`, and the plot-space helpers `normalizePlotX(x, layout)` / `normalizePlotY(y, layout)` / `clampYToPlot(y, layout)` — copying the existing identical implementations verbatim so behavior is byte-for-byte unchanged.
2. Replace the 11 local `clamp`/`clampNumber` definitions and the duplicated `normalizePlot*`/`clampYToPlot` copies with imports. Keep `layout.ts` `clampSize`/`clampRectToBounds`/`clampToPlotArea` and `axis-generator.ts` `clampAxisPosition` as-is initially (they have distinct signatures/semantics); after the common base lands, refactor them to build on `clamp` only if it preserves exact outputs.
3. Move `datumString`/`datumNumber`/`datumNumberArray`/`resolveOpacity` into `marks/helpers.ts` (next to `invokeScale`, `centeredScalePosition`) and replace the ~10 per-file copies with imports. Diff each call site to confirm identical guards (`typeof === 'string' && length > 0`, `Number.isFinite`).
4. Run a grep audit to confirm no remaining local re-definitions, and that no public exports from `index.ts` changed.

**Phase B — Decompose oversized functions (structure only, outputs identical).**
5. In `axis-generator.ts`, extract from `generateXAxis`/`generateYAxis` the cohesive phases: `computeTicks`, `layoutTickLabels` (incl. collision/multi-level), `buildAxisLineMark`, `buildTitleMark`, `resolveAxisCrossing`. Keep `generateAxes` as the public façade; the two functions become thin composers. No tick values, positions, or mark fields may change.
6. In `cartesian-geometry-trace.ts`, split `collectAreaGeometry` into `groupAreaSeries`, `segmentByLine`, `sortSegmentByX`, `accumulateStack`, `capSurfaceExtent`, each pure. Same for any sibling >150-line collector surfaced during the work.
7. If `axis-generator.ts` remains unwieldy, move the extracted label-layout phase into a new `axis-label-layout.ts` (still under `grammar`), exported only internally.

**Phase C — Trace contract guard + docs.**
8. Add a top-of-file contract banner to `types.ts` trace sections and to `cartesian-geometry-trace.ts` stating the shape is consumed by `mog/kernel/.../charts/bridge` and must not be reshaped without a coordinated kernel change. Link the specific consumer files.
9. Add `__tests__/trace-contract.test.ts`: compile representative specs (scatter, line, bar/clustered/stacked, area, candlestick/stock, a 3D bar, a layered combo) and assert the *presence and key field names* of each trace path the kernel reads (drive the list from `chart-family-support.ts:296-374`). This is a tripwire, not a pixel snapshot.

**Phase D — Coverage for builders and orchestration.**
10. Add unit tests per builder: `cartesian-geometry-trace`, `bar-geometry-trace`, `stock-glyph-geometry`, `approximation-traces`, `data-label-trace`, asserting coordinates, grouping/stacking, and status fields on small fixtures.
11. Add `__tests__/compiler.test.ts` covering: empty data, single-point data, degenerate (all-equal) domains, non-finite values in encoded fields (verifying `sanitizeDataForScales` keeps domains finite), `skip*` options, default mark/size fallbacks, and clip opt-out via `__mogClipToPlotArea`.
12. Add `transforms/__tests__/*` for `aggregate`, `bin`, `regression`, `density`, `sort`, `filter`, and the expression evaluator's div-by-zero ⇒ `null` path.

Sequence Phase D's characterization tests for the touched modules **before** Phases A/B land where practical, so they act as the regression net for the refactor.

## Tests and verification gates

- **Unit/contract:** new tests under `grammar/__tests__` and `grammar/marks/__tests__` and `grammar/transforms/__tests__` (vitest, the existing harness).
- **Regression net:** the existing `axis-generator-*` and `layout-snapshot` tests must stay green unchanged — they guard Phase B.
- **Cross-package gate:** `mog/kernel` chart-bridge tests (`resolved-spec-snapshot.test.ts` and the `config-to-spec-*` suites that read traces) must pass unchanged — they are the real proof the trace contract held.
- **Type/lint gate:** package typecheck + lint clean; confirm `index.ts` exported symbol set is byte-identical (diff the export list).
- **Manual verification (per task constraints, not run here):** the gates above are to be executed by the implementer via the repo's standard `pnpm` test/typecheck commands; this planning task does not run them.
- **Definition of done:** zero remaining local `clamp`/`normalizePlot*`/`datumString`/`datumNumber` redefinitions (grep proves it); no oversized axis/area function >~120 lines; every kernel-consumed trace path covered by `trace-contract.test.ts`; all suites green.

## Risks, edge cases, and non-goals

- **Highest risk: silent trace-shape drift breaking `mog/kernel`.** Mitigated by Phase C tripwire tests and by treating trace consolidation as internal-only (helpers, not interface shape). Do **not** "simplify" or flatten the 42 trace interfaces — they are a live contract; any reshaping is a separate, kernel-coordinated effort and out of scope here.
- **Refactor-induced output drift.** Extracting axis/area phases risks subtly reordering marks or shifting a coordinate. Mitigate by landing characterization tests first and diffing compiled output on fixtures before/after.
- **Helper-semantics mismatch.** Some `clamp`-like sites differ (`clampSize`, `clampAxisPosition`, `clampToPlotArea` have extra semantics). Only merge truly identical implementations; keep distinct ones distinct. Verify NaN behavior is preserved (the bare `clamp` does not guard NaN; callers relying on that must keep behavior).
- **Edge cases to pin with tests:** empty data, single datum, all-equal domain (zero range), non-finite encoded values, band scales with zero bandwidth, layered specs with mismatched encodings, stacked vs. clustered bars, OHLC with missing volume.
- **Non-goals:** changing chart visual output; altering the public `compile`/`CompileResult` API; reworking scale algorithms in `../scales`; performance optimization beyond what falls out of decomposition (no caching/memoization changes unless tests prove neutrality); touching `config-to-spec` or DOM/export consumers.

## Parallelization notes and dependencies on other folders

- **Internally parallelizable:** Phase A (helper consolidation) and Phase D (builder/transform tests) are independent and can proceed concurrently. Phase B (axis decomposition) and the cartesian-area split touch different files and can run in parallel once their characterization tests exist.
- **Ordering dependency:** Phase C/D characterization tests should precede Phase B refactors for the modules they cover.
- **Cross-folder dependencies (read-only, must not edit):**
  - `mog/kernel/src/domain/charts/bridge/*` and its tests are the binding consumer of the trace contract — coordinate is needed only if Phase C reveals the contract is already loose; otherwise this plan is non-breaking to kernel.
  - `mog/charts/src/primitives`, `algebra`, `scales` provide the types/utilities this folder builds on; the new `grammar/numeric.ts` deliberately stays within `grammar` rather than pushing helpers up into `primitives`/`algebra` to avoid widening their public surface (revisit only if another package needs the same helpers).
  - `mog/charts/src/core/config-to-spec` produces the specs fed to `compile`; its `config-to-spec-*` tests are part of the cross-package gate.
- **No dependency** on the unrelated dirty paths in `mog-internal` (api-eval/app-eval scenarios, fixtures) — this plan is confined to `@mog/charts` source and its tests, with the single deliverable being this plan file.
