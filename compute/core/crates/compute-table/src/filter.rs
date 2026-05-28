//! Table filter engine — pure computation for filter state and evaluation.
//!
//! Stateless. Immutable. No DOM, no Yjs, no React.
//!
//! Core primitive: per-column bitmap (`Vec<u8>`), one byte per data row.
//!   1 = visible, 0 = hidden.
//!
//! Ported from `table-engine/src/filter.ts`.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::compare::{build_value_key_set, compare_values, type_rank, value_in_key_set};
use super::filter_resolve::{evaluate_top_bottom_direct, resolve_dynamic_filter};
use super::types::{
    ConditionFilter, FilterCriteria, FilterLogic, FilterOperator, TableColorFilter,
    TableFilterCondition, TableFilterState, ValueFilter,
};
use domain_types::CellFormat;
use value_types::{CellValue, Color};

// =============================================================================
// TableFilterState CRUD (all return new TableFilterState)
// =============================================================================

/// Create an empty TableFilterState with no column filters.
pub fn create_filter_state() -> TableFilterState {
    TableFilterState {
        filters: BTreeMap::new(),
    }
}

/// Set (or replace) a column's filter criteria. Returns a new TableFilterState.
pub fn set_column_filter(
    state: &TableFilterState,
    column_id: &str,
    criteria: FilterCriteria,
) -> TableFilterState {
    let mut next = state.filters.clone();
    next.insert(column_id.to_string(), criteria);
    TableFilterState { filters: next }
}

/// Clear a single column's filter. Returns a new TableFilterState.
pub fn clear_column_filter(state: &TableFilterState, column_id: &str) -> TableFilterState {
    let mut next = state.filters.clone();
    next.remove(column_id);
    TableFilterState { filters: next }
}

/// Clear all column filters. Returns a new empty TableFilterState.
pub fn clear_all_filters(_state: &TableFilterState) -> TableFilterState {
    TableFilterState {
        filters: BTreeMap::new(),
    }
}

/// Get a column's filter criteria, if any.
pub fn get_column_filter<'a>(
    state: &'a TableFilterState,
    column_id: &str,
) -> Option<&'a FilterCriteria> {
    state.filters.get(column_id)
}

/// Check if there are any active filters.
pub fn has_active_filters(state: &TableFilterState) -> bool {
    !state.filters.is_empty()
}

// =============================================================================
// Per-column evaluation -> bitmap
// =============================================================================

