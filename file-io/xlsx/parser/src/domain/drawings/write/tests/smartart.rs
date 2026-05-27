use super::common::*;

// =========================================================================
// SmartArt graphicFrame XML tests
// =========================================================================

use crate::domain::drawings::write::{
    DIAGRAM_GRAPHIC_DATA_URI, NS_DGM, SmartArtWriteData, TwoCellAnchor,
};

#[test]
fn test_smartart_graphic_frame_xml() {
    let sa = SmartArtWriteData {
        original_id: None,
        name: "Diagram 1".to_string(),
        dm_rel_id: "rId10".to_string(),
        lo_rel_id: "rId11".to_string(),
        qs_rel_id: "rId12".to_string(),
        cs_rel_id: "rId13".to_string(),
        data_xml: Some("<dgm:dataModel/>".to_string()),
        layout_xml: Some("<dgm:layoutDef/>".to_string()),
        colors_xml: Some("<dgm:colorsDef/>".to_string()),
        style_xml: Some("<dgm:styleDef/>".to_string()),
        drawing_xml: None,
    };

    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from: CellAnchor {
                col: 0,
                col_off: 0,
                row: 0,
                row_off: 0,
            },
            to: CellAnchor {
                col: 5,
                col_off: 0,
                row: 10,
                row_off: 0,
            },
            edit_as: Some(EditAs::TwoCell),
            client_data: ClientData::default(),
            ..Default::default()
        },
        DrawingObject::SmartArt(sa),
    ));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Verify graphicFrame structure
    assert!(
        xml_str.contains("<xdr:graphicFrame>"),
        "should have graphicFrame element"
    );
    assert!(
        xml_str.contains("<xdr:nvGraphicFramePr>"),
        "should have nvGraphicFramePr"
    );
    assert!(
        xml_str.contains("name=\"Diagram 1\""),
        "should have name attribute"
    );
    assert!(
        xml_str.contains("<xdr:cNvGraphicFramePr/>"),
        "should have cNvGraphicFramePr"
    );
    assert!(xml_str.contains("<xdr:xfrm>"), "should have xfrm");

    // Verify diagram relIds
    assert!(
        xml_str.contains(&format!("uri=\"{}\"", DIAGRAM_GRAPHIC_DATA_URI)),
        "should have diagram URI"
    );
    assert!(
        xml_str.contains(&format!("xmlns:dgm=\"{}\"", NS_DGM)),
        "should have dgm namespace"
    );
    assert!(xml_str.contains("r:dm=\"rId10\""), "should have dm rel id");
    assert!(xml_str.contains("r:lo=\"rId11\""), "should have lo rel id");
    assert!(xml_str.contains("r:qs=\"rId12\""), "should have qs rel id");
    assert!(xml_str.contains("r:cs=\"rId13\""), "should have cs rel id");
    assert!(
        xml_str.contains("<dgm:relIds"),
        "should have dgm:relIds element"
    );

    // Verify it closes properly
    assert!(
        xml_str.contains("</xdr:graphicFrame>"),
        "should close graphicFrame"
    );
}

#[test]
fn test_smartart_content_type_helpers() {
    use crate::domain::content_types::write::ContentTypesManager;

    let mut ct = ContentTypesManager::new();
    ct.add_diagram_data(1);
    ct.add_diagram_layout(1);
    ct.add_diagram_colors(1);
    ct.add_diagram_style(1);
    ct.add_diagram_drawing(1);

    assert!(ct.has_override("/xl/diagrams/data1.xml"));
    assert!(ct.has_override("/xl/diagrams/layout1.xml"));
    assert!(ct.has_override("/xl/diagrams/colors1.xml"));
    assert!(ct.has_override("/xl/diagrams/quickStyles1.xml"));
    assert!(ct.has_override("/xl/diagrams/drawing1.xml"));

    // Add a second diagram
    ct.add_diagram_data(2);
    ct.add_diagram_layout(2);
    assert!(ct.has_override("/xl/diagrams/data2.xml"));
    assert!(ct.has_override("/xl/diagrams/layout2.xml"));
}

