use crate::domain::controls::mapping::{
    check_state_to_modern, check_state_to_vml, object_type_to_modern, object_type_to_vml,
};
use crate::domain::controls::types::{
    AnchorSource, CheckState, ControlAnchor, FormControl, FormControlType, OleObject,
};
use crate::domain::controls::vml::escape_xml_text;
use crate::domain::controls::write::{
    CONTENT_TYPE_CTRL_PROP, ControlsWriter, REL_CTRL_PROP, ctrl_prop_relationship_target,
};

fn make_checkbox() -> FormControl {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.properties.linked_cell = Some("$A$1".to_string());
    control.properties.checked = Some(CheckState::Checked);
    control.properties.lock_text = true;
    control.properties.no_three_d2 = true;
    control.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 152400,
        from_row: 2,
        from_row_offset: 76200,
        to_col: 3,
        to_col_offset: 457200,
        to_row: 4,
        to_row_offset: 19050,
        anchor_source: AnchorSource::Modern,
    };
    control
}

fn make_combobox() -> FormControl {
    let mut control = FormControl::new(FormControlType::ComboBox);
    control.properties.linked_cell = Some("$B$1".to_string());
    control.properties.input_range = Some("$D$1:$D$5".to_string());
    control.properties.drop_lines = Some(8);
    control.anchor = ControlAnchor::new(1, 5, 4, 6);
    control
}

fn make_scrollbar() -> FormControl {
    let mut control = FormControl::new(FormControlType::ScrollBar);
    control.properties.linked_cell = Some("$C$1".to_string());
    control.properties.val = Some(50);
    control.properties.min_value = Some(0);
    control.properties.max_value = Some(100);
    control.properties.increment = Some(1);
    control.properties.page_increment = Some(10);
    control.anchor = ControlAnchor::new(5, 0, 6, 10);
    control
}

// -------------------------------------------------------------------------
// ctrlProp XML tests
// -------------------------------------------------------------------------

#[test]
fn test_write_ctrl_prop_checkbox() {
    let control = make_checkbox();
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_ctrl_prop(0);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
    assert!(
        xml_str.contains("xmlns=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"")
    );
    assert!(xml_str.contains("objectType=\"CheckBox\""));
    assert!(xml_str.contains("fmlaLink=\"$A$1\""));
    assert!(xml_str.contains("checked=\"Checked\""));
    assert!(xml_str.contains("lockText=\"1\""));
    assert!(xml_str.contains("noThreeD2=\"1\""));
}

#[test]
fn test_write_ctrl_prop_combobox_maps_to_drop() {
    let control = make_combobox();
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_ctrl_prop(0);
    let xml_str = String::from_utf8(xml).unwrap();

    // ComboBox should be written as "Drop" in modern OOXML
    assert!(xml_str.contains("objectType=\"Drop\""));
    assert!(xml_str.contains("fmlaLink=\"$B$1\""));
    assert!(xml_str.contains("fmlaRange=\"$D$1:$D$5\""));
    assert!(xml_str.contains("dropLines=\"8\""));
}

#[test]
fn test_write_ctrl_prop_scrollbar() {
    let control = make_scrollbar();
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_ctrl_prop(0);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("objectType=\"Scroll\""));
    assert!(xml_str.contains("val=\"50\""));
    assert!(xml_str.contains("min=\"0\""));
    assert!(xml_str.contains("max=\"100\""));
    assert!(xml_str.contains("inc=\"1\""));
    assert!(xml_str.contains("page=\"10\""));
}

#[test]
fn test_write_ctrl_prop_with_items() {
    let mut control = FormControl::new(FormControlType::ListBox);
    control.properties.items = vec![
        "Item 1".to_string(),
        "Item 2".to_string(),
        "Item 3".to_string(),
    ];
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_ctrl_prop(0);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<itemLst>"));
    assert!(xml_str.contains("val=\"Item 1\""));
    assert!(xml_str.contains("val=\"Item 2\""));
    assert!(xml_str.contains("val=\"Item 3\""));
    assert!(xml_str.contains("</itemLst>"));
    assert!(xml_str.contains("</formControlPr>"));
}

