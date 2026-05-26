//! Data bar sizing and axis computation.
//!
//! Rust port of `computeDataBarFill` from
//! `spreadsheet-model/src/conditional-format/color-scale.ts` (lines 322-376).

use crate::stats::RangeStatistics;
use crate::types::{CFDataBar, CFDataBarAxisPosition, DataBarResult};

use super::color_scale::resolve_color_point_value;

// =============================================================================
// Data bar computation
// =============================================================================

/// Compute data bar fill for a numeric value.
/// Handles positive/negative values with axis positioning.
///
/// Faithfully ported from `computeDataBarFill` in color-scale.ts (lines 322-376).
pub fn compute_data_bar(
    value: f64,
    data_bar: &CFDataBar,
    stats: &RangeStatistics,
) -> DataBarResult {
    let positive_color = data_bar.positive_color;
    let negative_color_parsed = data_bar.negative_color;
    let border_color_parsed = data_bar.border_color;
    let negative_border_color_parsed = data_bar.negative_border_color;
    let axis_color_parsed = data_bar.axis_color;

    // Guard: non-finite values get a zero-fill result (safe fallback)
    if !value.is_finite() {
        return DataBarResult {
            fill_percent: 0.0,
            color: positive_color,
            gradient: data_bar.gradient,
            axis_position: 0.0,
            is_negative: false,
            negative_color: negative_color_parsed,
            show_value: data_bar.show_value,
            show_axis: false,
            border_color: border_color_parsed,
            negative_border_color: negative_border_color_parsed,
            show_border: data_bar.show_border,
            direction: data_bar.direction,
            axis_color: axis_color_parsed,
        };
    }

    // Resolve min/max point values
    let min_value = resolve_color_point_value(&data_bar.min_point, stats);
    let max_value = resolve_color_point_value(&data_bar.max_point, stats);

    let is_negative = value < 0.0;

    // Determine sign presence
    let has_negatives = min_value < 0.0;
    let has_positives = max_value > 0.0;

    // Determine axis position (percentage 0-100)
    let axis = match data_bar.axis_position {
        CFDataBarAxisPosition::Midpoint => 50.0,
        CFDataBarAxisPosition::Automatic => {
            if has_negatives && has_positives {
                // Position axis proportionally
                let range = max_value - min_value;
                ((0.0 - min_value) / range) * 100.0
            } else if has_negatives && !has_positives {
                // All negative: axis at right
                100.0
            } else {
                0.0
            }
        }
        CFDataBarAxisPosition::None => 0.0,
    };

    // Clamp to [0, 100] to prevent NaN/Infinity propagation
    let axis = axis.clamp(0.0, 100.0);

    // Calculate fill percentage
    let fill_percent = if data_bar.axis_position == CFDataBarAxisPosition::None
        || (!has_negatives && !has_positives)
    {
        // Simple case: no axis
        let range = max_value - min_value;
        if range.abs() < 1e-12 {
            50.0 // All values identical -- show equal bars (will be clamped to min_length..max_length)
        } else {
            ((value - min_value) / range) * 100.0
        }
    } else if has_negatives && has_positives {
        // Mixed case: calculate relative to zero
        if value >= 0.0 {
            if max_value.abs() < 1e-12 {
                50.0 // All values identical -- show equal bars
            } else {
                (value / max_value) * (100.0 - axis)
            }
        } else if min_value.abs() < 1e-12 {
            50.0 // All values identical -- show equal bars
        } else {
            (value.abs() / min_value.abs()) * axis
        }
    } else if has_negatives {
        // All negative
        let range = min_value.abs();
        if range.abs() < 1e-12 {
            50.0 // All values identical -- show equal bars
        } else {
            // When axis is Midpoint, the bar only has the left half (axis%)
            // of the cell to render in. Scale accordingly.
            let available = if data_bar.axis_position == CFDataBarAxisPosition::Midpoint {
                axis
            } else {
                100.0
            };
            (value.abs() / range) * available
        }
    } else {
        // All positive or zero
        let range = max_value - min_value;
        if range.abs() < 1e-12 {
            50.0 // All values identical -- show equal bars
        } else {
            // When axis is Midpoint, the bar only has the right half (100 - axis)%
            // of the cell to render in. Scale accordingly.
            let available = if data_bar.axis_position == CFDataBarAxisPosition::Midpoint {
                100.0 - axis
            } else {
                100.0
            };
            ((value - min_value) / range) * available
        }
    };

    // Clamp to [0, 100]
    let fill_percent = fill_percent.clamp(0.0, 100.0);

    // Apply OOXML min/max bar length constraints.
    // Non-zero numeric values get at least min_length fill. In Excel, the
    // minimum value in an all-positive range still shows a small bar clamped
    // to min_length (10% by default). However, a zero-value cell sitting
    // exactly at the axis gets no bar (0% fill), not a min_length bar.
    let value_is_at_axis = value.abs() < 1e-12 && has_negatives && has_positives;
    let fill_percent = {
        let min_len = data_bar.min_length as f64;
        let max_len = data_bar.max_length as f64;
        if fill_percent < 1e-12 && value_is_at_axis {
            // Value is at or very near the axis -- no bar to show
            0.0
        } else {
            fill_percent.clamp(min_len, max_len)
        }
    };

    // Pick the bar color based on sign, respecting match-positive flags
    let color = if is_negative {
        if data_bar.match_positive_fill_color {
            positive_color
        } else {
            negative_color_parsed.unwrap_or(positive_color)
        }
    } else {
        positive_color
    };

    // Apply match_positive_border_color: when set, negative bars use the positive border color
    let negative_border_color_parsed = if data_bar.match_positive_border_color {
        // Mirror positive border color for negative bars
        border_color_parsed
    } else {
        negative_border_color_parsed
    };

    // show_axis: Midpoint always shows axis, Automatic only for mixed signs, None never
    let show_axis = match data_bar.axis_position {
        CFDataBarAxisPosition::None => false,
        CFDataBarAxisPosition::Midpoint => true,
        CFDataBarAxisPosition::Automatic => has_negatives && has_positives,
    };

    DataBarResult {
        fill_percent,
        color,
        gradient: data_bar.gradient,
        axis_position: axis,
        is_negative,
        negative_color: negative_color_parsed,
        show_value: data_bar.show_value,
        show_axis,
        border_color: border_color_parsed,
        negative_border_color: negative_border_color_parsed,
        show_border: data_bar.show_border,
        direction: data_bar.direction,
        axis_color: axis_color_parsed,
    }
}

#[cfg(test)]
#[path = "data_bar_tests.rs"]
mod tests;
