use super::*;

#[test]
fn test_form_control_type_from_str() {
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
    assert_eq!(
        FormControlType::from_str("GroupBox"),
        FormControlType::GroupBox
    );
    assert_eq!(
        FormControlType::from_str("ScrollBar"),
        FormControlType::ScrollBar
    );
    assert_eq!(
        FormControlType::from_str("Spinner"),
        FormControlType::Spinner
    );
}

#[test]
fn test_form_control_type_gbox() {
    assert_eq!(FormControlType::from_str("GBox"), FormControlType::GroupBox);
    assert_eq!(FormControlType::from_str("gbox"), FormControlType::GroupBox);
}

#[test]
fn test_parse_ctrl_prop_all_ct_form_control_pr_attributes() {
    let xml = br#"<formControlPr objectType="CheckBox"
                        checked="Checked"
                        fmlaLink="$A$1"
                        fmlaRange="$B$1:$B$10"
                        fmlaGroup="$C$1"
                        fmlaTxbx="$D$1"
                        altText="My checkbox"
                        macro="MyMacro"
                        val="50"
                        sel="3"
                        min="0"
                        max="100"
                        inc="1"
                        page="10"
                        dropLines="8"
                        dx="20"
                        widthMin="64"
                        seltype="Multi"
                        dropStyle="Combo"
                        multiSel="1,3,5"
                        textHAlign="Center"
                        textVAlign="Top"
                        editVal="Restricted"
                        lockText="1"
                        noThreeD2="1"
                        noThreeD="1"
                        colored="1"
                        horiz="1"
                        firstButton="1"
                        multiLine="1"
                        verticalBar="1"
                        passwordEdit="1"
                        justLastX="1"/>"#;

    let control = WorksheetControls::parse_ctrl_prop(xml).unwrap();
    assert_eq!(control.properties.fmla_group, Some("$C$1".to_string()));
    assert_eq!(control.properties.fmla_txbx, Some("$D$1".to_string()));
    assert_eq!(control.properties.alt_text, Some("My checkbox".to_string()));
    assert_eq!(control.properties.macro_name, Some("MyMacro".to_string()));
    assert_eq!(control.properties.val, Some(50));
    assert_eq!(control.properties.sel, Some(3));
    assert_eq!(control.properties.dx, Some(20));
    assert_eq!(control.properties.width_min, Some(64));
    assert_eq!(control.properties.sel_type, Some("Multi".to_string()));
    assert_eq!(control.properties.drop_style, Some("Combo".to_string()));
    assert_eq!(control.properties.multi_sel, Some("1,3,5".to_string()));
    assert_eq!(control.properties.text_h_align, Some("Center".to_string()));
    assert_eq!(control.properties.text_v_align, Some("Top".to_string()));
    assert_eq!(control.properties.edit_val, Some("Restricted".to_string()));
    assert!(control.properties.lock_text);
    assert!(control.properties.no_three_d2);
    assert!(control.properties.no_three_d);
    assert!(control.properties.colored);
    assert!(control.properties.horiz);
    assert!(control.properties.first_button);
    assert!(control.properties.multi_line);
    assert!(control.properties.vertical_bar);
    assert!(control.properties.password_edit);
    assert!(control.properties.just_last_x);
}

