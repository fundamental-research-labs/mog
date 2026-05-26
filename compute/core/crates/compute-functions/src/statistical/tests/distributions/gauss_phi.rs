use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_gauss_at_zero() {
    assert_dist_near(FnGauss.call(&[num(0.0)]), 0.0, "GAUSS(0)");
}

#[test]
fn test_gauss_at_196() {
    assert_dist_near(FnGauss.call(&[num(1.96)]), 0.475, "GAUSS(1.96)=0.975-0.5");
}

#[test]
fn test_phi_at_zero() {
    assert_dist_near(FnPhi.call(&[num(0.0)]), 0.3989, "PHI(0)");
}

#[test]
fn test_phi_at_one() {
    assert_dist_near(FnPhi.call(&[num(1.0)]), 0.2420, "PHI(1)");
}

#[test]
fn test_gauss_basic() {
    assert_num(FnGauss.call(&[num(0.0)]), 0.0, 0.001, "GAUSS(0)");
}

#[test]
fn test_gauss_positive() {
    assert_num(FnGauss.call(&[num(1.0)]), 0.3413, 0.001, "GAUSS(1)");
}

#[test]
fn test_gauss_negative() {
    assert_num(FnGauss.call(&[num(-1.0)]), -0.3413, 0.001, "GAUSS(-1)");
}

#[test]
fn test_phi_at_zero_v2() {
    assert_num(FnPhi.call(&[num(0.0)]), 0.39894, 0.001, "PHI(0)");
}

#[test]
fn test_phi_at_one_v2() {
    assert_num(FnPhi.call(&[num(1.0)]), 0.24197, 0.001, "PHI(1)");
}
