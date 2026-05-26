use super::helpers::*;
use crate::engine::execute;
use crate::types::*;

#[test]
fn test_grand_totals_row_only() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![text("North"), num(100.0)],
        vec![text("South"), num(200.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        measures: vec![sum_measure("Sales", 1)],
        grand_totals: GrandTotalConfig {
            show_row: true,
            show_column: false,
        },
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert!(result.grand_totals.row.is_some());
    assert!(result.grand_totals.column.is_none());
    let row_gt = result.grand_totals.row.as_ref().unwrap();
    assert_eq!(row_gt[0], num(300.0));

    // Corner is computed when either row or column is shown
    assert!(result.grand_totals.corner.is_some());
    assert_eq!(result.grand_totals.corner.as_ref().unwrap()[0], num(300.0));
}

#[test]
fn test_grand_totals_column_only() {
    // Need column fields for column grand totals to be meaningful
    let data = vec![
        vec![text("Region"), text("Product"), text("Sales")],
        vec![text("North"), text("Widget"), num(100.0)],
        vec![text("North"), text("Gadget"), num(200.0)],
        vec![text("South"), text("Widget"), num(150.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![identity_field("Product", 1)],
        measures: vec![sum_measure("Sales", 2)],
        grand_totals: GrandTotalConfig {
            show_row: false,
            show_column: true,
        },
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert!(result.grand_totals.row.is_none());
    assert!(result.grand_totals.column.is_some());

    let col_totals = result.grand_totals.column.as_ref().unwrap();
    // North: 100 + 200 = 300
    let north = find_node(&result.row_tree, "North");
    let north_gt = col_totals
        .get(&north.key)
        .expect("North column grand total");
    assert_eq!(north_gt[0], num(300.0));

    // South: 150
    let south = find_node(&result.row_tree, "South");
    let south_gt = col_totals
        .get(&south.key)
        .expect("South column grand total");
    assert_eq!(south_gt[0], num(150.0));

    // Corner is present
    assert!(result.grand_totals.corner.is_some());
    assert_eq!(result.grand_totals.corner.as_ref().unwrap()[0], num(450.0));
}

#[test]
fn test_grand_totals_both() {
    let data = vec![
        vec![text("Region"), text("Product"), text("Sales")],
        vec![text("North"), text("Widget"), num(100.0)],
        vec![text("South"), text("Gadget"), num(200.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![identity_field("Product", 1)],
        measures: vec![sum_measure("Sales", 2)],
        grand_totals: GrandTotalConfig {
            show_row: true,
            show_column: true,
        },
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert!(result.grand_totals.row.is_some());
    assert!(result.grand_totals.column.is_some());
    assert!(result.grand_totals.corner.is_some());

    // Corner grand total = 100 + 200 = 300
    assert_eq!(result.grand_totals.corner.as_ref().unwrap()[0], num(300.0));
}

#[test]
fn test_cross_tab_with_grand_totals() {
    // Cross-tab with both grand totals to verify corner total
    let data = vec![
        vec![text("Region"), text("Product"), text("Sales")],
        vec![text("North"), text("A"), num(10.0)],
        vec![text("North"), text("B"), num(20.0)],
        vec![text("South"), text("A"), num(30.0)],
        vec![text("South"), text("B"), num(40.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0)],
        column_fields: vec![identity_field("Product", 1)],
        measures: vec![sum_measure("Sales", 2)],
        grand_totals: GrandTotalConfig {
            show_row: true,
            show_column: true,
        },
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Corner total = 10 + 20 + 30 + 40 = 100
    assert!(result.grand_totals.corner.is_some());
    assert_eq!(result.grand_totals.corner.as_ref().unwrap()[0], num(100.0));

    // Row grand total: per column totals
    let row_gt = result.grand_totals.row.as_ref().unwrap();
    // 2 columns * 1 measure = 2 values
    assert_eq!(row_gt.len(), 2);

    // Column grand totals: per row node
    let col_gt = result.grand_totals.column.as_ref().unwrap();
    let north = find_node(&result.row_tree, "North");
    let north_total = col_gt.get(&north.key).unwrap();
    assert_eq!(north_total[0], num(30.0)); // 10 + 20

    let south = find_node(&result.row_tree, "South");
    let south_total = col_gt.get(&south.key).unwrap();
    assert_eq!(south_total[0], num(70.0)); // 30 + 40
}

#[test]
fn test_subtotals_on_parent_nodes() {
    // Two-level hierarchy: Region > City
    let data = vec![
        vec![text("Region"), text("City"), text("Sales")],
        vec![text("North"), text("NYC"), num(100.0)],
        vec![text("North"), text("Boston"), num(200.0)],
        vec![text("North"), text("Chicago"), num(50.0)],
        vec![text("South"), text("Miami"), num(150.0)],
        vec![text("South"), text("Atlanta"), num(250.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0), identity_field("City", 1)],
        measures: vec![sum_measure("Sales", 2)],
        subtotals: SubtotalConfig {
            enabled: vec![true], // subtotals at depth 0
        },
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let north = find_node(&result.row_tree, "North");
    assert!(north.subtotal_values.is_some());
    let north_sub = north.subtotal_values.as_ref().unwrap();
    // 100 + 200 + 50 = 350
    assert_eq!(north_sub[0], num(350.0));

    let south = find_node(&result.row_tree, "South");
    assert!(south.subtotal_values.is_some());
    let south_sub = south.subtotal_values.as_ref().unwrap();
    // 150 + 250 = 400
    assert_eq!(south_sub[0], num(400.0));

    // Leaf nodes should NOT have subtotal_values
    let nyc = find_child(north, "NYC");
    assert!(nyc.subtotal_values.is_none());
}
