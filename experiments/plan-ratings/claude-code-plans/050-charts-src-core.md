# Plan 050 — Improve `mog/charts/src/core` (Chart IR, config→spec, style resolution)

## Source folder and scope

- **Folder:** `mog/charts/src/core`
- **Public source folder (read):** `/Users/guangyuyang/Code/mog-all/mog/charts/src/core`
- **Scope of this plan:** the core, DOM-free chart computation layer:
  - Public barrel `index.ts` and the thin entry `chart-engine.ts` (`configToSpec`, `collectMarks`).
  - `config-to-spec/` (~55 files + `layers/`): the `ChartConfig + ChartData → ChartSpec` converter, including encoding, marks, axes, legends, data-rows, geometry, and per-family layer assembly.
  - `chart-ir/`: the low-level intermediate-representation geometry/layout math (bar geometry, rectangle model, bar/path axis layout, value-axis scaling, internal field names).
  - `data-extractor*.ts`: range/table/imported-cache → `ChartData` extraction and caching helpers.
  - Domain semantics modules: `stock-semantics.ts`, `stock-role-plan.ts`, `radar-semantics.ts`, `radar-visual-contract.ts` (in config-to-spec), `series-identity.ts`, `chart-type-bridge.ts`.
  - `style-resolver/` (`resolver.ts`, `color.ts`) plus the overlapping `config-to-spec/color-authority.ts` and `config-to-spec/style.ts`.
- **Out of scope (depended on, not changed here):** `mog/charts/src/grammar/*` (spec compiler, marks, axis generator), `mog/charts/src/primitives/*`, `mog/charts/src/dom/*` (render bridge), `mog/charts/src/export/*` (OOXML export), `mog/charts/src/math/trendlines`, and the SDK contracts/types packages.

## Current role of this folder in Mog

`core` is the pure-computation heart of the charts package. It sits between the document model and the renderer/exporter on this production path:

```
ChartConfig + spreadsheet ranges
  → data-extractor*           (ranges/cache → ChartData)
  → configToSpec(config,data) (config-to-spec/*, using chart-ir math + style resolution)
  → ChartSpec
  → grammar/compiler.compile  (out of scope)
  → collectMarks(result)      (chart-engine.ts, flat render order)
  → dom render / OOXML export
```

Confirmed consumers of the public surface (`index.ts`):
- `mog/charts/src/dom/chart-engine.ts` imports `configToSpec` and `collectMarks` — the canvas render entry point.
- `mog/charts/src/grammar/marks/*`, `grammar/*-trace.ts` import internal field-name constants and `bar-geometry`/`pie-like` geometry helpers (the spec compiler reads the same field vocabulary the converter writes).
- `mog/charts/src/export/ooxml/*` (bar/pie/scatter/stock chart XML) import `fields` constants and `bar-geometry`/stock semantics for round-trip OOXML export.

Key structural facts established by inspection (read-only):
- The **real** IR lives in `chart-ir/`. The like-named files under `config-to-spec/` are facades or adapters:
  - `config-to-spec/bar-geometry.ts` = `export * from '../chart-ir/bar-geometry'` + rectangle-model.
  - `config-to-spec/fields.ts` = re-export of `../chart-ir/fields` plus a couple of grammar/internal field re-exports.
  - `config-to-spec/series-style.ts` = `export * from './style'` (pure alias).
  - `config-to-spec.ts` (root) = `export * from './config-to-spec/index'`.
  - `data-extractor.ts` = compatibility facade re-exporting from `data-extractor-primitives/-config/-range`.
- The folder is disciplined where it counts: no `any`, no `@ts-ignore`, functions are pure and side-effect-free, and conversion degrades gracefully (returns `undefined`/defaults) rather than throwing — only `data-extractor-primitives` throws on a malformed range string.

This plan is **not a rewrite**. The folder is healthy. The objectives are to reduce the few genuine risk concentrations (oversized god-files, triplicated color resolution, an under-specified extractor cache contract, silent-failure observability, and ad-hoc `as` casts at type boundaries) without changing the output `ChartSpec` for any existing input.

## Improvement objectives

