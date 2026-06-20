//! Expansion state, drill-down, and related tests.

use super::test_helpers::*;
use super::*;
use crate::grouper::normalize_to_key;
use crate::types::*;
use value_types::CellValue;

// ---- drillDown tests ----

#[test]
fn drill_down_returns_source_row_indices() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    // Drill down into East + Widget (keys use canonical type-prefixed format)
    let indices = drill_down(&config, &sample_sales_data(), "T:east", "T:widget");

    // Should return indices 0, 1 (East + Widget rows in data)
    assert_eq!(indices.len(), 2);
    assert!(indices.contains(&0));
    assert!(indices.contains(&1));
}

#[test]
fn drill_down_matches_all_row_tuple_levels() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let indices = drill_down(
        &config,
        &sample_sales_data(),
        "T:east\x00T:gadget",
        GRAND_TOTAL_KEY,
    );

    assert_eq!(indices, vec![2, 3]);
}

#[test]
fn drill_down_accepts_blank_tuple_member_keys() {
    let data = vec![
        vec![cv_text("Segment"), cv_text("Category"), cv_text("Amount")],
        vec![cv_text(""), cv_text("Discount"), cv_num(7.75)],
        vec![CellValue::Null, cv_text("Standard"), cv_num(3.5)],
        vec![cv_text("Alpha"), cv_text("Standard"), cv_num(10.5)],
    ];
    let config = make_base_config(
        vec![
            PivotField {
                id: FieldId::from("segment"),
                name: "Segment".to_string(),
                source_column: 0,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::from("category"),
                name: "Category".to_string(),
                source_column: 1,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::from("amount"),
                name: "Amount".to_string(),
                source_column: 2,
                data_type: DetectedDataType::Number,
                ..Default::default()
            },
        ],
        vec![
            make_placement("segment", PivotFieldArea::Row, 0, None),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let indices = drill_down(&config, &data, "\x00BLANK\x00", GRAND_TOTAL_KEY);

    assert_eq!(indices, vec![0, 1]);
}

#[test]
fn drill_down_handles_grand_total() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let indices = drill_down(
        &config,
        &sample_sales_data(),
        GRAND_TOTAL_KEY,
        GRAND_TOTAL_KEY,
    );

    // Should return all 8 data row indices
    assert_eq!(indices.len(), 8);
}

// ---- C6: Drill-down with date/number grouping ----

#[test]
fn drill_down_with_number_grouping() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Amount"), cv_text("Value")],
        vec![cv_text("A"), cv_num(15.0), cv_num(100.0)],
        vec![cv_text("A"), cv_num(25.0), cv_num(200.0)],
        vec![cv_text("B"), cv_num(35.0), cv_num(300.0)],
        vec![cv_text("B"), cv_num(45.0), cv_num(400.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("value"),
            name: "Value".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("amount", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, 10.0));
    let amount_placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        fields,
        vec![
            amount_placement,
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let indices = drill_down(&config, &data, "T:10 - 19", GRAND_TOTAL_KEY);
    assert_eq!(
        indices,
        vec![0],
        "drill_down should find row with Amount=15 in '10 - 19' group"
    );

    let indices2 = drill_down(&config, &data, "T:20 - 29", GRAND_TOTAL_KEY);
    assert_eq!(
        indices2,
        vec![1],
        "drill_down should find row with Amount=25 in '20 - 29' group"
    );
}

#[test]
fn drill_down_with_date_grouping() {
    use chrono::NaiveDate;
    use value_types::date_serial::date_to_serial;

    let jan15 = date_to_serial(&NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
    let jun20 = date_to_serial(&NaiveDate::from_ymd_opt(2024, 6, 20).unwrap());
    let jan25 = date_to_serial(&NaiveDate::from_ymd_opt(2024, 1, 25).unwrap());

    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Date"), cv_text("Value")],
        vec![cv_num(jan15), cv_num(100.0)],
        vec![cv_num(jun20), cv_num(200.0)],
        vec![cv_num(jan25), cv_num(300.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("date"),
            name: "Date".to_string(),
            source_column: 0,
            data_type: DetectedDataType::Date,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("value"),
            name: "Value".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    // Place "date" on rows with Year grouping
    let mut axis_year = make_row_axis("date", 0);
    axis_year.date_grouping = Some(DateGrouping::Year);
    let date_placement = PivotFieldPlacement::Row(axis_year);

    let config = make_base_config(
        fields.clone(),
        vec![
            date_placement,
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let year_key = normalize_to_key(&CellValue::number(2024.0));
    let indices = drill_down(&config, &data, &year_key, GRAND_TOTAL_KEY);
    assert_eq!(indices.len(), 3, "all 3 rows are in year 2024");

    // Now test with Month grouping
    let mut axis_month = make_row_axis("date", 0);
    axis_month.date_grouping = Some(DateGrouping::Month);
    let date_placement_month = PivotFieldPlacement::Row(axis_month);

    let config_month = make_base_config(
        fields,
        vec![
            date_placement_month,
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let jan_indices = drill_down(&config_month, &data, "T:january", GRAND_TOTAL_KEY);
    assert_eq!(jan_indices.len(), 2, "2 rows in January");
    assert!(jan_indices.contains(&0));
    assert!(jan_indices.contains(&2));

    let jun_indices = drill_down(&config_month, &data, "T:june", GRAND_TOTAL_KEY);
    assert_eq!(jun_indices.len(), 1, "1 row in June");
    assert!(jun_indices.contains(&1));
}

// ---- B4c: Expansion state -- collapse groups ----

#[test]
fn b4c_expansion_state_collapse_groups() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    // First compute with no expansion state (all expanded by default)
    let result_expanded = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result_expanded.errors.is_none());
    let expanded_count = result_expanded.rows.len();
    assert!(
        expanded_count >= 4,
        "Expanded should have >= 4 rows, got {}",
        expanded_count
    );

    // Now collapse: use a non-empty expanded_rows set that does NOT include
    // the "T:east" key. This means "T:east" is NOT expanded (collapsed).
    let mut expansion_state = PivotExpansionState::default();
    expansion_state.expanded_rows.insert("T:west".to_string());

    let result_collapsed = compute(&config, &sample_sales_data(), Some(&expansion_state));
    assert!(result_collapsed.errors.is_none());

    let collapsed_count = result_collapsed.rows.len();
    assert!(
        collapsed_count < expanded_count,
        "Collapsed ({}) should have fewer rows than expanded ({})",
        collapsed_count,
        expanded_count
    );

    // Verify East row exists but has no child rows
    let east_children: Vec<&PivotRow> = result_collapsed
        .rows
        .iter()
        .filter(|r| r.depth > 0 && r.key.starts_with("T:east"))
        .collect();
    assert!(
        east_children.is_empty(),
        "East should have no visible children when collapsed, got {}",
        east_children.len()
    );
}

// ============================================================================
// Expansion state regression test (moved from pivot_bug_repro_tests.rs)
// ============================================================================

#[test]
fn expansion_state_hides_children_of_collapsed_items() {
    // Data: 3-level hierarchy: Division > Department > Employee
    // Division "Engineering" is expanded (shows departments)
    // Division "Sales" is collapsed (should NOT show departments)
    let data = vec![
        vec![
            cv_text("Division"),
            cv_text("Department"),
            cv_text("Employee"),
            cv_text("Salary"),
        ],
        // Engineering (expanded) — should show departments
        vec![
            cv_text("Engineering"),
            cv_text("Backend"),
            cv_text("Alice"),
            cv_num(120000.0),
        ],
        vec![
            cv_text("Engineering"),
            cv_text("Backend"),
            cv_text("Bob"),
            cv_num(110000.0),
        ],
        vec![
            cv_text("Engineering"),
            cv_text("Frontend"),
            cv_text("Carol"),
            cv_num(105000.0),
        ],
        // Sales (collapsed) — should NOT show departments
        vec![
            cv_text("Sales"),
            cv_text("Enterprise"),
            cv_text("Dave"),
            cv_num(90000.0),
        ],
        vec![
            cv_text("Sales"),
            cv_text("SMB"),
            cv_text("Eve"),
            cv_num(85000.0),
        ],
        // Marketing (collapsed) — should NOT show departments
        vec![
            cv_text("Marketing"),
            cv_text("Growth"),
            cv_text("Frank"),
            cv_num(95000.0),
        ],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("division"),
            name: "Division".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("department"),
            name: "Department".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("employee"),
            name: "Employee".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("salary"),
            name: "Salary".to_string(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config = make_base_config(
        fields,
        vec![
            make_placement("division", PivotFieldArea::Row, 0, None),
            make_placement("department", PivotFieldArea::Row, 1, None),
            make_placement("employee", PivotFieldArea::Row, 2, None),
            make_placement(
                "salary",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    // Only "Engineering" is expanded — Sales and Marketing are collapsed.
    // The expansion state set contains only the expanded nodes.
    let mut expansion = PivotExpansionState::default();
    expansion.expanded_rows.insert("T:engineering".to_string());

    let result = compute(&config, &data, Some(&expansion));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 10: Expansion state hides children ===");
    for r in &result.rows {
        let indent = "  ".repeat(r.depth);
        let label = r
            .headers
            .last()
            .map(|h| format!("{:?}", h.value))
            .unwrap_or_default();
        let val = r
            .values
            .first()
            .map(|v| format!("{:?}", v))
            .unwrap_or_default();
        let kind = if r.is_grand_total {
            " [grand total]"
        } else {
            ""
        };
        eprintln!("  {}{} = {}{}", indent, label, val, kind);
    }

    // Engineering is expanded: should see Engineering + its children
    let eng_children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth >= 1 && r.key.starts_with("T:engineering"))
        .collect();
    assert!(
        !eng_children.is_empty(),
        "Engineering is expanded — should have visible children"
    );

    // Sales is collapsed: should see "Sales" header row but NO children
    let sales_row = result
        .rows
        .iter()
        .find(|r| {
            r.depth == 0
                && !r.is_grand_total
                && r.headers
                    .first()
                    .map(|h| h.value == cv_text("Sales"))
                    .unwrap_or(false)
        })
        .expect("Should have a Sales row");
    assert_eq!(
        sales_row.headers[0].value,
        cv_text("Sales"),
        "Sales division should appear as a collapsed header"
    );

    let sales_children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth >= 1 && r.key.starts_with("T:sales"))
        .collect();
    assert!(
        sales_children.is_empty(),
        "Sales is collapsed — should have NO visible children, but found {}: {:?}",
        sales_children.len(),
        sales_children
            .iter()
            .map(|r| &r.headers)
            .collect::<Vec<_>>()
    );

    // Marketing is also collapsed: should have NO children visible
    let mkt_children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth >= 1 && r.key.starts_with("T:marketing"))
        .collect();
    assert!(
        mkt_children.is_empty(),
        "Marketing is collapsed — should have NO visible children, but found {}",
        mkt_children.len()
    );
}

/// Verifies that compute with expansion_state=None expands all groups
/// (matching Excel's default: new pivots show all items expanded).
/// XLSX import paths that need specific collapse behavior should pass an
/// explicit PivotExpansionState built from sd="0" attributes.
#[test]
fn none_expansion_state_expands_all_groups() {
    let data = vec![
        vec![
            cv_text("Division"),
            cv_text("Department"),
            cv_text("Salary"),
        ],
        vec![cv_text("Engineering"), cv_text("Backend"), cv_num(120000.0)],
        vec![
            cv_text("Engineering"),
            cv_text("Frontend"),
            cv_num(105000.0),
        ],
        vec![cv_text("Sales"), cv_text("Enterprise"), cv_num(90000.0)],
        vec![cv_text("Sales"), cv_text("SMB"), cv_num(85000.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("division"),
            name: "Division".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("department"),
            name: "Department".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("salary"),
            name: "Salary".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config = make_base_config(
        fields,
        vec![
            make_placement("division", PivotFieldArea::Row, 0, None),
            make_placement("department", PivotFieldArea::Row, 1, None),
            make_placement(
                "salary",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    // None means "expand all" — inner row field children should be visible
    let result = compute(&config, &data, None);
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // All depth-1 children (Backend, Frontend, Enterprise, SMB) should be visible
    let children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth >= 1 && !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert_eq!(
        children.len(),
        4,
        "expansion_state=None should expand all groups — expected 4 depth>=1 children \
         (Backend, Frontend, Enterprise, SMB), found {}",
        children.len()
    );
}
