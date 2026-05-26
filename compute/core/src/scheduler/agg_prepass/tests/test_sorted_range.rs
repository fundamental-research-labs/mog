use super::*;

// -----------------------------------------------------------------------
// Sorted-range prepass tests
// -----------------------------------------------------------------------

#[test]
fn test_try_build_range_prepass_plan_basic() {
    let s = sheet_id_1();
    // Pattern: SUMIFS(D:D, A:A, ">="&E1, A:A, "<="&F1, B:B, "A", C:C, 0)
    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 1,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Text("a".to_string()),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let plan = try_build_range_prepass_plan(&pattern).unwrap();
    assert!(plan.lower_bound.is_some());
    assert!(plan.upper_bound.is_some());
    assert_eq!(plan.static_criteria.len(), 2); // B:B and C:C
    assert_eq!(plan.range_data_col.1, 0); // col A
}

#[test]
fn test_try_build_range_prepass_plan_rejects_wildcard() {
    let s = sheet_id_1();
    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: u32::MAX,
            criteria: CriteriaSource::DynamicWithPrefix {
                sheet: s,
                col: 4,
                prefix: "*".to_string(),
            },
        }]),
    };
    assert!(try_build_range_prepass_plan(&pattern).is_none());
}

#[test]
fn test_try_build_range_prepass_plan_rejects_different_data_cols() {
    let s = sheet_id_1();
    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 1,
                data_start_row: 0,
                data_end_row: u32::MAX, // different col!
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
        ]),
    };
    assert!(try_build_range_prepass_plan(&pattern).is_none());
}

#[test]
fn test_sorted_range_prepass_sumifs_bounded() {
    // SUMIFS(D:D, A:A, ">="&E_row, A:A, "<="&F_row, C:C, 0)
    // Static: C:C = 0 (status = 0)
    // Range: A:A >= E_row AND A:A <= F_row
    //
    // Data (10 rows):
    //   A:    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
    //   C:    0,   0,   1,   0,   0,   0,   1,   0,   0,   0
    //   D:    1,   2,   3,   4,   5,   6,   7,   8,   9,   10
    //
    // Status=0 rows: 0,1,3,4,5,7,8,9 (A: 100,200,400,500,600,800,900,1000; D: 1,2,4,5,6,8,9,10)
    //
    // Row 0: lower=200, upper=500 -> A in [200,500] & status=0 -> rows 1(200),3(400),4(500) -> D: 2+4+5 = 11
    // Row 1: lower=400, upper=800 -> A in [400,800] & status=0 -> rows 3(400),4(500),5(600),7(800) -> D: 4+5+6+8 = 23
    let mirror = sorted_range_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let plan = try_build_range_prepass_plan(&pattern).unwrap();
    let sorted_index = build_sorted_range_index(&plan, &pattern, &mirror).unwrap();

    // Status=0 rows with numeric A: 8 entries
    assert_eq!(sorted_index.len(), 8);

    let cell_ids: Vec<CellId> = (0..2).map(|i| cell_id(8000 + i)).collect();
    let group = AggFormulaGroup {
        sheet: s,
        col: 6,
        start_row: 0,
        end_row: 2,
        pattern,
        post_op: None,
        cell_ids,
    };

    let results = execute_sorted_range_prepass(&group, &plan, &sorted_index, &mirror).unwrap();
    assert_eq!(results.len(), 2);

    // Row 0: lower=200, upper=500 -> sum of D where A in [200,500] and C=0 -> 2+4+5 = 11
    assert!(
        (results[0].1.as_number().unwrap() - 11.0).abs() < 1e-10,
        "Expected 11.0, got {:?}",
        results[0].1
    );
    // Row 1: lower=400, upper=800 -> sum of D where A in [400,800] and C=0 -> 4+5+6+8 = 23
    assert!(
        (results[1].1.as_number().unwrap() - 23.0).abs() < 1e-10,
        "Expected 23.0, got {:?}",
        results[1].1
    );
}

#[test]
fn test_sorted_range_prepass_one_sided_lower() {
    // Only lower bound: A:A >= E_row, no upper bound, C:C = 0
    let mirror = sorted_range_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let plan = try_build_range_prepass_plan(&pattern).unwrap();
    assert!(plan.lower_bound.is_some());
    assert!(plan.upper_bound.is_none());

    let sorted_index = build_sorted_range_index(&plan, &pattern, &mirror).unwrap();
    let cell_ids: Vec<CellId> = vec![cell_id(9000)];
    let group = AggFormulaGroup {
        sheet: s,
        col: 6,
        start_row: 0, // row 0 -> lower=200
        end_row: 1,
        pattern,
        post_op: None,
        cell_ids,
    };

    let results = execute_sorted_range_prepass(&group, &plan, &sorted_index, &mirror).unwrap();
    assert_eq!(results.len(), 1);
    // Row 0: lower=200, no upper -> A >= 200 and C=0 -> rows 1,3,4,5,7,8,9 -> D: 2+4+5+6+8+9+10 = 44
    assert!(
        (results[0].1.as_number().unwrap() - 44.0).abs() < 1e-10,
        "Expected 44.0, got {:?}",
        results[0].1
    );
}

