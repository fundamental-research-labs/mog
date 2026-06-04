# Plan 033 — Close aggregation/layout-semantics gaps and harden the pivot engine (`compute-pivot/src`)

## Source folder and scope

- **Public source folder:** `mog/compute/core/crates/compute-pivot/src`
- **Crate:** `compute-pivot` (`version 0.1.0`, `publish = false`) — "Pivot table engine for the compute engine — pure-function pivot computation."
- **Size:** ~30k LOC across ~110 files (production + inline/sibling test modules). Production modules are a minority of the line count; the bulk is the (extensive) test corpus under `engine/*_tests`, `show_values_as/tests`, `hierarchy/tests`, and `types_tests`.
- **In scope (production modules):**
  - **Entry / orchestration** — `lib.rs`, `engine/mod.rs`, `engine/compute.rs` (the four `compute*` entry points), `engine/drill_down.rs`, `engine/pivot_items.rs`, `engine/type_detection.rs`, `engine/row_computation.rs`.
  - **Validation & resolution** — `engine/validation.rs` (the sole `validate_and_resolve` constructor), `resolved.rs` (the trusted `ResolvedPivotConfig` / `Resolved*` types).
  - **Presenter bridge to relational** — `presenter.rs` + `presenter/` (`query_mapping.rs`, `result_projection.rs`, `column_headers.rs`, `row_flattening.rs`, `value_remap.rs`, `grand_totals.rs`, `visibility.rs`).
  - **Layout-affecting semantics** — `grouper.rs` (date/number bucketing + key normalization), `filter.rs` (include/exclude, conditions, top/bottom-N, blank removal).
  - **Show Values As** — `show_values_as/mod.rs` + `show_values_as/transforms/` (`mod.rs`, `index.rs`, `rank.rs`, `running.rs`, `difference.rs`, `percentage.rs`).
  - **Hierarchy index** — `hierarchy.rs` + `hierarchy/` (`flat_builder.rs`, `tree_builder.rs`, `model.rs`, `query.rs`).
  - **Calculated fields** — `calc_field/` (`mod.rs`, `lexer.rs`, `parser.rs`, `evaluator.rs`, `ast.rs`, `error.rs`).
  - **Type re-exports / snapshot bridge** — `types/mod.rs`, `types/pivot_table_def_ext.rs`.
  - **`benches/pivot_benchmarks.rs`** — the only existing performance harness for this crate.
- **Out of scope (depended-upon / consumers, named where the contract crosses):**
  - **`compute-relational`** — performs the actual GROUP BY, aggregation, window functions, and top-bottom; `engine/compute.rs:47,88` call `compute_relational::execute`, and `presenter` consumes its `QueryResult`/`AggregatedNode`/`QueryGrandTotals`. **Most aggregation arithmetic lives there, not here.** Several objectives below identify whether a fix belongs in this crate or must be pushed into `compute-relational`.
  - **`compute-stats`** — re-exported as `aggregator`/`sorter`/`values` (`lib.rs:25-28`); supplies `aggregate`, `matches_condition`, `cell_value_eq`, `cell_value_to_key`, `cell_value_filter_keys`, `kahan_sum`.
  - **`pivot-types`** (wire-format `PivotEngineConfig` and all enums), **`snapshot-types`** (`PivotTableDef` for GETPIVOTDATA), **`value-types`**, **`cell-types`**.
  - **Consumers:** `kernel/src/domain/pivots` (plan 017), `compute/core/src` eval/scheduler (plans 024/025), and the WASM/NAPI/PyO3 FFI shells. Contract changes below ripple to them.

## Current role of this folder in Mog

This crate is **the pure, stateless pivot-table kernel**: `(config, data, expansion_state) -> result` with "No `CellMirror`, no document state — stateless computation only" (`lib.rs:1-4`). Every pivot the document engine renders — refresh, expand/collapse, drill-down, field-list edit, GETPIVOTDATA — funnels through the four entry points re-exported at `lib.rs:43-47`.

Architecturally the crate is a **thin semantic layer over `compute-relational`**. The pipeline is:

