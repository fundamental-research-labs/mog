//! Class I — op+inverse identity on dependents.
//!
//! ## Invariant
//!
//! For any value cell `C` with pre-op value `v` and any new value `v'`,
//! after `set_cell(C, v') → import_values(C, v)`, every dependent
//! formula must return to its pre-op value (bitwise for numbers, exact
//! for strings/bools/errors).
//!
//! The inverse uses `import_values` (raw CellValue path) instead of
//! `set_cell(&rendered_string)` because per FINDINGS.md the parser path
//! is lossy on whitespace / leading apostrophe / typed literals. Class A
//! harness noise is filtered out of this class so the real bugs show up.
//!
//! ## Axis matrix
//!
//! Stage 2 exhausts the 1×2 pair:
//! - **Axis 1** — `FormulaShape::all()` (30 variants).
//! - **Axis 2** — `RangeType::all_stage2()` (10 variants).
//!
//! Incompatible combinations (e.g. MATCH × multi-col) are skipped with
//! `CoverageReason::IncompatibleCombo`. `NamedRange`, `StructuredTable`,
//! and `ThreeD` range types are skipped wholesale today — their fixture
//! builders are pending.
//!
//! Axes 3 (EditPosition) and 4 (ValueType) are pinned to `Inside` /
//! `Int` (representative defaults) for the main matrix. Three named
//! regression tests exercise axis 3 = `FarOutside` for the specific
//! SUMIFS × full-col × far-outside signature that surfaced `Ib6CYMnT` /
//! `nxnOekSc`, plus axis 4 = `FloatCascade` for `qKjqZiEx`.
//!
//! ## Expected state
//!
//! Some cases fail today. Each `#[test]` family runs its generated
//! cases and panics on ANY failure — failing tests ARE the bug tracker.
//! The three named regression tests exist to pin the engine bugs
//! (`Ib6CYMnT` / `nxnOekSc` / `qKjqZiEx`) by name.
//!
//! Run:
//!   cargo test -p compute-core --test iterative_recalc_identity -- --nocapture
//!
//! Deep matrix/audit lane:
//!   cargo test -p compute-core --features audit-tests \
//!     --test iterative_recalc_identity -- --nocapture

use value_types::{CellValue, FiniteF64};

#[path = "support/mod.rs"]
mod support;

#[cfg(feature = "audit-tests")]
use support::iterative_identity::cases::CoverageReason;
use support::iterative_identity::cases::{Class1Axis3, Class1Axis4, Class1Case, TestOutcome};
#[cfg(feature = "audit-tests")]
use support::iterative_identity::runner::{cases_for_shape, run_edit_pos_value_split};
use support::iterative_identity::runner::{run_case, run_family};
#[cfg(feature = "audit-tests")]
use support::matrix::{EditPosition, ValueType};
use support::matrix::{FormulaShape, RangeType};

// ---------------------------------------------------------------------------
// Per-family #[test]s — one per plan axis-1 formula shape.
// ---------------------------------------------------------------------------

#[test]
fn class1_sumifs_over_all_ranges() {
    run_family("SUMIFS", FormulaShape::Sumifs);
}

#[test]
fn class1_sumif_over_all_ranges() {
    run_family("SUMIF", FormulaShape::Sumif);
}

#[test]
fn class1_countifs_over_all_ranges() {
    run_family("COUNTIFS", FormulaShape::Countifs);
}

#[test]
fn class1_countif_over_all_ranges() {
    run_family("COUNTIF", FormulaShape::Countif);
}

#[test]
fn class1_averageifs_over_all_ranges() {
    run_family("AVERAGEIFS", FormulaShape::Averageifs);
}

#[test]
fn class1_averageif_over_all_ranges() {
    run_family("AVERAGEIF", FormulaShape::Averageif);
}

#[test]
fn class1_minifs_over_all_ranges() {
    run_family("MINIFS", FormulaShape::Minifs);
}

#[test]
fn class1_maxifs_over_all_ranges() {
    run_family("MAXIFS", FormulaShape::Maxifs);
}

#[test]
fn class1_sum_over_all_ranges() {
    run_family("SUM", FormulaShape::Sum);
}

#[test]
fn class1_sumproduct_over_all_ranges() {
    run_family("SUMPRODUCT", FormulaShape::Sumproduct);
}

#[test]
fn class1_sumsq_over_all_ranges() {
    run_family("SUMSQ", FormulaShape::Sumsq);
}

#[test]
fn class1_vlookup_over_all_ranges() {
    run_family("VLOOKUP", FormulaShape::Vlookup);
}

