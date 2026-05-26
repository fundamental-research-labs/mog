//! Slicer Module — Pure computation for slicer CRUD and selection operations.
//!
//! All functions are pure and stateless. Slicer objects are readonly.
//! Selection changes return new Slicer instances — no mutation.
//!
//! Bridge pattern: `slicer_to_filter_criteria()` converts slicer selection into
//! a FilterCriteria, enabling composition with table filters through the same pipeline.

use super::compare::cell_values_equal;
use super::types::{
    ConditionFilter, FilterCriteria, FilterLogic, Slicer, SlicerCache, SlicerSortOrder,
    SlicerSourceType, ValueFilter,
};
use value_types::CellValue;

// =============================================================================
// Slicer Creation
// =============================================================================

/// Create a new Slicer with the given configuration.
pub fn create_slicer(
    id: &str,
    name: &str,
    source_type: SlicerSourceType,
    source_id: &str,
    column_id: &str,
) -> Slicer {
    Slicer {
        id: id.to_string(),
        name: name.to_string(),
        source_type,
        source_id: source_id.to_string(),
        source_column_id: column_id.to_string(),
        selected_values: Vec::new(),
        multi_select: true,
        show_items_with_no_data: false,
        sort_order: SlicerSortOrder::Ascending,
    }
}

// =============================================================================
// Internal Helper
// =============================================================================

/// Create a new Slicer with different `selected_values`, cloning all other fields
/// individually to avoid the double-clone from `..slicer.clone()`.
fn with_selected_values(slicer: &Slicer, selected_values: Vec<CellValue>) -> Slicer {
    Slicer {
        selected_values,
        id: slicer.id.clone(),
        name: slicer.name.clone(),
        source_type: slicer.source_type,
        source_id: slicer.source_id.clone(),
        source_column_id: slicer.source_column_id.clone(),
        multi_select: slicer.multi_select,
        show_items_with_no_data: slicer.show_items_with_no_data,
        sort_order: slicer.sort_order,
    }
}

// =============================================================================
// Slicer Selection Operations
// =============================================================================

/// Toggle a value in the slicer's selection.
///
/// - If multiSelect: add/remove from selectedValues
/// - If !multiSelect: set to just [value] (or clear if already the sole selection)
pub fn toggle_slicer_value(slicer: &Slicer, value: &CellValue) -> Slicer {
    if !slicer.multi_select {
        // Single select: if already selected as sole item, clear; otherwise select only this value
        let is_currently_selected = slicer.selected_values.len() == 1
            && cell_values_equal(&slicer.selected_values[0], value);
        let new_values = if is_currently_selected {
            Vec::new()
        } else {
            vec![value.clone()]
        };
        with_selected_values(slicer, new_values)
    } else {
        // Multi select: add if not present, remove if present
        let idx = slicer
            .selected_values
            .iter()
            .position(|v| cell_values_equal(v, value));
        match idx {
            Some(i) => {
                let mut new_values = slicer.selected_values.clone();
                new_values.remove(i);
                with_selected_values(slicer, new_values)
            }
            None => {
                let mut new_values = slicer.selected_values.clone();
                new_values.push(value.clone());
                with_selected_values(slicer, new_values)
            }
        }
    }
}

/// Set the slicer's selection to the given values.
pub fn select_slicer_values(slicer: &Slicer, values: &[CellValue]) -> Slicer {
    with_selected_values(slicer, values.to_vec())
}

/// Clear all slicer selection (show all data).
pub fn clear_slicer_selection(slicer: &Slicer) -> Slicer {
    with_selected_values(slicer, Vec::new())
}

/// Select all values available in the slicer cache.
///
/// "Select all" in slicer semantics means "no filter active" = empty selection.
/// This works correctly for both single-select and multi-select modes, since
/// empty `selected_values` already means "all selected" (no filtering).
pub fn select_all_slicer_values(slicer: &Slicer, _cache: &SlicerCache) -> Slicer {
    clear_slicer_selection(slicer)
}

/// Set the slicer's multi_select mode.
pub fn set_slicer_multi_select(slicer: &Slicer, multi: bool) -> Slicer {
    Slicer {
        multi_select: multi,
        ..slicer.clone()
    }
}

/// Set the slicer's sort order.
pub fn set_slicer_sort_order(slicer: &Slicer, order: SlicerSortOrder) -> Slicer {
    Slicer {
        sort_order: order,
        ..slicer.clone()
    }
}

// =============================================================================
// Slicer -> Filter Conversion
// =============================================================================

