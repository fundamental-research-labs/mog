# 034 - Compute Fill Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-fill/src`

This plan covers the public Rust `compute-fill` crate source that owns pure autofill and flash-fill computation:

- `engine.rs`, `engine_lanes.rs`, `engine_targets.rs`, `engine_policy.rs`, and `engine_emitter.rs`, which turn a `FillInput` into value, formula, format, clear, warning, and summary updates.
- `patterns/*`, which detects copy, linear, growth, date, time, weekday, month, quarter, ordinal, text-number, and custom-list patterns.
- `series/*`, which generates values from detected or declared patterns.
- `formula_adjust/*`, which shifts identity formula references for fill operations.
- `flash_fill.rs`, which synthesizes text transformation programs from examples.
- `types.rs`, `helpers.rs`, and `error.rs`, which define the crate data contract and coordinate helpers.
- Crate-local tests and adjacent production tests that exercise this crate through `compute-core` mutation handlers.

Adjacent production dependencies that must be considered during implementation:

- `mog/compute/core/src/storage/engine/services/mutation_handlers/fill.rs`, which gathers source cells, formats, merges, hidden rows/cols, and formula reference positions, calls `compute_fill::engine::compute_fill`, then applies updates through standard storage mutation paths.
- `mog/compute/core/src/engine_types/fill.rs`, which maps bridge strings and wire ranges into `compute_fill::types`.
- `mog/kernel/src/api/worksheet/operations/fill-operations.ts`, which computes direction and mode flags before calling the compute bridge.
- `mog/contracts/src/fill/*` and generated bridge files, which expose summary types and warnings to TypeScript callers.
- `mog/apps/spreadsheet/src/domain/fill/flash-fill/*` and `apps/spreadsheet/src/systems/grid-editing/features/flash-fill/*`, because the app currently has a TypeScript flash-fill detection and preview path while Rust also exposes `compute_fill::flash_fill`.

This is a public Mog source folder. Implementation belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`compute-fill/src` is the pure computation layer for spreadsheet drag-fill behavior. It has no storage access and no mutation side effects. The caller provides source cells, source and target ranges, direction, mode, merge metadata, hidden row/column sets, custom lists, and locale names. The crate returns a `FillResult` containing sorted updates, a detected pattern, filled-cell count, and warnings.

The production autofill path is:

1. TypeScript kernel builds a bridge request and computes a direction from source/target geometry.
2. `compute-core` converts the bridge request into `FillRequest`.
3. `mutation_auto_fill` gathers source cells, effective formats, formula identity refs, resolved ref positions, merges, hidden rows, and hidden columns.
4. `compute_fill::engine::compute_fill` calculates pure updates.
5. `mutation_auto_fill` converts formula updates back into identity formulas, registers any needed cells in the mirror/grid index, applies values/formulas through `mutation_set_cells_by_position_raw`, and applies formats through the format property path.

The crate is already split around useful concepts:

- Target enumeration skips hidden rows/columns, skips source-range cells, and skips non-origin merged cells.
- Lane planning detects series independently by fill lane: columns for vertical fills, rows for horizontal fills.
- Series generation is delegated by pattern type.
- Formula adjustment supports cells, cell ranges, full rows, full row ranges, full columns, and full column ranges.
- Flash fill is separate from drag-fill series generation.

Important observations from source inspection:

- Pattern detection currently receives only `CellValue`s. It does not use source cell formatting to distinguish date/time serials from ordinary numbers, even though `SourceCell` carries an optional `CellFormat`.
- Date serial weekday/weekend logic is duplicated between pattern detection and series generation, with conflicting comments and separate implementations.
- Numeric, text, cyclic, date, and growth generators do not share one explicit directional anchoring contract. Backward fill behavior should be specified and tested from the source edge adjacent to the target, not inferred from ad hoc helper choices.
- `FillResult` reports one `detected_pattern`, currently derived from the first lane. Multi-lane fills can have different patterns, but the summary does not expose that fact.
- Formula adjustment does not have a first-class rect-range position variant even though storage maps `IdentityFormulaRef::RectRange` into `RefPosition::Range`; that can cause rect-range fills to be treated as mismatched/out-of-bounds instead of adjusted by row/column IDs.
- Storage-side resolution for full-row and full-column refs currently passes placeholder row/column positions in some cases, so the pure crate and storage integration need a combined contract for all formula ref shapes.
- Flash fill exists twice: a Rust bridge-facing implementation in this folder and a richer TypeScript preview engine in the spreadsheet app. Inspection did not find app calls to `computeBridge.flashFill`, so user-visible preview and Rust bridge behavior can drift.
- Tests are substantial, but many comments still describe old bugs that now appear fixed. The next step should turn those into explicit invariants and cross-layer contract tests.

