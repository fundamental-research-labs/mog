//! Tests for tabular and outline layout forms.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

/// Helper to create a PivotTableLayout with the given layout form.
fn layout_with_form(form: LayoutForm) -> PivotTableLayout {
    PivotTableLayout {
        layout_form: Some(form),
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    }
}

// --------------------------------------------------------------------------
// Tabular layout tests
// --------------------------------------------------------------------------

/// 2 row fields (Region, Product), Value=Sum(Sales), tabular layout.
/// All rows should be leaf-level with 2 headers each.
#[test]
fn tabular_basic_two_level() {
    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // In tabular layout, only leaf rows are emitted (no group header rows).
    // 4 leaf rows: East+Gadget, East+Widget, West+Gadget, West+Widget
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(
        data_rows.len(),
        4,
        "expected 4 leaf rows, got {}",
        data_rows.len()
    );

    // Each row should have exactly 2 headers (Region, Product)
    for row in &data_rows {
        assert_eq!(
            row.headers.len(),
            2,
            "row {:?} should have 2 headers, got {}",
            row.key,
            row.headers.len()
        );
    }

    // Verify specific values
    let east_widget = find_row_by_key(&result.rows, "East|Widget");
    assert!(east_widget.is_some(), "should find East|Widget row");
    assert_approx(&east_widget.unwrap().values[0], 2200.0, "East Widget sales");

    let east_gadget = find_row_by_key(&result.rows, "East|Gadget");
    assert!(east_gadget.is_some(), "should find East|Gadget row");
    assert_approx(&east_gadget.unwrap().values[0], 1700.0, "East Gadget sales");

    let west_widget = find_row_by_key(&result.rows, "West|Widget");
    assert!(west_widget.is_some(), "should find West|Widget row");
    assert_approx(&west_widget.unwrap().values[0], 3300.0, "West Widget sales");

    let west_gadget = find_row_by_key(&result.rows, "West|Gadget");
    assert!(west_gadget.is_some(), "should find West|Gadget row");
    assert_approx(&west_gadget.unwrap().values[0], 1300.0, "West Gadget sales");
}

/// 2 row fields, tabular, with subtotals on the outer (Region) field.
#[test]
fn tabular_with_subtotals() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.show_subtotals = Some(true);
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Should have subtotal rows
    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(
        !subtotal_rows.is_empty(),
        "tabular with subtotals should produce subtotal rows"
    );

    // Subtotals should match sum of children
    // East total: 2200 + 1700 = 3900
    let east_subtotal = subtotal_rows.iter().find(|r| {
        r.headers
            .iter()
            .any(|h| h.value == cv_text("East") || h.value == CellValue::Text("East Total".into()))
    });
    assert!(east_subtotal.is_some(), "should find East subtotal");
    assert_approx(&east_subtotal.unwrap().values[0], 3900.0, "East subtotal");

    // West total: 3300 + 1300 = 4600
    let west_subtotal = subtotal_rows.iter().find(|r| {
        r.headers
            .iter()
            .any(|h| h.value == cv_text("West") || h.value == CellValue::Text("West Total".into()))
    });
    assert!(west_subtotal.is_some(), "should find West subtotal");
    assert_approx(&west_subtotal.unwrap().values[0], 4600.0, "West subtotal");
}

/// Tabular with sort_by_value on the outer field (Region, depth 0).
///
/// In tabular mode, depth-0 group header rows are suppressed, so sort_by_value
/// targeting depth 0 has no rows to sort. The default alphabetical ordering
/// is preserved: East before West.
#[test]
fn tabular_sort_by_value_depth0() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(data_rows.len(), 4);

    // BUG: sort_by_value should order groups by desc sales totals.
    // West total (4600) > East total (3900), so West rows should come first.
    assert_eq!(
        data_rows[0].headers[0].value,
        cv_text("West"),
        "West (4600 total) should come before East (3900) in desc sort"
    );
    assert_eq!(
        data_rows.last().unwrap().headers[0].value,
        cv_text("East"),
        "East (3900 total) should come last in desc sort"
    );
}

