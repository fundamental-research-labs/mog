use super::*;

// -----------------------------------------------------------------------
// build_agg_map + execute_agg_group
// -----------------------------------------------------------------------

#[test]
fn test_build_agg_map_countifs() {
    let mirror = test_mirror();
    let s = sheet_id_1();

    // Pattern: COUNTIFS(A1:A5, <dynamic>)
    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let map = build_agg_map(&pattern, &mirror).unwrap();

    // "X" appears 3 times (rows 0, 2, 4), "Y" appears 2 times (rows 1, 3).
    let key_x: AggKey = SmallVec::from_vec(vec![NormalizedKey::Text("x".to_string())]);
    let key_y: AggKey = SmallVec::from_vec(vec![NormalizedKey::Text("y".to_string())]);

    match map.get(&key_x) {
        Some(AggAccum::Count(c)) => assert_eq!(*c, 3),
        other => panic!("Expected Count(3) for X, got: {other:?}"),
    }
    match map.get(&key_y) {
        Some(AggAccum::Count(c)) => assert_eq!(*c, 2),
        other => panic!("Expected Count(2) for Y, got: {other:?}"),
    }
}

#[test]
fn test_build_agg_map_sumifs() {
    let mirror = test_mirror();
    let s = sheet_id_1();

    // Pattern: SUMIFS(C1:C5, A1:A5, <dynamic>)
    // Sum of col C where col A = criteria
    // "X" rows: 0(10), 2(30), 4(50) = 90
    // "Y" rows: 1(20), 3(40) = 60
    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 2, 0, 5)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let map = build_agg_map(&pattern, &mirror).unwrap();

    let key_x: AggKey = SmallVec::from_vec(vec![NormalizedKey::Text("x".to_string())]);
    let key_y: AggKey = SmallVec::from_vec(vec![NormalizedKey::Text("y".to_string())]);

    match map.get(&key_x) {
        Some(AggAccum::Sum { acc, count }) => {
            assert_eq!(*count, 3);
            assert!((acc.total() - 90.0).abs() < 1e-10);
        }
        other => panic!("Expected Sum for X, got: {other:?}"),
    }
    match map.get(&key_y) {
        Some(AggAccum::Sum { acc, count }) => {
            assert_eq!(*count, 2);
            assert!((acc.total() - 60.0).abs() < 1e-10);
        }
        other => panic!("Expected Sum for Y, got: {other:?}"),
    }
}

#[test]
fn test_execute_agg_group_countifs() {
    let mirror = test_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    // Output cells in col 5, rows 0-4, looking up criteria from col 4.
    let cell_ids: Vec<CellId> = (0..5).map(|i| cell_id(5000 + i)).collect();

    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 5,
        pattern,
        post_op: None,
        cell_ids,
    };

    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let results = execute_agg_group(&group, &mirror, no_formulas, no_stale).unwrap();
    assert_eq!(results.len(), 5);

    // Row 0: criteria "X" -> count 3
    assert_eq!(results[0].1, CellValue::number(3.0));
    // Row 1: criteria "Y" -> count 2
    assert_eq!(results[1].1, CellValue::number(2.0));
    // Row 2: criteria "X" -> count 3
    assert_eq!(results[2].1, CellValue::number(3.0));
    // Row 3: criteria "Y" -> count 2
    assert_eq!(results[3].1, CellValue::number(2.0));
    // Row 4: criteria "X" -> count 3
    assert_eq!(results[4].1, CellValue::number(3.0));
}

#[test]
fn test_execute_agg_group_bails_on_data_formulas() {
    let mirror = test_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 2,
        pattern,
        post_op: None,
        cell_ids: vec![cell_id(6000), cell_id(6001)],
    };

    // Simulate: data range has formulas
    let has_formulas = |_: &SheetId, _: u32, _: u32, _: u32| true;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    assert!(execute_agg_group(&group, &mirror, has_formulas, no_stale).is_none());
}

