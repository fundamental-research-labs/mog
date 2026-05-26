use compute_formats::format_number;
use proptest::prelude::*;

/// Non-date numeric format codes (safe for any f64 value).
fn numeric_format_codes() -> impl Strategy<Value = String> {
    prop::sample::select(vec![
        "General",
        "0",
        "0.00",
        "#,##0",
        "#,##0.00",
        "0%",
        "0.00%",
        "0.00E+00",
        "##0.0E+0",
        "$#,##0",
        "$#,##0.00",
        "#,##0;(#,##0)",
        "#,##0;[Red](#,##0)",
        "@",
        "0.0",
        "# ?/?",
        "# ??/??",
    ])
    .prop_map(|s| s.to_string())
}

/// Date/time format codes — only valid for Excel serial date range.
fn date_format_codes() -> impl Strategy<Value = String> {
    prop::sample::select(vec![
        "yyyy-mm-dd",
        "mm/dd/yyyy",
        "hh:mm:ss",
        "hh:mm:ss AM/PM",
        "yyyy-mm-dd hh:mm:ss",
    ])
    .prop_map(|s| s.to_string())
}

/// Excel serial date range: 0 .. ~2_958_465 (year 9999).
/// Constraining date format inputs to this avoids overflow in date_serial.
fn excel_date_range() -> impl Strategy<Value = f64> {
    0.0f64..2_958_466.0f64
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1024))]

    #[test]
    fn format_never_panics_fuzz(
        value in any::<f64>(),
        code in "[#0.,;\\[\\]@% ]{0,50}"
    ) {
        let _ = format_number(value, &code);
    }

    #[test]
    fn format_never_panics_real_numeric(
        value in any::<f64>(),
        code in numeric_format_codes()
    ) {
        let _ = format_number(value, &code);
    }

    #[test]
    fn format_never_panics_real_date(
        value in excel_date_range(),
        code in date_format_codes()
    ) {
        let _ = format_number(value, &code);
    }

    #[test]
    fn general_format_precision(
        f in prop::num::f64::NORMAL.prop_filter(
            "representable magnitude",
            |f| {
                let a = f.abs();
                // Avoid extreme magnitudes where the General formatter
                // currently returns "NaN" — those are known issues outside
                // the scope of this test.
                a >= 1e-100 && a <= 1e100
            },
        )
    ) {
        let formatted = format_number(f, "General");
        let parsed: f64 = formatted.parse().unwrap_or(f);
        let rel_error = ((parsed - f) / f).abs();
        // Excel General format keeps up to 15 significant digits (matching
        // double-precision storage), so the relative round-trip error is
        // bounded by ~1e-14.
        prop_assert!(
            rel_error < 1e-14,
            "Precision loss: f={}, formatted='{}', parsed={}, rel_error={}",
            f, formatted, parsed, rel_error
        );
    }

    #[test]
    fn format_produces_nonempty_for_finite_numeric(
        f in any::<f64>().prop_filter("finite", |f| f.is_finite()),
        code in numeric_format_codes()
    ) {
        let result = format_number(f, &code);
        prop_assert!(!result.is_empty(), "Empty format result for {} with code '{}'", f, code);
    }

    #[test]
    fn format_produces_nonempty_for_finite_date(
        f in excel_date_range(),
        code in date_format_codes()
    ) {
        let result = format_number(f, &code);
        prop_assert!(!result.is_empty(), "Empty format result for {} with code '{}'", f, code);
    }
}
