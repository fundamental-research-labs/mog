use compute_core::snapshot::CellEdit;
use value_types::{CellValue, FiniteF64};

use crate::fixtures::{cell_uuid, fixture_with_column_formulas, fixture_with_formulas, sheet_uuid};
use crate::harness::{
    assert_changed_error_or_absent_not_old_number, assert_changed_number, assert_col_value,
    assert_col_version_bumped, assert_col_version_unchanged, assert_dense_invalidated,
    assert_dense_retained, assert_num, col_data_value, col_version, dense_cache_has,
    find_changed_value, init_engine, number, warm_dense_cache,
};

/// Edit a single data cell. Assert col_version bumped for that column only,
/// col_data updated, DenseColumnCache invalidated for that column only, and
/// formulas recalculate correctly.
#[test]
fn cache_sparse_override_edit() {
    let scenario = "cache_sparse_override_edit";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_column_formulas());

    assert_num(&init_result, 0, 2, 15.0);
    assert_num(&init_result, 0, 3, 30.0);
    assert_num(&init_result, 0, 4, 150.0);

    warm_dense_cache(&mut mirror, 0);
    warm_dense_cache(&mut mirror, 1);
    assert_dense_retained(scenario, &mirror, 0);
    assert_dense_retained(scenario, &mirror, 1);

    let v0_before = col_version(&mirror, 0);
    let v1_before = col_version(&mirror, 1);

    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let cell_id = cell_types::CellId::from_uuid_str(&cell_uuid(2, 0)).unwrap();
    let result = core
        .set_cell(&mut mirror, &sid, cell_id, 2, 0, "100")
        .expect("set_cell failed");

    assert_col_version_bumped(scenario, 0, v0_before, col_version(&mirror, 0));
    assert_col_version_unchanged(scenario, 1, v1_before, col_version(&mirror, 1));
    assert_col_value(scenario, &mirror, 2, 0, number(100.0));
    assert_dense_invalidated(scenario, &mirror, 0);
    assert_dense_retained(scenario, &mirror, 1);
    assert_changed_number(scenario, &result, 0, 2, 112.0);

    let vlookup_val = find_changed_value(&result, 0, 3);
    assert!(
        vlookup_val.is_some(),
        "{scenario}: VLOOKUP should have recalculated after data change at (row=2, col=0)"
    );
}

/// Replace multiple cells in the data region, simulating a bulk payload
/// replacement.
#[test]
fn cache_payload_replacement() {
    let scenario = "cache_payload_replacement";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_formulas());

    assert_num(&init_result, 0, 2, 15.0);
    assert_num(&init_result, 0, 3, 30.0);

    warm_dense_cache(&mut mirror, 0);
    warm_dense_cache(&mut mirror, 1);

    let v0_before = col_version(&mirror, 0);
    let v1_before = col_version(&mirror, 1);

    let sid_str = sheet_uuid();
    let edits: Vec<CellEdit> = (0..5u32)
        .flat_map(|i| {
            vec![
                CellEdit {
                    sheet_id: sid_str.clone(),
                    cell_id: cell_uuid(i, 0),
                    row: i,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(((i + 1) * 10) as f64)),
                    formula: None,
                    identity_formula: None,
                },
                CellEdit {
                    sheet_id: sid_str.clone(),
                    cell_id: cell_uuid(i, 1),
                    row: i,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(((i + 1) * 100) as f64)),
                    formula: None,
                    identity_formula: None,
                },
            ]
        })
        .collect();

    let result = core
        .apply_changes(&mut mirror, &edits, false)
        .expect("apply_changes failed");

    assert_col_version_bumped(scenario, 0, v0_before, col_version(&mirror, 0));
    assert_col_version_bumped(scenario, 1, v1_before, col_version(&mirror, 1));
    assert_col_value(scenario, &mirror, 0, 0, number(10.0));
    assert_col_value(scenario, &mirror, 4, 0, number(50.0));
    assert_col_value(scenario, &mirror, 2, 1, number(300.0));
    assert_dense_invalidated(scenario, &mirror, 0);
    assert_dense_invalidated(scenario, &mirror, 1);
    assert_changed_number(scenario, &result, 0, 2, 150.0);
    assert_changed_error_or_absent_not_old_number(scenario, &result, 0, 3, 30.0);
}

/// Simulate compaction: replace individual override values with a bulk rewrite.
#[test]
fn cache_compaction() {
    let scenario = "cache_compaction";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_formulas());
    assert_num(&init_result, 0, 2, 15.0);

    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let cell_a1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap();
    let cell_a2 = cell_types::CellId::from_uuid_str(&cell_uuid(1, 0)).unwrap();

    let _ = core
        .set_cell(&mut mirror, &sid, cell_a1, 0, 0, "10")
        .unwrap();
    let _ = core
        .set_cell(&mut mirror, &sid, cell_a2, 1, 0, "20")
        .unwrap();

    assert_col_value(scenario, &mirror, 0, 0, number(10.0));
    assert_col_value(scenario, &mirror, 1, 0, number(20.0));

    warm_dense_cache(&mut mirror, 0);
    assert!(
        dense_cache_has(&mirror, 0),
        "{scenario}: col 0 dense should be warm before compaction"
    );

    let v0_before = col_version(&mirror, 0);
    let sid_str = sheet_uuid();
    let edits: Vec<CellEdit> = (0..5u32)
        .map(|i| {
            let val = match i {
                0 => 10.0,
                1 => 20.0,
                _ => (i + 1) as f64,
            };
            CellEdit {
                sheet_id: sid_str.clone(),
                cell_id: cell_uuid(i, 0),
                row: i,
                col: 0,
                value: CellValue::Number(FiniteF64::must(val)),
                formula: None,
                identity_formula: None,
            }
        })
        .collect();

    let _result = core
        .apply_changes(&mut mirror, &edits, false)
        .expect("compaction apply_changes failed");

    assert_col_version_bumped(scenario, 0, v0_before, col_version(&mirror, 0));
    assert_col_value(scenario, &mirror, 0, 0, number(10.0));
    assert_col_value(scenario, &mirror, 1, 0, number(20.0));
    assert_col_value(scenario, &mirror, 2, 0, number(3.0));
    assert_dense_invalidated(scenario, &mirror, 0);

    let sum_cell_id = cell_types::CellId::from_uuid_str(&cell_uuid(0, 2)).unwrap();
    let sum_val = mirror.get_cell_value(&sum_cell_id);
    match sum_val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - 42.0).abs() < 1e-6,
                "{scenario}: SUM(A1:A5) at (row=0, col=2) should be 42 after compaction, got {}",
                n.get()
            );
        }
        other => {
            panic!("{scenario}: SUM(A1:A5) at (row=0, col=2) should be Number(42), got {other:?}")
        }
    }

    assert_eq!(col_data_value(&mirror, 0, 2), number(3.0));
}