#[test]
fn test_parse_ctrl_prop_item_lst() {
    let xml = br#"<formControlPr objectType="Drop" fmlaLink="$A$1">
            <itemLst>
                <item val="Option A"/>
                <item val="Option B"/>
                <item val="Option C"/>
            </itemLst>
        </formControlPr>"#;

    let control = WorksheetControls::parse_ctrl_prop(xml).unwrap();
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
fn test_form_control_type_editbox_and_dialog() {
    assert_eq!(
        FormControlType::from_str("EditBox"),
        FormControlType::EditBox
    );
    assert_eq!(FormControlType::from_str("edit"), FormControlType::EditBox);
    assert_eq!(FormControlType::from_str("Edit"), FormControlType::EditBox);
    assert_eq!(FormControlType::from_str("Dialog"), FormControlType::Dialog);
    assert_eq!(FormControlType::from_str("dialog"), FormControlType::Dialog);
}

#[test]
fn test_form_control_type_display() {
    assert_eq!(FormControlType::Button.to_string(), "Button");
    assert_eq!(FormControlType::EditBox.to_string(), "EditBox");
    assert_eq!(FormControlType::Dialog.to_string(), "Dialog");
    assert_eq!(
        FormControlType::Unknown("Foo".to_string()).to_string(),
        "Foo"
    );
}

#[test]
fn test_form_control_type_unknown() {
    match FormControlType::from_str("CustomControl") {
        FormControlType::Unknown(s) => assert_eq!(s, "CustomControl"),
        _ => panic!("Expected Unknown"),
    }
}

#[test]
fn test_check_state_from_str() {
    assert_eq!(CheckState::from_str("Checked"), CheckState::Checked);
    assert_eq!(CheckState::from_str("1"), CheckState::Checked);
    assert_eq!(CheckState::from_str("Mixed"), CheckState::Mixed);
    assert_eq!(CheckState::from_str("Unchecked"), CheckState::Unchecked);
    assert_eq!(CheckState::from_str("0"), CheckState::Unchecked);
}

#[test]
fn test_control_anchor_new() {
    let anchor = ControlAnchor::new(1, 2, 3, 4);
    assert_eq!(anchor.from_col, 1);
    assert_eq!(anchor.from_row, 2);
    assert_eq!(anchor.to_col, 3);
    assert_eq!(anchor.to_row, 4);
}

#[test]
fn test_control_anchor_from_vml() {
    let anchor = ControlAnchor::from_vml_anchor("1,15,0,10,3,22,1,4").unwrap();
    assert_eq!(anchor.from_col, 1);
    assert_eq!(anchor.from_col_offset, 15);
    assert_eq!(anchor.from_row, 0);
    assert_eq!(anchor.from_row_offset, 10);
    assert_eq!(anchor.to_col, 3);
    assert_eq!(anchor.to_col_offset, 22);
    assert_eq!(anchor.to_row, 1);
    assert_eq!(anchor.to_row_offset, 4);
}

#[test]
fn test_control_anchor_from_vml_invalid() {
    assert!(ControlAnchor::from_vml_anchor("1,2,3").is_none());
}

#[test]
fn test_form_control_new() {
    let control = FormControl::new(FormControlType::CheckBox);
    assert_eq!(control.object_type, FormControlType::CheckBox);
}

#[test]
fn test_form_control_properties_builder() {
    let props = FormControlProperties::new()
        .with_linked_cell("$A$1".to_string())
        .with_input_range("$B$1:$B$10".to_string())
        .with_checked(CheckState::Checked);

    assert_eq!(props.linked_cell, Some("$A$1".to_string()));
    assert_eq!(props.input_range, Some("$B$1:$B$10".to_string()));
    assert_eq!(props.checked, Some(CheckState::Checked));
}

#[test]
fn test_activex_control_new() {
    let control = ActiveXControl::new(
        "{8BD21D40-EC42-11CE-9E0D-00AA006002F3}".to_string(),
        "rId1".to_string(),
    );
    assert_eq!(control.control_type(), "CheckBox");
}

#[test]
fn test_activex_control_unknown_type() {
    let control = ActiveXControl::new("{UNKNOWN-GUID}".to_string(), "rId1".to_string());
    assert_eq!(control.control_type(), "Unknown");
}

#[test]
fn test_ole_object_new() {
    let obj = OleObject::new("Excel.Sheet.12".to_string(), 1);
    assert_eq!(obj.prog_id, "Excel.Sheet.12");
    assert_eq!(obj.shape_id, 1);
    assert!(!obj.is_embedded());
    assert!(!obj.is_linked());
}

#[test]
fn test_ole_object_embedded() {
    let mut obj = OleObject::new("Excel.Sheet.12".to_string(), 1);
    obj.data_path = Some("embeddings/oleObject1.bin".to_string());
    assert!(obj.is_embedded());
    assert!(!obj.is_linked());
}

#[test]
fn test_ole_object_linked() {
    let mut obj = OleObject::new("Excel.Sheet.12".to_string(), 1);
    obj.link_path = Some("C:\\Data\\file.xlsx".to_string());
    assert!(!obj.is_embedded());
    assert!(obj.is_linked());
}

#[test]
fn test_worksheet_controls_new() {
    let controls = WorksheetControls::new();
    assert!(controls.is_empty());
    assert_eq!(controls.len(), 0);
}

#[test]
fn test_parse_ctrl_prop_checkbox() {
    let xml =
        br#"<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
                        objectType="CheckBox"
                        checked="Checked"
                        fmlaLink="$A$1"/>"#;

    let control = WorksheetControls::parse_ctrl_prop(xml).unwrap();
    assert_eq!(control.object_type, FormControlType::CheckBox);
    assert_eq!(control.properties.checked, Some(CheckState::Checked));
    assert_eq!(control.properties.linked_cell, Some("$A$1".to_string()));
}

#[test]
fn test_parse_ctrl_prop_scrollbar() {
    let xml = br#"<formControlPr objectType="ScrollBar"
                        min="0" max="100" inc="1" page="10"
                        fmlaLink="$B$1"/>"#;

    let control = WorksheetControls::parse_ctrl_prop(xml).unwrap();
    assert_eq!(control.object_type, FormControlType::ScrollBar);
    assert_eq!(control.properties.min_value, Some(0));
    assert_eq!(control.properties.max_value, Some(100));
    assert_eq!(control.properties.increment, Some(1));
    assert_eq!(control.properties.page_increment, Some(10));
}

#[test]
fn test_parse_ctrl_prop_combobox() {
    let xml = br#"<formControlPr objectType="Drop"
                        fmlaLink="$A$1"
                        fmlaRange="$B$1:$B$10"
                        dropLines="8"/>"#;

    let control = WorksheetControls::parse_ctrl_prop(xml).unwrap();
    assert_eq!(control.object_type, FormControlType::ComboBox);
    assert_eq!(control.properties.linked_cell, Some("$A$1".to_string()));
    assert_eq!(
        control.properties.input_range,
        Some("$B$1:$B$10".to_string())
    );
    assert_eq!(control.properties.drop_lines, Some(8));
}

#[test]
fn test_parse_vml_drawing() {
    let xml = br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">
            <v:shape type="#_x0000_t201">
                <x:ClientData ObjectType="Checkbox">
                    <x:Anchor>1,15,0,10,3,22,1,4</x:Anchor>
                    <x:FmlaLink>$A$1</x:FmlaLink>
                </x:ClientData>
            </v:shape>
        </xml>"##;

    let mut controls = Vec::new();
    WorksheetControls::parse_vml_drawing(xml, &mut controls);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].object_type, FormControlType::CheckBox);
    assert_eq!(controls[0].properties.linked_cell, Some("$A$1".to_string()));
    assert_eq!(controls[0].anchor.from_col, 1);
}

