//! Subtotals, grand totals, layout sensitivity tests.

use super::test_helpers::*;
use super::*;
use crate::types::*;

// ---- Grand totals ----

#[test]
fn compute_grand_totals() {
    let mut config = make_base_config(
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.grand_totals.row.is_some());
    assert!(result.grand_totals.grand.is_some());
    // Grand total: 3900 + 4600 = 8500
    assert_eq!(result.grand_totals.row.as_ref().unwrap()[0], cv_num(8500.0));
}

// ---- Subtotals preserved after sort ----

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

// ---- C3: Column grand totals ----

#[test]
fn column_grand_totals_populated() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none());

    let col_totals = result
        .grand_totals
        .column
        .as_ref()
        .expect("column grand totals should be populated");

    assert_eq!(col_totals.len(), result.rows.len());

    let east_idx = result
        .rows
        .iter()
        .position(|r| r.headers.first().map(|h| &h.value) == Some(&cv_text("East")))
        .expect("East row not found");
    assert_approx(&col_totals[east_idx][0], 3900.0, "East column grand total");

    let west_idx = result
        .rows
        .iter()
        .position(|r| r.headers.first().map(|h| &h.value) == Some(&cv_text("West")))
        .expect("West row not found");
    assert_approx(&col_totals[west_idx][0], 4600.0, "West column grand total");
}

#[test]
fn column_grand_totals_with_average() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Average),
            ),
        ],
        vec![],
    );
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none());

    let col_totals = result
        .grand_totals
        .column
        .as_ref()
        .expect("column grand totals should be populated");

    let east_idx = result
        .rows
        .iter()
        .position(|r| r.headers.first().map(|h| &h.value) == Some(&cv_text("East")))
        .expect("East row not found");
    assert_approx(
        &col_totals[east_idx][0],
        975.0,
        "East column grand total (average)",
    );
}

#[test]
fn column_grand_totals_no_column_fields() {
    let mut config = make_base_config(
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none());

    // Excel suppresses column grand totals when there are no column grouping fields.
    assert!(
        result.grand_totals.column.is_none(),
        "Column grand totals should be suppressed when no column grouping fields exist"
    );
}

#[test]
fn grand_total_corner_cell() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none());

    let grand = result
        .grand_totals
        .grand
        .as_ref()
        .expect("grand total corner cell should be populated");

    assert_approx(&grand[0], 8500.0, "Grand total corner cell");
}

// ---- FIX 1e: Grand total corner cell with only one dimension ----

#[test]
fn grand_total_corner_cell_with_only_row_grand_totals() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(false),
        ..Default::default()
    });
    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(
        result.grand_totals.grand.is_some(),
        "Corner cell (grand.grand) should exist when only row grand totals are enabled"
    );
}

#[test]
fn grand_total_corner_cell_with_only_column_grand_totals() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(false),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(
        result.grand_totals.grand.is_some(),
        "Corner cell (grand.grand) should exist when only column grand totals are enabled"
    );
}

// ---- Sensitivity tests ----

#[test]
fn sensitivity_layout_show_row_grand_totals() {
    let mut config_on = make_base_config(
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
    config_on.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: None,
        ..Default::default()
    });
    let result_on = compute(&config_on, &sample_sales_data(), Some(&expand_all()));

    let mut config_off = make_base_config(
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
    config_off.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(false),
        show_column_grand_totals: None,
        ..Default::default()
    });
    let result_off = compute(&config_off, &sample_sales_data(), Some(&expand_all()));

    assert_ne!(
        result_on.grand_totals.row.is_some(),
        result_off.grand_totals.row.is_some(),
        "layout_show_row_grand_totals must affect grand_totals.row: on={:?}, off={:?}",
        result_on.grand_totals.row.is_some(),
        result_off.grand_totals.row.is_some(),
    );
}

