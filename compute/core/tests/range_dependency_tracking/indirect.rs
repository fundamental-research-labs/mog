use crate::helpers::*;
use crate::matrix::Extent;
use crate::summary::Summary;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, WorkbookSnapshot};
use value_types::CellValue;

pub(crate) fn indirect_workbook(extent: Extent, arg_in_cell: bool) -> WorkbookSnapshot {
    let mut src_cells: Vec<CellData> = Vec::new();
    match extent {
        Extent::Empty => {}
        Extent::A1Only => {
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
        Extent::A50k => {
            src_cells.push(value_cell(0, 49_999, 7, 100.0));
        }
        Extent::GrewThenShrank => {
            src_cells.push(raw_cell(0, 49_999, 7, CellValue::Null));
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
        Extent::ExpandedMidPath => {
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
    }

    let dest_cells = if arg_in_cell {
        // Dest!B1 holds the arg string; Dest!A1 INDIRECTs through it.
        vec![
            raw_cell(
                1,
                0,
                1,
                CellValue::Text(std::sync::Arc::from("SourceData!H:H")),
            ),
            formula_cell(1, 0, 0, "SUM(INDIRECT(B1))"),
        ]
    } else {
        vec![formula_cell(1, 0, 0, "SUM(INDIRECT(\"SourceData!H:H\"))")]
    };

    WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        ..Default::default()
    }
}

pub(crate) fn run_indirect_case(extent: Extent) -> Result<(), String> {
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(indirect_workbook(extent, false))
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);
    let target_row = match extent {
        Extent::A50k => 49_998,
        _ => 39_187,
    };
    let target = cell_id(0, target_row, 7);

    op_then_inverse(
        &mut engine,
        &source,
        &target,
        target_row,
        7,
        CellValue::Null,
        "85",
    )?;

    let after = read_value(&engine, &dependent);
    let ctx = format!("indirect extent={:?}", extent);
    assert_dependent_identity(&before, &after, &ctx)
}

/// Variant: the INDIRECT argument itself is a cell. Edit that cell
/// (change the reference string), revert, assert dependent returns.
///
/// Three sub-cases:
/// 1. Change the arg to a different valid range, then back.
/// 2. Change the arg to an error, then back.
/// 3. Change the arg to another column, then back.
pub(crate) fn run_indirect_arg_revert_case(variant: u8) -> Result<(), String> {
    // Seed a small extent.
    let (mut engine, _init) =
        YrsComputeEngine::from_snapshot(indirect_workbook(Extent::A1Only, true))
            .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let dest = sheet_id(1);
    let arg_cell = cell_id(1, 0, 1);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);

    let (new_input, prior_text) = match variant {
        0 => ("SourceData!H:H", "SourceData!H:H"), // no-op semantically
        1 => ("SourceData!I:I", "SourceData!H:H"), // different column
        2 => ("\"not a range\"", "SourceData!H:H"), // malformed (text)
        _ => ("SourceData!A:A", "SourceData!H:H"),
    };
    let _ = new_input; // linter
    // Forward write — the parser sees a text-valued input. Pass it as
    // a leading-apostrophe string to guarantee Text interpretation.
    let fwd = format!("'{}", new_input);
    engine
        .set_cell(&dest, arg_cell, 0, 1, fwd.as_str().into())
        .map_err(|e| format!("forward arg rewrite err: {:?}", e))?;

    // Inverse — use import_values with the captured Text value for
    // lossless restore (FINDINGS.md Class-A fix direction).
    engine
        .import_values(
            &dest,
            vec![(
                0,
                1,
                CellValue::Text(std::sync::Arc::from(prior_text)),
                None,
            )],
        )
        .map_err(|e| format!("inverse arg rewrite err: {:?}", e))?;

    let after = read_value(&engine, &dependent);
    assert_dependent_identity(
        &before,
        &after,
        &format!("indirect_arg_revert variant={}", variant),
    )
}

pub(crate) fn class_ii_indirect_family() {
    let mut s = Summary::new("indirect");

    // 5 extent cases × 1 shape (SUM via INDIRECT).
    for &extent in Extent::all() {
        let name = format!("indirect__{}", extent.as_slug());
        s.record(&name, run_indirect_case(extent));
    }

    // 3 "revert INDIRECT-argument cell" variants.
    for v in 0..3 {
        let name = format!("indirect_arg_revert__v{}", v);
        s.record(&name, run_indirect_arg_revert_case(v as u8));
    }

    s.emit();
    assert_eq!(
        s.failed, 0,
        "indirect family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}
