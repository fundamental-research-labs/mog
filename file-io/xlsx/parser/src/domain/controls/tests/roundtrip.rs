use crate::domain::controls::active_x;
use crate::domain::controls::types::{
    ActiveXControl, CheckState, FormControl, FormControlProperties, FormControlType, OleObject,
    WorksheetControls,
};

#[test]
fn form_control_type_aliases_and_display_are_stable() {
    assert_eq!(FormControlType::from_str("Button"), FormControlType::Button);
    assert_eq!(
        FormControlType::from_str("checkbox"),
        FormControlType::CheckBox
    );
    assert_eq!(FormControlType::from_str("Drop"), FormControlType::ComboBox);
    assert_eq!(FormControlType::from_str("List"), FormControlType::ListBox);
    assert_eq!(
        FormControlType::from_str("Radio"),
        FormControlType::RadioButton
    );
    assert_eq!(FormControlType::from_str("GBox"), FormControlType::GroupBox);
    assert_eq!(FormControlType::from_str("edit"), FormControlType::EditBox);
    assert_eq!(FormControlType::from_str("dialog"), FormControlType::Dialog);
    assert_eq!(FormControlType::Button.to_string(), "Button");
    assert_eq!(
        FormControlType::Unknown("Foo".to_string()).to_string(),
        "Foo"
    );
}

#[test]
fn check_state_aliases_are_stable() {
    assert_eq!(CheckState::from_str("Checked"), CheckState::Checked);
    assert_eq!(CheckState::from_str("1"), CheckState::Checked);
    assert_eq!(CheckState::from_str("Mixed"), CheckState::Mixed);
    assert_eq!(CheckState::from_str("Unchecked"), CheckState::Unchecked);
    assert_eq!(CheckState::from_str("0"), CheckState::Unchecked);
}

#[test]
fn shared_type_constructors_keep_expected_defaults() {
    let control = FormControl::new(FormControlType::CheckBox);
    assert_eq!(control.object_type, FormControlType::CheckBox);

    let props = FormControlProperties::new()
        .with_linked_cell("$A$1".to_string())
        .with_input_range("$B$1:$B$10".to_string())
        .with_checked(CheckState::Checked);
    assert_eq!(props.linked_cell.as_deref(), Some("$A$1"));
    assert_eq!(props.input_range.as_deref(), Some("$B$1:$B$10"));
    assert_eq!(props.checked, Some(CheckState::Checked));

    let mut controls = WorksheetControls::new();
    assert!(controls.is_empty());
    controls
        .form_controls
        .push(FormControl::new(FormControlType::Button));
    controls
        .activex_controls
        .push(ActiveXControl::new("id".to_string(), "path".to_string()));
    controls
        .ole_objects
        .push(OleObject::new("prog".to_string(), 1));
    assert_eq!(controls.len(), 3);
    assert!(!controls.is_empty());
}

#[test]
fn active_x_parser_and_type_detection_use_shared_contract() {
    let xml = br#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX"
        ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}"
        r:id="rId1"/>"#;

    let control = active_x::parse_activex(xml).unwrap();

    assert!(control.class_id.contains("8BD21D40"));
    assert_eq!(control.persistence, "rId1");
    assert_eq!(control.control_type(), "CheckBox");
    assert_eq!(
        ActiveXControl::new("{UNKNOWN-GUID}".to_string(), "rId1".to_string()).control_type(),
        "Unknown"
    );
}

#[test]
fn ole_object_embedded_and_linked_helpers_are_stable() {
    let obj = OleObject::new("Excel.Sheet.12".to_string(), 1);
    assert_eq!(obj.prog_id, "Excel.Sheet.12");
    assert_eq!(obj.shape_id, 1);
    assert!(!obj.is_embedded());
    assert!(!obj.is_linked());

    let mut embedded = obj.clone();
    embedded.data_path = Some("embeddings/oleObject1.bin".to_string());
    assert!(embedded.is_embedded());
    assert!(!embedded.is_linked());

    let mut linked = obj;
    linked.link_path = Some("C:\\Data\\file.xlsx".to_string());
    assert!(!linked.is_embedded());
    assert!(linked.is_linked());
}
