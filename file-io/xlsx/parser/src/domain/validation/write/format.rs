// ============================================================================
// Helper Functions
// ============================================================================

/// Format f64 for XML output, avoiding unnecessary decimal places.
pub(super) fn format_f64(value: f64) -> String {
    // Check if value is effectively an integer
    if value.fract().abs() < f64::EPSILON && value.abs() < i64::MAX as f64 {
        format!("{}", value as i64)
    } else {
        // Use enough precision, but trim trailing zeros
        let s = format!("{:.15}", value);
        let trimmed = s.trim_end_matches('0').trim_end_matches('.');
        trimmed.to_string()
    }
}

pub(super) fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
