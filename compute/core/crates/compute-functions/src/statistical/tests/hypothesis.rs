use super::super::hypothesis::*;
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
fn test_ztest_single_element_no_sigma() {
    let f = FnZTest;
    // Z.TEST({1}, 0) with single element and no sigma should return #NUM!
    // because auto-sigma divides by (n-1) = 0
    let data = arr(vec![1.0]);
    let result = f.call(&[data, num(0.0)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_ztest_single_element_with_sigma() {
    let f = FnZTest;
    // Z.TEST({1}, 0, 1) with explicit sigma should work fine
    let data = arr(vec![1.0]);
    let result = f.call(&[data, num(0.0), num(1.0)]);
    // Should return a valid number (not an error)
    assert!(
        matches!(result, CellValue::Number(_)),
        "Expected number, got {:?}",
        result
    );
}

#[test]
fn test_chisq_test_2d_contingency() {
    let f = FnChisqTest;
    // 2x3 contingency table: df = (2-1)*(3-1) = 2
    let obs = CellValue::from_rows(vec![
        vec![num(10.0), num(20.0), num(30.0)],
        vec![num(15.0), num(25.0), num(35.0)],
    ]);
    let exp = CellValue::from_rows(vec![
        vec![num(12.0), num(22.0), num(32.0)],
        vec![num(13.0), num(23.0), num(33.0)],
    ]);
    let result = f.call(&[obs, exp]);
    // Should return a valid p-value (not an error)
    assert!(
        matches!(result, CellValue::Number(_)),
        "Expected number, got {:?}",
        result
    );
}

#[test]
fn test_ttest_paired_two_tailed() {
    // {1,2,3,4,5} vs {2,4,6,8,10}
    // diffs = {-1,-2,-3,-4,-5}, mean_d=-3, var_d=2.5
    // t = -3 / sqrt(2.5/5) = -3/0.7071 ≈ -4.2426, df=4
    // two-tailed p ≈ 0.0132
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let result = reg.call("T.TEST", &[a1, a2, num(2.0), num(1.0)]);
    assert_num(result, 0.0132, 0.002, "T.TEST paired two-tailed");
}

#[test]
fn test_ttest_paired_one_tailed() {
    // Same data, one-tailed: p ≈ 0.0066
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let result = reg.call("T.TEST", &[a1, a2, num(1.0), num(1.0)]);
    assert_num(result, 0.0066, 0.001, "T.TEST paired one-tailed");
}

#[test]
fn test_ttest_equal_variance_two_tailed() {
    // type=2: m1=3, m2=6, v1=2.5, v2=10
    // sp2 = (4*2.5+4*10)/8 = 6.25, se = sqrt(6.25*2/5) ≈ 1.5811
    // t = -3/1.5811 ≈ -1.8974, df=8, two-tailed p ≈ 0.0942
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let result = reg.call("T.TEST", &[a1, a2, num(2.0), num(2.0)]);
    assert_num(result, 0.0942, 0.005, "T.TEST equal var two-tailed");
}

#[test]
fn test_ttest_welch_two_tailed() {
    // type=3: se = sqrt(2.5/5+10/5) = sqrt(2.5) ≈ 1.5811
    // t = -3/1.5811 ≈ -1.8974
    // Welch df = (2.5)^2 / ((0.5)^2/4 + (2)^2/4) ≈ 5.882
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let result = reg.call("T.TEST", &[a1, a2, num(2.0), num(3.0)]);
    assert_num(result, 0.108, 0.01, "T.TEST Welch two-tailed");
}

#[test]
fn test_ttest_identical_arrays_paired_div0() {
    // All diffs = 0, variance = 0 => #DIV/0!
    let reg = crate::FunctionRegistry::new();
    let a = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        reg.call("T.TEST", &[a.clone(), a, num(2.0), num(1.0)]),
        CellError::Div0,
        "T.TEST identical paired",
    );
}

#[test]
fn test_ttest_invalid_tails_3() {
    let reg = crate::FunctionRegistry::new();
    let a = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        reg.call("T.TEST", &[a.clone(), a, num(3.0), num(1.0)]),
        CellError::Num,
        "T.TEST tails=3",
    );
}

#[test]
fn test_ttest_invalid_tails_0() {
    let reg = crate::FunctionRegistry::new();
    let a = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        reg.call("T.TEST", &[a.clone(), a, num(0.0), num(1.0)]),
        CellError::Num,
        "T.TEST tails=0",
    );
}

#[test]
fn test_ttest_invalid_type_0() {
    let reg = crate::FunctionRegistry::new();
    let a = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        reg.call("T.TEST", &[a.clone(), a, num(2.0), num(0.0)]),
        CellError::Num,
        "T.TEST type=0",
    );
}

#[test]
fn test_ttest_invalid_type_4() {
    let reg = crate::FunctionRegistry::new();
    let a = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        reg.call("T.TEST", &[a.clone(), a, num(2.0), num(4.0)]),
        CellError::Num,
        "T.TEST type=4",
    );
}

