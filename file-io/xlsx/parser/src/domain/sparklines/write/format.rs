//! Formatting helpers shared by sparkline domain bridge and adjacent writers.

/// Quotes the sheet name if it contains spaces or special characters.
pub(super) fn format_sheet_qualified_ref(sheet_name: &str, range: &str) -> String {
    if sheet_name.contains(' ')
        || sheet_name.contains('\'')
        || sheet_name.contains('!')
        || sheet_name.contains('[')
    {
        // Escape single quotes by doubling them
        let escaped = sheet_name.replace('\'', "''");
        format!("'{}'!{}", escaped, range)
    } else {
        format!("{}!{}", sheet_name, range)
    }
}

/// Minimal XML escaping for sparkline text content.
pub(super) fn sparkline_xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Convert a "#RRGGBB" or "AARRGGBB" hex string to OOXML "AARRGGBB" format.
pub(crate) fn hex_to_argb(hex: &str) -> String {
    if let Some(stripped) = hex.strip_prefix('#') {
        format!("FF{}", stripped.to_uppercase())
    } else if hex.len() == 6 {
        format!("FF{}", hex.to_uppercase())
    } else {
        hex.to_uppercase()
    }
}
