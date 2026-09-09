use super::support::{
    as_f64, cell_at, cell_id, formula_cell, range_backed_workbook, sheet_id, sheet_snap, value_cell,
};
use cell_types::SheetPos;
use compute_core::storage::engine::ComputeEngine;
use formula_types::StructureChange;
use snapshot_types::WorkbookSnapshot;

fn assert_results(engine: &ComputeEngine, sum: f64, middle: f64, combined: f64) {
    let sheet = sheet_id(0);
    assert_eq!(as_f64(&cell_at(engine, &sheet, 0, 1)), sum);
    assert_eq!(as_f64(&cell_at(engine, &sheet, 0, 2)), middle);
    assert_eq!(as_f64(&cell_at(engine, &sheet, 0, 3)), combined);
}

fn formulas() -> Vec<snapshot_types::CellData> {
    vec![
        formula_cell(0, 0, 1, "SUM(A1:A5)"),
        formula_cell(0, 0, 2, "INDEX(A1:A5,3)"),
        formula_cell(0, 0, 3, "SUM(A1:A5)+INDEX(A1:A5,3)"),
    ]
}

#[test]
fn aggregate_and_array_consumers_recalculate_after_formula_and_value_edits() {
    let mut cells = formulas();
    cells.extend((0..5).map(|row| value_cell(0, row, 0, (row + 1) as f64)));
    let snapshot = WorkbookSnapshot {
        sheets: vec![sheet_snap(0, "Data", cells)],
        ..Default::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet = sheet_id(0);
    assert_results(&engine, 15.0, 3.0, 18.0);

    // A formula inside the shared range adds an earlier topological level.
    // The aggregate and the eager array consumer must both see its new value.
    engine
        .set_cell(&sheet, cell_id(0, 2, 0), 2, 0, "=A1*10".into())
        .unwrap();
    assert_results(&engine, 22.0, 10.0, 32.0);
    engine
        .set_cell(&sheet, cell_id(0, 0, 0), 0, 0, "2".into())
        .unwrap();
    assert_results(&engine, 33.0, 20.0, 53.0);

    // Switching a cell between a direct aggregate and an array consumer
    // refreshes its eager requirements as well as its dependencies.
    engine
        .set_cell(&sheet, cell_id(0, 0, 1), 0, 1, "=INDEX(A1:A5,3)".into())
        .unwrap();
    assert_results(&engine, 20.0, 20.0, 53.0);
    engine
        .set_cell(&sheet, cell_id(0, 0, 1), 0, 1, "=SUM(A1:A5)".into())
        .unwrap();
    assert_results(&engine, 33.0, 20.0, 53.0);
}

#[test]
fn aggregate_and_array_consumers_follow_imported_overrides_and_structure() {
    let snapshot = range_backed_workbook(10, 5, 5, 1, |row, _| (row + 1) as f64, formulas());
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet = sheet_id(0);
    assert_results(&engine, 15.0, 3.0, 18.0);

    let edited = engine
        .cell_store()
        .resolve_cell_id(&sheet, SheetPos::new(2, 0))
        .unwrap();
    engine.set_cell(&sheet, edited, 2, 0, "30".into()).unwrap();
    assert_results(&engine, 42.0, 30.0, 72.0);

    engine
        .structure_change(
            &sheet,
            &StructureChange::InsertRows {
                at: 1,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    // SUM expands with the range; INDEX still reads its third current row.
    assert_results(&engine, 42.0, 2.0, 44.0);

    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteRows {
                at: 2,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    assert_results(&engine, 40.0, 30.0, 70.0);
}