#[test]
fn test_sorted_range_prepass_empty_result() {
    // Lower bound > upper bound -> empty result
    let mirror = sorted_range_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let plan = try_build_range_prepass_plan(&pattern).unwrap();
    let sorted_index = build_sorted_range_index(&plan, &pattern, &mirror).unwrap();

    // Use row 2: lower=100, upper=300 -- but row 2's status=1, so we're testing that the
    // static filter already removed it. Range [100,300] & status=0: rows 0(100),1(200) -> D: 1+2 = 3
    let cell_ids: Vec<CellId> = vec![cell_id(9100)];
    let group = AggFormulaGroup {
        sheet: s,
        col: 6,
        start_row: 2, // row 2 -> lower=100, upper=300
        end_row: 3,
        pattern,
        post_op: None,
        cell_ids,
    };

    let results = execute_sorted_range_prepass(&group, &plan, &sorted_index, &mirror).unwrap();
    assert_eq!(results.len(), 1);
    assert!(
        (results[0].1.as_number().unwrap() - 3.0).abs() < 1e-10,
        "Expected 3.0, got {:?}",
        results[0].1
    );
}

#[test]
fn test_sorted_range_prepass_countifs() {
    let mirror = sorted_range_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let plan = try_build_range_prepass_plan(&pattern).unwrap();
    let sorted_index = build_sorted_range_index(&plan, &pattern, &mirror).unwrap();

    let cell_ids: Vec<CellId> = vec![cell_id(9200)];
    let group = AggFormulaGroup {
        sheet: s,
        col: 6,
        start_row: 0, // lower=200, upper=500
        end_row: 1,
        pattern,
        post_op: None,
        cell_ids,
    };

    let results = execute_sorted_range_prepass(&group, &plan, &sorted_index, &mirror).unwrap();
    assert_eq!(results.len(), 1);
    // A in [200,500] & status=0 -> rows 1(200),3(400),4(500) -> count = 3
    assert_eq!(results[0].1, CellValue::number(3.0));
}

#[test]
fn test_sorted_range_prepass_with_post_op() {
    let mirror = sorted_range_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let plan = try_build_range_prepass_plan(&pattern).unwrap();
    let sorted_index = build_sorted_range_index(&plan, &pattern, &mirror).unwrap();

    let cell_ids: Vec<CellId> = vec![cell_id(9300)];
    let group = AggFormulaGroup {
        sheet: s,
        col: 6,
        start_row: 0,
        end_row: 1,
        pattern,
        post_op: Some(PostOp {
            op: compute_parser::BinOp::Div,
            operand: PostOpOperand::Number(2.0),
        }),
        cell_ids,
    };

    let results = execute_sorted_range_prepass(&group, &plan, &sorted_index, &mirror).unwrap();
    assert_eq!(results.len(), 1);
    // Row 0: sum=11, /2 = 5.5
    assert!(
        (results[0].1.as_number().unwrap() - 5.5).abs() < 1e-10,
        "Expected 5.5, got {:?}",
        results[0].1
    );
}

#[test]
fn test_sorted_range_prepass_wired_through_execute_agg_group() {
    // Verify that execute_agg_group correctly falls through to sorted-range path
    let mirror = sorted_range_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 3, 0, u32::MAX)),
        pairs: SmallVec::from_vec(vec![
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 4,
                    prefix: ">=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 0,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::DynamicWithPrefix {
                    sheet: s,
                    col: 5,
                    prefix: "<=".to_string(),
                },
            },
            AggCriteriaPair {
                data_sheet: s,
                data_col: 2,
                data_start_row: 0,
                data_end_row: u32::MAX,
                criteria: CriteriaSource::StaticExact {
                    key: NormalizedKey::Number(0),
                },
            },
        ]),
    };

    let cell_ids: Vec<CellId> = (0..2).map(|i| cell_id(9400 + i)).collect();
    let group = AggFormulaGroup {
        sheet: s,
        col: 6,
        start_row: 0,
        end_row: 2,
        pattern,
        post_op: None,
        cell_ids,
    };

    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let results = execute_agg_group(&group, &mirror, no_formulas, no_stale).unwrap();
    assert_eq!(results.len(), 2);

    // Same expected values as test_sorted_range_prepass_sumifs_bounded
    assert!((results[0].1.as_number().unwrap() - 11.0).abs() < 1e-10);
    assert!((results[1].1.as_number().unwrap() - 23.0).abs() < 1e-10);
}