```
compute(config, data, expansion)                         engine/compute.rs:19
  └─ validate_and_resolve(config) -> ResolvedPivotConfig  engine/validation.rs:37
  └─ compute_resolved:
       pivot_config_to_query(&resolved)                   presenter/query_mapping.rs:24
       compute_relational::execute(&query, data)          engine/compute.rs:47
       query_result_to_pivot(result, &resolved, expansion) presenter/result_projection.rs:21
  └─ (Show Values As variant) apply_show_values_as_to_result  show_values_as/mod.rs:104
```

So this crate owns three things the relational engine does **not**: (1) **validation/resolution** — turning the loosely-typed wire `PivotTableConfig` into a trusted `ResolvedPivotConfig` with all field references resolved, defaults filled, and flat serde enums made type-safe (`resolved.rs`, `engine/validation.rs`); (2) **layout/presentation** — flattening the relational `AggregatedNode` tree into Excel-shaped rows/headers/subtotals/grand-totals honoring compact-vs-outline-vs-tabular form and expansion state (`presenter/`); and (3) **Show Values As** post-aggregation transforms (running totals, % of parent, rank, difference, index), which require the hierarchy-aware `GroupHierarchy` index (`hierarchy/`, `show_values_as/`).

Two structural facts shape the work:

1. **The "resolved" boundary is the crate's core safety invariant.** `ResolvedPivotConfig` "can only be constructed through `validate_and_resolve()`" and the engine "accepts only these types — zero `unwrap_or` fallbacks needed" (`resolved.rs:1-7`). Any new field/feature must flow through `validate_and_resolve` so the trusted-config guarantee holds. Today there are **gaps where the resolver discards or contradicts wire config** (see O1, O2).
2. **Excel-parity semantics are asserted only by per-module Rust tests**, not a shared golden corpus, and several parity-critical behaviors (date-grouping bucketing, top-bottom tie-breaking, blank semantics, subtotal grand-total alignment) are implemented across the relational boundary, so a divergence can hide between the two crates.

## Improvement objectives

Ranked. All on the production path. No reduced scope, shims, or test-only fixes.

1. **O1 — Make "Show empty rows / empty columns" actually work (close a silent layout gap).** `engine/validation.rs:399-400` hardcodes `show_empty_rows: false` and `show_empty_columns: false` into every `ResolvedLayout`, **ignoring whatever the wire config requests**. The `ResolvedLayout` accessors and the presenter are wired to consume these flags (`resolved.rs:560-569`), and the layout type documents them as real settings, but the resolver never plumbs the wire value through — so the feature is inert for every pivot. Investigate the `PivotTableLayout` wire shape, plumb the real settings, and make the presenter emit no-data rows/columns when requested (this likely requires `compute-relational` to surface the full axis domain, not just observed groups — scope the cross-crate part explicitly).

2. **O2 — Resolve the `show_items_with_no_data` default contradiction.** `resolved.rs:410-411` documents the field as "resolved, defaulted to **false**," but `engine/validation.rs:379` resolves it with `.unwrap_or(true)`. Code and contract disagree, and the default flips a user-visible behavior (whether filtered-out filter items still occupy rows). Pick the Excel-correct default, make the doc and the code agree, and add a resolution test that pins it.

3. **O3 — Fix standalone Day date-grouping collapsing distinct dates.** `grouper.rs:110` returns *only the day-of-month number* for `DateGrouping::Day`, so a pivot grouped solely by Day merges `Jan 15` and `Feb 15` into one "15" group. This is correct only when Day is nested under Year▸Month; used alone it is a silent data-correctness bug. Verify the intended Excel semantics for an isolated Day grouping, then either (a) make standalone Day group by full date, or (b) have the resolver/presenter guarantee Day is never emitted without its month/year ancestors. The same audit applies to Week (`grouper.rs:107-109`), which is year-agnostic in the same way.

