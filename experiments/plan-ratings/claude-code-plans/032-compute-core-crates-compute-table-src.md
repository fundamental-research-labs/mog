# Plan 032 — Close correctness gaps and harden the table compute engine (`compute-table/src`)

## Source folder and scope

- **Public source folder:** `mog/compute/core/crates/compute-table/src`
- **Crate:** `compute-table` (`version 0.1.0`, `publish = false`) — "Table engine — filters, sort, slicers, structured refs, styles."
- **Size:** ~17.5k LOC total across ~50 files (production + inline/sibling test modules).
- **In scope (production modules):**
  - **Filter subsystem** — `filter.rs` (per-column bitmap evaluation), `advanced_filter.rs` (DNF criteria), `filter_dropdown.rs`, `filter_resolve.rs` + `filter_resolve/` (dynamic / top-bottom / date-range resolution).
  - **Sort & comparison** — `sort.rs` (permutation), `compare.rs` (the shared, authoritative value-comparison / type-rank / identity utilities).
  - **Visibility** — `visibility.rs` (bitmap AND composition).
  - **Slicers** — `slicer.rs`, `slicer_cache.rs`, `timeline.rs`.
  - **Structured references** — `structured_refs.rs` + `structured_refs/` (parse-bridge, resolution, adjustment, formatting).
  - **Styles** — `styles.rs` + `styles/` (builtins, borders, resolver), `custom_styles.rs`.
  - **Table CRUD & queries** — `table/` (create, columns, ranges, totals, names, lookup, options), `operations.rs`, `queries.rs`, `auto_expansion.rs`, `calculated_columns.rs`, `selection.rs`, `range_resolution.rs`, `events.rs`.
  - **Foundation** — `types.rs` (wire-format type definitions), `error.rs`, `lib.rs`.
  - **`EDGE_VALUE_SEMANTICS.md`** — the in-folder authoritative spec for edge-value (NaN / Inf / error / blank / array / lambda) behavior across sort, filter, top-bottom, average, equality, and slicer.
- **Out of scope (consumers / depended-upon, named where the contract crosses):**
  - `value-types` (`CellValue`/`CellError`/`Color`), `cell-types`, `formula-types`, `domain-types` (`CellFormat`) — upstream type crates.
  - `compute-parser` — provides `parse_structured_ref` and friends (a `dev-dependency` here, used via `super` in tests).
  - The storage/bridge callers in `compute/core/src`: `bridge_pure.rs` (`table_evaluate_column_filter`), `storage/sheet/filters/{bridge,evaluation}.rs`, `storage/engine/services/{tables,advanced_filter}.rs`, and the WASM/NAPI/PyO3 FFI shells (`compute/wasm`, `compute/napi`, `compute/pyo3`). These are the production entry points; the contract changes below ripple to them.

## Current role of this folder in Mog

This crate is **the pure, stateless computation kernel for Mog's structured tables and AutoFilter**. Per `lib.rs` it is "Pure, stateless computation. No DOM, no Yjs, no React." Every table create/resize/rename, every AutoFilter evaluation, every sort, every slicer cache build, and every structured-reference resolution that the document engine performs ultimately funnels through functions here. The storage layer (`compute/core/src/storage/sheet/filters/evaluation.rs`) materializes column data + per-row `CellFormat` and delegates row-visibility to `filter::evaluate_column_filter`; results compose via `visibility::compose_bitmaps` (8-byte-at-a-time `u64` AND).

Two structural facts shape the work:

1. **It is a hand-port of the prior TypeScript engine.** Thirteen modules carry `//! Ported from table-engine/src/*.ts` or `spreadsheet-model/src/*.ts` headers, and several carry inline `BUG FIX:` notes where the Rust port intentionally diverged from the TS source (e.g. `filter.rs:448` NotBetween-on-blank, `filter_resolve.rs:54` aboveAverage using `>=`). The TS↔Rust parity is enforced only by per-module Rust unit tests, not by a shared golden corpus.
2. **`EDGE_VALUE_SEMANTICS.md` is the single source of truth** for cross-type ordering and edge-value handling, and explicitly lists the seven modules that "MUST conform." `compare.rs` is the centralization point (`type_rank`, `error_sort_rank`, `compare_values`, `cell_value_key`, `cell_values_equal`, `build_value_key_set`). The doc also flags the critical, easily-violated invariant that **table sort order differs from pivot sort order** (`number < text < bool < error < blank` for tables; `null < error < bool < number < text` for pivots).