#[test]
fn test_smartart_relationships() {
    use crate::write::relationships::{
        REL_DIAGRAM_COLORS, REL_DIAGRAM_DATA, REL_DIAGRAM_DRAWING, REL_DIAGRAM_LAYOUT,
        REL_DIAGRAM_QUICK_STYLE, RelationshipManager,
    };

    let mut rels = RelationshipManager::new();
    let dm_id = rels.add(REL_DIAGRAM_DATA, "../diagrams/data1.xml");
    let lo_id = rels.add(REL_DIAGRAM_LAYOUT, "../diagrams/layout1.xml");
    let qs_id = rels.add(REL_DIAGRAM_QUICK_STYLE, "../diagrams/quickStyles1.xml");
    let cs_id = rels.add(REL_DIAGRAM_COLORS, "../diagrams/colors1.xml");
    let dw_id = rels.add(REL_DIAGRAM_DRAWING, "../diagrams/drawing1.xml");

    assert_eq!(dm_id, "rId1");
    assert_eq!(lo_id, "rId2");
    assert_eq!(qs_id, "rId3");
    assert_eq!(cs_id, "rId4");
    assert_eq!(dw_id, "rId5");

    let xml = rels.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains(REL_DIAGRAM_DATA));
    assert!(xml_str.contains(REL_DIAGRAM_LAYOUT));
    assert!(xml_str.contains(REL_DIAGRAM_QUICK_STYLE));
    assert!(xml_str.contains(REL_DIAGRAM_COLORS));
    assert!(xml_str.contains(REL_DIAGRAM_DRAWING));
    assert!(xml_str.contains("../diagrams/data1.xml"));
}

#[test]
fn test_smartart_conversion_from_read() {
    use crate::domain::drawings::write::{convert_drawing_content, populate_smartart_parts};
    use crate::domain::drawings::{DrawingContent, SmartArtGraphicFrame, SmartArtParts};

    let sa_frame = SmartArtGraphicFrame {
        dm_rel_id: "rId1".to_string(),
        lo_rel_id: "rId2".to_string(),
        qs_rel_id: "rId3".to_string(),
        cs_rel_id: "rId4".to_string(),
    };

    let content = DrawingContent::SmartArt(sa_frame);
    let result = convert_drawing_content(&content);
    assert!(result.is_some(), "SmartArt should convert to DrawingObject");

    let obj = result.unwrap();
    match &obj {
        DrawingObject::SmartArt(sa) => {
            assert_eq!(sa.dm_rel_id, "rId1");
            assert_eq!(sa.lo_rel_id, "rId2");
            assert_eq!(sa.qs_rel_id, "rId3");
            assert_eq!(sa.cs_rel_id, "rId4");
            assert!(sa.data_xml.is_none(), "XML parts should initially be None");
        }
        _ => panic!("expected SmartArt variant"),
    }

    // Test populate_smartart_parts
    if let DrawingObject::SmartArt(ref mut sa) = { obj } {
        let parts = SmartArtParts {
            anchor_index: 0,
            data_xml: Some("<dgm:dataModel/>".to_string()),
            layout_xml: Some("<dgm:layoutDef/>".to_string()),
            colors_xml: Some("<dgm:colorsDef/>".to_string()),
            style_xml: Some("<dgm:styleDef/>".to_string()),
            drawing_xml: Some("<dsp:drawing/>".to_string()),
        };
        populate_smartart_parts(sa, &parts);
        assert_eq!(sa.data_xml.as_deref(), Some("<dgm:dataModel/>"));
        assert_eq!(sa.layout_xml.as_deref(), Some("<dgm:layoutDef/>"));
        assert_eq!(sa.colors_xml.as_deref(), Some("<dgm:colorsDef/>"));
        assert_eq!(sa.style_xml.as_deref(), Some("<dgm:styleDef/>"));
        assert_eq!(sa.drawing_xml.as_deref(), Some("<dsp:drawing/>"));
    }
}

#[test]
fn test_smartart_content_types_xml_output() {
    use crate::domain::content_types::write::{
        CT_DIAGRAM_COLORS, CT_DIAGRAM_DATA, CT_DIAGRAM_DRAWING, CT_DIAGRAM_LAYOUT,
        CT_DIAGRAM_STYLE, ContentTypesManager,
    };

    let mut ct = ContentTypesManager::with_xlsx_defaults();
    ct.add_diagram_data(1);
    ct.add_diagram_layout(1);
    ct.add_diagram_colors(1);
    ct.add_diagram_style(1);
    ct.add_diagram_drawing(1);

    let xml = ct.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(
        xml_str.contains(CT_DIAGRAM_DATA),
        "should contain diagram data CT"
    );
    assert!(
        xml_str.contains(CT_DIAGRAM_LAYOUT),
        "should contain diagram layout CT"
    );
    assert!(
        xml_str.contains(CT_DIAGRAM_COLORS),
        "should contain diagram colors CT"
    );
    assert!(
        xml_str.contains(CT_DIAGRAM_STYLE),
        "should contain diagram style CT"
    );
    assert!(
        xml_str.contains(CT_DIAGRAM_DRAWING),
        "should contain diagram drawing CT"
    );
    assert!(
        xml_str.contains("/xl/diagrams/data1.xml"),
        "should contain data path"
    );
    assert!(
        xml_str.contains("/xl/diagrams/quickStyles1.xml"),
        "should contain quickStyles path"
    );
}
