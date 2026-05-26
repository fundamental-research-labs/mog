use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_sort_by_value_descending() {
    // Data: Region | Sales
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("Alpha"), num(300.0)],
        vec![text("Beta"), num(100.0)],
        vec![text("Gamma"), num(200.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Region".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Value {
                    measure_index: 0,
                    column_key: None,
                },
                direction: SortDirection::Descending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);
    assert_eq!(result.row_tree[0].value, text("Alpha"));
    assert_eq!(result.row_tree[0].values[0], num(300.0));
    assert_eq!(result.row_tree[1].value, text("Gamma"));
    assert_eq!(result.row_tree[1].values[0], num(200.0));
    assert_eq!(result.row_tree[2].value, text("Beta"));
    assert_eq!(result.row_tree[2].values[0], num(100.0));
}

#[test]
fn test_sort_by_value_ascending() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("Alpha"), num(300.0)],
        vec![text("Beta"), num(100.0)],
        vec![text("Gamma"), num(200.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Region".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Value {
                    measure_index: 0,
                    column_key: None,
                },
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree[0].value, text("Beta"));
    assert_eq!(result.row_tree[0].values[0], num(100.0));
    assert_eq!(result.row_tree[1].value, text("Gamma"));
    assert_eq!(result.row_tree[1].values[0], num(200.0));
    assert_eq!(result.row_tree[2].value, text("Alpha"));
    assert_eq!(result.row_tree[2].values[0], num(300.0));
}

