use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_top_bottom_top_n_by_count() {
    // TopBottomBy::Count ranks groups by their ROW COUNT (not measure aggregate).
    //
    // Region  | Sales   | row count
    // East    | 10,20,30,40,50 => 5 rows
    // West    | 50,50,50,50    => 4 rows
    // North   | 40,30,20       => 3 rows
    // South   | 5,10            => 2 rows
    // Central | 25              => 1 row
    //
    // Top 2 by count => sorted desc by row count: East(5), West(4), North(3), South(2), Central(1)
    // Keep 2 => East, West
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("East"), num(10.0)],
        vec![text("East"), num(20.0)],
        vec![text("East"), num(30.0)],
        vec![text("East"), num(40.0)],
        vec![text("East"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("North"), num(40.0)],
        vec![text("North"), num(30.0)],
        vec![text("North"), num(20.0)],
        vec![text("South"), num(5.0)],
        vec![text("South"), num(10.0)],
        vec![text("Central"), num(25.0)],
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
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 2.0,
                by: TopBottomBy::Count,
                measure_index: Some(0),
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Only 2 groups survive (East and West).
    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();
    assert!(labels.contains(&"East".to_string()), "labels: {labels:?}");
    assert!(labels.contains(&"West".to_string()), "labels: {labels:?}");

    // Verify aggregate values.
    let east = find_node(&result.row_tree, "East");
    assert_eq!(east.values[0], num(150.0)); // 10+20+30+40+50
    let west = find_node(&result.row_tree, "West");
    assert_eq!(west.values[0], num(200.0)); // 50*4

    // Filtered row count: East(5 rows) + West(4 rows) = 9 rows.
    assert_eq!(result.filtered_row_count, 9);
}

#[test]
fn test_top_bottom_bottom_n_by_count() {
    // Same data as top_n test. Bottom 2 by row count.
    // Sorted asc by row count: Central(1), South(2), North(3), West(4), East(5)
    // Bottom 2 => Central, South
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("East"), num(10.0)],
        vec![text("East"), num(20.0)],
        vec![text("East"), num(30.0)],
        vec![text("East"), num(40.0)],
        vec![text("East"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("West"), num(50.0)],
        vec![text("North"), num(40.0)],
        vec![text("North"), num(30.0)],
        vec![text("North"), num(20.0)],
        vec![text("South"), num(5.0)],
        vec![text("South"), num(10.0)],
        vec![text("Central"), num(25.0)],
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
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Bottom,
                n: 2.0,
                by: TopBottomBy::Count,
                measure_index: Some(0),
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();
    assert!(
        labels.contains(&"Central".to_string()),
        "labels: {labels:?}"
    );
    assert!(labels.contains(&"South".to_string()), "labels: {labels:?}");

    let central = find_node(&result.row_tree, "Central");
    assert_eq!(central.values[0], num(25.0)); // single row
    let south = find_node(&result.row_tree, "South");
    assert_eq!(south.values[0], num(15.0)); // 5 + 10

    // Central(1 row) + South(2 rows) = 3 rows survive.
    assert_eq!(result.filtered_row_count, 3);
}

#[test]
fn test_top_bottom_top_n_items_ranked_by_measure() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("East"), num(150.0)],
        vec![text("North"), num(250.0)],
        vec![text("South"), num(450.0)],
        vec![text("West"), num(350.0)],
        vec![text("Central"), num(100.0)],
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
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 3.0,
                by: TopBottomBy::Items,
                measure_index: Some(0),
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();
    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();

    assert_eq!(labels, vec!["North", "South", "West"]);
}

