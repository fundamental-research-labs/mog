//! Workbook builders for Class I identity cases.

use cell_types::{CellId, SheetId};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

use super::cases::{Class1Axis3, Class1Case, Class1CaseV2, CoverageReason};
use super::formulas::formula_template;
use super::{
    SHEET1_UUID, SHEET2_UUID, SHEET3_UUID, cell_id_for, formula_cell, make_cell, sheet_id,
    value_cell,
};
use crate::support::matrix::{EditPosition, FormulaShape};

// ---------------------------------------------------------------------------
// Workbook builder for a Class I case
// ---------------------------------------------------------------------------

/// Build a snapshot for a case: seed values, the dependent formula, and
/// (for Sum3D) multiple sheets. Returns the snapshot plus the target
/// cell id and position.
///
/// Seeds: A1..A10 = 1..10, B1..B10 = 1..10. These are integers so
/// everything SUMs/COUNTs/MATCHes cleanly. The target cell is `B5` for
/// `Inside` edits, `B55000` for `FarOutside`.
pub(super) fn workbook_for_case(
    case: &Class1Case,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId), CoverageReason> {
    let formula = formula_template(case.shape, case.range)?;

    // Seed cells on sheet 1, using a BTreeMap keyed by (row, col) to
    // dedupe and so later writes override earlier ones. We need
    // row-2 data for HLOOKUP / SORTBY / MMULT second-operand paths,
    // but row-2 col-A..C would collide with our A1..C10 seeds if we
    // blindly push both.
    use std::collections::BTreeMap;
    let mut seed_map: BTreeMap<(u32, u32), CellValue> = BTreeMap::new();
    // A1..A10, B1..B10, C1..C10 = 1..10.
    for i in 0..10u32 {
        seed_map.insert((i, 0), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 1), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 2), CellValue::Number(FiniteF64::must((i + 1) as f64)));
    }
    // Extra row 2 (HLOOKUP / SORTBY / MMULT): override A2..C2 already
    // set above, and add D2..J2. Make row 2 = [1..10] across cols 0..9.
    for j in 0..10u32 {
        seed_map.insert((1, j), CellValue::Number(FiniteF64::must((j + 1) as f64)));
    }

    // Seed the target cell with its prior value. For FarOutside we
    // write a fresh cell at row 55_000.
    let (target_row, target_col) = match case.edit_pos {
        Class1Axis3::Inside => (4u32, 1u32), // B5 (inside 1..10 range)
        Class1Axis3::FarOutside => (55_000u32, 1u32), // B55001 (far beyond)
    };
    seed_map.insert((target_row, target_col), case.prior.clone());

    let mut sheet1_cells: Vec<CellData> = seed_map
        .into_iter()
        .map(|((r, c), v)| make_cell(0, r, c, v, None))
        .collect();

    // Dependent formula at M21 (row 20, col 12). Placed deliberately
    // outside any A:J / 1:1 / 2:2 / A1:C10 range the formula templates
    // reference so we don't accidentally introduce a circular self-
    // reference. Full-col (A:A) and full-col-multi (A:C) reference col
    // 0..2; full-row (1:1) references row 0; 2:2 references row 1;
    // all closed ranges cap at A10 / J1. Row 20 col 12 sits outside
    // every one of those.
    let formula_row = 20u32;
    let formula_col = 12u32;
    sheet1_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    // Sum3D needs Sheet2 and Sheet3 also populated (so the 3D SUM
    // actually produces a meaningful value to compare before/after).
    let sheets = if case.shape == FormulaShape::Sum3D {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        let mut sheet3_cells: Vec<CellData> = Vec::new();
        for i in 0..10u32 {
            sheet2_cells.push(value_cell(1, i, 0, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 1, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 2, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 0, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 1, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 2, (i + 1) as f64));
        }
        vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 100_000,
                cols: 30,
                cells: sheet1_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Sheet2".to_string(),
                rows: 1_000,
                cols: 30,
                cells: sheet2_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET3_UUID.to_string(),
                name: "Sheet3".to_string(),
                rows: 1_000,
                cols: 30,
                cells: sheet3_cells,
                ranges: vec![],
            },
        ]
    } else {
        vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet1_cells,
            ranges: vec![],
        }]
    };

    let snapshot = WorkbookSnapshot {
        sheets,
        ..Default::default()
    };

    Ok((
        snapshot,
        cell_id_for(0, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
    ))
}

