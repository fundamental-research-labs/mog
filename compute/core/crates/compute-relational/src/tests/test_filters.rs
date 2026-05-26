use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_include_filter() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![text("South"), num(200.0)],
        vec![text("East"), num(300.0)],
        vec![text("West"), num(400.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Region".to_string(),
            column_index: 0,
            include_values: Some(vec![text("North"), text("South")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: false,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("North")));
    assert!(labels.contains(&&text("South")));
}

#[test]
fn test_exclude_filter() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![text("South"), num(200.0)],
        vec![text("East"), num(300.0)],
        vec![text("West"), num(400.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Region".to_string(),
            column_index: 0,
            include_values: None,
            exclude_values: Some(vec![text("East"), text("West")]),
            condition: None,
            top_bottom: None,
            show_items_with_no_data: false,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);
    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("North")));
    assert!(labels.contains(&&text("South")));
}

#[test]
fn test_empty_after_filtering() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![text("South"), num(200.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Region".to_string(),
            column_index: 0,
            include_values: Some(vec![text("NonExistent")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: false,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 0);
    assert!(result.row_tree.is_empty());
}

#[test]
fn test_blank_removal_default() {
    // When show_items_with_no_data=false (default) and no explicit include/exclude,
    // blank/null values in the filter field should be removed.
    //
    // Data has 4 rows: North, Null, South, Null
    // After blank removal: North, South (2 rows survive).
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![CellValue::Null, num(200.0)],
        vec![text("South"), num(300.0)],
        vec![CellValue::Null, num(400.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Region".to_string(),
            column_index: 0,
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: false, // default: blanks removed
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Only non-blank rows survive.
    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("North")));
    assert!(labels.contains(&&text("South")));

    // Verify aggregated values: North=100, South=300.
    let north = find_node(&result.row_tree, "North");
    assert_eq!(north.values[0], num(100.0));
    let south = find_node(&result.row_tree, "South");
    assert_eq!(south.values[0], num(300.0));
}

#[test]
fn test_blank_removal_preserved_when_explicitly_included() {
    // When show_items_with_no_data=false BUT include_values contains a blank (Null),
    // blank rows should NOT be removed -- the explicit include overrides blank removal.
    //
    // Data: North, Null, South
    // include_values: [Null, "North"]
    // After include filter: rows with Null or North survive (2 rows).
    // Blank removal step: blanks_explicitly_included=true -> skip removal.
    // Result: 2 rows (North + blank group).
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![CellValue::Null, num(200.0)],
        vec![text("South"), num(300.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Region".to_string(),
            column_index: 0,
            include_values: Some(vec![CellValue::Null, text("North")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: false, // would normally remove blanks
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Both North and the blank row survive.
    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    // North should have Sales=100.
    let north = find_node(&result.row_tree, "North");
    assert_eq!(north.values[0], num(100.0));

    // The total across both groups should be 100 + 200 = 300.
    let total: f64 = result
        .row_tree
        .iter()
        .map(|n| match &n.values[0] {
            CellValue::Number(v) => v.get(),
            _ => 0.0,
        })
        .sum();
    assert!((total - 300.0).abs() < f64::EPSILON);
}

#[test]
fn test_filter_condition_above_average() {
    // Data: Region | Sales
    // Sales values: 10, 20, 30, 40, 50
    // Average = (10 + 20 + 30 + 40 + 50) / 5 = 150 / 5 = 30.0
    // AboveAverage keeps rows strictly > 30 => 40 and 50
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(10.0)],
        vec![text("B"), num(20.0)],
        vec![text("C"), num(30.0)],
        vec![text("D"), num(40.0)],
        vec![text("E"), num(50.0)],
    ];

    use compute_stats::types::{NullaryFilterOp, PivotFilterCondition};

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Sales".to_string(),
            column_index: 1,
            include_values: None,
            exclude_values: None,
            condition: Some(FilterCondition::Pivot(PivotFilterCondition::Nullary(
                NullaryFilterOp::AboveAverage,
            ))),
            top_bottom: None,
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("D")));
    assert!(labels.contains(&&text("E")));

    let d = find_node(&result.row_tree, "D");
    assert_eq!(d.values[0], num(40.0));
    let e = find_node(&result.row_tree, "E");
    assert_eq!(e.values[0], num(50.0));
}

#[test]
fn test_filter_condition_below_average() {
    // Same data. Average = 30.0. BelowAverage keeps rows strictly < 30 => 10 and 20
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(10.0)],
        vec![text("B"), num(20.0)],
        vec![text("C"), num(30.0)],
        vec![text("D"), num(40.0)],
        vec![text("E"), num(50.0)],
    ];

    use compute_stats::types::{NullaryFilterOp, PivotFilterCondition};

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Sales".to_string(),
            column_index: 1,
            include_values: None,
            exclude_values: None,
            condition: Some(FilterCondition::Pivot(PivotFilterCondition::Nullary(
                NullaryFilterOp::BelowAverage,
            ))),
            top_bottom: None,
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("A")));
    assert!(labels.contains(&&text("B")));

    let a = find_node(&result.row_tree, "A");
    assert_eq!(a.values[0], num(10.0));
    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(20.0));
}