#[test]
fn test_parse_vml_drawing_extras() {
    let xml = br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">
            <v:shape type="#_x0000_t201">
                <x:ClientData ObjectType="Drop">
                    <x:Anchor>1,0,0,0,3,0,1,0</x:Anchor>
                    <x:FmlaLink>$A$1</x:FmlaLink>
                    <x:FmlaPict>$B$2</x:FmlaPict>
                    <x:Accel>65</x:Accel>
                    <x:Camera/>
                    <x:Visible/>
                </x:ClientData>
            </v:shape>
        </xml>"##;

    let mut controls = Vec::new();
    WorksheetControls::parse_vml_drawing(xml, &mut controls);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].object_type, FormControlType::ComboBox);
    // VML extras should contain FmlaPict and Accel with values, Camera and Visible as empty
    assert_eq!(
        controls[0].properties.vml_extras.get("FmlaPict"),
        Some(&"$B$2".to_string())
    );
    assert_eq!(
        controls[0].properties.vml_extras.get("Accel"),
        Some(&"65".to_string())
    );
    assert_eq!(
        controls[0].properties.vml_extras.get("Camera"),
        Some(&String::new())
    );
    assert_eq!(
        controls[0].properties.vml_extras.get("Visible"),
        Some(&String::new())
    );
    // FmlaLink is NOT a VML-only tag, should not be in extras
    assert!(controls[0].properties.vml_extras.get("FmlaLink").is_none());
}