1. **O1 — Decompose the four >900-line god-files** (`config-to-spec/excel-cartesian-geometry.ts` 1508, `pie-doughnut-geometry.ts` 1270, `radar-visual-contract.ts` 1089, `layers/combo.ts` 921) into cohesive sub-modules with the **same public exports**, so the surface in `index.ts` is byte-for-byte unchanged.
2. **O2 — Unify color resolution.** Today three layers compute series/element color with overlapping fallback chains: `style-resolver/resolver.ts:resolveSeriesColor` (format→color), `config-to-spec/style.ts:resolveSeriesColor` (config→color), and `config-to-spec/color-authority.ts:resolveSeriesColorAuthority` (authority snapshot). Make `color-authority` the single source of the fallback chain and have `style.ts` derive from it, eliminating divergent palette/theme-repeat logic.
3. **O3 — Specify and harden the data-extractor cache contract.** `data-extractor-cache.ts` silently masks `pointCount`-vs-`points.length` disagreement via max-index fallbacks. Define the invariant explicitly, make the cache key/identity explicit, and surface (not hide) inconsistency.
4. **O4 — Make silent conversion failures observable.** The converter never throws and rarely records *why* a field was dropped. Route "expected-but-missing" decisions into the existing `ChartStyleContext` diagnostics channel so import/regression debugging has a trail, without changing rendered output.
5. **O5 — Tighten type boundaries.** Replace the ~20 `as`/`as unknown as T` casts at extractor and merge boundaries (`resolver.ts:299-301`, `data-row-style.ts:244-249`, `axis-format-normalization.ts:40`, `excel-cartesian-geometry.ts` mark casts) with type guards or generically-typed helpers.
6. **O6 — Centralize the internal field vocabulary.** `PIE_*`, `MARKER_*`, `SERIES_*` field-name constants are referenced across 5+ modules and re-exported through facades; make `chart-ir/fields.ts` the single declared home and remove drift risk between writer (`config-to-spec`) and readers (`grammar`, `export`).
7. **O7 — Close the highest-value test gaps** (legend, category-axis, error-bar/trendline/analysis-line layers, `resolveSeriesColor` theme-repeat, extractor cache invariants) as characterization tests that lock current behavior before refactors land.

## Production-path contracts and invariants to preserve or strengthen

These must hold across every change in this plan:

- **C1 — `configToSpec(config, data)` is output-stable.** For any existing `(ChartConfig, ChartData)` the produced `ChartSpec` must be structurally identical (deep-equal modulo key order the compiler ignores). This is the central regression invariant; O1/O2/O5 are pure refactors under it.
- **C2 — Public export surface of `index.ts` is unchanged.** Every name re-exported today (the full list in `core/index.ts`, plus `export * from './style-resolver'`) keeps its identity, type, and signature. Consumers in `dom/`, `grammar/`, `export/` must not need edits.
- **C3 — Internal field-name string values are frozen.** Constants like `BUBBLE_SIZE_FIELD`, `MARKER_SIZE_FIELD`, `SERIES_FIELD`, `STOCK_CLOSE_FIELD`, `SERIES_OPACITY_FIELD`, `BLANK_VALUE_FIELD`, `LINE_SEGMENT_FIELD` are a wire contract between the converter, the grammar compiler/trace, and OOXML export. O6 may move *where they are declared* but must not change *their string values* or which module re-exports them.
- **C4 — Purity and DOM-freedom.** No module here may acquire DOM, timer, or global-state dependencies (the file header of `chart-engine.ts` documents this contract). Refactors keep functions pure.
- **C5 — Graceful degradation preserved.** Conversion must keep returning safe defaults rather than throwing for malformed/partial config. O4 adds *diagnostics*, not exceptions. The single legitimate throw in `data-extractor-primitives` (range parse) stays.
- **C6 — OOXML/Excel-fidelity geometry is behavior-preserving.** The `Excel*`-named geometry (bar gap/overlap defaults, auto value-axis scale, cartesian plan, stock role colors) encodes import/export fidelity. Decomposition (O1) must not alter any numeric default (`DEFAULT_EXCEL_BAR_GAP_WIDTH`, overlap defaults, nice-tick steps). Note: these `Excel`-named symbols are an intentional interoperability dialect, not a stray reference — see Non-goals on the "no Excel in code" rule.
- **C7 — Color-authority semantics preserved.** The precedence `explicit color > format fill > format line > palette/theme fallback` and theme-repeat indexing by `sourceSeriesIndex` must be identical after O2; only the *number of implementations* shrinks.

