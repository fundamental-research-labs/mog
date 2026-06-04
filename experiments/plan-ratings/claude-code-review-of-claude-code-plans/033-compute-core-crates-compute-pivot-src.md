Rating: 9/10

# Review of Plan 033 — `compute-pivot/src`


## Summary judgment

This is a strong, evidence-grounded hardening plan for the pivot kernel. I spot-checked every load-bearing line citation in the plan against the actual source, and they are accurate:

- O1: `engine/validation.rs:399-400` does literally hardcode `show_empty_rows: false` / `show_empty_columns: false`, while the `ResolvedLayout` accessors (`resolved.rs:560-569`) and wire layout type expose them as real settings — the feature is genuinely inert.
- O2: `engine/validation.rs:379` resolves `show_items_with_no_data` with `.unwrap_or(true)`, while `resolved.rs:410` documents it as "defaulted to **false**." The contract/code contradiction is real.
- O3: `grouper.rs:110` returns `f64::from(date.day())` for `DateGrouping::Day` (day-of-month only), and `grouper.rs:107-109` (`Week`) is year-agnostic. The standalone-collapse bug is exactly as described, and the plan correctly notes drill-down (`engine/drill_down.rs:91-120`) re-applies the same grouping and must move in lock-step (verified: drill-down calls `apply_date_grouping` then `normalize_to_key`).
- O4: `presenter/grand_totals.rs:67-79` strips `SUBTOTAL_SUFFIX`, looks up `col_map`, and falls back to `.cloned().unwrap_or_default()` on a miss; the subsequent calc-field pass iterates the possibly-sparse `col_gt`.
- O5: `engine/pivot_items.rs` synthesizes filter-item keys as `format!("{field_id}:{i}")` over the source-row enumeration index — confirmed.
- O6: `presenter/column_headers.rs:84` calls `measure_headers(...)` inside the `for leaf in &leaves` loop.
- O7: `show_values_as/mod.rs:120-121` clones `result.rows` and `result.grand_totals` then rebuilds the context from `raw_rows`; `running.rs:28-31` re-implements Kahan inline despite `lib.rs:120` exporting `kahan_sum`.

The plan correctly identifies that most aggregation arithmetic lives in `compute-relational` (verified: `engine/compute.rs:47,88` call `compute_relational::execute`), and it scopes the cross-crate boundary honestly rather than pretending the work is local. The characterization-first sequencing (Phase 0c pins Excel semantics before any behavior change) is the right discipline for a parity-critical kernel.

## Major strengths

