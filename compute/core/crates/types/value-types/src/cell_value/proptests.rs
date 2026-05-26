//! Property-based tests for [`CellValue`] and [`FiniteF64`].

use super::*;
use crate::FiniteF64;
use proptest::prelude::*;

/// Count significant digits in a numeric string (handles both fixed and
/// scientific notation like "1.23E+5" or "9.8E-20").
fn count_significant_digits(s: &str) -> usize {
    let s = s.trim_start_matches('-');
    // Strip exponent part if present (E+n, E-n)
    let mantissa = if let Some(pos) = s.find('E') {
        &s[..pos]
    } else {
        s
    };
    // For integers (no decimal point), trailing zeros are not significant
    // (they're padding from truncation). For decimals, trailing zeros were
    // already trimmed by the formatter.
    let mantissa = if mantissa.contains('.') {
        mantissa
    } else {
        mantissa.trim_end_matches('0')
    };
    // Count significant digits: skip leading zeros (before and after decimal
    // point), then count all remaining digits.
    let mut seen_nonzero = false;
    let mut count = 0;
    for ch in mantissa.chars() {
        if ch == '.' {
            continue;
        }
        if ch.is_ascii_digit() {
            if ch != '0' {
                seen_nonzero = true;
            }
            if seen_nonzero {
                count += 1;
            }
        }
    }
    count
}

proptest! {
    // Property: FiniteF64::new rejects NaN and Infinity, accepts all finite values
    #[test]
    fn finite_f64_rejects_non_finite(f in prop::num::f64::ANY) {
        if f.is_nan() || f.is_infinite() {
            prop_assert!(FiniteF64::new(f).is_none());
        } else {
            prop_assert!(FiniteF64::new(f).is_some());
        }
    }

    // Property: CellValue number display round-trips within 15 sig digits
    #[test]
    fn number_display_roundtrip(f in any::<f64>().prop_filter("finite", |f| f.is_finite())) {
        let cv = CellValue::Number(FiniteF64::new(f).unwrap());
        let display = cv.to_string();
        // Parse back -- need to handle E notation (our display uses E+/E-)
        let normalized = display.replace("E+", "e").replace("E-", "e-");
        let parsed: f64 = normalized.parse().unwrap();
        let rel_error = if f == 0.0 { parsed.abs() } else { ((parsed - f) / f).abs() };
        prop_assert!(rel_error < 1e-14, "Round-trip error {} for {}", rel_error, f);
    }

    // Property: Display output of a Number CellValue has <= 15 significant digits
    #[test]
    fn display_has_at_most_15_sig_digits(f in any::<f64>().prop_filter("finite", |f| f.is_finite())) {
        let cv = CellValue::Number(FiniteF64::new(f).unwrap());
        let display = cv.to_string();
        let sig_digits = count_significant_digits(&display);
        prop_assert!(sig_digits <= 15, "Got {} sig digits in '{}'", sig_digits, display);
    }

    // Property: FiniteF64 normalizes -0.0 to +0.0
    #[test]
    fn finite_f64_no_negative_zero(f in any::<f64>().prop_filter("finite", |f| f.is_finite())) {
        let ff = FiniteF64::new(f).unwrap();
        if f == 0.0 {
            prop_assert!(ff.get().is_sign_positive(), "FiniteF64 should normalize -0.0");
        }
    }

    // Any finite f64 produces CellValue::Number
    #[test]
    fn prop_number_from_finite(x in prop::num::f64::NORMAL) {
        let v = CellValue::number(x);
        prop_assert!(matches!(v, CellValue::Number(_)));
    }

    // NaN/Inf produce CellValue::Error
    #[test]
    fn prop_number_from_non_finite(x in prop::num::f64::ANY.prop_filter("non-finite", |x| !x.is_finite())) {
        let v = CellValue::number(x);
        prop_assert!(matches!(v, CellValue::Error(..)));
    }

    // Text equality is case-insensitive
    #[test]
    fn prop_text_case_insensitive(s in "[a-zA-Z]{1,20}") {
        let lower = CellValue::Text(std::sync::Arc::from(s.to_lowercase()));
        let upper = CellValue::Text(std::sync::Arc::from(s.to_uppercase()));
        prop_assert_eq!(lower, upper);
    }

    // Cross-validate: format_number output never exceeds 15 significant digits
    #[test]
    fn display_and_count_agree(n in prop::num::f64::NORMAL) {
        let formatted = format_number(n);
        let sig = count_significant_digits(&formatted);
        prop_assert!(sig <= 15, "format_number({n}) = {formatted} has {sig} sig digits");
    }
}
