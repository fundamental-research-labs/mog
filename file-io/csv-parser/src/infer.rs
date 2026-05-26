//! Per-cell type inference.
//!
//! Returns `(CellValue, Option<u32 style_id>)` per CSV field. The `style_id`
//! indexes into a tiny per-import palette ([`StylePalette`]) — the parser
//! never invents a new format on the fly.
//!
//! The decision table mirrors the one locked in the structural-op plan:
//!
//! | Input shape (post-unquote)                     | CellValue       | Format       |
//! |------------------------------------------------|-----------------|--------------|
//! | Empty                                          | (omitted)       | —            |
//! | `'<text>` leading apostrophe                   | Text (stripped) | `@`          |
//! | Pure ASCII digits, leading `0`, len ≥ 2        | Text            | `@`          |
//! | Integer / decimal / scientific                 | Number          | `General`    |
//! | `TRUE` / `FALSE` (case-insensitive)            | Boolean         | `General`    |
//! | ISO date (`YYYY-MM-DD`) / en-US (`M/D/YYYY`)   | Number (serial) | `m/d/yyyy`   |
//! | Time `HH:MM[:SS]`                              | Number (frac)   | `h:mm:ss`    |
//! | Begins with `=`/`+`/`-`/`@`/`\t` (no opt-in)   | Text            | `@`          |
//! | Begins with `=` and `evaluate_formulas: true`  | (formula entry) | `General`    |
//! | Anything else                                  | Text            | `General`    |

use chrono::NaiveDate;

use value_types::CellValue;

/// Indices into the per-import style palette. Allocated once in
/// [`StylePalette::new`] so callers don't need to inspect the palette to
/// emit a `style_id`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct StylePalette {
    pub general: u32,
    pub date: u32,
    pub time: u32,
    pub text: u32,
}

impl StylePalette {
    /// The palette's order is **(General, m/d/yyyy, h:mm:ss, @)** — locked
    /// by the plan. Don't reorder; downstream tests assert on indices.
    pub(crate) fn new() -> (Self, Vec<domain_types::DocumentFormat>) {
        let general = make_format(None);
        let date = make_format(Some("m/d/yyyy"));
        let time = make_format(Some("h:mm:ss"));
        let text = make_format(Some("@"));
        let entries = vec![general, date, time, text];
        let palette = Self {
            general: 0,
            date: 1,
            time: 2,
            text: 3,
        };
        (palette, entries)
    }
}

fn make_format(number_format: Option<&str>) -> domain_types::DocumentFormat {
    domain_types::DocumentFormat {
        number_format: number_format.map(|s| s.to_string()),
        ..domain_types::DocumentFormat::default()
    }
}

/// Output of [`infer_cell`].
pub(crate) struct InferredCell {
    pub value: CellValue,
    pub style_id: Option<u32>,
    /// When the field began with `=` and `evaluate_formulas` was on, this
    /// is the formula text (already including the leading `=`). The
    /// parser-side wrapper (`parse_output_assembly.rs`) wires it into
    /// `CellData.formula`.
    pub formula: Option<String>,
}

