use super::common::*;

#[test]
fn test_add_chart() {
    let mut writer = DrawingWriter::new();
    writer.add_chart(
        CellAnchor {
            col: 5,
            col_off: 0,
            row: 1,
            row_off: 0,
        },
        CellAnchor {
            col: 12,
            col_off: 0,
            row: 15,
            row_off: 0,
        },
        ChartRef {
            original_id: None,
            name: "Chart 1".to_string(),
            r_id: "rId3".to_string(),
            macro_name: None,
            nv_ext_lst: None,
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: false,
            no_change_aspect_explicit: None,
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
            has_xfrm: true,
            xfrm_has_off: true,
            xfrm_has_ext: true,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            xfrm_rot: Some(5_400_000),
            xfrm_flip_h: Some(true),
            xfrm_flip_v: Some(false),
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:graphicFrame>"));
    assert!(xml_str.contains("<xdr:nvGraphicFramePr>"));
    assert!(xml_str.contains("name=\"Chart 1\""));
    assert!(xml_str.contains("<xdr:xfrm"));
    assert!(xml_str.contains("<xdr:xfrm rot=\"5400000\" flipH=\"1\" flipV=\"0\">"));
    assert!(xml_str.contains("<a:graphic>"));
    assert!(xml_str.contains("<a:graphicData"));
    assert!(xml_str.contains(&format!("uri=\"{}\"", NS_C)));
    assert!(xml_str.contains("<c:chart"));
    assert!(xml_str.contains("r:id=\"rId3\""));
}

#[test]
fn standard_chart_frame_fields_round_trip_through_writer() {
    use crate::domain::drawings::{Anchor, DrawingContent, parse_drawing};

    let locks = DrawingLocking {
        no_grp: true,
        no_select: true,
        no_move: true,
        no_resize: true,
        ..Default::default()
    };
    let client_data = ClientData {
        locks_with_sheet: false,
        prints_with_sheet: false,
    };

    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from: CellAnchor {
                col: 2,
                col_off: 11,
                row: 3,
                row_off: 22,
            },
            to: CellAnchor {
                col: 9,
                col_off: 33,
                row: 18,
                row_off: 44,
            },
            client_data,
            ..Default::default()
        },
        DrawingObject::Chart(ChartRef {
            original_id: Some(44),
            name: "Locked Hidden Chart".to_string(),
            r_id: "rId44".to_string(),
            hidden: true,
            graphic_frame_locks: locks,
            has_graphic_frame_locks: true,
            no_change_aspect_explicit: Some(false),
            no_drilldown: true,
            has_xfrm: true,
            xfrm_has_off: true,
            xfrm_has_ext: true,
            xfrm_off_x: 101,
            xfrm_off_y: 202,
            xfrm_ext_cx: 303,
            xfrm_ext_cy: 404,
            xfrm_rot: Some(1_800_000),
            xfrm_flip_h: Some(true),
            xfrm_flip_v: Some(false),
            ..Default::default()
        }),
    ));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml.clone()).unwrap();

    assert!(xml_str.contains(r#"<xdr:cNvPr id="44" name="Locked Hidden Chart" hidden="1"/>"#));
    assert!(xml_str.contains(
        r#"<a:graphicFrameLocks noGrp="1" noDrilldown="1" noSelect="1" noChangeAspect="0" noMove="1" noResize="1"/>"#
    ));
    assert!(xml_str.contains(r#"<xdr:xfrm rot="1800000" flipH="1" flipV="0">"#));
    assert!(xml_str.contains(r#"<a:off x="101" y="202"/>"#));
    assert!(xml_str.contains(r#"<a:ext cx="303" cy="404"/>"#));
    assert!(xml_str.contains(r#"<xdr:clientData fLocksWithSheet="0" fPrintsWithSheet="0"/>"#));

    let drawing = parse_drawing(&xml);
    assert_eq!(drawing.anchors.len(), 1);
    let Anchor::TwoCell(anchor) = &drawing.anchors[0] else {
        panic!("expected two-cell chart anchor");
    };
    assert_eq!(anchor.from.col, 2);
    assert_eq!(anchor.from.col_off, 11);
    assert_eq!(anchor.to.row, 18);
    assert_eq!(anchor.to.row_off, 44);
    assert!(!anchor.client_data.locks_with_sheet);
    assert!(!anchor.client_data.prints_with_sheet);

    let DrawingContent::GraphicFrame(frame) = &anchor.content else {
        panic!("expected graphic frame content");
    };
    let nv = &frame.nv_graphic_frame_pr;
    assert_eq!(nv.c_nv_pr.id.value(), 44);
    assert_eq!(nv.c_nv_pr.name, "Locked Hidden Chart");
    assert!(nv.c_nv_pr.hidden);
    assert!(nv.has_graphic_frame_locks);
    assert!(nv.c_nv_graphic_frame_pr.no_grp);
    assert!(nv.c_nv_graphic_frame_pr.no_select);
    assert!(nv.c_nv_graphic_frame_pr.no_move);
    assert!(nv.c_nv_graphic_frame_pr.no_resize);
    assert_eq!(nv.no_change_aspect_explicit, Some(false));
    assert!(nv.no_drilldown);
    assert!(frame.has_xfrm);
    assert_eq!(frame.xfrm.offset, Some((101, 202)));
    assert_eq!(frame.xfrm.extent, Some((303, 404)));
    assert_eq!(frame.xfrm.rotation.map(|rot| rot.value()), Some(1_800_000));
    assert_eq!(frame.xfrm.flip_h, Some(true));
    assert_eq!(frame.xfrm.flip_v, Some(false));
}

#[test]
fn chart_ex_preserves_cnvpr_ext_lst() {
    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from: CellAnchor {
                col: 1,
                col_off: 0,
                row: 1,
                row_off: 0,
            },
            to: CellAnchor {
                col: 8,
                col_off: 0,
                row: 20,
                row_off: 0,
            },
            client_data: ClientData::default(),
            ..Default::default()
        },
        DrawingObject::ChartEx(ChartExRef {
            r_id: "rId1".to_string(),
            name: "Waterfall".to_string(),
            id: 4,
            hidden: true,
            has_xfrm: true,
            xfrm_has_off: true,
            xfrm_has_ext: true,
            xfrm_off_x: 4413250,
            xfrm_off_y: 1724025,
            xfrm_ext_cx: 4307417,
            xfrm_ext_cy: 2905125,
            xfrm_rot: Some(2_700_000),
            xfrm_flip_h: Some(false),
            xfrm_flip_v: Some(true),
            macro_name: Some(String::new()),
            nv_ext_lst: Some(
                r#"<a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{747C816B-D48A-63FE-35C7-CC1AE1ADA584}"/></a:ext></a:extLst>"#
                    .to_string(),
            ),
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: true,
            no_change_aspect_explicit: Some(false),
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
        }),
    ));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<mc:AlternateContent>"));
    assert!(xml_str.contains(&format!("uri=\"{}\"", NS_CX)));
    assert!(xml_str.contains("<xdr:cNvPr id=\"4\" name=\"Waterfall\" hidden=\"1\">"));
    assert!(xml_str.contains("<a16:creationId"));
    assert!(xml_str.contains("id=\"{747C816B-D48A-63FE-35C7-CC1AE1ADA584}\""));
    assert!(xml_str.contains("</xdr:cNvPr>"));
    assert!(xml_str.contains("<a:graphicFrameLocks noChangeAspect=\"0\"/>"));
    assert!(xml_str.contains("<xdr:xfrm rot=\"2700000\" flipH=\"0\" flipV=\"1\">"));
    assert!(xml_str.contains("<a:off x=\"4413250\" y=\"1724025\"/>"));
    assert!(xml_str.contains("<a:ext cx=\"4307417\" cy=\"2905125\"/>"));
}

#[test]
fn chart_ex_frame_fields_round_trip_through_alternate_content_writer() {
    use crate::domain::drawings::{Anchor, DrawingContent, parse_drawing};

    let locks = DrawingLocking {
        no_select: true,
        no_move: true,
        no_resize: true,
        ..Default::default()
    };
    let client_data = ClientData {
        locks_with_sheet: false,
        prints_with_sheet: false,
    };

    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from: CellAnchor {
                col: 1,
                col_off: 10,
                row: 2,
                row_off: 20,
            },
            to: CellAnchor {
                col: 6,
                col_off: 30,
                row: 14,
                row_off: 40,
            },
            client_data,
            ..Default::default()
        },
        DrawingObject::ChartEx(ChartExRef {
            r_id: "rId77".to_string(),
            name: "Waterfall Hidden".to_string(),
            id: 77,
            hidden: true,
            has_xfrm: true,
            xfrm_has_off: true,
            xfrm_has_ext: true,
            xfrm_off_x: 501,
            xfrm_off_y: 602,
            xfrm_ext_cx: 703,
            xfrm_ext_cy: 804,
            xfrm_rot: Some(2_700_000),
            xfrm_flip_h: Some(false),
            xfrm_flip_v: Some(true),
            macro_name: Some(String::new()),
            nv_ext_lst: None,
            graphic_frame_locks: locks,
            has_graphic_frame_locks: true,
            no_change_aspect_explicit: Some(true),
            no_drilldown: true,
            c_nv_graphic_frame_pr_ext_lst: None,
        }),
    ));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml.clone()).unwrap();

    assert!(xml_str.contains("<mc:AlternateContent>"));
    assert!(xml_str.contains(r#"<xdr:cNvPr id="77" name="Waterfall Hidden" hidden="1"/>"#));
    assert!(xml_str.contains(
        r#"<a:graphicFrameLocks noDrilldown="1" noSelect="1" noChangeAspect="1" noMove="1" noResize="1"/>"#
    ));
    assert!(xml_str.contains(r#"<xdr:xfrm rot="2700000" flipH="0" flipV="1">"#));
    assert!(xml_str.contains(r#"<a:off x="501" y="602"/>"#));
    assert!(xml_str.contains(r#"<a:ext cx="703" cy="804"/>"#));
    assert!(xml_str.contains(r#"<xdr:clientData fLocksWithSheet="0" fPrintsWithSheet="0"/>"#));

    let drawing = parse_drawing(&xml);
    assert_eq!(drawing.anchors.len(), 1);
    let Anchor::TwoCell(anchor) = &drawing.anchors[0] else {
        panic!("expected two-cell ChartEx anchor");
    };
    assert!(anchor.mc_alternate_content.is_some());
    assert!(!anchor.client_data.locks_with_sheet);
    assert!(!anchor.client_data.prints_with_sheet);

    let DrawingContent::GraphicFrame(frame) = &anchor.content else {
        panic!("expected ChartEx graphic frame content");
    };
    let nv = &frame.nv_graphic_frame_pr;
    assert_eq!(nv.c_nv_pr.id.value(), 77);
    assert_eq!(nv.c_nv_pr.name, "Waterfall Hidden");
    assert!(nv.c_nv_pr.hidden);
    assert!(nv.has_graphic_frame_locks);
    assert!(nv.c_nv_graphic_frame_pr.no_select);
    assert!(nv.c_nv_graphic_frame_pr.no_move);
    assert!(nv.c_nv_graphic_frame_pr.no_resize);
    assert_eq!(nv.no_change_aspect_explicit, Some(true));
    assert!(nv.no_drilldown);
    assert!(frame.has_xfrm);
    assert_eq!(frame.xfrm.offset, Some((501, 602)));
    assert_eq!(frame.xfrm.extent, Some((703, 804)));
    assert_eq!(frame.xfrm.rotation.map(|rot| rot.value()), Some(2_700_000));
    assert_eq!(frame.xfrm.flip_h, Some(false));
    assert_eq!(frame.xfrm.flip_v, Some(true));
    assert!(
        frame
            .graphic_xml
            .as_ref()
            .is_some_and(|raw| raw.contains("drawing/2014/chartex"))
    );
}

#[test]
fn chart_ex_raw_anchor_relationship_ids_are_remapped() {
    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from: CellAnchor {
                col: 1,
                col_off: 0,
                row: 1,
                row_off: 0,
            },
            to: CellAnchor {
                col: 8,
                col_off: 0,
                row: 20,
                row_off: 0,
            },
            client_data: ClientData::default(),
            mc_alternate_content: Some(crate::domain::drawings::McAlternateContent {
                raw_xml: r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><mc:Choice Requires="cx1"><cx:chart r:id="rId1"/></mc:Choice></mc:AlternateContent>"#
                    .to_string(),
            }),
            ..Default::default()
        },
        DrawingObject::ChartEx(ChartExRef {
            r_id: "rId1".to_string(),
            name: "Waterfall".to_string(),
            id: 4,
            hidden: false,
            has_xfrm: true,
            xfrm_has_off: true,
            xfrm_has_ext: true,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            xfrm_rot: None,
            xfrm_flip_h: None,
            xfrm_flip_v: None,
            macro_name: None,
            nv_ext_lst: None,
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: false,
            no_change_aspect_explicit: None,
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
        }),
    ));

    writer.remap_relationship_ids(&std::collections::HashMap::from([(
        "rId1".to_string(),
        "rId9".to_string(),
    )]));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains(r#"r:id="rId9""#));
    assert!(!xml_str.contains(r#"r:id="rId1""#));
}

fn chart_anchor() -> (CellAnchor, CellAnchor) {
    (
        CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        },
        CellAnchor {
            col: 5,
            col_off: 0,
            row: 10,
            row_off: 0,
        },
    )
}

#[test]
fn standard_chart_omits_absent_graphic_frame_transform() {
    let (from, to) = chart_anchor();
    let mut writer = DrawingWriter::new();
    writer.add_chart(
        from,
        to,
        ChartRef {
            name: "Chart 1".to_string(),
            r_id: "rId1".to_string(),
            has_xfrm: false,
            ..Default::default()
        },
    );

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(!xml.contains("<xdr:xfrm"));
    assert!(xml.contains(
        r#"<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/>"#
    ));
}

#[test]
fn standard_chart_preserves_explicit_zero_graphic_frame_transform() {
    let (from, to) = chart_anchor();
    let mut writer = DrawingWriter::new();
    writer.add_chart(
        from,
        to,
        ChartRef {
            name: "Chart 1".to_string(),
            r_id: "rId1".to_string(),
            has_xfrm: true,
            xfrm_has_off: true,
            xfrm_has_ext: true,
            ..Default::default()
        },
    );

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<xdr:xfrm>"));
    assert!(xml.contains(r#"<a:off x="0" y="0"/>"#));
    assert!(xml.contains(r#"<a:ext cx="0" cy="0"/>"#));
}

#[test]
fn standard_chart_preserves_empty_graphic_frame_transform() {
    let (from, to) = chart_anchor();
    let mut writer = DrawingWriter::new();
    writer.add_chart(
        from,
        to,
        ChartRef {
            name: "Chart 1".to_string(),
            r_id: "rId1".to_string(),
            has_xfrm: true,
            xfrm_has_off: false,
            xfrm_has_ext: false,
            ..Default::default()
        },
    );

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<xdr:xfrm/>"));
    assert!(!xml.contains("<a:off"));
    assert!(!xml.contains("<a:ext"));
}

#[test]
fn chart_ex_omits_absent_graphic_frame_transform() {
    let (from, to) = chart_anchor();
    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from,
            to,
            ..Default::default()
        },
        DrawingObject::ChartEx(ChartExRef {
            r_id: "rId7".to_string(),
            name: "Waterfall".to_string(),
            id: 7,
            hidden: false,
            has_xfrm: false,
            xfrm_has_off: false,
            xfrm_has_ext: false,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            xfrm_rot: None,
            xfrm_flip_h: None,
            xfrm_flip_v: None,
            macro_name: None,
            nv_ext_lst: None,
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: false,
            no_change_aspect_explicit: None,
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
        }),
    ));

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(!xml.contains("<xdr:xfrm"));
    assert!(xml.contains(r#"<cx:chart xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId7"/>"#));
}

#[test]
fn chart_ex_preserves_empty_graphic_frame_transform() {
    let (from, to) = chart_anchor();
    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from,
            to,
            ..Default::default()
        },
        DrawingObject::ChartEx(ChartExRef {
            r_id: "rId7".to_string(),
            name: "Waterfall".to_string(),
            id: 7,
            hidden: false,
            has_xfrm: true,
            xfrm_has_off: false,
            xfrm_has_ext: false,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            xfrm_rot: None,
            xfrm_flip_h: None,
            xfrm_flip_v: None,
            macro_name: None,
            nv_ext_lst: None,
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: false,
            no_change_aspect_explicit: None,
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
        }),
    ));

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<xdr:xfrm/>"));
    assert!(!xml.contains("<a:off"));
    assert!(!xml.contains("<a:ext"));
}
