use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_cross_tabulation() {
    // Data: Region | Product | Sales
    let data = vec![
        vec![text("Region"), text("Product"), text("Sales")],
        vec![text("North"), text("Widget"), num(100.0)],
        vec![text("North"), text("Gadget"), num(200.0)],
        vec![text("South"), text("Widget"), num(150.0)],
        vec![text("South"), text("Gadget"), num(250.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![identity_field("Product", 1)],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 2);
    assert_eq!(result.column_tree.len(), 2); // Gadget, Widget (sorted ascending)

    // Column leaves sorted ascending: Gadget, Widget
    assert_eq!(result.column_leaf_keys.len(), 2);

    let north = find_node(&result.row_tree, "North");
    let south = find_node(&result.row_tree, "South");

    // values layout: [col0_m0, col1_m0] where col0=Gadget, col1=Widget (sorted ascending)
    assert_eq!(north.values.len(), 2);
    assert_eq!(south.values.len(), 2);

    // Determine column order by checking column_leaf_keys
    let gadget_idx = result
        .column_leaf_keys
        .iter()
        .position(|k| k.to_lowercase().contains("gadget"))
        .expect("Gadget column not found");
    let widget_idx = result
        .column_leaf_keys
        .iter()
        .position(|k| k.to_lowercase().contains("widget"))
        .expect("Widget column not found");

    // North: Gadget=200, Widget=100
    assert_eq!(north.values[gadget_idx], num(200.0));
    assert_eq!(north.values[widget_idx], num(100.0));

    // South: Gadget=250, Widget=150
    assert_eq!(south.values[gadget_idx], num(250.0));
    assert_eq!(south.values[widget_idx], num(150.0));
}

#[test]
fn test_column_leaves_hierarchical() {
    // Cross-tab with TWO column fields creating a hierarchical column tree.
    // Row = Region (col 0), Column fields = [Year (col 1), Product (col 2)].
    //
    // Data:
    //   North, 2023, Widget, 100
    //   North, 2023, Gadget, 200
    //   North, 2024, Widget, 150
    //   South, 2023, Widget, 300
    //
    // Column tree hierarchy: Year > Product.
    //   2023 -> Gadget, Widget
    //   2024 -> Widget
    //
    // column_leaves() should return leaf nodes: (2023,Gadget), (2023,Widget), (2024,Widget).
    let data = vec![
        vec![text("Region"), text("Year"), text("Product"), text("Sales")],
        vec![text("North"), num(2023.0), text("Widget"), num(100.0)],
        vec![text("North"), num(2023.0), text("Gadget"), num(200.0)],
        vec![text("North"), num(2024.0), text("Widget"), num(150.0)],
        vec![text("South"), num(2023.0), text("Widget"), num(300.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![identity_field("Year", 1), identity_field("Product", 2)],
        measures: vec![sum_measure("Sales", 3)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Column tree top-level: 2023, 2024 (sorted ascending by number).
    assert_eq!(result.column_tree.len(), 2);

    // Each top-level column node should have children (the Product level).
    let col_2023 = result
        .column_tree
        .iter()
        .find(|n| n.value == num(2023.0))
        .expect("column 2023");
    assert!(
        !col_2023.children.is_empty(),
        "2023 should have Product children"
    );
    // 2023 has both Gadget and Widget.
    assert_eq!(col_2023.children.len(), 2);

    let col_2024 = result
        .column_tree
        .iter()
        .find(|n| n.value == num(2024.0))
        .expect("column 2024");
    assert!(
        !col_2024.children.is_empty(),
        "2024 should have Product children"
    );
    // 2024 only has Widget.
    assert_eq!(col_2024.children.len(), 1);

    // column_leaves() should return 3 leaf nodes total.
    let leaves = result.column_leaves();
    assert_eq!(
        leaves.len(),
        3,
        "Expected 3 column leaves, got {}",
        leaves.len()
    );

    // column_leaf_keys should also have 3 entries.
    assert_eq!(result.column_leaf_keys.len(), 3);

    // Verify row tree values. With 3 column leaves and 1 measure, each row node
    // should have 3 values.
    let north = find_node(&result.row_tree, "North");
    assert_eq!(north.values.len(), 3);

    let south = find_node(&result.row_tree, "South");
    assert_eq!(south.values.len(), 3);

    // Verify that North's total across all column leaves is 100 + 200 + 150 = 450.
    let north_total: f64 = north
        .values
        .iter()
        .filter_map(|v| match v {
            CellValue::Number(n) => Some(n.get()),
            _ => None,
        })
        .sum();
    assert!(
        (north_total - 450.0).abs() < f64::EPSILON,
        "North total: {north_total}"
    );

    // South only has data for (2023, Widget) = 300. Other column leaves should be Null/0.
    let south_total: f64 = south
        .values
        .iter()
        .filter_map(|v| match v {
            CellValue::Number(n) => Some(n.get()),
            _ => None,
        })
        .sum();
    assert!(
        (south_total - 300.0).abs() < f64::EPSILON,
        "South total: {south_total}"
    );
}
