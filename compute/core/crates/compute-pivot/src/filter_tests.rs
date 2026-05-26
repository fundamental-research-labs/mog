use super::*;
use crate::resolved::{ResolvedFilter, ResolvedTopBottom};
use crate::types::{
    AggregateFunction, FieldId, FilterOperator, NullaryFilterOp, PivotFilterCondition, TopBottomBy,
    TopBottomType, UnaryFilterOp,
};
use value_types::CellError;

// -- Test data helpers ---------------------------------------------------

fn sample_data() -> Vec<Vec<CellValue>> {
    // 5 rows, 3 columns: [category, product, amount]
    vec![
        vec![
            CellValue::Text("Fruit".into()),
            CellValue::Text("Apple".into()),
            CellValue::number(10.0),
        ],
        vec![
            CellValue::Text("Fruit".into()),
            CellValue::Text("Banana".into()),
            CellValue::number(20.0),
        ],
        vec![
            CellValue::Text("Vegetable".into()),
            CellValue::Text("Carrot".into()),
            CellValue::number(15.0),
        ],
        vec![
            CellValue::Text("Vegetable".into()),
            CellValue::Text("Broccoli".into()),
            CellValue::number(25.0),
        ],
        vec![
            CellValue::Text("Dairy".into()),
            CellValue::Text("Milk".into()),
            CellValue::number(5.0),
        ],
    ]
}

fn all_indices(data: &[Vec<CellValue>]) -> Vec<usize> {
    (0..data.len()).collect()
}

fn numeric_data() -> Vec<Vec<CellValue>> {
    vec![
        vec![CellValue::number(1.0), CellValue::number(100.0)],
        vec![CellValue::number(2.0), CellValue::number(200.0)],
        vec![CellValue::number(3.0), CellValue::number(300.0)],
        vec![CellValue::number(4.0), CellValue::number(400.0)],
        vec![CellValue::number(5.0), CellValue::number(500.0)],
    ]
}

// -- get_unique_field_values ---------------------------------------------

#[test]
fn unique_field_values() {
    let data = sample_data();
    let indices = all_indices(&data);
    let unique = get_unique_field_values(&data, &indices, 0);
    assert_eq!(unique.len(), 3); // Fruit, Vegetable, Dairy
}

#[test]
fn unique_field_values_case_insensitive() {
    let data = vec![
        vec![CellValue::Text("Apple".into())],
        vec![CellValue::Text("apple".into())],
        vec![CellValue::Text("APPLE".into())],
        vec![CellValue::Text("Banana".into())],
    ];
    let indices = all_indices(&data);
    let unique = get_unique_field_values(&data, &indices, 0);
    assert_eq!(unique.len(), 2); // Apple and Banana (first occurrence each)
    assert_eq!(unique[0], CellValue::Text("Apple".into()));
    assert_eq!(unique[1], CellValue::Text("Banana".into()));
}

#[test]
fn unique_field_values_with_nulls() {
    let data = vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::Null],
        vec![CellValue::number(1.0)],
        vec![CellValue::Null],
        vec![CellValue::number(2.0)],
    ];
    let indices = all_indices(&data);
    let unique = get_unique_field_values(&data, &indices, 0);
    assert_eq!(unique.len(), 3); // 1.0, Null, 2.0
}

// -- get_filter_operators ------------------------------------------------

#[test]
fn filter_operators_returns_all() {
    let ops = get_filter_operators();
    assert_eq!(ops.len(), 16);
    assert!(ops.contains(&FilterOperator::Equals));
    assert!(ops.contains(&FilterOperator::NotEquals));
    assert!(ops.contains(&FilterOperator::Contains));
    assert!(ops.contains(&FilterOperator::NotContains));
    assert!(ops.contains(&FilterOperator::StartsWith));
    assert!(ops.contains(&FilterOperator::EndsWith));
    assert!(ops.contains(&FilterOperator::GreaterThan));
    assert!(ops.contains(&FilterOperator::GreaterThanOrEqual));
    assert!(ops.contains(&FilterOperator::LessThan));
    assert!(ops.contains(&FilterOperator::LessThanOrEqual));
    assert!(ops.contains(&FilterOperator::Between));
    assert!(ops.contains(&FilterOperator::NotBetween));
    assert!(ops.contains(&FilterOperator::IsBlank));
    assert!(ops.contains(&FilterOperator::IsNotBlank));
    assert!(ops.contains(&FilterOperator::AboveAverage));
    assert!(ops.contains(&FilterOperator::BelowAverage));
}

// -- matches_condition (standalone, no filter pipeline) -------------------

