use super::*;

// ============================================================================

#[test]
fn explicit_collapse_all_state_collapses_all_groups() {
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
            id: FieldId::from("div"),
            name: "Division".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("dept"),
            name: "Department".into(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sal"),
            name: "Salary".into(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config = make_base_config(
        fields,
        vec![
            make_placement("div", PivotFieldArea::Row, 0, None),
            make_placement("dept", PivotFieldArea::Row, 1, None),
            make_placement(
                "sal",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    // Explicit collapse-all: non-empty set with sentinel key makes all real keys absent → collapsed
    let collapse_all = PivotExpansionState {
        expanded_rows: std::collections::HashSet::from(["__COLLAPSE_ALL__".to_string()]),
        expanded_columns: std::collections::HashSet::new(),
        expanded_row_keys: Vec::new(),
        expanded_column_keys: Vec::new(),
    };
    let result = compute(&config, &data, Some(&collapse_all));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth >= 1 && !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert!(
        children.is_empty(),
        "explicit collapse-all should hide all depth>=1 rows, found {}",
        children.len()
    );

    // Top-level division rows should still appear
    let top_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 0 && !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(
        top_rows.len(),
        2,
        "should have Engineering and Sales at depth 0"
    );
}

// ============================================================================
// Multi-level sort_by_value with column_key at inner depth
// ============================================================================
// 5-level hierarchy where BU (depth 2) sorts by FY2024.
// FY2022 and FY2024 have opposite BU orderings.
