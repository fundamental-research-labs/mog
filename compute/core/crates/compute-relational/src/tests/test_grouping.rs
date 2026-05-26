use super::helpers::*;
use crate::engine::execute;
use crate::types::*;
use value_types::CellValue;

#[test]
fn test_hierarchical_grouping() {
    // Data: Region | City | Sales
    let data = vec![
        vec![text("Region"), text("City"), text("Sales")],
        vec![text("North"), text("NYC"), num(100.0)],
        vec![text("North"), text("Boston"), num(200.0)],
        vec![text("South"), text("Miami"), num(150.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![identity_field("Region", 0), identity_field("City", 1)],
        measures: vec![sum_measure("Sales", 2)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 2); // North, South

    let north = find_node(&result.row_tree, "North");
    let south = find_node(&result.row_tree, "South");

    // North has children: Boston, NYC (sorted ascending)
    assert_eq!(north.children.len(), 2);
    let boston = find_child(north, "Boston");
    let nyc = find_child(north, "NYC");
    assert_eq!(boston.values[0], num(200.0));
    assert_eq!(nyc.values[0], num(100.0));

    // North subtotal = 300
    assert!(north.subtotal_values.is_some());
    let north_subtotals = north.subtotal_values.as_ref().unwrap();
    assert_eq!(north_subtotals[0], num(300.0));

    // South has one child: Miami
    assert_eq!(south.children.len(), 1);
    let miami = find_child(south, "Miami");
    assert_eq!(miami.values[0], num(150.0));

    // South subtotal = 150
    assert!(south.subtotal_values.is_some());
    let south_subtotals = south.subtotal_values.as_ref().unwrap();
    assert_eq!(south_subtotals[0], num(150.0));
}

/// Regression for sub-scope sub-scope B: a literal text value equal to the
/// legacy `"\x00BLANK\x00"` wire sentinel must NOT collide with the true
/// blank group in aggregation / grouping. With the pre-refactor
/// `HashMap<String, _>` bucketing this text value could be indistinguishable
/// from `Null` / `Text("")`; with `GroupKey` it is a distinct `Text` group.
#[test]
fn test_text_looking_like_blank_sentinel_is_distinct_group() {
    let data = vec![
        vec![text("Region"), text("Sales")],
        vec![CellValue::Null, num(100.0)],
        vec![CellValue::Text("".into()), num(50.0)],
        vec![CellValue::Text("\x00BLANK\x00".into()), num(200.0)],
        vec![text("North"), num(300.0)],
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
            show_items_with_no_data: true,
        }],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Three groups: (Null + empty text coalesced = one blank group with 150.0),
    // the literal "\x00BLANK\x00" text (200.0), and "North" (300.0).
    assert_eq!(
        result.row_tree.len(),
        3,
        "expected 3 distinct groups: blank, literal-sentinel-text, North"
    );

    let sums: Vec<f64> = result
        .row_tree
        .iter()
        .map(|n| match &n.values[0] {
            CellValue::Number(x) => x.get(),
            _ => panic!("expected number"),
        })
        .collect();

    let total: f64 = sums.iter().sum();
    assert!(
        (total - 650.0).abs() < 1e-9,
        "row sums = {sums:?}, total={total}"
    );

    // Confirm the literal-sentinel-text group is present and carries 200.0 —
    // i.e. it was NOT silently merged into the blank bucket.
    let sentinel_group = result
        .row_tree
        .iter()
        .find(|n| n.value == CellValue::Text("\x00BLANK\x00".into()))
        .expect("literal \\x00BLANK\\x00 text group must exist as a distinct node");
    assert_eq!(sentinel_group.values[0], num(200.0));
}

#[test]
fn test_date_grouping_month() {
    // Excel serial dates: 44927 = 2023-01-01, 44958 = 2023-02-01
    let data = vec![
        vec![text("Date"), text("Sales")],
        vec![num(44927.0), num(100.0)], // Jan 1, 2023
        vec![num(44935.0), num(150.0)], // Jan 9, 2023
        vec![num(44958.0), num(200.0)], // Feb 1, 2023
        vec![num(44962.0), num(250.0)], // Feb 5, 2023
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Month),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 2);

    // Months are sorted by month order (January, February)
    let jan = find_node(&result.row_tree, "January");
    let feb = find_node(&result.row_tree, "February");

    // January: 100 + 150 = 250
    assert_eq!(jan.values[0], num(250.0));
    // February: 200 + 250 = 450
    assert_eq!(feb.values[0], num(450.0));
}

#[test]
fn test_date_grouping_year() {
    let data = vec![
        vec![text("Date"), text("Sales")],
        vec![num(44927.0), num(100.0)], // 2023-01-01
        vec![num(45292.0), num(200.0)], // 2024-01-01
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Year),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 2);
    // 2023 and 2024 as numbers
    assert_eq!(result.row_tree[0].values[0], num(100.0));
    assert_eq!(result.row_tree[1].values[0], num(200.0));
}

