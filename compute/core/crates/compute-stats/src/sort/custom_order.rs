use std::cmp::Ordering;
use std::collections::HashMap;

use value_types::CellValue;

use super::compare::compare_cell_values;
use super::config::SortConfig;
use super::in_place::apply_permutation;
use crate::values::cell_value_to_key;

/// Sort items in-place using a provided custom order list.
///
/// Items matching the custom list come first in custom-list order.
/// Items not in the list are sorted to the end using the standard comparator.
/// The sort direction only affects non-custom items.
pub fn sort_by_custom_order_in_place<T>(
    items: &mut [T],
    key_fn: impl Fn(&T) -> CellValue,
    custom_order: &[CellValue],
    config: &SortConfig,
) {
    if items.len() <= 1 {
        return;
    }

    // Build index map for custom order using canonical key.
    let mut order_map: HashMap<String, usize> = HashMap::new();
    for (idx, val) in custom_order.iter().enumerate() {
        let key = cell_value_to_key(val);
        order_map.entry(key.into_owned()).or_insert(idx);
    }

    // 1. Decorate — O(n)
    let mut decorated: Vec<(usize, CellValue, Option<usize>)> = items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let cell_key = key_fn(item);
            let norm_key = cell_value_to_key(&cell_key);
            let custom_idx = order_map.get(norm_key.as_ref()).copied();
            (i, cell_key, custom_idx)
        })
        .collect();

    let natural_config = SortConfig {
        natural_sort: true,
        ..config.clone()
    };

    // 2. Sort — O(n log n)
    decorated.sort_by(
        |(_, key_a, idx_a), (_, key_b, idx_b)| match (idx_a, idx_b) {
            (Some(ia), Some(ib)) => {
                // Custom sort list defines an absolute order — never reverse indices.
                // The direction only affects non-custom items.
                ia.cmp(ib)
            }
            // Custom-order items always come before non-custom items.
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            // Non-custom items: sort among themselves using the standard comparator.
            (None, None) => compare_cell_values(key_a, key_b, &natural_config),
        },
    );

    // 3. Reorder in-place — O(n)
    let perm: Vec<usize> = decorated.into_iter().map(|(i, _, _)| i).collect();
    apply_permutation(items, &perm);
}

/// Sort items using a provided custom order list. Returns a new sorted Vec.
///
/// **Prefer `sort_by_custom_order_in_place`** for performance. This wrapper
/// exists for backward compatibility.
pub fn sort_by_custom_order<T: Clone>(
    items: &[T],
    key_fn: impl Fn(&T) -> CellValue,
    custom_order: &[CellValue],
    config: &SortConfig,
) -> Vec<T> {
    let mut result = items.to_vec();
    sort_by_custom_order_in_place(&mut result, key_fn, custom_order, config);
    result
}