#[test]
fn test_custom_sort_order() {
    let data = vec![
        vec![text("Category"), text("Sales")],
        vec![text("Alpha"), num(10.0)],
        vec![text("Beta"), num(20.0)],
        vec![text("Gamma"), num(30.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Category".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: Some(vec![text("Gamma"), text("Alpha"), text("Beta")]),
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    // Output order must follow custom_order: Gamma, Alpha, Beta
    assert_eq!(result.row_tree[0].value, text("Gamma"));
    assert_eq!(result.row_tree[0].values[0], num(30.0));
    assert_eq!(result.row_tree[1].value, text("Alpha"));
    assert_eq!(result.row_tree[1].values[0], num(10.0));
    assert_eq!(result.row_tree[2].value, text("Beta"));
    assert_eq!(result.row_tree[2].values[0], num(20.0));
}

#[test]
fn test_label_sort_descending() {
    let data = vec![
        vec![text("Name"), text("Score")],
        vec![text("A"), num(1.0)],
        vec![text("B"), num(2.0)],
        vec![text("C"), num(3.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Name".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Descending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Score", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    // Descending label order: C, B, A
    assert_eq!(result.row_tree[0].value, text("C"));
    assert_eq!(result.row_tree[0].values[0], num(3.0));
    assert_eq!(result.row_tree[1].value, text("B"));
    assert_eq!(result.row_tree[1].values[0], num(2.0));
    assert_eq!(result.row_tree[2].value, text("A"));
    assert_eq!(result.row_tree[2].values[0], num(1.0));
}

#[test]
fn test_column_sort_by_value() {
    // Data: Region | Product | Sales
    // Widget has more total sales than Gadget, so descending should put Widget first
    let data = vec![
        vec![text("Region"), text("Product"), text("Sales")],
        vec![text("North"), text("Widget"), num(500.0)],
        vec![text("North"), text("Gadget"), num(100.0)],
        vec![text("South"), text("Widget"), num(300.0)],
        vec![text("South"), text("Gadget"), num(50.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![GroupField {
            id: "Product".to_string(),
            column_index: 1,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Value {
                    measure_index: 0,
                    column_key: None,
                },
                direction: SortDirection::Descending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Column tree should be sorted: Widget (800) before Gadget (150)
    assert_eq!(result.column_tree.len(), 2);
    assert_eq!(result.column_tree[0].value, text("Widget"));
    assert_eq!(result.column_tree[1].value, text("Gadget"));

    // column_leaf_keys should follow the same order
    assert!(result.column_leaf_keys[0].to_lowercase().contains("widget"));
    assert!(result.column_leaf_keys[1].to_lowercase().contains("gadget"));
}

#[test]
fn test_sort_by_value_with_column_key() {
    // Cross-tab: Row=Region, Column=Product, Measure=Sum(Sales).
    // Sort rows descending by value in the "Gadget" column only.
    //
    // Data matrix (Region x Product):
    //   North: Widget=500, Gadget=100
    //   South: Widget=100, Gadget=300
    //   East:  Widget=200, Gadget=200
    //
    // Gadget column key = "T:gadget" (cell_value_to_key lowercases text, prefixes "T:").
    // Sort descending by Gadget -> South(300), East(200), North(100).
    let data = vec![
        vec![text("Region"), text("Product"), text("Sales")],
        vec![text("North"), text("Widget"), num(500.0)],
        vec![text("North"), text("Gadget"), num(100.0)],
        vec![text("South"), text("Widget"), num(100.0)],
        vec![text("South"), text("Gadget"), num(300.0)],
        vec![text("East"), text("Widget"), num(200.0)],
        vec![text("East"), text("Gadget"), num(200.0)],
    ];

    // First, run without sort to discover the exact column_leaf_key for Gadget.
    let probe_query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![identity_field("Product", 1)],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };
    let probe = execute(&probe_query, &data).unwrap();
    let gadget_key = probe
        .column_leaf_keys
        .iter()
        .find(|k| k.to_lowercase().contains("gadget"))
        .expect("Gadget column key not found")
        .clone();

    // Now sort by value with column_key pointing at the Gadget column.
    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Region".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Value {
                    measure_index: 0,
                    column_key: Some(gadget_key),
                },
                direction: SortDirection::Descending,
                custom_order: None,
            },
        }],
        column_fields: vec![identity_field("Product", 1)],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Descending by Gadget column: South(300) > East(200) > North(100).
    assert_eq!(result.row_tree.len(), 3);
    assert_eq!(result.row_tree[0].value, text("South"));
    assert_eq!(result.row_tree[1].value, text("East"));
    assert_eq!(result.row_tree[2].value, text("North"));

    // Verify the actual Gadget values to confirm sorting used the right column.
    let gadget_idx = result
        .column_leaf_keys
        .iter()
        .position(|k| k.to_lowercase().contains("gadget"))
        .unwrap();
    // With 1 measure, value_index = gadget_idx * 1 + 0 = gadget_idx.
    assert_eq!(result.row_tree[0].values[gadget_idx], num(300.0));
    assert_eq!(result.row_tree[1].values[gadget_idx], num(200.0));
    assert_eq!(result.row_tree[2].values[gadget_idx], num(100.0));
}

#[test]
fn test_sort_by_value_nulls_sort_last() {
    // Row=Category, Measure=Max(Val).
    // Max of all-Null values returns CellValue::Null (non-numeric),
    // which sort_value_opt maps to None -> sorts last regardless of direction.
    //
    // Category A: Val=30 -> Max=30
    // Category B: Val=Null -> Max=Null (no numeric values)
    // Category C: Val=10 -> Max=10
    let data = vec![
        vec![text("Category"), text("Val")],
        vec![text("A"), num(30.0)],
        vec![text("B"), CellValue::Null],
        vec![text("C"), num(10.0)],
    ];

    // Sort ascending by value.
    // Numeric groups ascending: C(10) < A(30). Null group B sorts last.
    // Expected: C, A, B.
    let query_asc = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Category".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Value {
                    measure_index: 0,
                    column_key: None,
                },
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![make_measure("Val", 1, AggregateFunction::Max)],
        ..base_query()
    };

    let result_asc = execute(&query_asc, &data).unwrap();
    assert_eq!(result_asc.row_tree.len(), 3);
    assert_eq!(result_asc.row_tree[0].value, text("C")); // 10
    assert_eq!(result_asc.row_tree[1].value, text("A")); // 30
    assert_eq!(result_asc.row_tree[2].value, text("B")); // Null -> last

    // Sort descending by value.
    // Numeric groups descending: A(30) > C(10). Null group B still last.
    // Expected: A, C, B.
    let query_desc = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Category".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Identity,
            sort: SortConfig {
                sort_by: SortBy::Value {
                    measure_index: 0,
                    column_key: None,
                },
                direction: SortDirection::Descending,
                custom_order: None,
            },
        }],
        measures: vec![make_measure("Val", 1, AggregateFunction::Max)],
        ..base_query()
    };

    let result_desc = execute(&query_desc, &data).unwrap();
    assert_eq!(result_desc.row_tree.len(), 3);
    assert_eq!(result_desc.row_tree[0].value, text("A")); // 30
    assert_eq!(result_desc.row_tree[1].value, text("C")); // 10
    assert_eq!(result_desc.row_tree[2].value, text("B")); // Null -> last
}

#[test]
fn test_sort_by_value_on_inner_field() {
    // Two row fields: Region (outer), City (inner).
    // Sort the INNER field (depth=1) by value descending.
    // This exercises recursive sort_at_depth with depth > 0.
    //
    // Data:
    //   North, NYC,     100
    //   North, Boston,  200
    //   North, Chicago,  50
    //   South, Miami,   300
    //   South, Atlanta, 100
    //
    // Inner field sorted descending by Sum(Sales):
    //   North children: Boston(200), NYC(100), Chicago(50)
    //   South children: Miami(300), Atlanta(100)
    let data = vec![
        vec![text("Region"), text("City"), text("Sales")],
        vec![text("North"), text("NYC"), num(100.0)],
        vec![text("North"), text("Boston"), num(200.0)],
        vec![text("North"), text("Chicago"), num(50.0)],
        vec![text("South"), text("Miami"), num(300.0)],
        vec![text("South"), text("Atlanta"), num(100.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![
            identity_field("Region", 0), // outer -- label sort (default ascending)
            GroupField {
                id: "City".to_string(),
                column_index: 1,
                grouping: GroupingStrategy::Identity,
                sort: SortConfig {
                    sort_by: SortBy::Value {
                        measure_index: 0,
                        column_key: None,
                    },
                    direction: SortDirection::Descending,
                    custom_order: None,
                },
            },
        ],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Outer nodes sorted alphabetically (label sort): North, South.
    assert_eq!(result.row_tree.len(), 2);
    assert_eq!(result.row_tree[0].value, text("North"));
    assert_eq!(result.row_tree[1].value, text("South"));

    // North's children sorted descending by value.
    let north = &result.row_tree[0];
    assert_eq!(north.children.len(), 3);
    assert_eq!(north.children[0].value, text("Boston"));
    assert_eq!(north.children[0].values[0], num(200.0));
    assert_eq!(north.children[1].value, text("NYC"));
    assert_eq!(north.children[1].values[0], num(100.0));
    assert_eq!(north.children[2].value, text("Chicago"));
    assert_eq!(north.children[2].values[0], num(50.0));

    // South's children sorted descending by value.
    let south = &result.row_tree[1];
    assert_eq!(south.children.len(), 2);
    assert_eq!(south.children[0].value, text("Miami"));
    assert_eq!(south.children[0].values[0], num(300.0));
    assert_eq!(south.children[1].value, text("Atlanta"));
    assert_eq!(south.children[1].values[0], num(100.0));
}

#[test]
fn test_sort_by_value_hierarchical_uses_subtotals() {
    // Two row fields: Region (outer, sort by value desc), City (inner).
    // When sorting the outer field by value, sort_value_opt uses
    // subtotal_values (aggregated over all descendant rows), not leaf values.
    //
    // Data:
    //   East,    Springfield, 10
    //   East,    Portland,    20
    //   West,    Denver,     500
    //   West,    Seattle,    100
    //   Central, Dallas,      50
    //
    // Region subtotals: East=10+20=30, West=500+100=600, Central=50.
    // Sort outer descending by subtotal -> West(600), Central(50), East(30).
    let data = vec![
        vec![text("Region"), text("City"), text("Sales")],
        vec![text("East"), text("Springfield"), num(10.0)],
        vec![text("East"), text("Portland"), num(20.0)],
        vec![text("West"), text("Denver"), num(500.0)],
        vec![text("West"), text("Seattle"), num(100.0)],
        vec![text("Central"), text("Dallas"), num(50.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![
            GroupField {
                id: "Region".to_string(),
                column_index: 0,
                grouping: GroupingStrategy::Identity,
                sort: SortConfig {
                    sort_by: SortBy::Value {
                        measure_index: 0,
                        column_key: None,
                    },
                    direction: SortDirection::Descending,
                    custom_order: None,
                },
            },
            identity_field("City", 1), // inner -- label sort (default ascending)
        ],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Outer nodes sorted descending by subtotal value.
    assert_eq!(result.row_tree.len(), 3);
    assert_eq!(result.row_tree[0].value, text("West"));
    assert_eq!(result.row_tree[1].value, text("Central"));
    assert_eq!(result.row_tree[2].value, text("East"));

    // Verify subtotal values match expectations.
    let west = &result.row_tree[0];
    let west_subtotal = west
        .subtotal_values
        .as_ref()
        .expect("West should have subtotals");
    assert_eq!(west_subtotal[0], num(600.0));

    let central = &result.row_tree[1];
    let central_subtotal = central
        .subtotal_values
        .as_ref()
        .expect("Central should have subtotals");
    assert_eq!(central_subtotal[0], num(50.0));

    let east = &result.row_tree[2];
    let east_subtotal = east
        .subtotal_values
        .as_ref()
        .expect("East should have subtotals");
    assert_eq!(east_subtotal[0], num(30.0));

    // Inner cities should be sorted alphabetically (label ascending, the default).
    assert_eq!(west.children.len(), 2);
    assert_eq!(west.children[0].value, text("Denver"));
    assert_eq!(west.children[1].value, text("Seattle"));

    assert_eq!(east.children.len(), 2);
    assert_eq!(east.children[0].value, text("Portland"));
    assert_eq!(east.children[1].value, text("Springfield"));
}
