use crate::fullcol::run_fullcol_case;
use crate::indirect::{run_indirect_arg_revert_case, run_indirect_case};
use crate::matrix::{AggregatorShape, CoverageReason, Extent};
use crate::named::run_named_case;
use crate::offset::run_offset_case;
use crate::summary::Summary;
use crate::table_refs::table_ref_case_names;
use crate::three_d::run_3d_case;
use std::time::Instant;

pub(crate) fn class_ii_total_summary() {
    // Re-run every family to get aggregate counts. This duplicates
    // work; it's ~1 s and keeps the single-line "total" print accurate
    // even if individual family tests are filtered with `cargo test
    // -- class_ii_fullcol_family`.
    let start = Instant::now();

    let mut totals = Summary::new("total");

    for &shape in AggregatorShape::all() {
        for &extent in Extent::all() {
            let name = format!("fullcol__{}__{}", shape.as_slug(), extent.as_slug());
            totals.record(&name, run_fullcol_case(shape, extent));
        }
    }
    for &extent in Extent::all() {
        let name = format!("indirect__{}", extent.as_slug());
        totals.record(&name, run_indirect_case(extent));
    }
    for v in 0..3 {
        totals.record(
            &format!("indirect_arg_revert__v{}", v),
            run_indirect_arg_revert_case(v as u8),
        );
    }
    for v in 0..6 {
        totals.record(&format!("offset__v{}", v), run_offset_case(v as u8));
    }
    for v in 0..4 {
        totals.record(&format!("named__v{}", v), run_named_case(v as u8));
    }
    for v in 0..4 {
        totals.record(&format!("3d__v{}", v), run_3d_case(v as u8));
    }
    // 3d__v4/v5 (sheet rename/reorder) → structural-op scope.
    totals.skip(CoverageReason::Round2Scope);
    totals.skip(CoverageReason::Round2Scope);
    for _ in table_ref_case_names() {
        totals.skip(CoverageReason::Round2Scope);
    }

    let elapsed = start.elapsed();

    eprintln!(
        "[Class II total] {}/{} passed, {} failed, {} skipped ({:?})",
        totals.passed,
        totals.passed + totals.failed,
        totals.failed,
        totals.skipped,
        elapsed,
    );
    if !totals.failures.is_empty() {
        eprintln!("[Class II total] failures:");
        for f in &totals.failures {
            eprintln!("{}", f);
        }
    }

    // Failing tests ARE the bug tracker — see per-family stderr output
    // above for the named failing cases. No silencing budget.
    assert_eq!(
        totals.failed, 0,
        "Class II total: {} failures — see per-family stderr output above.",
        totals.failed,
    );
}
