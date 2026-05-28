use super::support::{as_f64, cell_at, formula_cell, sheet_id, sheet_snap, value_cell};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;

#[test]
fn lifecycle_col_data_partial_invariant() {
    let snap = WorkbookSnapshot {
        sheets: vec![sheet_snap(
            0,
            "Sparse",
            vec![
                value_cell(0, 0, 0, 1.0),
                value_cell(0, 5, 0, 6.0),
                value_cell(0, 9, 0, 10.0),
                formula_cell(0, 0, 1, "SUM(A1:A10)"),
            ],
        )],
        ..Default::default()
    };

    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    assert_eq!(as_f64(&cell_at(&engine, &sid, 0, 0)), 1.0);
    let empty = cell_at(&engine, &sid, 1, 0);
    assert!(
        empty.is_null(),
        "un-populated row 1 should be Null, got {:?}",
        empty
    );
    assert_eq!(as_f64(&cell_at(&engine, &sid, 5, 0)), 6.0);
    assert_eq!(as_f64(&cell_at(&engine, &sid, 9, 0)), 10.0);

    let sum = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&sum) - 17.0).abs() < 1e-9,
        "SUM of sparse column should be 17, got {:?}",
        sum
    );

    let sheet = engine.mirror().get_sheet(&sid).expect("sheet mirror");
    if let Some(col_slice) = sheet.get_column_slice(0) {
        assert!(
            col_slice.len() >= 10,
            "col_data for column A should cover at least rows 0-9, got len {}",
            col_slice.len()
        );
        assert_eq!(as_f64(&col_slice[0]), 1.0, "col_data[0] should be 1.0");
        assert_eq!(as_f64(&col_slice[5]), 6.0, "col_data[5] should be 6.0");
        assert_eq!(as_f64(&col_slice[9]), 10.0, "col_data[9] should be 10.0");
        assert!(col_slice[1].is_null(), "col_data[1] should be Null");
    }
}
