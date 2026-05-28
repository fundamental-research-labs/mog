/// Negative number display option for the Format Cells dialog.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NegativeFormatOption {
    /// Unique identifier (e.g., "minus", "parens").
    pub id: &'static str,
    /// Display label showing the visual style (e.g., "-1,234.10").
    pub label: &'static str,
    /// The format code fragment for negative numbers.
    pub format: &'static str,
    /// Optional color name (e.g., "Red") for colored negative formats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<&'static str>,
}

/// The 4 standard negative number display options.
pub static NEGATIVE_FORMATS: [NegativeFormatOption; 4] = [
    NegativeFormatOption {
        id: "minus",
        label: "-1,234.10",
        format: "-#,##0.00",
        color: None,
    },
    NegativeFormatOption {
        id: "minusRed",
        label: "-1,234.10",
        format: "[Red]-#,##0.00",
        color: Some("red"),
    },
    NegativeFormatOption {
        id: "parentheses",
        label: "(1,234.10)",
        format: "(#,##0.00)",
        color: None,
    },
    NegativeFormatOption {
        id: "parenthesesRed",
        label: "(1,234.10)",
        format: "[Red](#,##0.00)",
        color: Some("red"),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_formats_has_4_entries() {
        assert_eq!(NEGATIVE_FORMATS.len(), 4);
    }

    #[test]
    fn negative_format_ids_keep_canonical_order() {
        assert_eq!(NEGATIVE_FORMATS[0].id, "minus");
        assert_eq!(NEGATIVE_FORMATS[1].id, "minusRed");
        assert_eq!(NEGATIVE_FORMATS[2].id, "parentheses");
        assert_eq!(NEGATIVE_FORMATS[3].id, "parenthesesRed");
    }

    #[test]
    fn negative_format_minus_has_no_color() {
        assert!(NEGATIVE_FORMATS[0].color.is_none());
        assert_eq!(NEGATIVE_FORMATS[0].format, "-#,##0.00");
    }

    #[test]
    fn negative_format_minus_red_has_color() {
        assert_eq!(NEGATIVE_FORMATS[1].color, Some("red"));
        assert_eq!(NEGATIVE_FORMATS[1].format, "[Red]-#,##0.00");
    }

    #[test]
    fn negative_format_parentheses_red_has_color() {
        assert_eq!(NEGATIVE_FORMATS[3].color, Some("red"));
        assert_eq!(NEGATIVE_FORMATS[3].format, "[Red](#,##0.00)");
    }
}