/// Decide what to emit for one CSV field. Returns `None` for an empty
/// post-trim field — the caller skips empty fields entirely (no entry in
/// `cells`).
pub(crate) fn infer_cell(
    field: &str,
    palette: &StylePalette,
    evaluate_formulas: bool,
) -> Option<InferredCell> {
    if field.is_empty() {
        return None;
    }

    // 1. Leading apostrophe → forced-text. Strip the apostrophe, keep
    //    the rest verbatim, mark `@`.
    if let Some(rest) = field.strip_prefix('\'') {
        return Some(InferredCell {
            value: CellValue::Text(rest.into()),
            style_id: Some(palette.text),
            formula: None,
        });
    }

    // 2. Formula injection guard. Default = literal text. Opt-in path
    //    promotes leading `=` to a formula (and only `=`; `+1+2` style
    //    formulas were a Lotus 1-2-3 affordance Excel still honours, but
    //    we treat them as text by default and don't promote them on
    //    opt-in either — too ambiguous).
    if let Some(first) = field.chars().next()
        && matches!(first, '=' | '+' | '-' | '@' | '\t')
    {
        if evaluate_formulas && first == '=' {
            return Some(InferredCell {
                value: CellValue::Null,
                style_id: Some(palette.general),
                formula: Some(field.to_string()),
            });
        }
        // Negative numbers (`-42`, `-3.14`) and signed scientific
        // (`-1.2e3`) are still numbers — only treat as text if the
        // remainder after the sign isn't a valid number. The same goes
        // for `+`.
        if (first == '-' || first == '+') && parse_number(field).is_some() {
            // Falls through to the numeric path below.
        } else {
            return Some(InferredCell {
                value: CellValue::Text(field.into()),
                style_id: Some(palette.text),
                formula: None,
            });
        }
    }

    // 3. Leading-zero preservation. Pure ASCII digits (no decimal, no
    //    sign), starting with `0`, length ≥ 2 → text-with-`@` so SKUs
    //    survive the round-trip.
    if is_leading_zero_text(field) {
        return Some(InferredCell {
            value: CellValue::Text(field.into()),
            style_id: Some(palette.text),
            formula: None,
        });
    }

    // 4. Boolean.
    if field.eq_ignore_ascii_case("true") {
        return Some(InferredCell {
            value: CellValue::Boolean(true),
            style_id: Some(palette.general),
            formula: None,
        });
    }
    if field.eq_ignore_ascii_case("false") {
        return Some(InferredCell {
            value: CellValue::Boolean(false),
            style_id: Some(palette.general),
            formula: None,
        });
    }

    // 5. Date / time. ISO and en-US slash only.
    if let Some(serial) = parse_date_serial(field) {
        return Some(InferredCell {
            value: CellValue::number(serial),
            style_id: Some(palette.date),
            formula: None,
        });
    }
    if let Some(frac) = parse_time_fraction(field) {
        return Some(InferredCell {
            value: CellValue::number(frac),
            style_id: Some(palette.time),
            formula: None,
        });
    }

    // 6. Number (integer / decimal / scientific). After the leading-zero
    //    check above so `00123` isn't coerced.
    if let Some(n) = parse_number(field) {
        return Some(InferredCell {
            value: CellValue::number(n),
            style_id: Some(palette.general),
            formula: None,
        });
    }

    // 7. Default: text with General format.
    Some(InferredCell {
        value: CellValue::Text(field.into()),
        style_id: Some(palette.general),
        formula: None,
    })
}

/// `true` iff `s` is ≥ 2 ASCII digits and starts with `0`. Pure digits
/// only — no decimal point, no sign.
fn is_leading_zero_text(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() >= 2 && bytes[0] == b'0' && bytes.iter().all(|b| b.is_ascii_digit())
}

/// Parse a decimal / integer / scientific literal. Returns `None` if the
/// string isn't a clean number — caller falls through to text.
///
/// Excel-compatible: leading + is allowed (`+42`), thousand-separators
/// are not (`1,234` would be split by the CSV reader anyway).
fn parse_number(s: &str) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    let n: f64 = s.parse().ok()?;
    if n.is_nan() || n.is_infinite() {
        return None;
    }
    Some(n)
}

/// Parse a date string into the Excel serial (1900 epoch, 1-indexed,
/// with the historical 1900-02-29 leap-year bug — the bug is part of
/// the wire format). Returns `None` for non-date input.
///
/// Accepts:
/// - ISO `YYYY-MM-DD` (year ≥ 1900, month 1-12, day 1-31)
/// - en-US `M/D/YYYY` or `MM/DD/YYYY`
fn parse_date_serial(s: &str) -> Option<f64> {
    // Reject anything containing a space — that's date+time, not a pure
    // date, and Excel imports those differently.
    if s.contains(' ') {
        return None;
    }
    // Avoid wasting work on obvious non-dates: must contain a `-` or `/`.
    if !s.contains('-') && !s.contains('/') {
        return None;
    }

    let date = NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(s, "%m/%d/%Y"))
        .ok()?;
    Some(naive_date_to_excel_serial(date))
}

/// Convert a `chrono::NaiveDate` to the Excel 1900-epoch serial.
///
/// Excel's wire format:
///   1900-01-01 → 1, 1900-02-28 → 59, **1900-02-29 → 60 (nonexistent —
///   1900 isn't a leap year)**, 1900-03-01 → 61.
///
/// Modelled here as: chronological days since 1899-12-31, plus a `+1` shim
/// for any date on or after 1900-03-01 to account for the phantom
/// 1900-02-29.
fn naive_date_to_excel_serial(date: NaiveDate) -> f64 {
    let epoch = NaiveDate::from_ymd_opt(1899, 12, 31).unwrap();
    let days = (date - epoch).num_days() as f64;

    let leap_threshold = NaiveDate::from_ymd_opt(1900, 3, 1).unwrap();
    if date >= leap_threshold {
        days + 1.0
    } else {
        days
    }
}