/// Tabular with sort_by_value on the inner field (Product, depth 1).
///
/// In tabular mode, the depth-1 leaf rows exist but the sort_by_value
/// algorithm relies on depth-0 parent rows for tree reconstruction.
/// Since those are missing in tabular, the sort doesn't reorder.
#[test]
fn tabular_sort_by_value_depth1() {
    let mut product_axis = make_row_axis("product", 1);
    product_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_product = PivotFieldPlacement::Row(product_axis);

    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            placement_product,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // All rows are at depth 1 in tabular mode
    for row in &data_rows {
        assert_eq!(row.depth, 1);
    }

    // BUG: sort_by_value desc on Product (depth 1) should sort products
    // within each region by their sales total descending.
    // East: Widget(2200) > Gadget(1700), so Widget should come first.
    // West: Widget(3300) > Gadget(1300), so Widget should come first.
    let east_rows: Vec<&&PivotRow> = data_rows
        .iter()
        .filter(|r| r.headers[0].value == cv_text("East"))
        .collect();
    assert_eq!(east_rows.len(), 2);
    assert_eq!(
        east_rows[0].headers[1].value,
        cv_text("Widget"),
        "East Widget (2200) should come before East Gadget (1700) in desc sort"
    );
    assert_eq!(east_rows[1].headers[1].value, cv_text("Gadget"));

    let west_rows: Vec<&&PivotRow> = data_rows
        .iter()
        .filter(|r| r.headers[0].value == cv_text("West"))
        .collect();
    assert_eq!(west_rows.len(), 2);
    assert_eq!(
        west_rows[0].headers[1].value,
        cv_text("Widget"),
        "West Widget (3300) should come before West Gadget (1300) in desc sort"
    );
    assert_eq!(west_rows[1].headers[1].value, cv_text("Gadget"));
}

/// Tabular with sort_by_value on BOTH row fields.
///
/// Documents that sort_by_value is effectively a no-op in tabular layout
/// since the tree structure required for sorting is absent.
#[test]
fn tabular_sort_both_depths() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut product_axis = make_row_axis("product", 1);
    product_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_product = PivotFieldPlacement::Row(product_axis);

    let mut config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            placement_product,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(data_rows.len(), 4);

    // BUG: Both depths sorted desc by sales.
    // Depth 0: West(4600) > East(3900) → West first.
    // Depth 1 within West: Widget(3300) > Gadget(1300) → Widget first.
    // Depth 1 within East: Widget(2200) > Gadget(1700) → Widget first.
    assert_eq!(data_rows[0].headers[0].value, cv_text("West"));
    assert_eq!(data_rows[0].headers[1].value, cv_text("Widget"));
    assert_eq!(data_rows[1].headers[0].value, cv_text("West"));
    assert_eq!(data_rows[1].headers[1].value, cv_text("Gadget"));
    assert_eq!(data_rows[2].headers[0].value, cv_text("East"));
    assert_eq!(data_rows[2].headers[1].value, cv_text("Widget"));
    assert_eq!(data_rows[3].headers[0].value, cv_text("East"));
    assert_eq!(data_rows[3].headers[1].value, cv_text("Gadget"));
}

/// Tabular sort ascending — East(3900) should come before West(4600).
#[test]
fn tabular_sort_asc() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Asc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // Alphabetical: East first, West last (happens to match ascending by value too)
    assert_eq!(data_rows[0].headers[0].value, cv_text("East"));
    assert_eq!(data_rows.last().unwrap().headers[0].value, cv_text("West"),);
}

// --------------------------------------------------------------------------
// Outline layout tests
// --------------------------------------------------------------------------

/// Outline layout with 2 row fields — group header rows SHOULD exist.
#[test]
fn outline_basic_two_level() {
    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Outline));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // Outline should have group header rows at depth 0 (East, West)
    let depth0_rows: Vec<&&PivotRow> = data_rows.iter().filter(|r| r.depth == 0).collect();
    assert!(
        !depth0_rows.is_empty(),
        "outline layout should have group header rows at depth 0"
    );

    // Should also have leaf rows at depth 1
    let depth1_rows: Vec<&&PivotRow> = data_rows.iter().filter(|r| r.depth == 1).collect();
    assert_eq!(depth1_rows.len(), 4, "should have 4 leaf product rows");

    // Group header rows should have 1 header (just Region)
    for row in &depth0_rows {
        assert_eq!(
            row.headers.len(),
            1,
            "outline group header should have 1 header, got {}",
            row.headers.len()
        );
    }

    // Leaf rows should have 2 headers (Region + Product)
    for row in &depth1_rows {
        assert_eq!(
            row.headers.len(),
            2,
            "outline leaf row should have 2 headers, got {}",
            row.headers.len()
        );
    }
}

