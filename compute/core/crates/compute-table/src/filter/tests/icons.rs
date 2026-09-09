use super::*;
use crate::types::IconFilter;
use domain_types::FilterIconIdentity;

#[test]
fn icon_predicate_matches_identity_instead_of_value_and_never_all_passes_without_context() {
    let values = vec![CellValue::number(10.0); 4];
    let icons = vec![
        Some(FilterIconIdentity {
            icon_set_name: "3Arrows".into(),
            icon_index: 1,
        }),
        Some(FilterIconIdentity {
            icon_set_name: "3Flags".into(),
            icon_index: 1,
        }),
        Some(FilterIconIdentity {
            icon_set_name: "3Arrows".into(),
            icon_index: 2,
        }),
        None,
    ];
    let criterion = FilterCriteria::Icon(IconFilter {
        icon_set_name: "3Arrows".into(),
        icon_index: Some(1),
    });
    assert_eq!(
        evaluate_column_filter_with_icons(&criterion, &values, None, Some(&icons), None, None),
        vec![1, 0, 0, 0]
    );
    assert_eq!(
        evaluate_column_filter(&criterion, &values, None, None, None),
        vec![0, 0, 0, 0]
    );
    let none = FilterCriteria::Icon(IconFilter {
        icon_set_name: String::new(),
        icon_index: None,
    });
    assert_eq!(
        evaluate_column_filter_with_icons(&none, &values, None, Some(&icons), None, None),
        vec![0, 0, 0, 1]
    );
}