#[test]
fn test_vml_extras_default_empty() {
    let props = FormControlProperties::default();
    assert!(props.vml_extras.is_empty());
}

#[test]
fn test_parse_activex() {
    let xml = br#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX"
                       ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}"
                       r:id="rId1"/>"#;

    let control = WorksheetControls::parse_activex(xml).unwrap();
    assert!(control.class_id.contains("8BD21D40"));
    assert_eq!(control.persistence, "rId1");
}

#[test]
fn test_parse_ole_objects() {
    let xml = br#"<drawing>
            <oleObject progId="Excel.Sheet.12" shapeId="1" r:id="rId1"/>
            <oleObject progId="Word.Document.12" shapeId="2" link="C:\file.docx"/>
        </drawing>"#;

    let mut objects = Vec::new();
    WorksheetControls::parse_ole_objects(xml, &mut objects);

    assert_eq!(objects.len(), 2);
    assert_eq!(objects[0].prog_id, "Excel.Sheet.12");
    assert_eq!(objects[0].shape_id, 1);
    assert!(objects[0].is_embedded());
    assert_eq!(objects[0].r_id, Some("rId1".to_string()));
    assert_eq!(objects[1].prog_id, "Word.Document.12");
    assert!(objects[1].is_linked());
}

#[test]
fn test_parse_ole_objects_full_attributes() {
    let xml = br#"<oleObjects>
            <oleObject progId="Word.Document.12" shapeId="1025" r:id="rId1"
                       dvAspect="DVASPECT_ICON" oleUpdate="OLEUPDATE_ONCALL" autoLoad="1">
                <objectPr defaultSize="0" autoPict="0" altText="My Word Doc">
                    <anchor moveWithCells="1">
                        <from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff>
                              <xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></from>
                        <to><xdr:col>5</xdr:col><xdr:colOff>914400</xdr:colOff>
                            <xdr:row>10</xdr:row><xdr:rowOff>152400</xdr:rowOff></to>
                    </anchor>
                </objectPr>
            </oleObject>
        </oleObjects>"#;

    let mut objects = Vec::new();
    WorksheetControls::parse_ole_objects(xml, &mut objects);

    assert_eq!(objects.len(), 1);
    let obj = &objects[0];
    assert_eq!(obj.prog_id, "Word.Document.12");
    assert_eq!(obj.shape_id, 1025);
    assert_eq!(obj.dv_aspect, DvAspect::Icon);
    assert_eq!(obj.ole_update, OleUpdate::OnCall);
    assert!(obj.auto_load);
    assert_eq!(obj.r_id, Some("rId1".to_string()));

    // Check objectPr
    let pr = obj.object_pr.as_ref().unwrap();
    assert!(!pr.default_size);
    assert!(!pr.auto_pict);
    assert_eq!(pr.alt_text, Some("My Word Doc".to_string()));

    // Check anchor
    let anchor = pr.anchor.as_ref().unwrap();
    assert!(anchor.move_with_cells);
    assert!(!anchor.size_with_cells);
    assert_eq!(anchor.from.col, 1);
    assert_eq!(anchor.from.col_offset, 0);
    assert_eq!(anchor.from.row, 2);
    assert_eq!(anchor.to.col, 5);
    assert_eq!(anchor.to.col_offset, 914400);
    assert_eq!(anchor.to.row, 10);
    assert_eq!(anchor.to.row_offset, 152400);
}