/// Evaluate a FilterCriteria against a column of data.
///
/// Returns `Vec<u8>`: one byte per data row, 1 = visible, 0 = hidden.
///
/// For TopBottom and Dynamic filters, internally resolves them to a
/// concrete ValueFilter or ConditionFilter first, then evaluates.
///
/// `now` is used for DynamicFilter date rules. The caller should always
/// pass this explicitly so that filter evaluation is deterministic and testable.
///
/// `column_formats` carries one resolved `CellFormat` per data row. It is
/// **required** when `criteria` is `Color` or `Icon` (the predicate consults
/// per-cell fill / font color); otherwise it is ignored. Callers that don't
/// support color filters may pass `None`.
pub fn evaluate_column_filter(
    criteria: &FilterCriteria,
    column_data: &[CellValue],
    column_formats: Option<&[CellFormat]>,
    now: Option<chrono::NaiveDate>,
    week_start_day: Option<chrono::Weekday>,
) -> Vec<u8> {
    let len = column_data.len();

    // TopBottom: use index-based evaluation to correctly handle ties
    if let FilterCriteria::TopBottom(tb) = criteria {
        return evaluate_top_bottom_direct(tb, column_data);
    }

    // Color filter — per-row evaluation against the resolved CellFormat slice.
    // If the caller did not supply formats, treat as all-pass (back-compat for
    // callers that don't have format access yet, e.g. the pure FFI bridge).
    if let FilterCriteria::Color(color_filter) = criteria {
        return match column_formats {
            Some(formats) => {
                let mut bitmap = vec![0u8; len];
                for (i, fmt) in formats.iter().enumerate().take(len) {
                    bitmap[i] = if matches_color_filter(fmt, color_filter) {
                        1
                    } else {
                        0
                    };
                }
                bitmap
            }
            None => vec![1u8; len],
        };
    }

    // Icon filters are evaluated by the bridge layer (requires CF rule context).
    // Return all-visible bitmap as a no-op at the engine level.
    if let FilterCriteria::Icon(_) = criteria {
        return vec![1u8; len];
    }

    // Resolve data-dependent filters to concrete form
    let resolved: FilterCriteria;
    let criteria_ref = if let FilterCriteria::Dynamic(dyn_filter) = criteria {
        let wsd = week_start_day.unwrap_or(chrono::Weekday::Sun);
        resolved = resolve_dynamic_filter(dyn_filter, column_data, now, wsd);
        &resolved
    } else {
        criteria
    };

    // For ValueFilter, pre-compute a HashSet of canonical keys for O(1) per-row lookup.
    let value_key_set = if let FilterCriteria::Values(vf) = criteria_ref {
        Some(build_value_key_set(&vf.included))
    } else {
        None
    };

    // For ConditionFilter with string operators, pre-compute the condition string
    // outside the per-row loop to avoid redundant allocations.
    let precomputed_cond_str = if let FilterCriteria::Condition(cf) = criteria_ref {
        if cf.conditions.len() == 1 {
            let op = &cf.conditions[0].operator;
            if matches!(
                op,
                FilterOperator::BeginsWith
                    | FilterOperator::EndsWith
                    | FilterOperator::Contains
                    | FilterOperator::NotContains
            ) {
                Some(condition_value_to_string(&cf.conditions[0].value).to_lowercase())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let mut bitmap = vec![0u8; len];
    for i in 0..len {
        bitmap[i] = if let Some(ref key_set) = value_key_set {
            // Fast path for ValueFilter: use pre-computed key set
            if let FilterCriteria::Values(vf) = criteria_ref {
                if matches_value_filter_fast(&column_data[i], vf, key_set) {
                    1
                } else {
                    0
                }
            } else {
                unreachable!()
            }
        } else if cell_matches_criteria(
            &column_data[i],
            criteria_ref,
            precomputed_cond_str.as_deref(),
        ) {
            1
        } else {
            0
        };
    }

    bitmap
}

// =============================================================================
// Cell-level matching
// =============================================================================

fn cell_matches_criteria(
    value: &CellValue,
    criteria: &FilterCriteria,
    precomputed_cond_str: Option<&str>,
) -> bool {
    match criteria {
        FilterCriteria::Values(_) => {
            // ValueFilter is handled via the fast path in evaluate_column_filter.
            // This branch should not be reached in the optimized path.
            unreachable!("ValueFilter should use matches_value_filter_fast");
        }
        FilterCriteria::Condition(cf) => matches_condition_filter(value, cf, precomputed_cond_str),
        // Color is handled via the per-row format-aware path in
        // evaluate_column_filter and never reaches this dispatch. Icon still
        // requires CF-rule context (out of scope for the pure engine) so it
        // passes through.
        FilterCriteria::Icon(_) => true,
        FilterCriteria::Color(_) => {
            unreachable!(
                "Color filters are dispatched in evaluate_column_filter via column_formats"
            )
        }
        // topBottom and dynamic should have been resolved before reaching here,
        // but handle gracefully: pass everything through
        _ => true,
    }
}

// =============================================================================
// Value filter
// =============================================================================

/// Match a cell value against a ValueFilter using a pre-computed key set for O(1) lookup.
///
/// Build the key set with `build_value_key_set(&filter.included)` once before the
/// per-row loop, then call this for each row.
pub(crate) fn matches_value_filter_fast(
    value: &CellValue,
    filter: &ValueFilter,
    key_set: &std::collections::HashSet<String>,
) -> bool {
    if value.is_visually_blank() {
        return filter.include_blanks;
    }

    value_in_key_set(value, key_set)
}

// =============================================================================
// Condition filter
// =============================================================================

/// Match a cell value against a ConditionFilter using AND/OR logic across conditions.
///
/// `precomputed_cond_str` is an optional pre-lowercased condition string for single-condition
/// string operators (BeginsWith, EndsWith, Contains, NotContains). When provided, avoids
/// redundant per-row allocation of the condition string.
pub(crate) fn matches_condition_filter(
    value: &CellValue,
    filter: &ConditionFilter,
    precomputed_cond_str: Option<&str>,
) -> bool {
    if filter.conditions.is_empty() {
        return true;
    }

    // The precomputed_cond_str optimization only applies to single-condition filters.
    // For multi-condition filters, we pass None to each condition.
    match filter.logic {
        FilterLogic::Or => filter.conditions.iter().enumerate().any(|(i, cond)| {
            let cond_str = if i == 0 { precomputed_cond_str } else { None };
            matches_single_condition(value, cond, cond_str)
        }),
        FilterLogic::And => filter.conditions.iter().enumerate().all(|(i, cond)| {
            let cond_str = if i == 0 { precomputed_cond_str } else { None };
            matches_single_condition(value, cond, cond_str)
        }),
    }
}

/// Match a cell value against a single TableFilterCondition.
///
/// Supports 14 operators: equals, notEquals, greaterThan, greaterThanOrEqual,
/// lessThan, lessThanOrEqual, beginsWith, endsWith, contains, notContains,
/// between, notBetween, isBlank, isNotBlank.
///
/// Semantics:
/// - Type compatibility: values are comparable only if they have the same type_rank.
///   Type mismatch -> false for positive operators, true for negative operators.
/// - NaN: matches only notEquals, notBetween, isNotBlank.
///   String operators (beginsWith, etc.) fall through to treat NaN as "NaN" string.
/// - Blank: matches only isBlank. All other operators return false for blanks,
///   except negative operators (notEquals, notContains, notBetween) which return true.
pub(crate) fn matches_single_condition(
    value: &CellValue,
    condition: &TableFilterCondition,
    precomputed_cond_str: Option<&str>,
) -> bool {
    let value_is_blank = value.is_visually_blank();
    let op = &condition.operator;

    // FiniteF64 can never be NaN, so no NaN guard needed.

    match op {
        FilterOperator::Equals => {
            if value_is_blank {
                return false;
            }
            if !types_compatible(value, &condition.value) {
                return false;
            }
            compare_values(value, &condition.value) == Ordering::Equal
        }

        FilterOperator::NotEquals => {
            if value_is_blank {
                return true;
            }
            if !types_compatible(value, &condition.value) {
                return true;
            }
            compare_values(value, &condition.value) != Ordering::Equal
        }

        FilterOperator::GreaterThan => {
            if value_is_blank {
                return false;
            }
            if !types_compatible(value, &condition.value) {
                return false;
            }
            compare_values(value, &condition.value) == Ordering::Greater
        }

        FilterOperator::GreaterThanOrEqual => {
            if value_is_blank {
                return false;
            }
            if !types_compatible(value, &condition.value) {
                return false;
            }
            matches!(
                compare_values(value, &condition.value),
                Ordering::Greater | Ordering::Equal
            )
        }

        FilterOperator::LessThan => {
            if value_is_blank {
                return false;
            }
            if !types_compatible(value, &condition.value) {
                return false;
            }
            compare_values(value, &condition.value) == Ordering::Less
        }

        FilterOperator::LessThanOrEqual => {
            if value_is_blank {
                return false;
            }
            if !types_compatible(value, &condition.value) {
                return false;
            }
            matches!(
                compare_values(value, &condition.value),
                Ordering::Less | Ordering::Equal
            )
        }

        FilterOperator::BeginsWith => {
            if value_is_blank {
                return false;
            }
            let val_str = value.to_string().to_lowercase();
            if let Some(cs) = precomputed_cond_str {
                val_str.starts_with(cs)
            } else {
                let cs = condition_value_to_string(&condition.value).to_lowercase();
                val_str.starts_with(&cs)
            }
        }

        FilterOperator::EndsWith => {
            if value_is_blank {
                return false;
            }
            let val_str = value.to_string().to_lowercase();
            if let Some(cs) = precomputed_cond_str {
                val_str.ends_with(cs)
            } else {
                let cs = condition_value_to_string(&condition.value).to_lowercase();
                val_str.ends_with(&cs)
            }
        }

        FilterOperator::Contains => {
            if value_is_blank {
                return false;
            }
            let val_str = value.to_string().to_lowercase();
            if let Some(cs) = precomputed_cond_str {
                val_str.contains(cs)
            } else {
                let cs = condition_value_to_string(&condition.value).to_lowercase();
                val_str.contains(&cs)
            }
        }

        FilterOperator::NotContains => {
            if value_is_blank {
                return true;
            }
            let val_str = value.to_string().to_lowercase();
            if let Some(cs) = precomputed_cond_str {
                !val_str.contains(cs)
            } else {
                let cs = condition_value_to_string(&condition.value).to_lowercase();
                !val_str.contains(&cs)
            }
        }

        FilterOperator::Between => {
            if value_is_blank {
                return false;
            }
            if !types_compatible(value, &condition.value) {
                return false;
            }
            let value2 = condition
                .value2
                .as_ref()
                .cloned()
                .unwrap_or(CellValue::Null);
            if !types_compatible(value, &value2) {
                return false;
            }
            matches!(
                compare_values(value, &condition.value),
                Ordering::Greater | Ordering::Equal
            ) && matches!(
                compare_values(value, &value2),
                Ordering::Less | Ordering::Equal
            )
        }

        FilterOperator::NotBetween => {
            if value_is_blank {
                // BUG FIX: TS returned false here, but all other negative operators
                // (notEquals, notContains) return true for blanks. Consistent behavior:
                // blanks pass all negative/exclusion operators.
                return true;
            }
            if !types_compatible(value, &condition.value) {
                return true;
            }
            let value2 = condition
                .value2
                .as_ref()
                .cloned()
                .unwrap_or(CellValue::Null);
            if !types_compatible(value, &value2) {
                return true;
            }
            compare_values(value, &condition.value) == Ordering::Less
                || compare_values(value, &value2) == Ordering::Greater
        }

        FilterOperator::IsBlank => value_is_blank,

        FilterOperator::IsNotBlank => !value_is_blank,
    }
}

// =============================================================================
// Helpers
// =============================================================================

/// Check if two values have compatible types for numeric/relational comparison.
///
/// Same-type or both-null are compatible. Errors are only compatible with errors.
/// This matches Excel behavior where type-mismatched comparisons fail.
fn types_compatible(a: &CellValue, b: &CellValue) -> bool {
    type_rank(a) == type_rank(b)
}

/// Match a resolved CellFormat against a color filter criterion.
///
/// Excel's color filter is single-axis: a color filter request specifies
/// EITHER a fill color OR a font color (never both at once). The
/// `TableColorFilter` shape encodes this as two `Option<Color>` fields, and
/// the storage layer always sets exactly one of them.
///
/// Comparison is byte-equality on the parsed RGBA — `Color::from_hex` is
/// case-insensitive, so `#FFFF00` and `#ffff00` are equivalent. A cell whose
/// resolved color is `None` (default fill / default font) does not match any
/// non-default request — Excel parity: filtering by yellow does not show
/// unstyled cells.
pub(crate) fn matches_color_filter(format: &CellFormat, criteria: &TableColorFilter) -> bool {
    if let Some(target) = criteria.cell_color {
        let cell_hex = match format.background_color.as_deref() {
            Some(s) => s,
            None => return false,
        };
        return Color::from_hex(cell_hex)
            .map(|c| c == target)
            .unwrap_or(false);
    }
    if let Some(target) = criteria.font_color {
        let font_hex = match format.font_color.as_deref() {
            Some(s) => s,
            None => return false,
        };
        return Color::from_hex(font_hex)
            .map(|c| c == target)
            .unwrap_or(false);
    }
    // No request fields set — degenerate filter, treat as no-op (match all).
    true
}

/// Convert a condition value to a string for string operators.
/// If Null, returns empty string (matching the TS `String(condition.value ?? '')` behavior).
fn condition_value_to_string(value: &CellValue) -> String {
    match value {
        CellValue::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests;
