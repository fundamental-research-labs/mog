//! Group 17: CopyRange all variants.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use crate::storage::engine::mutation::CellInput;
use formula_types::StructureChange;
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Test: CopyRange -- copy values only
// -------------------------------------------------------------------

#[test]
fn test_copy_range_values_only() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Copy A1:B1 (10, 20) to A5:B5 as values only
    let output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 1,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 0,
            copy_type: domain_types::CopyType::Values,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    // Verify target cells have the copied values
    let a5 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 0))
        .cloned();
    let b5 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 1))
        .cloned();
    assert_eq!(
        a5.unwrap(),
        CellValue::Number(FiniteF64::must(10.0)),
        "A5 should be 10 (copied from A1)"
    );
    assert_eq!(
        b5.unwrap(),
        CellValue::Number(FiniteF64::must(20.0)),
        "B5 should be 20 (copied from B1)"
    );

    // Source cells should be unchanged
    let a1 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(0, 0))
        .cloned();
    assert_eq!(
        a1.unwrap(),
        CellValue::Number(FiniteF64::must(10.0)),
        "A1 should still be 10 (source preserved)"
    );
}

// -------------------------------------------------------------------
// Test: CopyRange -- copy formulas with reference adjustment
// -------------------------------------------------------------------

#[test]
fn test_copy_range_formulas() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Verify C1 = A1+B1 = 30
    let c1_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(0, 2))
        .cloned();
    assert_eq!(
        c1_val.unwrap(),
        CellValue::Number(FiniteF64::must(30.0)),
        "C1 should be 30 (=A1+B1)"
    );

    // Copy C1 (formula =A1+B1) to C2 -- should adjust to =A2+B2
    let _output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 2,
            src_end_row: 0,
            src_end_col: 2,
            target_sheet_id: sid,
            target_row: 1,
            target_col: 2,
            copy_type: domain_types::CopyType::Formulas,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    // C2 should have value =A2+B2 = 30+40 = 70
    let c2_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(1, 2))
        .cloned();
    assert_eq!(
        c2_val.unwrap(),
        CellValue::Number(FiniteF64::must(70.0)),
        "C2 should be 70 (=A2+B2, adjusted from =A1+B1)"
    );
}

#[test]
fn copy_range_rebases_formula_after_column_insert() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 40,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440026".to_string(),
                    row: 20,
                    col: 26,
                    value: CellValue::Number(FiniteF64::must(6058.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440027".to_string(),
                    row: 20,
                    col: 27,
                    value: CellValue::Number(FiniteF64::must(6732.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440028".to_string(),
                    row: 20,
                    col: 28,
                    value: CellValue::Number(FiniteF64::must(7509.0)),
                    formula: Some("=14241-AB21".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 27,
                count: 1,
                new_col_ids: vec![],
            },
        )
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sid, 20, 29).as_deref(),
        Some("=14241-AC21"),
        "structural insert should shift the source formula from AC21 to AD21"
    );

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 20,
            src_start_col: 29,
            src_end_row: 20,
            src_end_col: 29,
            target_sheet_id: sid,
            target_row: 20,
            target_col: 27,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sid, 20, 27).as_deref(),
        Some("=14241-AA21"),
        "copying AD21 two columns left into AB21 must rebase the relative AC21 reference"
    );
}

// -------------------------------------------------------------------
// Test: CopyRange -- copy values only from formula cell
// -------------------------------------------------------------------

#[test]
fn test_copy_range_values_from_formula_cell() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Copy C1 (formula =A1+B1, value=30) to D1 as values only
    let _output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 2,
            src_end_row: 0,
            src_end_col: 2,
            target_sheet_id: sid,
            target_row: 0,
            target_col: 3,
            copy_type: domain_types::CopyType::Values,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    // D1 should have the computed value 30 (not the formula)
    let d1_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(0, 3))
        .cloned();
    assert_eq!(
        d1_val.unwrap(),
        CellValue::Number(FiniteF64::must(30.0)),
        "D1 should be 30 (value copied, not formula)"
    );
}

// -------------------------------------------------------------------
// Test: CopyRange -- skipBlanks behavior
// -------------------------------------------------------------------

