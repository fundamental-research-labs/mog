use super::super::regression::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

fn assert_num(result: CellValue, expected: f64, tolerance: f64, label: &str) {
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - expected).abs() < tolerance,
            "{}: expected {}, got {}",
            label,
            expected,
            n.get()
        );
    } else {
        panic!("{}: expected number {}, got {:?}", label, expected, result);
    }
}

fn assert_err(result: CellValue, expected: CellError, label: &str) {
    if let CellValue::Error(e, _) = result {
        assert_eq!(
            e, expected,
            "{}: expected {:?}, got {:?}",
            label, expected, e
        );
    } else {
        panic!("{}: expected error {:?}, got {:?}", label, expected, result);
    }
}

fn arr_get(result: &CellValue, row: usize, col: usize) -> CellValue {
    result
        .as_array()
        .unwrap_or_else(|| panic!("expected array, got {:?}", result))
        .get(row, col)
        .unwrap_or_else(|| panic!("out of bounds ({row},{col})"))
        .clone()
}

#[test]
fn test_slope_intercept() {
    // y = 2x + 1: points (1,3), (2,5), (3,7)
    let ys = arr(vec![3.0, 5.0, 7.0]);
    let xs = arr(vec![1.0, 2.0, 3.0]);
    let slope = FnSlope.call(&[ys.clone(), xs.clone()]);
    let intercept = FnIntercept.call(&[ys, xs]);
    if let CellValue::Number(s) = slope {
        assert!((s.get() - 2.0).abs() < 0.001, "slope was {}", s.get());
    } else {
        panic!("Expected number");
    }
    if let CellValue::Number(i) = intercept {
        assert!((i.get() - 1.0).abs() < 0.001, "intercept was {}", i.get());
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_prob_loose_tolerance() {
    let f = FnProb;
    // Probabilities that sum to 1.005 (within 0.01 tolerance) should work
    let xs = arr(vec![1.0, 2.0, 3.0]);
    let ps = CellValue::from_rows(vec![vec![num(0.335), num(0.335), num(0.335)]]);
    let result = f.call(&[xs, ps, num(1.0), num(3.0)]);
    // Sum = 1.005, which should be within tolerance
    assert!(
        matches!(result, CellValue::Number(_)),
        "Expected number with loose tolerance, got {:?}",
        result
    );
}

#[test]
fn test_rsq_perfect_linear() {
    // RSQ = CORREL^2 = 1.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "RSQ",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
        ],
    );
    assert_num(r, 1.0, 1e-10, "RSQ perfect linear");
}

#[test]
fn test_rsq_perfect_negative_still_one() {
    // RSQ of perfect negative correlation = (-1)^2 = 1.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "RSQ",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            arr(vec![10.0, 8.0, 6.0, 4.0, 2.0]),
        ],
    );
    assert_num(r, 1.0, 1e-10, "RSQ negative => 1");
}

#[test]
fn test_rsq_hand_calculated() {
    // CORREL = 0.9 => RSQ = 0.81
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "RSQ",
        &[
            arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
            arr(vec![1.0, 2.0, 3.0, 5.0, 4.0]),
        ],
    );
    assert_num(r, 0.81, 1e-10, "RSQ hand-calculated");
}

#[test]
fn test_rsq_zero_variance_error() {
    let reg = crate::FunctionRegistry::new();
    let r = reg.call("RSQ", &[arr(vec![1.0, 1.0, 1.0]), arr(vec![2.0, 3.0, 4.0])]);
    assert_err(r, CellError::Div0, "RSQ zero variance");
}

#[test]
fn test_slope_perfect_linear() {
    // y=2x => slope = 2.0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "SLOPE",
            &[
                arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        2.0,
        1e-10,
        "SLOPE y=2x",
    );
}

#[test]
fn test_slope_hand_calculated() {
    // y={1,3,2,5,4}, x={1,2,3,4,5}
    // n=5, Σx=15, Σy=15, Σxy=1+6+6+20+20=53, Σx²=55
    // slope = (5*53 - 15*15)/(5*55 - 225) = 40/50 = 0.8
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "SLOPE",
            &[
                arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        0.8,
        1e-10,
        "SLOPE hand-calculated",
    );
}

