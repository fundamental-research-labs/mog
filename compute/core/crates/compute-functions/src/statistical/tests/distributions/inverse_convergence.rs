use crate::FunctionRegistry;
use value_types::CellValue;

fn num(value: f64) -> CellValue {
    CellValue::number(value)
}

#[test]
fn inverse_distributions_match_excel_golden_center_quantiles() {
    let registry = FunctionRegistry::new();
    // Probabilities are independently Excel-evaluated literal values,
    // independent of our forward CDFs.
    for (name, args, expected) in [
        ("BETA.INV", vec![num(0.5), num(2.0), num(2.0)], 0.5),
        ("BETAINV", vec![num(0.5), num(2.0), num(2.0)], 0.5),
        ("CHISQ.INV", vec![num(0.34003677030571738), num(7.0)], 5.0),
        (
            "F.INV",
            vec![num(0.53524199845511), num(2.0), num(3.0)],
            1.0000000000000002,
        ),
    ] {
        let result = registry.call(name, &args).as_number().expect(name);
        assert!(
            (result - expected).abs() <= 1e-11,
            "{name}: {result} versus {expected}"
        );
    }
}

#[test]
fn inverse_distributions_converge_through_right_tail_and_legacy_aliases() {
    let registry = FunctionRegistry::new();
    for (names, probability, params, expected) in [
        (
            ["CHISQ.INV.RT", "CHIINV"],
            1.0 - 0.34003677030571738,
            vec![num(7.0)],
            5.0,
        ),
        (
            ["F.INV.RT", "FINV"],
            1.0 - 0.53524199845511,
            vec![num(2.0), num(3.0)],
            1.0,
        ),
    ] {
        for name in names {
            let mut args = vec![num(probability)];
            args.extend(params.clone());
            let result = registry.call(name, &args).as_number().expect(name);
            assert!((result - expected).abs() <= 1e-11, "{name}: {result}");
        }
    }
    // Uniform beta is analytically exact across probabilities and scaled bounds.
    for p in [1e-12, 1e-6, 0.125, 0.5, 0.9, 1.0 - 1e-12] {
        let result = registry
            .call("BETA.INV", &[num(p), num(1.0), num(1.0)])
            .as_number()
            .unwrap();
        assert!((result - p).abs() <= p * 1e-12, "p={p}: {result}");
    }
    for p in [0.0, 1.0] {
        assert_eq!(
            registry.call(
                "BETA.INV",
                &[num(p), num(2.0), num(2.0), num(10.0), num(20.0)]
            ),
            num(10.0 + 10.0 * p)
        );
    }
}

#[test]
fn inverse_chi_squared_tails_match_the_exponential_identity() {
    let registry = FunctionRegistry::new();
    // Chi-square with two degrees of freedom is exponential: Q(p)=-2 ln(1-p),
    // and its survival quantile is -2 ln(p). These oracles do not use statrs.
    let p = f64::from_bits(1.0_f64.to_bits() - 1);
    let result = registry
        .call("CHISQ.INV", &[num(p), num(2.0)])
        .as_number()
        .unwrap();
    let expected = -2.0 * (-p).ln_1p();
    assert!((result - expected).abs() < 1e-12, "{result} != {expected}");
    for probability in [1e-12_f64, 1e-20, 1e-100, 1e-300] {
        let expected = -2.0 * probability.ln();
        for name in ["CHISQ.INV.RT", "CHIINV"] {
            let result = registry
                .call(name, &[num(probability), num(2.0)])
                .as_number()
                .unwrap();
            assert!(
                (result / expected - 1.0).abs() < 1e-13,
                "{name}({probability})={result}, expected {expected}"
            );
        }
    }
}

#[test]
fn inverse_symmetric_beta_resolves_both_tails() {
    let registry = FunctionRegistry::new();
    // For Beta(2,2), CDF(x)=3x²-2x³. Its cubic inverse can be written
    // without subtracting nearly equal values; symmetry supplies the upper tail.
    fn lower_quantile(p: f64) -> f64 {
        let angle = (2.0 / 3.0) * p.sqrt().asin();
        (angle / 2.0).sin().powi(2) + (3.0_f64.sqrt() / 2.0) * angle.sin()
    }
    for p in [1e-100_f64, 1e-20, 1e-12, 0.125] {
        let expected = lower_quantile(p);
        let result = registry
            .call("BETA.INV", &[num(p), num(2.0), num(2.0)])
            .as_number()
            .unwrap();
        assert!(
            (result / expected - 1.0).abs() < 1e-12,
            "BETA.INV({p},2,2)={result}, expected {expected}"
        );
    }
    for p in [1.0 - 1e-12, f64::from_bits(1.0_f64.to_bits() - 1)] {
        let expected = 1.0 - lower_quantile(1.0 - p);
        let result = registry
            .call("BETA.INV", &[num(p), num(2.0), num(2.0)])
            .as_number()
            .unwrap();
        assert!(
            (result - expected).abs() <= f64::EPSILON,
            "BETA.INV({p},2,2)={result}, expected {expected}"
        );
    }
}

#[test]
fn inverse_f_tails_match_the_rational_identity() {
    let registry = FunctionRegistry::new();
    // F(2,2) has CDF x/(1+x), so the right-tail quantile is (1-p)/p.
    // statrs 0.17's F survival function itself loses this tail by subtraction.
    for p in [1e-12_f64, 1e-20, 1e-100, 1e-300] {
        let expected = (1.0 - p) / p;
        for name in ["F.INV.RT", "FINV"] {
            let result = registry
                .call(name, &[num(p), num(2.0), num(2.0)])
                .as_number()
                .unwrap();
            assert!(
                (result / expected - 1.0).abs() < 1e-12,
                "{name}({p},2,2)={result}, expected {expected}"
            );
        }
    }
    let p = f64::from_bits(1.0_f64.to_bits() - 1);
    let expected = p / (1.0 - p);
    let result = registry
        .call("F.INV", &[num(p), num(2.0), num(2.0)])
        .as_number()
        .unwrap();
    assert!(
        (result / expected - 1.0).abs() < 1e-12,
        "F.INV({p},2,2)={result}, expected {expected}"
    );
}

#[test]
fn inverse_beta_asymmetric_quantiles_match_the_finite_polynomial() {
    let registry = FunctionRegistry::new();
    // Integrating the Beta(3,5) density gives this finite polynomial.
    // Fixed x values supply independent probabilities on both sides of the mean.
    for expected in [0.01_f64, 0.125, 0.5, 0.75] {
        let x = expected;
        let p = x.powi(3) * (35.0 + x * (-105.0 + x * (126.0 + x * (-70.0 + 15.0 * x))));
        let result = registry
            .call("BETA.INV", &[num(p), num(3.0), num(5.0)])
            .as_number()
            .unwrap();
        assert!(
            (result - expected).abs() < 1e-12,
            "BETA.INV({p},3,5)={result}, expected {expected}"
        );
    }
    // F(2,4) has survival function (1+x/2)^-2.
    for p in [1e-12_f64, 1e-100, 1e-300] {
        let expected = 2.0 * (1.0 / p.sqrt() - 1.0);
        let result = registry
            .call("F.INV.RT", &[num(p), num(2.0), num(4.0)])
            .as_number()
            .unwrap();
        assert!(
            (result / expected - 1.0).abs() < 1e-12,
            "F.INV.RT({p},2,4)={result}, expected {expected}"
        );
    }
}