- **Citation accuracy is exceptional.** Nearly every objective is anchored to a specific file:line that holds up under inspection. This is the difference between a plan and a wish-list; an implementer can start immediately.
- **The "resolved boundary" framing is the correct architectural spine.** The plan treats `ResolvedPivotConfig`'s construct-only-via-`validate_and_resolve` invariant as the core safety property and requires every new setting (O1/O2) to flow through it with no regrown `unwrap_or` — that is exactly the right invariant to protect.
- **Cross-crate honesty.** O1 is explicitly flagged as possibly requiring a `compute-relational` axis-domain capability, with a Phase 0a gate that decides whether O1 ships now or becomes a tracked dependent follow-up. The plan refuses a test-only shim (non-goal #4).
- **Performance objectives are real and bounded.** O6 (header rebuild) and O7 (triple-clone + inline Kahan) are genuine hot-path wins, correctly marked behavior-preserving, and tied to bit-identical-output assertions and the existing bench harness.
- **Risk register is concrete and tied to user-visible blast radius** (O3 changes grouping output; O4 feeds GETPIVOTDATA via `to_pivot_table_def`; O7 numeric drift must be bit-identical, not "close").

## Major gaps or risks

- **O2 and O3 defer the actual decision to "Excel-correct semantics" without stating the answer.** The plan knows the contradiction exists but punts the resolution to Phase 0c characterization. That is defensible, but it leaves the single most decision-heavy objectives (a user-visible default flip; a correctness change that shifts existing pivots) without a committed target. For O3, offering both "(a) group by full date" and "(b) guarantee Day never emits without ancestors" as open alternatives is a meaningful unresolved fork — (a) and (b) have very different drill-down and presenter consequences. A stronger plan would at least state the expected answer and mark it for confirmation, rather than leaving the branch fully open.
- **O8 is over-bundled.** "Establish a pivot↔relational golden conformance corpus" plus "benchmark gate" is effectively a small project folded into one objective. The matrix (multi-level rows+columns × every aggregate × every Show-Values-As variant × date/number grouping × top-bottom tie cases × expansion state) is large; there is no estimate of corpus size or a phased landing for it, even though the plan elsewhere says "O8's corpus is the shared substrate and should land early."
- **No numeric threshold for the benchmark gate.** "No regression overall and a measurable improvement on O6/O7 cases" with "numbers attached to the PR" is directionally right but unfalsifiable as a gate — there is no percentage floor or tolerance band, so "measurable" is reviewer-subjective.
- **O4's recompute path is under-specified.** If the relational entry is genuinely absent (not a keying bug), the plan says "recompute the subtotal's grand-total from its constituent leaf grand-totals." For non-additive aggregates (AVERAGE, COUNT DISTINCT, MIN/MAX over the column axis), summing leaf grand-totals is *wrong* — a subtotal's column grand-total is not generally the sum of its children's column grand-totals. The plan does not flag that recomputation correctness is aggregate-function-dependent, which is the subtle trap here.

## Contract and verification assessment

The contracts section is the plan's best part. It enumerates the real invariants — purity/statelessness, the resolved boundary, no-panic-on-caller-data (with a correct census of the guarded `.unwrap()`s and `unreachable!` arms at `grouper.rs:103`, `validation.rs:465`), validation completeness, Kahan numeric stability, single-sourced group-key identity, the 3-phase Show-Values-As ordering, top/bottom tie-breaking, and additive wire/serde stability — and ties each to specific objectives. These are testable and load-bearing.

Verification gates are appropriately layered: unit/resolution tests, presenter/grand-total tests, Show-Values-As equivalence (bit-identical Kahan), end-to-end golden corpus, property tests (grand totals = sum of constituents within epsilon — note this property itself only holds for additive aggregates, same caveat as O4), and the workspace gates honoring `#![warn(clippy::pedantic)]` + `#![deny(missing_docs)]`. The sequencing rule (characterization lands first and stays green through behavior-preserving Phase 4; only O1–O4 change golden output, each justified against pinned semantics) is exactly right.

Two soft spots: (1) the benchmark gate lacks a numeric pass/fail threshold; (2) the plan leans on downstream suites (kernel-pivot 017, compute/core 024/025, FFI contract-gen) for regression coverage but does not say which specific behaviors those suites would catch that the local corpus would not — it is asserted rather than mapped.

## Concrete changes that would raise the rating

1. **Commit to the O2 default and the O3 branch.** State the expected Excel-correct answer for `show_items_with_no_data` and pick (a) vs (b) for standalone Day/Week as the primary path, marking it "confirm in 0c" rather than leaving the fork fully open. This converts the two highest-decision objectives from open questions into verifiable claims.
2. **Add the aggregate-function caveat to O4.** Explicitly note that a subtotal column grand-total cannot be recomputed by summing leaf grand-totals for non-additive aggregates; the fix must thread the correct relational entry (favoring the keying-bug branch) or recompute via the actual aggregate, and the property test must scope its "sum of constituents" invariant to additive functions.
3. **Split O8 into corpus-bootstrap (land early, minimal matrix to support 0c) and corpus-expansion (full matrix), and give the benchmark gate a numeric floor** (e.g., "≥X% improvement on the O6 wide-multi-measure case, ≤Y% regression band elsewhere").
4. **Map the downstream suites to specific risks** — name which observable output change (empty members for 017's field-list UI, item keys for slicer pickers, grand-total cells for GETPIVOTDATA export) each consuming suite is expected to guard, rather than listing them generically.

These are refinements, not structural problems. The plan is accurate, well-scoped, architecturally sound, and production-path throughout.
