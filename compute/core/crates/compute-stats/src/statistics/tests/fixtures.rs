// Helper: approximate equality for floats
pub(super) fn approx_eq(a: f64, b: f64, eps: f64) -> bool {
    if a.is_nan() && b.is_nan() {
        return true;
    }
    if a.is_infinite() && b.is_infinite() {
        return a.signum() == b.signum();
    }
    (a - b).abs() < eps
}

macro_rules! assert_approx {
    ($a:expr, $b:expr) => {
        assert_approx!($a, $b, 1e-10)
    };
    ($a:expr, $b:expr, $eps:expr) => {
        assert!(
            approx_eq($a, $b, $eps),
            "assert_approx failed: left = {:?}, right = {:?} (eps = {:?})",
            $a,
            $b,
            $eps
        );
    };
}

pub(crate) use assert_approx;
