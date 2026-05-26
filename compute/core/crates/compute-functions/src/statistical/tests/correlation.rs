use super::super::correlation::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
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

#[test]
fn test_correl() {
    let f = FnCorrel;
    // Perfect positive correlation
    let xs = arr(vec![1.0, 2.0, 3.0]);
    let ys = arr(vec![2.0, 4.0, 6.0]);
    let result = f.call(&[xs, ys]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 1.0).abs() < 0.001, "correl was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_fisher() {
    let f = FnFisher;
    // FISHER(0.75) = 0.5 * ln(1.75/0.25) = 0.5 * ln(7) ~ 0.9730
    let result = f.call(&[num(0.75)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 0.9730).abs() < 0.01, "fisher was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
    // Out of range
    assert_eq!(f.call(&[num(1.0)]), err(CellError::Num));
    assert_eq!(f.call(&[num(-1.0)]), err(CellError::Num));
}

#[test]
fn test_correl_perfect_positive_5pt() {
    // {1,2,3,4,5} vs {2,4,6,8,10}: y=2x => r = 1.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "CORREL",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
        ],
    );
    assert_num(r, 1.0, 1e-10, "CORREL perfect positive");
}

#[test]
fn test_correl_perfect_negative_5pt() {
    // {1,2,3,4,5} vs {10,8,6,4,2}: r = -1.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "CORREL",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            arr(vec![10.0, 8.0, 6.0, 4.0, 2.0]),
        ],
    );
    assert_num(r, -1.0, 1e-10, "CORREL perfect negative");
}

#[test]
fn test_correl_identical_arrays() {
    // {1,2,3} vs {1,2,3}: r = 1.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "CORREL",
        &[arr(vec![1.0, 2.0, 3.0]), arr(vec![1.0, 2.0, 3.0])],
    );
    assert_num(r, 1.0, 1e-10, "CORREL identical");
}

#[test]
fn test_correl_zero_variance_div0() {
    // {1,1,1} vs {2,3,4}: zero variance in first arg => #DIV/0!
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "CORREL",
        &[arr(vec![1.0, 1.0, 1.0]), arr(vec![2.0, 3.0, 4.0])],
    );
    assert_err(r, CellError::Div0, "CORREL zero variance x");
}

#[test]
fn test_correl_zero_variance_y() {
    // {2,3,4} vs {1,1,1}: zero variance in second arg => #DIV/0!
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "CORREL",
        &[arr(vec![2.0, 3.0, 4.0]), arr(vec![1.0, 1.0, 1.0])],
    );
    assert_err(r, CellError::Div0, "CORREL zero variance y");
}

#[test]
fn test_correl_single_pair_error() {
    // Single pair => fewer than 2 points => #DIV/0!
    let reg = crate::FunctionRegistry::new();
    let r = reg.call("CORREL", &[arr(vec![1.0]), arr(vec![2.0])]);
    assert_err(r, CellError::Div0, "CORREL single pair");
}

#[test]
fn test_correl_hand_calculated() {
    // x={1,3,2,5,4}, y={1,2,3,5,4}; mx=3, my=3
    // cov = (-2)(-2)+(0)(-1)+(-1)(0)+(2)(2)+(1)(1) = 4+0+0+4+1 = 9
    // sx = sqrt(4+0+1+4+1) = sqrt(10), sy = sqrt(4+1+0+4+1) = sqrt(10)
    // r = 9 / (sqrt(10)*sqrt(10)) = 0.9
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "CORREL",
        &[
            arr(vec![1.0, 3.0, 2.0, 5.0, 4.0]),
            arr(vec![1.0, 2.0, 3.0, 5.0, 4.0]),
        ],
    );
    assert_num(r, 0.9, 1e-10, "CORREL hand-calculated");
}

#[test]
fn test_pearson_equals_correl() {
    let reg = crate::FunctionRegistry::new();
    let args = [
        arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
        arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
    ];
    let c = reg.call("CORREL", &args);
    let p = reg.call("PEARSON", &args);
    assert_eq!(c, p, "PEARSON should equal CORREL");
}

#[test]
fn test_pearson_negative() {
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "PEARSON",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            arr(vec![10.0, 8.0, 6.0, 4.0, 2.0]),
        ],
    );
    assert_num(r, -1.0, 1e-10, "PEARSON perfect negative");
}

#[test]
fn test_covariance_p_identical_equals_var_p() {
    // COVARIANCE.P({1,2,3}, {1,2,3}) = Var_p = 2/3
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "COVARIANCE.P",
        &[arr(vec![1.0, 2.0, 3.0]), arr(vec![1.0, 2.0, 3.0])],
    );
    assert_num(r, 2.0 / 3.0, 1e-10, "COV.P identical = var_p");
}

#[test]
fn test_covariance_p_linear() {
    // x={1,2,3,4,5}, y={2,4,6,8,10}=2x; mx=3, my=6
    // cov_p = [(-2)(-4)+(-1)(-2)+(0)(0)+(1)(2)+(2)(4)] / 5 = 20/5 = 4.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "COVARIANCE.P",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
            arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]),
        ],
    );
    assert_num(r, 4.0, 1e-10, "COV.P linear");
}