## Improvement objectives

1. Make autofill behavior a complete, testable contract across modes, directions, lanes, source/target overlap, hidden rows/columns, merges, values, formulas, and formats.
2. Replace value-only inference with cell-aware inference that can use value, formula presence, number format, source coordinate, locale, custom lists, and explicit fill mode.
3. Define one directional anchoring model for all series generators, then make numeric, date/time, text-number, ordinal, cyclic, custom-list, and copy behavior conform to it.
4. Make lane planning deterministic from coordinates, not from caller-provided `source_cells` vector order.
5. Expose or internally preserve per-lane pattern information so mixed-column and mixed-row fills are no longer summarized as a single first-lane pattern.
6. Consolidate date/time serial utilities and make date, weekday, month-end, leap-year, time rollover, and date-vs-number inference Excel-compatible by explicit tests.
7. Complete formula reference adjustment for every `IdentityFormulaRef` shape used by production formulas, including rect ranges, full row/column refs, row/column ranges, cross-sheet refs, external refs, and mismatched position data.
8. Align Rust flash fill and TypeScript flash fill into one production contract, with shared fixtures and a clear owner for preview and commit behavior.
9. Strengthen bridge and storage integration tests so crate-local correctness is proven through the actual production mutation path.
10. Keep the crate pure, deterministic, and dependency-light while improving contracts. Storage, mirror registration, UI preview state, and undo grouping stay outside this crate.

## Production-path contracts and invariants to preserve or strengthen

- `compute_fill::engine::compute_fill` remains a pure function. It must not read storage, allocate cell IDs, mutate mirrors, or depend on `mog-internal`.
- Source and target range semantics must be coordinate-driven. The result must not depend on the order in which callers happen to pass `source_cells`.
- Target enumeration must never emit updates for source-range cells, hidden rows, hidden columns, or non-origin merged cells.
- Merge handling must be explicit: origin cells may be fill targets, non-origin cells are skipped, and overlapping target merges produce warnings with stable positions and warning kinds.
- Fill direction must be derived consistently between TypeScript kernel and Rust helper logic for overlapping and non-overlapping ranges.
- Per-lane series must be independent. A vertical fill plans each target column from the corresponding source column; a horizontal fill plans each target row from the corresponding source row.
- Cross-axis tiling must stay intentional: down/up fills tile columns to the right of the source but do not tile columns to the left; right/left fills tile rows below the source but do not tile rows above.
- Hidden rows/columns must not consume generated series values. Only visible target cells advance a lane plan.
- Explicit modes must override inference deterministically: copy, formats, values/withoutFormats, days, weekdays, months, years, linear trend, growth trend, and series mode each need a documented content and pattern contract.
- Include flags must be honored consistently. If `Values` and `WithoutFormats` intentionally include formulas, that behavior must be documented as "values/formulas without formats"; otherwise the mode must be renamed or corrected across bridge contracts and tests.
- `filled_cell_count` must have one meaning. Either count target cells that changed value/formula content only, or count all affected target cells including format-only updates. The selected meaning must be reflected in bridge summaries and tests.
- Formula adjustment must preserve absolute components, shift relative components by source-to-target delta, mark out-of-bounds refs without inventing wrong positions, and preserve source formulas when adjustment cannot be safely rendered.
- Formula ref position data must match formula ref shape. Mismatches should be explicit contract failures or warnings, not silent ambiguous out-of-bounds results unless that behavior is intentionally specified.
- New formula refs created by storage integration must be registered in the grid index and mirror before A1 rendering, preserving the existing no-`#REF!` autofill regressions.
- Date/time inference must not turn ordinary numeric business data into dates merely because the values are inside the date serial range unless the source format or explicit mode supports that decision.
- Date and time generation must use finite values only and produce spreadsheet errors, not panics or NaN/Inf numbers, when overflow or invalid inputs occur.
- Locale and custom-list detection must be case-insensitive where intended, but generated output should preserve canonical locale/list values.
- Flash fill must never overwrite example cells. It may fill only cells explicitly marked fillable by the caller, and success semantics must indicate whether all requested fillable rows were filled.
- Native and WASM builds must preserve the same pure fill results for the same input.

## Concrete implementation plan

1. Write the fill contract matrix first.

   Build a crate-local fixture table covering every `FillMode`, `FillDirection`, pattern type, update kind, warning kind, and formula ref shape. Include columns for source shape, target shape, hidden rows/cols, merges, explicit include flags, expected target iteration order, series-consumption order, update count, filled-cell count, and summary pattern behavior. Use this matrix to drive implementation rather than adding one-off tests.