#[test]
fn test_parse_ole_objects_with_mc_alternate_content() {
    let xml = br#"<oleObjects>
            <mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
                <mc:Choice Requires="r">
                    <oleObject progId="Excel.Sheet.12" shapeId="2048" r:id="rId5"/>
                </mc:Choice>
                <mc:Fallback>
                    <oleObject progId="Excel.Sheet.12" shapeId="2048" r:id="rId5"/>
                </mc:Fallback>
            </mc:AlternateContent>
        </oleObjects>"#;

    let mut objects = Vec::new();
    WorksheetControls::parse_ole_objects(xml, &mut objects);

    assert_eq!(objects.len(), 1);
    assert_eq!(objects[0].prog_id, "Excel.Sheet.12");
    assert_eq!(objects[0].shape_id, 2048);
}

#[test]
fn test_parse_vml_imagedata() {
    let xml = br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
            <v:shape id="_x0000_s1025" type="#_x0000_t75">
                <v:imagedata o:relid="rId1" o:title="preview"/>
            </v:shape>
            <v:shape id="_x0000_s1026" type="#_x0000_t75">
                <v:imagedata r:id="rId2"/>
            </v:shape>
            <v:shape id="_x0000_s1027" type="#_x0000_t201">
                <x:ClientData ObjectType="Checkbox"/>
            </v:shape>
        </xml>"##;

    let result = parse_vml_imagedata(xml);
    assert_eq!(result.len(), 2);
    assert_eq!(result.get("_x0000_s1025"), Some(&"rId1".to_string()));
    assert_eq!(result.get("_x0000_s1026"), Some(&"rId2".to_string()));
    assert!(result.get("_x0000_s1027").is_none());
}

#[test]
fn test_extract_vml_shape_number() {
    assert_eq!(extract_vml_shape_number("_x0000_s1025"), Some(1025));
    assert_eq!(extract_vml_shape_number("_x0000_s2048"), Some(2048));
    assert_eq!(extract_vml_shape_number("1025"), Some(1025));
    assert_eq!(extract_vml_shape_number("invalid"), None);
}

#[test]
fn test_parse_empty_ctrl_prop() {
    let control = WorksheetControls::parse_ctrl_prop(b"");
    assert!(control.is_none());
}

#[test]
fn test_parse_invalid_ctrl_prop() {
    let control = WorksheetControls::parse_ctrl_prop(b"<invalid/>");
    assert!(control.is_none());
}

#[test]
fn test_worksheet_controls_len() {
    let mut controls = WorksheetControls::new();
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

// -------------------------------------------------------------------------
// WorksheetControl / parse_worksheet_controls tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_worksheet_controls_basic() {
    let xml = br#"<controls>
            <control shapeId="1025" r:id="rId3" name="Check Box 1">
                <controlPr defaultSize="0"/>
            </control>
            <control shapeId="1026" r:id="rId4" name="Combo Box 2"/>
        </controls>"#;

    let controls = parse_worksheet_controls(xml);
    assert_eq!(controls.len(), 2);

    assert_eq!(controls[0].shape_id, 1025);
    assert_eq!(controls[0].r_id, "rId3");
    assert_eq!(controls[0].name, Some("Check Box 1".to_string()));

    assert_eq!(controls[1].shape_id, 1026);
    assert_eq!(controls[1].r_id, "rId4");
    assert_eq!(controls[1].name, Some("Combo Box 2".to_string()));
}

#[test]
fn test_parse_worksheet_controls_no_name() {
    let xml = br#"<control shapeId="2048" r:id="rId5"/>"#;
    let controls = parse_worksheet_controls(xml);
    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 2048);
    assert_eq!(controls[0].r_id, "rId5");
    assert!(controls[0].name.is_none());
}

#[test]
fn test_parse_worksheet_controls_empty() {
    let xml = b"<controls></controls>";
    let controls = parse_worksheet_controls(xml);
    assert!(controls.is_empty());
}

#[test]
fn test_parse_worksheet_controls_skips_controlpr() {
    // Ensure "controlPr" tags are not matched as "control"
    let xml = br#"<controls>
            <control shapeId="1025" r:id="rId3">
                <controlPr defaultSize="0" print="1"/>
            </control>
        </controls>"#;

    let controls = parse_worksheet_controls(xml);
    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 1025);
}