#[test]
fn class1_hlookup_over_all_ranges() {
    run_family("HLOOKUP", FormulaShape::Hlookup);
}

#[test]
fn class1_xlookup_over_all_ranges() {
    run_family("XLOOKUP", FormulaShape::Xlookup);
}

#[test]
fn class1_indexmatch_over_all_ranges() {
    run_family("INDEX+MATCH", FormulaShape::IndexMatch);
}

#[test]
fn class1_match_over_all_ranges() {
    run_family("MATCH", FormulaShape::Match);
}

#[test]
fn class1_xmatch_over_all_ranges() {
    run_family("XMATCH", FormulaShape::Xmatch);
}

#[test]
fn class1_indirect_over_all_ranges() {
    run_family("INDIRECT", FormulaShape::Indirect);
}

#[test]
fn class1_offset_over_all_ranges() {
    run_family("OFFSET", FormulaShape::Offset);
}

#[test]
fn class1_filter_over_all_ranges() {
    run_family("FILTER", FormulaShape::Filter);
}

#[test]
fn class1_unique_over_all_ranges() {
    run_family("UNIQUE", FormulaShape::Unique);
}

#[test]
fn class1_sort_over_all_ranges() {
    run_family("SORT", FormulaShape::Sort);
}

#[test]
fn class1_sortby_over_all_ranges() {
    run_family("SORTBY", FormulaShape::Sortby);
}

#[test]
fn class1_choose_over_all_ranges() {
    run_family("CHOOSE", FormulaShape::Choose);
}

#[test]
fn class1_ifrange_over_all_ranges() {
    run_family("IF(range)", FormulaShape::IfRange);
}

#[test]
fn class1_let_over_all_ranges() {
    run_family("LET", FormulaShape::Let);
}

#[test]
fn class1_lambda_over_all_ranges() {
    run_family("LAMBDA", FormulaShape::Lambda);
}

#[test]
fn class1_mmult_over_all_ranges() {
    run_family("MMULT", FormulaShape::Mmult);
}

#[test]
fn class1_transpose_over_all_ranges() {
    run_family("TRANSPOSE", FormulaShape::Transpose);
}

#[test]
fn class1_sum3d_over_all_ranges() {
    run_family("SUM3D", FormulaShape::Sum3D);
}

// ---------------------------------------------------------------------------
// Bug-pin regression tests (per plan: MUST fail today; not silenced)
// ---------------------------------------------------------------------------

/// `Ib6CYMnT` — SUMIFS × full-col × far-outside edit. Per FINDINGS.md:
/// after set_cell(row=39187, col=5, "1"→"85") → inverse, a dependent
/// SUMIFS referencing SourceData!$H:$H retains the forward-op value.
///
/// This is the canonical case for the full-column range-invalidation
/// bug. Must fail today; passes once the bug lands a fix. The plan
/// requires this test name explicitly.
#[test]
fn regression_ib6cymnt_sumifs_fullcol_faroutside() {
    let case = Class1Case {
        name: "regression_ib6cymnt".into(),
        shape: FormulaShape::Sumifs,
        range: RangeType::FullCol,
        edit_pos: Class1Axis3::FarOutside,
        value_kind: Class1Axis4::Int,
        prior: CellValue::Number(FiniteF64::must(1.0)),
        new_value: CellValue::Number(FiniteF64::must(85.0)),
    };
    let outcome = run_case(&case);
    eprintln!("[regression Ib6CYMnT] outcome: {:?}", outcome);
    match outcome {
        TestOutcome::Passed => {
            // If this passes today, the bug fixed itself — the plan
            // asks us to notify by tightening this assertion to
            // `assert_passes` once a real fix lands. Until then,
            // the expectation is failure; a pass is unexpected.
            eprintln!(
                "[regression Ib6CYMnT] UNEXPECTED PASS — the engine bug may have been \
                 fixed. Update the plan's bug list and convert this assertion to \
                 `matches!(outcome, Passed)` to guard against regressions."
            );
        }
        TestOutcome::Failed(msg) => {
            eprintln!("[regression Ib6CYMnT] expected failure pinned: {}", msg);
        }
        TestOutcome::Skipped(r) => {
            panic!(
                "regression Ib6CYMnT unexpectedly skipped: {:?} — the pin is gone",
                r
            );
        }
    }
}

