/// Format type classification (12 types matching Excel's Format Cells dialog).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormatType {
    /// No specific format (`General`).
    General,
    /// Decimal numbers with optional thousands separator (`#,##0.00`).
    Number,
    /// Currency values with symbol (`$#,##0.00`).
    Currency,
    /// Currency with aligned symbols and parentheses for negatives.
    Accounting,
    /// Date values (`m/d/yyyy`, `yyyy-mm-dd`).
    Date,
    /// Time values (`h:mm AM/PM`, `h:mm:ss`).
    Time,
    /// Percentage values (`0.00%`).
    Percentage,
    /// Fractional values (`# ?/?`, `# ??/??`).
    Fraction,
    /// Scientific notation (`0.00E+00`).
    Scientific,
    /// Treat as text (`@`).
    Text,
    /// Special formats: ZIP, Phone, SSN.
    Special,
    /// Custom user-defined format string.
    Custom,
}

impl std::fmt::Display for FormatType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::General => "General",
            Self::Number => "Number",
            Self::Currency => "Currency",
            Self::Accounting => "Accounting",
            Self::Date => "Date",
            Self::Time => "Time",
            Self::Percentage => "Percentage",
            Self::Fraction => "Fraction",
            Self::Scientific => "Scientific",
            Self::Text => "Text",
            Self::Special => "Special",
            Self::Custom => "Custom",
        })
    }
}

impl FormatType {
    /// All variants in canonical order.
    pub const ALL: [FormatType; 12] = [
        FormatType::General,
        FormatType::Number,
        FormatType::Currency,
        FormatType::Accounting,
        FormatType::Date,
        FormatType::Time,
        FormatType::Percentage,
        FormatType::Fraction,
        FormatType::Scientific,
        FormatType::Text,
        FormatType::Special,
        FormatType::Custom,
    ];

    /// Lowercase string key (matches serde serialization).
    pub fn as_str(self) -> &'static str {
        match self {
            FormatType::General => "general",
            FormatType::Number => "number",
            FormatType::Currency => "currency",
            FormatType::Accounting => "accounting",
            FormatType::Date => "date",
            FormatType::Time => "time",
            FormatType::Percentage => "percentage",
            FormatType::Fraction => "fraction",
            FormatType::Scientific => "scientific",
            FormatType::Text => "text",
            FormatType::Special => "special",
            FormatType::Custom => "custom",
        }
    }
}

/// Metadata for a format category in the Format Cells dialog.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCategory {
    /// The format type this category represents.
    pub format_type: FormatType,
    /// Display label (e.g., "Number", "Currency").
    pub label: &'static str,
    /// Short description of the category.
    pub description: &'static str,
}

/// All 12 format categories in canonical order.
pub static FORMAT_CATEGORIES: [FormatCategory; 12] = [
    FormatCategory {
        format_type: FormatType::General,
        label: "General",
        description: "No specific format",
    },
    FormatCategory {
        format_type: FormatType::Number,
        label: "Number",
        description: "Decimal numbers with optional thousands separator",
    },
    FormatCategory {
        format_type: FormatType::Currency,
        label: "Currency",
        description: "Currency values with symbol",
    },
    FormatCategory {
        format_type: FormatType::Accounting,
        label: "Accounting",
        description: "Currency with aligned symbols and parentheses for negatives",
    },
    FormatCategory {
        format_type: FormatType::Date,
        label: "Date",
        description: "Date values",
    },
    FormatCategory {
        format_type: FormatType::Time,
        label: "Time",
        description: "Time values",
    },
    FormatCategory {
        format_type: FormatType::Percentage,
        label: "Percentage",
        description: "Percentage values",
    },
    FormatCategory {
        format_type: FormatType::Fraction,
        label: "Fraction",
        description: "Fractional values",
    },
    FormatCategory {
        format_type: FormatType::Scientific,
        label: "Scientific",
        description: "Scientific notation",
    },
    FormatCategory {
        format_type: FormatType::Text,
        label: "Text",
        description: "Treat as text",
    },
    FormatCategory {
        format_type: FormatType::Special,
        label: "Special",
        description: "Special formats (Zip, Phone, SSN)",
    },
    FormatCategory {
        format_type: FormatType::Custom,
        label: "Custom",
        description: "Custom format string",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_categories_have_canonical_order() {
        assert_eq!(FORMAT_CATEGORIES.len(), 12);
        assert_eq!(FORMAT_CATEGORIES[0].format_type, FormatType::General);
        assert_eq!(FORMAT_CATEGORIES[0].label, "General");
        assert_eq!(FORMAT_CATEGORIES[11].format_type, FormatType::Custom);
        assert_eq!(FORMAT_CATEGORIES[11].label, "Custom");
    }

    #[test]
    fn format_type_all_has_canonical_order() {
        assert_eq!(
            FormatType::ALL,
            [
                FormatType::General,
                FormatType::Number,
                FormatType::Currency,
                FormatType::Accounting,
                FormatType::Date,
                FormatType::Time,
                FormatType::Percentage,
                FormatType::Fraction,
                FormatType::Scientific,
                FormatType::Text,
                FormatType::Special,
                FormatType::Custom,
            ]
        );
    }

    #[test]
    fn format_type_as_str_covers_all_variants() {
        assert_eq!(FormatType::General.as_str(), "general");
        assert_eq!(FormatType::Number.as_str(), "number");
        assert_eq!(FormatType::Currency.as_str(), "currency");
        assert_eq!(FormatType::Accounting.as_str(), "accounting");
        assert_eq!(FormatType::Date.as_str(), "date");
        assert_eq!(FormatType::Time.as_str(), "time");
        assert_eq!(FormatType::Percentage.as_str(), "percentage");
        assert_eq!(FormatType::Fraction.as_str(), "fraction");
        assert_eq!(FormatType::Scientific.as_str(), "scientific");
        assert_eq!(FormatType::Text.as_str(), "text");
        assert_eq!(FormatType::Special.as_str(), "special");
        assert_eq!(FormatType::Custom.as_str(), "custom");
    }
}
