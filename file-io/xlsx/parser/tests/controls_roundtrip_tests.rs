//! Roundtrip validation tests for form controls.
//!
//! These tests verify that form control attributes survive the full cycle:
//! create FormControl → write to XML → parse XML back → assert all values match.
//!
//! No real XLSX fixtures are needed — the tests exercise the XML serialization
//! and deserialization directly.

use xlsx_parser::write::ControlsWriter;
use xlsx_parser::{
    AnchorSource, CheckState, ControlAnchor, FormControl, FormControlType, WorksheetControls,
};

// =============================================================================
// Helper: assert two FormControls are equivalent
// =============================================================================

/// Compare two FormControl instances field by field for roundtrip fidelity.
fn assert_controls_match(original: &FormControl, parsed: &FormControl, label: &str) {
    assert_eq!(
        original.object_type, parsed.object_type,
        "{label}: object_type mismatch"
    );

    let op = &original.properties;
    let pp = &parsed.properties;

    assert_eq!(op.linked_cell, pp.linked_cell, "{label}: linked_cell");
    assert_eq!(op.input_range, pp.input_range, "{label}: input_range");
    assert_eq!(op.fmla_group, pp.fmla_group, "{label}: fmla_group");
    assert_eq!(op.fmla_txbx, pp.fmla_txbx, "{label}: fmla_txbx");
    assert_eq!(op.checked, pp.checked, "{label}: checked");
    assert_eq!(op.val, pp.val, "{label}: val");
    assert_eq!(op.sel, pp.sel, "{label}: sel");
    assert_eq!(op.min_value, pp.min_value, "{label}: min_value");
    assert_eq!(op.max_value, pp.max_value, "{label}: max_value");
    assert_eq!(op.increment, pp.increment, "{label}: increment");
    assert_eq!(
        op.page_increment, pp.page_increment,
        "{label}: page_increment"
    );
    assert_eq!(op.drop_lines, pp.drop_lines, "{label}: drop_lines");
    assert_eq!(op.dx, pp.dx, "{label}: dx");
    assert_eq!(op.width_min, pp.width_min, "{label}: width_min");
    assert_eq!(op.sel_type, pp.sel_type, "{label}: sel_type");
    assert_eq!(op.drop_style, pp.drop_style, "{label}: drop_style");
    assert_eq!(op.multi_sel, pp.multi_sel, "{label}: multi_sel");
    assert_eq!(op.text_h_align, pp.text_h_align, "{label}: text_h_align");
    assert_eq!(op.text_v_align, pp.text_v_align, "{label}: text_v_align");
    assert_eq!(op.edit_val, pp.edit_val, "{label}: edit_val");
    assert_eq!(op.alt_text, pp.alt_text, "{label}: alt_text");
    assert_eq!(op.macro_name, pp.macro_name, "{label}: macro_name");
    assert_eq!(op.lock_text, pp.lock_text, "{label}: lock_text");
    assert_eq!(op.no_three_d2, pp.no_three_d2, "{label}: no_three_d2");
    assert_eq!(op.no_three_d, pp.no_three_d, "{label}: no_three_d");
    assert_eq!(op.colored, pp.colored, "{label}: colored");
    assert_eq!(op.horiz, pp.horiz, "{label}: horiz");
    assert_eq!(op.first_button, pp.first_button, "{label}: first_button");
    assert_eq!(op.multi_line, pp.multi_line, "{label}: multi_line");
    assert_eq!(op.vertical_bar, pp.vertical_bar, "{label}: vertical_bar");
    assert_eq!(op.password_edit, pp.password_edit, "{label}: password_edit");
    assert_eq!(op.just_last_x, pp.just_last_x, "{label}: just_last_x");
    assert_eq!(op.items, pp.items, "{label}: items");
}

// =============================================================================
// 8a: Checkbox roundtrip
// =============================================================================

#[test]
fn test_8a_checkbox_roundtrip() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.properties.linked_cell = Some("$A$1".to_string());
    control.properties.checked = Some(CheckState::Checked);
    control.properties.lock_text = true;
    control.properties.no_three_d2 = true;

    // Write to ctrlProp XML
    let writer = ControlsWriter::new(vec![control.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);

    // Parse back
    let parsed = WorksheetControls::parse_ctrl_prop(&xml_bytes)
        .expect("Failed to parse checkbox ctrlProp XML");

    assert_controls_match(&control, &parsed, "8a-checkbox");
}

// =============================================================================
// 8b: Button roundtrip
// =============================================================================