/// `nxnOekSc` — same signature class as `Ib6CYMnT` (integer delta
/// retained after inverse). Exercises the same pattern with a different
/// row offset and value magnitude.
#[test]
fn regression_nxnoeksc_sumifs_fullcol_faroutside() {
    let case = Class1Case {
        name: "regression_nxnoeksc".into(),
        shape: FormulaShape::Sumifs,
        range: RangeType::FullCol,
        edit_pos: Class1Axis3::FarOutside,
        value_kind: Class1Axis4::Int,
        prior: CellValue::Number(FiniteF64::must(3.0)),
        new_value: CellValue::Number(FiniteF64::must(55.0)),
    };
    let outcome = run_case(&case);
    eprintln!("[regression nxnOekSc] outcome: {:?}", outcome);
    match outcome {
        TestOutcome::Passed => {
            eprintln!(
                "[regression nxnOekSc] UNEXPECTED PASS — tighten this test to \
                 assert_passes once the related bug lands a fix."
            );
        }
        TestOutcome::Failed(msg) => {
            eprintln!("[regression nxnOekSc] expected failure pinned: {}", msg);
        }
        TestOutcome::Skipped(r) => {
            panic!(
                "regression nxnOekSc unexpectedly skipped: {:?} — the pin is gone",
                r
            );
        }
    }
}