#[test]
fn test_ttest_paired_different_lengths() {
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0]);
    let a2 = arr(vec![1.0, 2.0, 3.0, 4.0]);
    assert_err(
        reg.call("T.TEST", &[a1, a2, num(2.0), num(1.0)]),
        CellError::Na,
        "T.TEST paired diff lengths",
    );
}

#[test]
fn test_ttest_single_element_div0() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "T.TEST",
            &[arr(vec![1.0]), arr(vec![2.0]), num(2.0), num(1.0)],
        ),
        CellError::Div0,
        "T.TEST single element",
    );
}

#[test]
fn test_ttest_legacy_alias() {
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let r1 = reg.call("T.TEST", &[a1.clone(), a2.clone(), num(2.0), num(1.0)]);
    let r2 = reg.call("TTEST", &[a1, a2, num(2.0), num(1.0)]);
    assert_eq!(r1, r2, "TTEST should equal T.TEST");
}

#[test]
fn test_ttest_equal_var_symmetric() {
    // Swapping arrays for type=2 gives same p-value
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let r1 = reg.call("T.TEST", &[a1.clone(), a2.clone(), num(2.0), num(2.0)]);
    let r2 = reg.call("T.TEST", &[a2, a1, num(2.0), num(2.0)]);
    assert_eq!(r1, r2, "T.TEST type=2 symmetric");
}

#[test]
fn test_ftest_basic() {
    // {1,2,3,4,5} vs {2,4,6,8,10}: var1=2.5, var2=10, F=0.25
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let result = reg.call("F.TEST", &[a1, a2]);
    if let CellValue::Number(n) = result {
        assert!(
            n.get() > 0.0 && n.get() < 1.0,
            "F.TEST p in (0,1), got {}",
            n.get()
        );
    } else {
        panic!("F.TEST expected number, got {result:?}");
    }
}

#[test]
fn test_ftest_equal_variances() {
    // Identical data => F=1.0 => p ≈ 1.0
    let reg = crate::FunctionRegistry::new();
    let a = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_num(
        reg.call("F.TEST", &[a.clone(), a]),
        1.0,
        0.01,
        "F.TEST equal var",
    );
}

#[test]
fn test_ftest_single_element_div0() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("F.TEST", &[arr(vec![1.0]), arr(vec![1.0, 2.0, 3.0])]),
        CellError::Div0,
        "F.TEST single element",
    );
}

#[test]
fn test_ftest_zero_variance_div0() {
    // Second array all same => var2=0 => #DIV/0!
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "F.TEST",
            &[arr(vec![1.0, 2.0, 3.0]), arr(vec![5.0, 5.0, 5.0])],
        ),
        CellError::Div0,
        "F.TEST zero var",
    );
}

#[test]
fn test_ftest_legacy_alias() {
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![2.0, 4.0, 6.0, 8.0, 10.0]);
    let r1 = reg.call("F.TEST", &[a1.clone(), a2.clone()]);
    let r2 = reg.call("FTEST", &[a1, a2]);
    assert_eq!(r1, r2, "FTEST should equal F.TEST");
}

#[test]
fn test_ftest_swap_arrays_both_valid() {
    let reg = crate::FunctionRegistry::new();
    let a1 = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let a2 = arr(vec![10.0, 20.0, 30.0, 40.0, 50.0]);
    let r1 = reg.call("F.TEST", &[a1.clone(), a2.clone()]);
    let r2 = reg.call("F.TEST", &[a2, a1]);
    if let (CellValue::Number(n1), CellValue::Number(n2)) = (&r1, &r2) {
        assert!(
            n1.get() > 0.0 && n1.get() <= 1.0,
            "F.TEST(a,b) p={}",
            n1.get()
        );
        assert!(
            n2.get() > 0.0 && n2.get() <= 1.0,
            "F.TEST(b,a) p={}",
            n2.get()
        );
    } else {
        panic!("Expected numbers, got {r1:?} and {r2:?}");
    }
}

#[test]
fn test_chisq_test_basic() {
    // obs={10,20,30}, exp={20,20,20}
    // chi2 = 100/20 + 0 + 100/20 = 10, df=2
    // p = 1 - chi2_cdf(10, 2) ≈ 0.0067
    let reg = crate::FunctionRegistry::new();
    let obs = arr(vec![10.0, 20.0, 30.0]);
    let exp = arr(vec![20.0, 20.0, 20.0]);
    assert_num(
        reg.call("CHISQ.TEST", &[obs, exp]),
        0.0067,
        0.002,
        "CHISQ.TEST basic",
    );
}

#[test]
fn test_chisq_test_perfect_fit() {
    // obs = exp => chi2 = 0 => p = 1.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![10.0, 20.0, 30.0]);
    assert_num(
        reg.call("CHISQ.TEST", &[data.clone(), data]),
        1.0,
        1e-10,
        "CHISQ.TEST perfect fit",
    );
}