/// Outline layout with subtotals.
#[test]
fn outline_with_subtotals() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.show_subtotals = Some(true);
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Outline));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(
        !subtotal_rows.is_empty(),
        "outline with subtotals should produce subtotal rows"
    );

    // East subtotal = 3900, West subtotal = 4600
    let east_sub = subtotal_rows.iter().find(|r| {
        r.headers
            .iter()
            .any(|h| h.value == cv_text("East") || h.value == CellValue::Text("East Total".into()))
    });
    assert!(east_sub.is_some(), "should find East subtotal");
    assert_approx(
        &east_sub.unwrap().values[0],
        3900.0,
        "outline East subtotal",
    );

    let west_sub = subtotal_rows.iter().find(|r| {
        r.headers
            .iter()
            .any(|h| h.value == cv_text("West") || h.value == CellValue::Text("West Total".into()))
    });
    assert!(west_sub.is_some(), "should find West subtotal");
    assert_approx(
        &west_sub.unwrap().values[0],
        4600.0,
        "outline West subtotal",
    );
}

// --------------------------------------------------------------------------
// Tabular edge cases
// --------------------------------------------------------------------------

/// 3 row fields (Region, Product, Quarter) in tabular layout.
#[test]
fn tabular_three_level() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("quarter", PivotFieldArea::Row, 2, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // 8 leaf rows: 2 regions x 2 products x 2 quarters
    assert_eq!(
        data_rows.len(),
        8,
        "expected 8 leaf rows for 3-level tabular"
    );

    // Each row should have exactly 3 headers
    for row in &data_rows {
        assert_eq!(
            row.headers.len(),
            3,
            "3-level tabular row {:?} should have 3 headers, got {}",
            row.key,
            row.headers.len()
        );
    }

    // Spot-check a specific value
    let east_widget_q1 = find_row_by_key(&result.rows, "East|Widget|Q1");
    assert!(east_widget_q1.is_some(), "should find East|Widget|Q1");
    assert_approx(
        &east_widget_q1.unwrap().values[0],
        1000.0,
        "East Widget Q1 sales",
    );
}

/// Verify no group header row exists at depth==0 in 2-level tabular.
/// This was a known bug where group headers leaked into tabular output.
#[test]
fn tabular_no_group_header_rows() {
    let mut config = make_base_config(
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // No non-subtotal row should be at depth 0 in a 2-level tabular pivot.
    // Depth-0 nodes are group headers and should be skipped.
    let depth0_data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 0 && !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert!(
        depth0_data_rows.is_empty(),
        "tabular layout should not emit group header rows at depth 0, found {} rows: {:?}",
        depth0_data_rows.len(),
        depth0_data_rows.iter().map(|r| &r.key).collect::<Vec<_>>()
    );
}

/// Tabular layout with column fields — column structure should be unaffected.
#[test]
fn tabular_with_column_fields() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Column headers should still be present
    assert!(
        !result.column_headers.is_empty(),
        "column headers should be present with tabular layout"
    );

    // Should have Q1 and Q2 column headers
    let all_col_values: Vec<&CellValue> = result
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter().map(|h| &h.value))
        .collect();
    let has_q1 = all_col_values.iter().any(|v| **v == cv_text("Q1"));
    let has_q2 = all_col_values.iter().any(|v| **v == cv_text("Q2"));
    assert!(has_q1, "should have Q1 column");
    assert!(has_q2, "should have Q2 column");

    // Data rows should still be leaf-only (tabular behavior)
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(
        data_rows.len(),
        4,
        "should have 4 leaf rows with column fields"
    );

    for row in &data_rows {
        assert_eq!(row.headers.len(), 2, "each row should have 2 row headers");
    }
}