#[test]
fn condition_equals_null_value() {
    // Equals with null target: all blanks should match.
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::Null,
    };
    assert!(matches_condition(&CellValue::Null, &cond));
    assert!(!matches_condition(&CellValue::number(5.0), &cond));
}

#[test]
fn blanks_filter_canonical_definition() {
    // Null, Text(""), Text("  ") all match IsBlank
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank);
    assert!(matches_condition(&CellValue::Null, &cond));
    assert!(matches_condition(&CellValue::Text("".into()), &cond));
    assert!(matches_condition(&CellValue::Text("  ".into()), &cond));
    assert!(matches_condition(&CellValue::Text("\t\n".into()), &cond));
    // Non-blank
    assert!(!matches_condition(&CellValue::number(0.0), &cond));
    assert!(!matches_condition(&CellValue::Boolean(false), &cond));
    assert!(!matches_condition(
        &CellValue::Error(CellError::Na, None),
        &cond
    ));
}

// ============================================================================
// Resolved filter path tests (exercises apply_filters_resolved / apply_filter_resolved)
// ============================================================================

/// Helper to build a simple ResolvedFilter for a given column index.
fn make_resolved_filter(
    field_column_index: usize,
    condition: Option<PivotFilterCondition>,
    top_bottom: Option<ResolvedTopBottom>,
) -> ResolvedFilter {
    ResolvedFilter {
        field_id: FieldId::from("f"),
        field_column_index,
        include_values: None,
        exclude_values: None,
        condition,
        top_bottom,
        show_items_with_no_data: true,
    }
}

// -- AboveAverage / BelowAverage via resolved path ----------------------------

#[test]
fn resolved_above_average_filter() {
    let data = numeric_data(); // col 0: 1,2,3,4,5 -> avg = 3
    let indices = all_indices(&data);
    let filter = make_resolved_filter(
        0,
        Some(PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)),
        None,
    );
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Strict >3: rows with 4 and 5
    assert_eq!(result.len(), 2);
    assert_eq!(result[0], 3); // 4.0
    assert_eq!(result[1], 4); // 5.0
}

#[test]
fn resolved_below_average_filter() {
    let data = numeric_data(); // col 0: 1,2,3,4,5 -> avg = 3
    let indices = all_indices(&data);
    let filter = make_resolved_filter(
        0,
        Some(PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage)),
        None,
    );
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Strict <3: rows with 1 and 2
    assert_eq!(result.len(), 2);
    assert_eq!(result[0], 0); // 1.0
    assert_eq!(result[1], 1); // 2.0
}

#[test]
fn resolved_above_average_with_non_numeric() {
    let data = vec![
        vec![CellValue::number(10.0)],
        vec![CellValue::Text("hello".into())],
        vec![CellValue::number(20.0)],
        vec![CellValue::Null],
        vec![CellValue::number(30.0)],
    ];
    let indices = all_indices(&data);
    // avg of numerics: (10+20+30)/3 = 20
    let filter = make_resolved_filter(
        0,
        Some(PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)),
        None,
    );
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Strict >20: only 30 at index 4
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], 4);
}

#[test]
fn resolved_below_average_with_non_numeric() {
    let data = vec![
        vec![CellValue::number(10.0)],
        vec![CellValue::Text("hello".into())],
        vec![CellValue::number(20.0)],
        vec![CellValue::Null],
        vec![CellValue::number(30.0)],
    ];
    let indices = all_indices(&data);
    // avg of numerics: (10+20+30)/3 = 20
    let filter = make_resolved_filter(
        0,
        Some(PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage)),
        None,
    );
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Strict <20: only 10 at index 0
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], 0);
}

#[test]
fn resolved_above_average_all_same() {
    let data = vec![
        vec![CellValue::number(5.0)],
        vec![CellValue::number(5.0)],
        vec![CellValue::number(5.0)],
    ];
    let indices = all_indices(&data);
    let filter = make_resolved_filter(
        0,
        Some(PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)),
        None,
    );
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // avg=5, strict >5: nothing
    assert_eq!(result.len(), 0);
}

// -- Top/Bottom via resolved path ---------------------------------------------

/// Sample data for resolved top/bottom tests:
/// 3 groups: A(10,20), B(50), C(5) with categories in col 0, values in col 1.
fn resolved_tb_data() -> Vec<Vec<CellValue>> {
    vec![
        vec![CellValue::Text("A".into()), CellValue::number(10.0)],
        vec![CellValue::Text("A".into()), CellValue::number(20.0)],
        vec![CellValue::Text("B".into()), CellValue::number(50.0)],
        vec![CellValue::Text("C".into()), CellValue::number(5.0)],
    ]
}