/// Parse a time string into a fractional day (HH:MM:SS → 0..1).
fn parse_time_fraction(s: &str) -> Option<f64> {
    // HH:MM or HH:MM:SS. Strict parsing — no AM/PM, no leading zero
    // requirements. Excel imports both shapes.
    let parts: Vec<&str> = s.split(':').collect();
    if !(parts.len() == 2 || parts.len() == 3) {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let sec: f64 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        0.0
    };
    if h >= 24 || m >= 60 || !(0.0..60.0).contains(&sec) {
        return None;
    }
    let total_seconds = h as f64 * 3600.0 + m as f64 * 60.0 + sec;
    Some(total_seconds / 86_400.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> StylePalette {
        StylePalette::new().0
    }

    #[test]
    fn empty_returns_none() {
        let p = p();
        assert!(infer_cell("", &p, false).is_none());
    }

    #[test]
    fn integer_is_number_general() {
        let p = p();
        let r = infer_cell("42", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Number(_)));
        assert_eq!(r.style_id, Some(p.general));
    }

    #[test]
    fn negative_integer_is_number() {
        let p = p();
        let r = infer_cell("-42", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Number(_)));
        assert_eq!(r.style_id, Some(p.general));
    }

    #[test]
    fn signed_scientific_is_number() {
        let p = p();
        let r = infer_cell("-1.2e3", &p, false).unwrap();
        let n = match r.value {
            CellValue::Number(f) => f.get(),
            _ => panic!("expected number"),
        };
        assert!((n - -1200.0).abs() < 1e-9);
    }

    #[test]
    fn leading_zero_string_stays_text() {
        let p = p();
        let r = infer_cell("00123", &p, false).unwrap();
        let t = match &r.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected text"),
        };
        assert_eq!(t, "00123");
        assert_eq!(r.style_id, Some(p.text));
    }

    #[test]
    fn single_zero_is_a_number() {
        let p = p();
        let r = infer_cell("0", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Number(_)));
    }

    #[test]
    fn boolean_case_insensitive() {
        let p = p();
        for s in ["true", "TRUE", "True", "tRUe"] {
            let r = infer_cell(s, &p, false).unwrap();
            assert!(matches!(r.value, CellValue::Boolean(true)), "{s}");
        }
        for s in ["false", "FALSE", "False"] {
            let r = infer_cell(s, &p, false).unwrap();
            assert!(matches!(r.value, CellValue::Boolean(false)), "{s}");
        }
    }

    #[test]
    fn iso_date_decodes_to_serial_with_format() {
        let p = p();
        let r = infer_cell("2024-01-15", &p, false).unwrap();
        let n = match r.value {
            CellValue::Number(f) => f.get(),
            _ => panic!(),
        };
        assert!((n - 45306.0).abs() < 0.5, "got {n}");
        assert_eq!(r.style_id, Some(p.date));
    }

    #[test]
    fn us_slash_date_decodes() {
        let p = p();
        let r = infer_cell("4/26/2026", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Number(_)));
        assert_eq!(r.style_id, Some(p.date));
    }

    #[test]
    fn time_decodes_to_fraction_with_format() {
        let p = p();
        let r = infer_cell("14:30:00", &p, false).unwrap();
        let n = match r.value {
            CellValue::Number(f) => f.get(),
            _ => panic!(),
        };
        let expected = 14.5 / 24.0;
        assert!((n - expected).abs() < 1e-9, "got {n}, expected {expected}");
        assert_eq!(r.style_id, Some(p.time));
    }

    #[test]
    fn leading_equals_is_text_by_default() {
        let p = p();
        let r = infer_cell("=1+2", &p, false).unwrap();
        let t = match &r.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected text, got {:?}", r.value),
        };
        assert_eq!(t, "=1+2");
        assert_eq!(r.style_id, Some(p.text));
        assert!(r.formula.is_none());
    }

    #[test]
    fn leading_at_is_text() {
        let p = p();
        let r = infer_cell("@1+2", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Text(_)));
        assert_eq!(r.style_id, Some(p.text));
    }

    #[test]
    fn leading_plus_alone_is_text() {
        let p = p();
        let r = infer_cell("+1+2", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Text(_)));
        assert_eq!(r.style_id, Some(p.text));
    }

    #[test]
    fn evaluate_formulas_promotes_leading_equals() {
        let p = p();
        let r = infer_cell("=1+2", &p, true).unwrap();
        assert_eq!(r.formula.as_deref(), Some("=1+2"));
        assert_eq!(r.style_id, Some(p.general));
    }

    #[test]
    fn leading_apostrophe_strips_and_marks_text() {
        let p = p();
        let r = infer_cell("'00123", &p, false).unwrap();
        let t = match &r.value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!(),
        };
        assert_eq!(t, "00123");
        assert_eq!(r.style_id, Some(p.text));
    }

    #[test]
    fn float_is_number() {
        let p = p();
        let r = infer_cell("3.14", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Number(_)));
    }

    #[test]
    fn random_text_is_text_general() {
        let p = p();
        let r = infer_cell("hello", &p, false).unwrap();
        assert!(matches!(r.value, CellValue::Text(_)));
        assert_eq!(r.style_id, Some(p.general));
    }
}
