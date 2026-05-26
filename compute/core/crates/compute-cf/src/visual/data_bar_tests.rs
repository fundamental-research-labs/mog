use super::*;
use crate::test_helpers::make_stats;
use value_types::Color;

use crate::types::{
    CFColorPoint, CFDataBar, CFDataBarAxisPosition, CFDataBarDirection, CFValueType,
};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/// Build a simple data bar config with min/max auto-detect.
fn make_data_bar(
    axis_position: CFDataBarAxisPosition,
    positive_color: &str,
    negative_color: Option<&str>,
) -> CFDataBar {
    CFDataBar {
        min_point: CFColorPoint {
            value_type: CFValueType::Min,
            value: None,
            color: Color::BLACK,
        },
        max_point: CFColorPoint {
            value_type: CFValueType::Max,
            value: None,
            color: Color::BLACK,
        },
        positive_color: Color::from_hex(positive_color).unwrap(),
        negative_color: negative_color.map(|s| Color::from_hex(s).unwrap()),
        border_color: None,
        negative_border_color: None,
        show_border: false,
        gradient: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_position,
        axis_color: None,
        show_value: true,
        min_length: 10,
        max_length: 90,
        match_positive_fill_color: false,
        match_positive_border_color: false,
    }
}

// -----------------------------------------------------------------------
// All positive values: simple fill
// -----------------------------------------------------------------------