#[test]
fn test_copy_range_skip_blanks() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // First, set up target: D5=999
    let grid = engine.stores.grid_indexes.get_mut(&sid).unwrap();
    let d5_cell_id = grid.ensure_cell_id(4, 3);
    engine
        .set_cell(
            &sid,
            d5_cell_id,
            4,
            3,
            crate::bridge_types::CellInput::Parse { text: "999".into() },
        )
        .unwrap();

    // Verify D5 = 999
    let d5_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 3))
        .cloned();
    assert_eq!(d5_val.unwrap(), CellValue::Number(FiniteF64::must(999.0)));

    // Copy a blank cell (D1, which is empty) to D5 with skip_blanks=false.
    // Blank sources should overwrite existing target values.
    let _output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 3,
            src_end_row: 0,
            src_end_col: 3,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 3,
            copy_type: domain_types::CopyType::Values,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    let d5_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 3))
        .cloned()
        .unwrap_or(CellValue::Null);
    assert_eq!(
        d5_val,
        CellValue::Null,
        "D5 should be cleared when skip_blanks=false"
    );

    engine
        .set_cell(
            &sid,
            d5_cell_id,
            4,
            3,
            crate::bridge_types::CellInput::Parse { text: "999".into() },
        )
        .unwrap();

    // Now copy a blank cell (D1, which is empty) to D5 with skip_blanks=true
    let _output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 3,
            src_end_row: 0,
            src_end_col: 3,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 3,
            copy_type: domain_types::CopyType::Values,
            skip_blanks: true,
            transpose: false,
        })
        .unwrap();

    // D5 should still be 999 because source was blank and skip_blanks=true
    let d5_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 3))
        .cloned();
    assert_eq!(
        d5_val.unwrap(),
        CellValue::Number(FiniteF64::must(999.0)),
        "D5 should still be 999 (skip_blanks preserved target)"
    );
}

// -------------------------------------------------------------------
// Test: CopyRange -- transpose behavior
// -------------------------------------------------------------------

#[test]
fn test_copy_range_transpose() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Copy A1:B2 (2 rows x 2 cols) to E1 with transpose
    // Source: A1=10, B1=20
    //         A2=30, B2=40
    // Target (transposed): E1=10, F1=30
    //                       E2=20, F2=40
    let _output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 1,
            src_end_col: 1,
            target_sheet_id: sid,
            target_row: 0,
            target_col: 4,
            copy_type: domain_types::CopyType::Values,
            skip_blanks: false,
            transpose: true,
        })
        .unwrap();

    // E1 should be 10 (from A1, offset (0,0) -> transpose -> (0,0))
    let e1 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(0, 4))
        .cloned();
    assert_eq!(
        e1.unwrap(),
        CellValue::Number(FiniteF64::must(10.0)),
        "E1 should be 10 (A1 transposed)"
    );

    // F1 should be 30 (from A2, offset (1,0) -> transpose -> (0,1))
    let f1 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(0, 5))
        .cloned();
    assert_eq!(
        f1.unwrap(),
        CellValue::Number(FiniteF64::must(30.0)),
        "F1 should be 30 (A2 transposed to col)"
    );

    // E2 should be 20 (from B1, offset (0,1) -> transpose -> (1,0))
    let e2 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(1, 4))
        .cloned();
    assert_eq!(
        e2.unwrap(),
        CellValue::Number(FiniteF64::must(20.0)),
        "E2 should be 20 (B1 transposed to row)"
    );

    // F2 should be 40 (from B2, offset (1,1) -> transpose -> (1,1))
    let f2 = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(1, 5))
        .cloned();
    assert_eq!(
        f2.unwrap(),
        CellValue::Number(FiniteF64::must(40.0)),
        "F2 should be 40 (B2 transposed)"
    );
}

// -------------------------------------------------------------------
// Test: CopyRange -- cross-sheet naked-ref rebinding (Excel parity)
// -------------------------------------------------------------------

