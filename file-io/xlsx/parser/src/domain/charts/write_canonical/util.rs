/// Format an f64 value for OOXML, removing unnecessary trailing zeros.
/// Uses 17 decimal digits — enough to round-trip any IEEE 754 f64 value.
pub(super) fn format_f64(v: f64) -> String {
    if v.fract().abs() < f64::EPSILON && v.abs() < i64::MAX as f64 {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.17}", v);
        let trimmed = s.trim_end_matches('0').trim_end_matches('.');
        trimmed.to_string()
    }
}