2. Add validated input and range normalization.

   Introduce a small internal `ValidatedFillInput`/`ValidatedFillRequest` layer that checks `start <= end`, grid bounds, non-empty source and target dimensions, finite `step_value`, and range size overflow before lane planning. Keep public serde structs unchanged unless bridge contracts need typed validation errors. Invalid geometry should produce an empty result plus warning only if that is the public contract; otherwise the bridge layer should promote a typed compute error.

3. Make lane extraction coordinate-stable.

   Replace order-sensitive `group_value_cells_by_lane` behavior with coordinate-sorted lane extraction. For vertical fills, sort each lane by row; for horizontal fills, sort by column. Track source cells by `(row, col)` in a map for emission lookup so target-to-source mapping does not scan the whole source vector for every target. This is both a correctness contract and a production-path efficiency improvement.

4. Define a universal directional anchor model.

   Add a `SeriesAnchor` or `LaneSeed` structure that records source values in grid order, the fill direction, the source edge adjacent to the target, the next visible target index, and whether generation is forward or backward. All generators should consume this shared anchor rather than each family choosing `first` or `last` independently. Backward fills should extend the sequence from the top/left source edge; forward fills should extend from the bottom/right source edge. Add tests for up/left numeric, date, text-number, ordinal, weekday, month, quarter, and custom-list fills with two or more source cells.

5. Make pattern detection cell-aware.

   Change internal detection input from `&[CellValue]` to lane cells or a compact `PatternSample` carrying value, format, formula flag, row, and col. Use format metadata to distinguish dates and times from generic numbers. Preserve explicit date modes regardless of format. Decide and encode the fallback rule for unformatted serial-like numbers. This should eliminate accidental date inference for ordinary numeric series while still supporting real date fills and explicit Fill Series date modes.

6. Consolidate date and time logic.

   Move weekday/weekend/date-serial helpers into one module, backed by `value_types::date_serial` where possible. Add named tests for serial 1 behavior, the 1900 leap-year convention used by Mog, modern known weekdays, weekday skipping forward/backward, time steps by hour/minute/second, and crossing midnight. Fix conflicting comments and make detection and generation use the same utility.

7. Specify Excel-compatible month and year behavior.

   Audit current repeated `add_months_to_serial` behavior for end-of-month seeds such as Jan 31, Feb 29, Mar 31, and leap-day yearly fills. Decide whether month-end anchoring should preserve "last day of month" intent across the series or preserve the clamped day from the previous generated value. Implement the chosen contract consistently for month and year generation and detection, with explicit tests for leap and non-leap years.

8. Strengthen numeric and growth inference.

   Define behavior for constant numeric sequences, negative values, zero values, fractional steps, approximate floating differences, growth with negative multipliers, growth through zero, and overflow. Keep tolerances centralized. If linear should own constant sequences and growth should reject multiplier 1, make that priority explicit in tests. If a generated number is not finite, emit `CellValue::Error` deterministically.

9. Make per-lane pattern results first-class.

   Extend internal `LanePlan` metadata with lane key, source lane, target lane, pattern, generated count, and fallback reason. Update `FillResult` or bridge summary as needed to expose a headline pattern plus optional per-lane summaries. If public contracts keep a single `patternType`, define how the headline is chosen for mixed lanes, such as explicit mode first, common pattern if all lanes agree, otherwise `Copy` or a new mixed summary if the contract is extended.

10. Complete formula reference shape support.

   Add first-class handling for `IdentityFormulaRef::RectRange` in formula adjustment, either through a new `RefPosition::RectRange` variant or by matching rect refs against range-like positions with row/column absolute flags. Update storage reference resolution so full rows, row ranges, full columns, and column ranges resolve actual row/column positions instead of placeholders. External refs should be preserved/fail-closed by contract rather than pretending to be local cell refs. Add mismatch diagnostics for wrong `RefPosition` variants and length mismatches that are visible outside debug builds.

11. Separate formula adjustment policy from coordinate math.

   Keep `formula_adjust::coords` as low-level bounded shift math, but add a higher-level policy object that records why a ref was unchanged: absolute, out of bounds, external/preserved, unresolved, or mismatched. Feed that reason into `FillWarningKind` or an internal diagnostics path so bridge/storage can distinguish a legitimate absolute ref from a failed adjustment.

12. Define update ordering and deduplication.

   Today updates are sorted by `(row, col)` after emission, which can interleave value/formula and format updates for the same cell. Define a stable per-cell ordering, for example clear, value/formula, then format, or keep separate update lists. Ensure storage application cannot observe a format update before a value/formula update in a way that changes behavior. Add tests for cells receiving both content and format updates.