4. **O4 — Stop silently emitting empty subtotal column-grand-totals.** `presenter/grand_totals.rs:67-79` maps each pivot row to its right-side (column) grand-total by `pr.key`; for subtotal rows it strips `SUBTOTAL_SUFFIX` and looks the stripped key up in `col_map`, and on a miss falls back to an **empty `Vec<CellValue>`** (`:76` `.cloned().unwrap_or_default()`). A subtotal whose grand-total entry is absent therefore renders a blank grand-total cell instead of the subtotal's own row total, and the subsequent calculated-field pass (`:81-95`) iterates a possibly-sparse `col_gt`. Investigate when the lookup misses, and recompute (or correctly thread) the subtotal grand-total rather than padding with empties.

5. **O5 — Make pivot-item filter keys stable and value-derived.** `engine/pivot_items.rs` (filter-item extraction, ~`:183-210`) synthesizes item keys as `"{field_id}:{i}"` using the source-row enumeration index rather than the value's normalized group key. UI filter/slicer pickers built on these items break or mis-map when the source range is reordered or rows are inserted, and two rows with the same value get distinct keys. Derive item keys from `normalize_to_group_key` (already the engine's canonical identity) so item identity matches the keys the rest of the engine uses.

6. **O6 — Remove the redundant per-leaf header rebuild in column projection.** `presenter/column_headers.rs:83-84` calls `measure_headers(value_placements, calculated_fields)` **inside** the `for leaf in &leaves` loop, rebuilding the identical measure-header `Vec` once per visible column leaf — `O(leaves × measures)` allocations where `O(measures)` suffices. Hoist the computation above the loop. This is the dominant per-call allocation in wide multi-measure pivots and is the cleanest hot-path win.

7. **O7 — Cut the Show-Values-As clone/allocation overhead on the transform path.** `show_values_as/mod.rs:120-121` clones the full `result.rows` and `result.grand_totals`, then `:130` builds the context from `raw_rows` again, giving ~3× row memory for any transform-bearing pivot. Within the transforms, `difference.rs:29-38` materializes a `Vec<(usize, Vec<Option<f64>>)>` of *all* group values *per subtotal depth level*, and `running.rs`/`percentage.rs` re-implement Kahan compensation inline (`running.rs:28-31,102-105`; `percentage.rs:129-136,190-196`) despite `kahan_sum` being exported (`lib.rs:120`). Reduce to a single snapshot, stream the difference base instead of pre-materializing, and route all compensated sums through the shared `kahan_sum`.

8. **O8 — Establish a pivot↔relational golden conformance corpus and a benchmark gate.** Today the two halves of "compute a pivot" (relational aggregation here vs. in `compute-relational`) are tested independently, so an aggregation/sort/top-bottom divergence can sit undetected between them. Add an end-to-end corpus driving `compute`/`compute_with_show_values_as` over fixtures that exercise multi-level rows+columns, every aggregate, every Show-Values-As variant, date/number grouping, top-bottom-N tie cases, and expansion state — asserting full `PivotTableResult` shape. Tie the O6/O7 perf claims to `benches/pivot_benchmarks.rs` so regressions fail loudly.

## Production-path contracts and invariants to preserve or strengthen

These are the acceptance bar; they must hold after every change.