## Improvement objectives

Ranked. All on the production path. No reduced scope, shims, or test-only fixes.

1. **O1 — Make Icon filters actually filter (close a silent product gap).** `filter.rs:123` returns an all-visible bitmap for `FilterCriteria::Icon(_)`, with the comment "Icon filters are evaluated by the bridge layer." The bridge (`storage/sheet/filters/bridge.rs:182`) merely *forwards* the icon payload back into the `Icon` criteria and never re-matches it. Net effect: **filtering a table column by an icon-set icon silently shows every row.** Implement real icon-set membership evaluation on the production path.
2. **O2 — Thread the workbook week-start setting into date-based dynamic filters.** `storage/sheet/filters/evaluation.rs:113` calls `evaluate_column_filter(..., None /* week_start_day */)`, and `filter_resolve.rs:73` then defaults to `Weekday::Sun`. "This Week" / "Last Week" / "Next Week" dynamic filters therefore compute the wrong window for any workbook whose week starts on Monday. Plumb the real setting through.
3. **O3 — Remove the production panic in dynamic-filter resolution.** `filter_resolve.rs:73` does `now.expect("Date-based dynamic filter requires a now date parameter")`. A date-rule dynamic filter evaluated with `now = None` **panics the engine** (and, across the WASM/NAPI boundary, aborts). Pure compute must never panic on caller-supplied data shape; return a typed error or a deterministic match-nothing/`Result`.
4. **O4 — Implement Advanced Filter formula criteria.** `advanced_filter.rs:195`/`:321` deliberately returns `AdvancedFilterError::UnsupportedFormulaCriteria` for any criteria cell marked `is_formula`. Formula criteria (`=A2>AVERAGE($A$2:$A$10)` etc.) are a first-class Excel Advanced Filter feature; today they are a hard error. Wire formula-backed criteria through the evaluator (the storage layer can already see the formula store).
5. **O5 — Establish a single cross-edge-value conformance gate tied to `EDGE_VALUE_SEMANTICS.md`.** The doc names seven modules that must conform but parity is enforced piecemeal. Add one parameterized conformance suite that drives every relevant module (sort, filter positive/negative, top-bottom, average, equality, slicer dedup) from the doc's Quick Reference table, so a divergence in any one module fails loudly and the doc cannot drift from the code.
6. **O6 — Eliminate per-row allocation in the hot filter loop.** In `filter.rs` string operators do `value.to_string().to_lowercase()` **per row**, and only the *condition* side is precomputed and only for single-condition filters (`filter.rs:148`). The `ValueFilter` fast path allocates a `HashSet<String>` of canonical keys (`compare.rs:189` `cell_value_key` returns owned `String` per included value, and `value_in_key_set` allocates again per row). Remove avoidable per-row heap traffic on the dominant evaluation path.
7. **O7 — Strengthen color-filter parity and kill the silent all-pass fallback.** `filter.rs:104` returns an all-visible bitmap when a `Color` criterion is evaluated with `column_formats: None` ("back-compat for callers that don't have format access"). That is a silent correctness footgun — a color filter that matches everything. Additionally, `matches_color_filter` (`filter.rs:498`) compares only resolved RGBA hex and does not handle theme/indexed/tinted fills. Make missing-format a typed error (or a documented contract the bridge must satisfy) and broaden color resolution to Excel-parity.

## Production-path contracts and invariants to preserve or strengthen

These are the acceptance bar; they must hold after every change.

