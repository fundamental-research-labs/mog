//! Analytical sorting — in-place, canonical sort keys, natural sort, custom order, multi-key.
//!
//! All comparisons delegate to `SortKey` from `super::values`, which provides the
//! single source of truth for value ordering across the compute engine.
//!
//! # Sort semantics
//!
//! - **Blanks always last**, regardless of sort direction. A blank is `Null`,
//!   `Text("")`, or `Text` containing only whitespace.
//! - **Type priority is stable** in both ascending and descending: Number < Text
//!   < Boolean < Error < Blank (matches Excel). Only within-type ordering reverses for descending.
//! - **Natural sort** for text values: `"Item 2"` sorts before `"Item 10"`.
//! - **Case-insensitive** by default.
//!
//! # Performance
//!
//! All sort functions use the Schwartzian transform (decorate-sort-undecorate):
//! keys are extracted once in O(n), comparisons use precomputed keys, and
//! reordering is done in-place via index permutation — no cloning of `T`.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use value_types::CellValue;

use super::types::SortDirection;
use super::values::{SortKey, cell_value_to_key, cell_value_to_sort_key};

/// Blank type priority constant from `SortKey`. Blanks have priority 4
/// and always sort last regardless of direction.
const BLANK_TYPE_PRIORITY: u8 = 4;

// ============================================================================
// Sort configuration
// ============================================================================

/// Sort configuration controlling direction, case sensitivity, and natural sort.
///
/// Unlike the previous version, there is no `nulls_first` field — blanks always
/// sort last (Excel behavior), encoded in `SortKey`'s type priority.
///
/// There is no "none" direction. If you need "preserve original order", wrap in
/// `Option<SortConfig>` and skip sorting when `None`.
#[derive(Debug, Clone)]
pub struct SortConfig {
    /// Sort direction: ascending or descending.
    pub direction: SortDirection,
    /// Whether string comparisons are case-sensitive.
    /// When `false` (the default), "Apple" and "apple" compare equal.
    pub case_sensitive: bool,
    /// Whether to use natural sort for strings.
    /// When `true` (the default), "Item 2" sorts before "Item 10".
    pub natural_sort: bool,
}

impl Default for SortConfig {
    fn default() -> Self {
        SortConfig {
            direction: SortDirection::Asc,
            case_sensitive: false,
            natural_sort: true,
        }
    }
}

impl SortConfig {
    /// Ascending sort with default options (case-insensitive, natural sort).
    #[must_use]
    pub fn asc() -> Self {
        SortConfig::default()
    }

    /// Descending sort with default options (case-insensitive, natural sort).
    #[must_use]
    pub fn desc() -> Self {
        SortConfig {
            direction: SortDirection::Desc,
            ..SortConfig::default()
        }
    }
}

// ============================================================================
// Natural compare
// ============================================================================

/// A chunk in natural sort: either a run of digits or a run of non-digits.
#[derive(Debug)]
enum Chunk<'a> {
    /// A run of digit characters, stored as the substring slice.
    Digits(&'a str),
    /// A run of non-digit characters, stored as the substring slice.
    Text(&'a str),
}

/// Split a string into alternating chunks of digit and non-digit runs.
/// Hand-coded char-by-char loop — no regex.
fn split_chunks(s: &str) -> Vec<Chunk<'_>> {
    let mut chunks = Vec::new();
    if s.is_empty() {
        return chunks;
    }

    let bytes = s.as_bytes();
    let mut start = 0;
    let mut in_digits = bytes[0].is_ascii_digit();

    for i in 1..bytes.len() {
        let is_digit = bytes[i].is_ascii_digit();
        if is_digit != in_digits {
            let slice = &s[start..i];
            if in_digits {
                chunks.push(Chunk::Digits(slice));
            } else {
                chunks.push(Chunk::Text(slice));
            }
            start = i;
            in_digits = is_digit;
        }
    }

    // Push the last chunk
    let slice = &s[start..];
    if in_digits {
        chunks.push(Chunk::Digits(slice));
    } else {
        chunks.push(Chunk::Text(slice));
    }

    chunks
}

/// Compare two non-negative integer strings numerically without parsing.
/// Handles arbitrarily large numbers (no i64 overflow).
/// Strips leading zeros, then compares by length (longer = bigger),
/// and if same length, compares lexicographically.
fn compare_numeric_strings(a: &str, b: &str) -> Ordering {
    let a_trimmed = a.trim_start_matches('0');
    let b_trimmed = b.trim_start_matches('0');
    a_trimmed
        .len()
        .cmp(&b_trimmed.len())
        .then_with(|| a_trimmed.cmp(b_trimmed))
}

/// Natural sort comparator for strings containing numbers.
/// E.g., "Item 2" comes before "Item 10".
///
/// Splits strings into chunks of digits and non-digits, then compares:
/// - Digit chunks: compared numerically (no parse, handles arbitrarily large numbers)
/// - Text chunks: compared lexicographically (case-insensitive by default)
#[must_use]
pub fn natural_compare(a: &str, b: &str, case_sensitive: bool) -> Ordering {
    let str_a: std::borrow::Cow<str> = if case_sensitive {
        std::borrow::Cow::Borrowed(a)
    } else {
        std::borrow::Cow::Owned(a.to_lowercase())
    };
    let str_b: std::borrow::Cow<str> = if case_sensitive {
        std::borrow::Cow::Borrowed(b)
    } else {
        std::borrow::Cow::Owned(b.to_lowercase())
    };

    let chunks_a = split_chunks(&str_a);
    let chunks_b = split_chunks(&str_b);

    let max_len = chunks_a.len().max(chunks_b.len());

    for i in 0..max_len {
        let chunk_a = chunks_a.get(i);
        let chunk_b = chunks_b.get(i);

        match (chunk_a, chunk_b) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                let is_digits_a = matches!(ca, Chunk::Digits(_));
                let is_digits_b = matches!(cb, Chunk::Digits(_));

                if is_digits_a && is_digits_b {
                    let a_str = match ca {
                        Chunk::Digits(s) => *s,
                        Chunk::Text(_) => unreachable!(),
                    };
                    let b_str = match cb {
                        Chunk::Digits(s) => *s,
                        Chunk::Text(_) => unreachable!(),
                    };
                    let cmp = compare_numeric_strings(a_str, b_str);
                    if cmp != Ordering::Equal {
                        return cmp;
                    }
                } else {
                    let sa = match ca {
                        Chunk::Digits(s) | Chunk::Text(s) => *s,
                    };
                    let sb = match cb {
                        Chunk::Digits(s) | Chunk::Text(s) => *s,
                    };
                    let cmp = sa.cmp(sb);
                    if cmp != Ordering::Equal {
                        return cmp;
                    }
                }
            }
        }
    }

    Ordering::Equal
}