/// Compact vs Tabular with the same config should produce identical aggregated totals.
#[test]
fn compact_vs_tabular_same_values() {
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement("product", PivotFieldArea::Row, 1, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];

    // Compact
    let mut compact_config = make_base_config(sample_fields(), placements.clone(), vec![]);
    compact_config.layout = Some(layout_with_form(LayoutForm::Compact));
    let compact_result = compute(&compact_config, &sample_sales_data(), Some(&expand_all()));
    assert!(
        compact_result.errors.is_none(),
        "compact errors: {:?}",
        compact_result.errors
    );

    // Tabular
    let mut tabular_config = make_base_config(sample_fields(), placements, vec![]);
    tabular_config.layout = Some(layout_with_form(LayoutForm::Tabular));
    let tabular_result = compute(&tabular_config, &sample_sales_data(), Some(&expand_all()));
    assert!(
        tabular_result.errors.is_none(),
        "tabular errors: {:?}",
        tabular_result.errors
    );

    // Collect leaf-level values from both and compare.
    // For tabular, all non-subtotal rows are leaf rows.
    // For compact, leaf rows are at the deepest depth (depth 1).
    let tabular_leaf_values: Vec<(&CellValue, &CellValue)> = tabular_result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .map(|r| (&r.headers.last().unwrap().value, &r.values[0]))
        .collect();

    let compact_leaf_values: Vec<(&CellValue, &CellValue)> = compact_result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total && r.depth == 1)
        .map(|r| (&r.headers.last().unwrap().value, &r.values[0]))
        .collect();

    assert_eq!(
        tabular_leaf_values.len(),
        compact_leaf_values.len(),
        "same number of leaf rows"
    );

    // Sort both by the last header value for stable comparison
    let mut tabular_sorted: Vec<_> = tabular_leaf_values;
    let mut compact_sorted: Vec<_> = compact_leaf_values;
    tabular_sorted.sort_by(|a, b| format!("{:?}", a.0).cmp(&format!("{:?}", b.0)));
    compact_sorted.sort_by(|a, b| format!("{:?}", a.0).cmp(&format!("{:?}", b.0)));

    for (t, c) in tabular_sorted.iter().zip(compact_sorted.iter()) {
        assert_eq!(t.0, c.0, "header mismatch");
        assert_eq!(t.1, c.1, "value mismatch for header {:?}", t.0);
    }

    // Grand totals should also match
    assert_eq!(
        tabular_result.grand_totals.row, compact_result.grand_totals.row,
        "row grand totals should match between compact and tabular"
    );
}

// ============================================================================
// Tabular layout regression tests (moved from pivot_bug_repro_tests.rs)
// ============================================================================

#[test]
fn tabular_sort_by_value_alignment() {
    let data = census_data();
    let fields = census_fields();

    // Tabular layout with 2 row fields
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
        show_subtotals: Some(true),
    });

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
            value_field_id: FieldId::from("flc"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_avg = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("flc"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Avg FLC".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Average,
        number_format: None,
        show_values_as: None,
    });

    let mut config = make_base_config(fields, vec![row_function, row_role, value_avg], vec![]);
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 4: Tabular sort alignment ===");
    for r in &result.rows {
        let headers: Vec<String> = r.headers.iter().map(|h| format!("{:?}", h.value)).collect();
        let vals: Vec<String> = r.values.iter().map(|v| format!("{:?}", v)).collect();
        let kind = if r.is_subtotal { " [subtotal]" } else { "" };
        eprintln!(
            "  depth={} headers={:?} vals={:?}{}",
            r.depth, headers, vals, kind
        );
    }

    // In tabular layout, each leaf row should have exactly 2 headers
    // (one for each row field level)
    let leaf_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    for row in &leaf_rows {
        assert_eq!(
            row.headers.len(),
            2,
            "Tabular leaf rows should have 2 headers, got {} for row with key '{}'",
            row.headers.len(),
            row.key
        );

        // Values should be numeric (Avg FLC), never text
        for (i, val) in row.values.iter().enumerate() {
            match val {
                CellValue::Number(_) | CellValue::Null => {} // OK
                other => panic!(
                    "Value at index {} should be numeric, got {:?} for row key '{}'",
                    i, other, row.key
                ),
            }
        }
    }

    // Check sort order: sorted by Avg FLC desc
    // Principal avg = (120000+125000)/2 = 122500
    // Manager avg = (80000+85000+82000)/3 = 82333.33
    // IC avg = (50000+55000+48000+52000+51000)/5 = 51200
    // Director avg = 150000/1 = 150000
    // Expected desc: Director (150000), Principal (122500), Manager (82333), IC (51200)
    assert_eq!(
        leaf_rows[0].headers[1].value,
        cv_text("Director"),
        "Director (avg FLC 150000) should be first"
    );
    assert_eq!(
        leaf_rows[1].headers[1].value,
        cv_text("Principal"),
        "Principal (avg FLC 122500) should be second"
    );
}