#[test]
fn test_write_ctrl_prop_self_closing_no_items() {
    let control = FormControl::new(FormControlType::Button);
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_ctrl_prop(0);
    let xml_str = String::from_utf8(xml).unwrap();

    // Self-closing tag when no items
    assert!(xml_str.contains("/>"));
    assert!(!xml_str.contains("</formControlPr>"));
}

// -------------------------------------------------------------------------
// Worksheet controls XML tests
// -------------------------------------------------------------------------

#[test]
fn test_write_worksheet_controls() {
    let controls = vec![make_checkbox(), make_combobox()];
    let writer = ControlsWriter::new(controls);
    let r_ids = vec!["rId3".to_string(), "rId4".to_string()];
    let xml = writer.write_worksheet_controls(1025, &r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("mc:AlternateContent"));
    assert!(xml_str.contains("mc:Choice"));
    assert!(xml_str.contains("Requires=\"x14\""));
    assert!(xml_str.contains("<controls>"));
    assert!(xml_str.contains("shapeId=\"1025\""));
    assert!(xml_str.contains("shapeId=\"1026\""));
    assert!(xml_str.contains("r:id=\"rId3\""));
    assert!(xml_str.contains("r:id=\"rId4\""));
    assert!(xml_str.contains("<controlPr"));
    assert!(xml_str.contains("<anchor"));
    assert!(xml_str.contains("mc:Fallback"));
}

#[test]
fn test_write_worksheet_controls_anchor_values() {
    let controls = vec![make_checkbox()];
    let writer = ControlsWriter::new(controls);
    let r_ids = vec!["rId3".to_string()];
    let xml = writer.write_worksheet_controls(1025, &r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    // Check anchor values
    assert!(xml_str.contains("<xdr:col>1</xdr:col>"));
    assert!(xml_str.contains("<xdr:colOff>152400</xdr:colOff>"));
    assert!(xml_str.contains("<xdr:row>2</xdr:row>"));
    assert!(xml_str.contains("<xdr:rowOff>76200</xdr:rowOff>"));
}

// -------------------------------------------------------------------------
// VML drawing tests
// -------------------------------------------------------------------------

#[test]
fn test_write_vml_form_controls_checkbox() {
    let controls = vec![make_checkbox()];
    let writer = ControlsWriter::new(controls);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("xmlns:v=\"urn:schemas-microsoft-com:vml\""));
    assert!(xml_str.contains("xmlns:o=\"urn:schemas-microsoft-com:office:office\""));
    assert!(xml_str.contains("xmlns:x=\"urn:schemas-microsoft-com:office:excel\""));
    assert!(xml_str.contains("id=\"_x0000_s1025\""));
    assert!(xml_str.contains("type=\"#_x0000_t201\""));
    assert!(xml_str.contains("ObjectType=\"Checkbox\"")); // VML casing
    assert!(xml_str.contains("<x:FmlaLink>$A$1</x:FmlaLink>"));
    assert!(xml_str.contains("<x:Checked>1</x:Checked>"));
    assert!(xml_str.contains("<x:LockText>True</x:LockText>"));
}

#[test]
fn test_write_vml_form_controls_combobox() {
    let controls = vec![make_combobox()];
    let writer = ControlsWriter::new(controls);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("ObjectType=\"Drop\""));
    assert!(xml_str.contains("<x:FmlaLink>$B$1</x:FmlaLink>"));
    assert!(xml_str.contains("<x:FmlaRange>$D$1:$D$5</x:FmlaRange>"));
    assert!(xml_str.contains("<x:DropLines>8</x:DropLines>"));
}

#[test]
fn test_write_vml_anchor_format() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 15,
        from_row: 2,
        from_row_offset: 10,
        to_col: 3,
        to_col_offset: 45,
        to_row: 4,
        to_row_offset: 2,
        anchor_source: AnchorSource::Vml,
    };
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<x:Anchor>1, 15, 2, 10, 3, 45, 4, 2</x:Anchor>"));
}

