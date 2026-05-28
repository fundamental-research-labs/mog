use value_types::{CellValue, FiniteF64};

use crate::fixtures::{cell_uuid, fixture_with_formulas};
use crate::harness::{
    assert_changed_number, assert_col_value, assert_dense_invalidated, assert_dense_retained,
    assert_dense_value, assert_num, col_version, init_engine, number, warm_dense_cache,
};

/// After a data write, the next DenseColumnCache materialize must return fresh
/// data, not stale cached values.
#[test]
fn cache_no_stale_dense_observable() {
    let scenario = "cache_no_stale_dense_observable";
    let (_core, mut mirror, _init_result) = init_engine(fixture_with_formulas());

    warm_dense_cache(&mut mirror, 0);
    let sid = mirror.sheet_by_name("sheet1").unwrap();
    assert_dense_retained(scenario, &mirror, 0);

    let cell_a1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap();
    mirror.set_value_mut(&cell_a1, CellValue::Number(FiniteF64::must(999.0)));

    assert_dense_invalidated(scenario, &mirror, 0);
    assert_col_value(scenario, &mirror, 0, 0, number(999.0));

    warm_dense_cache(&mut mirror, 0);
    assert!(
        mirror.dense_cache().get(&sid, 0).is_some(),
        "{scenario}: dense cache should be re-warmed for col 0"
    );
    assert_dense_value(scenario, &mirror, 0, 0, 999.0);
}

/// After an override write, formula evaluation must reflect the override rather
/// than stale cached range materialization.
#[test]
fn cache_no_stale_rangestore_observable() {
    let scenario = "cache_no_stale_rangestore_observable";
    let (mut core, mut mirror, init_result) = init_engine(fixture_with_formulas());

    assert_num(&init_result, 0, 2, 15.0);

    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let cell_a1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap();
    let result1 = core
        .set_cell(&mut mirror, &sid, cell_a1, 0, 0, "100")
        .unwrap();
    assert_changed_number(scenario, &result1, 0, 2, 114.0);

    let result2 = core
        .set_cell(&mut mirror, &sid, cell_a1, 0, 0, "200")
        .unwrap();
    assert_changed_number(scenario, &result2, 0, 2, 214.0);

    let cell_a5 = cell_types::CellId::from_uuid_str(&cell_uuid(4, 0)).unwrap();
    let result3 = core
        .set_cell(&mut mirror, &sid, cell_a5, 4, 0, "0")
        .unwrap();
    assert_changed_number(scenario, &result3, 0, 2, 209.0);
}

/// col_version must be strictly monotonic across multiple edits to the same
/// column.
#[test]
fn cache_multi_edit_version_monotonicity() {
    let scenario = "cache_multi_edit_version_monotonicity";
    let (mut core, mut mirror, _) = init_engine(fixture_with_formulas());
    let sid = mirror.sheet_by_name("sheet1").unwrap();

    let mut prev_version = col_version(&mirror, 0);
    for i in 0..5u32 {
        let cell_id = cell_types::CellId::from_uuid_str(&cell_uuid(i, 0)).unwrap();
        let val = format!("{}", (i + 1) * 100);
        let _ = core
            .set_cell(&mut mirror, &sid, cell_id, i, 0, val.as_str())
            .unwrap();

        let new_version = col_version(&mirror, 0);
        assert!(
            new_version > prev_version,
            "{scenario}: col_version for col 0 should be strictly increasing after edit at (row={i}, col=0): prev={prev_version}, observed={new_version}"
        );
        prev_version = new_version;
    }
}

/// After an edit, col_data, dense cache, and formula evaluation should agree on
/// the same values.
#[test]
fn cache_cross_layer_consistency() {
    let scenario = "cache_cross_layer_consistency";
    let (mut core, mut mirror, _) = init_engine(fixture_with_formulas());
    let sid = mirror.sheet_by_name("sheet1").unwrap();

    let cell_a3 = cell_types::CellId::from_uuid_str(&cell_uuid(2, 0)).unwrap();
    let result = core
        .set_cell(&mut mirror, &sid, cell_a3, 2, 0, "99")
        .unwrap();

    assert_col_value(scenario, &mirror, 2, 0, number(99.0));
    warm_dense_cache(&mut mirror, 0);
    assert_dense_value(scenario, &mirror, 0, 2, 99.0);
    assert_changed_number(scenario, &result, 0, 2, 111.0);
}
