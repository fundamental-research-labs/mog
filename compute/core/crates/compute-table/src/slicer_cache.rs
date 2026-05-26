//! Slicer Cache Module — Pure computation for building slicer cache data.
//!
//! The cache contains unique values from a column, their counts, selection state,
//! and whether they have visible data (accounting for other filters).

use std::collections::HashMap;

use super::compare::{cell_value_key, compare_values, format_cell_display, type_rank};
use super::types::{Slicer, SlicerCache, SlicerCacheItem, SlicerSortOrder};
use value_types::CellValue;

// =============================================================================
// Cache Building
// =============================================================================

/// Build a SlicerCache from column data and slicer selection state.
///
/// # Arguments
/// * `slicer` - Slicer configuration (provides selectedValues, sortOrder, showItemsWithNoData)
/// * `column_data` - Raw column data (one value per data row, row-indexed)
/// * `row_visibility` - Optional bitmap from other filters (1=visible, 0=hidden).
///   When provided, items whose values only appear in hidden rows get has_data=false.
pub fn build_slicer_cache(
    slicer: &Slicer,
    column_data: &[CellValue],
    row_visibility: Option<&[u8]>,
) -> SlicerCache {
    // Validate bitmap length: if provided, it should cover all rows
    if let Some(bitmap) = row_visibility {
        debug_assert!(
            bitmap.is_empty() || bitmap.len() >= column_data.len(),
            "row_visibility bitmap length ({}) should be >= column_data length ({})",
            bitmap.len(),
            column_data.len()
        );
    }

    // Track unique values with total count and visible count, preserving insertion order
    let mut value_map: HashMap<String, CacheEntry> = HashMap::new();
    let mut insertion_order: Vec<String> = Vec::new();

    for (i, value) in column_data.iter().enumerate() {
        let key = cell_value_key(value);
        let is_visible = match row_visibility {
            None => true,
            Some(bitmap) => {
                if i >= bitmap.len() {
                    true
                } else {
                    bitmap[i] == 1
                }
            }
        };

        if let Some(entry) = value_map.get_mut(&key) {
            entry.total_count += 1;
            if is_visible {
                entry.visible_count += 1;
            }
        } else {
            insertion_order.push(key.clone());
            value_map.insert(
                key,
                CacheEntry {
                    value: value.clone(),
                    total_count: 1,
                    visible_count: if is_visible { 1 } else { 0 },
                },
            );
        }
    }

    // Build selected set from slicer.selected_values
    let selected_keys: std::collections::HashSet<String> =
        slicer.selected_values.iter().map(cell_value_key).collect();
    let has_selection = !selected_keys.is_empty();

    // Build cache items in insertion order
    let mut items: Vec<SlicerCacheItem> = insertion_order
        .iter()
        .filter_map(|key| {
            let entry = value_map.get(key)?;
            let selected = if has_selection {
                selected_keys.contains(key)
            } else {
                true // All selected if no filter
            };
            let has_data = entry.visible_count > 0;

            Some(SlicerCacheItem {
                value: entry.value.clone(),
                display_text: format_cell_display(&entry.value),
                count: entry.total_count,
                selected,
                has_data,
            })
        })
        .collect();

    // Sort items according to slicer.sort_order
    sort_cache_items(&mut items, &slicer.sort_order);

    // Filter out items with no data if not showing them
    let filtered_items: Vec<SlicerCacheItem> = if slicer.show_items_with_no_data {
        items
    } else {
        items.into_iter().filter(|item| item.has_data).collect()
    };

    let selected_count = filtered_items.iter().filter(|item| item.selected).count() as u32;

    SlicerCache {
        total_count: filtered_items.len() as u32,
        selected_count,
        items: filtered_items,
    }
}

// =============================================================================
// Internal Helpers
// =============================================================================

struct CacheEntry {
    value: CellValue,
    total_count: u32,
    visible_count: u32,
}