#[test]
fn sensitivity_layout_show_column_grand_totals() {
    // Must use actual column grouping fields — without them, column grand totals
    // are always suppressed (matching Excel behavior).
    let mut config_on = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
    config_on.layout = Some(PivotTableLayout {
        show_row_grand_totals: None,
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    let result_on = compute(&config_on, &sample_sales_data(), Some(&expand_all()));

    let mut config_off = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
    config_off.layout = Some(PivotTableLayout {
        show_row_grand_totals: None,
        show_column_grand_totals: Some(false),
        ..Default::default()
    });
    let result_off = compute(&config_off, &sample_sales_data(), Some(&expand_all()));

    assert_ne!(
        result_on.grand_totals.column.is_some(),
        result_off.grand_totals.column.is_some(),
        "layout_show_column_grand_totals must affect grand_totals.column: on={:?}, off={:?}",
        result_on.grand_totals.column.is_some(),
        result_off.grand_totals.column.is_some(),
    );
}

#[test]
fn sensitivity_layout_show_subtotals() {
    let config_off = make_base_config(
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
    let result_off = compute(&config_off, &sample_sales_data(), Some(&expand_all()));

    let mut axis = make_row_axis("region", 0);
    axis.show_subtotals = Some(true);
    let config_on = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
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
    let result_on = compute(&config_on, &sample_sales_data(), Some(&expand_all()));

    let subtotal_count_off = result_off.rows.iter().filter(|r| r.is_subtotal).count();
    let subtotal_count_on = result_on.rows.iter().filter(|r| r.is_subtotal).count();
    assert_ne!(
        subtotal_count_off, subtotal_count_on,
        "show_subtotals must affect subtotal row count: off={}, on={}",
        subtotal_count_off, subtotal_count_on,
    );
}

/// BUG REPRO: ShowValuesAs transforms (e.g. PercentOfParentRowTotal) are not applied
/// to subtotal rows when computed through the full engine pipeline.
/// Subtotal rows keep raw aggregated values instead of being converted to percentages.
#[test]
fn show_values_as_percent_of_parent_applied_to_subtotals() {
    let mut axis = make_row_axis("region", 0);
    axis.show_subtotals = Some(true);

    // First, compute WITHOUT ShowValuesAs to get raw subtotal values.
    let mut config_raw = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis.clone()),
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
    config_raw.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        ..Default::default()
    });
    let result_raw = compute(&config_raw, &sample_sales_data(), Some(&expand_all()));

    let raw_subtotals: Vec<_> = result_raw
        .rows
        .iter()
        .filter(|r| r.is_subtotal)
        .map(|r| (r.key.clone(), r.values[0].clone()))
        .collect();
    assert!(
        !raw_subtotals.is_empty(),
        "expected subtotal rows in raw result"
    );

    // Now compute WITH PercentOfParentRowTotal ShowValuesAs.
    let mut config_pct = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement("product", PivotFieldArea::Row, 1, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );
    config_pct.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        ..Default::default()
    });
    let result_pct =
        compute_with_show_values_as(&config_pct, &sample_sales_data(), Some(&expand_all()));

    // Subtotal rows should have DIFFERENT values from the raw result.
    // If the bug exists, they'll be identical (raw aggregates untransformed).
    let pct_subtotals: Vec<_> = result_pct
        .rows
        .iter()
        .filter(|r| r.is_subtotal)
        .map(|r| (r.key.clone(), r.values[0].clone()))
        .collect();
    assert_eq!(
        raw_subtotals.len(),
        pct_subtotals.len(),
        "same number of subtotal rows"
    );

    for (raw, pct) in raw_subtotals.iter().zip(pct_subtotals.iter()) {
        assert_eq!(raw.0, pct.0, "subtotal keys should match");
        assert_ne!(
            raw.1, pct.1,
            "subtotal row {:?} should be transformed by ShowValuesAs, \
             but raw ({:?}) == transformed ({:?})",
            raw.0, raw.1, pct.1,
        );
    }

    // Grand total should be transformed (1.0 for PercentOfParentRowTotal).
    if let Some(gt_raw) = result_raw.rows.iter().find(|r| r.is_grand_total) {
        let gt_pct = result_pct
            .rows
            .iter()
            .find(|r| r.is_grand_total)
            .expect("expected grand total in pct result");
        assert_ne!(
            gt_raw.values[0], gt_pct.values[0],
            "grand total should be transformed by ShowValuesAs"
        );
    }
}