#[test]
fn test_filter_condition_greater_than() {
    // Sales values: 10, 20, 30, 40, 50. Filter: Sales > 25.
    // Surviving rows: 30, 40, 50 (3 rows).
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(10.0)],
        vec![text("B"), num(20.0)],
        vec![text("C"), num(30.0)],
        vec![text("D"), num(40.0)],
        vec![text("E"), num(50.0)],
    ];

    use compute_stats::types::{PivotFilterCondition, UnaryFilterOp};

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Sales".to_string(),
            column_index: 1,
            include_values: None,
            exclude_values: None,
            condition: Some(FilterCondition::Pivot(PivotFilterCondition::Unary {
                op: UnaryFilterOp::GreaterThan,
                value: num(25.0),
            })),
            top_bottom: None,
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 3);
    assert_eq!(result.row_tree.len(), 3);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("C")));
    assert!(labels.contains(&&text("D")));
    assert!(labels.contains(&&text("E")));

    let c = find_node(&result.row_tree, "C");
    assert_eq!(c.values[0], num(30.0));
}

#[test]
fn test_filter_condition_between() {
    // Sales values: 10, 20, 30, 40, 50. Filter: 20 <= Sales <= 40.
    // Surviving rows: 20, 30, 40 (3 rows).
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(10.0)],
        vec![text("B"), num(20.0)],
        vec![text("C"), num(30.0)],
        vec![text("D"), num(40.0)],
        vec![text("E"), num(50.0)],
    ];

    use compute_stats::types::{BinaryFilterOp, PivotFilterCondition};

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Sales".to_string(),
            column_index: 1,
            include_values: None,
            exclude_values: None,
            condition: Some(FilterCondition::Pivot(PivotFilterCondition::Binary {
                op: BinaryFilterOp::Between,
                value: num(20.0),
                value2: num(40.0),
            })),
            top_bottom: None,
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 3);
    assert_eq!(result.row_tree.len(), 3);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("B")));
    assert!(labels.contains(&&text("C")));
    assert!(labels.contains(&&text("D")));

    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(20.0));
    let d = find_node(&result.row_tree, "D");
    assert_eq!(d.values[0], num(40.0));
}

#[test]
fn test_filter_condition_is_blank() {
    // Mix of values and blanks. IsBlank keeps only Null/blank rows.
    // Rows: A=10, B=Null, C=30, D=Null => 2 blank rows survive.
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(10.0)],
        vec![text("B"), CellValue::Null],
        vec![text("C"), num(30.0)],
        vec![text("D"), CellValue::Null],
    ];

    use compute_stats::types::{NullaryFilterOp, PivotFilterCondition};

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Sales".to_string(),
            column_index: 1,
            include_values: None,
            exclude_values: None,
            condition: Some(FilterCondition::Pivot(PivotFilterCondition::Nullary(
                NullaryFilterOp::IsBlank,
            ))),
            top_bottom: None,
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("B")));
    assert!(labels.contains(&&text("D")));
}

#[test]
fn test_filter_combined_include_and_condition() {
    // Region | Sales
    // North  | 10
    // North  | 40
    // South  | 20
    // South  | 50
    // East   | 30
    // East   | 60
    //
    // Step 1: Include filter on Region keeps only North and South (4 rows).
    // Step 2: AboveAverage on Sales among surviving rows.
    //   Surviving Sales values: 10, 40, 20, 50. Average = 120 / 4 = 30.0.
    //   Rows strictly > 30: 40 (North) and 50 (South). => 2 rows survive.
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(10.0)],
        vec![text("North"), num(40.0)],
        vec![text("South"), num(20.0)],
        vec![text("South"), num(50.0)],
        vec![text("East"), num(30.0)],
        vec![text("East"), num(60.0)],
    ];

    use compute_stats::types::{NullaryFilterOp, PivotFilterCondition};

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![
            // First filter: include only North and South
            QueryFilter {
                field_id: "Region".to_string(),
                column_index: 0,
                include_values: Some(vec![text("North"), text("South")]),
                exclude_values: None,
                condition: None,
                top_bottom: None,
                show_items_with_no_data: false,
            },
            // Second filter: above average on Sales
            QueryFilter {
                field_id: "Sales".to_string(),
                column_index: 1,
                include_values: None,
                exclude_values: None,
                condition: Some(FilterCondition::Pivot(PivotFilterCondition::Nullary(
                    NullaryFilterOp::AboveAverage,
                ))),
                top_bottom: None,
                show_items_with_no_data: true,
            },
        ],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // 2 rows survive: North(40) and South(50)
    assert_eq!(result.filtered_row_count, 2);
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<&CellValue> = result.row_tree.iter().map(|n| &n.value).collect();
    assert!(labels.contains(&&text("North")));
    assert!(labels.contains(&&text("South")));

    // Each group has exactly 1 surviving row
    let north = find_node(&result.row_tree, "North");
    assert_eq!(north.values[0], num(40.0));
    let south = find_node(&result.row_tree, "South");
    assert_eq!(south.values[0], num(50.0));
}
