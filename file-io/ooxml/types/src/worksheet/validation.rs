//! Data validation types (CT_DataValidations, CT_DataValidation).

// ============================================================================
// DataValidationType -- ST_DataValidationType
// ============================================================================

/// Data validation type (ST_DataValidationType).
///
/// Specifies the type of data validation to apply.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DataValidationType {
    /// No validation (default)
    #[default]
    #[xml("none")]
    None,
    /// Whole number validation
    #[xml("whole")]
    Whole,
    /// Decimal number validation
    #[xml("decimal")]
    Decimal,
    /// List validation
    #[xml("list")]
    List,
    /// Date validation
    #[xml("date")]
    Date,
    /// Time validation
    #[xml("time")]
    Time,
    /// Text length validation
    #[xml("textLength")]
    TextLength,
    /// Custom formula validation
    #[xml("custom")]
    Custom,
}

// ============================================================================
// DataValidationOperator -- ST_DataValidationOperator
// ============================================================================

/// Data validation operator (ST_DataValidationOperator).
///
/// Specifies the relational operator used for data validation.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DataValidationOperator {
    /// Between (default)
    #[default]
    #[xml("between")]
    Between,
    /// Not between
    #[xml("notBetween")]
    NotBetween,
    /// Equal to
    #[xml("equal")]
    Equal,
    /// Not equal to
    #[xml("notEqual")]
    NotEqual,
    /// Less than
    #[xml("lessThan")]
    LessThan,
    /// Less than or equal to
    #[xml("lessThanOrEqual")]
    LessThanOrEqual,
    /// Greater than
    #[xml("greaterThan")]
    GreaterThan,
    /// Greater than or equal to
    #[xml("greaterThanOrEqual")]
    GreaterThanOrEqual,
}

// ============================================================================
// DataValidationErrorStyle -- ST_DataValidationErrorStyle
// ============================================================================

/// Data validation error style (ST_DataValidationErrorStyle).
///
/// Specifies the style of error alert displayed when validation fails.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DataValidationErrorStyle {
    /// Stop (default) -- prevents invalid data entry
    #[default]
    #[xml("stop")]
    Stop,
    /// Warning -- warns but allows override
    #[xml("warning")]
    Warning,
    /// Information -- informational only
    #[xml("information")]
    Information,
}

// ============================================================================
// DataValidationImeMode -- ST_DataValidationImeMode
// ============================================================================

/// Data validation IME mode (ST_DataValidationImeMode).
///
/// Specifies the Input Method Editor mode enforced during data validation.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DataValidationImeMode {
    /// No control (default)
    #[default]
    #[xml("noControl")]
    NoControl,
    /// IME off
    #[xml("off")]
    Off,
    /// IME on
    #[xml("on")]
    On,
    /// IME disabled
    #[xml("disabled")]
    Disabled,
    /// Hiragana
    #[xml("hiragana")]
    Hiragana,
    /// Full-width Katakana
    #[xml("fullKatakana")]
    FullKatakana,
    /// Half-width Katakana
    #[xml("halfKatakana")]
    HalfKatakana,
    /// Full-width alphanumeric
    #[xml("fullAlpha")]
    FullAlpha,
    /// Half-width alphanumeric
    #[xml("halfAlpha")]
    HalfAlpha,
    /// Full-width Hangul
    #[xml("fullHangul")]
    FullHangul,
    /// Half-width Hangul
    #[xml("halfHangul")]
    HalfHangul,
}

// ============================================================================
// DataValidations -- CT_DataValidations (§18.3.1.33)
// ============================================================================

/// Data validations container (CT_DataValidations, §18.3.1.33).
///
/// Groups one or more data validation rules for a worksheet.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct DataValidations {
    /// Optional informational count of contained rules.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    /// Whether to suppress all validation prompts.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub disable_prompts: bool,
    /// Prompt window X position.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_window: Option<u32>,
    /// Prompt window Y position.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_window: Option<u32>,
    /// The individual data validation rules.
    #[serde(default)]
    pub data_validation: Vec<DataValidation>,
}

// ============================================================================
// DataValidation -- CT_DataValidation (§18.3.1.32)
// ============================================================================

/// A single data validation rule (CT_DataValidation, §18.3.1.32).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DataValidation {
    /// Validation type (XSD optional, default "none").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<DataValidationType>,
    /// Comparison operator.
    #[serde(default)]
    pub operator: DataValidationOperator,
    /// IME mode.
    #[serde(default)]
    pub ime_mode: DataValidationImeMode,
    /// Error alert style.
    #[serde(default)]
    pub error_style: DataValidationErrorStyle,
    /// Whether blank cells pass validation.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub allow_blank: bool,
    /// Whether to show the drop-down list for list validations.
    /// Per ECMA-376 XSD, default is `false`. Note: Excel inverts this attribute's
    /// semantics (`showDropDown="1"` means HIDE the dropdown). The parser layer
    /// should handle this inversion.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub show_drop_down: bool,
    /// Whether to show the input prompt message.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub show_input_message: bool,
    /// Whether to show the error alert message.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub show_error_message: bool,
    /// Title of the error alert dialog.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    /// Error alert message text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Title of the input prompt dialog.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    /// Input prompt message text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Cell range(s) to which this validation applies (space-separated sqrefs).
    pub sqref: String,
    /// First formula (validation constraint).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula1: Option<String>,
    /// Second formula (used with Between/NotBetween operators).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula2: Option<String>,
}