#[test]
fn test_8b_button_roundtrip() {
    let mut control = FormControl::new(FormControlType::Button);
    control.properties.name = Some("MyButton".to_string());
    control.properties.macro_name = Some("Sheet1.Button1_Click".to_string());

    // Write to ctrlProp XML
    let writer = ControlsWriter::new(vec![control.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);

    // Parse back
    let parsed = WorksheetControls::parse_ctrl_prop(&xml_bytes)
        .expect("Failed to parse button ctrlProp XML");

    // Note: `name` is not stored in ctrlProp XML (it's in the worksheet <control> element),
    // so we check macro_name only for the ctrlProp roundtrip.
    assert_eq!(parsed.object_type, FormControlType::Button);
    assert_eq!(
        parsed.properties.macro_name,
        Some("Sheet1.Button1_Click".to_string())
    );
}

// =============================================================================
// 8c: ComboBox roundtrip
// =============================================================================

#[test]
fn test_8c_combobox_roundtrip() {
    let mut control = FormControl::new(FormControlType::ComboBox);
    control.properties.linked_cell = Some("$B$1".to_string());
    control.properties.input_range = Some("$C$1:$C$5".to_string());
    control.properties.sel = Some(3);
    control.properties.drop_lines = Some(10);
    control.properties.items = vec![
        "Option A".to_string(),
        "Option B".to_string(),
        "Option C".to_string(),
    ];

    // Write to ctrlProp XML
    let writer = ControlsWriter::new(vec![control.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);

    // Parse back
    let parsed = WorksheetControls::parse_ctrl_prop(&xml_bytes)
        .expect("Failed to parse combobox ctrlProp XML");

    // ComboBox writes as "Drop" in modern OOXML, which parses back as ComboBox
    assert_eq!(parsed.object_type, FormControlType::ComboBox);
    assert_eq!(parsed.properties.linked_cell, Some("$B$1".to_string()));
    assert_eq!(parsed.properties.input_range, Some("$C$1:$C$5".to_string()));
    assert_eq!(parsed.properties.sel, Some(3));
    assert_eq!(parsed.properties.drop_lines, Some(10));
    assert_eq!(
        parsed.properties.items,
        vec!["Option A", "Option B", "Option C"]
    );
}

// =============================================================================
// 8d: Multiple controls roundtrip
// =============================================================================

#[test]
fn test_8d_multiple_controls_roundtrip() {
    // Control 1: CheckBox
    let mut checkbox = FormControl::new(FormControlType::CheckBox);
    checkbox.properties.linked_cell = Some("$A$1".to_string());
    checkbox.properties.checked = Some(CheckState::Checked);
    checkbox.properties.lock_text = true;

    // Control 2: Button
    let mut button = FormControl::new(FormControlType::Button);
    button.properties.macro_name = Some("RunMacro".to_string());

    // Control 3: ScrollBar
    let mut scrollbar = FormControl::new(FormControlType::ScrollBar);
    scrollbar.properties.linked_cell = Some("$C$1".to_string());
    scrollbar.properties.val = Some(50);
    scrollbar.properties.min_value = Some(0);
    scrollbar.properties.max_value = Some(100);
    scrollbar.properties.increment = Some(1);
    scrollbar.properties.page_increment = Some(10);

    let controls = vec![checkbox.clone(), button.clone(), scrollbar.clone()];
    let writer = ControlsWriter::new(controls);

    // Roundtrip each control individually through ctrlProp
    for (i, original) in [&checkbox, &button, &scrollbar].iter().enumerate() {
        let xml_bytes = writer.write_ctrl_prop(i);
        let parsed = WorksheetControls::parse_ctrl_prop(&xml_bytes)
            .unwrap_or_else(|| panic!("Failed to parse control {} ctrlProp XML", i));
        assert_eq!(
            original.object_type, parsed.object_type,
            "Control {} type mismatch",
            i
        );
        assert_eq!(
            original.properties.linked_cell, parsed.properties.linked_cell,
            "Control {} linked_cell mismatch",
            i
        );
    }

    // Verify specific attributes survived for each type
    let parsed_cb = WorksheetControls::parse_ctrl_prop(&writer.write_ctrl_prop(0)).unwrap();
    assert_eq!(parsed_cb.properties.checked, Some(CheckState::Checked));
    assert!(parsed_cb.properties.lock_text);

    let parsed_btn = WorksheetControls::parse_ctrl_prop(&writer.write_ctrl_prop(1)).unwrap();
    assert_eq!(
        parsed_btn.properties.macro_name,
        Some("RunMacro".to_string())
    );

    let parsed_sb = WorksheetControls::parse_ctrl_prop(&writer.write_ctrl_prop(2)).unwrap();
    assert_eq!(parsed_sb.properties.val, Some(50));
    assert_eq!(parsed_sb.properties.min_value, Some(0));
    assert_eq!(parsed_sb.properties.max_value, Some(100));
}

// =============================================================================
// 8e: Anchor coordinates roundtrip (modern EMU)
// =============================================================================

#[test]
fn test_8e_anchor_coordinates_roundtrip() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 152400,
        from_row: 2,
        from_row_offset: 76200,
        to_col: 5,
        to_col_offset: 457200,
        to_row: 8,
        to_row_offset: 19050,
        anchor_source: AnchorSource::Modern,
    };

    // Write worksheet controls XML (contains <anchor> with <from>/<to>)
    let writer = ControlsWriter::new(vec![control.clone()]);
    let r_ids = vec!["rId1".to_string()];
    let xml_bytes = writer.write_worksheet_controls(1025, &r_ids);
    let xml_str = String::from_utf8(xml_bytes.clone()).unwrap();

    // Verify the written XML contains the correct anchor values
    assert!(xml_str.contains("<xdr:col>1</xdr:col>"), "from_col");
    assert!(
        xml_str.contains("<xdr:colOff>152400</xdr:colOff>"),
        "from_col_offset"
    );
    assert!(xml_str.contains("<xdr:row>2</xdr:row>"), "from_row");
    assert!(
        xml_str.contains("<xdr:rowOff>76200</xdr:rowOff>"),
        "from_row_offset"
    );
    assert!(xml_str.contains("<xdr:col>5</xdr:col>"), "to_col");
    assert!(
        xml_str.contains("<xdr:colOff>457200</xdr:colOff>"),
        "to_col_offset"
    );
    assert!(xml_str.contains("<xdr:row>8</xdr:row>"), "to_row");
    assert!(
        xml_str.contains("<xdr:rowOff>19050</xdr:rowOff>"),
        "to_row_offset"
    );

    // Parse the modern anchor back
    let parsed_anchor = ControlAnchor::from_modern_anchor(&xml_bytes);
    assert!(parsed_anchor.is_some(), "Modern anchor should parse");

    let result = parsed_anchor.unwrap();
    assert_eq!(result.anchor.from_col, 1);
    assert_eq!(result.anchor.from_col_offset, 152400);
    assert_eq!(result.anchor.from_row, 2);
    assert_eq!(result.anchor.from_row_offset, 76200);
    assert_eq!(result.anchor.to_col, 5);
    assert_eq!(result.anchor.to_col_offset, 457200);
    assert_eq!(result.anchor.to_row, 8);
    assert_eq!(result.anchor.to_row_offset, 19050);
    assert_eq!(result.anchor.anchor_source, AnchorSource::Modern);
    assert!(result.move_with_cells);
}