#[test]
fn test_slope_negative() {
    // y={10,8,6,4,2}, x={1,2,3,4,5} => slope = -2.0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "SLOPE",
            &[
                arr(vec![10.0, 8.0, 6.0, 4.0, 2.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        -2.0,
        1e-10,
        "SLOPE negative",
    );
}

#[test]
fn test_slope_constant_x_div0() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "SLOPE",
            &[arr(vec![1.0, 2.0, 3.0]), arr(vec![5.0, 5.0, 5.0])],
        ),
        CellError::Div0,
        "SLOPE constant x",
    );
}

#[test]
fn test_slope_single_point_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("SLOPE", &[arr(vec![1.0]), arr(vec![2.0])]),
        CellError::Div0,
        "SLOPE single point",
    );
}

#[test]
fn test_intercept_through_origin() {
    // y=2x => intercept = 0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "INTERCEPT",
            &[
                arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        0.0,
        1e-10,
        "INTERCEPT origin",
    );
}

#[test]
fn test_intercept_hand_calculated() {
    // slope=0.8, intercept = (15 - 0.8*15)/5 = 3/5 = 0.6
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "INTERCEPT",
            &[
                arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        0.6,
        1e-10,
        "INTERCEPT hand-calculated",
    );
}

#[test]
fn test_intercept_with_offset() {
    // y=2x+3 => intercept = 3
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "INTERCEPT",
            &[arr(vec![5.0, 7.0, 9.0]), arr(vec![1.0, 2.0, 3.0])],
        ),
        3.0,
        1e-10,
        "INTERCEPT offset",
    );
}

#[test]
fn test_forecast_perfect_linear() {
    // y=2x: FORECAST(6, y, x) = 12.0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "FORECAST",
            &[
                num(6.0),
                arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        12.0,
        1e-10,
        "FORECAST y=2x at x=6",
    );
}

#[test]
fn test_forecast_hand_calculated() {
    // y = 0.6 + 0.8x => FORECAST(6) = 0.6 + 4.8 = 5.4
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "FORECAST",
            &[
                num(6.0),
                arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        5.4,
        1e-10,
        "FORECAST hand-calculated",
    );
}

#[test]
fn test_forecast_linear_equals_forecast() {
    let reg = crate::FunctionRegistry::new();
    let args = [
        num(6.0),
        arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
        arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
    ];
    let f = reg.call("FORECAST", &args);
    let fl = reg.call("FORECAST.LINEAR", &args);
    assert_eq!(f, fl, "FORECAST.LINEAR should equal FORECAST");
}

#[test]
fn test_forecast_interpolation() {
    // y=2x+3 => FORECAST(2.5) = 8.0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "FORECAST",
            &[num(2.5), arr(vec![5.0, 7.0, 9.0]), arr(vec![1.0, 2.0, 3.0])],
        ),
        8.0,
        1e-10,
        "FORECAST interpolation",
    );
}

#[test]
fn test_forecast_single_point_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("FORECAST", &[num(1.0), arr(vec![5.0]), arr(vec![1.0])]),
        CellError::Na,
        "FORECAST single point",
    );
}

#[test]
fn test_steyx_perfect_fit() {
    // y=2x: no residuals => STEYX = 0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "STEYX",
            &[
                arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        0.0,
        1e-10,
        "STEYX perfect fit",
    );
}

#[test]
fn test_steyx_hand_calculated() {
    // y=0.6+0.8x; residuals: {-0.4, 0.8, -1.0, 1.2, -0.6}
    // SSE = 0.16+0.64+1.0+1.44+0.36 = 3.6
    // STEYX = sqrt(3.6/3) = sqrt(1.2) ~ 1.0954
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "STEYX",
            &[
                arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
                arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            ],
        ),
        (3.6_f64 / 3.0).sqrt(),
        1e-4,
        "STEYX hand-calculated",
    );
}

