use value_types::CellValue;

/// Relative-epsilon tolerance for numeric comparison.
const NUMERIC_EPSILON: f64 = 1e-12;

/// Returns `true` when `v` is a finite number.
///
/// `NaN`, `Infinity`, and `-Infinity` are *not** considered numeric because
/// they cannot participate meaningfully in aggregation (sum, average, etc.).
///
/// Only `CellValue::Number(n)` where `n.is_finite()` returns `true`.
#[inline]
#[must_use]
pub fn cell_value_is_numeric(v: &CellValue) -> bool {
    matches!(v, CellValue::Number(n) if n.is_finite())
}

/// Pivot-aware equality for `CellValue`.
///
/// # Rules
///
/// - **Blanks**: all blank values are equal to each other, even across types
///   (`Null == Text("") == Text("  ")`).
/// - **Number**: relative-epsilon comparison using
///   `|a - b| / max(|a|, |b|, MIN_POSITIVE) < 1e-12`.
/// - **Text**: case-insensitive Unicode comparison via `.to_lowercase()`.
/// - **Boolean**: exact match.
/// - **Error**: compare by error variant (uses derived `PartialEq`).
/// - **Cross-type** (other than blanks): always `false`.
#[must_use]
pub fn cell_value_eq(a: &CellValue, b: &CellValue) -> bool {
    let a_blank = a.is_visually_blank();
    let b_blank = b.is_visually_blank();

    if a_blank || b_blank {
        return a_blank && b_blank;
    }

    match (a, b) {
        (CellValue::Number(x), CellValue::Number(y)) => {
            if x.to_bits() == y.to_bits() {
                return true;
            }
            let diff = (x.get() - y.get()).abs();
            let denom = x.abs().max(y.abs()).max(f64::MIN_POSITIVE);
            diff / denom < NUMERIC_EPSILON
        }
        (CellValue::Text(a_text), CellValue::Text(b_text)) => {
            if a_text.eq_ignore_ascii_case(b_text) {
                true
            } else if a_text.is_ascii() && b_text.is_ascii() {
                false
            } else {
                a_text.to_lowercase() == b_text.to_lowercase()
            }
        }
        (CellValue::Boolean(a_bool), CellValue::Boolean(b_bool)) => a_bool == b_bool,
        (CellValue::Error(a_err, None), CellValue::Error(b_err, None)) => a_err == b_err,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use value_types::{CellError, CellValue};

    use super::*;

    #[test]
    fn test_is_numeric_finite() {
        assert!(cell_value_is_numeric(&CellValue::number(42.0)));
        assert!(cell_value_is_numeric(&CellValue::number(-3.14)));
        assert!(cell_value_is_numeric(&CellValue::number(0.0)));
    }

    #[test]
    fn test_is_not_numeric_nan() {
        assert!(!cell_value_is_numeric(&CellValue::number(f64::NAN)));
    }

    #[test]
    fn test_is_not_numeric_infinity() {
        assert!(!cell_value_is_numeric(&CellValue::number(f64::INFINITY)));
        assert!(!cell_value_is_numeric(&CellValue::number(
            f64::NEG_INFINITY
        )));
    }

    #[test]
    fn test_is_not_numeric_non_number() {
        assert!(!cell_value_is_numeric(&CellValue::Text("42".into())));
        assert!(!cell_value_is_numeric(&CellValue::Boolean(true)));
        assert!(!cell_value_is_numeric(&CellValue::Null));
    }

    #[test]
    fn test_eq_blanks_cross_type() {
        assert!(cell_value_eq(&CellValue::Null, &CellValue::Null));
        assert!(cell_value_eq(&CellValue::Null, &CellValue::Text("".into())));
        assert!(cell_value_eq(
            &CellValue::Null,
            &CellValue::Text("  ".into())
        ));
        assert!(cell_value_eq(
            &CellValue::Text("".into()),
            &CellValue::Text("\t\n".into())
        ));
    }

    #[test]
    fn test_eq_blank_vs_non_blank() {
        assert!(!cell_value_eq(&CellValue::Null, &CellValue::number(0.0)));
        assert!(!cell_value_eq(&CellValue::Null, &CellValue::Boolean(false)));
        assert!(!cell_value_eq(
            &CellValue::Null,
            &CellValue::Text("hello".into())
        ));
    }

    #[test]
    fn test_eq_numbers_exact() {
        assert!(cell_value_eq(
            &CellValue::number(42.0),
            &CellValue::number(42.0)
        ));
    }

    #[test]
    fn test_eq_numbers_relative_epsilon_large() {
        let a = 1_000_000_000_000_000.0_f64;
        let b = a + 0.5;
        assert!(cell_value_eq(&CellValue::number(a), &CellValue::number(b)));
    }

    #[test]
    fn test_eq_numbers_relative_epsilon_small() {
        let a = 1e-15_f64;
        let b = 1e-15_f64 + 1e-28;
        assert!(cell_value_eq(&CellValue::number(a), &CellValue::number(b)));
    }

    #[test]
    fn test_eq_numbers_zero() {
        assert!(cell_value_eq(
            &CellValue::number(0.0),
            &CellValue::number(-0.0)
        ));
    }

    #[test]
    fn test_neq_numbers_different() {
        assert!(!cell_value_eq(
            &CellValue::number(1.0),
            &CellValue::number(2.0)
        ));
    }

    #[test]
    fn test_eq_tiny_numbers_100pct_relative_diff() {
        assert!(!cell_value_eq(
            &CellValue::number(1e-15),
            &CellValue::number(2e-15)
        ));
    }

    #[test]
    fn test_eq_large_numbers_tiny_relative_diff() {
        assert!(cell_value_eq(
            &CellValue::number(1e15),
            &CellValue::number(1e15 + 1.0)
        ));
    }

    #[test]
    fn test_eq_text_case_insensitive() {
        assert!(cell_value_eq(
            &CellValue::Text("Hello".into()),
            &CellValue::Text("hello".into())
        ));
        assert!(cell_value_eq(
            &CellValue::Text("WORLD".into()),
            &CellValue::Text("world".into())
        ));
    }

    #[test]
    fn test_neq_text_different() {
        assert!(!cell_value_eq(
            &CellValue::Text("abc".into()),
            &CellValue::Text("def".into())
        ));
    }

    #[test]
    fn test_eq_unicode_case_folding_german_eszett() {
        let result = cell_value_eq(
            &CellValue::Text("Straße".into()),
            &CellValue::Text("STRASSE".into()),
        );
        assert!(!result);
    }

    #[test]
    fn test_eq_booleans() {
        assert!(cell_value_eq(
            &CellValue::Boolean(true),
            &CellValue::Boolean(true)
        ));
        assert!(!cell_value_eq(
            &CellValue::Boolean(true),
            &CellValue::Boolean(false)
        ));
    }

    #[test]
    fn test_eq_errors() {
        assert!(cell_value_eq(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Div0, None)
        ));
        assert!(!cell_value_eq(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Na, None)
        ));
    }

    #[test]
    fn test_eq_errors_with_messages_do_not_compare_equal() {
        assert!(!cell_value_eq(
            &CellValue::Error(CellError::Div0, Some("a".into())),
            &CellValue::Error(CellError::Div0, Some("a".into()))
        ));
    }

    #[test]
    fn test_neq_cross_type() {
        assert!(!cell_value_eq(
            &CellValue::number(42.0),
            &CellValue::Text("42".into())
        ));
        assert!(!cell_value_eq(
            &CellValue::Boolean(true),
            &CellValue::number(1.0)
        ));
    }

    #[test]
    fn test_eq_cross_type_number_zero_vs_boolean_false() {
        assert!(!cell_value_eq(
            &CellValue::number(0.0),
            &CellValue::Boolean(false)
        ));
    }

    #[test]
    fn test_eq_cross_type_number_one_vs_boolean_true() {
        assert!(!cell_value_eq(
            &CellValue::number(1.0),
            &CellValue::Boolean(true)
        ));
    }
}