/// Builds a 3-sheet snapshot:
/// Sheet1: A1=10, B1=20, C1=`=A1+B1` (naked refs), D1=`=Sheet3!A1` (cross-sheet
///   qualified ref to a *different* sheet — should preserve the qualifier).
/// Sheet2: empty (paste target).
/// Sheet3: A1=77 (referenced from Sheet1!D1).
///
/// Note: we use `Sheet3!A1` rather than `Sheet1!A1` for the qualified case
/// because our identity model collapses `=A1` and `=Sheet1!A1` into the same
/// `IdentityFormula` at hydration — once two formulas point to the same
/// `CellId`, the original textual distinction is lost. The round-trip
/// pipeline correctly preserves *genuinely* cross-sheet qualifiers (refs
/// pointing to a sheet other than the formula's owner).
fn cross_sheet_copy_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(10.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                        row: 0,
                        col: 1,
                        value: CellValue::Number(FiniteF64::must(20.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    // C1: naked refs — must rebind to Sheet2 on cross-sheet paste.
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                        row: 0,
                        col: 2,
                        value: CellValue::Number(FiniteF64::must(0.0)),
                        formula: Some("=A1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    // D1: cross-sheet qualified ref to Sheet3 — must keep its
                    // qualifier on paste (the cell genuinely lives on Sheet3,
                    // so render emits `Sheet3!A1` regardless of which sheet
                    // owns the formula).
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
                        row: 0,
                        col: 3,
                        value: CellValue::Number(FiniteF64::must(0.0)),
                        formula: Some("=Sheet3!A1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440099".to_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440077".to_string(),
                name: "Sheet3".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440007".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(77.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Read the rendered A1 formula at (sheet, row, col), with naked-vs-qualified
/// disambiguation against `display_sheet` (i.e. refs on `display_sheet` come
/// out unqualified; refs elsewhere keep their explicit prefix).
fn formula_at(
    engine: &YrsComputeEngine,
    sheet: &SheetId,
    display_sheet: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let sm = engine.mirror().get_sheet(sheet)?;
    let cell_id = sm.cell_id_at(SheetPos::new(row, col))?;
    let entry = sm.get_cell(&cell_id)?;
    let formula = entry.formula.as_ref()?;
    Some(engine.to_a1_display(display_sheet, formula))
}

fn formula_text_at(
    engine: &YrsComputeEngine,
    sheet: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let cell_id = engine
        .mirror()
        .get_sheet(sheet)?
        .cell_id_at(SheetPos::new(row, col))?;
    engine.get_formula(&cell_id)
}

#[test]
fn test_copy_range_cross_sheet_rebinds_naked_refs() {
    let snap = cross_sheet_copy_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sheet1 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let sheet2 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap();

    // Pre-condition: Sheet1!C1 renders as `=A1+B1` against Sheet1, and
    // Sheet1!D1 renders as `=Sheet3!A1` (cross-sheet qualifier preserved).
    let c1_pre = formula_at(&engine, &sheet1, &sheet1, 0, 2);
    assert_eq!(c1_pre.as_deref(), Some("=A1+B1"), "Sheet1!C1 baseline");
    let d1_pre = formula_at(&engine, &sheet1, &sheet1, 0, 3);
    assert_eq!(
        d1_pre.as_deref(),
        Some("=Sheet3!A1"),
        "Sheet1!D1 baseline must show cross-sheet qualifier"
    );

    // Copy Sheet1!C1:D1 → Sheet2!C1:D1.
    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sheet1,
            src_start_row: 0,
            src_start_col: 2,
            src_end_row: 0,
            src_end_col: 3,
            target_sheet_id: sheet2,
            target_row: 0,
            target_col: 2,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    // Sheet1 sources unchanged.
    let c1_post = formula_at(&engine, &sheet1, &sheet1, 0, 2);
    assert_eq!(
        c1_post.as_deref(),
        Some("=A1+B1"),
        "Sheet1!C1 source formula must be preserved after copy"
    );

    // Sheet2!C1 — naked refs must rebind to Sheet2 (Excel parity). Render
    // against Sheet2: refs on Sheet2 emit unqualified.
    let c1_target = formula_at(&engine, &sheet2, &sheet2, 0, 2);
    assert_eq!(
        c1_target.as_deref(),
        Some("=A1+B1"),
        "Sheet2!C1 must rebind naked A1+B1 to Sheet2 (no `Sheet1!` prefix)"
    );

    // Sheet2!D1 — cross-sheet qualified `Sheet3!A1` must keep its qualifier.
    let d1_target = formula_at(&engine, &sheet2, &sheet2, 0, 3);
    assert_eq!(
        d1_target.as_deref(),
        Some("=Sheet3!A1"),
        "Sheet2!D1 must preserve the cross-sheet Sheet3! qualifier"
    );

    // Computed value: Sheet2!C1 = Sheet2!A1 + Sheet2!B1. Both are empty/Null,
    // so the result is 0 (numeric coercion of empty operands in arithmetic).
    let c1_value = engine
        .mirror()
        .get_cell_value_at(&sheet2, SheetPos::new(0, 2))
        .cloned()
        .unwrap_or(CellValue::Null);
    assert_eq!(
        c1_value,
        CellValue::Number(FiniteF64::must(0.0)),
        "Sheet2!C1 should evaluate against Sheet2's (empty) A1+B1 = 0"
    );

    // Sheet2!D1 = Sheet3!A1 = 77 (the qualifier still points to Sheet3).
    let d1_value = engine
        .mirror()
        .get_cell_value_at(&sheet2, SheetPos::new(0, 3))
        .cloned()
        .unwrap_or(CellValue::Null);
    assert_eq!(
        d1_value,
        CellValue::Number(FiniteF64::must(77.0)),
        "Sheet2!D1 should still resolve Sheet3!A1 = 77"
    );
}

#[test]
fn test_copy_range_cross_sheet_preserves_explicit_target_sheet_ref_text() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Sheet2Data".into()),
                    formula: Some("=Sheet2!A1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440099".to_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Sheet2Data".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sheet1 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let sheet2 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap();

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sheet1,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 0,
            target_sheet_id: sheet2,
            target_row: 0,
            target_col: 1,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet2, 0, 1).as_deref(),
        Some("=Sheet2!A1"),
        "cross-sheet copy to Sheet2 must keep the authored Sheet2! prefix"
    );
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet2, SheetPos::new(0, 1))
            .cloned(),
        Some(CellValue::Text("Sheet2Data".into())),
        "Sheet2!B1 should evaluate through the preserved Sheet2!A1 reference"
    );

    engine
        .apply_mutation(EngineMutation::SetCellsByPosition {
            edits: vec![(
                sheet2,
                0,
                0,
                CellInput::Parse {
                    text: "ChangedSheet2Data".to_string(),
                },
            )],
            skip_cycle_check: false,
        })
        .unwrap();

    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet2, SheetPos::new(0, 1))
            .cloned(),
        Some(CellValue::Text("ChangedSheet2Data".into())),
        "Sheet2!B1 should remain a live formula after Sheet2!A1 changes"
    );
    assert_eq!(
        formula_text_at(&engine, &sheet2, 0, 1).as_deref(),
        Some("=Sheet2!A1")
    );
}

