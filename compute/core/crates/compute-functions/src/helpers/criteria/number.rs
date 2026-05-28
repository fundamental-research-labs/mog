/// Try to parse a string as a number, with support for `%` suffix.
/// `"-999%"` → `-9.99`, `"42"` → `42.0`, `"hello"` → `None`.
pub(super) fn try_parse_criteria_number(s: &str) -> Option<f64> {
    if let Ok(n) = s.parse::<f64>() {
        return Some(n);
    }
    if let Some(prefix) = s.strip_suffix('%') {
        prefix.parse::<f64>().ok().map(|n| n / 100.0)
    } else {
        None
    }
}
