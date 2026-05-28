use super::super::moving_average;
use super::fixtures::{EPS, pts};

#[test]
fn ma_period_3() {
    let data = pts(&[
        (1.0, 10.0),
        (2.0, 20.0),
        (3.0, 30.0),
        (4.0, 40.0),
        (5.0, 50.0),
    ]);
    let result = moving_average(&data, 3);

    assert_eq!(result.points.len(), 3);
    // First window: (10+20+30)/3 = 20
    assert!((result.points[0].x - 3.0).abs() < EPS);
    assert!((result.points[0].y - 20.0).abs() < EPS);
    // Second window: (20+30+40)/3 = 30
    assert!((result.points[1].x - 4.0).abs() < EPS);
    assert!((result.points[1].y - 30.0).abs() < EPS);
    // Third window: (30+40+50)/3 = 40
    assert!((result.points[2].x - 5.0).abs() < EPS);
    assert!((result.points[2].y - 40.0).abs() < EPS);
}

#[test]
fn ma_period_greater_than_data() {
    let data = pts(&[(1.0, 10.0), (2.0, 20.0)]);
    let result = moving_average(&data, 5);
    assert!(result.points.is_empty());
}

#[test]
fn ma_period_equal_to_data() {
    let data = pts(&[(1.0, 2.0), (2.0, 4.0), (3.0, 6.0)]);
    let result = moving_average(&data, 3);
    assert_eq!(result.points.len(), 1);
    assert!((result.points[0].y - 4.0).abs() < EPS);
}

#[test]
fn ma_period_1_returns_identity() {
    let data = pts(&[(1.0, 5.0), (2.0, 10.0), (3.0, 15.0)]);
    let result = moving_average(&data, 1);
    assert_eq!(result.points.len(), 3);
    assert!((result.points[0].y - 5.0).abs() < EPS);
    assert!((result.points[1].y - 10.0).abs() < EPS);
    assert!((result.points[2].y - 15.0).abs() < EPS);
}
