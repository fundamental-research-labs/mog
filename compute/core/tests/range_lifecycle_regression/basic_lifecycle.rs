use super::support::{
    as_f64, assert_number_at, assert_sum_at, cell_at, cell_id, sheet_id, workbook_10_rows,
};
use compute_core::storage::engine::YrsComputeEngine;
use value_types::{CellValue, FiniteF64};

#[test]
fn lifecycle_import_cold_load_read() {
    let snap = workbook_10_rows();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    for r in 0..10u32 {
        assert_number_at(
            &engine,
            &sid,
            r,
            0,
            (r + 1) as f64,
            "cold-load source value",
        );
    }

    assert_sum_at(&engine, &sid, 0, 1, 55.0, "cold-load SUM(A1:A10)");

    let sheet = engine.mirror().get_sheet(&sid).expect("sheet mirror");
    if let Some(col_slice) = sheet.get_column_slice(0) {
        assert!(
            col_slice.len() >= 10,
            "col_data for column A should have at least 10 entries"
        );
        for r in 0..10usize {
            assert_eq!(
                as_f64(&col_slice[r]),
                (r + 1) as f64,
                "col_data[0][{}] mismatch",
                r
            );
        }
    }
    // Snapshot-loaded data may not always populate col_data; get_cell_value_at
    // is still the required read path for correctness.
}

#[test]
fn lifecycle_edit_cell_recalc() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);
    let a1 = cell_id(0, 0, 0);

    assert_sum_at(&engine, &sid, 0, 1, 55.0, "pre-edit SUM");

    engine
        .set_cell(&sid, a1, 0, 0, "100".into())
        .expect("set_cell");

    assert_sum_at(&engine, &sid, 0, 1, 154.0, "post-edit SUM");
}

#[test]
fn lifecycle_import_values_roundtrip() {
    let snap = workbook_10_rows();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    let new_values: Vec<(u32, u32, CellValue, Option<String>)> = (0..5u32)
        .map(|r| {
            (
                r,
                0,
                CellValue::Number(FiniteF64::must((r + 1) as f64 * 100.0)),
                None,
            )
        })
        .collect();
    engine
        .import_values(&sid, new_values)
        .expect("import_values");

    for r in 0..5u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64 * 100.0,
            "after import_values, row {} should be {}",
            r,
            (r + 1) as f64 * 100.0
        );
    }

    for r in 5..10u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(as_f64(&v), (r + 1) as f64, "row {} should be unchanged", r);
    }

    assert_sum_at(&engine, &sid, 0, 1, 1540.0, "import_values SUM");
}
