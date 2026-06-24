use super::*;
use crate::test_helpers::make_stats;
use value_types::Color;

use crate::types::{CFColorPoint, CFColorScale, CFValueType};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn make_color_point(value_type: CFValueType, value: Option<f64>, color: &str) -> CFColorPoint {
    CFColorPoint {
        value_type,
        value,
        color: Color::from_hex(color).unwrap(),
    }
}

// -----------------------------------------------------------------------
// lerp_color
// -----------------------------------------------------------------------

#[test]
fn test_lerp_color_t0() {
    let c1 = Color::rgb(255, 0, 0);
    let c2 = Color::rgb(0, 255, 0);
    assert_eq!(lerp_color(c1, c2, 0.0), Color::rgb(255, 0, 0));
}

#[test]
fn test_lerp_color_t1() {
    let c1 = Color::rgb(255, 0, 0);
    let c2 = Color::rgb(0, 255, 0);
    assert_eq!(lerp_color(c1, c2, 1.0), Color::rgb(0, 255, 0));
}

#[test]
fn test_lerp_color_midpoint() {
    let c1 = Color::rgb(0, 0, 0);
    let c2 = Color::rgb(255, 255, 255);
    let result = lerp_color(c1, c2, 0.5);
    assert_eq!(result, Color::rgb(128, 128, 128));
}

#[test]
fn test_lerp_color_quarter() {
    let c1 = Color::rgb(0, 0, 0);
    let c2 = Color::rgb(200, 100, 0);
    let result = lerp_color(c1, c2, 0.25);
    assert_eq!(result, Color::rgb(50, 25, 0));
}

#[test]
fn test_lerp_color_clamp_below_zero() {
    let c1 = Color::rgb(100, 100, 100);
    let c2 = Color::rgb(200, 200, 200);
    // t < 0 should clamp to 0 -> return c1
    assert_eq!(lerp_color(c1, c2, -0.5), Color::rgb(100, 100, 100));
}

#[test]
fn test_lerp_color_clamp_above_one() {
    let c1 = Color::rgb(100, 100, 100);
    let c2 = Color::rgb(200, 200, 200);
    // t > 1 should clamp to 1 -> return c2
    assert_eq!(lerp_color(c1, c2, 1.5), Color::rgb(200, 200, 200));
}

#[test]
fn test_lerp_color_alpha_channel() {
    let c1 = Color::rgba(255, 0, 0, 0);
    let c2 = Color::rgba(255, 0, 0, 255);
    let result = lerp_color(c1, c2, 0.5);
    assert_eq!(result, Color::rgba(255, 0, 0, 128));
}

// -----------------------------------------------------------------------
// resolve_color_point_value
// -----------------------------------------------------------------------

#[test]
fn test_resolve_min() {
    let stats = make_stats(&[1.0, 5.0, 10.0]);
    let point = make_color_point(CFValueType::Min, None, "#000000");
    assert_eq!(resolve_color_point_value(&point, &stats), 1.0);
}

#[test]
fn test_resolve_max() {
    let stats = make_stats(&[1.0, 5.0, 10.0]);
    let point = make_color_point(CFValueType::Max, None, "#000000");
    assert_eq!(resolve_color_point_value(&point, &stats), 10.0);
}

#[test]
fn test_resolve_number() {
    let stats = make_stats(&[1.0, 5.0, 10.0]);
    let point = make_color_point(CFValueType::Number, Some(42.0), "#000000");
    assert_eq!(resolve_color_point_value(&point, &stats), 42.0);
}

#[test]
fn test_resolve_number_no_value() {
    let stats = make_stats(&[1.0, 5.0, 10.0]);
    let point = make_color_point(CFValueType::Number, None, "#000000");
    assert_eq!(resolve_color_point_value(&point, &stats), 0.0);
}

#[test]
fn test_resolve_percent() {
    // stats: min=0, max=100
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let point = make_color_point(CFValueType::Percent, Some(50.0), "#000000");
    // 0 + (100 - 0) * 50 / 100 = 50
    assert_eq!(resolve_color_point_value(&point, &stats), 50.0);
}

