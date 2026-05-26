//! Icon set threshold mapping.
//!
//! Rust port of `computeIconIndex` from
//! `spreadsheet-model/src/conditional-format/color-scale.ts` (lines 391-429).

use crate::stats::{RangeStatistics, percentile};
use crate::types::{
    CFIconSet, CFIconThreshold, CFIconThresholdOperator, CFValueType, CustomIcon, IconResult,
};

// =============================================================================
// Threshold value resolution
// =============================================================================

/// Resolve the numeric threshold value for icon set comparison.
///
/// This intentionally differs from `color_scale::resolve_color_point_value`:
/// - `Percent` returns the raw threshold value (e.g. 33.0) because icon set
///   comparison is done against a percentile position in [0, 100], not against
///   an absolute data value resolved from the range.
/// - `Percentile` resolves to an actual data percentile then converts back
///   to the [0, 100] scale for the same reason.
fn resolve_icon_threshold_value(threshold: &CFIconThreshold, stats: &RangeStatistics) -> f64 {
    match threshold.value_type {
        CFValueType::Min => 0.0,   // Min is at the 0th percentile position
        CFValueType::Max => 100.0, // Max is at the 100th percentile position
        CFValueType::Number | CFValueType::Formula => threshold.value.unwrap_or(0.0),
        CFValueType::Percent => {
            // Percent thresholds are compared against the percentile value directly.
            // The TypeScript code computes percentile = (value - min) / (max - min) * 100
            // and then compares against threshold values. So "percent" thresholds are
            // used directly as a number in [0, 100] to compare against the percentile.
            threshold.value.unwrap_or(0.0)
        }
        CFValueType::Percentile => {
            // For percentile thresholds, resolve to an actual data percentile value,
            // then convert back to a position in [0, 100] range for comparison.
            let ptile = threshold.value.unwrap_or(0.0);
            let actual_value = percentile(&stats.sorted_values, ptile / 100.0);
            // Convert back to the [0, 100] scale that the percentile comparison uses
            if (stats.max - stats.min).abs() < 1e-12 {
                50.0
            } else {
                ((actual_value - stats.min) / (stats.max - stats.min)) * 100.0
            }
        }
    }
}

// =============================================================================
// Icon set computation
// =============================================================================

/// Compute which icon to display for a value.
///
/// Faithfully ported from `computeIconIndex` in color-scale.ts (lines 391-429).
///
/// Key logic:
/// - Convert value to percentile position: (value - min) / (max - min) * 100
///   (or 50 if min == max)
/// - Walk thresholds from highest to lowest
/// - Compare percentile against threshold value using the threshold's operator (>= or >)
/// - Icon index: higher values get lower indices (0 = "best" icon)
/// - If reverse_order: flip the index
pub fn compute_icon(
    value: f64,
    icon_set: &CFIconSet,
    stats: &RangeStatistics,
) -> Option<IconResult> {
    let n_thresholds = icon_set.thresholds.len();
    if n_thresholds > 10 {
        // Malformed input: icon sets have at most 4 thresholds (5 icons)
        return None;
    }

    // Validate threshold count matches icon set expectation
    let expected_icons = icon_set.icon_set_name.icon_count();
    let actual_icons = n_thresholds + 1;
    if expected_icons > 0 && actual_icons != expected_icons {
        // Malformed input: threshold count doesn't match icon set.
        // Fall back to using expected count from the set name if thresholds are fewer,
        // or actual count if thresholds exceed expectation.
        // For safety, return None to avoid rendering incorrect icons.
        return None;
    }

    // Guard: non-finite values get the worst icon (safe fallback)
    if !value.is_finite() {
        let icon_count = (n_thresholds + 1) as u8;
        let mut icon_index = icon_count - 1; // worst icon
        if icon_set.reverse_order {
            icon_index = icon_count - 1 - icon_index; // = 0
        }
        return Some(IconResult {
            set_name: icon_set.icon_set_name,
            icon_index,
            show_value: !icon_set.show_icon_only,
        });
    }
    let icon_count = (n_thresholds + 1) as u8;

    // Convert value to percentile position in [0, 100]
    let pctile = if (stats.max - stats.min).abs() < 1e-12 {
        50.0 // Middle value if all same
    } else {
        ((value - stats.min) / (stats.max - stats.min)) * 100.0
    };

    // Find which bucket the value falls into.
    // Icons are numbered 0 to icon_count-1, where 0 is the "best" icon.
    // Walk thresholds from highest index to lowest; the first match determines
    // the icon. For a 3-icon/2-threshold set [33, 67]:
    //   pctile >= 67 (i=1) -> icon 0 (best)
    //   pctile >= 33 (i=0) -> icon 1 (middle)
    //   no match            -> icon 2 (worst)
    let mut icon_index: u8 = 0;
    let mut matched_custom_icon: Option<CustomIcon> = None;

    for i in (0..n_thresholds).rev() {
        let threshold = &icon_set.thresholds[i];
        let threshold_value = resolve_icon_threshold_value(threshold, stats);

        // Number-type thresholds compare against the raw cell value;
        // Percent/Percentile types compare against the percentile position.
        let cell_metric = match threshold.value_type {
            CFValueType::Number => value,
            _ => pctile,
        };

        let passes = match threshold.operator {
            CFIconThresholdOperator::GreaterThanOrEqual => cell_metric >= threshold_value,
            CFIconThresholdOperator::GreaterThan => cell_metric > threshold_value,
        };

        if passes {
            // Highest threshold (i = n_thresholds-1) -> icon 0 (best),
            // next lower threshold -> icon 1, etc.
            icon_index = (n_thresholds - 1 - i) as u8;
            matched_custom_icon = threshold.custom_icon;
            break;
        }
        // If no threshold matched yet, assign worst icon
        icon_index = icon_count - 1;
    }

    // Ensure index is in bounds
    icon_index = icon_index.min(icon_count - 1);

    // Reverse if requested
    if icon_set.reverse_order {
        icon_index = icon_count - 1 - icon_index;
    }

    // If the matching threshold has a custom icon, use that instead
    if let Some(custom) = matched_custom_icon {
        return Some(IconResult {
            set_name: custom.icon_set,
            icon_index: custom.icon_index,
            show_value: !icon_set.show_icon_only,
        });
    }

    Some(IconResult {
        set_name: icon_set.icon_set_name,
        icon_index,
        show_value: !icon_set.show_icon_only,
    })
}

#[cfg(test)]
#[path = "icon_set_tests.rs"]
mod tests;
