use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_calculated_measures() {
    let data = vec![
        vec![text("Product"), text("Revenue"), text("Cost")],
        vec![text("A"), num(500.0), num(200.0)],
        vec![text("B"), num(300.0), num(100.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Product", 0)],
        measures: vec![sum_measure("Revenue", 1), sum_measure("Cost", 2)],
        calculated_measures: vec![CalculatedMeasure {
            id: "Profit".to_string(),
            name: "Profit".to_string(),
            formula: "Revenue - Cost".to_string(),
            parsed_expr: Some(CalcExpr::BinaryOp {
                op: CalcOp::Sub,
                left: Box::new(CalcExpr::Field("Sum of Revenue".to_string())),
                right: Box::new(CalcExpr::Field("Sum of Cost".to_string())),
            }),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.measure_count, 3); // 2 regular + 1 calculated

    let a = find_node(&result.row_tree, "A");
    // Revenue=500, Cost=200, Profit=300
    assert_eq!(a.values.len(), 3);
    assert_eq!(a.values[0], num(500.0));
    assert_eq!(a.values[1], num(200.0));
    assert_eq!(a.values[2], num(300.0));

    let b = find_node(&result.row_tree, "B");
    // Revenue=300, Cost=100, Profit=200
    assert_eq!(b.values[0], num(300.0));
    assert_eq!(b.values[1], num(100.0));
    assert_eq!(b.values[2], num(200.0));
}

#[test]
fn test_calc_measure_division() {
    // Revenue/Cost ratio.
    // Product A: Revenue=200, Cost=100 -> ratio = 200/100 = 2.0
    // Product B: Revenue=300, Cost=150 -> ratio = 300/150 = 2.0
    let data = vec![
        vec![text("Product"), text("Revenue"), text("Cost")],
        vec![text("A"), num(200.0), num(100.0)],
        vec![text("B"), num(300.0), num(150.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Product", 0)],
        measures: vec![sum_measure("Revenue", 1), sum_measure("Cost", 2)],
        calculated_measures: vec![CalculatedMeasure {
            id: "Ratio".to_string(),
            name: "Ratio".to_string(),
            formula: "Revenue / Cost".to_string(),
            parsed_expr: Some(CalcExpr::BinaryOp {
                op: CalcOp::Div,
                left: Box::new(CalcExpr::Field("Sum of Revenue".to_string())),
                right: Box::new(CalcExpr::Field("Sum of Cost".to_string())),
            }),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let a = find_node(&result.row_tree, "A");
    // values: [Revenue=200, Cost=100, Ratio=2.0]
    assert_eq!(a.values[0], num(200.0));
    assert_eq!(a.values[1], num(100.0));
    assert_eq!(a.values[2], num(2.0));

    let b = find_node(&result.row_tree, "B");
    assert_eq!(b.values[0], num(300.0));
    assert_eq!(b.values[1], num(150.0));
    assert_eq!(b.values[2], num(2.0));
}

#[test]
fn test_calc_measure_division_by_zero() {
    // Product A: Revenue=200, Cost=100 -> ratio = 2.0
    // Product B: Revenue=300, Cost=0   -> ratio = Null (division by zero)
    let data = vec![
        vec![text("Product"), text("Revenue"), text("Cost")],
        vec![text("A"), num(200.0), num(100.0)],
        vec![text("B"), num(300.0), num(0.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Product", 0)],
        measures: vec![sum_measure("Revenue", 1), sum_measure("Cost", 2)],
        calculated_measures: vec![CalculatedMeasure {
            id: "Ratio".to_string(),
            name: "Ratio".to_string(),
            formula: "Revenue / Cost".to_string(),
            parsed_expr: Some(CalcExpr::BinaryOp {
                op: CalcOp::Div,
                left: Box::new(CalcExpr::Field("Sum of Revenue".to_string())),
                right: Box::new(CalcExpr::Field("Sum of Cost".to_string())),
            }),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let a = find_node(&result.row_tree, "A");
    assert_eq!(a.values[2], num(2.0));

    let b = find_node(&result.row_tree, "B");
    // Division by zero returns Null.
    assert_eq!(b.values[2], CellValue::Null);
}

#[test]
fn test_calc_measure_unary_negation() {
    // UnaryNeg(Field("Sum of Sales")). Sales=100 -> result = -100.
    let data = vec![
        vec![text("Group"), text("Sales")],
        vec![text("X"), num(100.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![sum_measure("Sales", 1)],
        calculated_measures: vec![CalculatedMeasure {
            id: "NegSales".to_string(),
            name: "NegSales".to_string(),
            formula: "-Sales".to_string(),
            parsed_expr: Some(CalcExpr::UnaryNeg(Box::new(CalcExpr::Field(
                "Sum of Sales".to_string(),
            )))),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let x = find_node(&result.row_tree, "X");
    // values: [Sales=100, NegSales=-100]
    assert_eq!(x.values[0], num(100.0));
    assert_eq!(x.values[1], num(-100.0));
}

#[test]
fn test_calc_measure_nested_expression() {
    // Profit margin = (Revenue - Cost) * 100 / Revenue
    // Product with Rev=200, Cost=50 -> (200-50)*100/200 = 150*100/200 = 75.0
    let data = vec![
        vec![text("Product"), text("Revenue"), text("Cost")],
        vec![text("A"), num(200.0), num(50.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Product", 0)],
        measures: vec![sum_measure("Revenue", 1), sum_measure("Cost", 2)],
        calculated_measures: vec![CalculatedMeasure {
            id: "Margin".to_string(),
            name: "Margin".to_string(),
            formula: "(Revenue - Cost) * 100 / Revenue".to_string(),
            parsed_expr: Some(CalcExpr::BinaryOp {
                op: CalcOp::Div,
                left: Box::new(CalcExpr::BinaryOp {
                    op: CalcOp::Mul,
                    left: Box::new(CalcExpr::BinaryOp {
                        op: CalcOp::Sub,
                        left: Box::new(CalcExpr::Field("Sum of Revenue".to_string())),
                        right: Box::new(CalcExpr::Field("Sum of Cost".to_string())),
                    }),
                    right: Box::new(CalcExpr::Number(100.0)),
                }),
                right: Box::new(CalcExpr::Field("Sum of Revenue".to_string())),
            }),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let a = find_node(&result.row_tree, "A");
    // values: [Revenue=200, Cost=50, Margin=75.0]
    assert_eq!(a.values[0], num(200.0));
    assert_eq!(a.values[1], num(50.0));
    assert_eq!(a.values[2], num(75.0));
}

#[test]
fn test_calc_measure_missing_field() {
    // CalcExpr::Field references "Sum of Nonexistent" which doesn't match any measure.
    // Result should be Null.
    let data = vec![
        vec![text("Group"), text("Sales")],
        vec![text("X"), num(100.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![sum_measure("Sales", 1)],
        calculated_measures: vec![CalculatedMeasure {
            id: "Bad".to_string(),
            name: "Bad".to_string(),
            formula: "Nonexistent".to_string(),
            parsed_expr: Some(CalcExpr::Field("Sum of Nonexistent".to_string())),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let x = find_node(&result.row_tree, "X");
    // values: [Sales=100, Bad=Null]
    assert_eq!(x.values[0], num(100.0));
    assert_eq!(x.values[1], CellValue::Null);
}

// ---------------------------------------------------------------------------
// table dependency work T11 — duplicate source field on values (e.g. "Sum of Revenue"
// alongside "Avg of Revenue"). Pre-fix: both Measures got `name="Revenue"`,
// the field map's HashMap insert overwrote the first, and the calc-field
// formula referencing `Revenue` resolved to *the last* aggregate (the order
// is HashMap iteration order — non-deterministic across runs).
//
// Fix: insert by output id (`col0`, `col1`, ...) AND by source-field name
// with `entry().or_insert(..)` (first-wins). Calc-field formulas can either
// use `col0`/`col1`/... (durable, unambiguous) or the source field name
// (resolves to the FIRST aggregate, deterministic).
// ---------------------------------------------------------------------------

#[test]
fn t11_duplicate_source_field_resolves_by_col_id() {
    // Two measures with the same source-field name "Revenue":
    //   col0 = Sum of Revenue (uses sum_measure → name="Sum of Revenue", id="Revenue")
    //   col1 = Avg of Revenue (custom Average — name="Revenue" via map_value_to_measure semantics)
    //
    // Calc field references col1 (Avg) explicitly via output id.
    let data = vec![
        vec![text("Group"), text("Revenue")],
        vec![text("X"), num(100.0)],
        vec![text("X"), num(200.0)],
        vec![text("X"), num(300.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        // Both measures share `id="Revenue"` (the source field id) and
        // `name="Revenue"` (source field name) — that's the collision.
        // sum_measure helper uses "Sum of {id}" for name; here we want
        // the audit-described shape: BOTH measures named "Revenue" so
        // the duplicate-source-field path is exercised.
        measures: vec![
            Measure {
                id: "Revenue".to_string(),
                name: "Revenue".to_string(),
                column_index: 1,
                aggregate: AggregateFunction::Sum,
                window: None,
            },
            Measure {
                id: "Revenue".to_string(),
                name: "Revenue".to_string(),
                column_index: 1,
                aggregate: AggregateFunction::Average,
                window: None,
            },
        ],
        // Calc: 2 * col1 (the Avg). Sum=600, Avg=200 → 2*200=400.
        calculated_measures: vec![CalculatedMeasure {
            id: "DoubleAvg".to_string(),
            name: "DoubleAvg".to_string(),
            formula: "2 * col1".to_string(),
            parsed_expr: Some(CalcExpr::BinaryOp {
                op: CalcOp::Mul,
                left: Box::new(CalcExpr::Number(2.0)),
                right: Box::new(CalcExpr::Field("col1".to_string())),
            }),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();
    let x = find_node(&result.row_tree, "X");
    // values: [Sum=600, Avg=200, DoubleAvg=400]
    assert_eq!(x.values[0], num(600.0));
    assert_eq!(x.values[1], num(200.0));
    assert_eq!(x.values[2], num(400.0));
}

#[test]
fn t11_duplicate_source_field_name_resolves_to_first_measure() {
    // When the calc-field formula references the source-field name
    // (the readable form), the FIRST measure with that name wins —
    // deterministic policy, matches Excel.
    let data = vec![
        vec![text("Group"), text("Revenue")],
        vec![text("X"), num(100.0)],
        vec![text("X"), num(200.0)],
        vec![text("X"), num(300.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        // First Sum (600), then Avg (200). Both `name="Revenue"`.
        measures: vec![
            Measure {
                id: "Revenue".to_string(),
                name: "Revenue".to_string(),
                column_index: 1,
                aggregate: AggregateFunction::Sum,
                window: None,
            },
            Measure {
                id: "Revenue".to_string(),
                name: "Revenue".to_string(),
                column_index: 1,
                aggregate: AggregateFunction::Average,
                window: None,
            },
        ],
        // Calc: Revenue + 0. Should resolve to the FIRST aggregate (Sum=600).
        calculated_measures: vec![CalculatedMeasure {
            id: "Pass".to_string(),
            name: "Pass".to_string(),
            formula: "Revenue".to_string(),
            parsed_expr: Some(CalcExpr::Field("Revenue".to_string())),
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();
    let x = find_node(&result.row_tree, "X");
    // First-wins on duplicate name: Revenue → 600 (Sum), not 200 (Avg).
    assert_eq!(x.values[0], num(600.0));
    assert_eq!(x.values[1], num(200.0));
    assert_eq!(x.values[2], num(600.0)); // calc resolved to Sum
}

#[test]
fn test_calc_measure_on_hierarchical_subtotals() {
    // Two row fields (Region > City) with a calculated measure (profit = Revenue - Cost).
    // The calc measure must be applied to BOTH leaf node values AND parent subtotal_values.
    //
    // Data:
    //   North, NYC:    Revenue=100, Cost=40
    //   North, Boston: Revenue=200, Cost=80
    //   South, Miami:  Revenue=150, Cost=50
    //
    // Expected:
    //   NYC leaf:      Rev=100, Cost=40,  Profit=60
    //   Boston leaf:   Rev=200, Cost=80,  Profit=120
    //   North subtotal: Rev=300, Cost=120, Profit=180
    //   Miami leaf:    Rev=150, Cost=50,  Profit=100
    //   South subtotal: Rev=150, Cost=50,  Profit=100
    let data = vec![
        vec![text("Region"), text("City"), text("Revenue"), text("Cost")],
        vec![text("North"), text("NYC"), num(100.0), num(40.0)],
        vec![text("North"), text("Boston"), num(200.0), num(80.0)],
        vec![text("South"), text("Miami"), num(150.0), num(50.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0), identity_field("City", 1)],
        measures: vec![sum_measure("Revenue", 2), sum_measure("Cost", 3)],
        calculated_measures: vec![CalculatedMeasure {
            id: "Profit".to_string(),
            name: "Profit".to_string(),
            formula: "Revenue - Cost".to_string(),
            parsed_expr: Some(CalcExpr::BinaryOp {
                op: CalcOp::Sub,
                left: Box::new(CalcExpr::Field("Sum of Revenue".to_string())),
                right: Box::new(CalcExpr::Field("Sum of Cost".to_string())),
            }),
        }],
        subtotals: SubtotalConfig {
            enabled: vec![true], // subtotals at depth 0
        },
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // measure_count = 2 regular + 1 calculated = 3
    assert_eq!(result.measure_count, 3);

    let north = find_node(&result.row_tree, "North");

    // Leaf nodes: check calculated measure in values.
    let nyc = find_child(north, "NYC");
    assert_eq!(nyc.values.len(), 3);
    assert_eq!(nyc.values[0], num(100.0)); // Revenue
    assert_eq!(nyc.values[1], num(40.0)); // Cost
    assert_eq!(nyc.values[2], num(60.0)); // Profit = 100 - 40

    let boston = find_child(north, "Boston");
    assert_eq!(boston.values[0], num(200.0));
    assert_eq!(boston.values[1], num(80.0));
    assert_eq!(boston.values[2], num(120.0)); // Profit = 200 - 80

    // Parent subtotal: calc measure must also be present in subtotal_values.
    assert!(north.subtotal_values.is_some());
    let north_sub = north.subtotal_values.as_ref().unwrap();
    assert_eq!(north_sub.len(), 3);
    assert_eq!(north_sub[0], num(300.0)); // Revenue subtotal = 100 + 200
    assert_eq!(north_sub[1], num(120.0)); // Cost subtotal = 40 + 80
    assert_eq!(north_sub[2], num(180.0)); // Profit subtotal = 300 - 120

    let south = find_node(&result.row_tree, "South");
    let miami = find_child(south, "Miami");
    assert_eq!(miami.values[2], num(100.0)); // Profit = 150 - 50

    assert!(south.subtotal_values.is_some());
    let south_sub = south.subtotal_values.as_ref().unwrap();
    assert_eq!(south_sub[0], num(150.0)); // Revenue
    assert_eq!(south_sub[1], num(50.0)); // Cost
    assert_eq!(south_sub[2], num(100.0)); // Profit = 150 - 50
}
