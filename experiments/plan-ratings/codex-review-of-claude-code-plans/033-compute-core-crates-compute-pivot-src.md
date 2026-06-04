Rating: 8/10

Summary judgment

This is a strong plan with unusually good source awareness for `compute-pivot`: it identifies real production-path defects at the resolver boundary, grouping layer, presenter grand-total alignment, pivot item identity, and Show Values As transform path. The plan is architecturally sympathetic to the crate's actual role as a pure pivot semantic layer over `compute-relational`, and it correctly treats `validate_and_resolve` as the trusted boundary that must absorb defaults and schema evolution.

The rating is not higher because several claims are slightly stale or under-specified. Most importantly, `domain-types/src/domain/pivot/config.rs` currently exposes no `show_empty_rows` or `show_empty_columns` fields on `PivotTableLayout`, so O1 is not just a dropped resolver mapping in this checkout; it is a schema/domain contract gap. The plan does mention that possibility in Phase 0b, but O1's headline framing says the resolver ignores "whatever the wire config requests," which is not accurate for the current typed layout. O7 also overstates duplicated Kahan work: `percentage.rs` already imports and uses `kahan_sum`; the duplicated compensated loops are in `running.rs`. These are precision issues, not enough to invalidate the plan.

Major strengths

- The objective list is concrete and tied to specific production files and observable behavior. The cited resolver literals for `show_empty_rows`/`show_empty_columns`, the `show_items_with_no_data` doc/code contradiction, Day/Week grouping behavior, subtotal grand-total `unwrap_or_default`, row-index-derived filter item keys, and per-leaf `measure_headers` allocation all exist in the current source.
- The plan respects package boundaries. It does not pretend that `compute-pivot` owns aggregation arithmetic, and it calls out likely dependencies on `compute-relational`, `pivot-types`/`domain-types`, kernel pivot consumers, and FFI/type generation.
- The sequencing is mostly sound: characterize Excel-facing semantics first, fix resolver defaults early, keep drill-down synchronized with grouping changes, and make performance work behavior-preserving after correctness contracts are pinned.
- The invariant section is useful. It names purity/statelessness, resolved-config construction, no caller-data panics, deterministic ordering, group-key identity, Show Values As phase ordering, and wire compatibility as contracts implementers can test against.
- The verification section is broad enough for the blast radius. It includes crate tests, clippy/build gates, conformance fixtures, property tests, downstream integration suites, and benchmark evidence for the actual hot path.

Major gaps or risks

- O1 needs a clearer product and data contract before implementation. The plan says "show empty rows / empty columns" should emit axis members with no underlying data, but it does not define the source of the full member domain, whether filters are applied before or after domain expansion, how this differs from per-field `show_items_with_no_data`, or how OOXML `showEmptyRow`/`showEmptyCol` maps to the domain model. Because the current `PivotTableLayout` has no such fields, this should be framed as an additive domain/schema + relational-axis-domain feature, not primarily a resolver plumb-through.
- O2 is correctly identified as a contradiction, but the plan should acknowledge existing tests that already assert the current default is true while `compute-relational` tests describe false as its default behavior. "Pick the Excel-correct default" is directionally right, but the implementation contract must say which layer owns the default and which existing tests are expected to change.
- O3 correctly spots context-free Day/Week bucketing, but the accepted behavior is left too open. The plan should specify the exact normalized key/display value pairs for standalone Day and Week, including cross-year weeks, leap days, and drill-down matching.
- O4 is a real risk, but the plan lacks a precise expected shape for `grand_totals.column` on subtotal rows. It should define whether subtotal right-side totals are keyed by the subtotal row key, by the stripped parent path, or recomputed from descendant leaves, and how calculated fields and collapsed rows affect that shape.
- O7 has a stale detail: `percentage.rs` already uses `kahan_sum`. The remaining useful work is reducing cloning/snapshots, streaming difference lookups, and extracting a shared running compensated accumulator or using an incremental helper where `kahan_sum` over an iterator is not the right abstraction.
- The benchmark gate is not fully operationalized. Criterion benchmarks are useful evidence, but "regressions fail loudly" needs an explicit CI mechanism, threshold, or recorded baseline policy; otherwise it is a manual PR note rather than a verifiable gate.
- The plan includes `benches/pivot_benchmarks.rs` in scope even though the review source folder is `compute-pivot/src`. That is reasonable for verification, but the scope line should distinguish production source changes from benchmark-only support files.

Contract and verification assessment

The contract model is one of the plan's best parts. It correctly centers the resolved-config boundary and cross-crate query/result seam. The proposed corpus through `compute` and `compute_with_show_values_as` is production-path relevant and would catch layout/aggregation mismatches that unit tests can miss. The plan also correctly requires downstream checks when wire/domain fields or observable pivot output change.

The verification gates need sharper acceptance criteria. For O1/O3/O4, golden fixtures should specify exact `PivotTableResult` rows, headers, keys, grand totals, and rendered bounds before implementation starts. For O6/O7, correctness gates should assert byte-for-byte or structurally identical results on the golden corpus, while benchmark gates should name exact scenarios and acceptable thresholds. For O2, the resolver tests must cover explicit true, explicit false, and omitted, and the relational query mapping should be checked so the chosen default is what `compute-relational` receives.

Concrete changes that would raise the rating

- Rewrite O1 as a schema/domain contract first: add or map `show_empty_rows` and `show_empty_columns` from the real persisted/domain representation, define the complete axis-domain semantics, then specify the relational result extension needed to support it.
- Pin the O2 default in the plan itself instead of deferring the decision, and list the existing pivot and relational tests that must be updated or preserved.
- Add a small table of expected key/display behavior for standalone Day and Week grouping, including drill-down keys and cross-year cases.
- Define the `grand_totals.column` shape for subtotal rows with an example multi-level row plus column pivot, including calculated-field value count alignment.
- Correct the O7 Kahan statement so it targets `running.rs` and any truly duplicated accumulator logic, not `percentage.rs`.
- Turn the benchmark requirement into a concrete gate: named Criterion benchmarks, input sizes, baseline recording location, and pass/fail threshold or manual acceptance protocol.
- Split Phase 5 into conformance corpus first and performance benchmarks second, so implementers can land the correctness contract independently of performance evidence.