#[test]
fn test_resolve_percent_nonzero_min() {
    // stats: min=10, max=110
    let stats = make_stats(&[10.0, 60.0, 110.0]);
    let point = make_color_point(CFValueType::Percent, Some(50.0), "#000000");
    // 10 + (110 - 10) * 50 / 100 = 10 + 50 = 60
    assert_eq!(resolve_color_point_value(&point, &stats), 60.0);
}

#[test]
fn test_resolve_percentile() {
    // sorted: [1, 2, 3, 4, 5]
    let stats = make_stats(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let point = make_color_point(CFValueType::Percentile, Some(50.0), "#000000");
    // percentile(&[1,2,3,4,5], 0.5) -> rank=0.5*4=2.0 -> sorted[2]=3.0
    assert_eq!(resolve_color_point_value(&point, &stats), 3.0);
}

#[test]
fn test_resolve_percentile_25() {
    let stats = make_stats(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let point = make_color_point(CFValueType::Percentile, Some(25.0), "#000000");
    // percentile(&[1,2,3,4,5], 0.25) -> rank=0.25*4=1.0 -> sorted[1]=2.0
    assert_eq!(resolve_color_point_value(&point, &stats), 2.0);
}

#[test]
fn test_resolve_formula_stub() {
    let stats = make_stats(&[1.0, 5.0, 10.0]);
    let point = make_color_point(CFValueType::Formula, Some(7.5), "#000000");
    // Formula stub just uses pre-parsed value
    assert_eq!(resolve_color_point_value(&point, &stats), 7.5);
}

// -----------------------------------------------------------------------
// compute_color_scale: 2-color
// -----------------------------------------------------------------------

#[test]
fn test_two_color_at_min() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    let result = compute_color_scale(0.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0));
}

#[test]
fn test_two_color_at_max() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    let result = compute_color_scale(100.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(0, 255, 0));
}

#[test]
fn test_two_color_at_midpoint() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#000000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#FFFFFF"),
    };

    let result = compute_color_scale(50.0, &cs, &stats);
    // t = (50 - 0) / (100 - 0) = 0.5
    // Each channel: 0 + (255 - 0) * 0.5 = 127.5 -> 128
    assert_eq!(result.color, Color::rgb(128, 128, 128));
}

#[test]
fn test_two_color_below_min() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    // value < min -> t < 0 -> clamped to 0 -> min color
    let result = compute_color_scale(-10.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0));
}

#[test]
fn test_two_color_above_max() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    // value > max -> t > 1 -> clamped to 1 -> max color
    let result = compute_color_scale(200.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(0, 255, 0));
}

// -----------------------------------------------------------------------
// compute_color_scale: equal min/max
// -----------------------------------------------------------------------

#[test]
fn test_equal_min_max_returns_max_color() {
    let stats = make_stats(&[5.0, 5.0, 5.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    let result = compute_color_scale(5.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(0, 255, 0)); // max color
}

// -----------------------------------------------------------------------
// compute_color_scale: 3-color
// -----------------------------------------------------------------------

#[test]
fn test_three_color_at_min() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: Some(make_color_point(
            CFValueType::Percentile,
            Some(50.0),
            "#FFFF00",
        )),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    let result = compute_color_scale(0.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0)); // min color
}

#[test]
fn test_three_color_at_mid() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: Some(make_color_point(
            CFValueType::Percentile,
            Some(50.0),
            "#FFFF00",
        )),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    // mid = percentile([0,50,100], 0.5) = 50
    let result = compute_color_scale(50.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 255, 0)); // mid color
}

#[test]
fn test_three_color_at_max() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: Some(make_color_point(
            CFValueType::Percentile,
            Some(50.0),
            "#FFFF00",
        )),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    let result = compute_color_scale(100.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(0, 255, 0)); // max color
}

