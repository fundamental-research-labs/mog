macro_rules! assert_approx {
    ($a:expr, $b:expr) => {
        assert_approx!($a, $b, 1e-10)
    };
    ($a:expr, $b:expr, $eps:expr) => {
        assert!(
            ($a - $b).abs() < $eps,
            "assert_approx failed: left = {:?}, right = {:?} (eps = {:?})",
            $a,
            $b,
            $eps
        );
    };
}

mod config;
mod edge_cases;
mod grid;
mod helpers;
mod histogram;
mod rows;