## Concrete implementation plan

Ordered so behavior-locking precedes refactoring, and low-risk extractions precede the largest one.

### Phase 0 — Characterization safety net (do first; supports O7)
0.1 Add snapshot/characterization tests that feed representative `ChartConfig+ChartData` fixtures (one per family: bar/column, line/area, pie/doughnut, scatter/bubble, radar, stock OHLC/candlestick, combo, waterfall, surface/contour, plus an imported-OOXML config) through `configToSpec` and assert on the full `ChartSpec`. These become the C1 oracle for every later phase.
0.2 Add targeted tests for the currently-untested units identified in O7: `legend.ts`/`legend-domain.ts`, `category-axis.ts`, `layers/error-bars`, `layers/trendlines`, `layers/analysis-line-rows`, and `resolver.ts:resolveSeriesColor` theme-repeat path.
0.3 Add extractor cache-invariant tests (see Phase 3) asserting today's behavior, including the `pointCount` < `points.length` and missing-`pointCount` fallbacks, so the Phase 3 change is a deliberate, reviewed behavior change rather than an accident.

### Phase 1 — Field-vocabulary consolidation (O6, C3)
1.1 Make `chart-ir/fields.ts` the canonical declaration of every internal field-name constant currently scattered/duplicated, keeping identical string values.
1.2 Keep `config-to-spec/fields.ts` as the consumer-facing barrel (it already re-exports `chart-ir/fields` + the two grammar/internal additions). Verify each cross-module importer (`grammar/marks/*`, `grammar/*-trace.ts`, `export/ooxml/*`) resolves through the barrel; no string changes.
1.3 Document in `chart-ir/fields.ts` that these are a cross-package wire contract (C3) so future edits don't casually rename values.

### Phase 2 — Color resolution unification (O2, C7)
2.1 Promote `color-authority.ts`'s fallback chain to the single implementation: extract a `resolvePaintAuthority(paint, context, options)` primitive (built on `style-resolver/resolver.ts` low-level fill/line resolvers) that both series- and point-level resolution call.
2.2 Reimplement `config-to-spec/style.ts:resolveSeriesColor` as a thin adapter over `resolveSeriesColorAuthority` (returning `.color`), deleting its parallel fallback/theme-repeat code. Preserve the exported signature (C2).
2.3 Keep `series-style.ts` as the `./style` alias (or inline its single re-export at call sites if no external consumer depends on the alias — verify first).
2.4 Confirm via Phase-0 snapshots that color outputs are unchanged for category-varying charts (pie/doughnut) and series-varying charts.

### Phase 3 — Data-extractor cache contract (O3, C5)
3.1 In `data-extractor-cache.ts`, define the invariant explicitly in code/comments: the authoritative point cardinality and its relationship to `points.length` / `pointCount` / category-level lengths.
3.2 Make the cache identity explicit (document what key callers use and whether stale caches are possible); if `data-extractor-imported.ts` relies on object identity, state that contract at the boundary.
3.3 Replace silent max-index fallbacks with: use the declared `pointCount` when present and consistent; when inconsistent, record a diagnostic (Phase 5) and fall back deterministically. No throw (C5).

