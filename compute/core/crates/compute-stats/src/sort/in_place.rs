use std::cmp::Ordering;

use value_types::CellValue;

use super::compare::{compare_cell_values, compare_decorated_keys};
use super::config::SortConfig;
use crate::values::{SortKey, cell_value_to_sort_key};

/// Apply a permutation to a vector in-place in O(n) time and O(n) extra space
/// for the permutation copy.
///
/// After this function, `items[i]` will contain the element that was originally
/// at `items[perm[i]]`.
pub(super) fn apply_permutation<T>(items: &mut [T], perm: &[usize]) {
    // Invert the permutation first: if perm says "position i gets value from
    // perm[i]", then the inverse says "value at position i goes to inv[i]".
    // Then we can use the standard cycle-following swap algorithm on the inverse.
    let n = perm.len();
    let mut inv = vec![0usize; n];
    for i in 0..n {
        inv[perm[i]] = i;
    }

    // Now apply the inverse permutation using cycle-following swaps.
    // inv[i] = j means "the element currently at position i should go to position j".
    for i in 0..n {
        while inv[i] != i {
            let j = inv[i];
            items.swap(i, j);
            inv.swap(i, j);
        }
    }
}

/// Sort a vector of cell values in-place.
pub fn sort_values(values: &mut [CellValue], config: &SortConfig) {
    values.sort_by(|a, b| compare_cell_values(a, b, config));
}

/// Sort items in-place using a Schwartzian transform (decorate-sort-undecorate).
///
/// The key function extracts a `CellValue` for comparison. Keys are extracted
/// once in O(n), then an index array is sorted by the precomputed keys, and
/// finally the items are reordered in-place via permutation.
///
/// This is critical for the grouper, where `T = GroupNode` and cloning
/// deep-copies entire subtrees including `row_indices` vectors.
pub fn sort_by_in_place<T>(items: &mut [T], key_fn: impl Fn(&T) -> CellValue, config: &SortConfig) {
    if items.len() <= 1 {
        return;
    }

    // 1. Build index + sort_key pairs — O(n)
    let mut indices: Vec<(usize, SortKey, CellValue)> = items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let cv = key_fn(item);
            let sk = cell_value_to_sort_key(&cv);
            (i, sk, cv)
        })
        .collect();

    // 2. Sort indices by key — O(n log n)
    indices.sort_by(|(_, a_key, a_cv), (_, b_key, b_cv)| {
        compare_decorated_keys(a_key, a_cv, b_key, b_cv, config)
    });

    // 3. Reorder in-place using the permutation — O(n)
    let perm: Vec<usize> = indices.into_iter().map(|(i, _, _)| i).collect();
    apply_permutation(items, &perm);
}

/// A key extractor + config pair for multi-key sorting.
pub struct KeyConfig<'a, T> {
    /// Function that extracts the sort key from an item.
    pub key_fn: Box<dyn Fn(&T) -> CellValue + 'a>,
    /// Sort configuration for this key level.
    pub config: SortConfig,
}

/// Sort items in-place by multiple keys (for hierarchical sorting).
///
/// Uses the Schwartzian transform: precomputes all key values for each item
/// once in O(n * k), then sorts by the precomputed key tuples.
pub fn sort_by_multiple_in_place<T>(items: &mut [T], key_configs: &[KeyConfig<'_, T>]) {
    if key_configs.is_empty() || items.len() <= 1 {
        return;
    }

    // 1. Decorate: extract all keys for each item — O(n * k)
    let mut decorated: Vec<(usize, Vec<(SortKey, CellValue)>)> = items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let keys: Vec<(SortKey, CellValue)> = key_configs
                .iter()
                .map(|kc| {
                    let cv = (kc.key_fn)(item);
                    let sk = cell_value_to_sort_key(&cv);
                    (sk, cv)
                })
                .collect();
            (i, keys)
        })
        .collect();

    // 2. Sort by precomputed keys — O(n * k * log n)
    decorated.sort_by(|(_, keys_a), (_, keys_b)| {
        for (idx, kc) in key_configs.iter().enumerate() {
            let (ref sk_a, ref cv_a) = keys_a[idx];
            let (ref sk_b, ref cv_b) = keys_b[idx];
            let cmp = compare_decorated_keys(sk_a, cv_a, sk_b, cv_b, &kc.config);

            if cmp != Ordering::Equal {
                return cmp;
            }
        }
        Ordering::Equal
    });

    // 3. Reorder in-place — O(n)
    let perm: Vec<usize> = decorated.into_iter().map(|(i, _)| i).collect();
    apply_permutation(items, &perm);
}

/// Sort a slice of items by a key extracted from each item.
/// Returns a new sorted Vec.
///
/// **Prefer `sort_by_in_place`** for performance. This wrapper exists for
/// backward compatibility with callers that expect a new Vec.
pub fn sort_by<T: Clone>(
    items: &[T],
    key_fn: impl Fn(&T) -> CellValue,
    config: &SortConfig,
) -> Vec<T> {
    let mut result = items.to_vec();
    sort_by_in_place(&mut result, key_fn, config);
    result
}
