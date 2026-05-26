//! JSON utility functions for XLSX parser serialization.
//!
//! Provides escape_json_string and errors_to_json for manual JSON
//! serialization (no serde dependency for WASM size).

use crate::infra::error::ParseErrorDetail;

/// Convert ParseErrorDetail array to JSON string for JS consumption
///
/// Serializes errors to JSON without serde dependency (for WASM size).
/// Format: [{"code":300,"severity":"error","message":"...","part":"..."},...]
pub fn errors_to_json(errors: &[ParseErrorDetail]) -> String {
    if errors.is_empty() {
        return String::from("[]");
    }

    let mut json = String::from("[");
    for (i, error) in errors.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push('{');

        // code
        json.push_str(&format!("\"code\":{}", error.code.code()));

        // severity
        json.push_str(&format!(",\"severity\":\"{}\"", error.severity));

        // message (escape special characters)
        let escaped_message = escape_json_string(&error.message);
        json.push_str(&format!(",\"message\":\"{}\"", escaped_message));

        // part (from location)
        if let Some(ref loc) = error.location {
            let escaped_part = escape_json_string(&loc.part);
            json.push_str(&format!(",\"part\":\"{}\"", escaped_part));

            // Optional path
            if let Some(ref path) = loc.path {
                let escaped_path = escape_json_string(path);
                json.push_str(&format!(",\"path\":\"{}\"", escaped_path));
            }

            // Optional row/col
            if let Some(row) = loc.row {
                json.push_str(&format!(",\"row\":{}", row));
            }
            if let Some(col) = loc.col {
                json.push_str(&format!(",\"col\":{}", col));
            }
        }

        // Optional raw_data
        if let Some(ref raw) = error.raw_data {
            let escaped_raw = escape_json_string(raw);
            json.push_str(&format!(",\"rawData\":\"{}\"", escaped_raw));
        }

        // Optional fallback_used
        if let Some(ref fallback) = error.fallback_used {
            let escaped_fallback = escape_json_string(fallback);
            json.push_str(&format!(",\"fallbackUsed\":\"{}\"", escaped_fallback));
        }

        json.push('}');
    }
    json.push(']');

    json
}

/// Escape special characters in a string for JSON encoding
pub fn escape_json_string(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            c if c.is_control() => {
                // Escape control characters as \uXXXX
                result.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => result.push(c),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::error::{ErrorCode, ErrorLocation, ParseErrorDetail};

    #[test]
    fn test_errors_to_json_empty() {
        let errors: Vec<ParseErrorDetail> = vec![];
        let json = errors_to_json(&errors);
        assert_eq!(json, "[]");
    }

    #[test]
    fn test_errors_to_json_single_error() {
        let errors = vec![ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "Bad cell ref",
        )];
        let json = errors_to_json(&errors);
        assert!(json.starts_with("[{"));
        assert!(json.ends_with("}]"));
        assert!(json.contains("\"code\":300"));
        assert!(json.contains("\"severity\":\"error\""));
        assert!(json.contains("\"message\":\"Bad cell ref\""));
    }

    #[test]
    fn test_errors_to_json_with_location() {
        let error = ParseErrorDetail::error(ErrorCode::InvalidCellValue, "Invalid value")
            .with_location(ErrorLocation::cell("xl/worksheets/sheet1.xml", 5, 3));
        let json = errors_to_json(&[error]);
        assert!(json.contains("\"part\":\"xl/worksheets/sheet1.xml\""));
        assert!(json.contains("\"row\":5"));
        assert!(json.contains("\"col\":3"));
    }

    #[test]
    fn test_errors_to_json_with_raw_data_and_fallback() {
        let error = ParseErrorDetail::warning(ErrorCode::InvalidCellValue, "Warning")
            .with_raw_data("bad_data")
            .with_fallback("0");
        let json = errors_to_json(&[error]);
        assert!(json.contains("\"rawData\":\"bad_data\""));
        assert!(json.contains("\"fallbackUsed\":\"0\""));
    }

    #[test]
    fn test_errors_to_json_multiple_errors() {
        let errors = vec![
            ParseErrorDetail::warning(ErrorCode::UnsupportedFeature, "Feature X"),
            ParseErrorDetail::error(ErrorCode::InvalidCellReference, "Bad ref"),
        ];
        let json = errors_to_json(&errors);
        // Should have two objects separated by comma
        assert!(json.contains("},{"));
        assert!(json.contains("\"code\":600")); // UnsupportedFeature
        assert!(json.contains("\"code\":300")); // InvalidCellReference
    }

    #[test]
    fn test_errors_to_json_escapes_special_chars() {
        let error = ParseErrorDetail::error(
            ErrorCode::InvalidCellValue,
            "Value contains \"quotes\" and \\ backslash",
        );
        let json = errors_to_json(&[error]);
        assert!(json.contains("\\\"quotes\\\""));
        assert!(json.contains("\\\\"));
    }

    #[test]
    fn test_escape_json_string_simple() {
        assert_eq!(escape_json_string("hello"), "hello");
    }

    #[test]
    fn test_escape_json_string_quotes() {
        assert_eq!(escape_json_string("say \"hello\""), "say \\\"hello\\\"");
    }

    #[test]
    fn test_escape_json_string_backslash() {
        assert_eq!(escape_json_string("path\\to\\file"), "path\\\\to\\\\file");
    }

    #[test]
    fn test_escape_json_string_newlines() {
        assert_eq!(
            escape_json_string("line1\nline2\r\nline3"),
            "line1\\nline2\\r\\nline3"
        );
    }

    #[test]
    fn test_escape_json_string_tabs() {
        assert_eq!(escape_json_string("col1\tcol2"), "col1\\tcol2");
    }
}