#[test]
fn resolved_top_by_percent() {
    // 3 groups, top 50%: ceil(3 * 50/100) = 2 groups.
    // Sums: A=30, B=50, C=5. Top 2 by sum: B(50), A(30).
    let data = resolved_tb_data();
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Top,
            n: 50.0,
            by: TopBottomBy::Percent,
            value_field_index: Some(0),
        }),
        show_items_with_no_data: true,
    };
    let value_col_indices = vec![(1usize, AggregateFunction::Sum)];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    // Kept groups: B (row 2) and A (rows 0,1). C excluded.
    assert_eq!(result.len(), 3);
    assert!(result.contains(&0));
    assert!(result.contains(&1));
    assert!(result.contains(&2));
    assert!(!result.contains(&3)); // C excluded
}

#[test]
fn resolved_top_by_sum() {
    // Top by sum with threshold 40: include groups until cumulative sum >= 40.
    // Sums (sorted desc): B=50, A=30, C=5. B(50) >= 40 -> keep 1 group.
    let data = resolved_tb_data();
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Top,
            n: 40.0,
            by: TopBottomBy::Sum,
            value_field_index: Some(0),
        }),
        show_items_with_no_data: true,
    };
    let value_col_indices = vec![(1usize, AggregateFunction::Sum)];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    // Only group B (row 2) -- cumulative 50 >= 40 after first group.
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], 2);
}

#[test]
fn resolved_bottom_by_items() {
    // Bottom 1 item ranked by the value measure. Groups: A=30, B=50, C=5.
    let data = resolved_tb_data();
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Bottom,
            n: 1.0,
            by: TopBottomBy::Items,
            value_field_index: None,
        }),
        show_items_with_no_data: true,
    };
    let value_col_indices = vec![(1usize, AggregateFunction::Sum)];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    assert_eq!(result.len(), 1);
    assert!(result.contains(&3)); // C
}

#[test]
fn resolved_bottom_by_percent() {
    // Bottom 50%: ceil(3 * 50/100) = 2 groups.
    // Sums ascending: C=5, A=30, B=50. Bottom 2 = C and A.
    let data = resolved_tb_data();
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Bottom,
            n: 50.0,
            by: TopBottomBy::Percent,
            value_field_index: Some(0),
        }),
        show_items_with_no_data: true,
    };
    let value_col_indices = vec![(1usize, AggregateFunction::Sum)];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    // Kept groups: C (row 3) and A (rows 0,1). B excluded.
    assert_eq!(result.len(), 3);
    assert!(result.contains(&0));
    assert!(result.contains(&1));
    assert!(result.contains(&3));
    assert!(!result.contains(&2)); // B excluded
}

#[test]
fn resolved_bottom_by_sum() {
    // Bottom by sum with threshold 10: include groups until cumulative sum >= 10.
    // Sums ascending: C=5, A=30, B=50. C(5)<10 -> continue. C+A=35 >= 10 -> keep 2 groups.
    let data = resolved_tb_data();
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Bottom,
            n: 10.0,
            by: TopBottomBy::Sum,
            value_field_index: Some(0),
        }),
        show_items_with_no_data: true,
    };
    let value_col_indices = vec![(1usize, AggregateFunction::Sum)];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    // Kept groups: C (row 3) and A (rows 0,1).
    assert_eq!(result.len(), 3);
    assert!(result.contains(&0));
    assert!(result.contains(&1));
    assert!(result.contains(&3));
}

#[test]
fn resolved_top_with_specific_value_field_index() {
    // Two value columns: col 1 (low values) and col 2 (high values).
    // value_field_index = 1 means use the second value placement (col 2).
    let data = vec![
        vec![
            CellValue::Text("A".into()),
            CellValue::number(100.0),
            CellValue::number(1.0),
        ],
        vec![
            CellValue::Text("B".into()),
            CellValue::number(1.0),
            CellValue::number(100.0),
        ],
        vec![
            CellValue::Text("C".into()),
            CellValue::number(50.0),
            CellValue::number(50.0),
        ],
    ];
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Top,
            n: 1.0,
            by: TopBottomBy::Items,
            value_field_index: Some(1), // use second value field
        }),
        show_items_with_no_data: true,
    };
    // Two value placements: (col1, Sum) and (col2, Sum)
    let value_col_indices = vec![
        (1usize, AggregateFunction::Sum),
        (2usize, AggregateFunction::Sum),
    ];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    // By Items keeps one item, ranked by the selected second value field.
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], 1); // B has 100 in the second value field
}

