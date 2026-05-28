use super::helpers::{cv_null, cv_num, cv_text};
use crate::filter_resolve::evaluate_top_bottom_direct;
use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
use value_types::CellValue;

#[test]
fn test_top_2_items() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(30.0), cv_num(20.0), cv_num(40.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 1, 0, 1]);
}

#[test]
fn test_bottom_1_item() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 1.0,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(30.0), cv_num(20.0), cv_num(40.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![1, 0, 0, 0]);
}

#[test]
fn test_top_50_percent() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 50.0,
        by: TopBottomBy::Percent,
    };
    let data = vec![cv_num(10.0), cv_num(30.0), cv_num(20.0), cv_num(40.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 1, 0, 1]);
}

#[test]
fn test_bottom_5_percent_rounds_up() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 5.0,
        by: TopBottomBy::Percent,
    };
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![1, 0, 0, 0, 0]);
}

#[test]
fn test_top_by_sum() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 50.0,
        by: TopBottomBy::Sum,
    };
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 1, 0, 0, 1]);
}

#[test]
fn test_all_non_numeric_hidden() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 5.0,
        by: TopBottomBy::Items,
    };
    let data = vec![
        cv_text("a"),
        cv_null(),
        CellValue::Boolean(true),
        cv_text("hello"),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0, 0]);
}

#[test]
fn test_duplicate_boundary_selects_exactly_n() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(10.0), cv_num(10.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    let visible_count: u8 = bitmap.iter().sum();
    assert_eq!(visible_count, 2);
}

#[test]
fn test_non_numeric_excluded() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    };
    let data = vec![
        cv_num(10.0),
        cv_text("text"),
        cv_null(),
        cv_num(50.0),
        cv_num(30.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0, 1, 1]);
}

#[test]
fn test_count_exceeds_available() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 100.0,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![1, 1, 1]);
}

#[test]
fn test_infinity_excluded() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    };
    let data = vec![
        CellValue::number(f64::INFINITY),
        cv_num(10.0),
        cv_num(50.0),
        CellValue::number(f64::NEG_INFINITY),
        cv_num(30.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 1, 0, 1]);
}

#[test]
fn test_top_bottom_count_zero() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 0.0,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

#[test]
fn test_top_bottom_count_negative() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: -1.0,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

#[test]
fn test_top_bottom_count_nan() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: f64::NAN,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

#[test]
fn test_top_bottom_count_infinity() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: f64::INFINITY,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

#[test]
fn test_top_bottom_count_neg_infinity() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: f64::NEG_INFINITY,
        by: TopBottomBy::Items,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

#[test]
fn test_top_bottom_fractional_percent() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 50.0,
        by: TopBottomBy::Percent,
    };
    let data = vec![
        cv_num(10.0),
        cv_num(20.0),
        cv_num(30.0),
        cv_num(40.0),
        cv_num(50.0),
        cv_num(60.0),
        cv_num(70.0),
        cv_num(80.0),
        cv_num(90.0),
        cv_num(100.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    let visible_count: u8 = bitmap.iter().sum();
    assert_eq!(visible_count, 5);
    assert_eq!(bitmap[9], 1);
    assert_eq!(bitmap[8], 1);
    assert_eq!(bitmap[7], 1);
    assert_eq!(bitmap[6], 1);
    assert_eq!(bitmap[5], 1);
}

#[test]
fn test_bottom_by_sum() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 50.0,
        by: TopBottomBy::Sum,
    };
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![1, 0, 1, 1, 1]);
}

#[test]
fn test_bottom_50_percent() {
    let spec = TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 50.0,
        by: TopBottomBy::Percent,
    };
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
        cv_num(60.0),
    ];
    let bitmap = evaluate_top_bottom_direct(&spec, &data);
    assert_eq!(bitmap, vec![1, 0, 1, 1, 0, 0]);
}
