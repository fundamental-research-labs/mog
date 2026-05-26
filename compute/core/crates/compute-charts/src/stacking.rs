//! Stacking algebra for bar/area/histogram charts.
//!
//! Computes start/end positions for stacked segments in four modes:
//! zero, normalize, center, and no-stack (None).
//!
//! All functions are pure and handle edge cases (empty inputs, zero totals,
//! non-finite values).

use std::collections::HashMap;

use crate::types::{DataRow, StackInput, StackMode, StackOutput};
use crate::utils::value_to_string;

// =============================================================================
// Helpers
// =============================================================================

/// Sanitize a numeric value: non-finite values (NaN, Infinity, -Infinity) become 0.
#[inline]
fn sanitize(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

// =============================================================================
// Core
// =============================================================================

/// Compute stacked positions for data segments.
///
/// This is the core algebraic operation that all chart stacking uses.
/// It computes start/end positions for each segment based on the stack mode.
///
/// - `None` mode: no stacking, each segment starts at 0 (start=0, end=value).
/// - `Some(Zero)`: positive values stack upward from 0, negative values stack
///   downward from 0 (separate accumulators).
/// - `Some(Normalize)`: values normalized to percentages per category using
///   absolute values. Total per category = 100%.
/// - `Some(Center)`: values centered around 0 (stream graph style).
///   offset = -(total / 2), segments stack from offset.
///
/// Non-finite values are sanitized to 0. Input order is preserved in output.
pub fn compute_stack(inputs: &[StackInput], mode: Option<StackMode>) -> Vec<StackOutput> {
    if inputs.is_empty() {
        return Vec::new();
    }

    match mode {
        // No stacking: start=0, end=value
        None => inputs
            .iter()
            .map(|inp| {
                let v = sanitize(inp.value);
                StackOutput {
                    category: inp.category.clone(),
                    group: inp.group.clone(),
                    value: v,
                    start: 0.0,
                    end: v,
                }
            })
            .collect(),

        // Zero mode: separate positive/negative accumulators per category
        Some(StackMode::Zero) => {
            let mut pos_accum: HashMap<String, f64> = HashMap::new();
            let mut neg_accum: HashMap<String, f64> = HashMap::new();

            inputs
                .iter()
                .map(|inp| {
                    let v = sanitize(inp.value);

                    let (start, end) = if v >= 0.0 {
                        let start = *pos_accum.get(&inp.category).unwrap_or(&0.0);
                        let end = start + v;
                        pos_accum.insert(inp.category.clone(), end);
                        (start, end)
                    } else {
                        let start = *neg_accum.get(&inp.category).unwrap_or(&0.0);
                        let end = start + v;
                        neg_accum.insert(inp.category.clone(), end);
                        (start, end)
                    };

                    StackOutput {
                        category: inp.category.clone(),
                        group: inp.group.clone(),
                        value: v,
                        start,
                        end,
                    }
                })
                .collect()
        }

        // Normalize mode: compute totals first, then normalize to percentages
        Some(StackMode::Normalize) => {
            let totals = category_totals(inputs);
            let mut cum_accum: HashMap<String, f64> = HashMap::new();

            inputs
                .iter()
                .map(|inp| {
                    let v = sanitize(inp.value);
                    let total = totals.get(&inp.category).copied().unwrap_or(0.0);

                    // Avoid divide-by-zero: if total is 0, segment has zero size
                    let pct = if total == 0.0 {
                        0.0
                    } else {
                        (v.abs() / total) * 100.0
                    };

                    let start = *cum_accum.get(&inp.category).unwrap_or(&0.0);
                    let end = start + pct;
                    cum_accum.insert(inp.category.clone(), end);

                    StackOutput {
                        category: inp.category.clone(),
                        group: inp.group.clone(),
                        value: v,
                        start,
                        end,
                    }
                })
                .collect()
        }

        // Center mode: compute totals per category, offset by -(total/2)
        Some(StackMode::Center) => {
            // First pass: compute total per category (sum of absolute values)
            let mut cat_totals: HashMap<String, f64> = HashMap::new();
            for inp in inputs {
                let v = sanitize(inp.value);
                *cat_totals.entry(inp.category.clone()).or_insert(0.0) += v.abs();
            }

            // Second pass: stack with offset
            let mut cum_accum: HashMap<String, f64> = HashMap::new();

            inputs
                .iter()
                .map(|inp| {
                    let v = sanitize(inp.value);
                    let total = cat_totals.get(&inp.category).copied().unwrap_or(0.0);
                    let offset = -(total / 2.0);

                    let cum_so_far = *cum_accum.get(&inp.category).unwrap_or(&0.0);
                    let start = offset + cum_so_far;
                    let end = start + v.abs();
                    cum_accum.insert(inp.category.clone(), cum_so_far + v.abs());

                    StackOutput {
                        category: inp.category.clone(),
                        group: inp.group.clone(),
                        value: v,
                        start,
                        end,
                    }
                })
                .collect()
        }
    }
}

// =============================================================================
// Convenience helpers
// =============================================================================

/// Compute category totals (sum of absolute values) for normalization.
///
/// Returns a map of category -> total absolute value. Non-finite values
/// are sanitized to 0 before summing.
pub fn category_totals(inputs: &[StackInput]) -> HashMap<String, f64> {
    let mut totals: HashMap<String, f64> = HashMap::new();

    for inp in inputs {
        let v = sanitize(inp.value);
        *totals.entry(inp.category.clone()).or_insert(0.0) += v.abs();
    }

    totals
}

/// Prepare [`StackInput`]s from [`DataRow`] arrays.
///
/// - Non-numeric values become 0.
/// - If `group_field` is `None`, group defaults to `"__default__"`.
/// - Category is extracted as a string; missing fields become `""`.
pub fn data_to_stack_inputs(
    data: &[DataRow],
    category_field: &str,
    value_field: &str,
    group_field: Option<&str>,
) -> Vec<StackInput> {
    data.iter()
        .map(|row| {
            let raw_value = row.get(value_field);
            let value = raw_value
                .and_then(|v| v.as_f64())
                .map(sanitize)
                .unwrap_or(0.0);

            let category = row
                .get(category_field)
                .map(value_to_string)
                .unwrap_or_default();

            let group = match group_field {
                Some(gf) => row.get(gf).map(value_to_string).unwrap_or_default(),
                None => "__default__".to_string(),
            };

            StackInput {
                category,
                value,
                group,
            }
        })
        .collect()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn inp(category: &str, value: f64, group: &str) -> StackInput {
        StackInput {
            category: category.to_string(),
            value,
            group: group.to_string(),
        }
    }

    // -------------------------------------------------------------------------
    // No-stack mode (None)
    // -------------------------------------------------------------------------

    #[test]
    fn no_stack_mode_start_zero_end_value() {
        let inputs = vec![
            inp("A", 10.0, "g1"),
            inp("A", 20.0, "g2"),
            inp("B", 5.0, "g1"),
        ];

        let result = compute_stack(&inputs, None);

        assert_eq!(result.len(), 3);
        for out in &result {
            assert_eq!(out.start, 0.0);
            assert_eq!(out.end, out.value);
        }
        assert_eq!(result[0].value, 10.0);
        assert_eq!(result[1].value, 20.0);
        assert_eq!(result[2].value, 5.0);
    }

    // -------------------------------------------------------------------------
    // Zero mode
    // -------------------------------------------------------------------------

    #[test]
    fn zero_mode_positive_stacking() {
        let inputs = vec![
            inp("A", 10.0, "g1"),
            inp("A", 20.0, "g2"),
            inp("A", 5.0, "g3"),
        ];

        let result = compute_stack(&inputs, Some(StackMode::Zero));

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].start, 0.0);
        assert_eq!(result[0].end, 10.0);
        assert_eq!(result[1].start, 10.0);
        assert_eq!(result[1].end, 30.0);
        assert_eq!(result[2].start, 30.0);
        assert_eq!(result[2].end, 35.0);
    }

    #[test]
    fn zero_mode_negative_values_stack_separately() {
        let inputs = vec![inp("A", -10.0, "g1"), inp("A", -20.0, "g2")];

        let result = compute_stack(&inputs, Some(StackMode::Zero));

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].start, 0.0);
        assert_eq!(result[0].end, -10.0);
        assert_eq!(result[1].start, -10.0);
        assert_eq!(result[1].end, -30.0);
    }

    #[test]
    fn zero_mode_mixed_positive_negative() {
        let inputs = vec![
            inp("A", 10.0, "g1"),
            inp("A", -5.0, "g2"),
            inp("A", 20.0, "g3"),
            inp("A", -3.0, "g4"),
        ];

        let result = compute_stack(&inputs, Some(StackMode::Zero));

        // Positive stack: g1(0->10), g3(10->30)
        assert_eq!(result[0].start, 0.0);
        assert_eq!(result[0].end, 10.0);
        assert_eq!(result[2].start, 10.0);
        assert_eq!(result[2].end, 30.0);
        // Negative stack: g2(0->-5), g4(-5->-8)
        assert_eq!(result[1].start, 0.0);
        assert_eq!(result[1].end, -5.0);
        assert_eq!(result[3].start, -5.0);
        assert_eq!(result[3].end, -8.0);
    }

    // -------------------------------------------------------------------------
    // Normalize mode
    // -------------------------------------------------------------------------

    #[test]
    fn normalize_mode_sums_to_100() {
        let inputs = vec![
            inp("A", 30.0, "g1"),
            inp("A", 70.0, "g2"),
            inp("B", 50.0, "g1"),
            inp("B", 50.0, "g2"),
        ];

        let result = compute_stack(&inputs, Some(StackMode::Normalize));

        // Category A: 30% + 70% = 100%
        assert_eq!(result[0].start, 0.0);
        assert!((result[0].end - 30.0).abs() < 1e-10);
        assert!((result[1].start - 30.0).abs() < 1e-10);
        assert!((result[1].end - 100.0).abs() < 1e-10);

        // Category B: 50% + 50% = 100%
        assert_eq!(result[2].start, 0.0);
        assert!((result[2].end - 50.0).abs() < 1e-10);
        assert!((result[3].start - 50.0).abs() < 1e-10);
        assert!((result[3].end - 100.0).abs() < 1e-10);
    }

    #[test]
    fn normalize_mode_zero_total_no_divide_by_zero() {
        let inputs = vec![inp("A", 0.0, "g1"), inp("A", 0.0, "g2")];

        let result = compute_stack(&inputs, Some(StackMode::Normalize));

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].start, 0.0);
        assert_eq!(result[0].end, 0.0);
        assert_eq!(result[1].start, 0.0);
        assert_eq!(result[1].end, 0.0);
    }

    // -------------------------------------------------------------------------
    // Center mode
    // -------------------------------------------------------------------------

    #[test]
    fn center_mode_centered_around_zero() {
        let inputs = vec![
            inp("A", 10.0, "g1"),
            inp("A", 20.0, "g2"),
            inp("A", 10.0, "g3"),
        ];

        let result = compute_stack(&inputs, Some(StackMode::Center));

        // Total = 40, offset = -20
        assert_eq!(result[0].start, -20.0);
        assert_eq!(result[0].end, -10.0);
        assert_eq!(result[1].start, -10.0);
        assert_eq!(result[1].end, 10.0);
        assert_eq!(result[2].start, 10.0);
        assert_eq!(result[2].end, 20.0);
    }

    #[test]
    fn center_mode_single_value() {
        let inputs = vec![inp("A", 10.0, "g1")];

        let result = compute_stack(&inputs, Some(StackMode::Center));

        assert_eq!(result[0].start, -5.0);
        assert_eq!(result[0].end, 5.0);
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    #[test]
    fn empty_input_returns_empty() {
        let result = compute_stack(&[], Some(StackMode::Zero));
        assert!(result.is_empty());
    }

    #[test]
    fn non_finite_values_sanitized_to_zero() {
        let inputs = vec![
            inp("A", f64::NAN, "g1"),
            inp("A", f64::INFINITY, "g2"),
            inp("A", f64::NEG_INFINITY, "g3"),
            inp("A", 10.0, "g4"),
        ];

        let result = compute_stack(&inputs, Some(StackMode::Zero));

        assert_eq!(result[0].value, 0.0);
        assert_eq!(result[0].start, 0.0);
        assert_eq!(result[0].end, 0.0);

        assert_eq!(result[1].value, 0.0);
        assert_eq!(result[2].value, 0.0);

        assert_eq!(result[3].value, 10.0);
        assert_eq!(result[3].start, 0.0);
        assert_eq!(result[3].end, 10.0);
    }

    // -------------------------------------------------------------------------
    // category_totals
    // -------------------------------------------------------------------------

    #[test]
    fn category_totals_correct_absolute_sums() {
        let inputs = vec![
            inp("A", 10.0, "g1"),
            inp("A", -20.0, "g2"),
            inp("B", 5.0, "g1"),
            inp("B", 3.0, "g2"),
        ];

        let totals = category_totals(&inputs);

        assert_eq!(totals["A"], 30.0);
        assert_eq!(totals["B"], 8.0);
    }

    // -------------------------------------------------------------------------
    // data_to_stack_inputs
    // -------------------------------------------------------------------------

    #[test]
    fn data_to_stack_inputs_correct_field_extraction() {
        let data: Vec<DataRow> = vec![
            serde_json::from_value(json!({"cat": "A", "val": 10.0, "grp": "g1"})).unwrap(),
            serde_json::from_value(json!({"cat": "B", "val": 20.0, "grp": "g2"})).unwrap(),
            serde_json::from_value(json!({"cat": "C", "val": "not_a_number", "grp": "g3"}))
                .unwrap(),
        ];

        let result = data_to_stack_inputs(&data, "cat", "val", Some("grp"));

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].category, "A");
        assert_eq!(result[0].value, 10.0);
        assert_eq!(result[0].group, "g1");

        assert_eq!(result[1].category, "B");
        assert_eq!(result[1].value, 20.0);
        assert_eq!(result[1].group, "g2");

        assert_eq!(result[2].category, "C");
        assert_eq!(result[2].value, 0.0);
        assert_eq!(result[2].group, "g3");
    }

    #[test]
    fn data_to_stack_inputs_no_group_field() {
        let data: Vec<DataRow> =
            vec![serde_json::from_value(json!({"cat": "A", "val": 10.0})).unwrap()];

        let result = data_to_stack_inputs(&data, "cat", "val", None);

        assert_eq!(result[0].group, "__default__");
    }

    #[test]
    fn data_to_stack_inputs_missing_fields() {
        let data: Vec<DataRow> = vec![serde_json::from_value(json!({})).unwrap()];

        let result = data_to_stack_inputs(&data, "cat", "val", Some("grp"));

        assert_eq!(result[0].category, "");
        assert_eq!(result[0].value, 0.0);
        assert_eq!(result[0].group, "");
    }
}
