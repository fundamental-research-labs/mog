//! Lossless mappings between controls domain enums and OOXML dialect values.

use super::types::{CheckState, FormControlType};

/// Parse a form-control object type from either modern `CT_FormControlPr` values
/// or legacy VML `x:ClientData/@ObjectType` values.
pub fn parse_form_control_type(value: &str) -> FormControlType {
    match value.to_lowercase().as_str() {
        "button" => FormControlType::Button,
        "checkbox" => FormControlType::CheckBox,
        "drop" | "combobox" => FormControlType::ComboBox,
        "list" | "listbox" => FormControlType::ListBox,
        "radio" | "radiobutton" | "optionbutton" => FormControlType::RadioButton,
        "groupbox" | "group" | "gbox" => FormControlType::GroupBox,
        "label" => FormControlType::Label,
        "scrollbar" | "scroll" => FormControlType::ScrollBar,
        "spinner" | "spin" => FormControlType::Spinner,
        "editbox" | "edit" => FormControlType::EditBox,
        "dialog" => FormControlType::Dialog,
        _ => FormControlType::Unknown(value.to_string()),
    }
}

/// Convert `FormControlType` to the modern OOXML `objectType` attribute string.
///
/// In modern ctrlProp XML, values are PascalCase-ish (`CheckBox`, `Drop`, etc.).
/// `ComboBox` imports from `Drop`, so export must reverse to `Drop`.
pub fn object_type_to_modern(fct: &FormControlType) -> String {
    match fct {
        FormControlType::Button => "Button".to_string(),
        FormControlType::CheckBox => "CheckBox".to_string(),
        FormControlType::ComboBox => "Drop".to_string(),
        FormControlType::ListBox => "List".to_string(),
        FormControlType::RadioButton => "Radio".to_string(),
        FormControlType::GroupBox => "GBox".to_string(),
        FormControlType::Label => "Label".to_string(),
        FormControlType::ScrollBar => "Scroll".to_string(),
        FormControlType::Spinner => "Spin".to_string(),
        FormControlType::EditBox => "EditBox".to_string(),
        FormControlType::Dialog => "Dialog".to_string(),
        FormControlType::Unknown(s) => s.clone(),
    }
}

/// Convert `FormControlType` to the VML `ObjectType` attribute string.
pub fn object_type_to_vml(fct: &FormControlType) -> String {
    match fct {
        FormControlType::Button => "Button".to_string(),
        FormControlType::CheckBox => "Checkbox".to_string(),
        FormControlType::ComboBox => "Drop".to_string(),
        FormControlType::ListBox => "List".to_string(),
        FormControlType::RadioButton => "Radio".to_string(),
        FormControlType::GroupBox => "GBox".to_string(),
        FormControlType::Label => "Label".to_string(),
        FormControlType::ScrollBar => "Scroll".to_string(),
        FormControlType::Spinner => "Spin".to_string(),
        FormControlType::EditBox => "Edit".to_string(),
        FormControlType::Dialog => "Dialog".to_string(),
        FormControlType::Unknown(s) => s.clone(),
    }
}

/// Parse checkbox state values used by modern controls and VML controls.
pub fn parse_check_state(value: &str) -> CheckState {
    match value.to_lowercase().as_str() {
        "checked" | "1" | "true" => CheckState::Checked,
        "mixed" | "2" => CheckState::Mixed,
        _ => CheckState::Unchecked,
    }
}

/// Convert `CheckState` to the modern OOXML `checked` attribute value.
pub fn check_state_to_modern(state: &CheckState) -> &'static str {
    match state {
        CheckState::Unchecked => "Unchecked",
        CheckState::Checked => "Checked",
        CheckState::Mixed => "Mixed",
    }
}

/// Convert `CheckState` to the VML `<x:Checked>` element value.
pub fn check_state_to_vml(state: &CheckState) -> &'static str {
    match state {
        CheckState::Unchecked => "0",
        CheckState::Checked => "1",
        CheckState::Mixed => "2",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_control_type_modern_and_vml_names_are_complete() {
        let cases = [
            (FormControlType::Button, "Button", "Button"),
            (FormControlType::CheckBox, "CheckBox", "Checkbox"),
            (FormControlType::ComboBox, "Drop", "Drop"),
            (FormControlType::ListBox, "List", "List"),
            (FormControlType::RadioButton, "Radio", "Radio"),
            (FormControlType::GroupBox, "GBox", "GBox"),
            (FormControlType::Label, "Label", "Label"),
            (FormControlType::ScrollBar, "Scroll", "Scroll"),
            (FormControlType::Spinner, "Spin", "Spin"),
            (FormControlType::EditBox, "EditBox", "Edit"),
            (FormControlType::Dialog, "Dialog", "Dialog"),
        ];

        for (control_type, modern, vml) in cases {
            assert_eq!(object_type_to_modern(&control_type), modern);
            assert_eq!(object_type_to_vml(&control_type), vml);
            assert_eq!(parse_form_control_type(modern), control_type);
            assert_eq!(parse_form_control_type(vml), control_type);
        }
    }

    #[test]
    fn form_control_type_aliases_are_lossless_for_known_dialects() {
        let aliases = [
            ("checkbox", FormControlType::CheckBox),
            ("ComboBox", FormControlType::ComboBox),
            ("ListBox", FormControlType::ListBox),
            ("RadioButton", FormControlType::RadioButton),
            ("OptionButton", FormControlType::RadioButton),
            ("GroupBox", FormControlType::GroupBox),
            ("group", FormControlType::GroupBox),
            ("ScrollBar", FormControlType::ScrollBar),
            ("Spinner", FormControlType::Spinner),
            ("edit", FormControlType::EditBox),
        ];

        for (input, expected) in aliases {
            assert_eq!(parse_form_control_type(input), expected);
        }
    }

    #[test]
    fn unknown_form_control_type_roundtrips_verbatim() {
        let unknown = FormControlType::Unknown("CustomControl".to_string());
        assert_eq!(parse_form_control_type("CustomControl"), unknown);
        assert_eq!(object_type_to_modern(&unknown), "CustomControl");
        assert_eq!(object_type_to_vml(&unknown), "CustomControl");
    }

    #[test]
    fn check_state_mappings_cover_modern_and_vml_values() {
        let cases = [
            (CheckState::Unchecked, "Unchecked", "0"),
            (CheckState::Checked, "Checked", "1"),
            (CheckState::Mixed, "Mixed", "2"),
        ];

        for (state, modern, vml) in cases {
            assert_eq!(check_state_to_modern(&state), modern);
            assert_eq!(check_state_to_vml(&state), vml);
            assert_eq!(parse_check_state(modern), state);
            assert_eq!(parse_check_state(vml), state);
        }
        assert_eq!(parse_check_state("true"), CheckState::Checked);
        assert_eq!(parse_check_state("false"), CheckState::Unchecked);
    }
}