// =============================================================================
// 8f: Checkbox states roundtrip (all 3 ST_Checked values)
// =============================================================================

#[test]
fn test_8f_checkbox_states_roundtrip() {
    let states = [
        (CheckState::Unchecked, "Unchecked"),
        (CheckState::Checked, "Checked"),
        (CheckState::Mixed, "Mixed"),
    ];

    for (state, label) in &states {
        let mut control = FormControl::new(FormControlType::CheckBox);
        control.properties.checked = Some(*state);

        let writer = ControlsWriter::new(vec![control]);
        let xml_bytes = writer.write_ctrl_prop(0);

        let parsed = WorksheetControls::parse_ctrl_prop(&xml_bytes)
            .unwrap_or_else(|| panic!("Failed to parse checkbox with state {}", label));

        assert_eq!(
            parsed.properties.checked,
            Some(*state),
            "CheckState {} did not survive roundtrip",
            label
        );
    }
}

// =============================================================================
// 8g: VML roundtrip
// =============================================================================

#[test]
fn test_8g_vml_roundtrip() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.properties.linked_cell = Some("$A$1".to_string());
    control.properties.checked = Some(CheckState::Checked);
    control.properties.lock_text = true;
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

    // Write VML
    let writer = ControlsWriter::new(vec![control.clone()]);
    let vml_bytes = writer.write_vml_form_controls(1025);

    // Parse VML back
    let mut parsed_controls = Vec::new();
    WorksheetControls::parse_vml_drawing(&vml_bytes, &mut parsed_controls);

    assert_eq!(
        parsed_controls.len(),
        1,
        "Should parse exactly 1 control from VML"
    );

    let parsed = &parsed_controls[0];
    assert_eq!(parsed.object_type, FormControlType::CheckBox);
    assert_eq!(parsed.properties.linked_cell, Some("$A$1".to_string()));

    // Verify VML anchor values
    assert_eq!(parsed.anchor.from_col, 1);
    assert_eq!(parsed.anchor.from_col_offset, 15);
    assert_eq!(parsed.anchor.from_row, 2);
    assert_eq!(parsed.anchor.from_row_offset, 10);
    assert_eq!(parsed.anchor.to_col, 3);
    assert_eq!(parsed.anchor.to_col_offset, 45);
    assert_eq!(parsed.anchor.to_row, 4);
    assert_eq!(parsed.anchor.to_row_offset, 2);
    assert_eq!(parsed.anchor.anchor_source, AnchorSource::Vml);
}

