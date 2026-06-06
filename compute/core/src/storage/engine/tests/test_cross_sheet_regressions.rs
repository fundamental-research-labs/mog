use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::{CellId, SheetId};
use compute_document::hex::hex_to_id;
use formula_types::StructureChange;
use value_types::{CellValue, FiniteF64};

const SHEET1_ID: &str = "00000000-0000-0000-0000-000000010001";
const SHEET2_ID: &str = "00000000-0000-0000-0000-000000010002";
const SHEET1_A1_ID: &str = "00000000-0000-0000-0000-000000010101";
const SHEET1_A2_ID: &str = "00000000-0000-0000-0000-000000010102";
const SHEET2_A1_ID: &str = "00000000-0000-0000-0000-000000020101";
const SHEET2_A2_ID: &str = "00000000-0000-0000-0000-000000020102";

fn sid(raw: &str) -> SheetId {
    SheetId::from_uuid_str(raw).unwrap()
}

fn cid(raw: &str) -> CellId {
    CellId::from_uuid_str(raw).unwrap()
}

fn text(value: &str) -> CellValue {
    CellValue::Text(value.into())
}

fn cross_sheet_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_ID.to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: SHEET1_A1_ID.to_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::Null,
                        formula: Some("=Sheet2!A2".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: SHEET1_A2_ID.to_string(),
                        row: 1,
                        col: 0,
                        value: CellValue::Null,
                        formula: Some("=Sheet2!A1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_ID.to_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: SHEET2_A1_ID.to_string(),
                        row: 0,
                        col: 0,
                        value: text("Sheet2Data"),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: SHEET2_A2_ID.to_string(),
                        row: 1,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(99.0)),
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
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

#[test]
fn cross_sheet_structural_formula_writeback_survives_undo_redo() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(cross_sheet_snapshot()).unwrap();
    let sheet1 = sid(SHEET1_ID);
    let sheet2 = sid(SHEET2_ID);
    let sheet1_a1 = cid(SHEET1_A1_ID);

    assert_eq!(
        engine.get_formula(&sheet1_a1).as_deref(),
        Some("=Sheet2!A2")
    );
    assert_eq!(
        cell_value_at(&engine, &sheet1, 0, 0),
        CellValue::Number(FiniteF64::must(99.0))
    );

    let insert = StructureChange::InsertRows {
        at: 1,
        count: 1,
        new_row_ids: vec![],
    };
    engine
        .structure_change(&sheet2, &insert)
        .expect("insert row on referenced sheet");

    assert_eq!(
        engine.get_formula(&sheet1_a1).as_deref(),
        Some("=Sheet2!A3")
    );
    assert_eq!(
        cell_value_at(&engine, &sheet1, 0, 0),
        CellValue::Number(FiniteF64::must(99.0))
    );

    engine.undo().expect("undo insert row");
    assert_eq!(
        engine.get_formula(&sheet1_a1).as_deref(),
        Some("=Sheet2!A2")
    );
    assert_eq!(
        cell_value_at(&engine, &sheet1, 0, 0),
        CellValue::Number(FiniteF64::must(99.0))
    );

    engine.redo().expect("redo insert row");
    assert_eq!(
        engine.get_formula(&sheet1_a1).as_deref(),
        Some("=Sheet2!A3")
    );
    assert_eq!(
        cell_value_at(&engine, &sheet1, 0, 0),
        CellValue::Number(FiniteF64::must(99.0))
    );
}

#[test]
fn copy_sheet_preserves_existing_cross_sheet_dependency_edges() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(cross_sheet_snapshot()).unwrap();
    let sheet1 = sid(SHEET1_ID);
    let sheet2 = sid(SHEET2_ID);

    let (copy_hex, _) = engine.copy_sheet(&sheet1, "Sheet1 (2)").unwrap();
    let copy_sheet = SheetId::from_raw(hex_to_id(&copy_hex).expect("copy sheet hex"));
    engine
        .recalculate()
        .expect("bridge recalc after copied sheet registration");

    let copy_a2 = engine.query_range(&copy_sheet, 1, 0, 1, 0);
    let copy_a2 = copy_a2.cells.first().expect("copied A2 formula cell");
    assert_eq!(copy_a2.formula.as_deref(), Some("=Sheet2!A1"));
    assert_eq!(copy_a2.value, text("Sheet2Data"));

    engine
        .set_cell_value_parsed(&sheet2, 0, 0, "UpdatedSheet2Data")
        .expect("edit referenced Sheet2 A1");

    assert_eq!(
        cell_value_at(&engine, &sheet1, 1, 0),
        text("UpdatedSheet2Data"),
        "original Sheet1 formula must remain a dependent after copy_sheet"
    );
    assert_eq!(
        cell_value_at(&engine, &copy_sheet, 1, 0),
        text("UpdatedSheet2Data"),
        "copied sheet formula must also depend on Sheet2 A1"
    );
}