impl DataValidation {
    /// Effective validation type (defaults to `None` / "none" when absent per XSD).
    #[must_use]
    pub fn effective_type(&self) -> DataValidationType {
        self.r#type.unwrap_or(DataValidationType::None)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- DataValidationType ---

    #[test]
    fn data_validation_type_roundtrip() {
        let variants = [
            DataValidationType::None,
            DataValidationType::Whole,
            DataValidationType::Decimal,
            DataValidationType::List,
            DataValidationType::Date,
            DataValidationType::Time,
            DataValidationType::TextLength,
            DataValidationType::Custom,
        ];
        for v in &variants {
            assert_eq!(DataValidationType::from_ooxml(v.to_ooxml()), *v);
        }
    }

    #[test]
    fn data_validation_type_from_bytes() {
        let variants = [
            DataValidationType::None,
            DataValidationType::Whole,
            DataValidationType::Decimal,
            DataValidationType::List,
            DataValidationType::Date,
            DataValidationType::Time,
            DataValidationType::TextLength,
            DataValidationType::Custom,
        ];
        for v in &variants {
            assert_eq!(DataValidationType::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    #[test]
    fn data_validation_type_unknown_defaults() {
        assert_eq!(
            DataValidationType::from_ooxml("bogus"),
            DataValidationType::None
        );
        assert_eq!(
            DataValidationType::from_bytes(b"bogus"),
            DataValidationType::None
        );
    }

    // --- DataValidationOperator ---

    #[test]
    fn data_validation_operator_roundtrip() {
        let variants = [
            DataValidationOperator::Between,
            DataValidationOperator::NotBetween,
            DataValidationOperator::Equal,
            DataValidationOperator::NotEqual,
            DataValidationOperator::LessThan,
            DataValidationOperator::LessThanOrEqual,
            DataValidationOperator::GreaterThan,
            DataValidationOperator::GreaterThanOrEqual,
        ];
        for v in &variants {
            assert_eq!(DataValidationOperator::from_ooxml(v.to_ooxml()), *v);
        }
    }

    #[test]
    fn data_validation_operator_from_bytes() {
        let variants = [
            DataValidationOperator::Between,
            DataValidationOperator::NotBetween,
            DataValidationOperator::Equal,
            DataValidationOperator::NotEqual,
            DataValidationOperator::LessThan,
            DataValidationOperator::LessThanOrEqual,
            DataValidationOperator::GreaterThan,
            DataValidationOperator::GreaterThanOrEqual,
        ];
        for v in &variants {
            assert_eq!(
                DataValidationOperator::from_bytes(v.to_ooxml().as_bytes()),
                *v
            );
        }
    }

    // --- DataValidationErrorStyle ---

    #[test]
    fn data_validation_error_style_roundtrip() {
        let variants = [
            DataValidationErrorStyle::Stop,
            DataValidationErrorStyle::Warning,
            DataValidationErrorStyle::Information,
        ];
        for v in &variants {
            assert_eq!(DataValidationErrorStyle::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(
                DataValidationErrorStyle::from_bytes(v.to_ooxml().as_bytes()),
                *v
            );
        }
    }

    // --- DataValidationImeMode ---

    #[test]
    fn data_validation_ime_mode_roundtrip() {
        let variants = [
            DataValidationImeMode::NoControl,
            DataValidationImeMode::Off,
            DataValidationImeMode::On,
            DataValidationImeMode::Disabled,
            DataValidationImeMode::Hiragana,
            DataValidationImeMode::FullKatakana,
            DataValidationImeMode::HalfKatakana,
            DataValidationImeMode::FullAlpha,
            DataValidationImeMode::HalfAlpha,
            DataValidationImeMode::FullHangul,
            DataValidationImeMode::HalfHangul,
        ];
        for v in &variants {
            assert_eq!(DataValidationImeMode::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(
                DataValidationImeMode::from_bytes(v.to_ooxml().as_bytes()),
                *v
            );
        }
    }

    // --- DataValidation struct ---

    #[test]
    fn data_validation_default_show_drop_down_false() {
        assert!(!DataValidation::default().show_drop_down);
    }

    // --- DataValidations container ---

    #[test]
    fn data_validations_container_default() {
        let dv = DataValidations::default();
        assert!(dv.data_validation.is_empty());
        assert_eq!(dv.count, None);
        assert!(!dv.disable_prompts);
        assert_eq!(dv.x_window, None);
        assert_eq!(dv.y_window, None);
    }

    // --- Serde roundtrip ---

    #[test]
    fn data_validation_serde_roundtrip() {
        let dv = DataValidation {
            r#type: Some(DataValidationType::List),
            operator: DataValidationOperator::Equal,
            ime_mode: DataValidationImeMode::Hiragana,
            error_style: DataValidationErrorStyle::Warning,
            allow_blank: true,
            show_drop_down: false,
            show_input_message: true,
            show_error_message: true,
            error_title: Some("Error".to_string()),
            error: Some("Invalid value".to_string()),
            prompt_title: Some("Input".to_string()),
            prompt: Some("Pick a value".to_string()),
            sqref: "A1:A10".to_string(),
            formula1: Some("\"Yes,No,Maybe\"".to_string()),
            formula2: None,
        };
        let json = serde_json::to_string(&dv).unwrap();
        let back: DataValidation = serde_json::from_str(&json).unwrap();
        assert_eq!(dv, back);
    }
}
