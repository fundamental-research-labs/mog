use super::super::*;
use super::common::*;

#[test]
fn test_percent_of_parent_row_total_transforms_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_approx(num(&rows[2].values[0]), 300.0 / 700.0, 0.001);
    assert_approx(num(&rows[5].values[0]), 400.0 / 700.0, 0.001);
    assert_approx(num(&rows[6].values[0]), 1.0, 0.001);
}

#[test]
fn test_percent_of_row_total_transforms_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_approx(num(&rows[2].values[0]), 1.0, 0.001);
    assert_approx(num(&rows[5].values[0]), 1.0, 0.001);
    assert_approx(num(&rows[6].values[0]), 1.0, 0.001);
}

#[test]
fn test_percent_of_parent_column_total_transforms_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_approx(num(&rows[2].values[0]), 300.0 / 700.0, 0.001);
    assert_approx(num(&rows[5].values[0]), 400.0 / 700.0, 0.001);
    assert_approx(num(&rows[6].values[0]), 1.0, 0.001);
}

#[test]
fn test_running_total_transforms_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_approx(num(&rows[2].values[0]), 300.0, 1e-10);
    assert_approx(num(&rows[5].values[0]), 700.0, 1e-10);
}

#[test]
fn test_rank_transforms_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankDescending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert!(
        num(&rows[2].values[0]) != 300.0,
        "East subtotal should be ranked, not raw 300.0"
    );
    assert!(
        num(&rows[5].values[0]) != 400.0,
        "West subtotal should be ranked, not raw 400.0"
    );
    assert!(
        num(&rows[6].values[0]) != 700.0,
        "Grand total should be ranked, not raw 700.0"
    );
}

#[test]
fn test_index_transforms_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Index,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert!(
        num(&rows[2].values[0]) != 300.0,
        "East subtotal should have index value, not raw 300.0"
    );
    assert!(
        num(&rows[5].values[0]) != 400.0,
        "West subtotal should have index value, not raw 400.0"
    );
    assert_approx(num(&rows[6].values[0]), 1.0, 0.001);
}