- **Purity & statelessness.** Every public entry stays a pure function of `(config, data, expansion_state)` (`lib.rs:1-4`). No I/O, globals, clocks, or locale reads. O1/O3 must keep grouping a deterministic function of the explicit inputs.
- **The resolved-config boundary.** `ResolvedPivotConfig` is constructible **only** via `validate_and_resolve` (`resolved.rs:1-7`, `engine/validation.rs:37`). Every new setting (O1 empty-row/col, O2 default) must be resolved there so the "engine trusts every field, zero `unwrap_or`" guarantee survives. The engine must not regrow `unwrap_or` fallbacks downstream of resolution.
- **No panics on caller data shape.** Pure compute may panic only on genuine internal-invariant violations. The two guarded `.unwrap()`s in `validate_and_resolve` (`:97,:484`, each immediately preceded by an `errors.len() == 1` check) and the `unreachable!` arms (`grouper.rs:103` month 1–12; `engine/validation.rs:465` value-area excluded; condition-flat `_ => unreachable!()` arms) must remain genuinely unreachable — verify, do not extend. New code must add no `unwrap`/`expect`/`panic!`/`todo!` reachable from config or source data.
- **Validation completeness.** All current checks stay: inverted `source_range` (`:65-85`), duplicate field IDs (`:108`), unknown field references on every placement/filter/sort-by-value/top-bottom (`:149,:256,:299,:328`), `top_bottom.n` finite/non-negative/integer-for-Items (`:342-360`), Show-Values-As `base_field` requirement for Difference/RunningTotal/Rank variants (`:160-181`), calculated-field empty-id/name/formula and parse errors (`:411-449`), and duplicate non-value placements (`:452-476`). Multiple errors aggregate into `PivotError::Multiple`.
- **Numeric-stability contract.** Aggregated sums use Kahan compensation; O7's consolidation onto `kahan_sum` must be numerically identical (the existing inline compensation and `kahan_sum` must agree bit-for-bit on the test corpus). NaN/Infinity are filtered before entering calc-field evaluation (`engine/row_computation.rs:41`) and division-by-zero in calc fields returns `None`→`Null` (`calc_field/evaluator.rs:60-64`); these stay.
- **Group-key identity is single-sourced.** `normalize_to_key`/`normalize_to_group_key` (`grouper.rs:279-291`) delegate to `compute-stats`; drill-down re-applies the *same* date/number grouping before matching (`engine/drill_down.rs:91-120`). O5 must adopt this identity, and O3 must keep drill-down's re-grouping in lock-step with the grouping change (drill-down correctness depends on producing the same buckets the group pass produced).
- **Show-Values-As phase ordering.** The 3-phase transform contract (leaves → subtotal peers deepest-first → grand total) in `show_values_as/transforms/mod.rs` is load-bearing for running totals and parent-relative percentages; O7 may not reorder phases or change group-boundary reset semantics.
- **Top/Bottom-N semantics.** Ranking uses the placement's *actual* aggregate function via the pre-resolved `(value_field_index, agg)` tuple (`filter.rs` "FIX 1a", ~`:267`), and tie-breaking includes **all** groups equal to the cutoff via `cell_value_eq` (~`:349-361`). Preserve both exactly.
- **Wire / snapshot stability.** `types/mod.rs` re-exports `pivot-types`; `PivotTableDefExt::to_pivot_table_def` (`types/pivot_table_def_ext.rs`) feeds GETPIVOTDATA via `snapshot-types`. Any field added for O1/O2 must be additive and `#[serde(default)]`-compatible so stored documents keep deserializing.
- **Determinism across runtimes.** Identical inputs → identical `PivotTableResult` across NAPI/PyO3/WASM. Iteration order that feeds output (group order, item order) must stay insertion-deterministic, not hash-iteration-dependent.

## Concrete implementation plan

### Phase 0 — Evidence & decision gate (no behavior change)

- **0a.** Read `compute-relational`'s axis-domain handling to determine whether O1 (show-empty-rows/cols) is fully implementable here or needs the relational engine to emit the complete cross-product of axis members. Record the boundary; if it requires a `compute-relational` change, this plan **depends on** that crate's plan and O1 splits into a cross-crate sub-task.
- **0b.** Confirm the `PivotTableLayout` wire type in `pivot-types` carries `show_empty_rows`/`show_empty_columns` (or equivalent). If absent, O1's first step is the additive wire field (coordinate with plans 008/017). If present, the gap is purely the dropped resolution at `validation.rs:399-400`.
- **0c.** Pin the Excel-true semantics for: standalone Day and Week grouping (O3), the `show_items_with_no_data` default (O2), and subtotal column-grand-total content (O4). Capture as assertions in the O8 corpus *before* changing code (characterization-first).
- **0d.** Reproduce O4's empty-subtotal-grand-total by constructing a multi-level pivot with subtotals + column grand totals and inspecting `grand_totals.col` alignment; confirm whether the miss is a `col_map` keying bug or a genuinely missing relational entry.

### Phase 1 — Resolution-layer correctness (O1, O2)