#[test]
fn test_parse_worksheet_controls_from_xml_with_mc() {
    let xml = br#"<worksheet>
<sheetData/>
<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  <mc:Choice Requires="x14">
    <controls>
      <control shapeId="1025" r:id="rId3" name="Check Box 1">
        <controlPr defaultSize="0" print="1" autoFill="0" autoPict="0"/>
      </control>
      <control shapeId="1026" r:id="rId4" name="Button 1"/>
    </controls>
  </mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>
</worksheet>"#;

    let controls = parse_worksheet_controls_from_xml(xml);
    assert_eq!(controls.len(), 2);
    assert_eq!(controls[0].shape_id, 1025);
    assert_eq!(controls[0].r_id, "rId3");
    assert_eq!(controls[0].name, Some("Check Box 1".to_string()));
    assert_eq!(controls[1].shape_id, 1026);
    assert_eq!(controls[1].r_id, "rId4");
}

#[test]
fn test_parse_worksheet_controls_from_xml_with_nested_mc_controls() {
    let xml = br#"<worksheet>
<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  <mc:Choice Requires="x14">
    <controls>
      <control shapeId="1025" r:id="rId3" name="Check Box 1">
        <controlPr defaultSize="0"/>
      </control>
      <mc:AlternateContent>
        <mc:Choice Requires="x14">
          <control shapeId="1026" r:id="rId4" name="Button 1">
            <controlPr defaultSize="0"/>
          </control>
        </mc:Choice>
        <mc:Fallback/>
      </mc:AlternateContent>
      <control shapeId="1027" r:id="rId5" name="Drop Down 1">
        <controlPr defaultSize="0"/>
      </control>
    </controls>
  </mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>
</worksheet>"#;

    let controls = parse_worksheet_controls_from_xml(xml);
    let shape_ids: Vec<u32> = controls.iter().map(|control| control.shape_id).collect();

    assert_eq!(shape_ids, vec![1025, 1026, 1027]);
    assert_eq!(controls[1].r_id, "rId4");
}

#[test]
fn test_parse_worksheet_controls_from_xml_no_mc() {
    // Bare <controls> without mc:AlternateContent wrapper
    let xml = br#"<worksheet>
<sheetData/>
<controls>
  <control shapeId="1025" r:id="rId3" name="Check Box 1"/>
</controls>
</worksheet>"#;

    let controls = parse_worksheet_controls_from_xml(xml);
    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 1025);
}

#[test]
fn test_parse_worksheet_controls_from_xml_empty_worksheet() {
    let xml = b"<worksheet><sheetData/></worksheet>";
    let controls = parse_worksheet_controls_from_xml(xml);
    assert!(controls.is_empty());
}

#[test]
fn test_parse_worksheet_controls_from_xml_unsupported_ns_falls_back() {
    let xml = br#"<worksheet>
<mc:AlternateContent>
  <mc:Choice Requires="unknownNs">
    <controls>
      <control shapeId="999" r:id="rId99"/>
    </controls>
  </mc:Choice>
  <mc:Fallback>
    <controls>
      <control shapeId="1" r:id="rId1" name="Fallback Control"/>
    </controls>
  </mc:Fallback>
</mc:AlternateContent>
</worksheet>"#;

    let controls = parse_worksheet_controls_from_xml(xml);
    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 1);
    assert_eq!(controls[0].name, Some("Fallback Control".to_string()));
}

// -------------------------------------------------------------------------
// AnchorSource + Modern anchor tests
// -------------------------------------------------------------------------

#[test]
fn test_anchor_source_default() {
    assert_eq!(AnchorSource::default(), AnchorSource::Vml);
}

#[test]
fn test_control_anchor_vml_has_vml_source() {
    let anchor = ControlAnchor::from_vml_anchor("1,15,0,10,3,22,1,4").unwrap();
    assert_eq!(anchor.anchor_source, AnchorSource::Vml);
}

