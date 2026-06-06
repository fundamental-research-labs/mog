# 008 — Improve `mog/types/data/src` (data, chart, table & workbook domain types)

## Source folder and scope

- **Folder:** `mog/types/data/src`
- **Package:** `@mog/types-data` (Tier 1 type-only package in the domain graph; `exports` map publishes `.`, `./data`, and one subpath per domain module).
- **Files in scope (12):**
  - `index.ts` (package root barrel — currently `export {};`)
  - `data/index.ts` (the `./data` barrel)
  - `data/charts.ts` (3712 lines)
  - `data/pivot.ts` (654)
  - `data/filter.ts` (588)
  - `data/slicers.ts` (553)
  - `data/tables.ts` (491)
  - `data/sparklines.ts` (368)
  - `data/sorting.ts` (284)
  - `data/grouping.ts` (248 — holds the package's only runtime value, `DEFAULT_SHEET_GROUPING_CONFIG`)
  - `data/named-ranges.ts` (132)
  - `data/trace-arrows.ts` (186)
- **In scope:** the exported type/interface/union surface; the two barrels; the manager interface contracts (`IFilterManager`, `ITableManager`, `ISlicerManager`, `IGroupingManager`, `ISparklineManager`, `IPivotEngine`, `PivotExpansionStateProvider`); doc comments that describe those contracts; cross-module vocabulary consistency.
- **Out of scope (do not edit, named only to describe coupling / ripple):**
  - The Rust source of truth — `mog/kernel/.../compute/compute-types.gen.ts` (generated), `domain-types::domain::grouping`, `StoredSlicer` — which several files in this folder hand-mirror.
  - Implementations of the manager interfaces in `mog/engine/**` and `mog/kernel/**`.
  - The `@mog/charts` package that extends `ChartConfig` into `StoredChartConfig`.
  - The `mog/contracts/src/data/*` re-export shims and upstream tiers (`@mog/types-core`, `-commands`, `-formatting`, `-objects`).
  - Any change requiring edits there is flagged below as a cross-folder dependency.

## Current role of this folder in Mog

`@mog/types-data` is the **single source of truth for structured-data domain contracts** in the spreadsheet OS: tables, filters, sorting, pivot tables, charts, row/column grouping, sparklines, named ranges, slicers, and formula trace arrows. It is Tier 1 of the type graph — it depends only on `@mog/types-core` (cell identity, `CellValue`, `SheetId`, `CellRange`, `IdentityFormula`), `@mog/types-commands` (event bases), `@mog/types-formatting` (CF rules, re-exported for back-compat), and `@mog/types-objects` (`ObjectPosition` for slicers). It is consumed widely: ~99 import sites reference `./data/pivot`, ~82 `./data/charts`, ~68 each for `./data/tables` and `./data/filter`, and so on across the engine, kernel, SDK, and UI.

Because the package is (almost) pure types, "improvement" means making the contracts **complete, internally consistent, accurate to their generated counterparts, and shaped so illegal states are unrepresentable** — without weakening the cell-identity, CRDT-safety, or wire-compatibility invariants these types encode. It has exactly one runtime value (`DEFAULT_SHEET_GROUPING_CONFIG`), so the emit footprint is effectively a `.d.ts` surface.

## Improvement objectives

1. **Stop the hand-mirrored types from silently drifting from the Rust source of truth.** `pivot.ts`, `sparklines.ts`, and `grouping.ts` each carry a header saying their types are *manually* kept "structurally identical" to generated Rust types, and `slicers.ts` `@deprecate`s its whole config in favour of generated `StoredSlicer`. Make the generated type the canonical export (re-export, not re-declare) wherever a generated counterpart exists, and confine this package to the TS-only types that have no Rust counterpart.
2. **Make illegal states unrepresentable in the criteria types.** `ColumnFilterCriteria` (filter.ts) is a single flat interface with a `type` discriminant but all variant payloads optional — `{ type: 'value', topBottom: {...} }` typechecks. Convert it to a discriminated union, matching the pattern `SortCriterion` already uses successfully in `sorting.ts`.
3. **Unify the aggregate-function and sort vocabularies across modules.** The same statistical aggregate family is spelled three different ways (`pivot.AggregateFunction`: `stdev|stdevp|var|varp|counta`; `grouping.SubtotalFunction`: `stdDev|stdDevP|var|varP|countNums`; `tables.TotalFunction`: `stdDev|var|countNums`), and sort axis vocab diverges (`sorting.SortBy`: `cellColor|fontColor` vs `filter.FilterSortState.sortBy`: `color`). Establish one canonical vocabulary and derive the per-feature subsets from it.
4. **Make ID typing consistent.** Persisted/identity fields are typed `SheetId` in `sorting/trace-arrows/tables/sparklines` but bare `string` in `grouping/slicers/filter/pivot` and in *every* manager interface. Adopt the branded `SheetId`/`CellId` types uniformly, and brand the currently-unbranded `fieldId` (pivot already brands `PlacementId`/`CalculatedFieldId`/`PivotMemberKey`/`PivotTupleKey` but not `fieldId`).
5. **Tame the `ChartConfig` god-object and tighten its stringly-typed axis fields.** `ChartConfig` is a ~220-line flat interface mixing user-facing config, OOXML-roundtrip preserved metadata, layout authority, z-order *commands*, and `extra?: unknown`. `SingleAxisConfig` has ~15 `?: string` fields that already have literal-union types defined elsewhere in the same file. Group the config into cohesive sub-shapes and replace `string` with the existing unions.
6. **Complete the in-flight migrations the deprecations describe.** Finish the cell-identity move for tables (`range` is *required* while its replacement `rangeIdentity` is *optional* — backwards) and retire the deprecated chart axis/data-label aliases (`xAxis`/`yAxis`/`secondaryYAxis`, `type`/`show`, `showCategory`/`showPercent`, `trendline`).
7. **Separate persisted state from transient/runtime state, and standardize persisted-type versioning.** `FilterState` mixes durable CellId definition with runtime-only resolved positions (`startRow?/startCol?/…`); only `PivotTableConfig` and chart configs carry a `schemaVersion` while `TableConfig`/`FilterState`/`SlicerConfig`/`Sparkline`/`SheetGroupingConfig`/`DefinedName` do not.
8. **Make the root barrel honest.** `src/index.ts` is `export {};` and the `.` export entry maps to it — zero TS files import `@mog/types-data` bare (all use subpaths). Either re-export the public surface from `.` or document the empty root as intentional and keep the subpath-only contract explicit.

These are production-path contract improvements: they tighten the types the engine, kernel, SDK, and UI compile against, not test scaffolding.

## Evidence (observed in the current tree)

- **Hand-mirrored generated types (drift risk).**
  - `pivot.ts:1–12`: "structurally identical to the auto-generated Rust types in `compute-types.gen.ts`. If the Rust structs change, these definitions MUST be updated manually to stay in sync."
  - `grouping.ts:8–12`: "The Rust types are the source of truth; these TS definitions must stay in sync. Bridge codegen also generates these … if the two diverge, the generated version is authoritative."
  - `sparklines.ts:5–9, 20–22`: claims to "re-export the generated types" but actually **copies** them ("copied from Rust-generated compute-types.gen").
  - `slicers.ts:211–213, 252–254`: `SlicerConfig` and `StoredSlicerConfig` are both `@deprecated` in favour of generated `StoredSlicer`.
- **Non-discriminated criteria union.** `filter.ts:120–231` — `ColumnFilterCriteria.type: 'value'|'condition'|'color'|'top10'|'dynamic'|'icon'` with every payload (`values`, `conditions`, `colorFilter`, `topBottom`, `dynamicFilter`, `iconFilter`) optional and co-present. Contrast `sorting.ts:87–121` (`SortCriterion`) and `sorting.ts:174–197` (`ApiSortCriterion`), which *are* discriminated and explicitly note "invalid combinations … don't typecheck."
- **Divergent aggregate vocab.** `pivot.ts:26–38` vs `grouping.ts:139–150` vs `tables.ts:148–158` — three spellings of std-dev/variance/count-numbers for the same conceptual set.
- **Divergent sort vocab.** `sorting.ts:57` (`'value'|'cellColor'|'fontColor'`) vs `filter.ts:256` (`'value'|'color'|'icon'`). `filter.ts:169–185` (`FilterColorFilter.type: 'fill'|'font'`) uses yet another axis name; the comment at `filter.ts:176–182` documents that `'background'` was already renamed to `'fill'` once for exactly this consistency reason.
- **Inconsistent ID typing.** `sheetId: SheetId` at `sorting.ts:248`, `trace-arrows.ts:60`, `tables.ts:204`, `sparklines.ts:70`; bare `sheetId: string` at `grouping.ts:33`, `slicers.ts:219,259`, `filter.ts:83`, `sparklines.ts:33,84`, `pivot.ts:351` (`sourceSheetId?: string`). Every manager-interface method uses bare `string`. `pivot.ts` brands `PlacementId`/`CalculatedFieldId`/`PivotMemberKey`/`PivotTupleKey` but leaves `fieldId: string` unbranded across ~10 interfaces.
- **`ChartConfig` god-object.** `charts.ts:3480–3700` — one interface mixing: user config (type/subType/data ranges/series), point-and-cell positioning duplicated (`anchorRow/anchorCol/width/height` *and* `heightPt/widthPt/leftPt/topPt`), OOXML-preserved 3D/surface metadata (`view3d`, `floorFormat`, `surfaceBandFormats`, …), a z-order *command* enum (`zOrder: 'front'|'back'|…`, semantically a mutation verb not config), and `extra?: unknown` (`charts.ts:3663`).
- **Stringly-typed axis.** `charts.ts:619–680` (`SingleAxisConfig`) — `axisType?: string`, `tickMarks?: string`, `minorTickMarks?: string`, `position?: string`, `crossBetween?: string`, `tickLabelPosition?: string`, `baseTimeUnit?: string`, `majorTimeUnit?: string`, `minorTimeUnit?: string`, `labelAlignment?: string`, `displayUnit?: string`, plus `alignment?: string` (a self-described "alias for labelAlignment") and the `@deprecated type?: AxisType`/`show?: boolean` aliases. `AxisType` (`charts.ts:146`) already exists as a union.
- **Deprecated aliases still live.** `charts.ts:698–703` (`xAxis`/`yAxis`/`secondaryYAxis`), `729–734` (`showCategory`/`showPercent`), `790–796` (trendline display aliases), `3529–3530` (`trendline` singular). Repo-wide there are ~209 references to `.xAxis|.yAxis|.secondaryYAxis|showCategory|showPercent` — migration is real work, not a no-op.
- **Backwards table migration.** `tables.ts:198–238` — `rangeIdentity?: CellIdRange` (the CRDT-safe replacement) is **optional** while `range: CellRange` (`@deprecated … kept for migration only`) is **required**. Repo-wide only **2** sites read `.rangeIdentity`, indicating the migration stalled.
- **Persisted vs transient mixing.** `filter.ts:283–363` — `FilterState` ends with `startRow?/startCol?/endRow?/endCol?: number|null` explicitly labelled "runtime only, not persisted. Populated by Rust when filters are queried," embedded in the same interface that is "the persisted state in Yjs."
- **Versioning gap.** `schemaVersion` present on `PivotTableConfig` (`pivot.ts:344`) and chart configs (`charts.ts:1058,…`), absent on `TableConfig`, `FilterState`, `SlicerConfig`, `Sparkline`, `SheetGroupingConfig`, `DefinedName`.
- **Dead root barrel.** `index.ts:23` is `export {};`; the package `exports['.']` maps to it; **zero** TS files import `from '@mog/types-data'` bare.
- **Opaque escape hatches that may now be resolvable.** `pivot.ts:501` (`PivotRowColItem = unknown`), `pivot.ts:88` (`mutationResult: unknown`), `charts.ts:3663` (`extra?: unknown`) — each is a typed boundary deferred "until the Rust side exports the concrete shape"; worth re-checking against the current generated output.

## Production-path contracts and invariants to preserve or strengthen

- **Type-only, near-zero-emit package.** Keep the surface type-only except the single intentional value export `DEFAULT_SHEET_GROUPING_CONFIG` (`grouping.ts:76`). If the canonical vocabulary in objective 3 is shared as a value (e.g. a `const` array), add it deliberately and ensure the `contracts/src/data` shim re-exports it (cross-folder); otherwise keep it a pure `type`.
- **Cell Identity Model is load-bearing.** Filters/sorts/tables/named-ranges/trace-arrows deliberately key on `CellId`/`CellIdRange`/`IdentityFormula` (not positions) for CRDT safety across concurrent structure edits (`filter.ts:12–35`, `tables.ts:6–12`, `named-ranges.ts:6–24`, `trace-arrows.ts:5–9`). Strengthen this (finish the table migration) — never weaken it back toward position-based keys.
- **Wire compatibility with the Rust core.** Many shapes are annotated "matches `<X>Data` wire type" (charts) or "mirrors the Rust enum" (filter `DynamicFilterRule`, pivot). Field names and union members are part of the serde contract — re-export the generated type rather than renaming members. Vocabulary unification (objective 3) must map to, not replace, the wire spelling at the serialization boundary.
- **Public subpath surface.** Consumers import via `@mog/types-data/data/<module>` and `@mog/types-data/data`. Do not rename or remove exported symbols without updating `contracts/src/data/*` and any api-extractor config (cross-folder). The `./data` barrel intentionally re-exports `@mog/types-formatting/conditional-format/rules` to avoid a types-formatting↔types-data cycle (`data/index.ts:2–6`) — preserve that exact re-export.
- **Tier-1 boundary.** This package may import from `-core/-commands/-formatting/-objects` only, never from `kernel/engine/contracts`. The import-boundaries eslint rule enforces this; re-exporting generated Rust types must not introduce an upward edge (re-export through an allowed tier or keep the generated file as the importer's responsibility — see Risks).
- **Discriminant strengthening is additive to safety.** Converting `ColumnFilterCriteria` to a discriminated union narrows what implementations may construct; the discriminant key (`type`) and member names stay identical so serialized data is unchanged.

## Concrete implementation plan

Sequenced so additive/low-risk steps land first and shape changes that ripple into implementations come later behind explicit cross-folder coordination. Each step is independently shippable.

### Step 1 — Make the root barrel honest (additive, isolated)
- Decide and encode one policy for `src/index.ts`: either `export * from './data';` so `.` is usable, or keep `export {}` and add a doc block stating the package is subpath-only and why. Given 0 bare imports and an existing `./data` barrel, the lowest-risk choice is to keep it empty but documented; the alternative (populating it) is also safe because it is purely additive. No consumer currently depends on `.` resolving to anything.

### Step 2 — Discriminate `ColumnFilterCriteria` (filter.ts; type-narrowing, no wire change)
- Rewrite `ColumnFilterCriteria` (filter.ts:120) as a discriminated union over `type`, one member per variant carrying only its payload (`value` → `values`/`includeBlanks`; `condition` → `conditions`/`conditionLogic`; `color` → `colorFilter`; `top10` → `topBottom`; `dynamic` → `dynamicFilter`; `icon` → `iconFilter`). Model it exactly like `SortCriterion` (sorting.ts:87).
- Cross-folder: this will surface places in the engine/SDK that construct an under-specified criteria object; those are real latent bugs to fix in their own folders. Land the type change, then fix fallout.

### Step 3 — Unify aggregate-function & sort vocabularies (sorting/filter/pivot/grouping/tables)
- Introduce one canonical `AggregateFunction` family and derive feature subsets via `Extract<…>`/`Pick`-style aliases so `TotalFunction`, `SubtotalFunction`, and pivot's `AggregateFunction` share spelling. Reconcile casing to the wire spelling (the generated pivot type wins where one exists) and add explicit mapping notes where a feature legitimately omits members.
- Unify the sort-axis vocab: make `FilterSortState.sortBy` reuse `sorting.SortBy` (`'value'|'cellColor'|'fontColor'`) or document the deliberate divergence; align the color-axis discriminant naming (`fill`/`font`) across filter and sort.
- This is the highest cross-module-ripple step (touches mapping code at every filter/sort/pivot boundary). Stage it after Steps 1–2.

### Step 4 — Consistent, branded ID typing (all modules + manager interfaces)
- Replace bare `sheetId: string` with `SheetId` in `grouping.ts`, `slicers.ts`, `filter.ts`, `pivot.ts` (`sourceSheetId`), `sparklines.ts` (`SparklineCellAddress`, `SparklineGroup`), and across all `I*Manager` method signatures.
- Introduce a branded `FieldId` for pivot `fieldId` and thread it through `PivotField`, `PivotFieldPlacementFlat`, `PivotFilter`, `PivotHeader`, etc. (mirrors the existing `PlacementId` branding pattern).
- Branding is structurally compatible with existing string values, so this is compile-time-only; expect typecheck fallout at construction sites (cross-folder) that pass raw strings — those get a cast or a proper branded value.

### Step 5 — Finish the table cell-identity migration (tables.ts; depends on engine coordination)
- Make `rangeIdentity: CellIdRange` **required** and `range?: CellRange` optional-and-deprecated (or remove `range` entirely once the 2 readers + all writers are migrated). Update `resolveTableRange`/`createTable` contracts to derive position from identity.
- Cross-folder: requires the engine to populate `rangeIdentity` on every table write before the field flips to required. Sequence: (a) populate everywhere, (b) flip optionality here, (c) delete `range`.

### Step 6 — Retire deprecated chart aliases (charts.ts; depends on consumer migration)
- Remove `AxisConfig.xAxis/yAxis/secondaryYAxis`, `SingleAxisConfig.type/show`, `DataLabelConfig.showCategory/showPercent`, `ChartConfig.trendline` (singular), and the trendline display aliases — after migrating the ~209 repo references (cross-folder, mechanical rename to `categoryAxis`/`valueAxis`/`secondaryValueAxis`/`axisType`/`visible`/`showCategoryName`/`showPercentage`/`trendlines`).

### Step 7 — Tighten `SingleAxisConfig` stringly-typed fields (charts.ts)
- Replace `axisType?: string` etc. with the existing/added literal unions (`AxisType`, tick-mark mode, axis position, crossBetween mode, tick-label position, time-unit). Collapse `alignment` into `labelAlignment`. Keep names matching the wire `SingleAxisData`.

### Step 8 — Decompose `ChartConfig` into cohesive sub-shapes (charts.ts; additive then migratory)
- Extract grouped sub-interfaces (positioning: cell-anchor vs point; OOXML-preserved 3D/surface metadata; pivot projection; style/format) and compose `ChartConfig` from them. Move the z-order *command* (`zOrder`) out of the persisted-config shape into the chart-update/command input type (it is a verb, not state). Re-evaluate whether `extra?: unknown` can be narrowed.
- Do this compositionally (same field names, just regrouped via `&`/nested optionals) to preserve structural compatibility, then migrate call sites incrementally.

### Step 9 — Separate persisted vs transient state, standardize versioning
- Split `FilterState`'s runtime resolved-position fields (`startRow/startCol/endRow/endCol`) into a separate `ResolvedFilterExtent` returned by query paths, leaving `FilterState` purely durable.
- Add `schemaVersion` to the remaining persisted Yjs types (`TableConfig`, `FilterState`, `SlicerConfig`, `Sparkline`, `SheetGroupingConfig`, `DefinedName`) for forward-migration parity with pivot/charts. Cross-folder: persistence/migration code must default-fill the version on read of old documents.

### Step 10 — Re-export (not re-declare) generated types (pivot/sparklines/grouping/slicers; depends on codegen surface)
- Where a generated counterpart exists in `compute-types.gen`, re-export it as canonical and delete the hand-copy, keeping TS-only types (e.g. `SortOrder`, `PivotItemInfo`, render-data shapes) local. Resolve the import-direction concern (Tier-1 package re-exporting a kernel-generated file) — likely the generated *type-only* shapes should be promoted into a tier this package may import, or the codegen should additionally emit into `types-data`. This is the largest architectural decision and is sequenced last; until resolved, at minimum add an automated drift check (cross-folder) so the manual mirrors can't silently diverge.

## Tests and verification gates

This is a type-only package; the gates are compile-time and contract-shape oriented.

- **Typecheck the whole workspace.** Because consumers import deep subpaths, a project-wide `tsc`/`turbo typecheck` is the primary gate after every step. Steps 2, 3, 4, 6 will intentionally surface call-site errors — those must be driven to zero (in their own folders) before merge.
- **Build the package declarations.** Emit `.d.ts` and confirm the rolled-up public surface changed only as intended (no accidental symbol removal/rename). Compare exported-symbol lists before/after.
- **Wire round-trip / serde gates.** For any vocabulary or member-name touch (Step 3, 7, 10), run the existing OOXML import/export and Rust-serde round-trip suites to prove field names/union members still serialize identically. (Recall: prior chart-series serde breakage came from a non-`Option` field emitting `undefined` — treat serde compatibility as a hard gate.)
- **Generated-vs-handwritten drift check (Step 10).** Add/lean on a structural-equality check between the re-exported generated types and any remaining mirrors so divergence fails CI instead of being discovered at runtime.
- **Lint import boundaries.** Run the `eslint-plugin-mog` import-boundaries rule to confirm no new upward dependency edge was introduced (especially by Step 10's re-export).
- **App-eval / api-eval regression.** Run the data-tab, filters, pivot-tables, and chart scenarios to confirm no behavioral regression from the discriminant/migration changes.
- **Per the constraints, this plan does not itself run any build/test/typecheck commands** — these gates are prescribed for the implementing change.

## Risks, edge cases, and non-goals

- **Wire-contract breakage is the dominant risk.** Renaming a union member or field that crosses the Rust serde boundary corrupts persistence and OOXML round-trip. Mitigation: vocabulary unification (Step 3) maps to the wire spelling rather than replacing it; member names stay byte-identical at serialization; serde round-trip is a hard gate.
- **Branding fallout (Step 4) is broad but shallow.** Branded `SheetId`/`FieldId` are compile-time only; the risk is a large but mechanical set of construction-site errors. Stage behind a single typecheck pass.
- **Deprecation removal (Steps 5, 6) blocks on consumer migration.** ~209 chart-alias references and the table-`range` writers live outside this folder. The optionality flip / field deletion must be the *last* commit after migration, or the build breaks. Keep alias removal and consumer migration in lockstep.
- **Generated-type re-export (Step 10) has an import-direction hazard.** A Tier-1 package cannot import from kernel. Resolving where the generated type-only shapes should live is a real architectural decision that may not be fully closable within this folder alone; the fallback (a CI drift check over the manual mirrors) is the floor, not the goal — the production-path objective remains a single source of truth, not a perpetual hand-sync.
- **`ChartConfig` decomposition (Step 8) must stay structurally compatible.** Regrouping fields via composition is safe; physically nesting previously-flat fields is a breaking shape change and is explicitly *not* proposed unless every consumer is migrated in the same change.
- **Non-goals:** no reduced-scope or test-only fixes; no compatibility shims beyond the deprecation windows already needed for safe migration; no behavior changes to the engine/kernel implementations except as the necessary downstream of a contract change; no edits outside this folder (cross-folder work is flagged for separate, coordinated changes); not rewriting the OOXML chart-type taxonomy.

## Parallelization notes and dependencies on other folders

- **Independent / parallelizable now:** Step 1 (root barrel), Step 2 (filter discriminant — type side), Step 7 (axis unions), Step 9's `schemaVersion` additions. These are confined to this folder and only additive at the type level.
- **Ordering within this folder:** Step 3 (vocab) should follow Step 2; Step 8 (chart decomposition) should precede or merge with Step 7; Step 6 (alias removal) must follow Step 7 (so the canonical fields exist). Step 10 is last.
- **Cross-folder dependencies (coordinate with the owning queue items):**
  - **Rust/codegen + `compute-types.gen`** — Step 10 (canonical generated types), Step 3 (canonical wire spelling). Hard dependency on the kernel/bridges-compute folder.
  - **`@mog/engine` + `@mog/kernel`** — Steps 2, 4, 5, 9 surface construction-site and persistence-default fallout; Step 5 needs `rangeIdentity` populated on every table write first.
  - **`@mog/charts`** — Step 8 (`StoredChartConfig` extends `ChartConfig`) and Step 6 (alias consumers).
  - **`mog/contracts/src/data/*`** — any new value export or symbol rename must be mirrored in the re-export shim; the conditional-format re-export must stay intact.
  - **SDK / UI consumers** — the ~209 chart-alias and ~32 `valueFieldId` references for Steps 6 and 3.
- A focused worker can complete Steps 1, 2, 7, 9 against the current tree without blocking; the higher-ripple steps (3, 4, 5, 6, 8, 10) should be scheduled after the dependent folders' contracts are agreed.