// =============================================================================
// 8h: Unsupported controls passthrough (ScrollBar, Spinner)
// =============================================================================

#[test]
fn test_8h_unsupported_controls_passthrough() {
    // ScrollBar with all numeric attributes
    let mut scrollbar = FormControl::new(FormControlType::ScrollBar);
    scrollbar.properties.linked_cell = Some("$E$1".to_string());
    scrollbar.properties.val = Some(25);
    scrollbar.properties.min_value = Some(0);
    scrollbar.properties.max_value = Some(200);
    scrollbar.properties.increment = Some(5);
    scrollbar.properties.page_increment = Some(20);
    scrollbar.properties.horiz = true;

    let writer = ControlsWriter::new(vec![scrollbar.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);
    let parsed =
        WorksheetControls::parse_ctrl_prop(&xml_bytes).expect("Failed to parse scrollbar ctrlProp");

    assert_eq!(parsed.object_type, FormControlType::ScrollBar);
    assert_eq!(parsed.properties.val, Some(25));
    assert_eq!(parsed.properties.min_value, Some(0));
    assert_eq!(parsed.properties.max_value, Some(200));
    assert_eq!(parsed.properties.increment, Some(5));
    assert_eq!(parsed.properties.page_increment, Some(20));
    assert!(parsed.properties.horiz);

    // Spinner with min/max/inc/val
    let mut spinner = FormControl::new(FormControlType::Spinner);
    spinner.properties.linked_cell = Some("$F$1".to_string());
    spinner.properties.val = Some(10);
    spinner.properties.min_value = Some(1);
    spinner.properties.max_value = Some(50);
    spinner.properties.increment = Some(2);

    let writer2 = ControlsWriter::new(vec![spinner.clone()]);
    let xml_bytes2 = writer2.write_ctrl_prop(0);
    let parsed2 =
        WorksheetControls::parse_ctrl_prop(&xml_bytes2).expect("Failed to parse spinner ctrlProp");

    assert_eq!(parsed2.object_type, FormControlType::Spinner);
    assert_eq!(parsed2.properties.val, Some(10));
    assert_eq!(parsed2.properties.min_value, Some(1));
    assert_eq!(parsed2.properties.max_value, Some(50));
    assert_eq!(parsed2.properties.increment, Some(2));
    assert_eq!(parsed2.properties.linked_cell, Some("$F$1".to_string()));
}

// =============================================================================
// 8i: Dual representation — modern + VML consistency
// =============================================================================

#[test]
fn test_8i_dual_representation_consistency() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.properties.linked_cell = Some("$A$1".to_string());
    control.properties.checked = Some(CheckState::Checked);
    control.properties.lock_text = true;
    control.anchor = ControlAnchor {
        from_col: 2,
        from_col_offset: 100,
        from_row: 3,
        from_row_offset: 50,
        to_col: 5,
        to_col_offset: 200,
        to_row: 6,
        to_row_offset: 75,
        anchor_source: AnchorSource::Vml,
    };

    let writer = ControlsWriter::new(vec![control.clone()]);

    // Write both representations
    let ctrl_prop_xml = writer.write_ctrl_prop(0);
    let vml_xml = writer.write_vml_form_controls(1025);

    // Parse both
    let parsed_modern =
        WorksheetControls::parse_ctrl_prop(&ctrl_prop_xml).expect("Modern ctrlProp parse failed");
    let mut parsed_vml_controls = Vec::new();
    WorksheetControls::parse_vml_drawing(&vml_xml, &mut parsed_vml_controls);
    assert_eq!(parsed_vml_controls.len(), 1);
    let parsed_vml = &parsed_vml_controls[0];

    // Both representations should agree on object type
    assert_eq!(parsed_modern.object_type, FormControlType::CheckBox);
    assert_eq!(parsed_vml.object_type, FormControlType::CheckBox);

    // Both should have the same linked cell
    assert_eq!(
        parsed_modern.properties.linked_cell,
        Some("$A$1".to_string())
    );
    assert_eq!(parsed_vml.properties.linked_cell, Some("$A$1".to_string()));

    // Both should agree on checked state (modern uses word, VML uses int)
    assert_eq!(parsed_modern.properties.checked, Some(CheckState::Checked));

    // VML anchor should match
    assert_eq!(parsed_vml.anchor.from_col, 2);
    assert_eq!(parsed_vml.anchor.from_row, 3);
    assert_eq!(parsed_vml.anchor.to_col, 5);
    assert_eq!(parsed_vml.anchor.to_row, 6);
}

