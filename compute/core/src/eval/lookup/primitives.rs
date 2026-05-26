//! Primitive lookup helpers — wildcard detection, binary search, scalar MATCH/INDEX.
//!
//! Pure functions with zero `Evaluator` dependency.

use std::sync::Arc;

use value_types::{CellArray, CellError, CellValue};

use crate::eval::engine::operators::{cell_value_cmp_for_lookup, cell_value_eq_lookup};
use crate::functions::helpers::criteria::WildcardPattern;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Returns true when the lookup value is a text string containing unescaped
/// wildcard characters (* or ?).  The tilde escape (~*, ~?) is NOT counted
/// as a wildcard — it represents a literal character.
pub(in crate::eval::lookup) fn has_wildcard_chars(lookup: &CellValue) -> bool {
    if let CellValue::Text(s) = lookup {
        let mut chars = s.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '~' {
                // Skip the next character (it is escaped)
                chars.next();
            } else if ch == '*' || ch == '?' {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Free helper functions — scalar MATCH and INDEX logic
// ---------------------------------------------------------------------------

/// Binary search for approximate match: find the last same-type value where
/// `lookup >= value` (ascending) or `lookup <= value` (descending).
///
/// Matches Excel's binary search algorithm and the indexed fast path
/// (`search_leq_text`/`search_leq_numeric` in lookup_index.rs).
///
/// On perfectly sorted data, this produces identical results to the previous
/// linear scan. On imperfectly sorted data (e.g. text sorted by underlying
/// numeric fields), this matches Excel's behavior where linear scan diverges.
pub(in crate::eval::lookup) fn approx_match_binary_search<'a>(
    lookup: &CellValue,
    values: impl Iterator<Item = (usize, &'a CellValue)>,
    ascending: bool,
) -> Option<usize> {
    // Collect values into a Vec — we need random access for binary search.
    // We try to avoid filtering by checking if all values are the same type
    // as the lookup (common case for well-typed spreadsheet columns).
    let all_values: Vec<(usize, &CellValue)> = values.collect();

    if all_values.is_empty() {
        return None;
    }

    // Fast path: check if ALL values are comparable to the lookup (same type).
    // If so, skip the filtering step and use partition_point directly.
    let all_same_type = all_values
        .iter()
        .all(|&(_, val)| cell_value_cmp_for_lookup(lookup, val).is_some());

    if all_same_type {
        // All values are comparable — use partition_point directly, no extra Vec.
        if ascending {
            let pos = all_values
                .partition_point(|&(_, val)| cell_value_cmp_for_lookup(lookup, val).unwrap() >= 0);
            if pos > 0 {
                Some(all_values[pos - 1].0)
            } else {
                None
            }
        } else {
            let pos = all_values
                .partition_point(|&(_, val)| cell_value_cmp_for_lookup(lookup, val).unwrap() <= 0);
            if pos > 0 {
                Some(all_values[pos - 1].0)
            } else {
                None
            }
        }
    } else {
        // Mixed types — filter to same-type candidates only.
        let candidates: Vec<(usize, &CellValue)> = all_values
            .into_iter()
            .filter(|&(_, val)| cell_value_cmp_for_lookup(lookup, val).is_some())
            .collect();

        if candidates.is_empty() {
            return None;
        }

        if ascending {
            let pos = candidates
                .partition_point(|&(_, val)| cell_value_cmp_for_lookup(lookup, val).unwrap() >= 0);
            if pos > 0 {
                Some(candidates[pos - 1].0)
            } else {
                None
            }
        } else {
            let pos = candidates
                .partition_point(|&(_, val)| cell_value_cmp_for_lookup(lookup, val).unwrap() <= 0);
            if pos > 0 {
                Some(candidates[pos - 1].0)
            } else {
                None
            }
        }
    }
}

/// Scalar MATCH: find `lookup` in `flat` using `match_type` semantics.
/// Returns 1-based position or CellError::Na / CellError::Value.
pub(in crate::eval::lookup) fn match_scalar_in_flat(
    lookup: &CellValue,
    flat: &[CellValue],
    match_type: i32,
) -> CellValue {
    match match_type {
        0 => {
            // Exact match — check for wildcard patterns in text lookups
            if has_wildcard_chars(lookup)
                && let CellValue::Text(lookup_text) = lookup
            {
                let pattern = WildcardPattern::new(lookup_text);
                for (i, v) in flat.iter().enumerate() {
                    if let CellValue::Text(s) = v
                        && pattern.matches(s)
                    {
                        return CellValue::number((i + 1) as f64);
                    }
                }
                return CellValue::Error(CellError::Na, None);
            }
            for (i, v) in flat.iter().enumerate() {
                if cell_value_eq_lookup(lookup, v) {
                    return CellValue::number((i + 1) as f64);
                }
            }
            CellValue::Error(CellError::Na, None)
        }
        1 => {
            // Largest value <= lookup (array must be ascending)
            match approx_match_binary_search(lookup, flat.iter().enumerate(), true) {
                Some(i) => CellValue::number((i + 1) as f64),
                None => CellValue::Error(CellError::Na, None),
            }
        }
        -1 => {
            // Smallest value >= lookup (array must be descending)
            match approx_match_binary_search(lookup, flat.iter().enumerate(), false) {
                Some(i) => {
                    // Backtrack to first duplicate (Excel returns first match position)
                    let best_val = &flat[i];
                    let mut first = i;
                    while first > 0 {
                        if cell_value_cmp_for_lookup(best_val, &flat[first - 1]) != Some(0) {
                            break;
                        }
                        first -= 1;
                    }
                    CellValue::number((first + 1) as f64)
                }
                None => CellValue::Error(CellError::Na, None),
            }
        }
        _ => CellValue::Error(CellError::Value, None),
    }
}

/// Apply Excel INDEX semantics for the 2-arg form: map user-supplied
/// `(row_idx, col_idx, has_col_arg)` to effective `(eff_row, eff_col)`.
///
/// Rules:
/// - 2-arg form (`has_col_arg=false`):
///   - Single-row range → row_idx is treated as column index: `(1, row_idx)`
///   - Single-col range → row_idx selects a row: `(row_idx, 1)`
///   - Multi-row, multi-col → row_idx selects a row, entire row returned: `(row_idx, 0)`
/// - 3-arg form (`has_col_arg=true`): `(row_idx, col_idx)` passed through unchanged.
///
/// Returns `(eff_row, eff_col)` where 0 means "entire row/column".
pub(in crate::eval::lookup) fn index_effective_position(
    row_idx: usize,
    col_idx: usize,
    has_col_arg: bool,
    num_rows: usize,
    num_cols: usize,
) -> (usize, usize) {
    if !has_col_arg {
        if num_rows == 1 {
            (1, row_idx)
        } else if num_cols == 1 {
            (row_idx, 1)
        } else {
            (row_idx, 0)
        }
    } else {
        (row_idx, col_idx)
    }
}

/// Scalar INDEX: given a CellArray source, extract value at (row_idx, col_idx).
/// Handles all Excel INDEX semantics: 2-arg form, single-row/col, etc.
pub(in crate::eval::lookup) fn index_scalar(
    source: &CellArray,
    row_idx: usize,
    col_idx: usize,
    has_col_arg: bool,
) -> CellValue {
    let num_rows = source.rows();
    let num_cols = source.cols();

    let (row_idx, col_idx) =
        index_effective_position(row_idx, col_idx, has_col_arg, num_rows, num_cols);

    if row_idx == 0 && col_idx == 0 {
        return CellValue::Array(Arc::new(source.clone()));
    }
    if row_idx == 0 {
        let ci = col_idx.saturating_sub(1);
        let col_data: Vec<CellValue> = (0..source.rows())
            .map(|ri| {
                source
                    .get(ri, ci)
                    .cloned()
                    .unwrap_or(CellValue::Error(CellError::Ref, None))
            })
            .collect();
        return CellValue::column_array(col_data);
    }
    if col_idx == 0 {
        let ri = row_idx.saturating_sub(1);
        if ri < source.rows() {
            return CellValue::row_array(source.row(ri).to_vec());
        } else {
            return CellValue::Error(CellError::Ref, None);
        }
    }
    let ri = row_idx.saturating_sub(1);
    let ci = col_idx.saturating_sub(1);
    source
        .get(ri, ci)
        .cloned()
        .unwrap_or(CellValue::Error(CellError::Ref, None))
}
