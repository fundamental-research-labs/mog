use super::{FnXirr, num};
use crate::PureFunction;
use value_types::CellValue;

fn assert_rate_bits(values: &[f64], days: &[f64], guess: f64, expected: f64) {
    let values = CellValue::from_rows(vec![values.iter().copied().map(num).collect()]);
    let dates = CellValue::from_rows(vec![days.iter().map(|day| num(45000.0 + day)).collect()]);
    match FnXirr.call(&[values, dates, num(guess)]) {
        CellValue::Number(actual) => assert_eq!(
            actual.get().to_bits(),
            expected.to_bits(),
            "guess {guess}: {} != {expected}",
            actual.get()
        ),
        other => panic!("expected native numeric result, got {other:?}"),
    }
}

// Native Excel 16.0 build 20430, en-US, COM-assigned formulas followed by Full.
// The expected values are observed results, not more accurate mathematical roots.
#[test]
fn xirr_native_nonnegative_controls() {
    let days = [0.0, 181.0, 365.0, 546.0, 730.0];
    let sets: [([f64; 5], [f64; 5]); 3] = [
        (
            [-10000.0, 3000.0, 4000.0, 5000.0, 2000.0],
            [
                0.33071877360343938,
                0.33071877360343938,
                0.3307187721133233,
                0.3307187736034394,
                0.33071877807378769,
            ],
        ),
        (
            [-50000.0, 15000.0, 15000.0, 15000.0, 15000.0],
            [
                0.16053324341773992,
                0.16053324341773992,
                0.16053324490785592,
                0.16053324341773992,
                0.16053323820233345,
            ],
        ),
        (
            [-1000.0, 500.0, 400.0, 300.0, 100.0],
            [
                0.31176053881645216,
                0.31176053881645216,
                0.31176054328680036,
                0.31176053881645216,
                0.31176053732633591,
            ],
        ),
    ];
    for (values, expected) in sets {
        for (guess, native) in [0.1, 0.2, 0.3, 0.4, 0.5].into_iter().zip(expected) {
            assert_rate_bits(&values, &days, guess, native);
        }
    }
    for scale in [1e-6, 1e6] {
        let values = [-50000.0, 15000.0, 15000.0, 15000.0, 15000.0].map(|x| x * scale);
        assert_rate_bits(&values, &days, 0.5, 0.16053323820233345);
    }
    for (payment, a, b) in [
        (1000.0, 2.9802322387695314e-9, 3.725290298461914e-9),
        (1100.0, 0.09999999403953552, 0.09999999776482582),
        (2000.0, 0.9999999880790711, 0.9999999850988388),
    ] {
        assert_rate_bits(&[-1000.0, payment], &[0.0, 365.0], 0.1, a);
        assert_rate_bits(&[-1000.0, payment], &[0.0, 365.0], 0.5, b);
    }
    for (guess, expected) in [
        (0.1, 5.315237760543824),
        (0.2, 5.315237760543824),
        (0.5, 5.315237730741501),
    ] {
        assert_rate_bits(
            &[-10000.0, 3000.0, 4200.0, 6800.0],
            &[0.0, 31.0, 59.0, 90.0],
            guess,
            expected,
        );
    }
}

#[test]
fn xirr_constant_curve_keeps_general_solver() {
    // Same-date cancelling cash flows have no strictly monotone rate curve.
    // Preserve the general solver's exact-zero behavior rather than selecting
    // an arbitrary narrow bracket close to zero.
    assert_rate_bits(&[-1000.0, 1000.0], &[0.0, 0.0], 0.1, 0.1);
}