### Phase 4 — God-file decomposition (O1, C1/C2/C6) — the bulk of the work
For each file, split by cohesive responsibility into sibling modules and re-export the original names from the original path so imports and `index.ts` are untouched (C2). Lock with Phase-0 snapshots after each split.
4.1 `config-to-spec/excel-cartesian-geometry.ts` (1508) → split into: cartesian-plan builder, value-axis geometry/auto-scale, category-position policy, bubble/area geometry, and the shared types. Reuse `chart-ir/excel-value-axis-scale.ts` instead of any duplicated nice-tick logic; do not change numeric defaults (C6).
4.2 `config-to-spec/pie-doughnut-geometry.ts` (1270) → extract ring builder, slice angle/radius computation (pure), explosion offsets, and legend/color-key helpers; keep `buildPieDoughnutGeometry` as the orchestrator. De-tangle the in-loop ring mutation into a pure ring-builder.
4.3 `config-to-spec/radar-visual-contract.ts` (1089) → separate the validation/diagnostics rules from the contract assembly; route hardcoded diagnostic strings through Phase-5 diagnostics.
4.4 `config-to-spec/layers/combo.ts` (921) → split per-layer assembly (per-series lines, dual-axis, marks vs. encoding) into focused builders; this file imports from 20+ modules, so reducing its fan-in surface lowers circular-dependency risk.
4.5 Lower-priority follow-ups (same pattern, only if time permits): `encoding.ts:buildEncoding` (457, type-switch god-function) decomposed into per-family `build*Encoding` helpers; `stock-visual.ts` hardcoded role→color map (`stockExcelDefaultSourceRoleColor`) parameterized.

### Phase 5 — Diagnostics for silent drops (O4, C5)
5.1 Identify the "expected field missing / fallback taken" branches in `data-rows.ts`, `axis.ts`, `color-authority.ts`, `data-extractor-imported.ts`, and the radar/stock validators.
5.2 Emit structured entries into the existing `ChartStyleContext` diagnostics array (the channel already exists; `radar-visual-contract` already builds an audit trail) instead of returning silently. Output `ChartSpec` is unchanged; only the diagnostics side-channel gains entries.

### Phase 6 — Type-boundary tightening (O5, C1)
6.1 Replace `resolver.ts:299-301` `as unknown as T` merge with a generically-typed `mergeDefined<T>` that filters undefined entries without a double cast.
6.2 Replace `data-row-style.ts:244-249` `color: unknown … as ChartColor` with a `ChartColor` type guard.
6.3 Replace `axis-format-normalization.ts:40` and the `excel-cartesian-geometry.ts` `mark as MarkSpec` casts with narrowing guards.

## Tests and verification gates

> Per task constraints this plan does not run any build/test/typecheck commands. The gates below are what a reviewer/CI must run when the plan is executed.

- **G1 — Output stability (C1):** the Phase-0 `configToSpec` snapshot suite passes unchanged after Phases 1, 2, 4, 5, 6. Any intended diff (only expected from Phase 3) is called out and re-approved.
- **G2 — Public surface (C2):** a `tsc`/type-level check that `core/index.ts` exports the same names+types; downstream packages (`dom`, `grammar`, `export`) typecheck without edits.
- **G3 — Field-value freeze (C3):** a test asserting the literal string values of the wire-contract field constants; OOXML export round-trip tests for bar/pie/scatter/stock still pass.
- **G4 — Color parity (C7):** before/after color outputs equal across the family fixtures, including theme-repeat indexing and category-varying charts.
- **G5 — Geometry fidelity (C6):** numeric assertions that `DEFAULT_EXCEL_BAR_GAP_WIDTH`, overlap defaults, and auto value-axis nice-tick steps are unchanged; bar rectangle-model pixel outputs equal for fixtures.
- **G6 — Cache invariants (O3):** the Phase-0.3 tests, updated to reflect the deliberate Phase-3 behavior, pass; the inconsistent-cache case now produces a diagnostic.
- **G7 — Diagnostics (O4):** tests asserting that missing-field branches emit diagnostics while leaving `ChartSpec` byte-identical.
- **G8 — Lint/discipline:** no new `any`/`@ts-ignore`; cast count strictly decreases; package lint passes.
- **G9 — Package-level eval:** the charts unit suite plus any app-eval/api-eval chart scenarios pass; given mog's known feature-gate/state-leak gotchas, run the full chart eval suite (not `--name` subsets) to catch cross-scenario leakage.

## Risks, edge cases, and non-goals

