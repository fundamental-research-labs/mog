use std::collections::HashSet;

use value_types::CellValue;

use super::config::SortConfig;
use super::custom_order::sort_by_custom_order_in_place;
use super::in_place::sort_values;
use crate::types::SortDirection;
use crate::values::cell_value_to_key;

/// Get unique sorted values from a slice.
///
/// Deduplicates using the canonical `cell_value_to_key` for case-insensitive,
/// type-safe key normalization, then sorts using the given direction.
///
/// If `custom_list` is provided, uses custom order sorting.
#[must_use]
pub fn get_unique_sorted(
    values: &[CellValue],
    direction: SortDirection,
    custom_list: Option<&[String]>,
) -> Vec<CellValue> {
    // Deduplicate using canonical keys.
    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for value in values {
        let key = cell_value_to_key(value);
        if seen.insert(key.into_owned()) {
            unique.push(value.clone());
        }
    }

    let config = SortConfig {
        direction,
        ..SortConfig::default()
    };

    if let Some(custom) = custom_list {
        let custom_values: Vec<CellValue> = custom
            .iter()
            .map(|s| CellValue::Text(s.clone().into()))
            .collect();
        sort_by_custom_order_in_place(
            &mut unique,
            std::clone::Clone::clone,
            &custom_values,
            &config,
        );
    } else {
        sort_values(&mut unique, &config);
    }

    unique
}
