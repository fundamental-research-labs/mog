use super::*;
use crate::test_helpers::make_stats;
use crate::types::{
    CFIconSet, CFIconSetName, CFIconThreshold, CFIconThresholdOperator, CFValueType, CustomIcon,
};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/// Build a threshold with percent type and >= operator.
fn pct_threshold(value: f64) -> CFIconThreshold {
    CFIconThreshold {
        value_type: CFValueType::Percent,
        value: Some(value),
        operator: CFIconThresholdOperator::GreaterThanOrEqual,
        custom_icon: None,
    }
}

/// Build a threshold with percent type and > operator.
fn pct_threshold_gt(value: f64) -> CFIconThreshold {
    CFIconThreshold {
        value_type: CFValueType::Percent,
        value: Some(value),
        operator: CFIconThresholdOperator::GreaterThan,
        custom_icon: None,
    }
}

/// Build a 3-icon set with given thresholds.
fn make_3_icon_set(t1: CFIconThreshold, t2: CFIconThreshold) -> CFIconSet {
    CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![t1, t2],
        reverse_order: false,
        show_icon_only: false,
    }
}

// -----------------------------------------------------------------------
// 3-icon set with default thresholds (33/67)
// -----------------------------------------------------------------------

#[test]
fn test_3_icon_default_thresholds() {
    // Values 0..100, thresholds at 33 and 67
    let stats = make_stats(&[0.0, 25.0, 50.0, 75.0, 100.0]);
    let icon_set = make_3_icon_set(pct_threshold(33.0), pct_threshold(67.0));

    // value=0 -> percentile=0 -> below all thresholds -> icon_index=2 (worst)
    let r = compute_icon(0.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);
    assert_eq!(r.set_name, CFIconSetName::ThreeArrows);
    assert!(r.show_value);

    // value=50 -> percentile=50 -> matches threshold[0]=33 (>=33) at i=0 -> icon 1 (middle)
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=100 -> percentile=100 -> matches threshold[1]=67 (>=67) at i=1 -> icon 0 (best)
    let r = compute_icon(100.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// 4-icon set
// -----------------------------------------------------------------------

#[test]
fn test_4_icon_set() {
    let stats = make_stats(&[0.0, 25.0, 50.0, 75.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::FourRating,
        thresholds: vec![
            pct_threshold(25.0),
            pct_threshold(50.0),
            pct_threshold(75.0),
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // value=0 -> percentile=0 -> below all -> icon_index=3 (worst)
    let r = compute_icon(0.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 3);

    // value=25 -> percentile=25 -> matches threshold[0]=25 at i=0 -> icon 2
    let r = compute_icon(25.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);

    // value=50 -> percentile=50 -> matches threshold[1]=50 at i=1 -> icon 1
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=100 -> percentile=100 -> matches threshold[2]=75 at i=2 -> icon 0 (best)
    let r = compute_icon(100.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// 5-icon set
// -----------------------------------------------------------------------

#[test]
fn test_5_icon_set() {
    let stats = make_stats(&[0.0, 20.0, 40.0, 60.0, 80.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::FiveArrows,
        thresholds: vec![
            pct_threshold(20.0),
            pct_threshold(40.0),
            pct_threshold(60.0),
            pct_threshold(80.0),
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // value=0 -> percentile=0 -> below all -> icon_index=4 (worst)
    let r = compute_icon(0.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 4);

    // value=100 -> percentile=100 -> matches threshold[3]=80 at i=3 -> icon 0 (best)
    let r = compute_icon(100.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);

    // value=50 -> percentile=50 -> matches threshold[1]=40 at i=1 -> icon 2
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);
}

// -----------------------------------------------------------------------
// Value at exact threshold
// -----------------------------------------------------------------------

#[test]
fn test_exact_threshold_gte() {
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = make_3_icon_set(pct_threshold(33.0), pct_threshold(67.0));

    // Correct Excel behavior for a 3-icon set with thresholds [33, 67]:
    //   pctile >= 67 -> icon 0 (best)
    //   33 <= pctile < 67 -> icon 1 (middle)
    //   pctile < 33 -> icon 2 (worst)
    //
    // The loop walks from highest threshold down. The formula
    // (n_thresholds - 1 - i) maps the highest matched threshold to icon 0.

    // value=33 -> pctile=33 -> matches threshold[0]=33 at i=0 -> icon 1 (middle)
    let r = compute_icon(33.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=67 -> pctile=67 -> matches threshold[1]=67 at i=1 -> icon 0 (best)
    let r = compute_icon(67.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);

    // value=90 -> pctile=90 -> matches threshold[1]=67 at i=1 -> icon 0 (best)
    let r = compute_icon(90.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

#[test]
fn test_exact_threshold_gt() {
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![pct_threshold_gt(33.0), pct_threshold_gt(67.0)],
        reverse_order: false,
        show_icon_only: false,
    };

    // Exactly at 33 with > operator -> does NOT pass threshold[0]
    // percentile = 33, threshold=33, operator=GT: 33 > 33 is false
    // So falls through to worst icon
    let r = compute_icon(33.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);

    // Just above 33 -> passes threshold[0] at i=0 -> icon 1 (middle)
    let r = compute_icon(34.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);
}

// -----------------------------------------------------------------------
// Reverse order
// -----------------------------------------------------------------------

#[test]
fn test_reverse_order() {
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![pct_threshold(33.0), pct_threshold(67.0)],
        reverse_order: true,
        show_icon_only: false,
    };

    // Without reverse: value=0 -> icon_index=2 (worst)
    // With reverse: 3-1-2 = 0
    let r = compute_icon(0.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);

    // Without reverse: value=100 -> icon_index=0 (best)
    // With reverse: 3-1-0 = 2
    let r = compute_icon(100.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);
}

// -----------------------------------------------------------------------
// All same values (percentile = 50)
// -----------------------------------------------------------------------

#[test]
fn test_all_same_values() {
    let stats = make_stats(&[42.0, 42.0, 42.0]);
    let icon_set = make_3_icon_set(pct_threshold(33.0), pct_threshold(67.0));

    // All same -> percentile=50
    // Check from highest: 50 >= 67? No. 50 >= 33? Yes at i=0 -> icon 1 (middle)
    let r = compute_icon(42.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);
}

// -----------------------------------------------------------------------
// Custom thresholds
// -----------------------------------------------------------------------

#[test]
fn test_custom_thresholds() {
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = make_3_icon_set(pct_threshold(10.0), pct_threshold(90.0));

    // value=5 -> percentile=5, below 10 -> worst icon
    let r = compute_icon(5.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);

    // value=50 -> percentile=50, >= 10 but < 90 -> matches at i=0 -> icon 1 (middle)
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=95 -> percentile=95, >= 90 -> matches at i=1 -> icon 0 (best)
    let r = compute_icon(95.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// show_icon_only
// -----------------------------------------------------------------------

#[test]
fn test_show_icon_only() {
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![pct_threshold(33.0), pct_threshold(67.0)],
        reverse_order: false,
        show_icon_only: true,
    };

    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    // show_icon_only=true -> show_value=false
    assert!(!r.show_value);
}

// -----------------------------------------------------------------------
// Empty thresholds
// -----------------------------------------------------------------------

#[test]
fn test_empty_thresholds() {
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::NoIcons,
        thresholds: vec![],
        reverse_order: false,
        show_icon_only: false,
    };

    // icon_count = 1, no thresholds -> loop doesn't execute -> icon_index=0
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// Number-type thresholds
// -----------------------------------------------------------------------

#[test]
fn test_number_type_thresholds() {
    // Use a range where raw value differs from percentile position
    // (min=200, max=800) so that Number thresholds are clearly tested
    // against the raw value, NOT the percentile.
    let stats = make_stats(&[200.0, 400.0, 600.0, 800.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Number,
                value: Some(400.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Number,
                value: Some(700.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // value=300: raw 300 < 400 (threshold[0]), so below all -> worst=2
    // (percentile would be ~16.7, but Number compares raw value)
    let r = compute_icon(300.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);

    // value=500: raw 500 >= 400 (threshold[0]) but < 700 (threshold[1]) -> icon 1 (middle)
    let r = compute_icon(500.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=750: raw 750 >= 700 (threshold[1]) -> icon 0 (best)
    let r = compute_icon(750.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// NaN / Infinity handling
// -----------------------------------------------------------------------

#[test]
fn test_nan_value_gets_worst_icon() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let icon_set = make_3_icon_set(pct_threshold(33.0), pct_threshold(67.0));

    let r = compute_icon(f64::NAN, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2); // worst icon
}

#[test]
fn test_infinity_value_gets_worst_icon() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let icon_set = make_3_icon_set(pct_threshold(33.0), pct_threshold(67.0));

    let r = compute_icon(f64::INFINITY, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2); // worst icon
}

#[test]
fn test_nan_value_reversed_gets_best_icon() {
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![pct_threshold(33.0), pct_threshold(67.0)],
        reverse_order: true,
        show_icon_only: false,
    };

    let r = compute_icon(f64::NAN, &icon_set, &stats).unwrap();
    // With reverse: worst icon (2) becomes best icon (0)
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// Percentile-type thresholds
// -----------------------------------------------------------------------

#[test]
fn test_percentile_type_thresholds() {
    // sorted: [10, 20, 30, 40, 50], use Percentile thresholds at 33 and 67
    let stats = make_stats(&[10.0, 20.0, 30.0, 40.0, 50.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Percentile,
                value: Some(33.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Percentile,
                value: Some(67.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // Test with a low value
    let r = compute_icon(10.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2); // worst

    // Test with a high value
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0); // best
}

// -----------------------------------------------------------------------
// Negative number thresholds
// -----------------------------------------------------------------------

#[test]
fn test_negative_number_thresholds() {
    // Range includes negative values: [-20, -10, 0, 10, 20]
    let stats = make_stats(&[-20.0, -10.0, 0.0, 10.0, 20.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Number,
                value: Some(-5.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Number,
                value: Some(5.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // value=-20: raw -20 < -5 -> worst icon (2)
    let r = compute_icon(-20.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 2);

    // value=0: raw 0 >= -5 but < 5 -> middle icon (1)
    let r = compute_icon(0.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=20: raw 20 >= 5 -> best icon (0)
    let r = compute_icon(20.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}

// -----------------------------------------------------------------------
// Mismatched threshold count validation
// -----------------------------------------------------------------------

#[test]
fn test_mismatched_threshold_count() {
    // A 3-icon set (ThreeArrows) with 3 thresholds instead of 2 should return None
    let stats = make_stats(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(25.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(50.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(75.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };
    let result = compute_icon(3.0, &icon_set, &stats);
    assert!(
        result.is_none(),
        "Mismatched threshold count should return None"
    );
}

#[test]
fn test_correct_threshold_count_accepted() {
    // A 3-icon set with 2 thresholds (correct) should work
    let stats = make_stats(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(33.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(67.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };
    let result = compute_icon(3.0, &icon_set, &stats);
    assert!(result.is_some(), "Correct threshold count should work");
}

#[test]
fn test_mixed_type_thresholds() {
    // One threshold is Number, another is Percent
    let stats = make_stats(&[10.0, 20.0, 30.0, 40.0, 50.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Number,
                value: Some(25.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(67.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };
    // value=35: Number threshold 25 -> compare 35 >= 25 (true), Percent threshold 67 -> compare pctile(35) >= 67
    // pctile of 35 = (35-10)/(50-10)*100 = 62.5, so 62.5 < 67 -> doesn't pass second threshold
    // Should get icon_index = 1 (middle icon, passes first but not second threshold)
    let result = compute_icon(35.0, &icon_set, &stats);
    assert!(result.is_some());
    let r = result.unwrap();
    assert_eq!(r.icon_index, 1);
}

// -----------------------------------------------------------------------
// Custom icon override on a matched threshold
// -----------------------------------------------------------------------

#[test]
fn test_custom_icon_override() {
    // When a threshold has a custom_icon set, the result should use
    // the custom icon's set_name and icon_index instead of the default.
    let stats = make_stats(&[0.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            pct_threshold(33.0), // No custom icon
            CFIconThreshold {
                value_type: CFValueType::Percent,
                value: Some(67.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: Some(CustomIcon {
                    icon_set: CFIconSetName::FourRating,
                    icon_index: 2,
                }),
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // value=80 -> percentile=80 -> matches threshold[1]=67 at i=1 -> would be icon 0,
    // but threshold has a custom icon -> should use FourRating, index 2
    let r = compute_icon(80.0, &icon_set, &stats).unwrap();
    assert_eq!(r.set_name, CFIconSetName::FourRating);
    assert_eq!(r.icon_index, 2);

    // value=50 -> percentile=50 -> matches threshold[0]=33 at i=0 -> icon 1 (no custom)
    let r = compute_icon(50.0, &icon_set, &stats).unwrap();
    assert_eq!(r.set_name, CFIconSetName::ThreeArrows);
    assert_eq!(r.icon_index, 1);
}

// -----------------------------------------------------------------------
// Threshold count mismatch (too few thresholds for the icon set)
// -----------------------------------------------------------------------

#[test]
fn test_threshold_count_too_few() {
    // A 3-icon set (ThreeArrows) needs 2 thresholds. Providing only 1 should return None.
    let stats = make_stats(&[0.0, 50.0, 100.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![pct_threshold(50.0)], // Only 1 threshold, but 3-icon set needs 2
        reverse_order: false,
        show_icon_only: false,
    };
    let result = compute_icon(50.0, &icon_set, &stats);
    assert!(
        result.is_none(),
        "Threshold count mismatch (too few) should return None"
    );
}

// -----------------------------------------------------------------------
// Percentile threshold when all values are identical (min == max)
// -----------------------------------------------------------------------

#[test]
fn test_percentile_threshold_all_same_values() {
    // When min == max (all values identical), percentile computation falls
    // back to 50. The percentile threshold resolution should also fall back
    // to 50 when min == max.
    let stats = make_stats(&[42.0, 42.0, 42.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Percentile,
                value: Some(33.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Percentile,
                value: Some(67.0),
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // All values are 42 -> percentile=50 (fallback when min==max).
    // Percentile thresholds also resolve to 50 (fallback when min==max).
    // Check from highest: 50 >= 50 (threshold[1])? Yes at i=1 -> icon 0 (best).
    let r = compute_icon(42.0, &icon_set, &stats).unwrap();
    assert_eq!(
        r.icon_index, 0,
        "all same values with percentile thresholds that all resolve to 50 should match highest"
    );
}

// -----------------------------------------------------------------------
// Min/Max threshold value types
// -----------------------------------------------------------------------

#[test]
fn test_min_max_threshold_types() {
    // Min resolves to 0 (0th percentile position), Max resolves to 100.
    let stats = make_stats(&[10.0, 50.0, 90.0]);
    let icon_set = CFIconSet {
        icon_set_name: CFIconSetName::ThreeArrows,
        thresholds: vec![
            CFIconThreshold {
                value_type: CFValueType::Min,
                value: None,
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
            CFIconThreshold {
                value_type: CFValueType::Max,
                value: None,
                operator: CFIconThresholdOperator::GreaterThanOrEqual,
                custom_icon: None,
            },
        ],
        reverse_order: false,
        show_icon_only: false,
    };

    // Min threshold = 0, Max threshold = 100
    // value=10 -> pctile=0 -> check 0 >= 100 (no), 0 >= 0 (yes at i=0) -> icon 1
    let r = compute_icon(10.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 1);

    // value=90 -> pctile=100 -> check 100 >= 100 (yes at i=1) -> icon 0
    let r = compute_icon(90.0, &icon_set, &stats).unwrap();
    assert_eq!(r.icon_index, 0);
}