#[test]
fn test_steyx_needs_3_points() {
    // n=2 => n-2=0 dof => #DIV/0!
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("STEYX", &[arr(vec![1.0, 2.0]), arr(vec![1.0, 2.0])]),
        CellError::Div0,
        "STEYX 2 points",
    );
}

#[test]
fn test_linest_perfect_linear() {
    // y=2x => [slope=2, intercept=0]
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "LINEST",
        &[
            arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
        ],
    );
    assert_num(arr_get(&r, 0, 0), 2.0, 1e-10, "LINEST slope");
    assert_num(arr_get(&r, 0, 1), 0.0, 1e-10, "LINEST intercept");
}

#[test]
fn test_linest_hand_calculated() {
    // slope=0.8, intercept=0.6
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "LINEST",
        &[
            arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
        ],
    );
    assert_num(arr_get(&r, 0, 0), 0.8, 1e-10, "LINEST hand slope");
    assert_num(arr_get(&r, 0, 1), 0.6, 1e-10, "LINEST hand intercept");
}

#[test]
fn test_linest_y_only_implicit_x() {
    // LINEST({2,4,6}) => implicit x={1,2,3} => slope=2, intercept=0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call("LINEST", &[arr(vec![2.0, 4.0, 6.0])]);
    assert_num(arr_get(&r, 0, 0), 2.0, 1e-10, "LINEST implicit slope");
    assert_num(arr_get(&r, 0, 1), 0.0, 1e-10, "LINEST implicit intercept");
}

#[test]
fn test_linest_single_point_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("LINEST", &[arr(vec![5.0]), arr(vec![1.0])]),
        CellError::Na,
        "LINEST single point",
    );
}

#[test]
fn test_logest_exponential() {
    // y=2^x => y={2,4,8}, x={1,2,3}
    // ln(y)=x*ln(2) => slope=ln(2), intercept=0
    // LOGEST returns [exp(slope), exp(intercept)] = [2, 1]
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "LOGEST",
        &[arr(vec![2.0, 4.0, 8.0]), arr(vec![1.0, 2.0, 3.0])],
    );
    assert_num(arr_get(&r, 0, 0), 2.0, 1e-10, "LOGEST base");
    assert_num(arr_get(&r, 0, 1), 1.0, 1e-10, "LOGEST coeff");
}

#[test]
fn test_logest_negative_y_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "LOGEST",
            &[arr(vec![2.0, -4.0, 8.0]), arr(vec![1.0, 2.0, 3.0])],
        ),
        CellError::Num,
        "LOGEST negative y",
    );
}

#[test]
fn test_logest_zero_y_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "LOGEST",
            &[arr(vec![2.0, 0.0, 8.0]), arr(vec![1.0, 2.0, 3.0])],
        ),
        CellError::Num,
        "LOGEST zero y",
    );
}

#[test]
fn test_trend_extrapolation() {
    // y=2x: TREND({2,4,6}, {1,2,3}, {4,5}) => {8,10}
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "TREND",
        &[
            arr(vec![2.0, 4.0, 6.0]),
            arr(vec![1.0, 2.0, 3.0]),
            arr(vec![4.0, 5.0]),
        ],
    );
    assert_num(arr_get(&r, 0, 0), 8.0, 1e-10, "TREND x=4");
    assert_num(arr_get(&r, 0, 1), 10.0, 1e-10, "TREND x=5");
}

#[test]
fn test_trend_without_new_x() {
    // Without new_x, predict at original x: y=2x+1 => {3,5,7}
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "TREND",
        &[arr(vec![3.0, 5.0, 7.0]), arr(vec![1.0, 2.0, 3.0])],
    );
    assert_num(arr_get(&r, 0, 0), 3.0, 1e-10, "TREND fit x=1");
    assert_num(arr_get(&r, 0, 1), 5.0, 1e-10, "TREND fit x=2");
    assert_num(arr_get(&r, 0, 2), 7.0, 1e-10, "TREND fit x=3");
}