/// Build the snapshot for a Track-4b case. Follows the same seed layout
/// as `workbook_for_case` (A1..C10 = 1..10, row 2 = 1..10 across), but
/// varies the edited-cell position per `EditPosition`.
///
/// For `EditPosition::OtherSheet`, we place the target cell on Sheet2;
/// the dependent formula on Sheet1 still references Sheet1!ranges, so
/// the edit must logically not affect the dependent unless the formula
/// itself pulls across sheets (Sum3D case).
pub(super) fn workbook_for_case_v2(
    case: &Class1CaseV2,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId, SheetId), CoverageReason> {
    let formula = formula_template(case.shape, case.range)?;

    use std::collections::BTreeMap;
    let mut seed_map: BTreeMap<(u32, u32), CellValue> = BTreeMap::new();
    for i in 0..10u32 {
        seed_map.insert((i, 0), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 1), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 2), CellValue::Number(FiniteF64::must((i + 1) as f64)));
    }
    for j in 0..10u32 {
        seed_map.insert((1, j), CellValue::Number(FiniteF64::must((j + 1) as f64)));
    }

    // EditPosition → (target_row, target_col, target_sheet_prefix).
    // Row/col choices:
    // - Inside: B5 (inside the A1:C10 block).
    // - OutsideNearby: B25 (past A10 / C10 but well below 50_000).
    // - FarOutside: B55000 (matches the Ib6CYMnT signature, row >=39186).
    // - Boundary: B10 (last cell of A1:A10 / B1:B10).
    // - OtherSheet: Sheet2!B5 (for cross-sheet edit coverage).
    let (target_row, target_col, target_sheet_prefix) = match case.edit_pos {
        EditPosition::Inside => (4u32, 1u32, 0u8),
        EditPosition::OutsideNearby => (24u32, 1u32, 0u8),
        EditPosition::FarOutside => (55_000u32, 1u32, 0u8),
        EditPosition::Boundary => (9u32, 1u32, 0u8),
        EditPosition::OtherSheet => (4u32, 1u32, 1u8),
    };

    if case.edit_pos != EditPosition::OtherSheet {
        seed_map.insert((target_row, target_col), case.prior.clone());
    }

    let mut sheet1_cells: Vec<CellData> = seed_map
        .into_iter()
        .map(|((r, c), v)| make_cell(0, r, c, v, None))
        .collect();

    // Dependent formula at M21 on Sheet1 (matches workbook_for_case).
    let formula_row = 20u32;
    let formula_col = 12u32;
    sheet1_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    // Sheet2/Sheet3 are used for `OtherSheet` edits and for `Sum3D`.
    let sum3d = case.shape == FormulaShape::Sum3D;
    let needs_sheet2 = sum3d || case.edit_pos == EditPosition::OtherSheet;
    let needs_sheet3 = sum3d;

    let mut sheets = vec![SheetSnapshot {
        id: SHEET1_UUID.to_string(),
        name: "Sheet1".to_string(),
        rows: 100_000,
        cols: 30,
        cells: sheet1_cells,
        ranges: vec![],
    }];
    if needs_sheet2 {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        for i in 0..10u32 {
            sheet2_cells.push(value_cell(1, i, 0, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 1, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 2, (i + 1) as f64));
        }
        if case.edit_pos == EditPosition::OtherSheet {
            sheet2_cells.push(make_cell(
                1,
                target_row,
                target_col,
                case.prior.clone(),
                None,
            ));
        }
        sheets.push(SheetSnapshot {
            id: SHEET2_UUID.to_string(),
            name: "Sheet2".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet2_cells,
            ranges: vec![],
        });
    }
    if needs_sheet3 {
        let mut sheet3_cells: Vec<CellData> = Vec::new();
        for i in 0..10u32 {
            sheet3_cells.push(value_cell(2, i, 0, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 1, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 2, (i + 1) as f64));
        }
        sheets.push(SheetSnapshot {
            id: SHEET3_UUID.to_string(),
            name: "Sheet3".to_string(),
            rows: 1_000,
            cols: 30,
            cells: sheet3_cells,
            ranges: vec![],
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets,
        ..Default::default()
    };

    let target_uuid = match target_sheet_prefix {
        1 => SHEET2_UUID,
        _ => SHEET1_UUID,
    };
    Ok((
        snapshot,
        cell_id_for(target_sheet_prefix, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
        sheet_id(target_uuid),
    ))
}

/// Build a named-range workbook: Sheet1 has the 10-row × 3-col seed
/// block plus the dependent formula at M21, and the `MyRange` named
/// range points at whichever column shape the ValueType allows. The
/// formula references `MyRange` directly (named-range resolution lives
/// in the compute-core pipeline).
///
/// This is the Track-4d minimum for the Class I NamedRange axis: drops
/// 30 of the 60 FixturePending skips. Only a subset of shapes support a
/// bare named reference; the rest route through `formula_template` with
/// `RangeType::FullCol` as a stand-in and bind `MyRange` = `A:A`.
pub(super) fn workbook_for_case_v2_named(
    case: &Class1CaseV2,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId, SheetId), CoverageReason> {
    use crate::support::fixtures::workbook_with_named_range;
    use CoverageReason::*;

    // Named-range binding: always `Sheet1!A:A` for a closed single-col
    // shape. Shapes that can't consume a single-column range are
    // reported as IncompatibleCombo.
    let formula = match case.shape {
        FormulaShape::Sumifs => r#"SUMIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Sumif => r#"SUMIF(MyRange,">0")"#.to_string(),
        FormulaShape::Countifs => r#"COUNTIFS(MyRange,">0")"#.to_string(),
        FormulaShape::Countif => r#"COUNTIF(MyRange,">0")"#.to_string(),
        FormulaShape::Averageifs => r#"AVERAGEIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Averageif => r#"AVERAGEIF(MyRange,">0")"#.to_string(),
        FormulaShape::Minifs => r#"MINIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Maxifs => r#"MAXIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Sum => "SUM(MyRange)".to_string(),
        FormulaShape::Sumproduct => "SUMPRODUCT(MyRange,MyRange)".to_string(),
        FormulaShape::Sumsq => "SUMSQ(MyRange)".to_string(),
        FormulaShape::Match => "MATCH(1,MyRange,0)".to_string(),
        FormulaShape::Xmatch => "XMATCH(1,MyRange)".to_string(),
        FormulaShape::Unique => "SUM(UNIQUE(MyRange))".to_string(),
        FormulaShape::Sort => "SUM(SORT(MyRange))".to_string(),
        FormulaShape::Filter => "FILTER(MyRange,MyRange>0)".to_string(),
        FormulaShape::IfRange => "SUM(IF(MyRange>0,MyRange,0))".to_string(),
        FormulaShape::Let => "LET(r,MyRange,SUM(r))".to_string(),
        FormulaShape::Lambda => "LAMBDA(r,SUM(r))(MyRange)".to_string(),
        FormulaShape::Transpose => "SUM(TRANSPOSE(MyRange))".to_string(),
        FormulaShape::Choose => "CHOOSE(1,SUM(MyRange),0)".to_string(),
        FormulaShape::Vlookup
        | FormulaShape::Hlookup
        | FormulaShape::Xlookup
        | FormulaShape::IndexMatch
        | FormulaShape::Indirect
        | FormulaShape::Offset
        | FormulaShape::Sortby
        | FormulaShape::Mmult
        | FormulaShape::Sum3D => {
            return Err(IncompatibleCombo(
                "named-range fixture uses single-col binding; multi-range / 3D \
                 shapes need a different binding",
            ));
        }
    };

    // Target cell position — identical rules to workbook_for_case_v2.
    let (target_row, target_col, target_sheet_prefix) = match case.edit_pos {
        EditPosition::Inside => (4u32, 0u32, 0u8), // A5 (inside MyRange=A:A)
        EditPosition::OutsideNearby => (24u32, 0u32, 0u8),
        EditPosition::FarOutside => (55_000u32, 0u32, 0u8),
        EditPosition::Boundary => (9u32, 0u32, 0u8),
        EditPosition::OtherSheet => (4u32, 1u32, 1u8),
    };

    // Extra cells: target seed + dependent formula. OtherSheet
    // edits put the target cell on Sheet2 (added below).
    let mut extra_cells = Vec::new();
    if case.edit_pos != EditPosition::OtherSheet {
        extra_cells.push(make_cell(
            0,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
    }
    let formula_row = 20u32;
    let formula_col = 12u32;
    extra_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    let mut snapshot = workbook_with_named_range("MyRange", "Sheet1!A:A", extra_cells);

    // Add Sheet2 if needed for OtherSheet edits.
    if case.edit_pos == EditPosition::OtherSheet {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        sheet2_cells.push(make_cell(
            1,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
        snapshot.sheets.push(SheetSnapshot {
            id: SHEET2_UUID.to_string(),
            name: "Sheet2".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet2_cells,
            ranges: vec![],
        });
    }

    let target_uuid = match target_sheet_prefix {
        1 => SHEET2_UUID,
        _ => SHEET1_UUID,
    };
    Ok((
        snapshot,
        cell_id_for(target_sheet_prefix, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
        sheet_id(target_uuid),
    ))
}

/// Build a structured-table workbook (`Table1[A]` binding).
///
/// Engine support for `Table1[Col]` in formulas may be incomplete; see
/// `support::fixtures::workbook_with_table` doc for the caveat. If the
/// built snapshot's formula fails to parse at `from_snapshot` time (the
/// `run_case_v2` runner catches this as a `from_snapshot` error), the
/// case is still counted as a failure — the Track-4d done-gate specifies
/// that the residue must either be 0 or be explicit structured-table
/// breakage (documented in the handoff).
pub(super) fn workbook_for_case_v2_table(
    case: &Class1CaseV2,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId, SheetId), CoverageReason> {
    use crate::support::fixtures::workbook_with_table;
    use CoverageReason::*;

    // Only a subset of shapes consume a single structured-column reference.
    let formula = match case.shape {
        FormulaShape::Sum => "SUM(Table1[A])".to_string(),
        FormulaShape::Sumifs => r#"SUMIFS(Table1[A],Table1[A],">0")"#.to_string(),
        FormulaShape::Sumif => r#"SUMIF(Table1[A],">0")"#.to_string(),
        FormulaShape::Countifs => r#"COUNTIFS(Table1[A],">0")"#.to_string(),
        FormulaShape::Countif => r#"COUNTIF(Table1[A],">0")"#.to_string(),
        FormulaShape::Averageifs => r#"AVERAGEIFS(Table1[A],Table1[A],">0")"#.to_string(),
        FormulaShape::Averageif => r#"AVERAGEIF(Table1[A],">0")"#.to_string(),
        FormulaShape::Sumsq => "SUMSQ(Table1[A])".to_string(),
        _ => {
            return Err(FixturePending(
                "structured-table binding: only aggregate shapes supported in this fixture",
            ));
        }
    };

    // Target cell position. Table1 lives at A1:C4 (header + 3 data rows).
    // `Boundary` targets the last data row (row 3); `Inside` targets row
    // 1 (first data row); `OutsideNearby` targets row 10 (just past); etc.
    let (target_row, target_col, target_sheet_prefix) = match case.edit_pos {
        EditPosition::Inside => (1u32, 0u32, 0u8),
        EditPosition::OutsideNearby => (10u32, 0u32, 0u8),
        EditPosition::FarOutside => (55_000u32, 0u32, 0u8),
        EditPosition::Boundary => (3u32, 0u32, 0u8),
        EditPosition::OtherSheet => (4u32, 1u32, 1u8),
    };

    let mut extra_cells = Vec::new();
    if case.edit_pos != EditPosition::OtherSheet {
        // Override the table's default seed with the requested prior.
        extra_cells.push(make_cell(
            0,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
    }
    let formula_row = 20u32;
    let formula_col = 12u32;
    extra_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    let mut snapshot = workbook_with_table("Table1", &["A", "B", "C"], 3, extra_cells);

    if case.edit_pos == EditPosition::OtherSheet {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        sheet2_cells.push(make_cell(
            1,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
        snapshot.sheets.push(SheetSnapshot {
            id: SHEET2_UUID.to_string(),
            name: "Sheet2".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet2_cells,
            ranges: vec![],
        });
    }

    let target_uuid = match target_sheet_prefix {
        1 => SHEET2_UUID,
        _ => SHEET1_UUID,
    };
    Ok((
        snapshot,
        cell_id_for(target_sheet_prefix, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
        sheet_id(target_uuid),
    ))
}