// ============================================================================
// Core comparison
// ============================================================================

/// Compare two `SortKey` values respecting direction and blanks-always-last.
///
/// Blanks (`type_priority` == 4) always sort after all non-blank values,
/// regardless of ascending or descending direction. Only the within-type
/// comparison is reversed for descending.
fn compare_sort_keys(a: &SortKey, b: &SortKey, direction: SortDirection) -> Ordering {
    let a_blank = a.type_priority() == BLANK_TYPE_PRIORITY;
    let b_blank = b.type_priority() == BLANK_TYPE_PRIORITY;

    match (a_blank, b_blank) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater, // blank always after non-blank
        (false, true) => Ordering::Less,    // non-blank always before blank
        (false, false) => {
            // Type priority is stable regardless of direction:
            // Number < Text < Boolean < Error in both Asc and Desc.
            let type_cmp = a.type_priority().cmp(&b.type_priority());
            if type_cmp != Ordering::Equal {
                return type_cmp;
            }
            // Only within-type comparison reverses for descending.
            let cmp = a.cmp(b);
            if direction == SortDirection::Desc {
                cmp.reverse()
            } else {
                cmp
            }
        }
    }
}

/// Compare two `CellValue`s for sorting with natural sort support.
///
/// This is the full comparator used by all sort functions. It delegates to
/// `SortKey` for type-level ordering and uses `natural_compare` as a
/// refinement for text values when `natural_sort` is enabled.
///
/// # Ordering
///
/// 1. Blanks always sort last (regardless of direction).
/// 2. Different types: Number < Text < Boolean < Error (stable in both directions).
/// 3. Same type: within-type comparison (reversed for descending).
/// 4. Text with natural sort: digit chunks compared numerically.
#[must_use]
pub fn compare_cell_values(a: &CellValue, b: &CellValue, config: &SortConfig) -> Ordering {
    let a_blank = a.is_visually_blank();
    let b_blank = b.is_visually_blank();

    // Blanks always sort last, regardless of direction.
    match (a_blank, b_blank) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        (false, false) => {}
    }

    // Natural sort: for two text values, use natural_compare instead of
    // the SortKey's lowercased lexicographic comparison.
    if config.natural_sort
        && let (CellValue::Text(sa), CellValue::Text(sb)) = (a, b)
    {
        let cmp = natural_compare(sa, sb, config.case_sensitive);
        return if config.direction == SortDirection::Desc {
            cmp.reverse()
        } else {
            cmp
        };
    }

    // Case-sensitive text: compare without lowercasing.
    if config.case_sensitive
        && let (CellValue::Text(sa), CellValue::Text(sb)) = (a, b)
    {
        let cmp = sa.cmp(sb);
        return if config.direction == SortDirection::Desc {
            cmp.reverse()
        } else {
            cmp
        };
    }

    // All other cases: delegate to SortKey (type-priority + within-type).
    let key_a = cell_value_to_sort_key(a);
    let key_b = cell_value_to_sort_key(b);
    compare_sort_keys(&key_a, &key_b, config.direction)
}

// ============================================================================
// In-place permutation
// ============================================================================

