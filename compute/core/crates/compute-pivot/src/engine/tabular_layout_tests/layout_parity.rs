use super::*;

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

    let mut compact_config = make_base_config(sample_fields(), placements.clone(), vec![]);
    compact_config.layout = Some(layout_with_form(LayoutForm::Compact));
    let compact_result = compute(&compact_config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&compact_result, "compact_vs_tabular_same_values compact");

    let mut tabular_config = make_base_config(sample_fields(), placements, vec![]);
    tabular_config.layout = Some(layout_with_form(LayoutForm::Tabular));
    let tabular_result = compute(&tabular_config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&tabular_result, "compact_vs_tabular_same_values tabular");

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

    let mut tabular_sorted: Vec<_> = tabular_leaf_values;
    let mut compact_sorted: Vec<_> = compact_leaf_values;
    tabular_sorted.sort_by(|a, b| format!("{:?}", a.0).cmp(&format!("{:?}", b.0)));
    compact_sorted.sort_by(|a, b| format!("{:?}", a.0).cmp(&format!("{:?}", b.0)));

    for (t, c) in tabular_sorted.iter().zip(compact_sorted.iter()) {
        assert_eq!(t.0, c.0, "header mismatch");
        assert_eq!(t.1, c.1, "value mismatch for header {:?}", t.0);
    }

    assert_eq!(
        tabular_result.grand_totals.row, compact_result.grand_totals.row,
        "row grand totals should match between compact and tabular"
    );
}
