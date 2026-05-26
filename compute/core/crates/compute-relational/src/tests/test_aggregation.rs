use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_multiple_aggregate_functions() {
    let data = vec![
        vec![text("Group"), text("Val")],
        vec![text("A"), num(10.0)],
        vec![text("A"), num(20.0)],
        vec![text("A"), num(30.0)],
    ];

    let agg_fns = vec![
        (AggregateFunction::Sum, 60.0),
        (AggregateFunction::Count, 3.0),
        (AggregateFunction::Average, 20.0),
        (AggregateFunction::Max, 30.0),
        (AggregateFunction::Min, 10.0),
        (AggregateFunction::Product, 6000.0), // 10 * 20 * 30
    ];

    for (agg, expected) in agg_fns {
        let query = RelationalQuery {
            row_fields: vec![identity_field("Group", 0)],
            measures: vec![make_measure("Val", 1, agg)],
            ..base_query()
        };

        let result = execute(&query, &data).unwrap();
        let a = find_node(&result.row_tree, "A");
        assert_eq!(
            a.values[0],
            num(expected),
            "Failed for aggregate function: {agg:?}"
        );
    }
}

#[test]
fn test_aggregate_median() {
    // Group "Odd":  values 1, 3, 5, 7, 9 -> sorted: [1,3,5,7,9], median = 5 (middle of 5 elements)
    // Group "Even": values 2, 4, 6, 8     -> sorted: [2,4,6,8], median = (4+6)/2 = 5.0
    let data = vec![
        vec![text("Group"), text("Val")],
        vec![text("Odd"), num(1.0)],
        vec![text("Odd"), num(3.0)],
        vec![text("Odd"), num(5.0)],
        vec![text("Odd"), num(7.0)],
        vec![text("Odd"), num(9.0)],
        vec![text("Even"), num(2.0)],
        vec![text("Even"), num(4.0)],
        vec![text("Even"), num(6.0)],
        vec![text("Even"), num(8.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![make_measure("Val", 1, AggregateFunction::Median)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    let odd = find_node(&result.row_tree, "Odd");
    assert_eq!(odd.values[0], num(5.0));

    let even = find_node(&result.row_tree, "Even");
    assert_eq!(even.values[0], num(5.0));
}

#[test]
fn test_aggregate_count_vs_count_nums() {
    // Count (maps to compute-stats Count) counts numeric values only.
    // CountNums (maps to compute-stats CountA) counts all non-blank values.
    //
    // Data for group "Mix":
    //   num(10.0), text("hello"), CellValue::Null, num(20.0), text("world")
    //
    // Count (numeric only): 10.0 and 20.0 -> 2
    // CountNums (non-blank): 10.0, "hello", 20.0, "world" -> 4 (Null excluded)
    let data = vec![
        vec![text("Group"), text("Val")],
        vec![text("Mix"), num(10.0)],
        vec![text("Mix"), text("hello")],
        vec![text("Mix"), CellValue::Null],
        vec![text("Mix"), num(20.0)],
        vec![text("Mix"), text("world")],
    ];

    // Test Count (numeric only)
    let query_count = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![make_measure("Val", 1, AggregateFunction::Count)],
        ..base_query()
    };

    let result_count = execute(&query_count, &data).unwrap();
    let mix_count = find_node(&result_count.row_tree, "Mix");
    assert_eq!(
        mix_count.values[0],
        num(2.0),
        "Count should count only numeric values"
    );

    // Test CountNums (non-blank, i.e. CountA)
    let query_counta = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![make_measure("Val", 1, AggregateFunction::CountNums)],
        ..base_query()
    };

    let result_counta = execute(&query_counta, &data).unwrap();
    let mix_counta = find_node(&result_counta.row_tree, "Mix");
    assert_eq!(
        mix_counta.values[0],
        num(4.0),
        "CountNums should count all non-blank values"
    );
}

#[test]
fn test_aggregate_min_max_with_mixed_types() {
    // Min/Max only consider numeric values, ignoring text and Null.
    //
    // Data: num(50.0), text("apple"), CellValue::Null, num(10.0), num(30.0)
    //
    // Min of numerics: min(50, 10, 30) = 10
    // Max of numerics: max(50, 10, 30) = 50
    let data = vec![
        vec![text("Group"), text("Val")],
        vec![text("A"), num(50.0)],
        vec![text("A"), text("apple")],
        vec![text("A"), CellValue::Null],
        vec![text("A"), num(10.0)],
        vec![text("A"), num(30.0)],
    ];

    let query_min = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![make_measure("Val", 1, AggregateFunction::Min)],
        ..base_query()
    };

    let result_min = execute(&query_min, &data).unwrap();
    let a_min = find_node(&result_min.row_tree, "A");
    assert_eq!(
        a_min.values[0],
        num(10.0),
        "Min should be 10.0, ignoring text and Null"
    );

    let query_max = RelationalQuery {
        row_fields: vec![identity_field("Group", 0)],
        measures: vec![make_measure("Val", 1, AggregateFunction::Max)],
        ..base_query()
    };

    let result_max = execute(&query_max, &data).unwrap();
    let a_max = find_node(&result_max.row_tree, "A");
    assert_eq!(
        a_max.values[0],
        num(50.0),
        "Max should be 50.0, ignoring text and Null"
    );
}
