use super::super::arithmetic::{FnImProduct, FnImSub, FnImSum};
use super::super::components::{FnComplex, FnImAbs, FnImConjugate, FnImReal, FnImaginary};
use super::super::types::parse_complex;
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_complex() {
    let f = FnComplex;
    assert_eq!(f.call(&[num(3.0), num(4.0)]), text("3+4i"));
    assert_eq!(f.call(&[num(3.0), num(4.0), text("j")]), text("3+4j"));
    assert_eq!(f.call(&[num(0.0), num(1.0)]), text("i"));
    assert_eq!(f.call(&[num(1.0), num(0.0)]), text("1"));
}

#[test]
fn test_imabs() {
    let f = FnImAbs;
    assert_eq!(f.call(&[text("3+4i")]), num(5.0));
}

#[test]
fn test_imaginary() {
    let f = FnImaginary;
    assert_eq!(f.call(&[text("3+4i")]), num(4.0));
}

#[test]
fn test_imreal() {
    let f = FnImReal;
    assert_eq!(f.call(&[text("3+4i")]), num(3.0));
}

#[test]
fn test_imsum() {
    let f = FnImSum;
    assert_eq!(f.call(&[text("3+4i"), text("5+3i")]), text("8+7i"));
}

#[test]
fn test_imsub() {
    let f = FnImSub;
    assert_eq!(f.call(&[text("13+4i"), text("5+3i")]), text("8+i"));
}

#[test]
fn test_improduct() {
    let f = FnImProduct;
    // (3+4i)(1+2i) = (3-8)+(6+4)i = -5+10i
    assert_eq!(f.call(&[text("3+4i"), text("1+2i")]), text("-5+10i"));
}

#[test]
fn test_imconjugate() {
    let f = FnImConjugate;
    assert_eq!(f.call(&[text("3+4i")]), text("3-4i"));
}

#[test]
fn test_parse_complex_cases() {
    assert_eq!(parse_complex("3"), Some((3.0, 0.0, 'i')));
    assert_eq!(parse_complex("4i"), Some((0.0, 4.0, 'i')));
    assert_eq!(parse_complex("i"), Some((0.0, 1.0, 'i')));
    assert_eq!(parse_complex("-i"), Some((0.0, -1.0, 'i')));
    assert_eq!(parse_complex("3+4i"), Some((3.0, 4.0, 'i')));
    assert_eq!(parse_complex("3-4j"), Some((3.0, -4.0, 'j')));
    assert_eq!(parse_complex("0"), Some((0.0, 0.0, 'i')));
}

#[test]
fn test_parse_complex_empty() {
    assert_eq!(parse_complex(""), None);
}

#[test]
fn test_parse_complex_plus_i() {
    assert_eq!(parse_complex("+i"), Some((0.0, 1.0, 'i')));
}

#[test]
fn test_parse_complex_j_suffix() {
    assert_eq!(parse_complex("3+4j"), Some((3.0, 4.0, 'j')));
}

#[test]
fn test_parse_complex_negative_real() {
    assert_eq!(parse_complex("-5"), Some((-5.0, 0.0, 'i')));
}

#[test]
fn test_parse_complex_garbage() {
    assert_eq!(parse_complex("hello"), None);
}

// =====================================================================
// format_complex — via COMPLEX function round-trips
// =====================================================================

#[test]
fn test_format_complex_large_integer() {
    assert_eq!(FnComplex.call(&[num(100.0), num(200.0)]), text("100+200i"));
}

#[test]
fn complex_serialization_retains_tiny_finite_components_and_exact_zero() {
    for suffix in ["i", "j"] {
        for (re, im, expected) in [
            (1e-15, 0.0, "1E-15".to_string()),
            (f64::from_bits(1), 0.0, "4.94065645841247E-324".to_string()),
            (0.0, 1e-320, format!("9.99988867182683E-321{suffix}")),
            (0.0, -1e-20, format!("-1E-20{suffix}")),
            (1e-300, -1e-307, format!("1E-300-1E-307{suffix}")),
            (2.0, 1e-20, format!("2+1E-20{suffix}")),
            (-0.0, 0.0, "0".to_string()),
            (0.0, -1.0, format!("-{suffix}")),
        ] {
            let result = FnComplex.call(&[num(re), num(im), text(suffix)]);
            assert_eq!(result, text(&expected));
            let parsed = parse_complex(result.as_text().unwrap()).unwrap();
            if re != 0.0 {
                assert_ne!(parsed.0, 0.0);
            }
            if im != 0.0 {
                assert_ne!(parsed.1, 0.0);
            }
        }
    }
    assert_eq!(FnImConjugate.call(&[text("2+1e-20j")]), text("2-1E-20j"));
    assert_eq!(
        FnImSub.call(&[text("1e-15+1e-20i"), text("1e-15")]),
        text("1E-20i")
    );
}

#[test]
fn complex_serialization_matches_excel_golden_function_results() {
    let registry = crate::FunctionRegistry::new();
    // Independently Excel-evaluated result strings for the literal argument "2+3j".
    for (name, expected) in [
        ("IMCOS", "-4.18962569096881-9.10922789375534j"),
        ("IMEXP", "-7.3151100949011+1.0427436562359j"),
        ("IMLN", "1.28247467873077+0.982793723247329j"),
        ("IMLOG10", "0.556971676153418+0.426821890855467j"),
        ("IMLOG2", "1.85021985907055+1.41787163074572j"),
        ("IMSIN", "9.15449914691143-4.16890695996656j"),
        ("IMSQRT", "1.67414922803554+0.895977476129838j"),
    ] {
        assert_eq!(
            registry.call(name, &[text("2+3j")]),
            text(expected),
            "{name}"
        );
    }
    assert_eq!(
        registry.call("IMPOWER", &[text("2+3j"), num(2.0)]),
        text("-5+12j")
    );
    // Division consumes the text produced by the logarithm functions. Rounding
    // and retaining tiny components both affect this downstream value.
    let numerator = registry.call("IMLOG2", &[text("2+3j")]);
    let denominator = registry.call("IMLOG10", &[text("2+3j")]);
    assert_eq!(
        registry.call("IMDIV", &[numerator, denominator]),
        text("3.32192809488737-8.28846662730513E-15j")
    );
}

#[test]
fn complex_finite_boundary_text_remains_a_finite_operand() {
    for value in [f64::MAX, -f64::MAX, f64::from_bits(f64::MAX.to_bits() - 1)] {
        let serialized = FnComplex.call(&[num(value), num(0.0)]);
        assert_eq!(FnImReal.call(&[serialized.clone()]), num(value));
        assert_eq!(FnImaginary.call(&[serialized]), num(0.0));
    }
}