#[test]
fn test_date_grouping_quarter() {
    // Serial dates (Excel):
    //   44927 = 2023-01-01 (Q1)
    //   44958 = 2023-02-01 (Q1)
    //   45017 = 2023-04-01 (Q2)
    //   45108 = 2023-07-01 (Q3)
    //   45200 = 2023-10-01 (Q4)
    let data = vec![
        vec![text("Date"), text("Sales")],
        vec![num(44927.0), num(10.0)], // Q1
        vec![num(44958.0), num(20.0)], // Q1
        vec![num(45017.0), num(30.0)], // Q2
        vec![num(45108.0), num(40.0)], // Q3
        vec![num(45200.0), num(50.0)], // Q4
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Quarter),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 4);

    // Q1: 10 + 20 = 30
    let q1 = find_node(&result.row_tree, "Q1");
    assert_eq!(q1.values[0], num(30.0));

    // Q2: 30
    let q2 = find_node(&result.row_tree, "Q2");
    assert_eq!(q2.values[0], num(30.0));

    // Q3: 40
    let q3 = find_node(&result.row_tree, "Q3");
    assert_eq!(q3.values[0], num(40.0));

    // Q4: 50
    let q4 = find_node(&result.row_tree, "Q4");
    assert_eq!(q4.values[0], num(50.0));
}

#[test]
fn test_date_grouping_day() {
    // All dates in January 2023.
    // 44927 = 2023-01-01 (day 1)
    // 44941 = 2023-01-15 (day 15), since 44927 + 14 = 44941
    // 44954 = 2023-01-28 (day 28), since 44927 + 27 = 44954
    // Two rows on day 1 to test aggregation.
    let data = vec![
        vec![text("Date"), text("Amount")],
        vec![num(44927.0), num(5.0)],  // day 1
        vec![num(44927.0), num(15.0)], // day 1 (duplicate)
        vec![num(44941.0), num(25.0)], // day 15
        vec![num(44954.0), num(35.0)], // day 28
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Day),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Amount", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3); // days 1, 15, 28

    // Day grouping produces CellValue::number, so find by numeric value.
    let day1 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(1.0))
        .expect("day 1");
    let day15 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(15.0))
        .expect("day 15");
    let day28 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(28.0))
        .expect("day 28");

    // Day 1: 5 + 15 = 20
    assert_eq!(day1.values[0], num(20.0));
    // Day 15: 25
    assert_eq!(day15.values[0], num(25.0));
    // Day 28: 35
    assert_eq!(day28.values[0], num(35.0));
}

#[test]
fn test_date_grouping_hour() {
    // Fractional serial -> hour:
    //   frac * 86400 = total_seconds; hour = total_seconds / 3600
    //   0.25 -> 21600s -> hour 6
    //   0.50 -> 43200s -> hour 12
    //   0.75 -> 64800s -> hour 18
    let data = vec![
        vec![text("Date"), text("Val")],
        vec![num(44927.25), num(100.0)], // 6 AM
        vec![num(44927.5), num(200.0)],  // 12 PM
        vec![num(44927.75), num(300.0)], // 6 PM
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Hour),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Val", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    let h6 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(6.0))
        .expect("hour 6");
    let h12 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(12.0))
        .expect("hour 12");
    let h18 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(18.0))
        .expect("hour 18");

    assert_eq!(h6.values[0], num(100.0));
    assert_eq!(h12.values[0], num(200.0));
    assert_eq!(h18.values[0], num(300.0));
}

#[test]
fn test_date_grouping_minute() {
    // To get 12:01:00: total_seconds = 12*3600 + 1*60 = 43260
    //   frac = 43260 / 86400 = 0.500694...
    //   minute = (43260 % 3600) / 60 = 60/60 = 1
    //
    // To get 12:30:00: total_seconds = 12*3600 + 30*60 = 45000
    //   frac = 45000 / 86400 = 0.520833...
    //   minute = (45000 % 3600) / 60 = 1800/60 = 30
    //
    // To get 12:00:00: frac = 0.5, minute = 0
    let serial_12_01 = 44927.0 + (12.0 * 3600.0 + 1.0 * 60.0) / 86400.0;
    let serial_12_30 = 44927.0 + (12.0 * 3600.0 + 30.0 * 60.0) / 86400.0;
    let serial_12_00 = 44927.5; // exactly noon

    let data = vec![
        vec![text("Date"), text("Val")],
        vec![num(serial_12_00), num(10.0)], // minute 0
        vec![num(serial_12_01), num(20.0)], // minute 1
        vec![num(serial_12_30), num(30.0)], // minute 30
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Minute),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Val", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    let m0 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(0.0))
        .expect("minute 0");
    let m1 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(1.0))
        .expect("minute 1");
    let m30 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(30.0))
        .expect("minute 30");

    assert_eq!(m0.values[0], num(10.0));
    assert_eq!(m1.values[0], num(20.0));
    assert_eq!(m30.values[0], num(30.0));
}

