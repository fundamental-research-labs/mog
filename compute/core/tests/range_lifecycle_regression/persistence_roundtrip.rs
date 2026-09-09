use super::support::{as_f64, cell_at, sheet_id, workbook_10_rows};
use compute_core::storage::engine::ComputeEngine;

#[test]
fn lifecycle_xlsx_export_reimport() {
    let (engine, _) = ComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");

    let xlsx_bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    assert!(
        !xlsx_bytes.is_empty(),
        "export should produce non-empty bytes"
    );

    let (engine2, _) = ComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");

    let sid2 = *engine2
        .cell_store()
        .sheet_ids()
        .next()
        .expect("at least one sheet");

    for r in 0..10u32 {
        let v = cell_at(&engine2, &sid2, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64,
            "reimported row {} should be {}",
            r,
            r + 1
        );
    }

    let sum = cell_at(&engine2, &sid2, 0, 1);
    assert!(
        (as_f64(&sum) - 55.0).abs() < 1e-9,
        "reimported SUM should be 55, got {:?}",
        sum
    );
}