- **O2 (smallest, do first).** Decide the default; update `engine/validation.rs:379` and the doc comment at `resolved.rs:410-411` to match; add a `validation_tests` case asserting the resolved value for both explicit-true, explicit-false, and omitted.
- **O1.** Thread `show_empty_rows`/`show_empty_columns` from `layout_ref` through `ResolvedLayout` (replace the literal `false`s at `validation.rs:399-400`). Then, in the presenter, emit rows/columns for axis members with no underlying data when the flag is set — sourcing the full member domain per 0a (either from a relational axis-domain result or by retaining filtered-out members). Keep the default behavior (flag off) byte-identical.

### Phase 2 — Grouping & item-identity correctness (O3, O5)

- **O3.** Per 0c, implement the chosen fix for standalone Day/Week. If "group by full date when unnested," the resolver must know whether Day has Year/Month ancestors on the same axis — add that determination in `validate_and_resolve` and pass an effective grouping mode to `query_mapping`/`grouper`. Update `engine/drill_down.rs:91-120` to re-group identically. Extend the grouping tests.
- **O5.** Replace the `"{field_id}:{i}"` synthetic keys in `engine/pivot_items.rs` filter-item extraction with `normalize_to_group_key`-derived keys; dedup on the normalized key (preserving first-occurrence order). Verify row/column item extraction (`extract_row_items`/`extract_column_items`) already use header keys consistent with this identity.

### Phase 3 — Grand-total alignment (O4)

- Based on 0d: if the miss is a keying bug, fix the `col_map` build/lookup in `presenter/grand_totals.rs:67-79` so subtotal rows resolve to their correct grand-total entry; if the entry is genuinely absent from the relational result, recompute the subtotal's grand-total from its constituent leaf grand-totals rather than `unwrap_or_default()`. Ensure the calculated-field pass (`:81-95`) sees a dense, correctly-aligned `col_gt`.

### Phase 4 — Hot-path performance (O6, O7) — behavior-preserving

- **O6.** Hoist `measure_headers(...)` above the `for leaf` loop in `presenter/column_headers.rs:79-95`; compute once, clone the small per-measure structs per leaf. Assert identical output on the corpus.
- **O7.** (a) In `show_values_as/mod.rs:104-145`, take a single snapshot of rows/grand-totals and build the context from it once instead of cloning twice. (b) In `difference.rs:20-130`, stream the base row/sibling lookup instead of pre-materializing all group values per depth. (c) Replace inline Kahan loops in `running.rs` and `percentage.rs` with `kahan_sum`/a shared compensated-accumulator helper; assert bit-identical results. (d) Extract the duplicated ancestor-chain reconstruction shared by `row_flattening.rs::build_ancestor_chain` and `::emit_subtotal_row` into one helper.

### Phase 5 — Conformance & benchmark gate (O8)

- Build the end-to-end fixture corpus (Phase 0c assertions plus broad coverage) under the crate's test tree, asserting full `PivotTableResult` (rows, headers, subtotals, grand totals, rendered bounds) and exercising the relational boundary. Add/extend `benches/pivot_benchmarks.rs` cases for wide multi-measure column projection (O6) and large transform-bearing pivots (O7), and record before/after numbers in the PR.

## Tests and verification gates

- **Unit/resolution:** extend `engine/validation_tests/*` for O1 (empty-row/col plumbed), O2 (default pinned). Extend grouping tests for O3 (standalone Day/Week no longer collapse across months/years; drill-down still matches). Extend `types_tests`/pivot-items tests for O5 (stable value-derived keys; reorder-invariance).
- **Presenter/grand-totals:** new `presenter` tests for O4 (subtotal rows carry correct column grand-totals; calculated fields align). New characterization tests for O1 empty members.
- **Show Values As:** the existing `show_values_as/tests/*` and `engine/value_sorting_tests/*` must pass unchanged after O7; add equivalence assertions that the consolidated Kahan path equals the prior inline path on adversarial floating inputs.
- **End-to-end corpus (O8):** full-result golden assertions across the matrix in Phase 5.
- **Property tests:** keep/extend `engine/engine_property_tests.rs` invariants (e.g., grand totals equal the sum of their constituents within epsilon; visible-row count consistent with expansion state).
- **Performance:** `cargo bench` on `pivot_benchmarks` shows no regression overall and a measurable improvement on the O6/O7 cases; numbers attached to the PR.
- **Workspace gates:** `cargo build`/`cargo clippy` clean under the crate's `#![warn(clippy::pedantic)]` + `#![deny(missing_docs)]` (`lib.rs:16-22`) — every new public item documented. `cargo test -p compute-pivot` green. Run the consuming `compute/core` and kernel-pivot (017) suites to confirm no downstream break, plus the FFI contract-generation check if O1/O2 touch wire types.
- **Sequencing:** characterization tests (Phase 0c) land first and stay green through Phase 4's behavior-preserving changes; only O1–O4 are *expected* to change golden output, and each such change is justified against the pinned Excel semantics.