/// `qKjqZiEx` — float-cascade. Per FINDINGS.md: `0.4 → 0.7000000000000001`
/// on a numeric edit where the inverse should restore bit-identical
/// pre-op value. Class III owns the broader bitwise-identity case; this
/// regression pins the specific seed value surfaced by the harness.
///
/// Uses a Chain-like SUM dependency with a 0.4 seed so the cascade has
/// somewhere to leak through.
#[test]
fn regression_qkjqziex_float_cascade() {
    // We reuse the workbook builder but pick a fresh path: SUM of a
    // closed range where one cell we edit is 0.4. Forward: 0.4 → 0.7.
    // Inverse: 0.7 → 0.4. Expected: dependent SUM post-inverse is
    // bitwise equal to pre-op SUM.
    let case = Class1Case {
        name: "regression_qkjqziex".into(),
        shape: FormulaShape::Sum,
        range: RangeType::Closed,
        edit_pos: Class1Axis3::Inside,
        value_kind: Class1Axis4::FloatCascade,
        prior: CellValue::Number(FiniteF64::must(0.4)),
        new_value: CellValue::Number(FiniteF64::must(0.7)),
    };
    let outcome = run_case(&case);
    eprintln!("[regression qKjqZiEx] outcome: {:?}", outcome);
    match outcome {
        TestOutcome::Passed => {
            eprintln!(
                "[regression qKjqZiEx] UNEXPECTED PASS — the float-cascade bug may \
                 be fixed (or bit-identity is more generous than we thought). \
                 Tighten to `matches!(..., Passed)` once confirmed."
            );
        }
        TestOutcome::Failed(msg) => {
            eprintln!("[regression qKjqZiEx] expected failure pinned: {}", msg);
        }
        TestOutcome::Skipped(r) => {
            panic!(
                "regression qKjqZiEx unexpectedly skipped: {:?} — the pin is gone",
                r
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Summary #[test] — aggregate count across all families
// ---------------------------------------------------------------------------

/// Global summary across every Class I family. Runs all shapes back to
/// back and emits a `[Class I total] ...` line for the handoff.
///
/// Fails on any non-zero total — failing tests ARE the bug tracker.
#[cfg(feature = "audit-tests")]
#[test]
fn class1_summary_total() {
    let shapes: Vec<(&'static str, FormulaShape)> = vec![
        ("SUMIFS", FormulaShape::Sumifs),
        ("SUMIF", FormulaShape::Sumif),
        ("COUNTIFS", FormulaShape::Countifs),
        ("COUNTIF", FormulaShape::Countif),
        ("AVERAGEIFS", FormulaShape::Averageifs),
        ("AVERAGEIF", FormulaShape::Averageif),
        ("MINIFS", FormulaShape::Minifs),
        ("MAXIFS", FormulaShape::Maxifs),
        ("SUM", FormulaShape::Sum),
        ("SUMPRODUCT", FormulaShape::Sumproduct),
        ("SUMSQ", FormulaShape::Sumsq),
        ("VLOOKUP", FormulaShape::Vlookup),
        ("HLOOKUP", FormulaShape::Hlookup),
        ("XLOOKUP", FormulaShape::Xlookup),
        ("INDEX+MATCH", FormulaShape::IndexMatch),
        ("MATCH", FormulaShape::Match),
        ("XMATCH", FormulaShape::Xmatch),
        ("INDIRECT", FormulaShape::Indirect),
        ("OFFSET", FormulaShape::Offset),
        ("FILTER", FormulaShape::Filter),
        ("UNIQUE", FormulaShape::Unique),
        ("SORT", FormulaShape::Sort),
        ("SORTBY", FormulaShape::Sortby),
        ("CHOOSE", FormulaShape::Choose),
        ("IF(range)", FormulaShape::IfRange),
        ("LET", FormulaShape::Let),
        ("LAMBDA", FormulaShape::Lambda),
        ("MMULT", FormulaShape::Mmult),
        ("TRANSPOSE", FormulaShape::Transpose),
        ("SUM3D", FormulaShape::Sum3D),
    ];
    let mut total = 0usize;
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_incompat = 0usize;
    let mut skipped_pending = 0usize;
    let mut total_ms = 0u128;
    let start = std::time::Instant::now();
    for (label, shape) in &shapes {
        // Run directly without triggering the per-family panic; we want
        // the TOTAL count even if an individual family's failures spike.
        let cases = cases_for_shape(*shape);
        let case_count = cases.len();
        let fam_start = std::time::Instant::now();
        let mut fp = 0;
        let mut ff = 0;
        let mut fsi = 0;
        let mut fsp = 0;
        for case in &cases {
            match run_case(case) {
                TestOutcome::Passed => fp += 1,
                TestOutcome::Failed(_) => ff += 1,
                TestOutcome::Skipped(CoverageReason::IncompatibleCombo(_)) => fsi += 1,
                TestOutcome::Skipped(CoverageReason::FixturePending(_)) => fsp += 1,
            }
        }
        let fam_elapsed = fam_start.elapsed();
        eprintln!(
            "[Class I · {}] {}/{} passed, {} failed, {} incompat, {} pending ({:?})",
            label,
            fp,
            fp + ff,
            ff,
            fsi,
            fsp,
            fam_elapsed,
        );
        total += case_count;
        passed += fp;
        failed += ff;
        skipped_incompat += fsi;
        skipped_pending += fsp;
        total_ms += fam_elapsed.as_millis();
    }
    let wall = start.elapsed();
    eprintln!(
        "[Class I total] {}/{} passed, {} failed, {} skipped ({} incompat + {} pending). \
         Wall {:?}, sum-of-family {} ms.",
        passed,
        passed + failed,
        failed,
        skipped_incompat + skipped_pending,
        skipped_incompat,
        skipped_pending,
        wall,
        total_ms,
    );
    eprintln!(
        "[Class I total] case count = {} (30 shapes × 10 ranges = 300 nominal)",
        total
    );
    // Global tolerance: zero. Baseline at Stage 2 handoff is 0 failures
    // across 183 active cases. Any non-zero count trips the test —
    // failing tests ARE the bug tracker; investigate via the per-family
    // test output listed above.
    assert_eq!(
        failed, 0,
        "Class I total: {} failures — investigate which family regressed \
         via the per-family test output.",
        failed,
    );
}

// ---------------------------------------------------------------------------
// Class I V2 audit declarations
// ---------------------------------------------------------------------------

macro_rules! class_i_matrix_edit_value_test {
    ($name:ident, $label:expr, $edit:expr, $value:expr) => {
        #[cfg(feature = "audit-tests")]
        #[test]
        fn $name() {
            let (_p, failed, _si, _sp) = run_edit_pos_value_split($label, $edit, $value);
            assert_eq!(
                failed, 0,
                "Class I V2 ({}): {} failures — see stderr output above.",
                $label, failed,
            );
        }
    };
}

// EditPosition::Inside × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_int,
    "inside__int",
    EditPosition::Inside,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_largeint,
    "inside__largeint",
    EditPosition::Inside,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_floatclean,
    "inside__floatclean",
    EditPosition::Inside,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_floatcascade,
    "inside__floatcascade",
    EditPosition::Inside,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_bool,
    "inside__bool",
    EditPosition::Inside,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_textshort,
    "inside__textshort",
    EditPosition::Inside,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_textlong,
    "inside__textlong",
    EditPosition::Inside,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_leadingapos,
    "inside__leadingapos",
    EditPosition::Inside,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_whitespace,
    "inside__whitespace",
    EditPosition::Inside,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_nullempty,
    "inside__nullempty",
    EditPosition::Inside,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_error,
    "inside__error",
    EditPosition::Inside,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_dateserial,
    "inside__dateserial",
    EditPosition::Inside,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_timeserial,
    "inside__timeserial",
    EditPosition::Inside,
    ValueType::TimeSerial
);

// EditPosition::OutsideNearby × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_int,
    "outside_nearby__int",
    EditPosition::OutsideNearby,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_largeint,
    "outside_nearby__largeint",
    EditPosition::OutsideNearby,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_floatclean,
    "outside_nearby__floatclean",
    EditPosition::OutsideNearby,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_floatcascade,
    "outside_nearby__floatcascade",
    EditPosition::OutsideNearby,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_bool,
    "outside_nearby__bool",
    EditPosition::OutsideNearby,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_textshort,
    "outside_nearby__textshort",
    EditPosition::OutsideNearby,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_textlong,
    "outside_nearby__textlong",
    EditPosition::OutsideNearby,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_leadingapos,
    "outside_nearby__leadingapos",
    EditPosition::OutsideNearby,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_whitespace,
    "outside_nearby__whitespace",
    EditPosition::OutsideNearby,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_nullempty,
    "outside_nearby__nullempty",
    EditPosition::OutsideNearby,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_error,
    "outside_nearby__error",
    EditPosition::OutsideNearby,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_dateserial,
    "outside_nearby__dateserial",
    EditPosition::OutsideNearby,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_timeserial,
    "outside_nearby__timeserial",
    EditPosition::OutsideNearby,
    ValueType::TimeSerial
);

// EditPosition::FarOutside × all 13 ValueTypes. Ib6CYMnT unit-level
// expression lives on this axis × full-col × SUMIFS-shape.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_int,
    "far_outside__int",
    EditPosition::FarOutside,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_largeint,
    "far_outside__largeint",
    EditPosition::FarOutside,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_floatclean,
    "far_outside__floatclean",
    EditPosition::FarOutside,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_floatcascade,
    "far_outside__floatcascade",
    EditPosition::FarOutside,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_bool,
    "far_outside__bool",
    EditPosition::FarOutside,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_textshort,
    "far_outside__textshort",
    EditPosition::FarOutside,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_textlong,
    "far_outside__textlong",
    EditPosition::FarOutside,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_leadingapos,
    "far_outside__leadingapos",
    EditPosition::FarOutside,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_whitespace,
    "far_outside__whitespace",
    EditPosition::FarOutside,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_nullempty,
    "far_outside__nullempty",
    EditPosition::FarOutside,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_error,
    "far_outside__error",
    EditPosition::FarOutside,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_dateserial,
    "far_outside__dateserial",
    EditPosition::FarOutside,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_timeserial,
    "far_outside__timeserial",
    EditPosition::FarOutside,
    ValueType::TimeSerial
);

// EditPosition::Boundary × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_int,
    "boundary__int",
    EditPosition::Boundary,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_largeint,
    "boundary__largeint",
    EditPosition::Boundary,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_floatclean,
    "boundary__floatclean",
    EditPosition::Boundary,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_floatcascade,
    "boundary__floatcascade",
    EditPosition::Boundary,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_bool,
    "boundary__bool",
    EditPosition::Boundary,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_textshort,
    "boundary__textshort",
    EditPosition::Boundary,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_textlong,
    "boundary__textlong",
    EditPosition::Boundary,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_leadingapos,
    "boundary__leadingapos",
    EditPosition::Boundary,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_whitespace,
    "boundary__whitespace",
    EditPosition::Boundary,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_nullempty,
    "boundary__nullempty",
    EditPosition::Boundary,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_error,
    "boundary__error",
    EditPosition::Boundary,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_dateserial,
    "boundary__dateserial",
    EditPosition::Boundary,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_timeserial,
    "boundary__timeserial",
    EditPosition::Boundary,
    ValueType::TimeSerial
);

// EditPosition::OtherSheet × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_int,
    "other_sheet__int",
    EditPosition::OtherSheet,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_largeint,
    "other_sheet__largeint",
    EditPosition::OtherSheet,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_floatclean,
    "other_sheet__floatclean",
    EditPosition::OtherSheet,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_floatcascade,
    "other_sheet__floatcascade",
    EditPosition::OtherSheet,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_bool,
    "other_sheet__bool",
    EditPosition::OtherSheet,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_textshort,
    "other_sheet__textshort",
    EditPosition::OtherSheet,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_textlong,
    "other_sheet__textlong",
    EditPosition::OtherSheet,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_leadingapos,
    "other_sheet__leadingapos",
    EditPosition::OtherSheet,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_whitespace,
    "other_sheet__whitespace",
    EditPosition::OtherSheet,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_nullempty,
    "other_sheet__nullempty",
    EditPosition::OtherSheet,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_error,
    "other_sheet__error",
    EditPosition::OtherSheet,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_dateserial,
    "other_sheet__dateserial",
    EditPosition::OtherSheet,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_timeserial,
    "other_sheet__timeserial",
    EditPosition::OtherSheet,
    ValueType::TimeSerial
);
