//! Sort engine — pure computation for table sort order.
//!
//! Computes a permutation array mapping new positions to original row indices.
//! Does NOT modify data — the bridge applies the permutation.
//!
//! Excel comparison semantics:
//!   numbers < text < booleans < errors < blanks
//!
//! Blanks ALWAYS sort last, regardless of ascending/descending direction.

use std::cmp::Ordering;
use std::collections::HashMap;

use super::compare::{cell_value_key, compare_values};
use super::types::{SortDirection, SortSpec};
use value_types::CellValue;

/// Check whether a CellValue should be treated as "blank" for sort purposes.
///
/// This is broader than `CellValue::is_visually_blank()` which only matches `Null`.
/// For sorting, Array values should also always sort last
/// (same as blanks), since they have type_rank 4. Without this, descending
/// sort would reverse their position instead of keeping them last.
fn is_sort_blank(value: &CellValue) -> bool {
    matches!(value, CellValue::Null | CellValue::Array(_))
}

// ============================================================================
// Resolved Sort Spec (internal)
// ============================================================================

/// A sort spec with column_id resolved to a column index in the data array.
struct ResolvedSortSpec {
    col_index: usize,
    direction: SortDirection,
    /// Pre-built lookup: canonical key → position in custom_order.
    /// O(1) lookup instead of O(K) linear scan per comparison.
    custom_order_index: Option<HashMap<String, usize>>,
}

// ============================================================================
// Sort Permutation
// ============================================================================

/// Compute a sort permutation for table data rows.
///
/// Returns a `Vec<usize>` where `result[new_position] = original_row_index`.
/// The bridge applies this permutation to reorder rows.
///
/// # Arguments
///
/// * `specs` — Sort specifications. Each spec contains a resolved column index,
///   direction, and optional custom order. The first spec is the primary sort key.
/// * `data` — Column-major data: `data[col_index][row_index]`.
/// * `total_rows` — Number of data rows.
///
/// # Blanks-last semantics
///
/// Blank cells (CellValue::Null) always sort last regardless of sort direction.
/// This matches Excel behavior.
pub fn compute_sort_order(
    specs: &[SortSpec],
    data: &[&[CellValue]],
    total_rows: usize,
) -> Vec<usize> {
    if specs.is_empty() {
        // No sort specs → return identity permutation
        return (0..total_rows).collect();
    }

    // Resolve each spec's column_id to a column index.
    // The caller is responsible for mapping column_id → column index.
    // For this pure function, we parse the column index from the spec's column_id
    // or treat it as the positional index directly. In practice, the caller passes
    // specs with column indices already embedded.
    let resolved_specs: Vec<ResolvedSortSpec> = specs
        .iter()
        .filter_map(|spec| {
            // The column_id is expected to be a numeric string or the caller
            // should have pre-resolved it. We parse it as usize.
            let col_index: usize = spec.column_id.parse().ok()?;
            let custom_order_index = spec.custom_order.as_ref().map(|items| {
                items
                    .iter()
                    .enumerate()
                    .map(|(i, v)| (cell_value_key(v), i))
                    .collect::<HashMap<String, usize>>()
            });
            Some(ResolvedSortSpec {
                col_index,
                direction: spec.direction,
                custom_order_index,
            })
        })
        .collect();

    // Build initial index array [0, 1, 2, ..., n-1]
    let mut indices: Vec<usize> = (0..total_rows).collect();

    // Stable sort using multi-key comparison
    indices.sort_by(|&row_a, &row_b| compare_rows_resolved(&resolved_specs, data, row_a, row_b));

    indices
}