#[test]
fn test_all_positive_simple_fill() {
    let stats = make_stats(&[10.0, 20.0, 30.0, 40.0, 50.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    // value=10 (min) -> raw fill=0% -> clamped to min_length=10%
    let r = compute_data_bar(10.0, &db, &stats);
    assert!(
        (r.fill_percent - 10.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
    assert!(!r.is_negative);

    // value=30 (middle) -> fill=50%
    let r = compute_data_bar(30.0, &db, &stats);
    assert!((r.fill_percent - 50.0).abs() < 1e-10);

    // value=50 (max) -> fill=100% clamped to max_length=90%
    let r = compute_data_bar(50.0, &db, &stats);
    assert!((r.fill_percent - 90.0).abs() < 1e-10);
}

// -----------------------------------------------------------------------
// All negative values: fill from right
// -----------------------------------------------------------------------

#[test]
fn test_all_negative_fill_from_right() {
    let stats = make_stats(&[-50.0, -40.0, -30.0, -20.0, -10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    // Axis should be at 100% (right edge)
    let r = compute_data_bar(-50.0, &db, &stats);
    assert!((r.axis_position - 100.0).abs() < 1e-10);
    assert!(r.is_negative);
    // -50 is the most negative -> fill=100% clamped to max_length=90%
    assert!((r.fill_percent - 90.0).abs() < 1e-10);

    // -10 is the least negative -> fill = 10/50 * 100 = 20%, within [10,90]
    let r = compute_data_bar(-10.0, &db, &stats);
    assert!(
        (r.fill_percent - 20.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
    assert!(r.is_negative);
}

// -----------------------------------------------------------------------
// Mixed positive/negative: axis positioning
// -----------------------------------------------------------------------

#[test]
fn test_mixed_signs_axis_positioning() {
    let stats = make_stats(&[-20.0, -10.0, 0.0, 10.0, 20.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    // Range = 20 - (-20) = 40, axis = (0 - (-20))/40 * 100 = 50%
    let r = compute_data_bar(10.0, &db, &stats);
    assert!((r.axis_position - 50.0).abs() < 1e-10);
    assert!(!r.is_negative);
    // positive fill: value/maxValue * (100 - axis) = 10/20 * 50 = 25%
    assert!((r.fill_percent - 25.0).abs() < 1e-10);

    // Negative value
    let r = compute_data_bar(-10.0, &db, &stats);
    assert!(r.is_negative);
    // negative fill: |value|/|minValue| * axis = 10/20 * 50 = 25%
    assert!((r.fill_percent - 25.0).abs() < 1e-10);
}

// -----------------------------------------------------------------------
// Midpoint axis
// -----------------------------------------------------------------------

#[test]
fn test_midpoint_axis() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Midpoint, "#638EC6", None);

    let r = compute_data_bar(20.0, &db, &stats);
    assert!((r.axis_position - 50.0).abs() < 1e-10);
}

#[test]
fn test_midpoint_axis_positive_only_fill() {
    // With Midpoint axis at 50%, positive bars only have the right half (50%) of
    // the cell. Fill should be scaled to that half.
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Midpoint, "#638EC6", None);

    // value=30 (max): raw fill = ((30-10)/(30-10)) * 50 = 50% -> within [10, 90]
    let r = compute_data_bar(30.0, &db, &stats);
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "max value with midpoint axis should fill 50%, got {}",
        r.fill_percent
    );

    // value=20 (middle): raw fill = ((20-10)/(30-10)) * 50 = 25% -> within [10, 90]
    let r = compute_data_bar(20.0, &db, &stats);
    assert!(
        (r.fill_percent - 25.0).abs() < 1e-10,
        "middle value with midpoint axis should fill 25%, got {}",
        r.fill_percent
    );

    // value=10 (min): raw fill = ((10-10)/(30-10)) * 50 = 0% -> clamped to min_length=10%
    let r = compute_data_bar(10.0, &db, &stats);
    assert!(
        (r.fill_percent - 10.0).abs() < 1e-10,
        "min value with midpoint axis should be clamped to min_length=10%, got {}",
        r.fill_percent
    );
}

#[test]
fn test_midpoint_axis_negative_only_fill() {
    // With Midpoint axis at 50%, negative bars only have the left half (50%) of
    // the cell. Fill should be scaled to that half.
    let stats = make_stats(&[-30.0, -20.0, -10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Midpoint, "#638EC6", Some("#FF0000"));

    // value=-30 (most negative, |min_value|=30): raw fill = (30/30) * 50 = 50%
    let r = compute_data_bar(-30.0, &db, &stats);
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "most negative value with midpoint axis should fill 50%, got {}",
        r.fill_percent
    );
    assert!(r.is_negative);

    // value=-15: raw fill = (15/30) * 50 = 25%
    let r = compute_data_bar(-15.0, &db, &stats);
    assert!(
        (r.fill_percent - 25.0).abs() < 1e-10,
        "mid-negative value with midpoint axis should fill 25%, got {}",
        r.fill_percent
    );
    assert!(r.is_negative);

    // value=-10 (least negative): raw fill = (10/30) * 50 = 16.67%
    let r = compute_data_bar(-10.0, &db, &stats);
    let expected = (10.0 / 30.0) * 50.0; // ~16.67%
    assert!(
        (r.fill_percent - expected).abs() < 1e-10,
        "least negative value with midpoint axis should fill ~16.67%, got {}",
        r.fill_percent
    );
    assert!(r.is_negative);
}

// -----------------------------------------------------------------------
// None axis
// -----------------------------------------------------------------------

#[test]
fn test_none_axis() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(20.0, &db, &stats);
    assert!((r.axis_position - 0.0).abs() < 1e-10);
    // Simple fill: (20-10)/(30-10)*100 = 50%
    assert!((r.fill_percent - 50.0).abs() < 1e-10);
    // show_axis should be false when axis_position is None and no mixed signs
    assert!(!r.show_axis);
}

// -----------------------------------------------------------------------
// Zero value
// -----------------------------------------------------------------------

#[test]
fn test_zero_value() {
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    let r = compute_data_bar(0.0, &db, &stats);
    assert!(!r.is_negative);
    // value=0, raw fill = 0/10 * (100-50) = 0% -> zero sits at the axis, no bar
    assert!(
        (r.fill_percent - 0.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// Small positive value still gets clamped to min_length
// -----------------------------------------------------------------------

#[test]
fn test_small_positive_value_clamped_to_min_length() {
    // A small but non-zero positive value in a mixed range should still get
    // clamped up to min_length, unlike a true zero which gets no bar.
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    // value=1: raw fill = 1/10 * (100-50) = 5% -> clamped to min_length=10%
    let r = compute_data_bar(1.0, &db, &stats);
    assert!(!r.is_negative);
    assert!(
        (r.fill_percent - 10.0).abs() < 1e-10,
        "small positive value should be clamped to min_length=10%, got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// Equal min/max
// -----------------------------------------------------------------------

#[test]
fn test_equal_min_max() {
    let stats = make_stats(&[5.0, 5.0, 5.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(5.0, &db, &stats);
    // range=0 -> 50% midpoint -> clamped to [min_length, max_length] = 50%
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// Color parsing in result
// -----------------------------------------------------------------------

#[test]
fn test_color_selection() {
    let stats = make_stats(&[-10.0, 10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", Some("#FF0000"));

    // Positive value -> positive color
    let r = compute_data_bar(10.0, &db, &stats);
    assert_eq!(r.color, Color::rgb(0x00, 0xFF, 0x00));

    // Negative value -> negative color
    let r = compute_data_bar(-10.0, &db, &stats);
    assert_eq!(r.color, Color::rgb(0xFF, 0x00, 0x00));
    assert_eq!(r.negative_color, Some(Color::rgb(0xFF, 0x00, 0x00)));
}

// -----------------------------------------------------------------------
// Gradient and show_value passthrough
// -----------------------------------------------------------------------

#[test]
fn test_gradient_and_show_value() {
    let stats = make_stats(&[1.0, 2.0, 3.0]);
    let mut db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);
    db.gradient = true;
    db.show_value = false;

    let r = compute_data_bar(2.0, &db, &stats);
    assert!(r.gradient);
    assert!(!r.show_value);
}

// -----------------------------------------------------------------------
// show_axis logic
// -----------------------------------------------------------------------

#[test]
fn test_show_axis_mixed_signs_none_position() {
    // axis_position=None always hides axis, even with mixed signs
    let stats = make_stats(&[-5.0, 5.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(5.0, &db, &stats);
    assert!(!r.show_axis);
}

#[test]
fn test_show_axis_automatic() {
    // Automatic with all-positive values: no axis
    let stats = make_stats(&[10.0, 20.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(15.0, &db, &stats);
    assert!(!r.show_axis);
}

#[test]
fn test_show_axis_automatic_mixed_signs() {
    // Automatic with mixed signs: show axis
    let stats = make_stats(&[-5.0, 5.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(5.0, &db, &stats);
    assert!(r.show_axis);
}

// -----------------------------------------------------------------------
// NaN / Infinity handling
// -----------------------------------------------------------------------

#[test]
fn test_nan_value_returns_zero_fill() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(f64::NAN, &db, &stats);
    assert!((r.fill_percent - 0.0).abs() < 1e-10);
    assert!(!r.is_negative);
    assert!(!r.show_axis);
}

#[test]
fn test_infinity_value_returns_zero_fill() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(f64::INFINITY, &db, &stats);
    assert!((r.fill_percent - 0.0).abs() < 1e-10);
    assert!(!r.is_negative);
}

#[test]
fn test_neg_infinity_value_returns_zero_fill() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(f64::NEG_INFINITY, &db, &stats);
    assert!((r.fill_percent - 0.0).abs() < 1e-10);
    assert!(!r.is_negative);
}

// -----------------------------------------------------------------------
// Negative value with absent negative_color
// -----------------------------------------------------------------------

#[test]
fn test_negative_value_no_negative_color() {
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", None);

    let r = compute_data_bar(-5.0, &db, &stats);
    assert!(r.is_negative);
    // With no negative_color, should fall back to positive_color
    assert_eq!(r.color, Color::rgb(0x00, 0xFF, 0x00));
    assert!(r.negative_color.is_none());
}

// -----------------------------------------------------------------------
// Single-value range (min == max == value)
// -----------------------------------------------------------------------

#[test]
fn test_single_value_range() {
    let stats = make_stats(&[42.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(42.0, &db, &stats);
    // min == max, so range = 0 -> 50% midpoint -> clamped to [10, 90] = 50%
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// Value outside range (clamping)
// -----------------------------------------------------------------------

#[test]
fn test_value_below_min_clamps_to_min_length() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(5.0, &db, &stats);
    // 5 < min(10), fill = (5-10)/(30-10)*100 = -25% -> clamped to 0% -> clamped to min_length=10%
    assert!(
        (r.fill_percent - 10.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

#[test]
fn test_value_above_max_clamps_to_max_length() {
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(50.0, &db, &stats);
    // 50 > max(30), fill = (50-10)/(30-10)*100 = 200% -> clamped to 100% -> then to max_length=90%
    assert!(
        (r.fill_percent - 90.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// min_length / max_length clamping
// -----------------------------------------------------------------------

#[test]
fn test_min_length_clamp() {
    // A very small positive value in a large range should get clamped to min_length.
    // value=1 in range [0, 1000]: raw fill = (1-0)/(1000-0)*100 = 0.1% -> clamped to 10%
    let stats = make_stats(&[0.0, 500.0, 1000.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(1.0, &db, &stats);
    assert!(
        r.fill_percent >= 10.0,
        "expected fill_percent >= min_length(10), got {}",
        r.fill_percent
    );
    assert!(
        (r.fill_percent - 10.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

#[test]
fn test_max_length_clamp() {
    // The maximum value should get clamped to max_length (90%).
    let stats = make_stats(&[10.0, 50.0, 100.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(100.0, &db, &stats);
    assert!(
        r.fill_percent <= 90.0,
        "expected fill_percent <= max_length(90), got {}",
        r.fill_percent
    );
    assert!(
        (r.fill_percent - 90.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

#[test]
fn test_equal_values_show_bar() {
    // When all values are the same, bars should still be visible
    // (not 0% which would be invisible).
    let stats = make_stats(&[50.0, 50.0, 50.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", None);

    let r = compute_data_bar(50.0, &db, &stats);
    assert!(
        r.fill_percent > 0.0,
        "equal values should show a bar, got fill_percent={}",
        r.fill_percent
    );
    // Should be 50% (midpoint) since it's within [10, 90]
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

#[test]
fn test_custom_min_max_length() {
    // Custom min_length=20, max_length=80.
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let mut db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);
    db.min_length = 20;
    db.max_length = 80;

    // Very small fill (1%) -> clamped to 20%
    let r = compute_data_bar(1.0, &db, &stats);
    assert!(
        (r.fill_percent - 20.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );

    // Full fill (100%) -> clamped to 80%
    let r = compute_data_bar(100.0, &db, &stats);
    assert!(
        (r.fill_percent - 80.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );

    // Mid-range fill (50%) -> stays at 50% (within [20, 80])
    let r = compute_data_bar(50.0, &db, &stats);
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "got {}",
        r.fill_percent
    );
}

#[test]
fn test_border_color_passthrough() {
    // Verify border_color, negative_border_color, and axis_color are passed through correctly.
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let mut db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", Some("#FF0000"));
    db.border_color = Some(Color::from_hex("#0000FF").unwrap());
    db.negative_border_color = Some(Color::from_hex("#FFFF00").unwrap());
    db.axis_color = Some(Color::from_hex("#808080").unwrap());
    db.show_border = true;

    let r = compute_data_bar(5.0, &db, &stats);
    assert_eq!(r.border_color, Some(Color::rgb(0x00, 0x00, 0xFF)));
    assert_eq!(r.negative_border_color, Some(Color::rgb(0xFF, 0xFF, 0x00)));
    assert_eq!(r.axis_color, Some(Color::rgb(0x80, 0x80, 0x80)));
    assert!(r.show_border);

    // Negative value should also get border colors
    let r = compute_data_bar(-5.0, &db, &stats);
    assert_eq!(r.border_color, Some(Color::rgb(0x00, 0x00, 0xFF)));
    assert_eq!(r.negative_border_color, Some(Color::rgb(0xFF, 0xFF, 0x00)));
    assert_eq!(r.axis_color, Some(Color::rgb(0x80, 0x80, 0x80)));
}

#[test]
fn test_min_value_clamped_to_min_length() {
    // In Excel, the minimum value in a range still shows a small bar clamped
    // to min_length (10% by default). All numeric values get at least min_length.
    let stats = make_stats(&[10.0, 20.0, 30.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(10.0, &db, &stats);
    assert!(
        (r.fill_percent - 10.0).abs() < 1e-10,
        "expected min_length(10), got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// All identical values with axis_position = None -> 50% fill
// -----------------------------------------------------------------------

#[test]
fn test_all_identical_values_no_axis() {
    // In Excel, when all values are identical and axis_position is None,
    // range == 0 so the data bar falls back to 50% fill for each cell.
    let stats = make_stats(&[5.0, 5.0, 5.0]);
    let db = make_data_bar(CFDataBarAxisPosition::None, "#638EC6", None);

    let r = compute_data_bar(5.0, &db, &stats);
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "all identical with no axis should give 50% fill, got {}",
        r.fill_percent
    );
    assert!(!r.is_negative);
}

// -----------------------------------------------------------------------
// Mixed signs with max near zero
// -----------------------------------------------------------------------

#[test]
fn test_mixed_signs_max_near_zero() {
    // Range: [-10, -5, 0.0001]. max_value is barely positive, min_value = -10.
    // Automatic axis: axis = (0 - (-10)) / (0.0001 - (-10)) * 100 ≈ 99.999%
    // This tests the edge case where max is near zero.
    let stats = make_stats(&[-10.0, -5.0, 0.0001]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    // A positive value of 0.0001 should produce a very small bar in the positive region
    let r = compute_data_bar(0.0001, &db, &stats);
    assert!(!r.is_negative);
    assert!(
        r.fill_percent > 0.0,
        "tiny positive value should show some bar"
    );
    assert!(r.show_axis, "mixed signs should show axis");

    // Negative value: -5 should produce a negative bar
    let r = compute_data_bar(-5.0, &db, &stats);
    assert!(r.is_negative);
    assert!(r.fill_percent > 0.0);
}

#[test]
fn test_mixed_signs_min_near_zero() {
    // Range: [-0.0001, 5, 10]. min_value is barely negative.
    // Tests edge case where min is near zero in a mixed-sign range.
    let stats = make_stats(&[-0.0001, 5.0, 10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    let r = compute_data_bar(-0.0001, &db, &stats);
    assert!(r.is_negative);
    assert!(r.show_axis, "mixed signs should show axis");
}

// -----------------------------------------------------------------------
// All negative identical values -> 50% fill
// -----------------------------------------------------------------------

#[test]
fn test_all_negative_identical_values() {
    // When all values are the same negative value (e.g., -3), the min_value.abs() = 3
    // and each bar gets fill = |value| / |min_value| * 100 = 100%, clamped to max_length.
    let stats = make_stats(&[-3.0, -3.0, -3.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    let r = compute_data_bar(-3.0, &db, &stats);
    assert!(r.is_negative);
    assert!(
        (r.fill_percent - 90.0).abs() < 1e-10,
        "all negative identical should fill to max_length, got {}",
        r.fill_percent
    );
}

#[test]
fn test_all_negative_near_zero_identical_values() {
    // When all negative values are near zero (min_value.abs() < 1e-12),
    // the range is effectively zero and the fallback is 50%.
    // This covers the uncovered line 108.
    let stats = make_stats(&[-1e-13, -1e-13, -1e-13]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#638EC6", Some("#FF0000"));

    let r = compute_data_bar(-1e-13, &db, &stats);
    assert!(r.is_negative);
    assert!(
        (r.fill_percent - 50.0).abs() < 1e-10,
        "all negative near-zero identical should give 50% fill, got {}",
        r.fill_percent
    );
}

// -----------------------------------------------------------------------
// match_positive_fill_color: negative bar uses positive fill color
// -----------------------------------------------------------------------

#[test]
fn test_match_positive_fill_color_on_negative_bar() {
    // When match_positive_fill_color is true, negative bars should use the
    // positive color instead of the negative color. This is an Excel feature
    // that makes all bars the same color regardless of sign.
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let mut db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", Some("#FF0000"));
    db.match_positive_fill_color = true;

    let r = compute_data_bar(-5.0, &db, &stats);
    assert!(r.is_negative);
    // With match_positive_fill_color=true, negative bar uses positive color (green)
    assert_eq!(
        r.color,
        Color::rgb(0x00, 0xFF, 0x00),
        "negative bar should use positive fill color when match_positive_fill_color is true"
    );
}

#[test]
fn test_match_positive_fill_color_false_uses_negative_color() {
    // When match_positive_fill_color is false (default), negative bars
    // use the negative color.
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", Some("#FF0000"));

    let r = compute_data_bar(-5.0, &db, &stats);
    assert!(r.is_negative);
    assert_eq!(
        r.color,
        Color::rgb(0xFF, 0x00, 0x00),
        "negative bar should use negative color when match_positive_fill_color is false"
    );
}

// -----------------------------------------------------------------------
// match_positive_border_color: negative bar uses positive border color
// -----------------------------------------------------------------------

#[test]
fn test_match_positive_border_color_on_negative_bar() {
    // When match_positive_border_color is true, the negative_border_color
    // should be overridden with the positive border_color.
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let mut db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", Some("#FF0000"));
    db.border_color = Some(Color::from_hex("#0000FF").unwrap()); // blue positive border
    db.negative_border_color = Some(Color::from_hex("#FFFF00").unwrap()); // yellow negative border
    db.show_border = true;
    db.match_positive_border_color = true;

    let r = compute_data_bar(-5.0, &db, &stats);
    assert!(r.is_negative);
    // With match_positive_border_color=true, negative_border_color should mirror the positive border
    assert_eq!(
        r.negative_border_color,
        Some(Color::rgb(0x00, 0x00, 0xFF)),
        "negative border should use positive border color when match_positive_border_color is true"
    );
}

#[test]
fn test_match_positive_border_color_false_uses_negative_border() {
    // When match_positive_border_color is false (default), negative bars keep
    // their own border color.
    let stats = make_stats(&[-10.0, 0.0, 10.0]);
    let mut db = make_data_bar(CFDataBarAxisPosition::Automatic, "#00FF00", Some("#FF0000"));
    db.border_color = Some(Color::from_hex("#0000FF").unwrap());
    db.negative_border_color = Some(Color::from_hex("#FFFF00").unwrap());
    db.show_border = true;
    db.match_positive_border_color = false;

    let r = compute_data_bar(-5.0, &db, &stats);
    assert_eq!(
        r.negative_border_color,
        Some(Color::rgb(0xFF, 0xFF, 0x00)),
        "negative border should keep its own color when match_positive_border_color is false"
    );
}