- **Purity & statelessness:** every public function stays pure and returns new structs (`lib.rs`, `table/mod.rs` headers). No I/O, no globals, no DOM/Yjs/React. O1–O7 must not introduce mutable shared state.
- **No panics on data shape:** pure compute may only panic on genuine internal invariant violations. O3 converts the `now.expect` into a typed result; new code must not add `unwrap`/`expect`/`unreachable!` reachable from caller-supplied values. (The existing `unreachable!` arms in `filter.rs:180/209/218` and `advanced_filter.rs:492` must remain genuinely unreachable — verify, don't extend.)
- **Edge-value spec is authoritative:** `EDGE_VALUE_SEMANTICS.md` wins over code on any conflict. The type-rank (`number 0 < text 1 < bool 2 < error 3 < blank 4`), the fixed error sub-order (`#NULL! … #CALC!`), NaN-sorts-last, `NaN == NaN` for dedup, blank semantics (`"" is NOT blank`), and the `Circ` error mapping to `Ref` rank (`compare.rs:43`) must all be preserved. O5 turns this into an enforced gate.
- **Table-vs-pivot sort divergence:** `compare.rs` ordering is the *table* order and must never be reused for pivots. Any centralization in O6 must keep this boundary explicit.
- **Filter negative/positive operator semantics:** positive ops return `false` for blank/NaN/error/type-mismatch; negative ops (`NotEquals`, `NotContains`, `NotBetween`, `IsNotBlank`) return `true`. The `NotBetween`-on-blank fix (`filter.rs:448`) and string-operator fall-through for NaN must be preserved exactly.
- **Bitmap contract:** `Vec<u8>`, one byte per data row, `1 = visible`/`0 = hidden`, composed via AND over the **minimum length** (`visibility.rs`). O6 must keep the byte layout (it is the FFI/bridge contract consumed by `storage/.../evaluation.rs`) unless the representation change is propagated end-to-end and benchmarked.
- **Wire-format stability:** `types.rs` defines the serde wire shapes shared with the bridge and the TS contract generator (`infra/rust-bridge/bridge-ts/tests/generate_compute_types.rs`). Any field addition (O1 icon context, O2 week-start, O4 formula criteria) must be additive and `#[serde(default)]`-compatible to avoid breaking deserialization of stored documents.
- **Determinism:** identical inputs → identical bitmaps/permutations across native (NAPI/PyO3) and WASM. O2/O4 must keep evaluation a pure function of (data, criteria, explicitly-passed clock/settings) — no implicit `now`/locale reads.
- **Structured-ref resolution shape:** `ResolvedStructuredRef`/`ResolvedRange` carry positional data only (no values); resolution stays parse-driven via `compute-parser`. Preserve this separation.

## Concrete implementation plan

### Phase 0 — Evidence & decision gate
- Confirm with compute owners the intended home for **icon-set matching** (O1): the spec gap is whether icon membership is computed here (engine receives resolved per-row icon indices, mirroring how `Color` receives per-row `CellFormat`) or stays in a CF-rule-aware bridge. The cleanest production path mirrors `Color`: have the bridge resolve each row's icon index from the CF rule and pass a `column_icons: Option<&[Option<IconRef>]>` slice, keeping `compute-table` pure. Record the decision here before O1 implementation.
- Confirm the canonical source for the **week-start setting** (O2) in the document model so the bridge can read it.
- Confirm the **formula-criteria evaluation entry point** (O4): the storage layer can resolve a criteria formula against a candidate row via the existing evaluator; decide the trait/callback shape passed into `advanced_filter`.

### Phase 1 — O3: remove the dynamic-filter panic (smallest, unblocks confidence)
1. Change `resolve_dynamic_filter` (`filter_resolve.rs:56`) to return `Result<FilterCriteria, FilterResolveError>` (or accept the existing match-nothing fallback path it already uses at `:77` for invalid dates) instead of `expect`-ing `now`.
2. Propagate through `filter::evaluate_column_filter`'s `Dynamic` branch (`filter.rs:131`): on missing `now` for a date rule, return the deterministic empty/match-nothing bitmap that the invalid-date path already produces, never a panic.
3. Update `error.rs` with the new typed variant; update bridge callers to map it.

### Phase 2 — O2: thread week-start through
1. Add a `week_start_day` parameter (or a small `FilterEvalSettings` struct carrying `now` + `week_start_day`) end-to-end: bridge → `evaluate_column_filter` → `resolve_dynamic_filter`. The signatures already carry `week_start_day: Option<chrono::Weekday>`; the gap is purely that the bridge passes `None`.
2. In `storage/sheet/filters/evaluation.rs`, read the workbook's week-start setting and pass it instead of `None`.
3. Keep `Sunday` as the documented default only when the setting is genuinely absent.

### Phase 3 — O1: real icon-set filtering
1. Following the Phase-0 decision, extend `evaluate_column_filter` to accept resolved per-row icon context (preferred: `column_icons: Option<&[Option<IconRef>]>`, symmetric with `column_formats`).
2. Implement `matches_icon_filter(row_icon, &IconFilter)` matching `icon_set_name` + `icon_index` membership; remove the all-visible no-op at `filter.rs:123` and the `Icon(_) => true` fallthrough at `filter.rs:216`.
3. Have the bridge (`storage/sheet/filters/{bridge,evaluation}.rs`) resolve each data row's icon from the column's icon-set CF rule and pass the slice. Materialize icon context only when the criterion is `Icon` (mirror the `Color`-only `column_formats` materialization at `evaluation.rs:97`).

### Phase 4 — O4: Advanced Filter formula criteria
1. Add a criteria-evaluation callback/trait to the `advanced_filter` evaluator so a formula-backed `AdvancedFilterCriteriaCell` (`is_formula = true`) is evaluated against each candidate row (the formula is evaluated by the caller's evaluator with the row's active cell substituted, per Excel semantics).
2. Replace the `UnsupportedFormulaCriteria` early-return (`advanced_filter.rs:321`) with the evaluated boolean; keep the typed error only for the case where the caller supplies no evaluator (degraded environments), so the contract stays explicit.
3. Wire `storage/engine/services/advanced_filter.rs` to provide the evaluator hook. Keep the DNF composition (rows ORed, cells ANDed, repeated headers compose) unchanged.

### Phase 5 — O6: de-allocate the hot filter loop
1. Precompute the lowercased condition string for **all** condition arms (extend the single-condition precompute at `filter.rs:148` to multi-condition `And`/`Or`), and for the value side use a borrowed/`Cow` lowercasing that avoids allocation when the value is already lowercase ASCII.
2. Replace the `HashSet<String>` value-key set (`compare.rs:219`) with a hashing scheme keyed on a borrowed/interned canonical identity (e.g. hash `CellValue` directly via a custom `Hash`/key enum) so neither `build_value_key_set` nor the per-row `value_in_key_set` allocates a `String` per element. Preserve the exact dedup semantics (`NaN == NaN`, blank/array/lambda → `__BLANK__`, error-by-variant).
3. Benchmark before/after on a wide filtered column (coordinate the harness; do not author benchmarks in this folder). Land as a behavior-identical refactor verified by O5.

### Phase 6 — O7: color-filter parity + remove silent all-pass
1. Make `Color` evaluation with `column_formats: None` a typed error (`FilterEvalError::MissingFormats`) rather than an all-visible bitmap (`filter.rs:104`), or formally document the contract and assert it at the bridge. Silent match-all is the worse failure mode.
2. Broaden `matches_color_filter` (`filter.rs:498`) so resolved theme/indexed/tinted fills compare correctly against the requested `Color`, not just literal RGBA hex. Resolution of theme→RGBA happens upstream; ensure the bridge hands `matches_color_filter` fully-resolved colors and document that contract.

### Phase 7 — O5: edge-value conformance gate (lands last, guards everything above)
1. Encode the `EDGE_VALUE_SEMANTICS.md` Quick Reference table as a data-driven fixture (value × axis → expected behavior) in a dedicated conformance test module.
2. Drive `sort` ordering, `filter` positive/negative operators, top-bottom inclusion, average inclusion, `cell_values_equal`, and slicer dedup keys from that single fixture, asserting each module conforms.
3. Add a doc-sync assertion: the fixture is the executable form of the doc; any code change that alters an edge behavior must update both, by construction.

## Tests and verification gates

> Per task constraints this plan does **not** run build/test/typecheck commands. The gates below are the implementer's acceptance bar.

- **Existing suites stay green:** the in-folder test modules (`filter/tests/*`, `filter_resolve/tests/*`, `compare_tests.rs`, `sort_tests.rs`, `slicer_tests.rs`, `slicer_cache_tests.rs`, `structured_refs/tests/*`, `styles_tests/*`, `table/*_tests.rs`, `types_tests.rs`, `visibility_tests.rs`, `advanced_filter_tests.rs`, `filter_dropdown_tests.rs`). These encode the current contracts and are the primary regression net.
- **O1 (icon):** fixtures with a 3-/5-icon-set column, filter by each icon index → exactly the rows whose resolved icon matches are visible; filtering by an icon not present → empty result (not all-visible). End-to-end app-eval scenario: import an XLSX with an icon-set AutoFilter and assert hidden rows.
- **O2 (week-start):** "This Week"/"Last Week"/"Next Week" dynamic filter over a fixed `now` with `week_start_day = Mon` vs `Sun` yields different, correct windows; default-absent path stays Sunday.
- **O3 (no panic):** date-rule dynamic filter with `now = None` returns the match-nothing bitmap / typed error and **does not panic** (assert via `Result`, and a WASM-boundary smoke that it does not abort).
- **O4 (formula criteria):** Advanced Filter with a formula criterion (`=A2>AVERAGE(...)`) returns the Excel-correct row set; the no-evaluator path still returns the typed unsupported error.
- **O5 (conformance):** the single data-driven suite passes for every module named in `EDGE_VALUE_SEMANTICS.md`; deliberately mutate one module's edge behavior in a scratch check and confirm the gate fails (meta-test of the gate).
- **O6 (alloc):** differential test — old vs new dispatch produce byte-identical bitmaps over a randomized corpus (values × operators × value-filters), including NaN/Inf/error/blank/mixed-type columns; benchmark shows no allocation per row on the string/value paths and a net throughput win.
- **O7 (color):** color filter with missing formats returns the typed error (not all-visible); theme/indexed/tinted fill matches its requested color; case-insensitive hex parity (`#FFFF00` == `#ffff00`) preserved.
- **Cross-cutting integration gates:** run the table/filter **app-eval** and **api-eval** scenarios (AutoFilter import/clear, dynamic-filter navigation, color/icon dropdowns) as the product-level gate; run the **XLSX round-trip** corpus to confirm filter/sort/slicer/structured-ref serialization is unaffected; confirm the TS contract generator (`generate_compute_types.rs`) still produces the same types after any `types.rs` additions.

## Risks, edge cases, and non-goals

- **Risk — signature churn ripples to FFI (O1/O2/O4):** adding parameters to `evaluate_column_filter` touches `bridge_pure.rs`, the storage delegators, and the WASM/NAPI/PyO3 shells. Mitigation: introduce a single `FilterEvalContext`/settings struct so future additions don't re-break every call site; keep wire additions `#[serde(default)]`.
- **Risk — icon resolution belongs to CF context (O1):** if icon indices are not cleanly resolvable at the bridge, O1 stalls. Mitigation: Phase-0 decision gate; fall back to passing resolved per-row icon refs (engine stays pure either way) rather than embedding CF-rule evaluation in `compute-table`.
- **Risk — formula-criteria evaluation cost/cycles (O4):** evaluating a formula per candidate row can be expensive and could re-enter the evaluator. Mitigation: bound by the caller's existing recalc deadline; the engine here only receives a boolean-returning callback.
- **Risk — alloc refactor changes a subtle edge (O6):** canonical-key and lowercasing changes are exactly where NaN/blank/error identity hides. Mitigation: O5 conformance gate + differential corpus test are mandatory before merge.
- **Edge cases to honor:** `"" is NOT blank` (text rank 1); `NaN == NaN` true for dedup but NaN fails all positive numeric operators; `Circ` error sorts at `Ref` rank; arrays/lambdas treated as blank for sort/filter but keyed `__BLANK__` for slicer; type-mismatch → false (positive) / true (negative); top-bottom and average exclude all non-finite numbers.
- **Non-goals:** locale-aware (ICU) collation for text sort — `compare.rs` intentionally uses Unicode-codepoint ordering for allocation-free, dependency-free comparison (documented trade-off); changing pivot sort order (lives elsewhere, intentionally different); altering the `compute-parser` structured-ref grammar; re-porting modules from TS wholesale; any reduced-scope or test-only fix that does not move the production path.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable after Phase 0:** O3 (panic fix), O5 (conformance gate), and O6 (alloc) are largely self-contained within this folder and touch disjoint files (`filter_resolve.rs`/`error.rs`; new test module + `compare.rs`; `filter.rs`/`compare.rs`). O5 is best landed early as the safety net for O6.
- **Sequenced / bridge-coupled:** O1 (icon), O2 (week-start), O4 (formula criteria), and O7 (color) all change the engine↔bridge contract and must be co-landed with their callers in `compute/core/src/storage/sheet/filters/{bridge,evaluation}.rs` and the FFI shells.
- **Cross-folder dependencies:**
  - `compute/core/src/storage/sheet/filters/` — owns `evaluate_column_filter` materialization and the icon/color/dynamic bridging; the prime co-edit site for O1/O2/O4/O7.
  - `compute/core/src/storage/engine/services/advanced_filter.rs` — supplies the formula-criteria evaluator hook (O4).
  - `value-types` / `domain-types` — if O7 needs richer color resolution, theme→RGBA resolution must already be available upstream (verify before O7).
  - `compute/{wasm,napi,pyo3}` + `bridge_pure.rs` + `infra/rust-bridge` contract generator — any signature/`types.rs` change must update the FFI shells and regenerate TS contracts.
  - Document/settings model — source of the week-start setting (O2). Coordinate with its owner.