#[test]
fn test_write_vml_emu_to_pixel_conversion() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 152400, // 16 pixels in EMU
        from_row: 2,
        from_row_offset: 76200, // 8 pixels in EMU
        to_col: 3,
        to_col_offset: 457200, // 48 pixels in EMU
        to_row: 4,
        to_row_offset: 19050, // 2 pixels in EMU
        anchor_source: AnchorSource::Modern,
    };
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    // 152400 / 9525 = 16, 76200 / 9525 = 8, 457200 / 9525 = 48, 19050 / 9525 = 2
    assert!(xml_str.contains("<x:Anchor>1, 16, 2, 8, 3, 48, 4, 2</x:Anchor>"));
}

#[test]
fn test_write_vml_shapetype() {
    let controls = vec![make_checkbox()];
    let writer = ControlsWriter::new(controls);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    // Form controls use shapetype 201, not 202 (which is for comments)
    assert!(xml_str.contains("id=\"_x0000_t201\""));
    assert!(xml_str.contains("o:spt=\"201\""));
}

#[test]
fn test_write_vml_multiple_controls() {
    let controls = vec![make_checkbox(), make_combobox(), make_scrollbar()];
    let writer = ControlsWriter::new(controls);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("id=\"_x0000_s1025\""));
    assert!(xml_str.contains("id=\"_x0000_s1026\""));
    assert!(xml_str.contains("id=\"_x0000_s1027\""));
}

// -------------------------------------------------------------------------
// Type conversion tests
// -------------------------------------------------------------------------

#[test]
fn test_object_type_to_modern() {
    assert_eq!(
        object_type_to_modern(&FormControlType::CheckBox),
        "CheckBox"
    );
    assert_eq!(object_type_to_modern(&FormControlType::ComboBox), "Drop");
    assert_eq!(object_type_to_modern(&FormControlType::ListBox), "List");
    assert_eq!(
        object_type_to_modern(&FormControlType::RadioButton),
        "Radio"
    );
    assert_eq!(object_type_to_modern(&FormControlType::GroupBox), "GBox");
    assert_eq!(object_type_to_modern(&FormControlType::ScrollBar), "Scroll");
    assert_eq!(object_type_to_modern(&FormControlType::Spinner), "Spin");
}

#[test]
fn test_object_type_to_vml() {
    assert_eq!(object_type_to_vml(&FormControlType::CheckBox), "Checkbox");
    assert_eq!(object_type_to_vml(&FormControlType::ComboBox), "Drop");
    assert_eq!(object_type_to_vml(&FormControlType::EditBox), "Edit");
}

#[test]
fn test_check_state_to_modern() {
    assert_eq!(check_state_to_modern(&CheckState::Unchecked), "Unchecked");
    assert_eq!(check_state_to_modern(&CheckState::Checked), "Checked");
    assert_eq!(check_state_to_modern(&CheckState::Mixed), "Mixed");
}

#[test]
fn test_check_state_to_vml() {
    assert_eq!(check_state_to_vml(&CheckState::Unchecked), "0");
    assert_eq!(check_state_to_vml(&CheckState::Checked), "1");
    assert_eq!(check_state_to_vml(&CheckState::Mixed), "2");
}

// -------------------------------------------------------------------------
// Relationship helper tests
// -------------------------------------------------------------------------

#[test]
fn test_ctrl_prop_relationship_target() {
    assert_eq!(
        ctrl_prop_relationship_target(1),
        "../ctrlProps/ctrlProp1.xml"
    );
    assert_eq!(
        ctrl_prop_relationship_target(5),
        "../ctrlProps/ctrlProp5.xml"
    );
}

// -------------------------------------------------------------------------
// Constants tests
// -------------------------------------------------------------------------

#[test]
fn test_constants() {
    assert!(REL_CTRL_PROP.contains("ctrlProp"));
    assert!(CONTENT_TYPE_CTRL_PROP.contains("controlproperties"));
}

// -------------------------------------------------------------------------
// Writer utility tests
// -------------------------------------------------------------------------

#[test]
fn test_writer_is_empty() {
    let writer = ControlsWriter::new(vec![]);
    assert!(writer.is_empty());
    assert_eq!(writer.len(), 0);

    let writer2 = ControlsWriter::new(vec![make_checkbox()]);
    assert!(!writer2.is_empty());
    assert_eq!(writer2.len(), 1);
}