#[test]
fn test_copy_range_cross_sheet_preserves_explicit_source_sheet_ref_after_formula_cache_refresh() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(5.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                        row: 1,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(7.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440005".to_string(),
                        row: 0,
                        col: 4,
                        value: CellValue::Number(FiniteF64::must(12.0)),
                        formula: Some("=Sheet1!A1+Sheet1!A2".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440099".to_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440101".to_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(100.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440102".to_string(),
                        row: 1,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(200.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sheet1 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let sheet2 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet1, 0, 4).as_deref(),
        Some("=Sheet1!A1+Sheet1!A2"),
        "authored same-sheet qualifiers are part of the copy contract"
    );

    engine.with_internals_for_test(|stores, mirror, _mutation| {
        stores.compute.regenerate_formula_strings(mirror);
    });

    assert_eq!(
        formula_text_at(&engine, &sheet1, 0, 4).as_deref(),
        Some("=Sheet1!A1+Sheet1!A2"),
        "a non-structural formula-cache refresh must not collapse authored Sheet1! refs"
    );

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sheet1,
            src_start_row: 0,
            src_start_col: 4,
            src_end_row: 0,
            src_end_col: 4,
            target_sheet_id: sheet2,
            target_row: 0,
            target_col: 4,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet2, 0, 4).as_deref(),
        Some("=Sheet1!A1+Sheet1!A2"),
        "cross-sheet copy must preserve explicitly authored source-sheet refs"
    );
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet2, SheetPos::new(0, 4))
            .cloned(),
        Some(CellValue::Number(FiniteF64::must(12.0))),
        "Sheet2!E1 should evaluate through Sheet1!A1+Sheet1!A2, not Sheet2 A1+A2"
    );
}