/// Internal: Compare two rows using pre-resolved sort specs.
fn compare_rows_resolved(
    specs: &[ResolvedSortSpec],
    data: &[&[CellValue]],
    row_a: usize,
    row_b: usize,
) -> Ordering {
    for spec in specs {
        if spec.col_index >= data.len() {
            continue;
        }

        let col_data = data[spec.col_index];
        let val_a = col_data.get(row_a).unwrap_or(&CellValue::Null);
        let val_b = col_data.get(row_b).unwrap_or(&CellValue::Null);

        let a_is_blank = is_sort_blank(val_a);
        let b_is_blank = is_sort_blank(val_b);

        // Both blank → equal on this key, move to next spec
        if a_is_blank && b_is_blank {
            continue;
        }

        // Only a blank → a goes AFTER b (regardless of ascending/descending)
        if a_is_blank {
            return Ordering::Greater;
        }

        // Only b blank → b goes AFTER a (regardless of ascending/descending)
        if b_is_blank {
            return Ordering::Less;
        }

        // Neither blank → compare values
        let cmp = if let Some(ref order_index) = spec.custom_order_index {
            compare_by_custom_order_indexed(val_a, val_b, order_index)
        } else {
            compare_values(val_a, val_b)
        };

        if cmp != Ordering::Equal {
            return match spec.direction {
                SortDirection::Ascending => cmp,
                SortDirection::Descending => cmp.reverse(),
            };
        }
    }

    // Complete tie — stable sort preserves original order
    Ordering::Equal
}

// ============================================================================
// Custom Order
// ============================================================================

/// Compare two values using a pre-built custom ordering index.
///
/// Values in the custom order sort by their index in the list.
/// Values NOT in the custom order sort after all custom values,
/// using normal `compare_values` among themselves.
fn compare_by_custom_order_indexed(
    a: &CellValue,
    b: &CellValue,
    order_index: &HashMap<String, usize>,
) -> Ordering {
    let index_a = order_index.get(&cell_value_key(a));
    let index_b = order_index.get(&cell_value_key(b));

    match (index_a, index_b) {
        (Some(ia), Some(ib)) => ia.cmp(ib),
        (Some(_), None) => Ordering::Less, // a is in list, b is not → a first
        (None, Some(_)) => Ordering::Greater, // b is in list, a is not → b first
        (None, None) => compare_values(a, b), // neither in list → normal compare
    }
}