/// Apply a permutation to a vector in-place in O(n) time and O(n) extra space
/// for the permutation copy.
///
/// After this function, `items[i]` will contain the element that was originally
/// at `items[perm[i]]`.
fn apply_permutation<T>(items: &mut [T], perm: &[usize]) {
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

// ============================================================================
// Sort functions
// ============================================================================

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
        let a_blank = a_key.type_priority() == BLANK_TYPE_PRIORITY;
        let b_blank = b_key.type_priority() == BLANK_TYPE_PRIORITY;

        // Blanks always sort last.
        match (a_blank, b_blank) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            (false, false) => {
                // Type priority is stable regardless of direction.
                let type_cmp = a_key.type_priority().cmp(&b_key.type_priority());
                if type_cmp != Ordering::Equal {
                    return type_cmp;
                }

                // Natural sort refinement for text values.
                if config.natural_sort
                    && let (CellValue::Text(sa), CellValue::Text(sb)) = (a_cv, b_cv)
                {
                    let cmp = natural_compare(sa, sb, config.case_sensitive);
                    return if config.direction == SortDirection::Desc {
                        cmp.reverse()
                    } else {
                        cmp
                    };
                }

                // Case-sensitive text refinement.
                if config.case_sensitive
                    && let (CellValue::Text(sa), CellValue::Text(sb)) = (a_cv, b_cv)
                {
                    let cmp = sa.cmp(sb);
                    return if config.direction == SortDirection::Desc {
                        cmp.reverse()
                    } else {
                        cmp
                    };
                }

                // Default: use SortKey ordering (same type, so only within-type comparison).
                let cmp = a_key.cmp(b_key);
                if config.direction == SortDirection::Desc {
                    cmp.reverse()
                } else {
                    cmp
                }
            }
        }
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

            let a_blank = sk_a.type_priority() == BLANK_TYPE_PRIORITY;
            let b_blank = sk_b.type_priority() == BLANK_TYPE_PRIORITY;

            let cmp = match (a_blank, b_blank) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => {
                    // Type priority is stable regardless of direction.
                    let type_cmp = sk_a.type_priority().cmp(&sk_b.type_priority());
                    if type_cmp != Ordering::Equal {
                        type_cmp
                    } else if kc.config.natural_sort {
                        // Natural sort refinement for text values.
                        if let (CellValue::Text(sa), CellValue::Text(sb)) = (cv_a, cv_b) {
                            let inner = natural_compare(sa, sb, kc.config.case_sensitive);
                            if kc.config.direction == SortDirection::Desc {
                                inner.reverse()
                            } else {
                                inner
                            }
                        } else {
                            let inner = sk_a.cmp(sk_b);
                            if kc.config.direction == SortDirection::Desc {
                                inner.reverse()
                            } else {
                                inner
                            }
                        }
                    } else if kc.config.case_sensitive {
                        if let (CellValue::Text(sa), CellValue::Text(sb)) = (cv_a, cv_b) {
                            let inner = sa.cmp(sb);
                            if kc.config.direction == SortDirection::Desc {
                                inner.reverse()
                            } else {
                                inner
                            }
                        } else {
                            let inner = sk_a.cmp(sk_b);
                            if kc.config.direction == SortDirection::Desc {
                                inner.reverse()
                            } else {
                                inner
                            }
                        }
                    } else {
                        let inner = sk_a.cmp(sk_b);
                        if kc.config.direction == SortDirection::Desc {
                            inner.reverse()
                        } else {
                            inner
                        }
                    }
                }
            };

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

// ============================================================================
// Custom order sort
// ============================================================================

/// Sort items in-place using a provided custom order list.
///
/// Items matching the custom list come first (in custom-list order).
/// Items not in the list are sorted to the end using the standard comparator.
///
/// The `direction` in `config` controls:
/// - Whether custom-order items appear in list order (Asc) or reversed (Desc).
/// - How non-custom items are sorted among themselves.
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

// ============================================================================
// Backward-compatible wrappers
// ============================================================================

// These functions preserve the old call signatures used by callers (engine.rs,
// filter.rs, grouper.rs) while delegating to the in-place implementations.
// They will be removed once all callers are migrated.

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

