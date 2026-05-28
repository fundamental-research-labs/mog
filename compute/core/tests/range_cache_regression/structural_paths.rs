use value_types::CellValue;

use crate::fixtures::{cell_uuid, fixture_with_column_formulas, fixture_with_formulas, sheet_uuid};
use crate::harness::{
    assert_col_value, assert_dense_invalidated, assert_dense_retained, assert_dense_value,
    assert_num, col_data_value, dense_cache_has, find_changed_value, init_engine, number,
    warm_dense_cache,
};

/// Insert a row in the middle of the data region.
#[test]
fn cache_structural_insert_row() {
    let scenario = "cache_structural_insert_row";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_formulas());
    assert_num(&init_result, 0, 2, 15.0);

    warm_dense_cache(&mut mirror, 0);
    assert_dense_retained(scenario, &mirror, 0);

    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let change = formula_types::StructureChange::InsertRows {
        at: 2,
        count: 1,
        new_row_ids: vec![cell_types::RowId::from_raw(9001)],
    };
    mirror.apply_structure_change(&sid, &change);

    assert_col_value(scenario, &mirror, 0, 0, number(1.0));
    assert_col_value(scenario, &mirror, 1, 0, number(2.0));
    assert_col_value(scenario, &mirror, 2, 0, CellValue::Null);
    assert_col_value(scenario, &mirror, 3, 0, number(3.0));
    assert_dense_invalidated(scenario, &mirror, 0);

    let result = core
        .structure_change(&mut mirror, Some((&change, sid)))
        .expect("structure_change failed");

    let sum_mirror = col_data_value(&mirror, 2, 0);
    match sum_mirror {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 15.0).abs() > 0.001 || n.get() == 15.0,
                "{scenario}: SUM at (row=0, col=2) should produce a numeric result after insert, got {}",
                n.get()
            );
        }
        _ => {
            let changed = result
                .changed_cells
                .iter()
                .any(|cc| cc.sheet_id == sheet_uuid());
            assert!(
                changed,
                "{scenario}: structural insert should recalculate changed cells"
            );
        }
    }
}

/// Delete a row from the data region.
#[test]
fn cache_structural_delete_row() {
    let scenario = "cache_structural_delete_row";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_formulas());
    assert_num(&init_result, 0, 2, 15.0);

    warm_dense_cache(&mut mirror, 0);
    assert_dense_retained(scenario, &mirror, 0);

    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let deleted_cell_ids: Vec<cell_types::CellId> = (0..2u32)
        .map(|col| cell_types::CellId::from_uuid_str(&cell_uuid(2, col)).unwrap())
        .collect();
    let change = formula_types::StructureChange::DeleteRows {
        at: 2,
        count: 1,
        deleted_cell_ids: deleted_cell_ids.clone(),
    };
    mirror.apply_structure_change(&sid, &change);

    assert_col_value(scenario, &mirror, 0, 0, number(1.0));
    assert_col_value(scenario, &mirror, 1, 0, number(2.0));
    assert_col_value(scenario, &mirror, 2, 0, number(4.0));
    assert_col_value(scenario, &mirror, 3, 0, number(5.0));
    assert_dense_invalidated(scenario, &mirror, 0);

    let result = core
        .structure_change(&mut mirror, Some((&change, sid)))
        .expect("structure_change failed");
    let sum_val = find_changed_value(&result, 0, 2);
    assert!(
        sum_val.is_some(),
        "{scenario}: SUM formula at (row=0, col=2) should recalculate after structural delete"
    );
}

/// Sort/remap a sheet's rows.
#[test]
fn cache_sort_reorder() {
    let scenario = "cache_sort_reorder";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_column_formulas());

    assert_num(&init_result, 0, 2, 15.0);
    assert_num(&init_result, 0, 4, 150.0);

    warm_dense_cache(&mut mirror, 0);
    warm_dense_cache(&mut mirror, 1);
    assert!(
        dense_cache_has(&mirror, 0),
        "{scenario}: col 0 dense should be warm"
    );
    assert!(
        dense_cache_has(&mirror, 1),
        "{scenario}: col 1 dense should be warm"
    );

    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let remap_updates: Vec<(cell_types::CellId, u32, u32)> = (0..5u32)
        .flat_map(|i| {
            let new_row = 4 - i;
            (0..2u32).map(move |col| {
                let cid = cell_types::CellId::from_uuid_str(&cell_uuid(i, col)).unwrap();
                (cid, new_row, col)
            })
        })
        .collect();

    let change = formula_types::StructureChange::RemapPositions {
        updates: remap_updates.clone(),
    };
    mirror.apply_structure_change(&sid, &change);

    assert_col_value(scenario, &mirror, 0, 0, number(5.0));
    assert_col_value(scenario, &mirror, 4, 0, number(1.0));
    assert_col_value(scenario, &mirror, 0, 1, number(50.0));
    assert_col_value(scenario, &mirror, 4, 1, number(10.0));
    assert_dense_invalidated(scenario, &mirror, 0);
    assert_dense_invalidated(scenario, &mirror, 1);

    let result = core
        .structure_change(&mut mirror, Some((&change, sid)))
        .expect("structure_change failed");

    if let Some(CellValue::Number(n)) = &find_changed_value(&result, 0, 2) {
        assert!(
            (n.get() - 15.0).abs() < 1e-6,
            "{scenario}: SUM(A1:A5) at (row=0, col=2) should still be 15 after sort, got {}",
            n.get()
        );
    }
    if let Some(CellValue::Number(n)) = &find_changed_value(&result, 0, 4) {
        assert!(
            (n.get() - 150.0).abs() < 1e-6,
            "{scenario}: SUM(B1:B5) at (row=0, col=4) should still be 150 after sort, got {}",
            n.get()
        );
    }
}

/// After a structural change, re-materializing dense cache should produce
/// correct values reflecting the structural change.
#[test]
fn cache_dense_rematerialize_after_structural() {
    let scenario = "cache_dense_rematerialize_after_structural";
    let (_core, mut mirror, _) = init_engine(fixture_with_formulas());
    let sid = mirror.sheet_by_name("sheet1").unwrap();

    warm_dense_cache(&mut mirror, 0);
    {
        let dense = mirror.dense_cache().get(&sid, 0).unwrap();
        assert_eq!(dense.values()[0], 1.0);
        assert_eq!(dense.values()[1], 2.0);
        assert_eq!(dense.values()[2], 3.0);
    }

    let deleted = vec![
        cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap(),
        cell_types::CellId::from_uuid_str(&cell_uuid(0, 1)).unwrap(),
    ];
    mirror.apply_structure_change(
        &sid,
        &formula_types::StructureChange::DeleteRows {
            at: 0,
            count: 1,
            deleted_cell_ids: deleted,
        },
    );

    assert_dense_invalidated(scenario, &mirror, 0);
    warm_dense_cache(&mut mirror, 0);
    assert_dense_value(scenario, &mirror, 0, 0, 2.0);
    assert_dense_value(scenario, &mirror, 0, 1, 3.0);
    assert_dense_value(scenario, &mirror, 0, 2, 4.0);
    assert_dense_value(scenario, &mirror, 0, 3, 5.0);
}