#[test]
fn test_top_bottom_by_percent() {
    // 4 groups. TopBottomBy::Percent with n=50.0.
    // keep_count = ceil(4 * 50 / 100) = ceil(2.0) = 2 groups.
    //
    // Group | Sales
    // A     | 400
    // B     | 300
    // C     | 200
    // D     | 100
    //
    // Top by percent, sorted desc: A(400), B(300), C(200), D(100)
    // Keep 2 => A, B
    let data = vec![
        vec![text("Group"), text("Sales")],
        vec![text("A"), num(400.0)],
        vec![text("B"), num(300.0)],
        vec![text("C"), num(200.0)],
        vec![text("D"), num(100.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Group".to_string(),
            column_index: 0,
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 50.0,
                by: TopBottomBy::Percent,
                measure_index: Some(0),
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 2);

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();
    assert!(labels.contains(&"A".to_string()), "labels: {labels:?}");
    assert!(labels.contains(&"B".to_string()), "labels: {labels:?}");

    let a = find_node(&result.row_tree, "A");
    assert_eq!(a.values[0], num(400.0));
    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(300.0));
}

#[test]
fn test_top_bottom_by_sum() {
    // Groups with aggregate values: 100, 80, 60, 40, 20.
    // TopBottomBy::Sum with n=200, Top filter.
    // Sorted desc: 100, 80, 60, 40, 20
    // Cumulative: 100 < 200, 100+80=180 < 200, 100+80+60=240 >= 200 => stop at 3.
    // Keep 3 groups: the ones with aggregates 100, 80, 60.
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(100.0)],
        vec![text("B"), num(80.0)],
        vec![text("C"), num(60.0)],
        vec![text("D"), num(40.0)],
        vec![text("E"), num(20.0)],
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
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 200.0,
                by: TopBottomBy::Sum,
                measure_index: Some(0),
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();
    assert!(labels.contains(&"A".to_string()), "labels: {labels:?}");
    assert!(labels.contains(&"B".to_string()), "labels: {labels:?}");
    assert!(labels.contains(&"C".to_string()), "labels: {labels:?}");

    let a = find_node(&result.row_tree, "A");
    assert_eq!(a.values[0], num(100.0));
    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(80.0));
    let c = find_node(&result.row_tree, "C");
    assert_eq!(c.values[0], num(60.0));

    assert_eq!(result.filtered_row_count, 3);
}

#[test]
fn test_top_bottom_tie_breaking() {
    // 4 groups where two groups tie at the boundary using TopBottomBy::Sum
    // (which ranks by measure aggregate, not row count).
    //
    // Group | Sales (sum)
    // A     | 100
    // B     | 70
    // C     | 70   (ties with B)
    // D     | 50
    //
    // Top 2 by Sum measure, sorted desc: A(100), B(70), C(70), D(50).
    // Initial keep_count = 2 (A, B).
    // Cutoff value = ranked[1].aggregate = 70.
    // ranked[2].aggregate = 70 == cutoff => extend to keep_count = 3.
    // ranked[3].aggregate = 50 != 70 => stop.
    // Result: 3 groups survive (A, B, C).
    //
    // We use TopBottomBy::Percent with n=50 => ceil(4 * 50 / 100) = 2 initial groups,
    // then tie-breaking extends to 3.
    let data = vec![
        vec![text("Group"), text("Sales")],
        vec![text("A"), num(100.0)],
        vec![text("B"), num(70.0)],
        vec![text("C"), num(70.0)],
        vec![text("D"), num(50.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![sum_measure("Sales", 1)],
        filters: vec![QueryFilter {
            field_id: "Group".to_string(),
            column_index: 0,
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 50.0,
                by: TopBottomBy::Percent,
                measure_index: Some(0),
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // ceil(4 * 50/100) = 2 initial groups, but tie at boundary (70 == 70)
    // pulls in the 3rd group.
    assert_eq!(
        result.row_tree.len(),
        3,
        "Expected 3 groups due to tie-breaking, got {}",
        result.row_tree.len()
    );

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();
    assert!(labels.contains(&"A".to_string()), "labels: {labels:?}");
    assert!(labels.contains(&"B".to_string()), "labels: {labels:?}");
    assert!(labels.contains(&"C".to_string()), "labels: {labels:?}");
    assert!(
        !labels.contains(&"D".to_string()),
        "D should be excluded, labels: {labels:?}"
    );

    let a = find_node(&result.row_tree, "A");
    assert_eq!(a.values[0], num(100.0));
    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(70.0));
    let c = find_node(&result.row_tree, "C");
    assert_eq!(c.values[0], num(70.0));

    assert_eq!(result.filtered_row_count, 3);
}

#[test]
fn test_top_bottom_no_valid_measure() {
    // TopBottomFilter with by=Sum but measure_index points to a nonexistent measure
    // (index 99 when there is only 1 measure at index 0).
    // The guard `rank_measure.is_none() && by != Count` should trigger,
    // returning all indices unchanged -- no filtering happens.
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("A"), num(100.0)],
        vec![text("B"), num(200.0)],
        vec![text("C"), num(300.0)],
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
            top_bottom: Some(TopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 1.0,
                by: TopBottomBy::Sum,
                measure_index: Some(99), // nonexistent measure index
            }),
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // All 3 groups should survive because the filter cannot rank without a valid measure.
    assert_eq!(result.row_tree.len(), 3);
    assert_eq!(result.filtered_row_count, 3);

    let a = find_node(&result.row_tree, "A");
    assert_eq!(a.values[0], num(100.0));
    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(200.0));
    let c = find_node(&result.row_tree, "C");
    assert_eq!(c.values[0], num(300.0));
}