// ============================================================================
// get_unique_sorted
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellError;

    // ---- compare_cell_values ----

    #[test]
    fn blanks_always_sort_last_ascending() {
        let config = SortConfig::asc();

        // Null is blank, sorts after everything.
        assert_eq!(
            compare_cell_values(&CellValue::Null, &CellValue::number(1.0), &config),
            Ordering::Greater
        );
        assert_eq!(
            compare_cell_values(&CellValue::number(1.0), &CellValue::Null, &config),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
            Ordering::Equal
        );
    }

    #[test]
    fn blanks_always_sort_last_descending() {
        let config = SortConfig::desc();

        // Even in descending, blanks sort LAST (after all non-blank values).
        assert_eq!(
            compare_cell_values(&CellValue::Null, &CellValue::number(1.0), &config),
            Ordering::Greater
        );
        assert_eq!(
            compare_cell_values(&CellValue::number(1.0), &CellValue::Null, &config),
            Ordering::Less
        );
    }

    #[test]
    fn empty_text_is_blank_sorts_last() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("".into()),
                &CellValue::number(1.0),
                &config
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn whitespace_only_text_is_blank_sorts_last() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("  ".into()),
                &CellValue::number(1.0),
                &config
            ),
            Ordering::Greater
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("\t\n".into()),
                &CellValue::Boolean(false),
                &config
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn whitespace_only_text_is_blank_sorts_last_descending() {
        let config = SortConfig::desc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("  ".into()),
                &CellValue::number(1.0),
                &config
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn compares_numbers_correctly() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(&CellValue::number(1.0), &CellValue::number(2.0), &config),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(&CellValue::number(2.0), &CellValue::number(1.0), &config),
            Ordering::Greater
        );
        assert_eq!(
            compare_cell_values(&CellValue::number(5.0), &CellValue::number(5.0), &config),
            Ordering::Equal
        );
    }

    #[test]
    fn compares_strings_case_insensitive_by_default() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("apple".into()),
                &CellValue::Text("Banana".into()),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("APPLE".into()),
                &CellValue::Text("apple".into()),
                &config
            ),
            Ordering::Equal
        );
    }

    #[test]
    fn compares_strings_case_sensitive_when_configured() {
        let config = SortConfig {
            case_sensitive: true,
            natural_sort: false,
            ..SortConfig::asc()
        };
        // 'A' (65) < 'a' (97) in ASCII
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("Apple".into()),
                &CellValue::Text("apple".into()),
                &config
            ),
            Ordering::Less
        );
    }

    #[test]
    fn natural_sort_for_strings_with_numbers() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("Item 2".into()),
                &CellValue::Text("Item 10".into()),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("Item 10".into()),
                &CellValue::Text("Item 2".into()),
                &config
            ),
            Ordering::Greater
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("Item 10".into()),
                &CellValue::Text("Item 10".into()),
                &config
            ),
            Ordering::Equal
        );
    }

    #[test]
    fn reverses_order_for_desc() {
        let config = SortConfig::desc();
        assert_eq!(
            compare_cell_values(&CellValue::number(1.0), &CellValue::number(2.0), &config),
            Ordering::Greater
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("apple".into()),
                &CellValue::Text("banana".into()),
                &config
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn handles_booleans() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Boolean(false),
                &CellValue::Boolean(true),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Boolean(true),
                &CellValue::Boolean(false),
                &config
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn handles_errors() {
        let config = SortConfig::asc();
        let e1 = CellValue::Error(CellError::Div0, None);
        let e2 = CellValue::Error(CellError::Value, None);
        assert_eq!(compare_cell_values(&e1, &e2, &config), Ordering::Less);
    }

    #[test]
    fn type_priority_ascending() {
        let config = SortConfig::asc();
        let error = CellValue::Error(CellError::Div0, None);

        // number < text
        assert_eq!(
            compare_cell_values(
                &CellValue::number(1.0),
                &CellValue::Text("a".into()),
                &config
            ),
            Ordering::Less
        );
        // text < boolean
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("a".into()),
                &CellValue::Boolean(false),
                &config
            ),
            Ordering::Less
        );
        // boolean < error
        assert_eq!(
            compare_cell_values(&CellValue::Boolean(false), &error, &config),
            Ordering::Less
        );
        // error < blank (null)
        assert_eq!(
            compare_cell_values(&error, &CellValue::Null, &config),
            Ordering::Less
        );
    }

    #[test]
    fn type_priority_stable_in_descending() {
        // In descending mode, type priority does NOT reverse:
        // numbers still before text before booleans before errors, blanks still last.
        let config = SortConfig::desc();
        let error = CellValue::Error(CellError::Div0, None);

        // number still before text (type priority not reversed)
        assert_eq!(
            compare_cell_values(
                &CellValue::number(1.0),
                &CellValue::Text("a".into()),
                &config
            ),
            Ordering::Less
        );
        // text still before boolean
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("a".into()),
                &CellValue::Boolean(false),
                &config
            ),
            Ordering::Less
        );
        // boolean still before error
        assert_eq!(
            compare_cell_values(&CellValue::Boolean(false), &error, &config),
            Ordering::Less
        );
        // blanks still last
        assert_eq!(
            compare_cell_values(&error, &CellValue::Null, &config),
            Ordering::Less
        );
    }

    // ---- sort_values ----

    #[test]
    fn sorts_numbers_ascending() {
        let mut values = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::number(4.0),
            CellValue::number(1.0),
            CellValue::number(5.0),
            CellValue::number(9.0),
            CellValue::number(2.0),
            CellValue::number(6.0),
        ];
        sort_values(&mut values, &SortConfig::asc());
        let nums: Vec<f64> = values
            .iter()
            .map(|v| match v {
                CellValue::Number(n) => n.get(),
                _ => panic!("expected number"),
            })
            .collect();
        assert_eq!(nums, vec![1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 9.0]);
    }

    #[test]
    fn sorts_numbers_descending() {
        let mut values = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::number(4.0),
            CellValue::number(1.0),
            CellValue::number(5.0),
        ];
        sort_values(&mut values, &SortConfig::desc());
        let nums: Vec<f64> = values
            .iter()
            .map(|v| match v {
                CellValue::Number(n) => n.get(),
                _ => panic!("expected number"),
            })
            .collect();
        assert_eq!(nums, vec![5.0, 4.0, 3.0, 1.0, 1.0]);
    }

    #[test]
    fn sorts_strings_naturally() {
        let mut values = vec![
            CellValue::Text("Item 10".into()),
            CellValue::Text("Item 2".into()),
            CellValue::Text("Item 1".into()),
            CellValue::Text("Item 20".into()),
        ];
        sort_values(&mut values, &SortConfig::asc());
        let strs: Vec<&str> = values
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        assert_eq!(strs, vec!["Item 1", "Item 2", "Item 10", "Item 20"]);
    }

    #[test]
    fn handles_mixed_types_blanks_last() {
        let mut values = vec![
            CellValue::Text("text".into()),
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::Boolean(true),
            CellValue::number(2.0),
        ];
        sort_values(&mut values, &SortConfig::asc());

        // Number < Text < Boolean < Blank (matches Excel)
        assert_eq!(values[0], CellValue::number(1.0));
        assert_eq!(values[1], CellValue::number(2.0));
        assert_eq!(values[2], CellValue::Text("text".into()));
        assert_eq!(values[3], CellValue::Boolean(true));
        assert!(values[4].is_null()); // blank last
    }

    #[test]
    fn mixed_types_blanks_last_descending() {
        let mut values = vec![
            CellValue::Text("text".into()),
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::Boolean(true),
            CellValue::number(2.0),
            CellValue::Text("".into()),
        ];
        sort_values(&mut values, &SortConfig::desc());

        // In descending: within-type is reversed, but type priority order is same,
        // and blanks still sort last.
        // Number < Text < Boolean ... then blanks at end
        // Within number descending: 2.0 before 1.0
        // Within text descending: "text" (only non-blank text)
        // Within boolean: true (only one here)
        // Blanks at end: Null and Text("")
        assert_eq!(values[0], CellValue::number(2.0));
        assert_eq!(values[1], CellValue::number(1.0));
        assert_eq!(values[2], CellValue::Text("text".into()));
        assert_eq!(values[3], CellValue::Boolean(true));
        // Last two are blanks (Null and Text("")) — order between blanks is Equal.
    }

    #[test]
    fn empty_input() {
        let mut values: Vec<CellValue> = vec![];
        sort_values(&mut values, &SortConfig::asc());
        assert!(values.is_empty());
    }

    // ---- sort_by_in_place ----

    #[test]
    fn sort_by_in_place_objects_by_key() {
        #[derive(Debug, Clone, PartialEq)]
        struct Person {
            name: String,
            age: i32,
        }

        let mut items = vec![
            Person {
                name: "Charlie".into(),
                age: 30,
            },
            Person {
                name: "Alice".into(),
                age: 25,
            },
            Person {
                name: "Bob".into(),
                age: 35,
            },
        ];

        sort_by_in_place(
            &mut items,
            |i| CellValue::Text(i.name.clone().into()),
            &SortConfig::asc(),
        );
        let names: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, vec!["Alice", "Bob", "Charlie"]);
    }

    #[test]
    fn sort_by_in_place_descending() {
        #[derive(Debug, Clone, PartialEq)]
        struct Person {
            name: String,
            age: i32,
        }

        let mut items = vec![
            Person {
                name: "Charlie".into(),
                age: 30,
            },
            Person {
                name: "Alice".into(),
                age: 25,
            },
            Person {
                name: "Bob".into(),
                age: 35,
            },
        ];

        sort_by_in_place(
            &mut items,
            |i| CellValue::number(i.age as f64),
            &SortConfig::desc(),
        );
        let ages: Vec<i32> = items.iter().map(|i| i.age).collect();
        assert_eq!(ages, vec![35, 30, 25]);
    }

    #[test]
    fn sort_by_wrapper_returns_new_vec() {
        let items = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::number(2.0),
        ];
        let sorted = sort_by(&items, |v| v.clone(), &SortConfig::asc());

        // Original unchanged.
        assert_eq!(items[0], CellValue::number(3.0));
        assert_eq!(items[1], CellValue::number(1.0));
        assert_eq!(items[2], CellValue::number(2.0));
        // Sorted is correct.
        assert_eq!(sorted[0], CellValue::number(1.0));
        assert_eq!(sorted[1], CellValue::number(2.0));
        assert_eq!(sorted[2], CellValue::number(3.0));
    }

    #[test]
    fn in_place_sort_matches_clone_sort() {
        let original = vec![
            CellValue::number(3.0),
            CellValue::Text("banana".into()),
            CellValue::Null,
            CellValue::Boolean(false),
            CellValue::number(1.0),
            CellValue::Text("apple".into()),
            CellValue::Error(CellError::Div0, None),
            CellValue::Text("".into()),
        ];

        let config = SortConfig::asc();

        // Clone-based sort via wrapper.
        let clone_sorted = sort_by(&original, |v| v.clone(), &config);

        // In-place sort.
        let mut in_place = original.clone();
        sort_by_in_place(&mut in_place, |v| v.clone(), &config);

        assert_eq!(clone_sorted, in_place);
    }

    #[test]
    fn in_place_sort_matches_clone_sort_descending() {
        let original = vec![
            CellValue::number(3.0),
            CellValue::Text("banana".into()),
            CellValue::Null,
            CellValue::Boolean(false),
            CellValue::number(1.0),
            CellValue::Text("apple".into()),
            CellValue::Text("  ".into()),
        ];

        let config = SortConfig::desc();

        let clone_sorted = sort_by(&original, |v| v.clone(), &config);
        let mut in_place = original.clone();
        sort_by_in_place(&mut in_place, |v| v.clone(), &config);

        assert_eq!(clone_sorted, in_place);
    }

    // ---- sort_by_multiple_in_place ----

    #[test]
    fn sorts_by_multiple_keys() {
        #[derive(Debug, Clone, PartialEq)]
        struct Item {
            dept: String,
            name: String,
        }

        let mut items = vec![
            Item {
                dept: "Sales".into(),
                name: "Bob".into(),
            },
            Item {
                dept: "Engineering".into(),
                name: "Alice".into(),
            },
            Item {
                dept: "Sales".into(),
                name: "Alice".into(),
            },
            Item {
                dept: "Engineering".into(),
                name: "Charlie".into(),
            },
        ];

        let key_configs: Vec<KeyConfig<Item>> = vec![
            KeyConfig {
                key_fn: Box::new(|i: &Item| CellValue::Text(i.dept.clone().into())),
                config: SortConfig::asc(),
            },
            KeyConfig {
                key_fn: Box::new(|i: &Item| CellValue::Text(i.name.clone().into())),
                config: SortConfig::asc(),
            },
        ];

        sort_by_multiple_in_place(&mut items, &key_configs);
        let labels: Vec<String> = items
            .iter()
            .map(|i| format!("{}:{}", i.dept, i.name))
            .collect();
        assert_eq!(
            labels,
            vec![
                "Engineering:Alice",
                "Engineering:Charlie",
                "Sales:Alice",
                "Sales:Bob"
            ]
        );
    }

    #[test]
    fn respects_different_directions_for_each_key() {
        #[derive(Debug, Clone, PartialEq)]
        struct Pair {
            x: i32,
            y: i32,
        }

        let mut items = vec![
            Pair { x: 1, y: 1 },
            Pair { x: 1, y: 2 },
            Pair { x: 2, y: 1 },
            Pair { x: 2, y: 2 },
        ];

        let key_configs: Vec<KeyConfig<Pair>> = vec![
            KeyConfig {
                key_fn: Box::new(|i: &Pair| CellValue::number(i.x as f64)),
                config: SortConfig::asc(),
            },
            KeyConfig {
                key_fn: Box::new(|i: &Pair| CellValue::number(i.y as f64)),
                config: SortConfig::desc(),
            },
        ];

        sort_by_multiple_in_place(&mut items, &key_configs);
        assert_eq!(
            items,
            vec![
                Pair { x: 1, y: 2 },
                Pair { x: 1, y: 1 },
                Pair { x: 2, y: 2 },
                Pair { x: 2, y: 1 },
            ]
        );
    }

    // ---- sort_by_custom_order ----

    #[test]
    fn sorts_by_custom_order() {
        #[derive(Debug, Clone)]
        struct Item {
            priority: String,
        }

        let items = vec![
            Item {
                priority: "low".into(),
            },
            Item {
                priority: "high".into(),
            },
            Item {
                priority: "medium".into(),
            },
            Item {
                priority: "critical".into(),
            },
        ];

        let custom_order = vec![
            CellValue::Text("critical".into()),
            CellValue::Text("high".into()),
            CellValue::Text("medium".into()),
            CellValue::Text("low".into()),
        ];

        let sorted = sort_by_custom_order(
            &items,
            |i| CellValue::Text(i.priority.clone().into()),
            &custom_order,
            &SortConfig::asc(),
        );
        let priorities: Vec<&str> = sorted.iter().map(|i| i.priority.as_str()).collect();
        assert_eq!(priorities, vec!["critical", "high", "medium", "low"]);
    }

    #[test]
    fn items_not_in_custom_order_go_to_end() {
        #[derive(Debug, Clone)]
        struct Item {
            v: String,
        }

        let items = vec![
            Item { v: "x".into() },
            Item { v: "a".into() },
            Item { v: "b".into() },
            Item { v: "y".into() },
        ];

        let custom_order = vec![CellValue::Text("a".into()), CellValue::Text("b".into())];

        let sorted = sort_by_custom_order(
            &items,
            |i| CellValue::Text(i.v.clone().into()),
            &custom_order,
            &SortConfig::asc(),
        );
        let vals: Vec<&str> = sorted.iter().map(|i| i.v.as_str()).collect();
        assert_eq!(vals, vec!["a", "b", "x", "y"]);
    }

    #[test]
    fn case_insensitive_custom_order() {
        #[derive(Debug, Clone)]
        struct Item {
            v: String,
        }

        let items = vec![
            Item { v: "B".into() },
            Item { v: "a".into() },
            Item { v: "C".into() },
        ];

        let custom_order = vec![
            CellValue::Text("A".into()),
            CellValue::Text("B".into()),
            CellValue::Text("C".into()),
        ];

        let sorted = sort_by_custom_order(
            &items,
            |i| CellValue::Text(i.v.clone().into()),
            &custom_order,
            &SortConfig::asc(),
        );
        let vals: Vec<&str> = sorted.iter().map(|i| i.v.as_str()).collect();
        assert_eq!(vals, vec!["a", "B", "C"]);
    }

    #[test]
    fn custom_order_in_place() {
        let mut items = vec![
            CellValue::Text("c".into()),
            CellValue::Text("a".into()),
            CellValue::Text("b".into()),
        ];

        let custom_order = vec![
            CellValue::Text("b".into()),
            CellValue::Text("a".into()),
            CellValue::Text("c".into()),
        ];

        sort_by_custom_order_in_place(&mut items, |v| v.clone(), &custom_order, &SortConfig::asc());
        let vals: Vec<&str> = items
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        assert_eq!(vals, vec!["b", "a", "c"]);
    }

    // ---- get_unique_sorted ----

    #[test]
    fn returns_unique_sorted_values() {
        let values = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(1.0),
            CellValue::number(3.0),
            CellValue::number(2.0),
        ];
        let unique = get_unique_sorted(&values, SortDirection::Asc, None);
        assert_eq!(
            unique,
            vec![
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
            ]
        );
    }

    #[test]
    fn case_insensitive_deduplication() {
        let values = vec![
            CellValue::Text("Apple".into()),
            CellValue::Text("banana".into()),
            CellValue::Text("APPLE".into()),
            CellValue::Text("Banana".into()),
        ];
        let unique = get_unique_sorted(&values, SortDirection::Asc, None);
        assert_eq!(unique.len(), 2);
    }

    #[test]
    fn blanks_last_in_unique_sorted() {
        let values = vec![
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::number(2.0),
            CellValue::Null,
            CellValue::number(3.0),
        ];
        let unique = get_unique_sorted(&values, SortDirection::Asc, None);
        // Blanks should be last.
        assert_eq!(
            unique,
            vec![
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
                CellValue::Null,
            ]
        );
    }

    #[test]
    fn get_unique_sorted_with_custom_list() {
        let values = vec![
            CellValue::Text("low".into()),
            CellValue::Text("high".into()),
            CellValue::Text("medium".into()),
            CellValue::Text("high".into()),
        ];
        let custom = vec!["high".to_string(), "medium".to_string(), "low".to_string()];
        let unique = get_unique_sorted(&values, SortDirection::Asc, Some(&custom));
        let strs: Vec<&str> = unique
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        assert_eq!(strs, vec!["high", "medium", "low"]);
    }

    // ---- natural_compare edge cases ----

    #[test]
    fn natural_compare_pure_text() {
        assert_eq!(natural_compare("apple", "banana", false), Ordering::Less);
        assert_eq!(natural_compare("banana", "apple", false), Ordering::Greater);
        assert_eq!(natural_compare("apple", "apple", false), Ordering::Equal);
    }

    #[test]
    fn natural_compare_pure_numbers() {
        assert_eq!(natural_compare("2", "10", false), Ordering::Less);
        assert_eq!(natural_compare("10", "2", false), Ordering::Greater);
        assert_eq!(natural_compare("10", "10", false), Ordering::Equal);
    }

    #[test]
    fn natural_compare_mixed_chunks() {
        assert_eq!(
            natural_compare("file1.txt", "file2.txt", false),
            Ordering::Less
        );
        assert_eq!(
            natural_compare("file10.txt", "file2.txt", false),
            Ordering::Greater
        );
        assert_eq!(
            natural_compare("file1.txt", "file1.txt", false),
            Ordering::Equal
        );
    }

    #[test]
    fn natural_compare_empty_strings() {
        assert_eq!(natural_compare("", "", false), Ordering::Equal);
        assert_eq!(natural_compare("", "a", false), Ordering::Less);
        assert_eq!(natural_compare("a", "", false), Ordering::Greater);
    }

    #[test]
    fn natural_compare_case_insensitive() {
        assert_eq!(natural_compare("Item 2", "item 10", false), Ordering::Less);
    }

    #[test]
    fn natural_compare_very_large_numbers() {
        // Numbers exceeding i64::MAX (19 digits) — no overflow.
        assert_eq!(
            natural_compare(
                "Item 99999999999999999999",
                "Item 100000000000000000000",
                false
            ),
            Ordering::Less
        );
        assert_eq!(
            natural_compare(
                "Item 100000000000000000000",
                "Item 99999999999999999999",
                false
            ),
            Ordering::Greater
        );
        assert_eq!(
            natural_compare(
                "Item 99999999999999999998",
                "Item 99999999999999999999",
                false
            ),
            Ordering::Less
        );
        assert_eq!(
            natural_compare(
                "Item 99999999999999999999",
                "Item 99999999999999999999",
                false
            ),
            Ordering::Equal
        );
        // 30-digit numbers
        assert_eq!(
            natural_compare(
                "123456789012345678901234567890",
                "123456789012345678901234567891",
                false
            ),
            Ordering::Less
        );
        // Leading zeros
        assert_eq!(
            natural_compare("file 007", "file 7", false),
            Ordering::Equal
        );
        assert_eq!(
            natural_compare("file 009", "file 10", false),
            Ordering::Less
        );
    }

    #[test]
    fn compare_numeric_strings_basic() {
        use super::compare_numeric_strings;
        assert_eq!(compare_numeric_strings("2", "10"), Ordering::Less);
        assert_eq!(compare_numeric_strings("10", "2"), Ordering::Greater);
        assert_eq!(compare_numeric_strings("10", "10"), Ordering::Equal);
        assert_eq!(compare_numeric_strings("007", "7"), Ordering::Equal);
        assert_eq!(compare_numeric_strings("0", "0"), Ordering::Equal);
        assert_eq!(compare_numeric_strings("000", "0"), Ordering::Equal);
        assert_eq!(compare_numeric_strings("1", "2"), Ordering::Less);
    }

    // ---- apply_permutation ----

    #[test]
    fn apply_permutation_identity() {
        let mut items = vec![10, 20, 30];
        apply_permutation(&mut items, &[0, 1, 2]);
        assert_eq!(items, vec![10, 20, 30]);
    }

    #[test]
    fn apply_permutation_reverse() {
        let mut items = vec![10, 20, 30];
        apply_permutation(&mut items, &[2, 1, 0]);
        assert_eq!(items, vec![30, 20, 10]);
    }

    #[test]
    fn apply_permutation_cycle() {
        let mut items = vec![10, 20, 30, 40];
        apply_permutation(&mut items, &[1, 2, 3, 0]);
        assert_eq!(items, vec![20, 30, 40, 10]);
    }

    #[test]
    fn apply_permutation_empty() {
        let mut items: Vec<i32> = vec![];
        apply_permutation(&mut items, &[]);
        assert!(items.is_empty());
    }

    // ---- Natural sort correctness ----

    #[test]
    fn natural_sort_file_names() {
        let mut values = vec![
            CellValue::Text("file10".into()),
            CellValue::Text("file2".into()),
            CellValue::Text("file1".into()),
        ];
        sort_values(&mut values, &SortConfig::asc());
        let strs: Vec<&str> = values
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        assert_eq!(strs, vec!["file1", "file2", "file10"]);
    }

    #[test]
    fn natural_sort_embedded_numbers_with_suffix() {
        let mut values = vec![
            CellValue::Text("a1b".into()),
            CellValue::Text("a10b".into()),
            CellValue::Text("a2b".into()),
        ];
        sort_values(&mut values, &SortConfig::asc());
        let strs: Vec<&str> = values
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        assert_eq!(strs, vec!["a1b", "a2b", "a10b"]);
    }

    #[test]
    fn natural_sort_pure_number_strings() {
        let mut values = vec![
            CellValue::Text("10".into()),
            CellValue::Text("2".into()),
            CellValue::Text("1".into()),
            CellValue::Text("20".into()),
        ];
        sort_values(&mut values, &SortConfig::asc());
        let strs: Vec<&str> = values
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        assert_eq!(strs, vec!["1", "2", "10", "20"]);
    }

    #[test]
    fn natural_sort_mixed_case_insensitive() {
        // With case_insensitive (default), "File1", "file2", "FILE3" should sort 1, 2, 3.
        assert_eq!(natural_compare("File1", "file2", false), Ordering::Less);
        assert_eq!(natural_compare("file2", "FILE3", false), Ordering::Less);
    }

    // ---- compare_cell_values type ordering ----

    #[test]
    fn type_ordering_number_before_text() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::number(999.0),
                &CellValue::Text("a".into()),
                &config
            ),
            Ordering::Less
        );
    }

    #[test]
    fn type_ordering_text_before_boolean() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("zzz".into()),
                &CellValue::Boolean(false),
                &config
            ),
            Ordering::Less
        );
    }

    #[test]
    fn type_ordering_boolean_before_error() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Boolean(true),
                &CellValue::Error(CellError::Na, None),
                &config
            ),
            Ordering::Less
        );
    }

    #[test]
    fn type_ordering_error_before_null() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(
                &CellValue::Error(CellError::Na, None),
                &CellValue::Null,
                &config
            ),
            Ordering::Less
        );
    }

    #[test]
    fn type_ordering_null_vs_null() {
        let config = SortConfig::asc();
        assert_eq!(
            compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
            Ordering::Equal
        );
    }

    // ---- Descending sort ----

    #[test]
    fn descending_sort_blanks_still_last() {
        let mut values = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::number(2.0),
        ];
        sort_values(&mut values, &SortConfig::desc());
        assert_eq!(values[0], CellValue::number(3.0));
        assert_eq!(values[1], CellValue::number(2.0));
        assert_eq!(values[2], CellValue::number(1.0));
        assert_eq!(values[3], CellValue::Null);
    }

    // ---- sort_by_multiple_in_place: primary asc, secondary desc ----

    #[test]
    fn multi_key_primary_asc_secondary_desc() {
        #[derive(Debug, Clone, PartialEq)]
        struct Row {
            group: String,
            score: f64,
        }

        let mut items = vec![
            Row {
                group: "B".into(),
                score: 10.0,
            },
            Row {
                group: "A".into(),
                score: 30.0,
            },
            Row {
                group: "A".into(),
                score: 10.0,
            },
            Row {
                group: "B".into(),
                score: 30.0,
            },
            Row {
                group: "A".into(),
                score: 20.0,
            },
        ];

        let key_configs: Vec<KeyConfig<Row>> = vec![
            KeyConfig {
                key_fn: Box::new(|r: &Row| CellValue::Text(r.group.clone().into())),
                config: SortConfig::asc(),
            },
            KeyConfig {
                key_fn: Box::new(|r: &Row| CellValue::number(r.score)),
                config: SortConfig::desc(),
            },
        ];

        sort_by_multiple_in_place(&mut items, &key_configs);
        let labels: Vec<String> = items
            .iter()
            .map(|r| format!("{}:{}", r.group, r.score))
            .collect();
        assert_eq!(labels, vec!["A:30", "A:20", "A:10", "B:30", "B:10"]);
    }

    #[test]
    fn multi_key_stability_equal_primary() {
        // Items with equal primary key should maintain secondary key order.
        #[derive(Debug, Clone, PartialEq)]
        struct Row {
            key: i32,
            tag: String,
        }

        let mut items = vec![
            Row {
                key: 1,
                tag: "first".into(),
            },
            Row {
                key: 1,
                tag: "second".into(),
            },
            Row {
                key: 1,
                tag: "third".into(),
            },
        ];

        let key_configs: Vec<KeyConfig<Row>> = vec![
            KeyConfig {
                key_fn: Box::new(|r: &Row| CellValue::number(r.key as f64)),
                config: SortConfig::asc(),
            },
            KeyConfig {
                key_fn: Box::new(|r: &Row| CellValue::Text(r.tag.clone().into())),
                config: SortConfig::asc(),
            },
        ];

        sort_by_multiple_in_place(&mut items, &key_configs);
        let tags: Vec<&str> = items.iter().map(|r| r.tag.as_str()).collect();
        assert_eq!(tags, vec!["first", "second", "third"]);
    }

    // ---- Blank handling ----

    #[test]
    fn blanks_all_sort_to_end_ascending() {
        let mut values = vec![
            CellValue::Null,
            CellValue::number(1.0),
            CellValue::Text("".into()),
            CellValue::number(2.0),
            CellValue::Text("  ".into()),
        ];
        sort_values(&mut values, &SortConfig::asc());
        // Non-blanks first, sorted ascending.
        assert_eq!(values[0], CellValue::number(1.0));
        assert_eq!(values[1], CellValue::number(2.0));
        // Last 3 are all blanks (Null, "", "  ").
        for v in &values[2..] {
            assert!(
                matches!(v, CellValue::Null)
                    || matches!(v, CellValue::Text(s) if s.trim().is_empty()),
                "expected blank, got {:?}",
                v
            );
        }
    }

    #[test]
    fn blanks_all_sort_to_end_descending() {
        let mut values = vec![
            CellValue::Null,
            CellValue::number(1.0),
            CellValue::Text("".into()),
            CellValue::number(2.0),
        ];
        sort_values(&mut values, &SortConfig::desc());
        // Descending numbers first, then blanks.
        assert_eq!(values[0], CellValue::number(2.0));
        assert_eq!(values[1], CellValue::number(1.0));
        // Last 2 are blanks.
        for v in &values[2..] {
            assert!(
                matches!(v, CellValue::Null)
                    || matches!(v, CellValue::Text(s) if s.trim().is_empty()),
                "expected blank, got {:?}",
                v
            );
        }
    }

    // ---- get_unique_sorted ----

    #[test]
    fn get_unique_sorted_deduplicates() {
        let values = vec![
            CellValue::Text("apple".into()),
            CellValue::Text("banana".into()),
            CellValue::Text("apple".into()),
            CellValue::Text("cherry".into()),
            CellValue::Text("banana".into()),
        ];
        let unique = get_unique_sorted(&values, SortDirection::Asc, None);
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn get_unique_sorted_sorts_result() {
        let values = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::number(2.0),
        ];
        let unique = get_unique_sorted(&values, SortDirection::Asc, None);
        assert_eq!(
            unique,
            vec![
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
            ]
        );
    }

    #[test]
    fn get_unique_sorted_case_insensitive_dedup() {
        let values = vec![
            CellValue::Text("A".into()),
            CellValue::Text("a".into()),
            CellValue::Text("B".into()),
        ];
        let unique = get_unique_sorted(&values, SortDirection::Asc, None);
        // "A" and "a" should deduplicate (first seen wins).
        assert_eq!(unique.len(), 2);
        // The result should be sorted.
        let strs: Vec<&str> = unique
            .iter()
            .map(|v| match v {
                CellValue::Text(s) => &**s,
                _ => panic!("expected text"),
            })
            .collect();
        // First seen "A" kept, then "B".
        assert_eq!(strs, vec!["A", "B"]);
    }
}