#[test]
fn test_date_grouping_second() {
    // 12:00:45: total_seconds = 12*3600 + 0*60 + 45 = 43245
    //   frac = 43245 / 86400
    //   second = 43245 % 60 = 45
    //
    // 12:01:15: total_seconds = 12*3600 + 1*60 + 15 = 43275
    //   frac = 43275 / 86400
    //   second = 43275 % 60 = 15
    //
    // 12:00:00: second = 0
    let serial_12_00_45 = 44927.0 + (12.0 * 3600.0 + 45.0) / 86400.0;
    let serial_12_01_15 = 44927.0 + (12.0 * 3600.0 + 1.0 * 60.0 + 15.0) / 86400.0;
    let serial_12_00_00 = 44927.5;

    let data = vec![
        vec![text("Date"), text("Val")],
        vec![num(serial_12_00_00), num(100.0)], // second 0
        vec![num(serial_12_00_45), num(200.0)], // second 45
        vec![num(serial_12_01_15), num(300.0)], // second 15
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Second),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Val", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    let s0 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(0.0))
        .expect("second 0");
    let s15 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(15.0))
        .expect("second 15");
    let s45 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(45.0))
        .expect("second 45");

    assert_eq!(s0.values[0], num(100.0));
    assert_eq!(s15.values[0], num(300.0));
    assert_eq!(s45.values[0], num(200.0));
}

#[test]
fn test_date_grouping_week() {
    // Excel serial 44927 = 2023-01-01 (Sunday).
    // Jan 1 2023 is a Sunday, so jan1_weekday = 0 (num_days_from_sunday).
    //
    // excel_week_number formula: ((day_of_year - 1 + jan1_weekday) / 7) + 1
    //
    // 44927 (Jan 1, ordinal=1):  ((1 - 1 + 0) / 7) + 1 = (0/7) + 1 = 1 -> "Week 1"
    // 44934 (Jan 8, ordinal=8):  ((8 - 1 + 0) / 7) + 1 = (7/7) + 1 = 2 -> "Week 2"
    // 44941 (Jan 15, ordinal=15): ((15 - 1 + 0) / 7) + 1 = (14/7) + 1 = 3 -> "Week 3"
    let data = vec![
        vec![text("Date"), text("Sales")],
        vec![num(44927.0), num(10.0)], // 2023-01-01 (Sun), Week 1
        vec![num(44934.0), num(20.0)], // 2023-01-08 (Sun), Week 2
        vec![num(44941.0), num(30.0)], // 2023-01-15 (Sun), Week 3
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Week),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 3);

    let w1 = find_node(&result.row_tree, "Week 1");
    let w2 = find_node(&result.row_tree, "Week 2");
    let w3 = find_node(&result.row_tree, "Week 3");

    assert_eq!(w1.values[0], num(10.0));
    assert_eq!(w2.values[0], num(20.0));
    assert_eq!(w3.values[0], num(30.0));
}

#[test]
fn test_date_grouping_with_text_value() {
    // When a non-Number cell appears in a date-grouped field, the `_ => value.clone()`
    // branch fires, passing the text through as its own group label.
    //
    // Mix: two serial dates (both Jan 2023 = "Week 1") and one text value "N/A".
    // 44927 = 2023-01-01 (Week 1), 44928 = 2023-01-02 (Week 1).
    let data = vec![
        vec![text("Date"), text("Sales")],
        vec![num(44927.0), num(10.0)], // Week 1
        vec![num(44928.0), num(20.0)], // Week 1
        vec![text("N/A"), num(50.0)],  // text passthrough
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Date".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Date(DateGroupingKind::Week),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Sales", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Two groups: "Week 1" (aggregated 10+20=30) and "N/A" (50).
    assert_eq!(result.row_tree.len(), 2);

    let na = find_node(&result.row_tree, "N/A");
    assert_eq!(na.values[0], num(50.0));

    let w1 = find_node(&result.row_tree, "Week 1");
    assert_eq!(w1.values[0], num(30.0));
}

#[test]
fn test_number_grouping_intervals() {
    let data = vec![
        vec![text("Value"), text("Count")],
        vec![num(5.0), num(1.0)],
        vec![num(15.0), num(1.0)],
        vec![num(25.0), num(1.0)],
        vec![num(35.0), num(1.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Value".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Number(NumberGroupingKind {
                start: 0.0,
                end: 40.0,
                interval: 10.0,
            }),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Count", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    assert_eq!(result.row_tree.len(), 4);

    // Expected groups: "0 - 9", "10 - 19", "20 - 29", "30 - 39"
    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text label"),
        })
        .collect();

    assert!(labels.contains(&"0 - 9".to_string()));
    assert!(labels.contains(&"10 - 19".to_string()));
    assert!(labels.contains(&"20 - 29".to_string()));
    assert!(labels.contains(&"30 - 39".to_string()));

    // Each group should have count 1
    for node in &result.row_tree {
        assert_eq!(node.values[0], num(1.0));
    }
}