#[test]
fn test_control_anchor_default_has_vml_source() {
    let anchor = ControlAnchor::default();
    assert_eq!(anchor.anchor_source, AnchorSource::Vml);
}

#[test]
fn test_from_modern_anchor_basic() {
    let xml = br#"<controlPr>
            <anchor moveWithCells="1" sizeWithCells="0">
                <from><col>1</col><colOff>152400</colOff><row>2</row><rowOff>76200</rowOff></from>
                <to><col>3</col><colOff>457200</colOff><row>4</row><rowOff>19050</rowOff></to>
            </anchor>
        </controlPr>"#;

    let result = ControlAnchor::from_modern_anchor(xml).unwrap();
    assert_eq!(result.anchor.from_col, 1);
    assert_eq!(result.anchor.from_col_offset, 152400);
    assert_eq!(result.anchor.from_row, 2);
    assert_eq!(result.anchor.from_row_offset, 76200);
    assert_eq!(result.anchor.to_col, 3);
    assert_eq!(result.anchor.to_col_offset, 457200);
    assert_eq!(result.anchor.to_row, 4);
    assert_eq!(result.anchor.to_row_offset, 19050);
    assert_eq!(result.anchor.anchor_source, AnchorSource::Modern);
    assert!(result.move_with_cells);
    assert!(!result.size_with_cells);
}

#[test]
fn test_from_modern_anchor_both_flags_true() {
    let xml = br#"<anchor moveWithCells="1" sizeWithCells="1">
            <from><col>0</col><colOff>0</colOff><row>0</row><rowOff>0</rowOff></from>
            <to><col>5</col><colOff>914400</colOff><row>10</row><rowOff>914400</rowOff></to>
        </anchor>"#;

    let result = ControlAnchor::from_modern_anchor(xml).unwrap();
    assert!(result.move_with_cells);
    assert!(result.size_with_cells);
    assert_eq!(result.anchor.to_col_offset, 914400);
    assert_eq!(result.anchor.to_row_offset, 914400);
}

#[test]
fn test_from_modern_anchor_no_flags() {
    // When attributes are absent, parse_bool_attr returns false
    let xml = br#"<anchor>
            <from><col>0</col><colOff>0</colOff><row>0</row><rowOff>0</rowOff></from>
            <to><col>1</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></to>
        </anchor>"#;

    let result = ControlAnchor::from_modern_anchor(xml).unwrap();
    assert!(!result.move_with_cells);
    assert!(!result.size_with_cells);
}

#[test]
fn test_from_modern_anchor_missing_anchor_tag() {
    let xml = b"<controlPr><noAnchorHere/></controlPr>";
    assert!(ControlAnchor::from_modern_anchor(xml).is_none());
}

#[test]
fn test_from_modern_anchor_missing_from() {
    let xml = br#"<anchor>
            <to><col>1</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></to>
        </anchor>"#;
    assert!(ControlAnchor::from_modern_anchor(xml).is_none());
}

#[test]
fn test_from_modern_anchor_missing_to() {
    let xml = br#"<anchor>
            <from><col>0</col><colOff>0</colOff><row>0</row><rowOff>0</rowOff></from>
        </anchor>"#;
    assert!(ControlAnchor::from_modern_anchor(xml).is_none());
}

#[test]
fn test_from_modern_anchor_large_emu_values() {
    // Test with large EMU values to verify i64 handles the range
    let xml = br#"<anchor moveWithCells="1">
            <from><col>0</col><colOff>9525000</colOff><row>0</row><rowOff>9525000</rowOff></from>
            <to><col>100</col><colOff>9525000</colOff><row>200</row><rowOff>9525000</rowOff></to>
        </anchor>"#;

    let result = ControlAnchor::from_modern_anchor(xml).unwrap();
    assert_eq!(result.anchor.from_col_offset, 9525000);
    assert_eq!(result.anchor.to_col, 100);
    assert_eq!(result.anchor.to_row, 200);
}