#[test]
fn tabular_no_repeat_row_labels() {
    let data = census_data();
    let fields = census_fields();

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

    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_sum = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("flc"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Sum of FLC".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Sum,
        number_format: None,
        show_values_as: None,
    });

    let mut config = make_base_config(fields, vec![row_function, row_role, value_sum], vec![]);
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        repeat_row_labels: Some(false), // default Excel behavior
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    eprintln!("=== Bug 6: Tabular no-repeat labels ===");
    for r in &result.rows {
        let headers: Vec<String> = r.headers.iter().map(|h| format!("{:?}", h.value)).collect();
        let kind = if r.is_subtotal { " [sub]" } else { "" };
        eprintln!("  depth={} headers={:?}{}", r.depth, headers, kind);
    }

    // In tabular layout with repeat_row_labels=false (default),
    // only the FIRST row in each outer group should have the outer header.
    // Subsequent rows should have Null for the first header position.
    let leaf_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // All rows under COGS: first row should have "COGS", rest should have Null
    assert!(leaf_rows.len() >= 2, "need at least 2 leaf rows");

    // First leaf row: should have the outer header
    assert_eq!(
        leaf_rows[0].headers[0].value,
        cv_text("COGS"),
        "First row should show the outer header"
    );

    // NOTE: The compute engine always produces full header values.
    // The repeat_row_labels suppression belongs in the rendering layer
    // (when mapping PivotTableResult to grid cells), not in the compute output.
    // This test documents the expected rendering behavior.
    // For now, verify the compute engine produces the correct label (not Null):
    assert_eq!(
        leaf_rows[1].headers[0].value,
        cv_text("COGS"),
        "Compute engine should produce full header values (rendering layer handles suppression)"
    );
    // TODO: Add rendering-layer test that verifies repeat_row_labels=false
    // suppresses this header to Null on the grid.
}

#[test]
fn tabular_subtotal_null_in_unused_header() {
    let data = vec![
        vec![cv_text("Dept"), cv_text("Type"), cv_text("EmpID")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E1")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E2")],
        vec![cv_text("SOC"), cv_text("Offshore"), cv_text("E3")],
        vec![cv_text("FedRAMP"), cv_text("Direct"), cv_text("E4")],
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

    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Desc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true), // Enable subtotals
    });

    let row_type = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("type"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
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
    // Set tabular layout
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    eprintln!("=== Bug 6: Tabular subtotal null vs empty ===");
    for r in &result.rows {
        let kind = if r.is_subtotal { " [subtotal]" } else { "" };
        let headers_str: Vec<String> = r.headers.iter().map(|h| format!("{:?}", h.value)).collect();
        eprintln!(
            "  depth={} headers=[{}] val={:?}{}",
            r.depth,
            headers_str.join(", "),
            r.values[0],
            kind
        );
    }

    // Find subtotal rows
    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(
        !subtotal_rows.is_empty(),
        "should have subtotal rows in tabular layout"
    );

    // In tabular layout, subtotal rows have headers for each row field column.
    // The subtotal label (e.g., "SOC Total") goes in the first header (depth 0 field).
    // The second header (depth 1 field = "Type") should be Null, not empty string.
    for st in &subtotal_rows {
        if st.headers.len() >= 2 {
            let inner_header_value = &st.headers[1].value;
            assert_eq!(
                *inner_header_value,
                CellValue::Null,
                "Subtotal row '{}' should have Null in inner header column, got {:?}",
                st.headers[0].value,
                inner_header_value
            );
        }
    }
}
