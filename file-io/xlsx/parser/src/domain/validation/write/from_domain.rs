// ============================================================================
// Domain bridge: domain_types::ValidationSpec → DataValidationWriter
// ============================================================================

use super::{DataValidation, DataValidationWriter, ErrorStyle, ValidationOperator, ValidationType};

/// Convert `domain_types::ValidationSpec` list into XML (no container-level attrs).
pub fn validations_xml_from_domain(specs: &[domain_types::ValidationSpec]) -> String {
    validations_xml_from_domain_with_opts(specs, false, None, None, None)
}

/// Convert `domain_types::ValidationSpec` list into a `DataValidationWriter`.
///
/// Returns the writer's XML as a `String` (the `<dataValidations>` element).
/// The caller injects this into the sheet writer via `set_data_validations_xml()`.
pub fn validations_xml_from_domain_with_opts(
    specs: &[domain_types::ValidationSpec],
    disable_prompts: bool,
    x_window: Option<u32>,
    y_window: Option<u32>,
    declared_count: Option<u32>,
) -> String {
    let mut dvw = DataValidationWriter::new();
    dvw.disable_prompts = disable_prompts;
    dvw.x_window = x_window;
    dvw.y_window = y_window;
    dvw.declared_count = declared_count;

    for v in specs {
        let sqref = v.ranges.join(" ");

        let (vtype, operator, formula1, formula2) = match &v.rule {
            domain_types::ValidationRule::WholeNumber {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Whole,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::Decimal {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Decimal,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::List {
                formula1,
                show_dropdown,
            } => {
                // show_dropdown handling is done below via the DataValidation field
                let _ = show_dropdown;
                (ValidationType::List, None, formula1.as_str(), None)
            }
            domain_types::ValidationRule::Date {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Date,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::Time {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Time,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::TextLength {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::TextLength,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::Custom { formula1 } => {
                (ValidationType::Custom, None, formula1.as_str(), None)
            }
            domain_types::ValidationRule::None { formula1 } => {
                (ValidationType::None, None, formula1.as_str(), None)
            }
        };

        let mut dv = DataValidation::new(&sqref, vtype);
        if !formula1.is_empty() {
            dv.formula1 = Some(formula1.to_string());
        }
        if let Some(f2) = formula2 {
            dv.formula2 = Some(f2.to_string());
        }
        if let Some(op_str) = operator {
            dv.operator = Some(match op_str {
                "between" => ValidationOperator::Between,
                "notBetween" => ValidationOperator::NotBetween,
                "equal" => ValidationOperator::Equal,
                "notEqual" => ValidationOperator::NotEqual,
                "lessThan" => ValidationOperator::LessThan,
                "lessThanOrEqual" => ValidationOperator::LessThanOrEqual,
                "greaterThan" => ValidationOperator::GreaterThan,
                "greaterThanOrEqual" => ValidationOperator::GreaterThanOrEqual,
                _ => ValidationOperator::Between,
            });
        }
        dv.allow_blank = v.allow_blank;
        dv.show_input_message = v.show_prompt;
        dv.show_error_message = v.show_error;
        {
            let es = match v.error_style.as_str() {
                "warning" => ErrorStyle::Warning,
                "information" => ErrorStyle::Information,
                _ => ErrorStyle::Stop,
            };
            if es != ErrorStyle::Stop {
                dv.error_style = es;
            }
        }
        dv.error_title = v.error_title.clone();
        dv.error_message = v.error_message.clone();
        dv.prompt_title = v.prompt_title.clone();
        dv.prompt_message = v.prompt_message.clone();

        // For list type, showDropDown="1" means HIDE in OOXML (inverted)
        if let domain_types::ValidationRule::List { show_dropdown, .. } = &v.rule {
            dv.show_dropdown = *show_dropdown;
        }

        // xr:uid for revision tracking
        dv.uid = v.uid.clone();

        // imeMode (omit when default noControl)
        dv.ime_mode = if v.ime_mode == domain_types::ImeMode::NoControl {
            String::new()
        } else {
            v.ime_mode.as_str().to_string()
        };

        dvw.add(dv);
    }

    String::from_utf8(dvw.to_xml()).unwrap_or_default()
}