#[test]
fn test_number_grouping_out_of_range() {
    // Values outside the configured range
    let data = vec![
        vec![text("Value"), text("Count")],
        vec![num(-5.0), num(1.0)], // below start
        vec![num(15.0), num(1.0)], // in range
        vec![num(50.0), num(1.0)], // above end
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Value".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Number(NumberGroupingKind {
                start: 0.0,
                end: 40.0,
                interval: 10.0,
            }),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Count", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Should have 3 groups: "< 0", "10 - 19", ">= 40"
    assert_eq!(result.row_tree.len(), 3);

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("Expected text"),
        })
        .collect();

    assert!(labels.contains(&"< 0".to_string()), "labels: {labels:?}");
    assert!(
        labels.contains(&"10 - 19".to_string()),
        "labels: {labels:?}"
    );
    assert!(labels.contains(&">= 40".to_string()), "labels: {labels:?}");
}

#[test]
fn test_number_grouping_invalid_config() {
    // When start >= end, the guard clause returns value.clone() -- values pass through
    // unchanged (no bucketing).
    //
    // Config: start=10.0, end=5.0, interval=1.0. Since 10 >= 5, all values pass through.
    // Values 3.0, 7.0, 12.0 should each become their own group (as raw numbers, not
    // bucketed into text labels).
    let data = vec![
        vec![text("Value"), text("Count")],
        vec![num(3.0), num(10.0)],
        vec![num(7.0), num(20.0)],
        vec![num(12.0), num(30.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Value".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Number(NumberGroupingKind {
                start: 10.0,
                end: 5.0, // start >= end triggers guard
                interval: 1.0,
            }),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Count", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // All three values pass through as individual groups (numeric, not text buckets).
    assert_eq!(result.row_tree.len(), 3);

    let n3 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(3.0))
        .expect("group 3.0");
    assert_eq!(n3.values[0], num(10.0));

    let n7 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(7.0))
        .expect("group 7.0");
    assert_eq!(n7.values[0], num(20.0));

    let n12 = result
        .row_tree
        .iter()
        .find(|n| n.value == num(12.0))
        .expect("group 12.0");
    assert_eq!(n12.values[0], num(30.0));
}

#[test]
fn test_number_grouping_with_text_values() {
    // When a text value appears in a number-grouped field, the `_ => value.clone()`
    // branch fires. Numbers get bucketed, text becomes its own group.
    //
    // Config: start=0, end=20, interval=10. Buckets: "0 - 9", "10 - 19".
    // Data: 5.0 -> "0 - 9", 15.0 -> "10 - 19", "N/A" -> "N/A" (passthrough).
    let data = vec![
        vec![text("Value"), text("Amount")],
        vec![num(5.0), num(100.0)],
        vec![num(15.0), num(200.0)],
        vec![text("N/A"), num(300.0)],
    ];

    let query = RelationalQuery {
        row_fields: vec![GroupField {
            id: "Value".to_string(),
            column_index: 0,
            grouping: GroupingStrategy::Number(NumberGroupingKind {
                start: 0.0,
                end: 20.0,
                interval: 10.0,
            }),
            sort: SortConfig {
                sort_by: SortBy::Label,
                direction: SortDirection::Ascending,
                custom_order: None,
            },
        }],
        measures: vec![sum_measure("Amount", 1)],
        ..base_query()
    };

    let result = execute(&query, &data).unwrap();

    // Three groups: "0 - 9", "10 - 19", "N/A"
    assert_eq!(result.row_tree.len(), 3);

    let labels: Vec<String> = result
        .row_tree
        .iter()
        .map(|n| match &n.value {
            CellValue::Text(s) => s.to_string(),
            other => format!("{other:?}"),
        })
        .collect();

    assert!(labels.contains(&"0 - 9".to_string()), "labels: {labels:?}");
    assert!(
        labels.contains(&"10 - 19".to_string()),
        "labels: {labels:?}"
    );
    assert!(labels.contains(&"N/A".to_string()), "labels: {labels:?}");

    let na = find_node(&result.row_tree, "N/A");
    assert_eq!(na.values[0], num(300.0));

    let bucket_0_9 = find_node(&result.row_tree, "0 - 9");
    assert_eq!(bucket_0_9.values[0], num(100.0));

    let bucket_10_19 = find_node(&result.row_tree, "10 - 19");
    assert_eq!(bucket_10_19.values[0], num(200.0));
}