// =============================================================================
// 8j: CT_ControlPr attributes roundtrip (worksheet XML)
// =============================================================================

#[test]
fn test_8j_control_pr_attributes_roundtrip() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.properties.macro_name = Some("Sheet1.Check1_Click".to_string());
    control.properties.alt_text = Some("Accessibility label".to_string());
    control.properties.linked_cell = Some("$A$1".to_string());
    control.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 0,
        from_row: 0,
        from_row_offset: 0,
        to_col: 3,
        to_col_offset: 0,
        to_row: 1,
        to_row_offset: 0,
        anchor_source: AnchorSource::Modern,
    };

    let writer = ControlsWriter::new(vec![control.clone()]);
    let r_ids = vec!["rId3".to_string()];
    let xml_bytes = writer.write_worksheet_controls(1025, &r_ids);
    let xml_str = String::from_utf8(xml_bytes).unwrap();

    // Verify controlPr attributes are present in the worksheet XML
    assert!(xml_str.contains("defaultSize=\"0\""), "defaultSize");
    assert!(xml_str.contains("autoFill=\"0\""), "autoFill");
    assert!(xml_str.contains("autoLine=\"0\""), "autoLine");
    assert!(
        xml_str.contains("macro=\"Sheet1.Check1_Click\""),
        "macro attribute in controlPr"
    );
    assert!(
        xml_str.contains("altText=\"Accessibility label\""),
        "altText attribute in controlPr"
    );

    // Verify the control element attributes
    assert!(xml_str.contains("shapeId=\"1025\""), "shapeId");
    assert!(xml_str.contains("r:id=\"rId3\""), "r:id");

    // Verify anchor is present
    assert!(xml_str.contains("<anchor"), "anchor element");
    assert!(xml_str.contains("moveWithCells=\"1\""), "moveWithCells");
}

// =============================================================================
// 8k: VML extras roundtrip
// =============================================================================

#[test]
fn test_8k_vml_extras_roundtrip() {
    let mut control = FormControl::new(FormControlType::CheckBox);
    control.properties.linked_cell = Some("$A$1".to_string());
    control.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 10,
        from_row: 0,
        from_row_offset: 5,
        to_col: 3,
        to_col_offset: 20,
        to_row: 1,
        to_row_offset: 8,
        anchor_source: AnchorSource::Vml,
    };

    // Add VML extras
    control
        .properties
        .vml_extras
        .insert("Accel".to_string(), "65".to_string());
    control
        .properties
        .vml_extras
        .insert("Camera".to_string(), "True".to_string());

    // Write VML
    let writer = ControlsWriter::new(vec![control.clone()]);
    let vml_bytes = writer.write_vml_form_controls(1025);
    let vml_str = String::from_utf8(vml_bytes.clone()).unwrap();

    // Verify extras were written
    assert!(vml_str.contains("<x:Accel>65</x:Accel>"), "Accel written");
    assert!(
        vml_str.contains("<x:Camera>True</x:Camera>"),
        "Camera written"
    );

    // Parse VML back
    let mut parsed_controls = Vec::new();
    WorksheetControls::parse_vml_drawing(&vml_bytes, &mut parsed_controls);
    assert_eq!(parsed_controls.len(), 1);

    let parsed = &parsed_controls[0];

    // Verify extras survived roundtrip
    assert_eq!(
        parsed.properties.vml_extras.get("Accel"),
        Some(&"65".to_string()),
        "Accel roundtrip"
    );
    assert_eq!(
        parsed.properties.vml_extras.get("Camera"),
        Some(&"True".to_string()),
        "Camera roundtrip"
    );
}

// =============================================================================
// Additional: ListBox roundtrip with items and selType
// =============================================================================

