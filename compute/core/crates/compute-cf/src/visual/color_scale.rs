//! Color scale interpolation (2-color and 3-color).
//!
//! Ported from TypeScript: `spreadsheet-model/src/conditional-format/color-scale.ts`
//! Provides linear interpolation in RGBA space, color point
//! resolution, and the main `compute_color_scale` entry point.

use value_types::Color;

use crate::stats::{RangeStatistics, percentile};
use crate::types::{CFColorPoint, CFColorScale, CFValueType, ColorScaleResult};

// =============================================================================
// Color Interpolation
// =============================================================================

/// Linear interpolation between two RGBA colors.
///
/// `t` is clamped to [0, 1]. Each channel is interpolated independently
/// and rounded to the nearest integer.
pub fn lerp_color(c1: Color, c2: Color, t: f64) -> Color {
    let t = if t.is_finite() {
        t.clamp(0.0, 1.0)
    } else {
        0.0
    };

    let lerp_channel = |a: u8, b: u8| -> u8 {
        let result = a as f64 + (b as f64 - a as f64) * t;
        result.round().clamp(0.0, 255.0) as u8
    };

    Color::rgba(
        lerp_channel(c1.r(), c2.r()),
        lerp_channel(c1.g(), c2.g()),
        lerp_channel(c1.b(), c2.b()),
        lerp_channel(c1.a(), c2.a()),
    )
}

// =============================================================================
// Color Point Value Resolution
// =============================================================================

/// Resolve a color point's numeric value based on its type and range statistics.
///
/// Mirrors the TypeScript `resolveColorPointValue`:
/// - `Min` -> `stats.min`
/// - `Max` -> `stats.max`
/// - `Number` / `Formula` -> `point.value` (pre-parsed f64, or 0.0)
/// - `Percent` -> `stats.min + (stats.max - stats.min) * pct / 100.0`
/// - `Percentile` -> `percentile(&stats.sorted_values, pct / 100.0)`
pub(crate) fn resolve_color_point_value(point: &CFColorPoint, stats: &RangeStatistics) -> f64 {
    match point.value_type {
        CFValueType::Min => stats.min,
        CFValueType::Max => stats.max,
        CFValueType::Number | CFValueType::Formula => point.value.unwrap_or(0.0),
        CFValueType::Percent => {
            let pct = point.value.unwrap_or(0.0);
            stats.min + (stats.max - stats.min) * pct / 100.0
        }
        CFValueType::Percentile => {
            let ptile = point.value.unwrap_or(0.0);
            percentile(&stats.sorted_values, ptile / 100.0)
        }
    }
}

// =============================================================================
// Color Scale Computation
// =============================================================================

/// Compute the color scale result for a numeric value.
///
/// Supports both 2-color and 3-color scales. Mirrors the TypeScript
/// `computeColorScaleColor` function.
///
/// - Resolves min/max (and optionally mid) color point values.
/// - If min == max, returns the max color directly.
/// - For 3-color scales: interpolates min->mid or mid->max depending on
///   which half the value falls in.
/// - For 2-color scales: interpolates min->max.
/// - `t` is clamped to [0, 1] before interpolation.
pub fn compute_color_scale(
    value: f64,
    color_scale: &CFColorScale,
    stats: &RangeStatistics,
) -> ColorScaleResult {
    let min_color = color_scale.min_point.color;
    let max_color = color_scale.max_point.color;
    let mid_color = color_scale.mid_point.as_ref().map(|mp| mp.color);

    // Guard: non-finite values get the min color (safe fallback)
    if !value.is_finite() {
        return ColorScaleResult { color: min_color };
    }
    let min_val = resolve_color_point_value(&color_scale.min_point, stats);
    let max_val = resolve_color_point_value(&color_scale.max_point, stats);

    // Excel resolves singleton color-scale ranges to the max color.
    if (max_val - min_val).abs() < 1e-12 {
        return ColorScaleResult { color: max_color };
    }

    // 3-color scale
    if let (Some(mid_point), Some(mid_c)) = (&color_scale.mid_point, mid_color) {
        let mid_val = resolve_color_point_value(mid_point, stats);

        if value <= mid_val {
            // Interpolate between min and mid
            let t = if (mid_val - min_val).abs() < 1e-12 {
                0.0
            } else {
                (value - min_val) / (mid_val - min_val)
            };
            let t = t.clamp(0.0, 1.0);
            return ColorScaleResult {
                color: lerp_color(min_color, mid_c, t),
            };
        } else {
            // Interpolate between mid and max
            let t = if (max_val - mid_val).abs() < 1e-12 {
                1.0
            } else {
                (value - mid_val) / (max_val - mid_val)
            };
            let t = t.clamp(0.0, 1.0);
            return ColorScaleResult {
                color: lerp_color(mid_c, max_color, t),
            };
        }
    }

    // 2-color scale
    let t = ((value - min_val) / (max_val - min_val)).clamp(0.0, 1.0);
    ColorScaleResult {
        color: lerp_color(min_color, max_color, t),
    }
}

#[cfg(test)]
#[path = "color_scale_tests.rs"]
mod tests;
