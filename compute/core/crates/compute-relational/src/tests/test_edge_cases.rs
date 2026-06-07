use super::helpers::*;
use crate::engine::execute;
use crate::error::RelationalError;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_single_row() {
    let data = vec![
        vec![text("Category"), text("Amount")],
        vec![text("Only"), num(42.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Category", 0)],
        measures: vec![sum_measure("Amount", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.source_row_count, 1);
    assert_eq!(result.filtered_row_count, 1);
    assert_eq!(result.row_tree.len(), 1);

    let only = &result.row_tree[0];
    assert_eq!(only.value, text("Only"));
    assert_eq!(only.values[0], num(42.0));
    assert!(only.is_leaf());
}

#[test]
fn measure_window_is_rejected_as_unsupported_semantic_owner() {
    let data = vec![
        vec![text("Region"), text("Revenue")],
        vec![text("East"), num(100.0)],
    ];
    let mut measure = sum_measure("revenue", 1);
    measure.window = Some(WindowFunction::PercentOfGrandTotal);
    let mut query = base_query();
    query.row_fields = vec![identity_field("region", 0)];
    query.measures = vec![measure];

    let err = execute(&query, &data).expect_err("window functions must be rejected");

    assert!(matches!(
        err,
        RelationalError::UnsupportedWindowFunction { measure_id } if measure_id == "revenue"
    ));
}

#[test]
fn test_no_measures_no_crash() {
    let data = vec![
        vec![text("Region")],
        vec![text("North")],
        vec![text("South")],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();
    assert_eq!(result.row_tree.len(), 2);
    // No measures means empty values
    assert!(result.row_tree[0].values.is_empty());
}

/// pivot framing sub-scope C.1: pin the engine-layer contract under empty measures.
///
/// `compute_grand_totals` must return `None` for `row` / `column` / `corner`
/// when there are no measures — there are no value totals to compute. The
/// presenter is responsible for producing label-only `Some(Vec::new())`
/// framing values from `(row_placements, column_placements, layout)`. This
/// test exists to prevent a future refactor from baking framing into the
/// engine layer (which would conflate values with structure).
#[test]
fn test_no_measures_grand_totals_shape() {
    let data = vec![
        vec![text("Region")],
        vec![text("North")],
        vec![text("South")],
        vec![text("East")],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![],
        measures: vec![],
        filters: vec![],
        calculated_measures: vec![],
        subtotals: SubtotalConfig {
            enabled: vec![false],
        },
        grand_totals: GrandTotalConfig {
            show_row: true,
            show_column: false,
        },
    };

    let result = execute(&query, &data).unwrap();

    // Engine layer: None is correct (no values to total).
    // Framing-only fallbacks are the presenter's job, not the engine's.
    assert!(
        result.grand_totals.row.is_none(),
        "engine must return None for row grand totals under empty measures, got {:?}",
        result.grand_totals.row,
    );
    assert!(
        result.grand_totals.column.is_none(),
        "engine must return None for column grand totals under empty measures, got {:?}",
        result.grand_totals.column,
    );
    assert!(
        result.grand_totals.corner.is_none(),
        "engine must return None for corner grand total under empty measures, got {:?}",
        result.grand_totals.corner,
    );
}

#[test]
fn test_duplicate_values_in_grouping() {
    // All rows have same group key
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("Same"), num(10.0)],
        vec![text("Same"), num(20.0)],
        vec![text("Same"), num(30.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 1);
    assert_eq!(result.row_tree[0].values[0], num(60.0));
    assert_eq!(result.row_tree[0].row_indices.len(), 3);
}

#[test]
fn test_null_in_grouping_field() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![CellValue::Null, num(200.0)],
        vec![text("South"), num(300.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Region".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Region".to_string(),
            column_index: 0,
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: true, // explicitly allow blanks
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Should have 3 groups: (blank), North, South
    // The null row should appear as some group
    assert_eq!(result.filtered_row_count, 3);
    assert_eq!(result.row_tree.len(), 3);
    assert_eq!(result.row_tree[0].value, CellValue::Null);
    assert_eq!(result.row_tree[1].value, text("North"));
    assert_eq!(result.row_tree[2].value, text("South"));

    // All values should sum correctly
    let total: f64 = result
        .row_tree
        .iter()
        .map(|n| match &n.values[0] {
            CellValue::Number(n) => n.get(),
            _ => 0.0,
        })
        .sum();
    assert!((total - 600.0).abs() < f64::EPSILON);
}

#[test]
fn test_group_explosion_error() {
    // Two row fields: 400 distinct values x 300 distinct values = 120,000 nodes
    // at the leaf level, plus 400 at the first level = 120,400 > 100,000.
    // This must trigger GroupExplosion.
    let mut data = vec![vec![text("F1"), text("F2"), text("Val")]]; // header

    for i in 0..400 {
        for j in 0..300 {
            data.push(vec![
                text(&format!("A{i}")),
                text(&format!("B{j}")),
                num(1.0),
            ]);
        }
    }

    let query = RelationalQuery {
        row_fields: vec![identity_field("F1", 0), identity_field("F2", 1)],
        measures: vec![sum_measure("Val", 2)],
        ..base_query()
    };

    let result = execute(&query, &data);
    assert!(result.is_err(), "Expected GroupExplosion error");
    let err = result.unwrap_err();
    let err_msg = format!("{err}");
    assert!(
        err_msg.contains("100000") || err_msg.contains("100,000"),
        "Error should mention the 100,000 node limit, got: {err_msg}"
    );
}
