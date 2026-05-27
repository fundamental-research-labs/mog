use crate::domain::controls::worksheet;
use crate::zip::XlsxArchive;

use super::archive_with;

#[test]
fn parses_bare_worksheet_control_refs() {
    let xml = br#"<controls>
        <control shapeId="1025" r:id="rId3" name="Check Box 1">
            <controlPr defaultSize="0"/>
        </control>
        <control shapeId="1026" r:id="rId4" name="Combo Box 2"/>
    </controls>"#;

    let controls = worksheet::parse_worksheet_controls(xml);

    assert_eq!(controls.len(), 2);
    assert_eq!(controls[0].shape_id, 1025);
    assert_eq!(controls[0].r_id, "rId3");
    assert_eq!(controls[0].name.as_deref(), Some("Check Box 1"));
    assert_eq!(controls[1].shape_id, 1026);
    assert_eq!(controls[1].r_id, "rId4");
    assert_eq!(controls[1].name.as_deref(), Some("Combo Box 2"));
}

#[test]
fn worksheet_control_parser_skips_control_pr_tags() {
    let xml = br#"<controls>
        <control shapeId="1025" r:id="rId3">
            <controlPr defaultSize="0" print="1"/>
        </control>
    </controls>"#;

    let controls = worksheet::parse_worksheet_controls(xml);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 1025);
}

#[test]
fn parses_controls_from_nested_alternate_content() {
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

    let controls = worksheet::parse_worksheet_controls_from_xml(xml);
    let shape_ids: Vec<u32> = controls.iter().map(|control| control.shape_id).collect();

    assert_eq!(shape_ids, vec![1025, 1026, 1027]);
    assert_eq!(controls[1].r_id, "rId4");
}

#[test]
fn unsupported_alternate_content_controls_fall_back() {
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

    let controls = worksheet::parse_worksheet_controls_from_xml(xml);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 1);
    assert_eq!(controls[0].name.as_deref(), Some("Fallback Control"));
}

#[test]
fn sheet_form_controls_resolve_only_typed_ctrl_prop_relationships() {
    let worksheet_xml = br#"<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <controls>
            <control shapeId="1025" r:id="rCtrl" name="Check Box 1"/>
            <control shapeId="1026" r:id="rImage" name="Wrong Type"/>
        </controls>
    </worksheet>"#;
    let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rCtrl" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp" Target="../ctrlProps/ctrlProp1.xml"/>
        <Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../ctrlProps/ctrlProp2.xml"/>
    </Relationships>"#;
    let ctrl_prop =
        br#"<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
        objectType="CheckBox" fmlaLink="$A$1"/>"#;
    let wrong_type_ctrl_prop =
        br#"<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
        objectType="Button"/>"#;
    let bytes = archive_with(&[
        ("xl/worksheets/_rels/sheet1.xml.rels", rels),
        ("xl/ctrlProps/ctrlProp1.xml", ctrl_prop),
        ("xl/ctrlProps/ctrlProp2.xml", wrong_type_ctrl_prop),
    ]);
    let archive = XlsxArchive::new(&bytes).expect("archive");

    let controls = worksheet::parse_form_controls_for_sheet(&archive, 1, worksheet_xml);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].shape_id, 1025);
    assert_eq!(controls[0].object_type, "CheckBox");
    assert_eq!(controls[0].name.as_deref(), Some("Check Box 1"));
    assert_eq!(controls[0].fmla_link.as_deref(), Some("$A$1"));
}