/// Convert slicer selection into a FilterCriteria for composition with table filters.
///
/// This is the key bridge: slicer selection flows through the same filter pipeline
/// as explicit column filters, enabling slicer+filter composition.
///
/// - Empty selectedValues -> include everything (empty ConditionFilter that matches all rows)
/// - Non-empty selectedValues -> include only those values; includeBlanks=true if null is selected
pub fn slicer_to_filter_criteria(slicer: &Slicer) -> FilterCriteria {
    if slicer.selected_values.is_empty() {
        // No selection = no filtering (show all)
        // Return empty ConditionFilter which matches everything
        return FilterCriteria::Condition(ConditionFilter {
            conditions: Vec::new(),
            logic: FilterLogic::And,
        });
    }

    let include_blanks = slicer.selected_values.iter().any(|v| v.is_visually_blank());
    let non_null_values: Vec<CellValue> = slicer
        .selected_values
        .iter()
        .filter(|v| !v.is_visually_blank())
        .cloned()
        .collect();

    FilterCriteria::Values(ValueFilter {
        included: non_null_values,
        include_blanks,
    })
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellValue;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_slicer() -> Slicer {
        create_slicer("s1", "Region", SlicerSourceType::Table, "table1", "col1")
    }

    fn make_single_select_slicer() -> Slicer {
        let mut s = make_slicer();
        s.multi_select = false;
        s
    }

    fn cv_str(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    // -----------------------------------------------------------------------
    // createSlicer
    // -----------------------------------------------------------------------

    #[test]
    fn create_slicer_defaults() {
        let s = create_slicer("s1", "Region", SlicerSourceType::Table, "table1", "col1");
        assert_eq!(s.id, "s1");
        assert_eq!(s.name, "Region");
        assert_eq!(s.source_type, SlicerSourceType::Table);
        assert_eq!(s.source_id, "table1");
        assert_eq!(s.source_column_id, "col1");
        assert!(s.selected_values.is_empty());
        assert!(s.multi_select);
        assert!(!s.show_items_with_no_data);
        assert_eq!(s.sort_order, SlicerSortOrder::Ascending);
    }

    #[test]
    fn create_slicer_pivot_source() {
        let s = create_slicer("s2", "Status", SlicerSourceType::Pivot, "pivot1", "field1");
        assert_eq!(s.source_type, SlicerSourceType::Pivot);
    }

    // -----------------------------------------------------------------------
    // toggleSlicerValue (multi-select)
    // -----------------------------------------------------------------------

    #[test]
    fn toggle_adds_value_when_not_selected() {
        let s = make_slicer();
        let s = toggle_slicer_value(&s, &cv_str("East"));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(&s.selected_values[0], &cv_str("East")));
    }

    #[test]
    fn toggle_removes_value_when_already_selected() {
        let s = make_slicer();
        let s = toggle_slicer_value(&s, &cv_str("East"));
        let s = toggle_slicer_value(&s, &cv_str("West"));
        assert_eq!(s.selected_values.len(), 2);
        let s = toggle_slicer_value(&s, &cv_str("East"));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(&s.selected_values[0], &cv_str("West")));
    }

    #[test]
    fn toggle_handles_null_values() {
        let s = make_slicer();
        let s = toggle_slicer_value(&s, &CellValue::Null);
        assert_eq!(s.selected_values.len(), 1);
        assert!(matches!(s.selected_values[0], CellValue::Null));
        let s = toggle_slicer_value(&s, &CellValue::Null);
        assert!(s.selected_values.is_empty());
    }

    #[test]
    fn toggle_case_insensitive_strings() {
        let s = make_slicer();
        let s = toggle_slicer_value(&s, &cv_str("Hello"));
        assert_eq!(s.selected_values.len(), 1);
        // Toggling "hello" (lowercase) should remove "Hello"
        let s = toggle_slicer_value(&s, &cv_str("hello"));
        assert!(s.selected_values.is_empty());
    }

    #[test]
    fn toggle_adds_nan() {
        // CellValue::number(f64::NAN) → Error(Num) since FiniteF64 excludes NaN
        let s = make_slicer();
        let s = toggle_slicer_value(&s, &CellValue::number(f64::NAN));
        assert_eq!(s.selected_values.len(), 1);
        assert!(matches!(
            &s.selected_values[0],
            CellValue::Error(value_types::CellError::Num, None)
        ));
    }

    #[test]
    fn toggle_removes_nan() {
        // CellValue::number(f64::NAN) → Error(Num) since FiniteF64 excludes NaN
        let s = make_slicer();
        let s = toggle_slicer_value(&s, &CellValue::number(f64::NAN));
        assert_eq!(s.selected_values.len(), 1);
        let s = toggle_slicer_value(&s, &CellValue::number(f64::NAN));
        assert!(s.selected_values.is_empty());
    }

    // -----------------------------------------------------------------------
    // toggleSlicerValue (single-select)
    // -----------------------------------------------------------------------

    #[test]
    fn single_select_selects_value() {
        let s = make_single_select_slicer();
        let s = toggle_slicer_value(&s, &cv_str("East"));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(&s.selected_values[0], &cv_str("East")));
    }

    #[test]
    fn single_select_replaces_with_new_value() {
        let s = make_single_select_slicer();
        let s = toggle_slicer_value(&s, &cv_str("East"));
        let s = toggle_slicer_value(&s, &cv_str("West"));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(&s.selected_values[0], &cv_str("West")));
    }

    #[test]
    fn single_select_clears_when_toggling_same() {
        let s = make_single_select_slicer();
        let s = toggle_slicer_value(&s, &cv_str("East"));
        let s = toggle_slicer_value(&s, &cv_str("East"));
        assert!(s.selected_values.is_empty());
    }

    // -----------------------------------------------------------------------
    // select_slicer_values
    // -----------------------------------------------------------------------

    #[test]
    fn select_values_sets_selection() {
        let s = make_slicer();
        let s = select_slicer_values(&s, &[cv_str("East"), cv_str("West")]);
        assert_eq!(s.selected_values.len(), 2);
    }

    #[test]
    fn select_values_replaces_existing() {
        let s = make_slicer();
        let s = select_slicer_values(&s, &[cv_str("East")]);
        let s = select_slicer_values(&s, &[cv_str("North"), cv_str("South")]);
        assert_eq!(s.selected_values.len(), 2);
        assert!(cell_values_equal(&s.selected_values[0], &cv_str("North")));
        assert!(cell_values_equal(&s.selected_values[1], &cv_str("South")));
    }

    // -----------------------------------------------------------------------
    // clear_slicer_selection
    // -----------------------------------------------------------------------

    #[test]
    fn clear_selection() {
        let s = make_slicer();
        let s = select_slicer_values(&s, &[cv_str("East"), cv_str("West")]);
        let s = clear_slicer_selection(&s);
        assert!(s.selected_values.is_empty());
    }

    // -----------------------------------------------------------------------
    // select_all_slicer_values
    // -----------------------------------------------------------------------

    #[test]
    fn select_all_clears_selection() {
        // "Select all" means "no filter" = empty selection (which means all visible)
        let s = make_slicer();
        let s = select_slicer_values(&s, &[cv_str("East")]); // start with a selection
        let cache = SlicerCache {
            items: vec![
                super::super::types::SlicerCacheItem {
                    value: cv_str("East"),
                    display_text: "East".to_string(),
                    count: 3,
                    selected: true,
                    has_data: true,
                },
                super::super::types::SlicerCacheItem {
                    value: cv_str("West"),
                    display_text: "West".to_string(),
                    count: 2,
                    selected: false,
                    has_data: true,
                },
                super::super::types::SlicerCacheItem {
                    value: cv_str("North"),
                    display_text: "North".to_string(),
                    count: 1,
                    selected: false,
                    has_data: true,
                },
            ],
            total_count: 3,
            selected_count: 1,
        };
        let s = select_all_slicer_values(&s, &cache);
        // Empty selection = all selected (no filter active)
        assert!(s.selected_values.is_empty());
    }

    #[test]
    fn select_all_in_single_select_mode() {
        let mut s = make_slicer();
        s.multi_select = false;
        let s = select_slicer_values(&s, &[cv_str("East")]); // start with a selection
        let cache = SlicerCache {
            items: vec![
                super::super::types::SlicerCacheItem {
                    value: cv_str("East"),
                    display_text: "East".to_string(),
                    count: 3,
                    selected: true,
                    has_data: true,
                },
                super::super::types::SlicerCacheItem {
                    value: cv_str("West"),
                    display_text: "West".to_string(),
                    count: 2,
                    selected: false,
                    has_data: true,
                },
                super::super::types::SlicerCacheItem {
                    value: cv_str("North"),
                    display_text: "North".to_string(),
                    count: 1,
                    selected: false,
                    has_data: true,
                },
            ],
            total_count: 3,
            selected_count: 1,
        };
        let s = select_all_slicer_values(&s, &cache);
        // Single-select: select all also clears selection (empty = all visible)
        assert!(s.selected_values.is_empty());
        assert!(!s.multi_select);
    }

    // -----------------------------------------------------------------------
    // set_slicer_multi_select
    // -----------------------------------------------------------------------

    #[test]
    fn set_multi_select() {
        let s = make_slicer();
        assert!(s.multi_select);
        let s = set_slicer_multi_select(&s, false);
        assert!(!s.multi_select);
        let s = set_slicer_multi_select(&s, true);
        assert!(s.multi_select);
    }

    // -----------------------------------------------------------------------
    // set_slicer_sort_order
    // -----------------------------------------------------------------------

    #[test]
    fn set_sort_order() {
        let s = make_slicer();
        assert_eq!(s.sort_order, SlicerSortOrder::Ascending);
        let s = set_slicer_sort_order(&s, SlicerSortOrder::Descending);
        assert_eq!(s.sort_order, SlicerSortOrder::Descending);
        let s = set_slicer_sort_order(&s, SlicerSortOrder::DataSourceOrder);
        assert_eq!(s.sort_order, SlicerSortOrder::DataSourceOrder);
        let s = set_slicer_sort_order(&s, SlicerSortOrder::Ascending);
        assert_eq!(s.sort_order, SlicerSortOrder::Ascending);
    }

    // -----------------------------------------------------------------------
    // slicer_to_filter_criteria
    // -----------------------------------------------------------------------

    #[test]
    fn empty_selection_to_pass_all_filter() {
        let s = make_slicer();
        let filter = slicer_to_filter_criteria(&s);
        match filter {
            FilterCriteria::Condition(cf) => {
                assert!(cf.conditions.is_empty());
            }
            _ => panic!("expected ConditionFilter"),
        }
    }

    #[test]
    fn selection_to_value_filter() {
        let s = make_slicer();
        let s = select_slicer_values(&s, &[cv_str("East"), cv_str("West")]);
        let filter = slicer_to_filter_criteria(&s);
        match filter {
            FilterCriteria::Values(vf) => {
                assert_eq!(vf.included.len(), 2);
                assert!(!vf.include_blanks);
            }
            _ => panic!("expected ValueFilter"),
        }
    }

    #[test]
    fn selection_with_null_includes_blanks() {
        let s = make_slicer();
        let s = select_slicer_values(&s, &[cv_str("East"), CellValue::Null]);
        let filter = slicer_to_filter_criteria(&s);
        match filter {
            FilterCriteria::Values(vf) => {
                assert_eq!(vf.included.len(), 1); // Only "East", null is separated
                assert!(vf.include_blanks);
            }
            _ => panic!("expected ValueFilter"),
        }
    }

    // -----------------------------------------------------------------------
    // slicer_to_filter_criteria — only null selection
    // -----------------------------------------------------------------------

    #[test]
    fn test_slicer_to_filter_criteria_only_null() {
        // Selection contains only CellValue::Null (all blanks, no non-null values)
        let s = make_slicer();
        let s = select_slicer_values(&s, &[CellValue::Null]);
        let filter = slicer_to_filter_criteria(&s);
        match filter {
            FilterCriteria::Values(vf) => {
                // No non-null values in included list
                assert!(vf.included.is_empty());
                // But include_blanks must be true
                assert!(vf.include_blanks);
            }
            _ => panic!("expected ValueFilter"),
        }
    }

    // -----------------------------------------------------------------------
    // toggle with boolean values
    // -----------------------------------------------------------------------

    #[test]
    fn test_toggle_with_boolean_values() {
        let s = make_slicer();

        // Add true
        let s = toggle_slicer_value(&s, &CellValue::Boolean(true));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(
            &s.selected_values[0],
            &CellValue::Boolean(true)
        ));

        // Add false
        let s = toggle_slicer_value(&s, &CellValue::Boolean(false));
        assert_eq!(s.selected_values.len(), 2);
        assert!(cell_values_equal(
            &s.selected_values[1],
            &CellValue::Boolean(false)
        ));

        // Toggle true off
        let s = toggle_slicer_value(&s, &CellValue::Boolean(true));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(
            &s.selected_values[0],
            &CellValue::Boolean(false)
        ));

        // Toggle false off
        let s = toggle_slicer_value(&s, &CellValue::Boolean(false));
        assert!(s.selected_values.is_empty());
    }

    // -----------------------------------------------------------------------
    // toggle with error values
    // -----------------------------------------------------------------------

    #[test]
    fn test_toggle_with_error_values() {
        use value_types::CellError;

        let s = make_slicer();

        // Add #N/A error
        let s = toggle_slicer_value(&s, &CellValue::Error(CellError::Na, None));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(
            &s.selected_values[0],
            &CellValue::Error(CellError::Na, None)
        ));

        // Add #REF! error
        let s = toggle_slicer_value(&s, &CellValue::Error(CellError::Ref, None));
        assert_eq!(s.selected_values.len(), 2);

        // Toggling the same #N/A again should remove it
        let s = toggle_slicer_value(&s, &CellValue::Error(CellError::Na, None));
        assert_eq!(s.selected_values.len(), 1);
        assert!(cell_values_equal(
            &s.selected_values[0],
            &CellValue::Error(CellError::Ref, None)
        ));

        // Different error types are not confused
        let s = toggle_slicer_value(&s, &CellValue::Error(CellError::Value, None));
        assert_eq!(s.selected_values.len(), 2);
    }
}
