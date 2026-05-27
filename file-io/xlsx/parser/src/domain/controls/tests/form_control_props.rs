use crate::domain::controls::form_control_props;
use crate::domain::controls::types::{CheckState, FormControlType};

#[test]
fn parses_checkbox_ctrl_prop() {
    let xml =
        br#"<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
            objectType="CheckBox"
            checked="Checked"
            fmlaLink="$A$1"/>"#;

    let control = form_control_props::parse_ctrl_prop(xml).unwrap();

    assert_eq!(control.object_type, FormControlType::CheckBox);
    assert_eq!(control.properties.checked, Some(CheckState::Checked));
    assert_eq!(control.properties.linked_cell.as_deref(), Some("$A$1"));
}

#[test]
fn parses_scrollbar_ctrl_prop_state() {
    let xml = br#"<formControlPr objectType="ScrollBar"
        min="0" max="100" inc="1" page="10" fmlaLink="$B$1"/>"#;

    let control = form_control_props::parse_ctrl_prop(xml).unwrap();

    assert_eq!(control.object_type, FormControlType::ScrollBar);
    assert_eq!(control.properties.min_value, Some(0));
    assert_eq!(control.properties.max_value, Some(100));
    assert_eq!(control.properties.increment, Some(1));
    assert_eq!(control.properties.page_increment, Some(10));
    assert_eq!(control.properties.linked_cell.as_deref(), Some("$B$1"));
}

#[test]
fn parses_combobox_ctrl_prop_range_and_items() {
    let xml = br#"<formControlPr objectType="Drop"
            fmlaLink="$A$1"
            fmlaRange="$B$1:$B$10"
            dropLines="8">
        <itemLst>
            <item val="Option A"/>
            <item val="Option B"/>
            <item val="Option C"/>
        </itemLst>
    </formControlPr>"#;

    let control = form_control_props::parse_ctrl_prop(xml).unwrap();

    assert_eq!(control.object_type, FormControlType::ComboBox);
    assert_eq!(control.properties.linked_cell.as_deref(), Some("$A$1"));
    assert_eq!(
        control.properties.input_range.as_deref(),
        Some("$B$1:$B$10")
    );
    assert_eq!(control.properties.drop_lines, Some(8));
    assert_eq!(
        control.properties.items,
        vec![
            "Option A".to_string(),
            "Option B".to_string(),
            "Option C".to_string(),
        ]
    );
}

#[test]
fn empty_or_invalid_ctrl_prop_returns_none() {
    assert!(form_control_props::parse_ctrl_prop(b"").is_none());
    assert!(form_control_props::parse_ctrl_prop(b"<invalid/>").is_none());
}