#[test]
fn test_chisq_test_expected_zero_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("CHISQ.TEST", &[arr(vec![10.0, 20.0]), arr(vec![0.0, 20.0])]),
        CellError::Num,
        "CHISQ.TEST exp=0",
    );
}

#[test]
fn test_chisq_test_negative_expected_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "CHISQ.TEST",
            &[arr(vec![10.0, 20.0]), arr(vec![-5.0, 20.0])],
        ),
        CellError::Num,
        "CHISQ.TEST exp<0",
    );
}

#[test]
fn test_chisq_test_different_lengths_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call(
            "CHISQ.TEST",
            &[arr(vec![10.0, 20.0]), arr(vec![20.0, 20.0, 20.0])],
        ),
        CellError::Na,
        "CHISQ.TEST diff lengths",
    );
}

#[test]
fn test_chisq_test_2d_contingency_registry() {
    // 2x2: df = (2-1)*(2-1) = 1
    // obs=[[10,20],[30,40]], exp=[[15,15],[35,35]]
    // chi2 = 25/15 + 25/15 + 25/35 + 25/35 ≈ 4.762, df=1
    // p ≈ 0.029
    let reg = crate::FunctionRegistry::new();
    let obs = CellValue::from_rows(vec![vec![num(10.0), num(20.0)], vec![num(30.0), num(40.0)]]);
    let exp = CellValue::from_rows(vec![vec![num(15.0), num(15.0)], vec![num(35.0), num(35.0)]]);
    assert_num(
        reg.call("CHISQ.TEST", &[obs, exp]),
        0.029,
        0.005,
        "CHISQ.TEST 2D",
    );
}

#[test]
fn test_chitest_legacy_alias() {
    let reg = crate::FunctionRegistry::new();
    let obs = arr(vec![10.0, 20.0, 30.0]);
    let exp = arr(vec![20.0, 20.0, 20.0]);
    let r1 = reg.call("CHISQ.TEST", &[obs.clone(), exp.clone()]);
    let r2 = reg.call("CHITEST", &[obs, exp]);
    assert_eq!(r1, r2, "CHITEST should equal CHISQ.TEST");
}

#[test]
fn test_ztest_mean_equals_hypothesis() {
    // {1,2,3,4,5}, mu=3: mean=3, z=0, p = 1-Phi(0) = 0.5
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("Z.TEST", &[arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]), num(3.0)]),
        0.5,
        1e-4,
        "Z.TEST mean=hyp",
    );
}

#[test]
fn test_ztest_mean_above_hypothesis() {
    // {1,2,3,4,5}, mu=0: z ≈ 4.24 => p near 0
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("Z.TEST", &[arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]), num(0.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            n.get() < 0.001 && n.get() > 0.0,
            "Z.TEST p near 0, got {}",
            n.get()
        );
    } else {
        panic!("Z.TEST expected number, got {result:?}");
    }
}

#[test]
fn test_ztest_mean_below_hypothesis() {
    // {1,2,3,4,5}, mu=6: z negative => p near 1
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("Z.TEST", &[arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]), num(6.0)]);
    if let CellValue::Number(n) = result {
        assert!(n.get() > 0.99, "Z.TEST p near 1, got {}", n.get());
    } else {
        panic!("Z.TEST expected number, got {result:?}");
    }
}

#[test]
fn test_ztest_with_explicit_sigma() {
    // {1,2,3,4,5}, mu=0, sigma=1: z = 3/(1/sqrt(5)) ≈ 6.708 => p very small
    let reg = crate::FunctionRegistry::new();
    let result = reg.call(
        "Z.TEST",
        &[arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]), num(0.0), num(1.0)],
    );
    if let CellValue::Number(n) = result {
        assert!(n.get() < 1e-6, "Z.TEST sigma=1 p tiny, got {}", n.get());
    } else {
        panic!("Z.TEST expected number, got {result:?}");
    }
}

#[test]
fn test_ztest_single_element_no_sigma_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("Z.TEST", &[arr(vec![5.0]), num(3.0)]),
        CellError::Num,
        "Z.TEST single no sigma",
    );
}

#[test]
fn test_ztest_sigma_zero_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("Z.TEST", &[arr(vec![1.0, 2.0, 3.0]), num(2.0), num(0.0)]),
        CellError::Num,
        "Z.TEST sigma=0",
    );
}

#[test]
fn test_ztest_sigma_negative_error() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("Z.TEST", &[arr(vec![1.0, 2.0, 3.0]), num(2.0), num(-1.0)]),
        CellError::Num,
        "Z.TEST sigma<0",
    );
}

#[test]
fn test_ztest_legacy_alias() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let r1 = reg.call("Z.TEST", &[data.clone(), num(3.0)]);
    let r2 = reg.call("ZTEST", &[data, num(3.0)]);
    assert_eq!(r1, r2, "ZTEST should equal Z.TEST");
}