13. Tighten mode and include-flag semantics.

   Build direct tests for every `FillMode` with all include flags. Decide whether explicit `Formats` should count filled cells, whether `Values` should include formulas, whether `LinearTrend` and `GrowthTrend` should operate on non-numeric source cells by falling back to copy or by returning warnings, and whether `Series` with `step_value = 0` auto-detects or emits a constant series. Update bridge comments and contract types to match.

14. Unify Rust and TypeScript flash-fill behavior.

   Choose one production owner. Preferred direction: make Rust `compute-fill` the canonical pure flash-fill engine and expose a preview-capable bridge path so the app preview and commit use the same synthesis logic. If latency requires local TypeScript preview, generate shared fixtures and confidence outputs so TS preview and Rust commit cannot drift. Either way, the plan should retire duplicated untested behavior or turn it into a conformance pair.

15. Upgrade Rust flash fill from greedy examples to ranked programs.

   Add a small program search model with ranked candidates, confidence, per-row apply status, and deterministic tie-breaking. Support multi-token extraction, constants, case transforms, substring transforms with case transforms, delimiter insertion, date/phone-like reformatting, multi-column source combinations if the bridge/app path needs them, and Unicode alphabetic tokens. Success should be false, or warnings should be explicit, when any requested fill row cannot be produced.

16. Update production integration contracts.

   Update `mutation_auto_fill` and `mutation_flash_fill` only as needed to pass the stronger pure inputs and consume richer diagnostics. Preserve standard mutation paths, undo grouping, recalc behavior, mirror registration, and format application. Add bridge result fields only with matching contract updates in `contracts/src/fill`, generated compute bridge types, and kernel callers.

17. Remove stale bug comments after tests encode the invariant.

   Several crate-local tests still describe bugs that appear to have been fixed. Replace narrative "should fail until fixed" comments with invariant-focused names and assertions. Do not delete coverage; make it clearer and systematic.

## Tests and verification gates

Crate-local tests to add or strengthen:

- Contract matrix tests for every mode, direction, pattern type, warning kind, and update kind.
- Coordinate-order tests proving source cell vector order does not affect output.
- Directional anchor tests for down, up, right, and left across numeric, date, time, text-number, ordinal, weekday, month, quarter, and custom-list series.
- Multi-lane tests with different patterns per column/row, including mixed copy/linear/date/text lanes and wider target tiling.
- Hidden row/column tests proving skipped cells do not consume series values.
- Merge tests for target origins, non-origins, partial overlaps, source overlaps, and warning positions.
- Date/time tests for serial conventions, weekday skipping, month-end anchoring, leap years, time rollover, finite number enforcement, and format-aware detection.
- Formula adjustment tests for every `IdentityFormulaRef` variant, including rect ranges, full rows, row ranges, full columns, column ranges, mixed absolute flags, unresolved refs, external refs, and mismatched position diagnostics.
- Flash-fill synthesis tests with shared fixtures for extraction, reordering, constants, casing, substrings, phone/date formatting, ambiguous examples, partial failures, Unicode text, and non-text source values.

Production-path Rust gates for an implementation touching this folder:

- `cargo test -p compute-fill`
- `cargo clippy -p compute-fill`
- `cargo test -p compute-core auto_fill`
- `cargo test -p compute-core auto_fill_integration`
- `cargo test -p compute-core auto_fill_formula_regression`
- `cargo test -p compute-core stress_autofill` when flash-fill or storage integration semantics change
- `cargo clippy -p compute-core` when storage mutation handlers, bridge types, or formula rebasing code change

Bridge and TypeScript gates when public contracts or app flash-fill behavior change:

- Relevant generated bridge freshness gate for `kernel/src/bridges/compute/compute-bridge.gen.ts` and `compute-types.gen.ts`.
- Kernel tests for `autoFill` and `fillSeries` request shaping, especially direction, mode, include flags, and step value.
- `pnpm typecheck` for TypeScript contract or generated bridge changes.
- Spreadsheet UI or E2E tests that drive the real fill handle and Flash Fill preview/acceptance through keyboard/mouse/clipboard paths, not direct state mutation.

Behavioral verification fixtures:

- A production workbook fixture for fill down/up/right/left with values, formulas, formats, hidden rows/cols, merges, and mixed source lanes.
- A formula fixture proving filled formulas render valid A1 strings without `#REF!`, preserve cross-sheet prefixes, and keep absolute refs fixed.
- A flash-fill fixture run through the app preview path and the Rust bridge path, asserting identical preview values, accepted values, and pattern descriptions or confidence where exposed.

