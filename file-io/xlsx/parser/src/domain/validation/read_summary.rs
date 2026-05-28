//! Projection from validation parser models to wire summaries.

use crate::domain::validation::types::{
    DataValidation, DataValidations, DataValidationsContainerAttrs, ImeMode,
};

/// Returns (validations, container_attrs).
pub fn parse_data_validations(
    xml: &[u8],
) -> (
    Vec<crate::output::results::DvSummary>,
    DataValidationsContainerAttrs,
) {
    DataValidations::parse(xml)
        .map(|dvs| {
            summarize_validations(&dvs.validations, DataValidationsContainerAttrs::from(&dvs))
        })
        .unwrap_or_default()
}

pub(crate) fn summarize_validations(
    validations: &[DataValidation],
    attrs: DataValidationsContainerAttrs,
) -> (
    Vec<crate::output::results::DvSummary>,
    DataValidationsContainerAttrs,
) {
    let summaries = validations
        .iter()
        .map(|dv| {
            // OOXML showDropDown="1" means HIDE the dropdown (inverted).
            let show_dropdown = !dv.show_drop_down;
            let ime_mode_str = if dv.ime_mode == ImeMode::NoControl {
                String::new()
            } else {
                dv.ime_mode.as_str().to_string()
            };
            crate::output::results::DvSummary {
                sqref: dv.sqref.to_a1_string(),
                validation_type: dv.validation_type.as_str().to_string(),
                operator: dv.operator.as_str().to_string(),
                allow_blank: dv.allow_blank,
                formula1: dv
                    .formula1_raw
                    .clone()
                    .or_else(|| dv.formula1.as_ref().map(|p| p.to_a1_string().into_owned())),
                formula2: dv
                    .formula2_raw
                    .clone()
                    .or_else(|| dv.formula2.as_ref().map(|p| p.to_a1_string().into_owned())),
                show_dropdown,
                error_style: dv.error_style.as_str().to_string(),
                show_error: dv.show_error_message,
                error_title: dv.error_title.clone(),
                error_message: dv.error.clone(),
                show_input: dv.show_input_message,
                prompt_title: dv.prompt_title.clone(),
                prompt_message: dv.prompt.clone(),
                ime_mode: ime_mode_str,
                uid: dv.uid.clone(),
            }
        })
        .collect();
    (summaries, attrs)
}

impl From<&DataValidations> for DataValidationsContainerAttrs {
    fn from(dvs: &DataValidations) -> Self {
        Self {
            disable_prompts: dvs.disable_prompts,
            x_window: dvs.x_window,
            y_window: dvs.y_window,
            declared_count: dvs.count,
        }
    }
}