#[test]
fn test_criteria_guard_clean_dynamic_column_passes() {
    // Regression test: when the dynamic criteria column contains only data values
    // (no formulas, no spill projections), the criteria_formula_guard should NOT
    // bail. Previously, false positives caused entire groups to bail unnecessarily.
    let mirror = test_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let cell_ids: Vec<CellId> = (0..5).map(|i| cell_id(7500 + i)).collect();
    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 5,
        pattern,
        post_op: None,
        cell_ids,
    };

    // Data columns: no dirty formulas. Criteria column: no dirty formulas.
    // Both guards should pass and the group should resolve successfully.
    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let results = execute_agg_group(&group, &mirror, no_formulas, no_stale).unwrap();
    assert_eq!(results.len(), 5);
    // Verify results are correct (same as test_execute_agg_group_countifs)
    assert_eq!(results[0].1, CellValue::number(3.0));
    assert_eq!(results[1].1, CellValue::number(2.0));
}

#[test]
fn test_criteria_guard_bails_on_stale_projection() {
    // When the criteria column has a stale spill projection (source formula dirty),
    // the criteria_formula_guard should bail to prevent reading stale values.
    let mirror = test_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 2,
        pattern,
        post_op: None,
        cell_ids: vec![cell_id(7600), cell_id(7601)],
    };

    // Data columns: clean. Criteria column: has stale projections.
    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let has_stale = |_: &SheetId, _: u32, _: u32, _: u32| true;
    assert!(execute_agg_group(&group, &mirror, no_formulas, has_stale).is_none());
}

#[test]
fn test_criteria_guard_independent_from_data_guard() {
    // The data guard and criteria guard use separate closures.
    // A clean data guard should not prevent the criteria guard from bailing.
    let mirror = test_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 2,
        pattern,
        post_op: None,
        cell_ids: vec![cell_id(7700), cell_id(7701)],
    };

    // Data guard passes, criteria guard fails (stale projection).
    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let has_stale = |_: &SheetId, _: u32, _: u32, _: u32| true;
    assert!(execute_agg_group(&group, &mirror, no_formulas, has_stale).is_none());

    // Data guard fails, criteria guard passes -- should still bail.
    let has_formulas = |_: &SheetId, _: u32, _: u32, _: u32| true;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    assert!(execute_agg_group(&group, &mirror, has_formulas, no_stale).is_none());
}

#[test]
fn test_averageifs_div_zero() {
    let mirror = test_mirror();
    let s = sheet_id_1();

    // AVERAGEIFS(C1:C5, A1:A5, <dynamic>) -- look up "Z" which doesn't exist
    let pattern = AggPattern {
        agg_fn: AggFn::AverageIfs,
        value_range: Some((s, 2, 0, 5)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::StaticExact {
                key: NormalizedKey::Text("z".to_string()),
            },
        }]),
    };

    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 1,
        pattern,
        post_op: None,
        cell_ids: vec![cell_id(7000)],
    };

    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let results = execute_agg_group(&group, &mirror, no_formulas, no_stale).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].1, CellValue::Error(CellError::Div0, None));
}

#[test]
fn test_static_filter_criteria() {
    let mirror = test_mirror();
    let s = sheet_id_1();

    // SUMIFS(C1:C5, C1:C5, ">20") -- sum values where value > 20
    // Values: 10, 20, 30, 40, 50 -> matches: 30 + 40 + 50 = 120
    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 2, 0, 5)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 2,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::StaticFilter {
                text: ">20".to_string(),
            },
        }]),
    };

    let map = build_agg_map(&pattern, &mirror).unwrap();

    // All matching rows map to the same key (Null placeholder for filter)
    let key: AggKey = SmallVec::from_vec(vec![NormalizedKey::Null]);
    match map.get(&key) {
        Some(AggAccum::Sum { acc, count }) => {
            assert_eq!(*count, 3);
            assert!((acc.total() - 120.0).abs() < 1e-10);
        }
        other => panic!("Expected Sum, got: {other:?}"),
    }
}