**Risks & edge cases**
- **R1 — Decomposition altering output.** Largest risk in Phase 4. Mitigation: Phase-0 snapshots gate every split; keep original export paths as re-export barrels; split one file per PR.
- **R2 — Color unification drift (O2).** The three implementations may differ in subtle edge cases (no-format series, theme-tint rounding, palette wraparound). Mitigation: G4 parity fixtures including those edges; treat any diff as a bug to reconcile toward `color-authority` semantics, and document the chosen behavior.
- **R3 — Cache behavior change (O3) is the one intended behavior delta.** Inconsistent caches currently render *something*; the new path must still render deterministically (no throw) and only adds a diagnostic. Mitigation: G6 explicitly re-approves the new behavior.
- **R4 — Hidden cross-package importers of internal field constants.** Moving declarations (O6) could break an importer that bypasses the barrel. Mitigation: grep all importers first; only move declaration site, never string values (C3); G2/G3.
- **R5 — Circular-dependency exposure when splitting `combo.ts` / `color-authority`↔`style-resolver`.** Mitigation: keep dependency direction one-way (`color-authority` → `style-resolver`, never back); verify with a dependency check.
- **R6 — Diagnostics volume (O4).** Over-emitting could spam the context. Mitigation: emit only on genuine fallback/expected-missing branches, deduplicated by owner key.

**Non-goals**
- No change to rendered `ChartSpec` semantics or chart appearance for existing inputs (this is a structural/quality plan, C1).
- No rewrite of the grammar compiler, renderer, OOXML exporter, or trendline math (out of scope).
- **Not** removing the `Excel*` symbol names. The repo rule is "don't reference Excel in source *comments*"; here `Excel` names an OOXML interoperability dialect and is load-bearing for import/export fidelity (C6). This plan keeps those identifiers; it does *not* introduce new Excel-named comments and may convert any *explanatory* Excel mentions in comments into diagnostics/neutral phrasing where it doesn't reduce clarity. Renaming the dialect is a separate, riskier proposal not taken here.
- No reduced-scope/test-only patch: O1–O6 are production-path changes; O7/Phase-0 exist only to make them safe.

## Parallelization notes and dependencies on other folders

- **Sequencing:** Phase 0 must land first. Phases 1, 2, 3, 5, 6 are largely independent of each other and can run in parallel once Phase 0 exists. Phase 4 sub-tasks (4.1–4.4) are independent files and parallelize well; do 4.4 (`combo.ts`) after 4.1–4.3 only if it imports their refactored pieces.
- **Within-folder coupling:** O2 touches `color-authority.ts`, `style.ts`, `series-style.ts`, and reads `style-resolver/resolver.ts` — keep on one branch. O6 touches `chart-ir/fields.ts` + the `config-to-spec/fields.ts` barrel — keep on one branch to avoid import churn collisions.
- **Cross-folder dependencies (read-only here, but verify when executing):**
  - `mog/charts/src/grammar/*` and `mog/charts/src/export/ooxml/*` consume `fields` constants and geometry helpers — they are the reason for C2/C3 and must typecheck unchanged (G2/G3). Coordinate if any field move is unavoidable.
  - `mog/charts/src/dom/chart-engine.ts` consumes `configToSpec`/`collectMarks` — covered by C2.
  - `mog/charts/src/grammar/internal-fields` and `grammar/axis-generator` are imported by this folder (e.g. `layout-hints-axis` uses `formatExcelSerialDateTick`); do not move that dependency, just note the coupling.
  - SDK `@mog-sdk/contracts`/types supply `ChartConfig`/`ChartData`/`ChartSpec`/`ChartStyleContext`; if O4 needs a new diagnostic shape, that is a contracts change requiring `pnpm --filter @mog-sdk/contracts build` before consumers typecheck (per repo convention) — prefer reusing the existing diagnostics shape to avoid this.
- **No dependency on other plan-queue folders** is required to start; this folder is self-contained behind the `index.ts` barrel.

---

### Evidence/confidence note
All structural claims above were verified by read-only inspection on 2026-06-03: the facade re-exports (`config-to-spec/bar-geometry.ts`, `fields.ts`, `series-style.ts`, `config-to-spec.ts`, `data-extractor.ts`), file sizes (`excel-cartesian-geometry.ts` 1508, `pie-doughnut-geometry.ts` 1270, `radar-visual-contract.ts` 1089, `layers/combo.ts` 921, `data-extractor-imported.ts` 521, `index.ts` barrel), the three-layer color resolution, and the consumer set in `dom/`, `grammar/`, `export/`. No TODO/HACK/FIXME markers exist in the folder; no `any`/`@ts-ignore`. Evidence is sufficient; this is not a blocked plan.
