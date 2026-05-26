// Re-export validation domain types from the single source of truth.
pub use domain_types::domain::validation::{
    CellValueResult, CoercionResult, ColumnSchema, DistributionConfig, DistributionType,
    EnforcementLevel, InferredSchema, SchemaConstraints, SchemaType, ValidationError,
    ValidationErrorCode, ValidationResult, ValidationSeverity,
};

use serde::{Deserialize, Serialize};

/// Cell editor types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorType {
    Text,
    Dropdown,
    Date,
    Time,
    Color,
    Checkbox,
    Slider,
    Calculator,
}

/// Result of resolving the editor type for a cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTypeResolutionResult {
    pub editor_type: EditorType,
    pub enum_items: Option<Vec<String>>,
    pub requires_validation: bool,
}

/// UI behavior based on validation result and enforcement level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnforcementBehavior {
    pub should_block: bool,
    pub show_dialog: Option<DialogType>,
}

/// Dialog type for enforcement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DialogType {
    Error,
    Warning,
    Info,
}

/// Maps enforcement level and validation result to UI behavior.
pub fn get_enforcement_behavior(valid: bool, enforcement: EnforcementLevel) -> EnforcementBehavior {
    if valid {
        return EnforcementBehavior {
            should_block: false,
            show_dialog: None,
        };
    }
    match enforcement {
        EnforcementLevel::Strict => EnforcementBehavior {
            should_block: true,
            show_dialog: Some(DialogType::Error),
        },
        EnforcementLevel::Warning => EnforcementBehavior {
            should_block: false,
            show_dialog: Some(DialogType::Warning),
        },
        EnforcementLevel::Info => EnforcementBehavior {
            should_block: false,
            show_dialog: Some(DialogType::Info),
        },
        EnforcementLevel::None => EnforcementBehavior {
            should_block: false,
            show_dialog: None,
        },
    }
}

/// Maps our enforcement level to Excel errorStyle.
pub fn enforcement_to_excel_error_style(enforcement: EnforcementLevel) -> Option<&'static str> {
    match enforcement {
        EnforcementLevel::Strict => Some("stop"),
        EnforcementLevel::Warning => Some("warning"),
        EnforcementLevel::Info => Some("information"),
        EnforcementLevel::None => None,
    }
}

/// Maps Excel errorStyle to our enforcement level.
pub fn excel_error_style_to_enforcement(error_style: Option<&str>) -> EnforcementLevel {
    match error_style {
        Some("stop") => EnforcementLevel::Strict,
        Some("warning") => EnforcementLevel::Warning,
        Some("information") => EnforcementLevel::Info,
        _ => EnforcementLevel::Strict, // Excel default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- get_enforcement_behavior --

    // Principle: valid values should NEVER be blocked, regardless of enforcement level
    #[test]
    fn valid_value_is_never_blocked() {
        for level in [
            EnforcementLevel::Strict,
            EnforcementLevel::Warning,
            EnforcementLevel::Info,
            EnforcementLevel::None,
        ] {
            let behavior = get_enforcement_behavior(true, level);
            assert!(
                !behavior.should_block,
                "Valid value should not be blocked at {:?}",
                level
            );
            assert_eq!(
                behavior.show_dialog, None,
                "Valid value should show no dialog at {:?}",
                level
            );
        }
    }

    // Principle: Strict enforcement on invalid value MUST block and show Error
    #[test]
    fn strict_invalid_blocks_with_error() {
        let b = get_enforcement_behavior(false, EnforcementLevel::Strict);
        assert!(b.should_block);
        assert_eq!(b.show_dialog, Some(DialogType::Error));
    }

    // Principle: Warning enforcement on invalid value should NOT block, but show Warning
    #[test]
    fn warning_invalid_warns_without_blocking() {
        let b = get_enforcement_behavior(false, EnforcementLevel::Warning);
        assert!(!b.should_block);
        assert_eq!(b.show_dialog, Some(DialogType::Warning));
    }

    // Principle: Info enforcement on invalid value should NOT block, but show Info
    #[test]
    fn info_invalid_informs_without_blocking() {
        let b = get_enforcement_behavior(false, EnforcementLevel::Info);
        assert!(!b.should_block);
        assert_eq!(b.show_dialog, Some(DialogType::Info));
    }

    // Principle: None enforcement on invalid value should neither block nor show dialog
    #[test]
    fn none_invalid_does_nothing() {
        let b = get_enforcement_behavior(false, EnforcementLevel::None);
        assert!(!b.should_block);
        assert_eq!(b.show_dialog, None);
    }

    // -- enforcement_to_excel_error_style --

    // Principle: Maps to Excel's errorStyle attribute values
    #[test]
    fn enforcement_maps_to_excel_error_style() {
        assert_eq!(
            enforcement_to_excel_error_style(EnforcementLevel::Strict),
            Some("stop")
        );
        assert_eq!(
            enforcement_to_excel_error_style(EnforcementLevel::Warning),
            Some("warning")
        );
        assert_eq!(
            enforcement_to_excel_error_style(EnforcementLevel::Info),
            Some("information")
        );
        assert_eq!(
            enforcement_to_excel_error_style(EnforcementLevel::None),
            None
        );
    }

    // -- excel_error_style_to_enforcement --

    // Principle: Reverse mapping from Excel errorStyle strings
    #[test]
    fn excel_error_style_maps_to_enforcement() {
        assert_eq!(
            excel_error_style_to_enforcement(Some("stop")),
            EnforcementLevel::Strict
        );
        assert_eq!(
            excel_error_style_to_enforcement(Some("warning")),
            EnforcementLevel::Warning
        );
        assert_eq!(
            excel_error_style_to_enforcement(Some("information")),
            EnforcementLevel::Info
        );
    }

    // Principle: Excel default errorStyle is "stop" (Strict) when attribute is missing
    #[test]
    fn missing_excel_error_style_defaults_to_strict() {
        assert_eq!(
            excel_error_style_to_enforcement(None),
            EnforcementLevel::Strict
        );
    }

    // Principle: Unknown errorStyle values should default to Strict (Excel behavior)
    #[test]
    fn unknown_excel_error_style_defaults_to_strict() {
        assert_eq!(
            excel_error_style_to_enforcement(Some("unknown")),
            EnforcementLevel::Strict
        );
        assert_eq!(
            excel_error_style_to_enforcement(Some("")),
            EnforcementLevel::Strict
        );
    }

    // Principle: Round-trip — enforcement -> excel -> enforcement should be identity
    // for all levels that have an Excel representation
    #[test]
    fn enforcement_excel_round_trip() {
        for level in [
            EnforcementLevel::Strict,
            EnforcementLevel::Warning,
            EnforcementLevel::Info,
        ] {
            let excel_style = enforcement_to_excel_error_style(level);
            let round_tripped = excel_error_style_to_enforcement(excel_style);
            assert_eq!(round_tripped, level, "Round-trip failed for {:?}", level);
        }
    }
}
