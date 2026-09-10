use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_norm_dist() {
    let f = FnNormDist;
    // CDF: NORM.DIST(0, 0, 1, TRUE) = 0.5
    let result = f.call(&[num(0.0), num(0.0), num(1.0), CellValue::Boolean(true)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 0.5).abs() < 0.001,
            "norm.dist cdf(0) was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_norm_s_inv() {
    let f = FnNormSInv;
    // NORM.S.INV(0.5) = 0
    let result = f.call(&[num(0.5)]);
    if let CellValue::Number(n) = result {
        assert!(n.get().abs() < 0.001, "norm.s.inv(0.5) was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_standardize() {
    let f = FnStandardize;
    // STANDARDIZE(42, 40, 1.5) = (42-40)/1.5 = 1.333
    let result = f.call(&[num(42.0), num(40.0), num(1.5)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 1.333).abs() < 0.01,
            "standardize was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_norm_dist_nan_std_dev() {
    let f = FnNormDist;
    // NaN std_dev should return #NUM!, not panic
    let result = f.call(&[num(0.0), num(0.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_norm_dist_nan_mean() {
    let f = FnNormDist;
    // NaN mean should return #NUM!, not panic
    let result = f.call(&[num(0.0), num(f64::NAN), num(1.0), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_norm_inv_nan_std_dev() {
    let f = FnNormInv;
    // NaN std_dev should return #NUM!, not panic
    let result = f.call(&[num(0.5), num(0.0), num(f64::NAN)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_norm_dist_cdf_at_mean() {
    assert_dist_near(
        FnNormDist.call(&[num(0.0), num(0.0), num(1.0), bv(true)]),
        0.5,
        "NORM.DIST(0,0,1,TRUE)",
    );
}

#[test]
fn test_norm_dist_cdf_at_plus1() {
    assert_dist_near(
        FnNormDist.call(&[num(1.0), num(0.0), num(1.0), bv(true)]),
        0.8413,
        "NORM.DIST(1,0,1,TRUE)",
    );
}

#[test]
fn test_norm_dist_cdf_at_minus1() {
    assert_dist_near(
        FnNormDist.call(&[num(-1.0), num(0.0), num(1.0), bv(true)]),
        0.1587,
        "NORM.DIST(-1,0,1,TRUE)",
    );
}

#[test]
fn test_norm_dist_pdf_at_mean() {
    assert_dist_near(
        FnNormDist.call(&[num(0.0), num(0.0), num(1.0), bv(false)]),
        0.3989,
        "NORM.DIST(0,0,1,FALSE) = 1/sqrt(2pi)",
    );
}

#[test]
fn test_norm_dist_cdf_196() {
    assert_dist_near(
        FnNormDist.call(&[num(1.96), num(0.0), num(1.0), bv(true)]),
        0.975,
        "NORM.DIST(1.96,0,1,TRUE)",
    );
}

#[test]
fn test_norm_dist_cdf_minus196() {
    assert_dist_near(
        FnNormDist.call(&[num(-1.96), num(0.0), num(1.0), bv(true)]),
        0.025,
        "NORM.DIST(-1.96,0,1,TRUE)",
    );
}

#[test]
fn test_norm_dist_nonstandard() {
    assert_dist_near(
        FnNormDist.call(&[num(110.0), num(100.0), num(15.0), bv(true)]),
        0.7475,
        "NORM.DIST(110,100,15,TRUE)",
    );
}

#[test]
fn test_norm_dist_negative_std_dev_error() {
    assert_num_err(
        FnNormDist.call(&[num(0.0), num(0.0), num(-1.0), bv(true)]),
        "NORM.DIST neg sd",
    );
}

#[test]
fn test_norm_dist_zero_std_dev_error() {
    assert_num_err(
        FnNormDist.call(&[num(0.0), num(0.0), num(0.0), bv(true)]),
        "NORM.DIST zero sd",
    );
}

#[test]
fn test_normdist_legacy_delegates() {
    assert_dist_near(
        FnNormDistLegacy.call(&[num(0.0), num(0.0), num(1.0), bv(true)]),
        0.5,
        "NORMDIST legacy",
    );
}

#[test]
fn test_norm_inv_at_median() {
    assert_dist_near(
        FnNormInv.call(&[num(0.5), num(0.0), num(1.0)]),
        0.0,
        "NORM.INV(0.5,0,1)",
    );
}

#[test]
fn test_norm_inv_975() {
    assert_dist_near(
        FnNormInv.call(&[num(0.975), num(0.0), num(1.0)]),
        1.96,
        "NORM.INV(0.975,0,1)",
    );
}

#[test]
fn test_norm_inv_025() {
    assert_dist_near(
        FnNormInv.call(&[num(0.025), num(0.0), num(1.0)]),
        -1.96,
        "NORM.INV(0.025,0,1)",
    );
}

#[test]
fn test_norm_inv_error_p_zero() {
    assert_num_err(
        FnNormInv.call(&[num(0.0), num(0.0), num(1.0)]),
        "NORM.INV p=0",
    );
}

#[test]
fn test_norm_inv_error_p_one() {
    assert_num_err(
        FnNormInv.call(&[num(1.0), num(0.0), num(1.0)]),
        "NORM.INV p=1",
    );
}

#[test]
fn test_norminv_legacy_delegates() {
    assert_dist_near(
        FnNormInvLegacy.call(&[num(0.5), num(0.0), num(1.0)]),
        0.0,
        "NORMINV",
    );
}

#[test]
fn test_norm_s_dist_cdf_at_zero() {
    assert_dist_near(
        FnNormSDist.call(&[num(0.0), bv(true)]),
        0.5,
        "NORM.S.DIST(0,TRUE)",
    );
}

#[test]
fn test_norm_s_dist_pdf_at_zero() {
    assert_dist_near(
        FnNormSDist.call(&[num(0.0), bv(false)]),
        0.3989,
        "NORM.S.DIST(0,FALSE)",
    );
}

#[test]
fn test_norm_s_dist_cdf_196() {
    assert_dist_near(
        FnNormSDist.call(&[num(1.96), bv(true)]),
        0.975,
        "NORM.S.DIST(1.96,TRUE)",
    );
}

#[test]
fn test_normsdist_legacy_cdf() {
    assert_dist_near(FnNormSDistLegacy.call(&[num(0.0)]), 0.5, "NORMSDIST(0)");
}

#[test]
fn test_norm_s_inv_at_half() {
    assert_dist_near(FnNormSInv.call(&[num(0.5)]), 0.0, "NORM.S.INV(0.5)");
}

#[test]
fn test_norm_s_inv_975() {
    assert_dist_near(FnNormSInv.call(&[num(0.975)]), 1.96, "NORM.S.INV(0.975)");
}

#[test]
fn test_norm_s_inv_error_bounds() {
    assert_num_err(FnNormSInv.call(&[num(0.0)]), "NORM.S.INV(0)");
    assert_num_err(FnNormSInv.call(&[num(1.0)]), "NORM.S.INV(1)");
}

#[test]
fn test_normsinv_legacy_delegates() {
    assert_dist_near(FnNormSInvLegacy.call(&[num(0.5)]), 0.0, "NORMSINV");
}

#[test]
fn test_standardize_basic_dist() {
    assert_dist_near(
        FnStandardize.call(&[num(42.0), num(40.0), num(1.5)]),
        1.3333,
        "STANDARDIZE(42,40,1.5)",
    );
}

#[test]
fn test_standardize_at_mean_dist() {
    assert_dist_near(
        FnStandardize.call(&[num(5.0), num(5.0), num(2.0)]),
        0.0,
        "STANDARDIZE at mean",
    );
}

#[test]
fn test_standardize_neg_sd_error() {
    assert_num_err(
        FnStandardize.call(&[num(1.0), num(0.0), num(-1.0)]),
        "STANDARDIZE neg sd",
    );
}

#[test]
fn test_norm_dist_pdf_standard() {
    let f = FnNormDist;
    let result = f.call(&[num(0.0), num(0.0), num(1.0), CellValue::Boolean(false)]);
    assert_num(result, 0.39894, 0.001, "NORM.DIST PDF at 0");
}

#[test]
fn test_norm_dist_cdf_nonstandard() {
    let f = FnNormDist;
    let result = f.call(&[num(10.0), num(10.0), num(2.0), CellValue::Boolean(true)]);
    assert_num(result, 0.5, 0.001, "NORM.DIST CDF at mean");
}

#[test]
fn test_norm_dist_pdf_nonstandard() {
    let f = FnNormDist;
    let result = f.call(&[num(10.0), num(10.0), num(2.0), CellValue::Boolean(false)]);
    assert_num(result, 0.19947, 0.001, "NORM.DIST PDF nonstandard");
}

#[test]
fn test_norm_dist_negative_std_dev() {
    let f = FnNormDist;
    assert_eq!(
        f.call(&[num(0.0), num(0.0), num(-1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_norm_dist_zero_std_dev() {
    let f = FnNormDist;
    assert_eq!(
        f.call(&[num(0.0), num(0.0), num(0.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_norm_s_dist_pdf() {
    let f = FnNormSDist;
    let result = f.call(&[num(0.0), CellValue::Boolean(false)]);
    assert_num(result, 0.39894, 0.001, "NORM.S.DIST PDF at 0");
}

#[test]
fn test_norm_s_dist_pdf_at_1() {
    let f = FnNormSDist;
    let result = f.call(&[num(1.0), CellValue::Boolean(false)]);
    assert_num(result, 0.24197, 0.001, "NORM.S.DIST PDF at 1");
}

#[test]
fn test_norm_inv_p_zero() {
    assert_eq!(
        FnNormInv.call(&[num(0.0), num(0.0), num(1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_norm_inv_p_one() {
    assert_eq!(
        FnNormInv.call(&[num(1.0), num(0.0), num(1.0)]),
        err(CellError::Num)
    );
}

fn number(result: CellValue, label: &str) -> f64 {
    match result {
        CellValue::Number(value) => value.get(),
        other => panic!("{label}: expected Number, got {other:?}"),
    }
}

#[test]
fn test_normal_cdf_reference_grid_and_symmetry() {
    // Reference values from the AS 241 test table (z = 0..4), extended with
    // the corresponding standard-normal tail values for coverage of both
    // branches of the erfc approximation.
    let references = [
        (-8.0, 6.220960574271819e-16),
        (-5.0, 2.866515718791946e-7),
        (-3.0, 0.0013498980316300957),
        (-2.0, 0.02275013194817922),
        (-1.0, 0.15865525393145707),
        (-0.5, 0.30853753872598694),
        (0.0, 0.5),
        (0.5, 0.691462461274013),
        (1.0, 0.8413447460685429),
        (2.0, 0.9772498680518208),
        (3.0, 0.9986501019683699),
        (5.0, 0.9999997133484281),
        (8.0, 0.9999999999999993),
    ];

    for (z, expected) in references {
        let actual = number(
            FnNormSDist.call(&[num(z), bv(true)]),
            "NORM.S.DIST reference",
        );
        assert!(
            (actual - expected).abs() <= 2.0e-15,
            "NORM.S.DIST({z}) expected {expected:.17e}, got {actual:.17e}"
        );
    }

    for z in [0.125, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0] {
        let lower = number(
            FnNormSDist.call(&[num(-z), bv(true)]),
            "NORM.S.DIST symmetry lower",
        );
        let upper = number(
            FnNormSDist.call(&[num(z), bv(true)]),
            "NORM.S.DIST symmetry upper",
        );
        assert!(
            (lower + upper - 1.0).abs() <= 8.0 * f64::EPSILON,
            "Phi(-{z}) + Phi({z}) was {:.17e}",
            lower + upper
        );
    }
}

#[test]
fn test_normal_inverse_reference_grid_and_symmetry() {
    // AS 241 (Wichura, Applied Statistics 37 (1988), 477-484) reference
    // probabilities cover the central approximation and both inverse tails.
    let references = [
        (0.001, -3.090232306167813),
        (0.025, -1.9599639845400538),
        (0.1, -1.2815515655446008),
        (0.5, 0.0),
        (0.9, 1.2815515655446008),
        (0.975, 1.9599639845400536),
        (0.999, 3.090232306167813),
    ];

    for (probability, expected) in references {
        let actual = number(FnNormSInv.call(&[num(probability)]), "NORM.S.INV reference");
        assert!(
            (actual - expected).abs() <= 4.0e-15,
            "NORM.S.INV({probability}) expected {expected:.17e}, got {actual:.17e}"
        );
    }

    for probability in [0.001, 0.025, 0.1, 0.25, 0.5] {
        let lower = number(
            FnNormSInv.call(&[num(probability)]),
            "NORM.S.INV symmetry lower",
        );
        let upper = number(
            FnNormSInv.call(&[num(1.0 - probability)]),
            "NORM.S.INV symmetry upper",
        );
        assert!(
            (lower + upper).abs() <= 8.0 * f64::EPSILON,
            "Phi^-1({probability}) + Phi^-1({}) was {:.17e}",
            1.0 - probability,
            lower + upper
        );
    }
}

#[test]
fn test_normal_inverse_independent_lower_tail_oracle() {
    // Independent Cephes/SciPy oracle: ndtri(1e-16) =
    // -8.222082216130435. This is a direct quantile check rather than a
    // CDF/inverse round trip, so a shared approximation error cannot cancel.
    let actual = number(
        FnNormSInv.call(&[num(1.0e-16)]),
        "NORM.S.INV(1e-16) lower-tail oracle",
    );
    let expected = -8.222082216130435;
    assert!(
        (actual - expected).abs() <= 2.0e-15,
        "NORM.S.INV(1e-16) expected {expected:.17e}, got {actual:.17e}"
    );
}

#[test]
fn test_normal_corpus_stress_inputs() {
    // These are the actual normal-family inputs found in the frozen
    // tier_a_formula_stress_test residual corpus: z = 1/3, 3, and 2.
    let one_third = number(
        FnNormDist.call(&[num(0.0), num(-1.0), num(3.0), bv(true)]),
        "NORM.DIST(0,-1,3,TRUE)",
    );
    assert!((one_third - 0.6305586598182363).abs() <= 4.0e-16);

    let three = number(
        FnNormSDist.call(&[num(3.0), bv(true)]),
        "NORM.S.DIST(3,TRUE)",
    );
    assert!((three - 0.9986501019683699).abs() <= 4.0e-16);

    let two = number(
        FnNormSDist.call(&[num(2.0), bv(true)]),
        "NORM.S.DIST(2,TRUE)",
    );
    assert!((two - 0.9772498680518208).abs() <= 4.0e-16);

    // Round trips use the computed CDF, so this checks the inverse without
    // baking a workbook cache value into the implementation contract.
    let one_third_inverse = number(
        FnNormInv.call(&[num(one_third), num(-1.0), num(3.0)]),
        "NORM.INV(NORM.DIST(0,-1,3,TRUE),-1,3)",
    );
    assert!(one_third_inverse.abs() <= 4.0e-15);

    let three_inverse = number(
        FnNormSInv.call(&[num(three)]),
        "NORM.S.INV(NORM.S.DIST(3,TRUE))",
    );
    assert!((three_inverse - 3.0).abs() <= 4.0e-15);

    let two_inverse = number(
        FnNormSInv.call(&[num(two)]),
        "NORM.S.INV(NORM.S.DIST(2,TRUE))",
    );
    assert!((two_inverse - 2.0).abs() <= 4.0e-15);
}

#[test]
fn test_norm_s_inv_p_zero() {
    assert_eq!(FnNormSInv.call(&[num(0.0)]), err(CellError::Num));
}

#[test]
fn test_norm_s_inv_p_one() {
    assert_eq!(FnNormSInv.call(&[num(1.0)]), err(CellError::Num));
}

#[test]
fn test_normsdist_legacy() {
    assert_num(
        FnNormSDistLegacy.call(&[num(0.0)]),
        0.5,
        0.001,
        "NORMSDIST(0)",
    );
}

#[test]
fn test_normdist_legacy_delegates_v2() {
    let args = [num(1.0), num(0.0), num(1.0), CellValue::Boolean(true)];
    assert_eq!(FnNormDist.call(&args), FnNormDistLegacy.call(&args));
}

#[test]
fn test_norminv_legacy_delegates_v2() {
    let args = [num(0.5), num(0.0), num(1.0)];
    assert_eq!(FnNormInv.call(&args), FnNormInvLegacy.call(&args));
}

#[test]
fn test_normsinv_legacy_delegates_v2() {
    assert_eq!(
        FnNormSInv.call(&[num(0.5)]),
        FnNormSInvLegacy.call(&[num(0.5)])
    );
}

#[test]
fn test_standardize_zero_std_dev() {
    assert_eq!(
        FnStandardize.call(&[num(1.0), num(0.0), num(0.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_standardize_negative_std_dev() {
    assert_eq!(
        FnStandardize.call(&[num(1.0), num(0.0), num(-1.0)]),
        err(CellError::Num)
    );
}