/// Find the index of a value in a custom order list.
///
/// Uses `cell_value_key` for matching, which provides:
/// - Case-insensitive string comparison
/// - NaN == NaN
/// - null == null
/// - Error equality by error type
///
/// **BUG FIX from TS**: The original TypeScript version used `===` which fails
/// for NaN, error objects, and doesn't handle case-insensitive strings consistently.
/// This version uses canonical key matching for correct semantic comparison.
///
/// Returns `None` if the value is not found in the custom order.
#[cfg(test)]
pub(crate) fn find_custom_index(value: &CellValue, custom_order: &[CellValue]) -> Option<usize> {
    let key = cell_value_key(value);
    custom_order
        .iter()
        .position(|item| cell_value_key(item) == key)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, FiniteF64};

    /// Convenience: wrap a known-finite f64 literal in CellValue::Number.
    fn n(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(v))
    }

    /// Helper: create a SortSpec with a numeric column index string.
    fn sort_spec(col: usize, dir: SortDirection) -> SortSpec {
        SortSpec {
            column_id: col.to_string(),
            direction: dir,
            custom_order: None,
        }
    }

    fn sort_spec_custom(col: usize, dir: SortDirection, custom: Vec<CellValue>) -> SortSpec {
        SortSpec {
            column_id: col.to_string(),
            direction: dir,
            custom_order: Some(custom),
        }
    }

    // ---- Identity permutation ----

    #[test]
    fn empty_specs_returns_identity() {
        let col0 = vec![n(3.0), n(1.0), n(2.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let result = compute_sort_order(&[], &data, 3);
        assert_eq!(result, vec![0, 1, 2]);
    }

    #[test]
    fn empty_data_returns_empty() {
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let data: Vec<&[CellValue]> = vec![];
        let result = compute_sort_order(&specs, &data, 0);
        assert!(result.is_empty());
    }

    // ---- Basic ascending sort ----

    #[test]
    fn sort_numbers_ascending() {
        let col0 = vec![n(30.0), n(10.0), n(20.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 3);
        // 10 < 20 < 30 → original indices [1, 2, 0]
        assert_eq!(result, vec![1, 2, 0]);
    }

    // ---- Basic descending sort ----

    #[test]
    fn sort_numbers_descending() {
        let col0 = vec![n(30.0), n(10.0), n(20.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Descending)];
        let result = compute_sort_order(&specs, &data, 3);
        // 30 > 20 > 10 → original indices [0, 2, 1]
        assert_eq!(result, vec![0, 2, 1]);
    }

    // ---- Blanks always sort last ----

    #[test]
    fn blanks_sort_last_ascending() {
        let col0 = vec![CellValue::Null, n(2.0), CellValue::Null, n(1.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 4);
        // 1 < 2, then blanks: [3, 1, 0, 2]
        assert_eq!(result, vec![3, 1, 0, 2]);
    }

    #[test]
    fn blanks_sort_last_descending() {
        let col0 = vec![CellValue::Null, n(2.0), CellValue::Null, n(1.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Descending)];
        let result = compute_sort_order(&specs, &data, 4);
        // 2 > 1, then blanks: [1, 3, 0, 2]
        assert_eq!(result, vec![1, 3, 0, 2]);
    }

    // ---- Mixed types: numbers < text < booleans < errors < blanks ----

    #[test]
    fn sort_mixed_types_ascending() {
        let col0 = vec![
            CellValue::Text("banana".into()),
            n(1.0),
            CellValue::Boolean(false),
            CellValue::Error(CellError::Na, None),
            CellValue::Null,
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);
        // number(1) < text("banana") < bool(false) < error(#N/A) < blank
        assert_eq!(result, vec![1, 0, 2, 3, 4]);
    }

    // ---- Multi-key sort ----

    #[test]
    fn multi_key_sort() {
        // Sort by col0 ascending, then col1 descending
        let col0 = vec![n(1.0), n(2.0), n(1.0), n(2.0)];
        let col1 = vec![
            CellValue::Text("B".into()),
            CellValue::Text("A".into()),
            CellValue::Text("A".into()),
            CellValue::Text("B".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0, &col1];
        let specs = vec![
            sort_spec(0, SortDirection::Ascending),
            sort_spec(1, SortDirection::Descending),
        ];
        let result = compute_sort_order(&specs, &data, 4);
        // First by col0: rows {0,2} (val=1) then rows {1,3} (val=2)
        // Within val=1: col1 desc → "B"(row0) before "A"(row2)
        // Within val=2: col1 desc → "B"(row3) before "A"(row1)
        assert_eq!(result, vec![0, 2, 3, 1]);
    }

    // ---- Stable sort ----

    #[test]
    fn stable_sort_preserves_original_order() {
        let col0 = vec![n(1.0), n(1.0), n(1.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 3);
        // All equal → preserve original order
        assert_eq!(result, vec![0, 1, 2]);
    }

    // ---- String sort is case-insensitive ----

    #[test]
    fn string_sort_case_insensitive() {
        let col0 = vec![
            CellValue::Text("Charlie".into()),
            CellValue::Text("alpha".into()),
            CellValue::Text("BRAVO".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 3);
        // alpha < BRAVO < Charlie (case-insensitive)
        assert_eq!(result, vec![1, 2, 0]);
    }

    // ---- Custom order ----

    #[test]
    fn custom_order_basic() {
        let col0 = vec![
            CellValue::Text("low".into()),
            CellValue::Text("high".into()),
            CellValue::Text("medium".into()),
        ];
        let custom = vec![
            CellValue::Text("high".into()),
            CellValue::Text("medium".into()),
            CellValue::Text("low".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec_custom(0, SortDirection::Ascending, custom)];
        let result = compute_sort_order(&specs, &data, 3);
        // Custom order: high(1) < medium(2) < low(0)
        assert_eq!(result, vec![1, 2, 0]);
    }

    #[test]
    fn custom_order_values_not_in_list_sort_after() {
        let col0 = vec![
            CellValue::Text("unknown".into()),
            CellValue::Text("high".into()),
            CellValue::Text("also_unknown".into()),
        ];
        let custom = vec![CellValue::Text("high".into())];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec_custom(0, SortDirection::Ascending, custom)];
        let result = compute_sort_order(&specs, &data, 3);
        // "high" is index 0 in custom → first
        // "unknown" and "also_unknown" not in list → sort after, by compare_values
        // "also_unknown" < "unknown" alphabetically
        assert_eq!(result, vec![1, 2, 0]);
    }

    #[test]
    fn custom_order_blanks_still_last() {
        let col0 = vec![
            CellValue::Null,
            CellValue::Text("high".into()),
            CellValue::Text("low".into()),
        ];
        let custom = vec![
            CellValue::Text("high".into()),
            CellValue::Text("low".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec_custom(0, SortDirection::Ascending, custom)];
        let result = compute_sort_order(&specs, &data, 3);
        // "high" < "low" by custom, then blank last
        assert_eq!(result, vec![1, 2, 0]);
    }

    // ---- BUG FIX: find_custom_index uses cell_values_equal ----

    #[test]
    fn find_custom_index_case_insensitive() {
        let custom = vec![
            CellValue::Text("High".into()),
            CellValue::Text("Medium".into()),
            CellValue::Text("Low".into()),
        ];
        // Should match case-insensitively
        assert_eq!(
            find_custom_index(&CellValue::Text("high".into()), &custom),
            Some(0)
        );
        assert_eq!(
            find_custom_index(&CellValue::Text("MEDIUM".into()), &custom),
            Some(1)
        );
    }

    #[test]
    fn find_custom_index_error_values() {
        let custom = vec![
            CellValue::Error(CellError::Na, None),
            CellValue::Error(CellError::Div0, None),
        ];
        assert_eq!(
            find_custom_index(&CellValue::Error(CellError::Na, None), &custom),
            Some(0)
        );
        assert_eq!(
            find_custom_index(&CellValue::Error(CellError::Div0, None), &custom),
            Some(1)
        );
        assert_eq!(
            find_custom_index(&CellValue::Error(CellError::Value, None), &custom),
            None
        );
    }

    #[test]
    fn find_custom_index_null_values() {
        let custom = vec![CellValue::Null, n(1.0)];
        assert_eq!(find_custom_index(&CellValue::Null, &custom), Some(0));
    }

    #[test]
    fn find_custom_index_not_found() {
        let custom = vec![n(1.0), n(2.0)];
        assert_eq!(find_custom_index(&n(99.0), &custom), None);
    }

    // ---- Invalid column index is skipped ----

    #[test]
    fn invalid_column_index_skipped() {
        let col0 = vec![n(3.0), n(1.0), n(2.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        // Spec references column 99, which doesn't exist → no sorting, identity
        let specs = vec![SortSpec {
            column_id: "99".to_string(),
            direction: SortDirection::Ascending,
            custom_order: None,
        }];
        let result = compute_sort_order(&specs, &data, 3);
        assert_eq!(result, vec![0, 1, 2]);
    }

    // ---- Boolean sort order: FALSE < TRUE ----

    #[test]
    fn sort_booleans() {
        let col0 = vec![
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            CellValue::Boolean(true),
            CellValue::Boolean(false),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 4);
        // FALSE < TRUE, stable within same value
        assert_eq!(result, vec![1, 3, 0, 2]);
    }

    // ---- Error sort order ----

    #[test]
    fn sort_errors_by_excel_order() {
        let col0 = vec![
            CellValue::Error(CellError::Na, None),
            CellValue::Error(CellError::Null, None),
            CellValue::Error(CellError::Value, None),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 3);
        // Excel error order: #NULL!(1) < #VALUE!(2) < #N/A(0)
        assert_eq!(result, vec![1, 2, 0]);
    }

    // =========================================================================
    // Sort Edge Cases
    // =========================================================================

    #[test]
    fn sort_with_array_values() {
        // Arrays should sort after all scalar values (like blanks)
        let col0 = vec![
            n(10.0),
            CellValue::from_rows(vec![vec![n(5.0)]]),
            CellValue::Text("hello".into()),
            CellValue::from_rows(vec![vec![n(1.0)]]),
            n(20.0),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);

        // type_rank: Number=0, Text=1, Array=4 (treated as blank)
        // So: numbers < text < arrays
        // Expected order: [10, 20, "hello", array1, array2]
        // Original indices: [0, 4, 2, 1, 3]
        assert_eq!(result, vec![0, 4, 2, 1, 3]);
    }

    #[test]
    fn sort_with_infinity_values() {
        // CellValue::number(f64::INFINITY/NEG_INFINITY) → Error(Num)
        // Errors sort after numbers (type_rank: number=0, error=3)
        let col0 = vec![
            CellValue::number(f64::INFINITY),     // → Error(Num) [idx 0]
            n(-10.0),                             // [idx 1]
            n(0.0),                               // [idx 2]
            CellValue::number(f64::NEG_INFINITY), // → Error(Num) [idx 3]
            n(10.0),                              // [idx 4]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);

        // Ascending: numbers first (-10, 0, 10), then errors (stable: idx 0, 3)
        assert_eq!(result, vec![1, 2, 4, 0, 3]);
    }

    #[test]
    fn sort_with_infinity_descending() {
        // CellValue::number(f64::INFINITY/NEG_INFINITY) → Error(Num)
        let col0 = vec![
            CellValue::number(f64::INFINITY),     // → Error(Num) [idx 0]
            n(-10.0),                             // [idx 1]
            n(0.0),                               // [idx 2]
            CellValue::number(f64::NEG_INFINITY), // → Error(Num) [idx 3]
            n(10.0),                              // [idx 4]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Descending)];
        let result = compute_sort_order(&specs, &data, 5);

        // Descending reversal: errors before numbers, numbers desc
        // Errors (stable: 0, 3), then numbers desc (10, 0, -10)
        assert_eq!(result, vec![0, 3, 4, 2, 1]);
    }

    #[test]
    fn sort_with_nan_values() {
        // CellValue::number(f64::NAN) → Error(Num)
        let col0 = vec![
            n(10.0),                     // [idx 0]
            CellValue::number(f64::NAN), // → Error(Num) [idx 1]
            n(20.0),                     // [idx 2]
            CellValue::number(f64::NAN), // → Error(Num) [idx 3]
            n(5.0),                      // [idx 4]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);

        // Ascending: numbers first (5, 10, 20), then errors (stable: 1, 3)
        assert_eq!(result, vec![4, 0, 2, 1, 3]);
    }

    #[test]
    fn sort_with_nan_descending() {
        // CellValue::number(f64::NAN) → Error(Num)
        let col0 = vec![
            n(10.0),                     // [idx 0]
            CellValue::number(f64::NAN), // → Error(Num) [idx 1]
            n(20.0),                     // [idx 2]
            n(5.0),                      // [idx 3]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Descending)];
        let result = compute_sort_order(&specs, &data, 4);

        // Descending reversal: errors before numbers, numbers desc
        // Error(1), then 20(2), 10(0), 5(3)
        assert_eq!(result, vec![1, 2, 0, 3]);
    }

    #[test]
    fn nan_becomes_error_sort_behavior() {
        // CellValue::number(f64::NAN) → Error(Num)
        let col0 = vec![
            n(2.0),                      // [idx 0]
            CellValue::number(f64::NAN), // → Error(Num) [idx 1]
            n(1.0),                      // [idx 2]
            n(3.0),                      // [idx 3]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];

        // Ascending: numbers first (1, 2, 3), then errors
        let specs_asc = vec![sort_spec(0, SortDirection::Ascending)];
        let result_asc = compute_sort_order(&specs_asc, &data, 4);
        assert_eq!(result_asc, vec![2, 0, 3, 1]);

        // Descending: errors before numbers (reversal), numbers desc
        let specs_desc = vec![sort_spec(0, SortDirection::Descending)];
        let result_desc = compute_sort_order(&specs_desc, &data, 4);
        // Error(1), then 3(3), 2(0), 1(2)
        assert_eq!(result_desc, vec![1, 3, 0, 2]);
    }

    #[test]
    fn sort_mixed_infinity_nan_descending() {
        // All non-finite values → Error(Num)
        let col0 = vec![
            CellValue::number(f64::INFINITY),     // → Error(Num) [idx 0]
            CellValue::number(f64::NAN),          // → Error(Num) [idx 1]
            n(0.0),                               // [idx 2]
            CellValue::number(f64::NEG_INFINITY), // → Error(Num) [idx 3]
            CellValue::number(f64::NAN),          // → Error(Num) [idx 4]
            n(10.0),                              // [idx 5]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Descending)];
        let result = compute_sort_order(&specs, &data, 6);

        // Descending reversal: errors before numbers
        // All 4 errors are equal (same CellError::Num), stable: [0, 1, 3, 4]
        // Numbers desc: 10(5), 0(2)
        assert_eq!(result, vec![0, 1, 3, 4, 5, 2]);
    }

    #[test]
    fn sort_non_ascii_case_insensitive() {
        let col0 = vec![
            CellValue::Text("café".into()),
            CellValue::Text("CAFÉ".into()),
            CellValue::Text("Café".into()),
            CellValue::Text("apple".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 4);

        // "café", "CAFÉ", "Café" should be treated as equal (case-insensitive)
        // "apple" < "café" alphabetically
        // Expected order: apple, then the three café variants (stable sort preserves original order)
        assert_eq!(result[0], 3); // apple

        // The remaining three should be café variants in original order: [0, 1, 2]
        assert_eq!(result[1], 0); // café
        assert_eq!(result[2], 1); // CAFÉ
        assert_eq!(result[3], 2); // Café
    }

    #[test]
    fn sort_mixed_infinity_nan_and_regular() {
        // All non-finite values → Error(Num)
        let col0 = vec![
            CellValue::number(f64::INFINITY),     // → Error(Num) [idx 0]
            CellValue::number(f64::NAN),          // → Error(Num) [idx 1]
            n(0.0),                               // [idx 2]
            CellValue::number(f64::NEG_INFINITY), // → Error(Num) [idx 3]
            CellValue::number(f64::NAN),          // → Error(Num) [idx 4]
            n(10.0),                              // [idx 5]
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 6);

        // Ascending: numbers first (0, 10), then errors (stable: 0, 1, 3, 4)
        assert_eq!(result, vec![2, 5, 0, 1, 3, 4]);
    }

    #[test]
    fn sort_with_array_and_blanks_mixed() {
        // Arrays and nulls both have type_rank 4, so they should sort as equals
        let col0 = vec![
            n(10.0),
            CellValue::from_rows(vec![vec![n(5.0)]]),
            CellValue::Text("hello".into()),
            CellValue::Null,
            n(5.0),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);

        // Expected: numbers < text < (arrays/nulls)
        // 5 < 10 < "hello" < array < null (stable sort preserves order)
        // Original indices: [4, 0, 2, 1, 3]
        assert_eq!(result, vec![4, 0, 2, 1, 3]);
    }

    // =========================================================================
    // Fix 1 regression tests: Array blanks-last in descending sort
    // =========================================================================

    #[test]
    fn sort_with_array_values_descending() {
        // BUG FIX: Arrays must sort last even in descending order.
        // Previously, is_blank only matched Null, so Arrays got direction-reversed.
        let col0 = vec![
            n(10.0),
            CellValue::from_rows(vec![vec![n(5.0)]]),
            CellValue::Text("hello".into()),
            CellValue::from_rows(vec![vec![n(1.0)]]),
            n(20.0),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Descending)];
        let result = compute_sort_order(&specs, &data, 5);

        // Descending: text > numbers, then arrays always last (stable order)
        // "hello" > 20 > 10, then Array(row1), Array(row3) last
        assert_eq!(result, vec![2, 4, 0, 1, 3]);
    }

    #[test]
    fn sort_custom_order_descending() {
        // Custom order with descending direction reverses the custom ordering
        let col0 = vec![
            CellValue::Text("low".into()),
            CellValue::Text("high".into()),
            CellValue::Text("medium".into()),
        ];
        let custom = vec![
            CellValue::Text("high".into()),
            CellValue::Text("medium".into()),
            CellValue::Text("low".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec_custom(0, SortDirection::Descending, custom)];
        let result = compute_sort_order(&specs, &data, 3);

        // Custom ascending would be: high(1), medium(2), low(0)
        // Descending reverses: low(0), medium(2), high(1)
        assert_eq!(result, vec![0, 2, 1]);
    }

    #[test]
    fn sort_custom_order_with_blanks_descending() {
        // Blanks always sort last, even with custom order + descending
        let col0 = vec![
            CellValue::Null,
            CellValue::Text("high".into()),
            CellValue::Text("low".into()),
            CellValue::Null,
        ];
        let custom = vec![
            CellValue::Text("high".into()),
            CellValue::Text("low".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec_custom(0, SortDirection::Descending, custom)];
        let result = compute_sort_order(&specs, &data, 4);

        // Custom ascending: high(1), low(2) → descending: low(2), high(1)
        // Blanks always last (stable): Null(0), Null(3)
        assert_eq!(result, vec![2, 1, 0, 3]);
    }

    #[test]
    fn sort_empty_string_vs_text_vs_blank() {
        // Empty string "" is a text value, NOT a blank. It should sort as text.
        let col0 = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("apple".into()),
            CellValue::Null,
            CellValue::Text("".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);

        // Text sort ascending: "" < "" < "apple" (stable: row1 before row4)
        // Blanks always last (stable: row0 before row3)
        assert_eq!(result, vec![1, 4, 2, 0, 3]);
    }

    #[test]
    fn sort_single_row() {
        // Edge case: single row table always returns [0]
        let col0 = vec![n(42.0)];
        let data: Vec<&[CellValue]> = vec![&col0];
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 1);
        assert_eq!(result, vec![0]);

        // Also test descending
        let specs_desc = vec![sort_spec(0, SortDirection::Descending)];
        let result_desc = compute_sort_order(&specs_desc, &data, 1);
        assert_eq!(result_desc, vec![0]);
    }

    #[test]
    fn sort_all_same_values() {
        // Stable sort verification: all identical values preserve original order
        let col0 = vec![
            CellValue::Text("same".into()),
            CellValue::Text("same".into()),
            CellValue::Text("same".into()),
            CellValue::Text("same".into()),
            CellValue::Text("same".into()),
        ];
        let data: Vec<&[CellValue]> = vec![&col0];

        // Ascending
        let specs = vec![sort_spec(0, SortDirection::Ascending)];
        let result = compute_sort_order(&specs, &data, 5);
        assert_eq!(result, vec![0, 1, 2, 3, 4]);

        // Descending — still preserves original order since all values are equal
        let specs_desc = vec![sort_spec(0, SortDirection::Descending)];
        let result_desc = compute_sort_order(&specs_desc, &data, 5);
        assert_eq!(result_desc, vec![0, 1, 2, 3, 4]);
    }
}