## Risks, edge cases, and non-goals

- **Risk — O1 is cross-crate.** "Show empty rows/columns" may be unimplementable purely in this crate if `compute-relational` only emits observed groups; the realistic outcome is a relational axis-domain capability plus presenter wiring here. If 0a shows the relational change is large, ship O2/O3/O4/O5/O6/O7 first and track O1 as a dependent follow-up rather than forcing a shim.
- **Risk — O3 changes user-visible grouping.** Any pivot currently relying on the accidental day-of-month merge will shift. This is a correctness fix, but it must be gated on confirmed Excel semantics (0c) and called out in release notes; it must not silently alter results without the corpus justifying it.
- **Risk — O4 touches GETPIVOTDATA-adjacent output.** Grand-total cells feed both rendering and snapshot export; verify `to_pivot_table_def` bounds (`types/pivot_table_def_ext.rs`) still align after the fix.
- **Risk — O7 numeric drift.** Re-routing compensation must be bit-identical, not merely close; assert equivalence on inputs designed to expose naive-vs-Kahan differences before deleting the inline code.
- **Edge cases to hold:** header-only / empty data ranges (`engine/compute.rs:41-44,80-83`); time-only date serials (`grouper.rs:115-117` returns value unchanged); NaN/Inf in number grouping and calc fields; calculated-field introspection placements that reference a calc field rather than a source field (the deliberate silent-skip at `validation.rs:144-147`); collapsed-column value remapping padding with nulls (`presenter/value_remap.rs`); type-tolerant include/exclude matching (Text "2024" matching Number 2024).
- **Non-goals:** (1) Expanding the calculated-field language — `calc_field` deliberately supports only `+ - * /`, numeric literals, and field references (`calc_field/ast.rs`), with no functions; adding SUM/IF/etc. is a separate feature, not a hardening task, and is explicitly out of scope here. (2) Rewriting `compute-relational`'s aggregation/window kernels — this plan treats that crate as a contract and only pushes the minimal, scoped O1 capability if 0a proves it necessary. (3) Changing the wire/serde schema beyond additive, defaulted fields. (4) Any test-only or compatibility-shim "fix" for O1–O4 — these are production-path corrections or they don't land.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** O2 (resolution default), O5 (item keys), O6 (header hoist), and the O7 Show-Values-As clone/Kahan/ancestor-chain cleanups are self-contained within this crate and can proceed concurrently once the Phase 0c characterization corpus exists. O8's corpus is the shared substrate and should land early.
- **Sequenced within the crate:** O4 depends on 0d's diagnosis; O3 depends on 0c's semantics decision and must update drill-down in the same change.
- **Cross-folder dependencies:**
  - **`compute-relational`** — O1 likely requires an axis-domain (full-member) capability there; if 0a confirms, this is a hard dependency and should be coordinated with that crate's plan. O8's golden corpus implicitly tests the pivot↔relational seam and may surface relational-side fixes.
  - **`pivot-types` / `types/data` (plan 008)** — O1/O2 additive wire fields (if 0b shows they're missing) land there first.
  - **`kernel/src/domain/pivots` (plan 017)** and **`compute/core/src` eval/scheduler (plans 024/025)** — consumers of the four entry points; O1/O3/O4 change observable output, so their integration suites are part of this plan's verification, and any field-list/refresh UI assumptions about empty members (O1) or item keys (O5) should be checked there.
  - **FFI shells (WASM/NAPI/PyO3)** and the **TS contract generator** — re-run the type-generation check if wire types change; no logic changes expected.
