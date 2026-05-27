use std::cmp::Ordering;

use value_types::CellValue;

use super::config::SortConfig;
use super::natural::natural_compare;
use crate::types::SortDirection;
use crate::values::{SortKey, cell_value_to_sort_key};

/// Blank type priority constant from `SortKey`. Blanks have priority 4
/// and always sort last regardless of direction.
const BLANK_TYPE_PRIORITY: u8 = 4;

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

/// Compare precomputed decorated sort keys with their original cell values.
///
/// This is shared by single-key and multi-key decorated sorts so blank, type,
/// text, natural-sort, case-sensitivity, and descending semantics cannot drift.
pub(super) fn compare_decorated_keys(
    a_key: &SortKey,
    a_value: &CellValue,
    b_key: &SortKey,
    b_value: &CellValue,
    config: &SortConfig,
) -> Ordering {
    let a_blank = a_key.type_priority() == BLANK_TYPE_PRIORITY;
    let b_blank = b_key.type_priority() == BLANK_TYPE_PRIORITY;

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
                && let (CellValue::Text(sa), CellValue::Text(sb)) = (a_value, b_value)
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
                && let (CellValue::Text(sa), CellValue::Text(sb)) = (a_value, b_value)
            {
                let cmp = sa.cmp(sb);
                return if config.direction == SortDirection::Desc {
                    cmp.reverse()
                } else {
                    cmp
                };
            }

            // Default: use SortKey ordering (same type, so only within-type comparison).
            compare_sort_keys(a_key, b_key, config.direction)
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
    let key_a = cell_value_to_sort_key(a);
    let key_b = cell_value_to_sort_key(b);
    compare_decorated_keys(&key_a, a, &key_b, b, config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_cell_values_matches_sort_key_blank_detection() {
        let config = SortConfig::asc();
        let blank = CellValue::Text("  ".into());
        let number = CellValue::number(1.0);
        assert_eq!(
            compare_cell_values(&blank, &number, &config),
            compare_sort_keys(
                &cell_value_to_sort_key(&blank),
                &cell_value_to_sort_key(&number),
                config.direction,
            )
        );
    }
}