#[test]
fn test_three_color_between_min_and_mid() {
    let stats = make_stats(&[0.0, 25.0, 50.0, 75.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"), // red
        mid_point: Some(make_color_point(
            CFValueType::Percentile,
            Some(50.0),
            "#FFFF00", // yellow
        )),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"), // green
    };

    // mid = percentile([0,25,50,75,100], 0.5) = 50
    // value=25, t = (25 - 0)/(50 - 0) = 0.5
    // lerp(red, yellow, 0.5) = [255, 128, 0, 255]
    let result = compute_color_scale(25.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 128, 0));
}

#[test]
fn test_three_color_between_mid_and_max() {
    let stats = make_stats(&[0.0, 25.0, 50.0, 75.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"), // red
        mid_point: Some(make_color_point(
            CFValueType::Percentile,
            Some(50.0),
            "#FFFF00", // yellow
        )),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"), // green
    };

    // mid = 50, value=75, t = (75 - 50)/(100 - 50) = 0.5
    // lerp(yellow, green, 0.5) = [128, 255, 0, 255]
    let result = compute_color_scale(75.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(128, 255, 0));
}

#[test]
fn test_three_color_equal_min_mid() {
    // When min == mid, value <= mid should produce t=0 (min color)
    let stats = make_stats(&[5.0, 5.0, 10.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: Some(make_color_point(CFValueType::Number, Some(5.0), "#FFFF00")),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    // min=5, mid=5, max=10, value=5 -> value <= mid -> t=0 (because min==mid)
    let result = compute_color_scale(5.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0)); // min color (t=0)
}

#[test]
fn test_three_color_equal_mid_max() {
    // When mid == max, value > mid should produce t=1 (max color)
    let stats = make_stats(&[0.0, 10.0, 10.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: Some(make_color_point(CFValueType::Number, Some(10.0), "#FFFF00")),
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };

    // min=0, mid=10, max=10, value=10 -> value <= mid -> normal interpolation
    // t = (10 - 0)/(10 - 0) = 1.0
    let result = compute_color_scale(10.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 255, 0)); // mid color (t=1 in min->mid)
}

// -----------------------------------------------------------------------
// compute_color_scale: with Number value type points
// -----------------------------------------------------------------------

#[test]
fn test_two_color_number_points() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Number, Some(20.0), "#000000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Number, Some(80.0), "#FFFFFF"),
    };

    // min_val=20, max_val=80, value=50
    // t = (50-20)/(80-20) = 30/60 = 0.5
    let result = compute_color_scale(50.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(128, 128, 128));
}

// -----------------------------------------------------------------------
// compute_color_scale: with Percent value type points
// -----------------------------------------------------------------------

#[test]
fn test_two_color_percent_points() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Percent, Some(10.0), "#000000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Percent, Some(90.0), "#FFFFFF"),
    };

    // min_val = 0 + (100 - 0)*10/100 = 10
    // max_val = 0 + (100 - 0)*90/100 = 90
    // value=50, t = (50-10)/(90-10) = 40/80 = 0.5
    let result = compute_color_scale(50.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(128, 128, 128));
}

// -----------------------------------------------------------------------
// NaN / Infinity handling
// -----------------------------------------------------------------------

#[test]
fn test_lerp_color_nan_t() {
    let c1 = Color::rgb(255, 0, 0);
    let c2 = Color::rgb(0, 255, 0);
    // NaN t should be treated as 0.0 -> return c1
    assert_eq!(lerp_color(c1, c2, f64::NAN), Color::rgb(255, 0, 0));
}

#[test]
fn test_lerp_color_infinity_t() {
    let c1 = Color::rgb(255, 0, 0);
    let c2 = Color::rgb(0, 255, 0);
    // +Infinity t should be treated as 0.0 -> return c1
    assert_eq!(lerp_color(c1, c2, f64::INFINITY), Color::rgb(255, 0, 0));
}

#[test]
fn test_lerp_color_neg_infinity_t() {
    let c1 = Color::rgb(255, 0, 0);
    let c2 = Color::rgb(0, 255, 0);
    // -Infinity t should be treated as 0.0 -> return c1
    assert_eq!(lerp_color(c1, c2, f64::NEG_INFINITY), Color::rgb(255, 0, 0));
}

#[test]
fn test_compute_color_scale_nan_value() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };
    // NaN value should return min color as safe fallback
    let result = compute_color_scale(f64::NAN, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0));
}

