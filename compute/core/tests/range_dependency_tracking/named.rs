use crate::helpers::*;
use crate::summary::Summary;
use compute_core::storage::engine::YrsComputeEngine;
use formula_types::{NamedRangeDef, Scope};
use snapshot_types::WorkbookSnapshot;
use value_types::{CellValue, FiniteF64};

pub(crate) fn named_workbook_with_range(range_expr: &str) -> WorkbookSnapshot {
    let mut src_cells = Vec::new();
    for r in 0..10 {
        src_cells.push(value_cell(0, r, 0, (r + 1) as f64));
    }
    for r in 0..10 {
        src_cells.push(value_cell(0, r, 1, ((r + 1) * 10) as f64));
    }

    let dest_cells = vec![formula_cell(1, 0, 0, "SUM(MyRange)")];

    let def = NamedRangeDef::from_expression(
        "MyRange".to_string(),
        Scope::Workbook,
        range_expr.to_string(),
    );

    WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        named_ranges: vec![def],
        ..Default::default()
    }
}

/// For named ranges, the "redefine between ops" invariant is:
/// - Evaluate dependent with named range pointing at range R1.
/// - Mutate a cell inside R1.
/// - Revert.
/// - Dependent must return to pre-op value.
///
/// We don't exercise "redefine → mutate → redefine back → revert" here
/// because redefining a name is a structural-op-scope structural-ish op; we
/// still cover the core class-II invariant (a cell *inside* the named
/// range is a dependent).
pub(crate) fn run_named_case(variant: u8) -> Result<(), String> {
    let (range_expr, target_row, target_col, prior): (&str, u32, u32, CellValue) = match variant {
        0 => ("SourceData!A:A", 39_187, 0, CellValue::Null),
        1 => ("SourceData!A:B", 39_187, 1, CellValue::Null),
        2 => (
            "SourceData!$A$1:$A$10",
            4,
            0,
            CellValue::Number(FiniteF64::must(5.0)),
        ),
        3 => (
            "SourceData!A:A",
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
        ),
        _ => return Ok(()),
    };

    let (mut engine, _init) =
        YrsComputeEngine::from_snapshot(named_workbook_with_range(range_expr))
            .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);
    let target = cell_id(0, target_row, target_col);

    let before = read_value(&engine, &dependent);
    op_then_inverse(
        &mut engine,
        &source,
        &target,
        target_row,
        target_col,
        prior,
        "999",
    )?;
    let after = read_value(&engine, &dependent);

    assert_dependent_identity(
        &before,
        &after,
        &format!("named variant={} range={}", variant, range_expr),
    )
}

pub(crate) fn class_ii_named_family() {
    let mut s = Summary::new("named");
    for v in 0..4 {
        let name = format!("named__v{}", v);
        s.record(&name, run_named_case(v as u8));
    }
    s.emit();
    assert_eq!(
        s.failed, 0,
        "named family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}
