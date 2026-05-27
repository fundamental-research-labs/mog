use ooxml_types::ole::{DvAspect, OleUpdate};

use crate::domain::controls::ole;

#[test]
fn parses_embedded_and_linked_ole_objects() {
    let xml = br#"<drawing>
        <oleObject progId="Excel.Sheet.12" shapeId="1" r:id="rId1"/>
        <oleObject progId="Word.Document.12" shapeId="2" link="C:\file.docx"/>
    </drawing>"#;

    let mut objects = Vec::new();
    ole::parse_ole_objects(xml, &mut objects);

    assert_eq!(objects.len(), 2);
    assert_eq!(objects[0].prog_id, "Excel.Sheet.12");
    assert_eq!(objects[0].shape_id, 1);
    assert!(objects[0].is_embedded());
    assert_eq!(objects[0].r_id.as_deref(), Some("rId1"));
    assert_eq!(objects[1].prog_id, "Word.Document.12");
    assert!(objects[1].is_linked());
}

#[test]
fn parses_ole_object_pr_attributes_and_anchor() {
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
    ole::parse_ole_objects(xml, &mut objects);

    assert_eq!(objects.len(), 1);
    let obj = &objects[0];
    assert_eq!(obj.prog_id, "Word.Document.12");
    assert_eq!(obj.shape_id, 1025);
    assert_eq!(obj.dv_aspect, DvAspect::Icon);
    assert_eq!(obj.ole_update, OleUpdate::OnCall);
    assert!(obj.auto_load);
    assert_eq!(obj.r_id.as_deref(), Some("rId1"));

    let pr = obj.object_pr.as_ref().unwrap();
    assert!(!pr.default_size);
    assert!(!pr.auto_pict);
    assert_eq!(pr.alt_text.as_deref(), Some("My Word Doc"));

    let anchor = pr.anchor.as_ref().unwrap();
    assert!(anchor.move_with_cells);
    assert!(!anchor.size_with_cells);
    assert_eq!(anchor.from.col, 1);
    assert_eq!(anchor.from.row, 2);
    assert_eq!(anchor.to.col, 5);
    assert_eq!(anchor.to.col_offset, 914400);
    assert_eq!(anchor.to.row_offset, 152400);
}

#[test]
fn parses_ole_objects_inside_alternate_content_once() {
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
    ole::parse_ole_objects(xml, &mut objects);

    assert_eq!(objects.len(), 1);
    assert_eq!(objects[0].prog_id, "Excel.Sheet.12");
    assert_eq!(objects[0].shape_id, 2048);
}