#[test]
fn test_compute_color_scale_infinity_value() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };
    // Infinity value should return min color as safe fallback
    let result = compute_color_scale(f64::INFINITY, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0));
}

#[test]
fn test_compute_color_scale_neg_infinity_value() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"),
        mid_point: None,
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"),
    };
    // -Infinity value should return min color as safe fallback
    let result = compute_color_scale(f64::NEG_INFINITY, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 0, 0));
}

// -----------------------------------------------------------------------
// All negative values
// -----------------------------------------------------------------------

#[test]
fn test_all_negative_values() {
    // Color scale with all negative values: [-100, -50, -10]
    // Should still interpolate correctly
    let stats = make_stats(&[-100.0, -50.0, -10.0]);
    let cs = CFColorScale {
        min_point: CFColorPoint {
            value_type: CFValueType::Min,
            value: None,
            color: Color::from_hex("#FF0000").unwrap(),
        },
        mid_point: None,
        max_point: CFColorPoint {
            value_type: CFValueType::Max,
            value: None,
            color: Color::from_hex("#00FF00").unwrap(),
        },
    };
    let result = compute_color_scale(-50.0, &cs, &stats);
    // -50 is at 50/90 ~ 55.6% of the way from -100 to -10
    // Should produce a color between red and green
    assert_ne!(result.color, Color::rgb(255, 0, 0)); // not pure red
    assert_ne!(result.color, Color::rgb(0, 255, 0)); // not pure green
}

// -----------------------------------------------------------------------
// Three-color scale where mid == max (t=1.0 fallback in upper half)
// -----------------------------------------------------------------------

#[test]
fn test_three_color_mid_equals_max() {
    // When the midpoint equals the max value, any value above mid falls into the
    // upper half (mid -> max interpolation). Since mid_val == max_val, the
    // denominator is zero and the code falls back to t=1.0 -> max color.
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Min, None, "#FF0000"), // red
        mid_point: Some(make_color_point(
            CFValueType::Number,
            Some(100.0),
            "#FFFF00",
        )), // yellow at value=100
        max_point: make_color_point(CFValueType::Max, None, "#00FF00"), // green
    };

    // min=0, mid=100, max=100
    // value=100: value <= mid (100 <= 100), so interpolate min->mid: t = (100-0)/(100-0) = 1.0
    // lerp(red, yellow, 1.0) = yellow
    let result = compute_color_scale(100.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 255, 0)); // yellow (mid color)

    // Value between min and mid: value=50 -> t = (50-0)/(100-0) = 0.5
    // lerp(red, yellow, 0.5) = (255, 128, 0)
    let result = compute_color_scale(50.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 128, 0));
}

#[test]
fn test_three_color_value_above_mid_when_mid_equals_max() {
    // Edge case: value > mid when mid == max. This triggers the t=1.0 fallback
    // in the upper half (line 122 in color_scale.rs).
    // We need min != max so we don't hit the early return for identical values.
    // Use Number-type midpoint equal to a value less than max.
    // Actually, we need mid_val == max_val but min_val != max_val.
    // Set mid = max = 100, min = 0.
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let cs = CFColorScale {
        min_point: make_color_point(CFValueType::Number, Some(0.0), "#FF0000"), // red
        mid_point: Some(make_color_point(
            CFValueType::Number,
            Some(100.0),
            "#FFFF00",
        )), // yellow
        max_point: make_color_point(CFValueType::Number, Some(100.0), "#00FF00"), // green
    };

    // value=100: value <= mid (100 <= 100) -> lower half: t=(100-0)/(100-0)=1.0 -> mid color
    let result = compute_color_scale(100.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(255, 255, 0)); // yellow

    // value=101 (above mid AND above max): value > mid -> upper half
    // t = (101 - 100) / (100 - 100) -> division by zero -> fallback t=1.0
    // lerp(yellow, green, 1.0) = green
    let result = compute_color_scale(101.0, &cs, &stats);
    assert_eq!(result.color, Color::rgb(0, 255, 0)); // green (max color via t=1.0 fallback)
}