#[test]
fn test_escape_xml_text() {
    assert_eq!(escape_xml_text("hello"), "hello");
    assert_eq!(escape_xml_text("a & b"), "a &amp; b");
    assert_eq!(escape_xml_text("<tag>"), "&lt;tag&gt;");
}

// -------------------------------------------------------------------------
// VML extras roundtrip test
// -------------------------------------------------------------------------

#[test]
fn test_vml_extras_roundtrip() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control
        .properties
        .vml_extras
        .insert("PrintObject".to_string(), "True".to_string());
    let writer = ControlsWriter::new(vec![control]);
    let xml = writer.write_vml_form_controls(1025);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<x:PrintObject>True</x:PrintObject>"));
}

// -------------------------------------------------------------------------
// Unified VML with OLE objects
// -------------------------------------------------------------------------

fn make_ole_object() -> OleObject {
    let mut obj = OleObject::new("Word.Document.12".to_string(), 2049);
    obj.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 0,
        from_row: 2,
        from_row_offset: 0,
        to_col: 5,
        to_col_offset: 0,
        to_row: 10,
        to_row_offset: 0,
        anchor_source: AnchorSource::Vml,
    };
    obj.preview_image_rel_id = Some("rId3".to_string());
    obj
}

#[test]
fn test_write_vml_with_ole_only() {
    let writer = ControlsWriter::new(vec![]);
    let ole_objects = vec![make_ole_object()];
    let ole_rel_ids = vec!["rId3".to_string()];
    let xml = writer.write_vml_with_ole(1025, &ole_objects, &ole_rel_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    // Should have shapetype 75 for OLE
    assert!(xml_str.contains("id=\"_x0000_t75\""));
    assert!(xml_str.contains("o:spt=\"75\""));
    // Should NOT have shapetype 201 (no form controls)
    assert!(!xml_str.contains("id=\"_x0000_t201\""));

    // Should have the OLE shape
    assert!(xml_str.contains("id=\"_x0000_s2049\""));
    assert!(xml_str.contains("type=\"#_x0000_t75\""));
    assert!(xml_str.contains("ObjectType=\"Pict\""));

    // Should have imagedata with preview rel
    assert!(xml_str.contains("o:relid=\"rId3\""));

    // Should have anchor
    assert!(xml_str.contains("<x:Anchor>"));
}

#[test]
fn test_write_vml_with_controls_and_ole() {
    let controls = vec![make_checkbox()];
    let writer = ControlsWriter::new(controls);
    let ole_objects = vec![make_ole_object()];
    let ole_rel_ids = vec!["rId3".to_string()];
    let xml = writer.write_vml_with_ole(1025, &ole_objects, &ole_rel_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    // Should have BOTH shapetypes
    assert!(xml_str.contains("id=\"_x0000_t201\""));
    assert!(xml_str.contains("id=\"_x0000_t75\""));

    // Should have form control shape (1025)
    assert!(xml_str.contains("id=\"_x0000_s1025\""));
    assert!(xml_str.contains("ObjectType=\"Checkbox\""));

    // Should have OLE shape (2049)
    assert!(xml_str.contains("id=\"_x0000_s2049\""));
    assert!(xml_str.contains("ObjectType=\"Pict\""));
}

#[test]
fn test_write_vml_ole_without_preview() {
    let mut ole = make_ole_object();
    ole.preview_image_rel_id = None;
    let writer = ControlsWriter::new(vec![]);
    let ole_rel_ids = vec!["".to_string()];
    let xml = writer.write_vml_with_ole(1025, &[ole], &ole_rel_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    // Should have the OLE shape but no imagedata (empty preview rel)
    assert!(xml_str.contains("ObjectType=\"Pict\""));
    assert!(!xml_str.contains("o:relid="));
}

#[test]
fn test_write_vml_ole_anchor_values() {
    let writer = ControlsWriter::new(vec![]);
    let ole_objects = vec![make_ole_object()];
    let ole_rel_ids = vec!["rId3".to_string()];
    let xml = writer.write_vml_with_ole(1025, &ole_objects, &ole_rel_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    // VML anchor format: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow, toRowOff
    assert!(xml_str.contains("<x:Anchor>1, 0, 2, 0, 5, 0, 10, 0</x:Anchor>"));
}
