use super::super::*;
use super::helpers::cell_value_at;
use crate::scheduler::ComputeCore;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::{CellId, SheetId};
use formula_types::StructureChange;
use value_types::{CellError, CellValue, FiniteF64};

const SHEET_ID: &str = "00000000-0000-0000-0000-000000030001";
const A1_ID: &str = "00000000-0000-0000-0000-000000030101";
const B1_ID: &str = "00000000-0000-0000-0000-000000030102";
const C1_ID: &str = "00000000-0000-0000-0000-000000030103";
const D1_ID: &str = "00000000-0000-0000-0000-000000030104";
const A2_ID: &str = "00000000-0000-0000-0000-000000030201";
const A3_ID: &str = "00000000-0000-0000-0000-000000030301";
const A4_ID: &str = "00000000-0000-0000-0000-000000030401";

fn sid() -> SheetId {
    SheetId::from_uuid_str(SHEET_ID).unwrap()
}

fn cid(raw: &str) -> CellId {
    CellId::from_uuid_str(raw).unwrap()
}

fn cell(id: &str, row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellData {
    CellData {
        cell_id: id.to_string(),
        row,
        col,
        value,
        formula: formula.map(str::to_string),
        identity_formula: None,
        array_ref: None,
    }
}

fn workbook(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_ID.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 20,
            cells,
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
    }
}

fn install_minimal_compute(engine: &mut YrsComputeEngine, snapshot: WorkbookSnapshot) {
    let mut compute = ComputeCore::new();
    compute.set_id_alloc(engine.stores.grid_id_alloc.clone());
    compute
        .init_from_snapshot_minimal(&mut engine.mirror, snapshot)
        .expect("minimal init should succeed");
    engine.stores.compute = compute;
}

#[test]
fn delete_column_builds_deferred_graph_before_invalidating_imported_refs() {
    let snapshot = workbook(vec![
        cell(
            A1_ID,
            0,
            0,
            CellValue::Number(FiniteF64::must(300.0)),
            Some("=B1+C1"),
        ),
        cell(B1_ID, 0, 1, CellValue::Number(FiniteF64::must(100.0)), None),
        cell(C1_ID, 0, 2, CellValue::Number(FiniteF64::must(200.0)), None),
        cell(
            D1_ID,
            0,
            3,
            CellValue::Number(FiniteF64::must(600.0)),
            Some("=A1*2"),
        ),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot.clone()).unwrap();
    install_minimal_compute(&mut engine, snapshot);

    let sheet = sid();
    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteCols {
                at: 1,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete column");

    assert_eq!(
        engine.get_formula(&cid(A1_ID)).as_deref(),
        Some("=#REF!+B1")
    );
    assert!(
        matches!(
            cell_value_at(&engine, &sheet, 0, 0),
            CellValue::Error(CellError::Ref, _)
        ),
        "A1 should become #REF! after deleting referenced column B"
    );
    assert!(
        matches!(
            cell_value_at(&engine, &sheet, 0, 2),
            CellValue::Error(CellError::Ref, _)
        ),
        "old D1 should shift to C1 and propagate A1's #REF!"
    );
}

#[test]
fn delete_row_builds_deferred_graph_before_invalidating_imported_refs() {
    let snapshot = workbook(vec![
        cell(
            A1_ID,
            0,
            0,
            CellValue::Number(FiniteF64::must(300.0)),
            Some("=A2+A3"),
        ),
        cell(A2_ID, 1, 0, CellValue::Number(FiniteF64::must(100.0)), None),
        cell(A3_ID, 2, 0, CellValue::Number(FiniteF64::must(200.0)), None),
        cell(
            A4_ID,
            3,
            0,
            CellValue::Number(FiniteF64::must(600.0)),
            Some("=A1*2"),
        ),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot.clone()).unwrap();
    install_minimal_compute(&mut engine, snapshot);

    let sheet = sid();
    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteRows {
                at: 1,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete row");

    assert_eq!(
        engine.get_formula(&cid(A1_ID)).as_deref(),
        Some("=#REF!+A2")
    );
    assert!(
        matches!(
            cell_value_at(&engine, &sheet, 0, 0),
            CellValue::Error(CellError::Ref, _)
        ),
        "A1 should become #REF! after deleting referenced row 2"
    );
    assert!(
        matches!(
            cell_value_at(&engine, &sheet, 2, 0),
            CellValue::Error(CellError::Ref, _)
        ),
        "old A4 should shift to A3 and propagate A1's #REF!"
    );
}