Performance verification:

- Only measure production paths: `mutation_auto_fill`, `mutation_flash_fill`, and app bridge/UI flows.
- Add bounded large-fill tests for many rows/columns and sparse source data after replacing repeated source-cell scans with coordinate maps.
- Do not optimize helper-only benchmarks or test-only mocks as the primary outcome.

## Risks, edge cases, and non-goals

Risks:

- Format-aware date detection can change current behavior for plain numeric values inside the date serial range. That is acceptable only if the new behavior is encoded as the correct spreadsheet contract and all callers/tests are updated.
- Directional anchoring fixes can reveal existing up/left behavior that was asserted by tests but does not match spreadsheet expectations. Resolve the category systematically rather than preserving inconsistent generator-specific behavior.
- Adding per-lane summaries can require bridge and contract updates. Do not add a private-only summary shape that TypeScript callers cannot consume if user-visible behavior depends on it.
- Formula rect-range and full row/column improvements cross the pure crate and storage reference resolution. The work must be coordinated so pure adjusted positions can be rendered through identity formulas without mirror desync.
- Flash-fill unification can affect both preview UX and bridge behavior. Shared fixtures are required before switching the app path to Rust or changing Rust commit semantics.

Edge cases to cover:

- Overlapping source/target ranges where target includes part of the source.
- Targets wider/taller than the source and asymmetric cross-axis tiling.
- Single-cell sources, single-row/column sources, sparse source cells, and missing mapped source cells.
- Constant numeric sequences, zero steps, negative steps, fractional steps, non-finite results, and growth sequences with zero or negative values.
- Date serials near supported min/max, leap days, month-end fills, weekday-only fills across weekends, and time fills crossing day boundaries.
- Locale names with mixed case, punctuation, abbreviations, and non-English month/weekday names.
- Text-number fills with empty prefixes, leading zeros, negative numbers, suffix-like ordinals, and large numbers.
- Merged target origins, non-origin cells, merges spanning hidden rows/columns, and source ranges containing merges.
- Formula refs at grid boundaries, row/col absolute mixes, cross-sheet refs, rect ranges, full row/column refs, unresolved refs, and external refs.
- Flash-fill examples with headers, ambiguous first example, inconsistent examples, partial rows, non-null examples that must be preserved, and source/target length mismatches.

Non-goals:

- Do not create a separate autofill engine in the app or kernel as a workaround for Rust behavior.
- Do not optimize test-only paths, mock-only paths, or standalone benchmarks instead of the production mutation path.
- Do not add compatibility shims that preserve known incorrect date, direction, formula, or flash-fill behavior.
- Do not make `mog` depend on `mog-internal`.
- Do not broaden this work into general formula parser or storage refactors except where fill formula adjustment needs production support.
- Do not replace standard mutation, recalc, undo, or format property paths from inside `compute-fill`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the fill contract matrix is written.

- Agent A: build the contract matrix and crate-local tests for modes, directions, lanes, hidden rows/cols, merges, and update ordering.
- Agent B: implement coordinate-stable lane extraction, target/source maps, universal directional anchoring, and per-lane summaries.
- Agent C: implement cell-aware pattern detection, date/time utility consolidation, date-vs-number rules, and month/year end behavior.
- Agent D: complete formula reference adjustment for rect ranges, full rows/columns, row/column ranges, unresolved refs, and diagnostics, coordinating with storage reference resolution.
- Agent E: unify Rust and TypeScript flash-fill fixtures, then upgrade Rust flash fill or switch app preview to the Rust-backed contract.
- Agent F: update bridge contracts, generated TypeScript types, kernel request shaping tests, and production integration tests.

Dependencies:

- `mog/compute/core/src/storage/engine/services/mutation_handlers/fill.rs` owns data gathering, formula ref resolution, mirror/grid registration, and storage application.
- `mog/compute/core/src/engine_types/fill.rs` owns bridge request parsing and should carry any new validation or typed mode/direction contract.
- `mog/kernel/src/api/worksheet/operations/fill-operations.ts` owns user-facing request shaping and duplicated direction logic.
- `mog/contracts/src/fill` owns TypeScript-facing fill modes, warnings, summaries, and flash-fill preview types.
- `mog/apps/spreadsheet/src/systems/grid-editing` owns real UI fill-handle and Flash Fill preview workflows.
- `mog/compute/core/crates/value-types` owns date serial conversion and should be the preferred source for shared date/time primitives.
- `mog/compute/core/crates/formula-types` and `cell-types` own identity formula ref shapes and row/column/cell IDs used by formula adjustment.
