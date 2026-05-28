use super::support::{as_f64, cell_at, range_backed_workbook, sheet_id};
use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use formula_types::StructureChange;

#[test]
fn lifecycle_compaction() {
    let snap = range_backed_workbook(10, 5, 4, 1, |r, _| (r + 1) as f64, vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    for r in 0..4u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64,
            "pre-compaction row {} should be {}",
            r,
            r + 1
        );
    }

    let cid_r0 = engine
        .mirror()
        .resolve_cell_id(&sid, SheetPos::new(0, 0))
        .expect("CellId at (0,0)");
    let cid_r2 = engine
        .mirror()
        .resolve_cell_id(&sid, SheetPos::new(2, 0))
        .expect("CellId at (2,0)");

    engine
        .set_cell(&sid, cid_r0, 0, 0, "100".into())
        .expect("set_cell A1");
    engine
        .set_cell(&sid, cid_r2, 2, 0, "300".into())
        .expect("set_cell A3");

    let expected = [100.0, 2.0, 300.0, 4.0];
    for r in 0..4u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(
            as_f64(&v),
            expected[r as usize],
            "post-compaction row {} should be {}",
            r,
            expected[r as usize]
        );
    }

    let pos_r0 = engine.mirror().resolve_position(&cid_r0);
    assert_eq!(
        pos_r0.map(|p| p.row()),
        Some(0),
        "CellId at row 0 should still resolve to row 0 after compaction"
    );
    let pos_r2 = engine.mirror().resolve_position(&cid_r2);
    assert_eq!(
        pos_r2.map(|p| p.row()),
        Some(2),
        "CellId at row 2 should still resolve to row 2 after compaction"
    );
}

#[test]
fn lifecycle_range_deletion() {
    let snap = range_backed_workbook(10, 5, 5, 1, |r, _| ((r + 1) * 10) as f64, vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    for r in 0..5u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(
            as_f64(&v),
            ((r + 1) * 10) as f64,
            "pre-delete row {} should be {}",
            r,
            (r + 1) * 10
        );
    }

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 1,
                count: 2,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_rows");

    let v0 = cell_at(&engine, &sid, 0, 0);
    assert_eq!(
        as_f64(&v0),
        10.0,
        "row 0 should still be 10 after partial delete"
    );

    let v1 = cell_at(&engine, &sid, 1, 0);
    assert_eq!(as_f64(&v1), 40.0, "row 1 should be 40 (shifted from row 3)");
    let v2 = cell_at(&engine, &sid, 2, 0);
    assert_eq!(as_f64(&v2), 50.0, "row 2 should be 50 (shifted from row 4)");

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 0,
                count: 3,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete remaining rows");

    for r in 0..5u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert!(
            v.is_null(),
            "after full deletion, row {} should be Null, got {:?}",
            r,
            v
        );
    }
}

#[test]
fn lifecycle_data_range_overlap_rejection() {
    let snap = range_backed_workbook(10, 5, 4, 2, |r, c| ((r + 1) * 10 + c + 1) as f64, vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    // Row-major layout: (r, c) -> (r+1)*10 + c+1.
    for r in 0..4u32 {
        for c in 0..2u32 {
            let v = cell_at(&engine, &sid, r, c);
            let expected = ((r + 1) * 10 + c + 1) as f64;
            assert_eq!(
                as_f64(&v),
                expected,
                "cell ({}, {}) should be {}",
                r,
                c,
                expected
            );
        }
    }

    let cid = engine
        .mirror()
        .resolve_cell_id(&sid, SheetPos::new(1, 0))
        .expect("CellId at (1,0)");
    engine
        .set_cell(&sid, cid, 1, 0, "999".into())
        .expect("set_cell on Range cell");

    let v = cell_at(&engine, &sid, 1, 0);
    assert_eq!(as_f64(&v), 999.0, "cell (1,0) should be 999 after override");

    let v11 = cell_at(&engine, &sid, 1, 1);
    assert_eq!(as_f64(&v11), 22.0, "cell (1,1) should still be 22");
}