// -- Non-numeric aggregate fallback in resolved path --------------------------

#[test]
fn resolved_top_bottom_non_numeric_aggregate_fallback() {
    // Data where the value column has only text values -> aggregate returns non-Number -> 0.0.
    let data = vec![
        vec![CellValue::Text("A".into()), CellValue::Text("foo".into())],
        vec![CellValue::Text("B".into()), CellValue::Text("bar".into())],
        vec![CellValue::Text("C".into()), CellValue::Text("baz".into())],
    ];
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Top,
            n: 1.0,
            by: TopBottomBy::Sum,
            value_field_index: Some(0),
        }),
        show_items_with_no_data: true,
    };
    let value_col_indices = vec![(1usize, AggregateFunction::Sum)];
    let result = apply_filters_resolved(&data, indices, &[filter], &value_col_indices);
    // All groups have aggregate 0.0 (non-numeric fallback) -> all tied -> all included.
    assert_eq!(result.len(), 3);
}

// -- Empty include/exclude guards in resolved path ----------------------------

#[test]
fn resolved_empty_include_list_no_op() {
    // An empty include list should NOT filter anything.
    let data = vec![
        vec![CellValue::Text("A".into())],
        vec![CellValue::Text("B".into())],
    ];
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("f"),
        field_column_index: 0,
        include_values: Some(vec![]), // empty
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: true,
    };
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Empty include list -> no-op -> all rows pass
    assert_eq!(result.len(), 2);
}

#[test]
fn resolved_empty_exclude_list_no_op() {
    // An empty exclude list should NOT filter anything.
    let data = vec![
        vec![CellValue::Text("A".into())],
        vec![CellValue::Text("B".into())],
    ];
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("f"),
        field_column_index: 0,
        include_values: None,
        exclude_values: Some(vec![]), // empty
        condition: None,
        top_bottom: None,
        show_items_with_no_data: true,
    };
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Empty exclude list -> no-op -> all rows pass
    assert_eq!(result.len(), 2);
}

#[test]
fn resolved_include_and_exclude_lists() {
    // Non-empty include + exclude lists exercising the resolved path.
    let data = vec![
        vec![CellValue::Text("A".into())],
        vec![CellValue::Text("B".into())],
        vec![CellValue::Text("C".into())],
    ];
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("f"),
        field_column_index: 0,
        include_values: Some(vec![
            CellValue::Text("A".into()),
            CellValue::Text("B".into()),
        ]),
        exclude_values: Some(vec![CellValue::Text("B".into())]),
        condition: None,
        top_bottom: None,
        show_items_with_no_data: true,
    };
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Include {A, B}, then exclude {B} -> only A
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], 0);
}

// -- Resolved condition (non-average) path ------------------------------------

#[test]
fn resolved_condition_greater_than() {
    // Exercise the `_ =>` branch of condition matching in the resolved path.
    let data = numeric_data(); // col 0: 1,2,3,4,5
    let indices = all_indices(&data);
    let filter = make_resolved_filter(
        0,
        Some(PivotFilterCondition::Unary {
            op: UnaryFilterOp::GreaterThan,
            value: CellValue::number(3.0),
        }),
        None,
    );
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // >3: 4, 5
    assert_eq!(result.len(), 2);
    assert_eq!(result[0], 3);
    assert_eq!(result[1], 4);
}

// -- Resolved top/bottom returns all when no value column for Sum/Percent ------

#[test]
fn resolved_top_bottom_returns_all_when_no_value_column() {
    let data = resolved_tb_data();
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("cat"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(ResolvedTopBottom {
            filter_type: TopBottomType::Top,
            n: 1.0,
            by: TopBottomBy::Sum,
            value_field_index: Some(0),
        }),
        show_items_with_no_data: true,
    };
    // No value columns at all -> rank_info is None -> returns all.
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    assert_eq!(result.len(), 4);
}

// -- Resolved blank removal path -----------------------------------------------

#[test]
fn resolved_blank_removal_when_show_no_data_false() {
    let data = vec![
        vec![CellValue::Text("A".into())],
        vec![CellValue::Null],
        vec![CellValue::Text("".into())],
        vec![CellValue::Text("B".into())],
    ];
    let indices = all_indices(&data);
    let filter = ResolvedFilter {
        field_id: FieldId::from("f"),
        field_column_index: 0,
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: false,
    };
    let result = apply_filters_resolved(&data, indices, &[filter], &[]);
    // Blanks removed: only "A" and "B"
    assert_eq!(result.len(), 2);
    assert_eq!(result[0], 0);
    assert_eq!(result[1], 3);
}
