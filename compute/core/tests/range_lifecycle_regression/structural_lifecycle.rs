use super::support::{
    as_f64, cell_at, formula_cell, sheet_id, sheet_snap, value_cell, workbook_10_rows,
};
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::SortOrder;
use formula_types::StructureChange;
use snapshot_types::WorkbookSnapshot;

#[test]
fn lifecycle_sort() {
    let mut cells = Vec::new();
    for r in 0..10u32 {
        cells.push(value_cell(0, r, 0, (10 - r) as f64));
    }
    cells.push(formula_cell(0, 0, 1, "SUM(A1:A10)"));
    let snap = WorkbookSnapshot {
        sheets: vec![sheet_snap(0, "Data", cells)],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    engine
        .sort_range(
            &sid,
            0,
            0,
            9,
            0,
            BridgeSortOptions {
                criteria: vec![BridgeSortCriterion {
                    column: 0,
                    direction: SortOrder::Asc,
                    case_sensitive: false,
                    mode: BridgeSortMode::Value { custom_list: None },
                }],
                has_headers: false,
                visible_rows_only: false,
            },
        )
        .expect("sort_range");

    for r in 0..10u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64,
            "after sort, row {} should be {}",
            r,
            r + 1
        );
    }

    let sum = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&sum) - 55.0).abs() < 1e-9,
        "SUM should still be 55 after sort, got {:?}",
        sum
    );
}

#[test]
fn lifecycle_insert_delete_rows() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);

    let pre_a10 = cell_at(&engine, &sid, 9, 0);
    assert_eq!(as_f64(&pre_a10), 10.0, "A10 should be 10 before insert");

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 5,
                count: 3,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert_rows");

    let a5 = cell_at(&engine, &sid, 4, 0);
    assert_eq!(as_f64(&a5), 5.0, "A5 should be 5 after insert");

    let row5_after = cell_at(&engine, &sid, 5, 0);
    assert!(
        row5_after.is_null(),
        "newly inserted row 5 should be null, got {:?}",
        row5_after
    );

    let a6_shifted = cell_at(&engine, &sid, 8, 0);
    assert_eq!(
        as_f64(&a6_shifted),
        6.0,
        "row 8 should have the value 6 (shifted from row 5)"
    );

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 5,
                count: 3,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_rows");

    let post_a10 = cell_at(&engine, &sid, 9, 0);
    assert_eq!(
        as_f64(&post_a10),
        10.0,
        "A10 should be 10 after delete restores original layout"
    );

    let sum = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&sum) - 55.0).abs() < 1e-9,
        "SUM should be 55 after insert+delete, got {:?}",
        sum
    );
}

#[test]
fn lifecycle_undo_redo_structural() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);

    let pre_a6 = cell_at(&engine, &sid, 5, 0);
    assert_eq!(as_f64(&pre_a6), 6.0, "A6 should be 6 before insert");

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 3,
                count: 2,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert_rows");

    let mid_a6 = cell_at(&engine, &sid, 7, 0);
    assert_eq!(as_f64(&mid_a6), 6.0, "A6 should be at row 7 after insert");

    engine.undo().expect("undo structural");

    let post_undo = cell_at(&engine, &sid, 5, 0);
    assert_eq!(
        as_f64(&post_undo),
        6.0,
        "A6 should be back at row 5 after undo, got {:?}",
        post_undo
    );

    engine.redo().expect("redo structural");

    let post_redo = cell_at(&engine, &sid, 7, 0);
    assert_eq!(
        as_f64(&post_redo),
        6.0,
        "A6 should be at row 7 after redo, got {:?}",
        post_redo
    );
}