/// Sort cache items in place according to the given sort order.
///
/// - 'Ascending': numbers first (ascending), then strings (case-insensitive ascending), blanks last
/// - 'Descending': numbers first (descending), then strings (case-insensitive descending), blanks last
/// - 'DataSource': preserve insertion order (no sorting)
pub(crate) fn sort_cache_items(items: &mut [SlicerCacheItem], sort_order: &SlicerSortOrder) {
    if *sort_order == SlicerSortOrder::DataSourceOrder {
        return; // Preserve original order
    }

    let ascending = *sort_order == SlicerSortOrder::Ascending;

    items.sort_by(|a, b| {
        // Blanks always last
        let a_is_blank = a.value.is_visually_blank();
        let b_is_blank = b.value.is_visually_blank();
        if a_is_blank && b_is_blank {
            return std::cmp::Ordering::Equal;
        }
        if a_is_blank {
            return std::cmp::Ordering::Greater;
        }
        if b_is_blank {
            return std::cmp::Ordering::Less;
        }

        // FiniteF64 can never be NaN, so no NaN guard needed.

        // Type ordering: numbers < strings < booleans < errors
        let rank_a = type_rank(&a.value);
        let rank_b = type_rank(&b.value);
        if rank_a != rank_b {
            return rank_a.cmp(&rank_b);
        }

        // Same type: compare within type
        let cmp = compare_values(&a.value, &b.value);
        if ascending { cmp } else { cmp.reverse() }
    });
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slicer::{create_slicer, select_slicer_values};
    use crate::types::{SlicerSortOrder, SlicerSourceType};
    use value_types::{CellError, CellValue};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_slicer() -> Slicer {
        create_slicer("s1", "Region", SlicerSourceType::Table, "table1", "col1")
    }

    fn make_slicer_with_sort(sort_order: SlicerSortOrder) -> Slicer {
        let mut s = make_slicer();
        s.sort_order = sort_order;
        s
    }

    fn cv_str(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn cv_num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    // -----------------------------------------------------------------------
    // basic cache building
    // -----------------------------------------------------------------------

    #[test]
    fn builds_cache_from_column_data() {
        let slicer = make_slicer();
        let data = vec![
            cv_str("East"),
            cv_str("West"),
            cv_str("East"),
            cv_str("North"),
            cv_str("West"),
            cv_str("East"),
        ];
        let cache = build_slicer_cache(&slicer, &data, None);
        assert_eq!(cache.total_count, 3);
        assert_eq!(cache.items.len(), 3);
    }

    #[test]
    fn counts_occurrences() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::DataSourceOrder);
        let data = vec![
            cv_str("East"),
            cv_str("West"),
            cv_str("East"),
            cv_str("North"),
            cv_str("West"),
            cv_str("East"),
        ];
        let cache = build_slicer_cache(&slicer, &data, None);

        let east = cache
            .items
            .iter()
            .find(|i| i.display_text == "East")
            .unwrap();
        let west = cache
            .items
            .iter()
            .find(|i| i.display_text == "West")
            .unwrap();
        let north = cache
            .items
            .iter()
            .find(|i| i.display_text == "North")
            .unwrap();

        assert_eq!(east.count, 3);
        assert_eq!(west.count, 2);
        assert_eq!(north.count, 1);
    }

    // -----------------------------------------------------------------------
    // selected state
    // -----------------------------------------------------------------------

    #[test]
    fn all_selected_when_no_selection() {
        let slicer = make_slicer();
        let cache = build_slicer_cache(&slicer, &[cv_str("East"), cv_str("West")], None);
        assert!(cache.items.iter().all(|i| i.selected));
    }

    #[test]
    fn marks_only_selected_values() {
        let slicer = make_slicer();
        let slicer = select_slicer_values(&slicer, &[cv_str("East")]);
        let cache = build_slicer_cache(
            &slicer,
            &[cv_str("East"), cv_str("West"), cv_str("East")],
            None,
        );

        let east = cache
            .items
            .iter()
            .find(|i| i.display_text == "East")
            .unwrap();
        let west = cache
            .items
            .iter()
            .find(|i| i.display_text == "West")
            .unwrap();

        assert!(east.selected);
        assert!(!west.selected);
    }

    // -----------------------------------------------------------------------
    // hasData with rowVisibility
    // -----------------------------------------------------------------------

    #[test]
    fn has_data_true_when_no_visibility() {
        let slicer = make_slicer();
        let cache = build_slicer_cache(&slicer, &[cv_str("East"), cv_str("West")], None);
        assert!(cache.items.iter().all(|i| i.has_data));
    }

    #[test]
    fn has_data_false_when_all_rows_hidden() {
        let mut slicer = make_slicer();
        slicer.sort_order = SlicerSortOrder::DataSourceOrder;
        slicer.show_items_with_no_data = true;

        let data = vec![cv_str("East"), cv_str("West"), cv_str("East")];
        let visibility: Vec<u8> = vec![1, 0, 0];
        let cache = build_slicer_cache(&slicer, &data, Some(&visibility));

        let east = cache
            .items
            .iter()
            .find(|i| i.display_text == "East")
            .unwrap();
        let west = cache
            .items
            .iter()
            .find(|i| i.display_text == "West")
            .unwrap();

        assert!(east.has_data); // appears at row 0 (visible)
        assert!(!west.has_data); // appears only at row 1 (hidden)
    }

    #[test]
    fn all_rows_visible() {
        let slicer = make_slicer();
        let data = vec![cv_str("East"), cv_str("West")];
        let visibility: Vec<u8> = vec![1, 1];
        let cache = build_slicer_cache(&slicer, &data, Some(&visibility));
        assert!(cache.items.iter().all(|i| i.has_data));
    }

    // -----------------------------------------------------------------------
    // sort order
    // -----------------------------------------------------------------------

    #[test]
    fn sorts_ascending_by_default() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
        let cache = build_slicer_cache(
            &slicer,
            &[cv_str("West"), cv_str("East"), cv_str("North")],
            None,
        );
        let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
        assert_eq!(values, vec!["East", "North", "West"]);
    }

    #[test]
    fn sorts_descending() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
        let cache = build_slicer_cache(
            &slicer,
            &[cv_str("West"), cv_str("East"), cv_str("North")],
            None,
        );
        let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
        assert_eq!(values, vec!["West", "North", "East"]);
    }

    #[test]
    fn preserves_data_source_order() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::DataSourceOrder);
        let cache = build_slicer_cache(
            &slicer,
            &[
                cv_str("West"),
                cv_str("East"),
                cv_str("North"),
                cv_str("East"),
            ],
            None,
        );
        let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
        assert_eq!(values, vec!["West", "East", "North"]);
    }

    #[test]
    fn sorts_numbers_before_strings() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
        let cache = build_slicer_cache(
            &slicer,
            &[cv_str("beta"), cv_num(10.0), cv_str("alpha"), cv_num(5.0)],
            None,
        );
        let values: Vec<CellValue> = cache.items.iter().map(|i| i.value.clone()).collect();
        assert_eq!(values.len(), 4);
        // 5, 10, alpha, beta
        assert!(matches!(&values[0], CellValue::Number(n) if n.get() == 5.0));
        assert!(matches!(&values[1], CellValue::Number(n) if n.get() == 10.0));
        assert!(matches!(&values[2], CellValue::Text(s) if s.as_ref() == "alpha"));
        assert!(matches!(&values[3], CellValue::Text(s) if s.as_ref() == "beta"));
    }

    #[test]
    fn descending_preserves_type_grouping() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
        let cache = build_slicer_cache(
            &slicer,
            &[cv_str("beta"), cv_num(10.0), cv_str("alpha"), cv_num(5.0)],
            None,
        );
        let values: Vec<CellValue> = cache.items.iter().map(|i| i.value.clone()).collect();
        // Descending: 10, 5, beta, alpha
        assert!(matches!(&values[0], CellValue::Number(n) if n.get() == 10.0));
        assert!(matches!(&values[1], CellValue::Number(n) if n.get() == 5.0));
        assert!(matches!(&values[2], CellValue::Text(s) if s.as_ref() == "beta"));
        assert!(matches!(&values[3], CellValue::Text(s) if s.as_ref() == "alpha"));
    }

    #[test]
    fn nan_sorts_last_within_numbers_descending() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
        // CellValue::number(f64::NAN) → Error(Num) since FiniteF64 excludes NaN
        let cache = build_slicer_cache(
            &slicer,
            &[
                CellValue::number(f64::NAN),
                cv_num(10.0),
                cv_num(5.0),
                CellValue::number(f64::NAN),
            ],
            None,
        );
        let values: Vec<CellValue> = cache.items.iter().map(|i| i.value.clone()).collect();
        // NaN → Error(Num), deduped to one. Descending: 10, 5, #NUM!
        assert_eq!(values.len(), 3);
        assert!(matches!(&values[0], CellValue::Number(n) if n.get() == 10.0));
        assert!(matches!(&values[1], CellValue::Number(n) if n.get() == 5.0));
        assert!(matches!(&values[2], CellValue::Error(CellError::Num, _)));
    }

    // -----------------------------------------------------------------------
    // case-insensitive string dedup
    // -----------------------------------------------------------------------

    #[test]
    fn deduplicates_strings_case_insensitively() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
        let cache = build_slicer_cache(
            &slicer,
            &[
                cv_str("Hello"),
                cv_str("hello"),
                cv_str("HELLO"),
                cv_str("World"),
            ],
            None,
        );
        assert_eq!(cache.items.len(), 2);
        assert_eq!(cache.items[0].count, 3); // Hello/hello/HELLO
        assert_eq!(cache.items[1].count, 1); // World
    }

    // -----------------------------------------------------------------------
    // blanks handling
    // -----------------------------------------------------------------------

    #[test]
    fn handles_null_values() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
        let cache = build_slicer_cache(
            &slicer,
            &[
                cv_str("East"),
                CellValue::Null,
                cv_str("West"),
                CellValue::Null,
            ],
            None,
        );

        let blank_item = cache
            .items
            .iter()
            .find(|i| matches!(i.value, CellValue::Null));
        assert!(blank_item.is_some());
        let blank_item = blank_item.unwrap();
        assert_eq!(blank_item.display_text, "(Blank)");
        assert_eq!(blank_item.count, 2);
    }

    #[test]
    fn blanks_sort_last() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
        let cache = build_slicer_cache(
            &slicer,
            &[CellValue::Null, cv_str("Alpha"), cv_str("Bravo")],
            None,
        );
        let last = cache.items.last().unwrap();
        assert!(matches!(last.value, CellValue::Null));
    }

    #[test]
    fn blanks_sort_last_descending() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
        let cache = build_slicer_cache(
            &slicer,
            &[CellValue::Null, cv_str("Alpha"), cv_str("Bravo")],
            None,
        );
        let last = cache.items.last().unwrap();
        assert!(matches!(last.value, CellValue::Null));
    }

    // -----------------------------------------------------------------------
    // showItemsWithNoData
    // -----------------------------------------------------------------------

    #[test]
    fn excludes_no_data_items_when_false() {
        let mut slicer = make_slicer();
        slicer.show_items_with_no_data = false;
        slicer.sort_order = SlicerSortOrder::DataSourceOrder;

        let data = vec![
            cv_str("East"),
            cv_str("West"),
            cv_str("East"),
            cv_str("North"),
        ];
        let visibility: Vec<u8> = vec![1, 0, 1, 0];
        let cache = build_slicer_cache(&slicer, &data, Some(&visibility));

        assert_eq!(cache.items.len(), 1);
        assert_eq!(cache.items[0].display_text, "East");
        assert_eq!(cache.total_count, 1);
    }

    #[test]
    fn includes_no_data_items_when_true() {
        let mut slicer = make_slicer();
        slicer.show_items_with_no_data = true;
        slicer.sort_order = SlicerSortOrder::DataSourceOrder;

        let data = vec![
            cv_str("East"),
            cv_str("West"),
            cv_str("East"),
            cv_str("North"),
        ];
        let visibility: Vec<u8> = vec![1, 0, 1, 0];
        let cache = build_slicer_cache(&slicer, &data, Some(&visibility));

        assert_eq!(cache.items.len(), 3);
        let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
        assert_eq!(values, vec!["East", "West", "North"]);

        let east = cache
            .items
            .iter()
            .find(|i| i.display_text == "East")
            .unwrap();
        let west = cache
            .items
            .iter()
            .find(|i| i.display_text == "West")
            .unwrap();
        let north = cache
            .items
            .iter()
            .find(|i| i.display_text == "North")
            .unwrap();
        assert!(east.has_data);
        assert!(!west.has_data);
        assert!(!north.has_data);
    }

    #[test]
    fn keeps_all_items_without_visibility_bitmap() {
        let mut slicer = make_slicer();
        slicer.show_items_with_no_data = false;
        slicer.sort_order = SlicerSortOrder::DataSourceOrder;

        let data = vec![cv_str("East"), cv_str("West"), cv_str("North")];
        let cache = build_slicer_cache(&slicer, &data, None);

        assert_eq!(cache.items.len(), 3);
    }

    // -----------------------------------------------------------------------
    // display text formatting
    // -----------------------------------------------------------------------

    #[test]
    fn formats_booleans() {
        let mut slicer = make_slicer();
        slicer.sort_order = SlicerSortOrder::DataSourceOrder;

        let cache = build_slicer_cache(
            &slicer,
            &[CellValue::Boolean(true), CellValue::Boolean(false)],
            None,
        );

        let true_item = cache
            .items
            .iter()
            .find(|i| matches!(i.value, CellValue::Boolean(true)))
            .unwrap();
        let false_item = cache
            .items
            .iter()
            .find(|i| matches!(i.value, CellValue::Boolean(false)))
            .unwrap();
        assert_eq!(true_item.display_text, "TRUE");
        assert_eq!(false_item.display_text, "FALSE");
    }

    // -----------------------------------------------------------------------
    // error values
    // -----------------------------------------------------------------------

    #[test]
    fn error_values_in_cache() {
        let mut slicer = make_slicer();
        slicer.sort_order = SlicerSortOrder::DataSourceOrder;

        let err_na = CellValue::Error(CellError::Na, None);
        let err_ref = CellValue::Error(CellError::Ref, None);
        let data = vec![
            err_na.clone(),
            cv_str("Valid"),
            err_na.clone(),
            err_ref.clone(),
        ];
        let cache = build_slicer_cache(&slicer, &data, None);

        assert_eq!(cache.items.len(), 3);

        let na_item = cache.items.iter().find(|i| i.display_text == "#N/A");
        let ref_item = cache.items.iter().find(|i| i.display_text == "#REF!");
        let valid_item = cache.items.iter().find(|i| i.display_text == "Valid");

        assert!(na_item.is_some());
        assert_eq!(na_item.unwrap().count, 2);
        assert!(ref_item.is_some());
        assert_eq!(ref_item.unwrap().count, 1);
        assert!(valid_item.is_some());
        assert_eq!(valid_item.unwrap().count, 1);
    }

    // -----------------------------------------------------------------------
    // empty column data
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_cache_empty_data() {
        let slicer = make_slicer();
        let data: Vec<CellValue> = vec![];
        let cache = build_slicer_cache(&slicer, &data, None);

        assert_eq!(cache.items.len(), 0);
        assert_eq!(cache.total_count, 0);
        assert_eq!(cache.selected_count, 0);
    }

    // -----------------------------------------------------------------------
    // all identical values
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_cache_all_identical() {
        let slicer = make_slicer_with_sort(SlicerSortOrder::DataSourceOrder);
        let data = vec![
            cv_str("Same"),
            cv_str("Same"),
            cv_str("Same"),
            cv_str("Same"),
            cv_str("Same"),
        ];
        let cache = build_slicer_cache(&slicer, &data, None);

        // All identical values should be deduped into a single item
        assert_eq!(cache.items.len(), 1);
        assert_eq!(cache.total_count, 1);
        assert_eq!(cache.items[0].count, 5);
        assert_eq!(cache.items[0].display_text, "Same");
        assert!(cache.items[0].has_data);
        // No selection means all are selected
        assert!(cache.items[0].selected);
        assert_eq!(cache.selected_count, 1);
    }
}
