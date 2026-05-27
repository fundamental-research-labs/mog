use super::*;

// =============================================================================
// Domain conversions: Data validations (minimal)
// =============================================================================

/// Convert parser `DvSummary` items into domain `ValidationSpec` items.
/// Captures all validation data including formulas, error/prompt messages.
pub(crate) fn convert_data_validations(dvs: &[DvSummary]) -> Vec<ValidationSpec> {
    dvs.iter()
        .map(|dv| {
            let f1 = dv.formula1.clone().unwrap_or_default();
            let f2 = dv.formula2.clone();
            let rule = match dv.validation_type.as_str() {
                "list" => ValidationRule::List {
                    formula1: f1,
                    show_dropdown: dv.show_dropdown,
                },
                "whole" => ValidationRule::WholeNumber {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "decimal" => ValidationRule::Decimal {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "date" => ValidationRule::Date {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "time" => ValidationRule::Time {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "textLength" => ValidationRule::TextLength {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "custom" => ValidationRule::Custom { formula1: f1 },
                _ => ValidationRule::None { formula1: f1 },
            };
            ValidationSpec {
                ranges: dv
                    .sqref
                    .split_whitespace()
                    .filter(|s| !s.trim().is_empty() && !s.eq_ignore_ascii_case("#REF!"))
                    .map(String::from)
                    .collect(),
                rule,
                error_style: if dv.error_style.is_empty() {
                    ErrorStyle::Stop
                } else {
                    ErrorStyle::from_str_lossy(&dv.error_style)
                },
                show_error: dv.show_error,
                error_title: dv.error_title.clone(),
                error_message: dv.error_message.clone(),
                show_prompt: dv.show_input,
                prompt_title: dv.prompt_title.clone(),
                prompt_message: dv.prompt_message.clone(),
                allow_blank: dv.allow_blank,
                ime_mode: domain_types::ImeMode::from_str_lossy(&dv.ime_mode),
                uid: dv.uid.clone(),
            }
        })
        .collect()
}