#[test]
fn test_trend_y_only_implicit_x() {
    // TREND({2,4,6}) => implicit x={1,2,3}, predict at {1,2,3} = {2,4,6}
    let reg = crate::FunctionRegistry::new();
    let r = reg.call("TREND", &[arr(vec![2.0, 4.0, 6.0])]);
    assert_num(arr_get(&r, 0, 0), 2.0, 1e-10, "TREND implicit x=1");
    assert_num(arr_get(&r, 0, 2), 6.0, 1e-10, "TREND implicit x=3");
}

#[test]
fn test_growth_exponential_predict() {
    // y=2^x: GROWTH({2,4,8}, {1,2,3}, {4}) => {16}
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "GROWTH",
        &[
            arr(vec![2.0, 4.0, 8.0]),
            arr(vec![1.0, 2.0, 3.0]),
            arr(vec![4.0]),
        ],
    );
    assert_num(arr_get(&r, 0, 0), 16.0, 1e-8, "GROWTH x=4 => 16");
}

#[test]
fn test_growth_predict_at_original() {
    // predictions at original x should reproduce data
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "GROWTH",
        &[arr(vec![2.0, 4.0, 8.0]), arr(vec![1.0, 2.0, 3.0])],
    );
    assert_num(arr_get(&r, 0, 0), 2.0, 1e-8, "GROWTH fit x=1");
    assert_num(arr_get(&r, 0, 1), 4.0, 1e-8, "GROWTH fit x=2");
    assert_num(arr_get(&r, 0, 2), 8.0, 1e-8, "GROWTH fit x=3");
}

#[test]
fn test_growth_negative_y_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "GROWTH",
            &[
                arr(vec![2.0, -1.0, 8.0]),
                arr(vec![1.0, 2.0, 3.0]),
                arr(vec![4.0]),
            ],
        ),
        CellError::Num,
        "GROWTH negative y",
    );
}

#[test]
fn test_growth_y_only_implicit_x() {
    // GROWTH({1,2,4}) => implicit x={1,2,3}
    let reg = crate::FunctionRegistry::new();
    let r = reg.call("GROWTH", &[arr(vec![1.0, 2.0, 4.0])]);
    assert_num(arr_get(&r, 0, 0), 1.0, 1e-8, "GROWTH implicit x=1");
    assert_num(arr_get(&r, 0, 1), 2.0, 1e-8, "GROWTH implicit x=2");
    assert_num(arr_get(&r, 0, 2), 4.0, 1e-8, "GROWTH implicit x=3");
}

#[test]
fn test_prob_single_value() {
    // P(X=2) with probs {0.3, 0.4, 0.3}
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "PROB",
            &[arr(vec![1.0, 2.0, 3.0]), arr(vec![0.3, 0.4, 0.3]), num(2.0)],
        ),
        0.4,
        1e-10,
        "PROB single value",
    );
}

#[test]
fn test_prob_range() {
    // P(1 <= X <= 2) = 0.3 + 0.4 = 0.7
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "PROB",
            &[
                arr(vec![1.0, 2.0, 3.0]),
                arr(vec![0.3, 0.4, 0.3]),
                num(1.0),
                num(2.0),
            ],
        ),
        0.7,
        1e-10,
        "PROB range",
    );
}

#[test]
fn test_prob_invalid_probability() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "PROB",
            &[arr(vec![1.0, 2.0]), arr(vec![0.5, 1.5]), num(1.0)],
        ),
        CellError::Num,
        "PROB p>1",
    );
}

#[test]
fn test_prob_sum_not_one() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "PROB",
            &[arr(vec![1.0, 2.0]), arr(vec![0.3, 0.3]), num(1.0)],
        ),
        CellError::Num,
        "PROB sum!=1",
    );
}

#[test]
fn test_prob_no_match() {
    // P(X=5) where X={1,2,3} => 0.0
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call(
            "PROB",
            &[arr(vec![1.0, 2.0, 3.0]), arr(vec![0.3, 0.4, 0.3]), num(5.0)],
        ),
        0.0,
        1e-10,
        "PROB no match",
    );
}