#[test]
fn test_listbox_roundtrip_with_items() {
    let mut control = FormControl::new(FormControlType::ListBox);
    control.properties.linked_cell = Some("$G$1".to_string());
    control.properties.input_range = Some("$H$1:$H$10".to_string());
    control.properties.sel = Some(2);
    control.properties.sel_type = Some("Multi".to_string());
    control.properties.items = vec![
        "Alpha".to_string(),
        "Beta".to_string(),
        "Gamma".to_string(),
        "Delta".to_string(),
    ];

    let writer = ControlsWriter::new(vec![control.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);

    let parsed =
        WorksheetControls::parse_ctrl_prop(&xml_bytes).expect("Failed to parse listbox ctrlProp");

    // ListBox writes as "List" which parses back as ListBox
    assert_eq!(parsed.object_type, FormControlType::ListBox);
    assert_eq!(parsed.properties.linked_cell, Some("$G$1".to_string()));
    assert_eq!(
        parsed.properties.input_range,
        Some("$H$1:$H$10".to_string())
    );
    assert_eq!(parsed.properties.sel, Some(2));
    assert_eq!(parsed.properties.sel_type, Some("Multi".to_string()));
    assert_eq!(
        parsed.properties.items,
        vec!["Alpha", "Beta", "Gamma", "Delta"]
    );
}

// =============================================================================
// Additional: RadioButton and GroupBox roundtrip
// =============================================================================

#[test]
fn test_radio_button_roundtrip() {
    let mut control = FormControl::new(FormControlType::RadioButton);
    control.properties.linked_cell = Some("$D$1".to_string());
    control.properties.checked = Some(CheckState::Checked);
    control.properties.first_button = true;
    control.properties.no_three_d = true;
    control.properties.fmla_group = Some("$E$1".to_string());

    let writer = ControlsWriter::new(vec![control.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);
    let parsed = WorksheetControls::parse_ctrl_prop(&xml_bytes)
        .expect("Failed to parse radio button ctrlProp");

    assert_eq!(parsed.object_type, FormControlType::RadioButton);
    assert_eq!(parsed.properties.linked_cell, Some("$D$1".to_string()));
    assert_eq!(parsed.properties.checked, Some(CheckState::Checked));
    assert!(parsed.properties.first_button);
    assert!(parsed.properties.no_three_d);
    assert_eq!(parsed.properties.fmla_group, Some("$E$1".to_string()));
}

// =============================================================================
// Additional: VML multiple controls roundtrip
// =============================================================================

#[test]
fn test_vml_multiple_controls_roundtrip() {
    let mut checkbox = FormControl::new(FormControlType::CheckBox);
    checkbox.properties.linked_cell = Some("$A$1".to_string());
    checkbox.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 10,
        from_row: 0,
        from_row_offset: 5,
        to_col: 3,
        to_col_offset: 20,
        to_row: 1,
        to_row_offset: 8,
        anchor_source: AnchorSource::Vml,
    };

    let mut combo = FormControl::new(FormControlType::ComboBox);
    combo.properties.linked_cell = Some("$B$1".to_string());
    combo.properties.input_range = Some("$D$1:$D$5".to_string());
    combo.anchor = ControlAnchor {
        from_col: 1,
        from_col_offset: 0,
        from_row: 3,
        from_row_offset: 0,
        to_col: 4,
        to_col_offset: 0,
        to_row: 4,
        to_row_offset: 0,
        anchor_source: AnchorSource::Vml,
    };

    let mut spinner = FormControl::new(FormControlType::Spinner);
    spinner.properties.linked_cell = Some("$C$1".to_string());
    spinner.properties.val = Some(7);
    spinner.properties.min_value = Some(1);
    spinner.properties.max_value = Some(20);
    spinner.properties.increment = Some(1);
    spinner.anchor = ControlAnchor {
        from_col: 5,
        from_col_offset: 0,
        from_row: 0,
        from_row_offset: 0,
        to_col: 6,
        to_col_offset: 0,
        to_row: 2,
        to_row_offset: 0,
        anchor_source: AnchorSource::Vml,
    };

    let writer = ControlsWriter::new(vec![checkbox, combo, spinner]);
    let vml_bytes = writer.write_vml_form_controls(1025);

    let mut parsed = Vec::new();
    WorksheetControls::parse_vml_drawing(&vml_bytes, &mut parsed);

    assert_eq!(parsed.len(), 3, "Should parse 3 controls from VML");

    // Verify types
    assert_eq!(parsed[0].object_type, FormControlType::CheckBox);
    assert_eq!(parsed[1].object_type, FormControlType::ComboBox);
    assert_eq!(parsed[2].object_type, FormControlType::Spinner);

    // Verify linked cells
    assert_eq!(parsed[0].properties.linked_cell, Some("$A$1".to_string()));
    assert_eq!(parsed[1].properties.linked_cell, Some("$B$1".to_string()));
    assert_eq!(parsed[2].properties.linked_cell, Some("$C$1".to_string()));

    // Verify VML-specific properties survived for combo
    assert_eq!(
        parsed[1].properties.input_range,
        Some("$D$1:$D$5".to_string())
    );
}

// =============================================================================
// Additional: Boolean flags comprehensive roundtrip
// =============================================================================

#[test]
fn test_boolean_flags_comprehensive_roundtrip() {
    let mut control = FormControl::new(FormControlType::EditBox);
    control.properties.lock_text = true;
    control.properties.no_three_d = true;
    control.properties.no_three_d2 = true;
    control.properties.colored = true;
    control.properties.horiz = true;
    control.properties.first_button = true;
    control.properties.multi_line = true;
    control.properties.vertical_bar = true;
    control.properties.password_edit = true;
    control.properties.just_last_x = true;

    let writer = ControlsWriter::new(vec![control.clone()]);
    let xml_bytes = writer.write_ctrl_prop(0);
    let parsed =
        WorksheetControls::parse_ctrl_prop(&xml_bytes).expect("Failed to parse editbox ctrlProp");

    assert!(parsed.properties.lock_text, "lock_text");
    assert!(parsed.properties.no_three_d, "no_three_d");
    assert!(parsed.properties.no_three_d2, "no_three_d2");
    assert!(parsed.properties.colored, "colored");
    assert!(parsed.properties.horiz, "horiz");
    assert!(parsed.properties.first_button, "first_button");
    assert!(parsed.properties.multi_line, "multi_line");
    assert!(parsed.properties.vertical_bar, "vertical_bar");
    assert!(parsed.properties.password_edit, "password_edit");
    assert!(parsed.properties.just_last_x, "just_last_x");
}

// =============================================================================
// Test: FormControl → FormControlOutput → FormControl roundtrip
// =============================================================================

/// Test that FormControl → FormControlOutput → FormControl is lossless
/// for all control types. This validates the reverse conversion used
/// by the write pipeline to regenerate ctrlProp XML files.
#[test]
fn test_form_control_output_roundtrip_all_types() {
    use std::collections::HashMap;
    use xlsx_parser::output::results::FormControlOutput;

    let control_configs: Vec<(FormControlType, Box<dyn Fn(&mut FormControl)>)> = vec![
        (
            FormControlType::CheckBox,
            Box::new(|c: &mut FormControl| {
                c.properties.linked_cell = Some("$A$1".to_string());
                c.properties.checked = Some(CheckState::Checked);
                c.properties.lock_text = true;
                c.properties.no_three_d = true;
            }),
        ),
        (
            FormControlType::ComboBox,
            Box::new(|c: &mut FormControl| {
                c.properties.input_range = Some("$B$1:$B$10".to_string());
                c.properties.linked_cell = Some("$C$1".to_string());
                c.properties.drop_lines = Some(8);
                c.properties.drop_style = Some("combo".to_string());
                c.properties.sel = Some(3);
                c.properties.no_three_d2 = true;
            }),
        ),
        (
            FormControlType::ListBox,
            Box::new(|c: &mut FormControl| {
                c.properties.input_range = Some("$D$1:$D$20".to_string());
                c.properties.linked_cell = Some("$E$1".to_string());
                c.properties.sel_type = Some("multi".to_string());
                c.properties.multi_sel = Some("sglToggle".to_string());
                c.properties.items = vec![
                    "Item1".to_string(),
                    "Item2".to_string(),
                    "Item3".to_string(),
                ];
            }),
        ),
        (
            FormControlType::ScrollBar,
            Box::new(|c: &mut FormControl| {
                c.properties.linked_cell = Some("$F$1".to_string());
                c.properties.val = Some(50);
                c.properties.min_value = Some(0);
                c.properties.max_value = Some(100);
                c.properties.increment = Some(1);
                c.properties.page_increment = Some(10);
                c.properties.horiz = true;
                c.properties.dx = Some(20);
            }),
        ),
        (
            FormControlType::Spinner,
            Box::new(|c: &mut FormControl| {
                c.properties.linked_cell = Some("$G$1".to_string());
                c.properties.val = Some(5);
                c.properties.min_value = Some(1);
                c.properties.max_value = Some(99);
                c.properties.increment = Some(1);
            }),
        ),
        (
            FormControlType::RadioButton,
            Box::new(|c: &mut FormControl| {
                c.properties.linked_cell = Some("$H$1".to_string());
                c.properties.first_button = true;
                c.properties.fmla_group = Some("$I$1".to_string());
                c.properties.lock_text = true;
            }),
        ),
        (
            FormControlType::Button,
            Box::new(|c: &mut FormControl| {
                c.properties.macro_name = Some("Sheet1.MyMacro".to_string());
                c.properties.name = Some("Button 1".to_string());
            }),
        ),
        (
            FormControlType::GroupBox,
            Box::new(|c: &mut FormControl| {
                c.properties.name = Some("Group Box 1".to_string());
                c.properties.no_three_d = true;
            }),
        ),
        (
            FormControlType::Label,
            Box::new(|c: &mut FormControl| {
                c.properties.name = Some("Label 1".to_string());
                c.properties.lock_text = true;
            }),
        ),
        (
            FormControlType::EditBox,
            Box::new(|c: &mut FormControl| {
                c.properties.fmla_txbx = Some("$J$1".to_string());
                c.properties.multi_line = true;
                c.properties.vertical_bar = true;
                c.properties.password_edit = true;
                c.properties.edit_val = Some("integer".to_string());
            }),
        ),
    ];

    for (control_type, setup) in &control_configs {
        let label = format!("{}", control_type);

        // Create original with a rich anchor
        let anchor = ControlAnchor {
            from_col: 1,
            from_col_offset: 152400,
            from_row: 2,
            from_row_offset: 76200,
            to_col: 4,
            to_col_offset: 457200,
            to_row: 6,
            to_row_offset: 19050,
            anchor_source: AnchorSource::Modern,
        };
        let mut original = FormControl::with_anchor(control_type.clone(), anchor);
        original.properties.alt_text = Some(format!("{} alt text", label));
        original.properties.vml_extras = {
            let mut m = HashMap::new();
            m.insert("PrintObject".to_string(), "False".to_string());
            m
        };
        setup(&mut original);

        // Forward: FormControl → FormControlOutput
        let shape_id = 1025;
        let output = FormControlOutput::from_form_control(&original, shape_id);

        // Reverse: FormControlOutput → FormControl
        let roundtripped = output.to_form_control();

        // Assert all fields match
        assert_controls_match(&original, &roundtripped, &label);

        // Also verify anchor fields specifically (not covered by assert_controls_match)
        assert_eq!(
            original.anchor.from_col, roundtripped.anchor.from_col,
            "{label}: anchor.from_col"
        );
        assert_eq!(
            original.anchor.from_col_offset, roundtripped.anchor.from_col_offset,
            "{label}: anchor.from_col_offset"
        );
        assert_eq!(
            original.anchor.from_row, roundtripped.anchor.from_row,
            "{label}: anchor.from_row"
        );
        assert_eq!(
            original.anchor.from_row_offset, roundtripped.anchor.from_row_offset,
            "{label}: anchor.from_row_offset"
        );
        assert_eq!(
            original.anchor.to_col, roundtripped.anchor.to_col,
            "{label}: anchor.to_col"
        );
        assert_eq!(
            original.anchor.to_col_offset, roundtripped.anchor.to_col_offset,
            "{label}: anchor.to_col_offset"
        );
        assert_eq!(
            original.anchor.to_row, roundtripped.anchor.to_row,
            "{label}: anchor.to_row"
        );
        assert_eq!(
            original.anchor.to_row_offset, roundtripped.anchor.to_row_offset,
            "{label}: anchor.to_row_offset"
        );
        assert_eq!(
            original.anchor.anchor_source, roundtripped.anchor.anchor_source,
            "{label}: anchor.anchor_source"
        );

        // Verify VML extras survived
        assert_eq!(
            original.properties.vml_extras, roundtripped.properties.vml_extras,
            "{label}: vml_extras"
        );
    }
}

/// Test that VML anchor source roundtrips correctly (both Modern and Vml variants).
#[test]
fn test_form_control_output_roundtrip_anchor_sources() {
    use xlsx_parser::output::results::FormControlOutput;

    for anchor_source in [AnchorSource::Modern, AnchorSource::Vml] {
        let label = format!("{:?}", anchor_source);
        let anchor = ControlAnchor {
            from_col: 0,
            from_col_offset: 10,
            from_row: 0,
            from_row_offset: 20,
            to_col: 3,
            to_col_offset: 30,
            to_row: 5,
            to_row_offset: 40,
            anchor_source,
        };
        let original = FormControl::with_anchor(FormControlType::CheckBox, anchor);
        let output = FormControlOutput::from_form_control(&original, 1025);
        let roundtripped = output.to_form_control();

        assert_eq!(
            original.anchor.anchor_source, roundtripped.anchor.anchor_source,
            "{label}: anchor_source"
        );
    }
}
