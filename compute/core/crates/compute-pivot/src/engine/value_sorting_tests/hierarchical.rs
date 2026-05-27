use super::*;

#[test]
fn multi_level_sort() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());

    // West (4600) should come before East (3900) at top level
    let top_level_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.depth == 0).collect();
    assert_eq!(top_level_rows[0].headers[0].value, cv_text("West"));
}
// ============================================================================
// Sort-by-value regression tests (moved from pivot_bug_repro_tests.rs)
// ============================================================================

#[test]
fn sort_by_value_inner_row_field_compact_layout() {
    let data = census_data();
    let fields = census_fields();

    // Row field 0: Function (no sort_by_value, just alphabetical)
    let row_function = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("function"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Row field 1: Role (sort_by_value desc on CountA of EmployeeID)
    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("employee_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Value: CountA of EmployeeID
    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("employee_id"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count of EmployeeID".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::CountA,
        number_format: None,
        show_values_as: None,
    });

    let config = make_base_config(fields, vec![row_function, row_role, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Get the leaf rows (depth 1 = Role level) for COGS function
    let leaf_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total && r.depth == 1)
        .collect();

    assert_eq!(leaf_rows.len(), 4, "should have 4 role rows under COGS");

    // Expected order: IC (5), Manager (3), Principal (2), Director (1) — desc by count
    assert_eq!(
        leaf_rows[0].headers.last().unwrap().value,
        cv_text("IC"),
        "IC (count=5) should be first when sorted by count desc"
    );
    assert_eq!(
        leaf_rows[1].headers.last().unwrap().value,
        cv_text("Manager"),
        "Manager (count=3) should be second"
    );
    assert_eq!(
        leaf_rows[2].headers.last().unwrap().value,
        cv_text("Principal"),
        "Principal (count=2) should be third"
    );
    assert_eq!(
        leaf_rows[3].headers.last().unwrap().value,
        cv_text("Director"),
        "Director (count=1) should be last"
    );
}
#[test]
fn sort_by_value_both_row_field_depths() {
    // Data: ServiceLine > EmploymentType, Count of employees
    let data = vec![
        vec![cv_text("ServiceLine"), cv_text("EmpType"), cv_text("EmpID")],
        // SOC: 5 total (Direct=3, Contractor=2)
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E1")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E2")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E3")],
        vec![cv_text("SOC"), cv_text("Contractor"), cv_text("E4")],
        vec![cv_text("SOC"), cv_text("Contractor"), cv_text("E5")],
        // FedRAMP: 3 total (Offshore=2, Direct=1)
        vec![cv_text("FedRAMP"), cv_text("Offshore"), cv_text("E6")],
        vec![cv_text("FedRAMP"), cv_text("Offshore"), cv_text("E7")],
        vec![cv_text("FedRAMP"), cv_text("Direct"), cv_text("E8")],
        // CMMC: 1 total (Direct=1)
        vec![cv_text("CMMC"), cv_text("Direct"), cv_text("E9")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("service_line"),
            name: "ServiceLine".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_type"),
            name: "EmpType".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // Both row fields sort by value desc
    let row_sl = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("service_line"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let row_et = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_type"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::CountA,
        number_format: None,
        show_values_as: None,
    });

    let config = make_base_config(fields, vec![row_sl, row_et, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Depth-0 order: SOC (5), FedRAMP (3), CMMC (1) — desc by total count
    let depth0: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 0 && !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(depth0.len(), 3);
    assert_eq!(
        depth0[0].headers[0].value,
        cv_text("SOC"),
        "SOC (5 employees) should be first"
    );
    assert_eq!(
        depth0[1].headers[0].value,
        cv_text("FedRAMP"),
        "FedRAMP (3 employees) should be second"
    );
    assert_eq!(
        depth0[2].headers[0].value,
        cv_text("CMMC"),
        "CMMC (1 employee) should be third"
    );

    // Within SOC: Direct (3) before Contractor (2)
    let soc_children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 1 && !r.is_subtotal && r.key.starts_with("T:soc"))
        .collect();
    assert_eq!(soc_children.len(), 2);
    assert_eq!(
        soc_children[0].headers.last().unwrap().value,
        cv_text("Direct"),
        "Within SOC, Direct (3) should be before Contractor (2)"
    );
    assert_eq!(
        soc_children[1].headers.last().unwrap().value,
        cv_text("Contractor"),
        "Within SOC, Contractor (2) should be after Direct (3)"
    );
}
#[test]
fn sort_by_value_column_field_desc() {
    // Data: Role (row), ServiceLine (column), EmployeeID (value count)
    let data = vec![
        vec![cv_text("Role"), cv_text("ServiceLine"), cv_text("EmpID")],
        // SOC: 5 employees
        vec![cv_text("IC"), cv_text("SOC"), cv_text("E1")],
        vec![cv_text("IC"), cv_text("SOC"), cv_text("E2")],
        vec![cv_text("IC"), cv_text("SOC"), cv_text("E3")],
        vec![cv_text("Manager"), cv_text("SOC"), cv_text("E4")],
        vec![cv_text("Manager"), cv_text("SOC"), cv_text("E5")],
        // FedRAMP: 3 employees
        vec![cv_text("IC"), cv_text("FedRAMP"), cv_text("E6")],
        vec![cv_text("Manager"), cv_text("FedRAMP"), cv_text("E7")],
        vec![cv_text("IC"), cv_text("FedRAMP"), cv_text("E8")],
        // CMMC: 1 employee
        vec![cv_text("IC"), cv_text("CMMC"), cv_text("E9")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("role"),
            name: "Role".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("service_line"),
            name: "ServiceLine".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Column field: ServiceLine sorted by value desc
    let col_sl = PivotFieldPlacement::Column(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("service_line"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::CountA,
        number_format: None,
        show_values_as: None,
    });

    let config = make_base_config(fields, vec![row_role, col_sl, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Column headers should be sorted by count desc: SOC (5), FedRAMP (3), CMMC (1)
    assert!(
        !result.column_headers.is_empty(),
        "should have column headers"
    );
    let col_labels: Vec<&CellValue> = result
        .column_headers
        .last() // last level = leaf level
        .unwrap()
        .headers
        .iter()
        .map(|h| &h.value)
        .collect();

    assert_eq!(
        col_labels[0],
        &cv_text("SOC"),
        "SOC (5 employees) should be first column (sorted by count desc)"
    );
    assert_eq!(
        col_labels[1],
        &cv_text("FedRAMP"),
        "FedRAMP (3 employees) should be second column"
    );
    assert_eq!(
        col_labels[2],
        &cv_text("CMMC"),
        "CMMC (1 employee) should be third column"
    );
}
#[test]
fn preserves_subtotals_after_sort() {
    let mut axis = make_row_axis("region", 0);
    axis.show_subtotals = Some(true);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());

    // Check that subtotals exist
    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(!subtotal_rows.is_empty());

    // Each subtotal should appear after its parent's children
    for subtotal in &subtotal_rows {
        let parent_key = subtotal.key.replace(SUBTOTAL_SUFFIX, "");
        let parent_index = result.rows.iter().position(|r| r.key == parent_key);
        let subtotal_index = result.rows.iter().position(|r| r.key == subtotal.key);
        assert!(subtotal_index.unwrap() > parent_index.unwrap());
    }
}
#[test]
fn sort_by_value_hierarchical_tiebreaker_with_subtotals() {
    // Mimics MuihIu PivotTable1: tabular layout, 2 row fields, both with
    // sort_by_value(Desc), and subtotals enabled on the outer field.
    //
    // The outer field has groups with tied counts. With subtotals, the
    // tiebreaker order affects both the group header position AND the
    // subtotal row position.

    let data = vec![
        vec![cv_text("Dept"), cv_text("Type"), cv_text("EmpID")],
        // Marketing: Direct=1
        vec![cv_text("Marketing"), cv_text("Direct"), cv_text("E1")],
        // Infrastructure: Direct=1 (same total as Marketing)
        vec![cv_text("Infrastructure"), cv_text("Direct"), cv_text("E2")],
        // SOC: Direct=3, Offshore=1 (highest total)
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E3")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E4")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E5")],
        vec![cv_text("SOC"), cv_text("Offshore"), cv_text("E6")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("dept"),
            name: "Dept".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("type"),
            name: "Type".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // Outer row field: Dept, sort_by_value desc, with custom_sort_list tiebreaker
    // After the fix, pivot_convert provides items-order custom_sort_list.
    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("Marketing"),
            cv_text("Infrastructure"),
            cv_text("SOC"),
        ]),
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });

    // Inner row field: Type, sort_by_value desc
    let row_type = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("type"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::CountA,
        number_format: None,
        show_values_as: None,
    });

    let mut config = make_base_config(fields, vec![row_dept, row_type, value_count], vec![]);
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Expected tabular row order:
    // 1. SOC | Direct (3)        ← SOC has 4 total, highest
    // 2. SOC | Offshore (1)
    // 3. SOC Total
    // 4. Marketing | Direct (1)  ← Marketing=1, Infra=1, tied — Marketing first per custom_sort_list
    // 5. Marketing Total
    // 6. Infrastructure | Direct (1)
    // 7. Infrastructure Total

    // Verify depth-0 order: SOC (4), then Marketing (1), then Infrastructure (1)
    // Find the first non-subtotal depth-0 rows to check order
    let first_leaf = result.rows.iter().find(|r| r.depth == 1 && !r.is_subtotal);
    assert!(first_leaf.is_some(), "should have leaf rows");

    // The first leaf should be under SOC (highest count)
    let first = first_leaf.unwrap();
    assert_eq!(
        first.headers[0].value,
        cv_text("SOC"),
        "First group should be SOC (count=4, highest)"
    );

    // After SOC's subtotal, the next leaf should be under Marketing (tied with Infrastructure, but first in custom_sort_list)
    let non_soc_leaves: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 1 && !r.is_subtotal && r.headers[0].value != cv_text("SOC"))
        .collect();

    assert!(
        non_soc_leaves.len() >= 2,
        "should have leaves for Marketing and Infrastructure"
    );
    assert_eq!(
        non_soc_leaves[0].headers[0].value,
        cv_text("Marketing"),
        "Marketing (count=1) should come before Infrastructure (count=1) — tiebreaker: custom_sort_list"
    );
    assert_eq!(
        non_soc_leaves[1].headers[0].value,
        cv_text("Infrastructure"),
        "Infrastructure (count=1) should come after Marketing — later in custom_sort_list"
    );
}