#[test]
fn test_covariance_p_negative() {
    // x={1,2,3}, y={3,2,1}: cov_p = [(-1)(1)+(0)(0)+(1)(-1)]/3 = -2/3
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "COVARIANCE.P",
        &[arr(vec![1.0, 2.0, 3.0]), arr(vec![3.0, 2.0, 1.0])],
    );
    assert_num(r, -2.0 / 3.0, 1e-10, "COV.P negative");
}

#[test]
fn test_covar_equals_covariance_p() {
    let reg = crate::FunctionRegistry::new();
    let args = [arr(vec![1.0, 2.0, 3.0]), arr(vec![4.0, 5.0, 6.0])];
    let c = reg.call("COVAR", &args);
    let p = reg.call("COVARIANCE.P", &args);
    assert_eq!(c, p, "COVAR should equal COVARIANCE.P");
}

#[test]
fn test_covariance_s_identical_equals_var_s() {
    // COVARIANCE.S({1,2,3}, {1,2,3}) = Var_s = 1.0
    let reg = crate::FunctionRegistry::new();
    let r = reg.call(
        "COVARIANCE.S",
        &[arr(vec![1.0, 2.0, 3.0]), arr(vec![1.0, 2.0, 3.0])],
    );
    assert_num(r, 1.0, 1e-10, "COV.S identical = var_s");
}

#[test]
fn test_covariance_s_single_pair_error() {
    let reg = crate::FunctionRegistry::new();
    let r = reg.call("COVARIANCE.S", &[arr(vec![1.0]), arr(vec![2.0])]);
    assert_err(r, CellError::Div0, "COV.S single pair");
}

#[test]
fn test_covariance_s_vs_p_relationship() {
    // Cov_s = Cov_p * n/(n-1)
    let reg = crate::FunctionRegistry::new();
    let args = [arr(vec![1.0, 2.0, 3.0]), arr(vec![1.0, 2.0, 3.0])];
    let p = reg.call("COVARIANCE.P", &args);
    let s = reg.call("COVARIANCE.S", &args);
    if let (CellValue::Number(pv), CellValue::Number(sv)) = (&p, &s) {
        let n = 3.0;
        assert!(
            (sv.get() - pv.get() * n / (n - 1.0)).abs() < 1e-10,
            "COV.S should be COV.P * n/(n-1)"
        );
    } else {
        panic!("Expected numbers, got {:?} and {:?}", p, s);
    }
}

#[test]
fn test_fisher_zero() {
    let reg = crate::FunctionRegistry::new();
    assert_num(reg.call("FISHER", &[num(0.0)]), 0.0, 1e-10, "FISHER(0)");
}

#[test]
fn test_fisher_half() {
    // FISHER(0.5) = arctanh(0.5) = 0.5*ln(3) ~ 0.5493
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("FISHER", &[num(0.5)]),
        0.5 * 3.0_f64.ln(),
        1e-10,
        "FISHER(0.5)",
    );
}

#[test]
fn test_fisher_negative() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("FISHER", &[num(-0.5)]),
        -0.5 * 3.0_f64.ln(),
        1e-10,
        "FISHER(-0.5)",
    );
}

#[test]
fn test_fisher_boundary_errors() {
    let reg = crate::FunctionRegistry::new();
    assert_err(reg.call("FISHER", &[num(1.0)]), CellError::Num, "FISHER(1)");
    assert_err(
        reg.call("FISHER", &[num(-1.0)]),
        CellError::Num,
        "FISHER(-1)",
    );
    assert_err(
        reg.call("FISHER", &[num(1.5)]),
        CellError::Num,
        "FISHER(1.5)",
    );
}

#[test]
fn test_fisherinv_zero() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("FISHERINV", &[num(0.0)]),
        0.0,
        1e-10,
        "FISHERINV(0)",
    );
}

#[test]
fn test_fisherinv_roundtrip() {
    // FISHERINV(FISHER(0.5)) = 0.5
    let reg = crate::FunctionRegistry::new();
    let f = reg.call("FISHER", &[num(0.5)]);
    let r = reg.call("FISHERINV", &[f]);
    assert_num(r, 0.5, 1e-10, "FISHERINV roundtrip");
}

#[test]
fn test_fisherinv_known_value() {
    // FISHERINV(arctanh(0.5)) = 0.5
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("FISHERINV", &[num(0.5 * 3.0_f64.ln())]),
        0.5,
        1e-10,
        "FISHERINV known",
    );
}

#[test]
fn test_fisher_fisherinv_symmetry() {
    let reg = crate::FunctionRegistry::new();
    for &x in &[-0.9, -0.5, 0.0, 0.25, 0.75, 0.99] {
        let f = reg.call("FISHER", &[num(x)]);
        let r = reg.call("FISHERINV", &[f]);
        assert_num(r, x, 1e-10, &format!("FISHERINV(FISHER({x}))"));
    }
}
