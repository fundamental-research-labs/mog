//! Format result type returned by `format_value` and `format_number_result`.
//!
//! [`FormatResult`] captures the formatted text, an optional color directive
//! from the format code, and whether the value represents an error.

use crate::color::FormatColor;

/// Result of formatting a cell value.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FormatResult {
    /// The formatted text string.
    pub text: String,
    /// Optional color from the format code (e.g., `[Red]`).
    pub color: Option<FormatColor>,
    /// True if the value is an error (e.g., `#VALUE!`, `#REF!`).
    pub is_error: bool,
}

impl FormatResult {
    /// Create a simple text result with no color or error.
    pub fn text(s: impl Into<String>) -> Self {
        Self {
            text: s.into(),
            color: None,
            is_error: false,
        }
    }

    /// Create an error result.
    pub fn error(s: impl Into<String>) -> Self {
        Self {
            text: s.into(),
            color: None,
            is_error: true,
        }
    }

    /// Create a result with a color directive.
    pub fn with_color(text: impl Into<String>, color: FormatColor) -> Self {
        Self {
            text: text.into(),
            color: Some(color),
            is_error: false,
        }
    }
}

impl std::fmt::Display for FormatResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.text)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_result() {
        let r = FormatResult::text("hello");
        assert_eq!(r.text, "hello");
        assert_eq!(r.color, None);
        assert!(!r.is_error);
    }

    #[test]
    fn text_result_from_string() {
        let r = FormatResult::text(String::from("world"));
        assert_eq!(r.text, "world");
        assert_eq!(r.color, None);
        assert!(!r.is_error);
    }

    #[test]
    fn error_result() {
        let r = FormatResult::error("#VALUE!");
        assert_eq!(r.text, "#VALUE!");
        assert_eq!(r.color, None);
        assert!(r.is_error);
    }

    #[test]
    fn error_result_ref() {
        let r = FormatResult::error("#REF!");
        assert_eq!(r.text, "#REF!");
        assert!(r.is_error);
    }

    #[test]
    fn with_color_result() {
        let r = FormatResult::with_color("123", FormatColor::Red);
        assert_eq!(r.text, "123");
        assert_eq!(r.color, Some(FormatColor::Red));
        assert!(!r.is_error);
    }

    #[test]
    fn with_color_blue() {
        let r = FormatResult::with_color("-45.67", FormatColor::Blue);
        assert_eq!(r.text, "-45.67");
        assert_eq!(r.color, Some(FormatColor::Blue));
        assert!(!r.is_error);
    }

    #[test]
    fn with_color_indexed() {
        let r = FormatResult::with_color("$100", FormatColor::Index(10));
        assert_eq!(r.text, "$100");
        assert_eq!(r.color, Some(FormatColor::Index(10)));
        assert!(!r.is_error);
    }

    #[test]
    fn clone_and_eq() {
        let r1 = FormatResult::with_color("test", FormatColor::Green);
        let r2 = r1.clone();
        assert_eq!(r1, r2);
    }

    #[test]
    fn debug_format() {
        let r = FormatResult::text("debug");
        let debug_str = format!("{:?}", r);
        assert!(debug_str.contains("debug"));
        assert!(debug_str.contains("FormatResult"));
    }
}
