use domain_types::domain::chart::{AnchorPosition, ObjectSize};
use domain_types::domain::floating_object::*;

use super::anchors::EMUS_PER_PIXEL;
use super::connectors::convert_unified_connector;
use super::images::{
    base64_decode, next_available_image_r_id, parse_data_url, push_image_blob_if_data_url,
};
use super::shapes::{convert_shape, convert_text_box, parse_shape_preset};
use super::smartart::convert_unified_smartart;
use super::*;
use crate::domain::drawings::write::{DrawingAnchor, DrawingObject, ShapePreset};
use crate::infra::opc::REL_HYPERLINK;

fn make_common(name: &str) -> FloatingObjectCommon {
    FloatingObjectCommon {
        id: "test".to_string(),
        sheet_id: String::new(),
        anchor: FloatingObjectAnchor {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            anchor_mode: AnchorMode::TwoCell,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(5),
            end_col: Some(5),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: None,
            extent_cy: None,
        },
        width: 200.0,
        height: 100.0,
        z_index: 0,
        rotation: 0.0,
        flip_h: false,
        flip_v: false,
        locked: false,
        visible: true,
        printable: true,
        opacity: 1.0,
        name: name.to_string(),
        created_at: 0,
        updated_at: 0,
        group_id: None,
        anchor_cell_id: None,
        to_anchor_cell_id: None,
        lock_aspect_ratio: None,
        alt_text_title: None,
        display_name: None,
        import_status: None,
    }
}

fn picture_with_ooxml(common: FloatingObjectCommon, ooxml: PictureOoxmlProps) -> FloatingObject {
    FloatingObject {
        common,
        data: FloatingObjectData::Picture(PictureData {
            src: "data:image/png;base64,AQIDBA==".to_string(),
            original_width: None,
            original_height: None,
            crop: None,
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: Some(ooxml),
        }),
    }
}

fn shape_with_ooxml(common: FloatingObjectCommon, ooxml: ShapeOoxmlProps) -> FloatingObject {
    FloatingObject {
        common,
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            fill: None,
            outline: None,
            text: None,
            shadow: None,
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: Some(ooxml),
        }),
    }
}

fn shape_data(shape_type: &str, text: Option<&str>) -> ShapeData {
    ShapeData {
        shape_type: shape_type.to_string(),
        fill: None,
        outline: None,
        text: text.map(|content| ShapeText {
            content: content.to_string(),
            ..Default::default()
        }),
        shadow: None,
        adjustments: None,
        scene_3d: None,
        sp_3d: None,
        ooxml: None,
    }
}

fn textbox_data(text: Option<&str>) -> TextboxData {
    TextboxData {
        text: text.map(|content| ShapeText {
            content: content.to_string(),
            ..Default::default()
        }),
        fill: None,
        border: None,
        text_effects: None,
        ooxml: None,
    }
}

#[test]
fn test_anchor_position_to_two_cell() {
    let pos = AnchorPosition {
        anchor_row: 1,
        anchor_col: 2,
        anchor_row_offset: 100,
        anchor_col_offset: 200,
        absolute_x: None,
        absolute_y: None,
        end_row: Some(5),
        end_col: Some(6),
        end_row_offset: Some(300),
        end_col_offset: Some(400),
        extent_cx: None,
        extent_cy: None,
    };

    let anchor = anchor_position_to_two_cell(&pos);
    assert_eq!(anchor.from.row, 1);
    assert_eq!(anchor.from.col, 2);
    assert_eq!(anchor.from.row_off, 100);
    assert_eq!(anchor.from.col_off, 200);
    assert_eq!(anchor.to.row, 5);
    assert_eq!(anchor.to.col, 6);
    assert_eq!(anchor.to.row_off, 300);
    assert_eq!(anchor.to.col_off, 400);
}

#[test]
fn test_anchor_position_to_one_cell() {
    let pos = AnchorPosition {
        anchor_row: 3,
        anchor_col: 4,
        anchor_row_offset: 0,
        anchor_col_offset: 0,
        absolute_x: None,
        absolute_y: None,
        end_row: None,
        end_col: None,
        end_row_offset: None,
        end_col_offset: None,
        extent_cx: None,
        extent_cy: None,
    };
    let size = ObjectSize {
        width: 100.0,
        height: 200.0,
        ..Default::default()
    };

    let anchor = anchor_position_to_one_cell(&pos, &size, None);
    assert_eq!(anchor.from.row, 3);
    assert_eq!(anchor.from.col, 4);
    assert_eq!(anchor.extent.cx, 100 * EMUS_PER_PIXEL);
    assert_eq!(anchor.extent.cy, 200 * EMUS_PER_PIXEL);
}

#[test]
fn test_convert_shape_floating_object() {
    let common = make_common("Arrow");
    let shape = convert_shape(&common, &shape_data("rightArrow", Some("Go")));
    assert_eq!(shape.name, "Arrow");
    assert_eq!(shape.preset, ShapePreset::RightArrow);
    assert_eq!(shape.text.as_deref(), Some("Go"));
}

#[test]
fn test_convert_text_box_floating_object() {
    let common = make_common("Note");
    let tb = convert_text_box(&common, &textbox_data(Some("Memo")));
    assert_eq!(tb.name, "Note");
    assert!(tb.text_body.is_some());
    let text_body = tb.text_body.as_ref().unwrap();
    let first_run = &text_body.paragraphs[0].runs[0];
    let crate::domain::drawings::write::TextRunContent::Run(run) = first_run else {
        panic!("expected plain text run");
    };
    assert_eq!(run.text, "Memo");
}

#[test]
fn test_convert_connector() {
    let common = make_common("Link");
    let conn_data = ConnectorData {
        shape_type: "straightConnector1".to_string(),
        fill: None,
        outline: None,
        start_connection: Some(ConnectorBinding {
            shape_id: "10".to_string(),
            site_index: 0,
        }),
        end_connection: Some(ConnectorBinding {
            shape_id: "20".to_string(),
            site_index: 2,
        }),
        adjustments: None,
        ooxml: None,
    };
    let cp = convert_unified_connector(&common, &conn_data);
    assert_eq!(cp.name, "Link");
    assert!(cp.start_connection.is_some());
    assert_eq!(cp.start_connection.unwrap().shape_id, 10);
    assert!(cp.end_connection.is_some());
    assert_eq!(cp.end_connection.unwrap().idx, 2);
}

#[test]
fn test_convert_smartart() {
    let common = make_common("SmartArt");
    let sa_data = DiagramData {
        definition: domain_types::domain::smartart::SmartArtDefinition {
            dm_rel_id: Some("rId10".to_string()),
            lo_rel_id: Some("rId11".to_string()),
            qs_rel_id: Some("rId12".to_string()),
            cs_rel_id: Some("rId13".to_string()),
            data_xml: Some("<dgm:dataModel/>".to_string()),
            ..Default::default()
        },
        category: Some(domain_types::domain::smartart::SmartArtCategory::Hierarchy),
    };
    let data = convert_unified_smartart(&common, &sa_data);
    assert_eq!(data.dm_rel_id, "rId10");
    assert_eq!(data.lo_rel_id, "rId11");
    assert_eq!(data.data_xml, Some("<dgm:dataModel/>".to_string()));
    assert_eq!(data.name, "Hierarchy");
}

#[test]
fn test_build_sheet_drawing_data_empty() {
    let result = build_sheet_drawing_data(&[]);
    assert!(result.anchors.is_empty());
    assert!(result.image_blobs.is_empty());
}

#[test]
fn test_build_sheet_drawing_data_mixed() {
    let shape = shape_with_ooxml(make_common("Rect"), ShapeOoxmlProps::default());
    let conn = FloatingObject {
        common: make_common("Line"),
        data: FloatingObjectData::Connector(ConnectorData {
            shape_type: "line".to_string(),
            fill: None,
            outline: None,
            start_connection: None,
            end_connection: None,
            adjustments: None,
            ooxml: None,
        }),
    };
    let result = build_sheet_drawing_data(&[shape, conn]);
    assert_eq!(result.anchors.len(), 2);
}

#[test]
fn imported_ooxml_picture_emits_modeled_media_blob() {
    let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
    picture.blip_fill.embed_id = Some("rId5".to_string());
    let obj = picture_with_ooxml(
        make_common("Imported Picture"),
        PictureOoxmlProps {
            picture,
            image_path: Some("../media/image7.png".to_string()),
            relationships: vec![ooxml_types::shared::OpcRelationship {
                id: "rId5".to_string(),
                rel_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                        .to_string(),
                target: "../media/image7.png".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);

    assert_eq!(
        result.image_rels,
        vec![("rId5".to_string(), "../media/image7.png".to_string())]
    );
    assert_eq!(
        result.image_blobs,
        vec![("../media/image7.png".to_string(), vec![1, 2, 3, 4])]
    );
}

#[test]
fn imported_ooxml_pictures_reuse_shared_image_relationship() {
    let rel = ooxml_types::shared::OpcRelationship {
        id: "rId2".to_string(),
        rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
            .to_string(),
        target: "../media/image7.png".to_string(),
        target_mode: None,
    };

    let mut picture_a = ooxml_types::drawings::SpreadsheetPicture::default();
    picture_a.blip_fill.embed_id = Some("rId2".to_string());
    let mut picture_b = ooxml_types::drawings::SpreadsheetPicture::default();
    picture_b.blip_fill.embed_id = Some("rId2".to_string());

    let first = picture_with_ooxml(
        make_common("Picture 1"),
        PictureOoxmlProps {
            picture: picture_a,
            image_path: Some("../media/image7.png".to_string()),
            relationships: vec![rel.clone()],
            ..Default::default()
        },
    );
    let second = picture_with_ooxml(
        make_common("Picture 2"),
        PictureOoxmlProps {
            picture: picture_b,
            image_path: Some("../media/image7.png".to_string()),
            relationships: vec![rel],
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[first, second]);

    assert_eq!(
        result.image_rels,
        vec![("rId2".to_string(), "../media/image7.png".to_string())]
    );
    assert!(result.drawing_rels.is_empty());
    for (_, anchor) in result.anchors {
        let DrawingAnchor::TwoCell(_, DrawingObject::Picture(image)) = anchor else {
            panic!("expected picture anchor");
        };
        assert_eq!(image.r_id, "rId2");
    }
}

#[test]
fn imported_shape_hyperlink_url_emits_drawing_relationship() {
    let mut shape = ooxml_types::drawings::SpreadsheetShape::default();
    shape.nv_sp_pr.c_nv_pr.hlink_click = Some(ooxml_types::drawings::Hyperlink {
        url: Some("#Nav_Description".to_string()),
        r_id: Some("rId7".to_string()),
        tooltip: Some("Description".to_string()),
        ..Default::default()
    });
    let obj = shape_with_ooxml(
        make_common("Linked Rectangle"),
        ShapeOoxmlProps {
            shape,
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);

    assert_eq!(result.drawing_rels.len(), 1);
    assert_eq!(result.drawing_rels[0].id, "rId7");
    assert_eq!(result.drawing_rels[0].rel_type, REL_HYPERLINK);
    assert_eq!(result.drawing_rels[0].target, "#Nav_Description");
    assert_eq!(result.drawing_rels[0].target_mode, None);

    let DrawingAnchor::TwoCell(_, DrawingObject::TextBox(text_box)) = &result.anchors[0].1 else {
        panic!("expected textbox anchor");
    };
    assert_eq!(
        text_box.hlink_click.as_ref().unwrap().r_id.as_deref(),
        Some("rId7")
    );
}

#[test]
fn api_picture_uses_relationship_id_registered_for_media_blob() {
    let obj = FloatingObject {
        common: make_common("API Picture"),
        data: FloatingObjectData::Picture(PictureData {
            src: "data:image/png;base64,AQIDBA==".to_string(),
            original_width: None,
            original_height: None,
            crop: None,
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: None,
        }),
    };

    let result = build_sheet_drawing_data(&[obj]);
    let (_, anchor) = result.anchors.first().expect("picture anchor should emit");
    let DrawingAnchor::TwoCell(_, DrawingObject::Picture(image)) = anchor else {
        panic!("expected picture anchor");
    };

    assert_eq!(image.r_id, "rId1");
    assert_eq!(
        result.image_rels,
        vec![("rId1".to_string(), "../media/image1.png".to_string())]
    );
    assert_eq!(
        result.image_blobs,
        vec![("../media/image1.png".to_string(), vec![1, 2, 3, 4])]
    );
}

#[test]
fn test_base64_decode() {
    let result = base64_decode("SGVsbG8=").unwrap();
    assert_eq!(result, b"Hello");
}

#[test]
fn test_ole_object_skipped() {
    let obj = FloatingObject {
        common: make_common("OLE"),
        data: FloatingObjectData::OleObject(OleObjectData {
            prog_id: "test".to_string(),
            dv_aspect: "DVASPECT_CONTENT".to_string(),
            is_linked: false,
            is_embedded: true,
            preview_image_src: None,
            alt_text: None,
            ooxml: None,
        }),
    };
    let result = build_sheet_drawing_data(&[obj]);
    assert!(result.anchors.is_empty());
}

#[test]
fn test_parse_shape_preset_known() {
    assert_eq!(parse_shape_preset("ellipse"), ShapePreset::Ellipse);
    assert_eq!(parse_shape_preset("heart"), ShapePreset::Heart);
}

#[test]
fn test_parse_shape_preset_unknown_fallback() {
    assert_eq!(parse_shape_preset("weirdShape"), ShapePreset::Rect);
}

#[test]
fn preserved_client_data_flows_to_two_cell_picture_anchor() {
    let obj = picture_with_ooxml(
        make_common("Picture"),
        PictureOoxmlProps {
            client_data_locks_with_sheet: Some(false),
            client_data_prints_with_sheet: Some(false),
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);
    let (_, DrawingAnchor::TwoCell(anchor, _)) =
        result.anchors.first().expect("picture anchor should emit")
    else {
        panic!("expected two-cell anchor");
    };
    assert!(!anchor.client_data.locks_with_sheet);
    assert!(!anchor.client_data.prints_with_sheet);
}

#[test]
fn preserved_client_data_flows_to_one_cell_shape_anchor() {
    let mut common = make_common("Shape");
    common.anchor.anchor_mode = AnchorMode::OneCell;
    common.anchor.end_row = None;
    common.anchor.end_col = None;
    common.anchor.end_row_offset = None;
    common.anchor.end_col_offset = None;
    let obj = shape_with_ooxml(
        common,
        ShapeOoxmlProps {
            client_data_locks_with_sheet: Some(false),
            client_data_prints_with_sheet: Some(false),
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);
    let (_, DrawingAnchor::OneCell(anchor, _)) =
        result.anchors.first().expect("shape anchor should emit")
    else {
        panic!("expected one-cell anchor");
    };
    assert!(!anchor.client_data.locks_with_sheet);
    assert!(!anchor.client_data.prints_with_sheet);
}

#[test]
fn absolute_anchor_keeps_default_client_data_when_ooxml_flags_exist() {
    let mut common = make_common("Picture");
    common.anchor.anchor_mode = AnchorMode::Absolute;
    common.anchor.absolute_x = Some(100);
    common.anchor.absolute_y = Some(200);
    let obj = picture_with_ooxml(
        common,
        PictureOoxmlProps {
            client_data_locks_with_sheet: Some(false),
            client_data_prints_with_sheet: Some(false),
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);
    let (_, DrawingAnchor::Absolute(anchor, _)) =
        result.anchors.first().expect("picture anchor should emit")
    else {
        panic!("expected absolute anchor");
    };
    assert!(anchor.client_data.locks_with_sheet);
    assert!(anchor.client_data.prints_with_sheet);
}

#[test]
fn ooxml_extent_wins_over_pixel_size_for_one_cell_anchor() {
    let mut common = make_common("Picture");
    common.width = 10.0;
    common.height = 10.0;
    common.anchor.anchor_mode = AnchorMode::OneCell;
    common.anchor.end_row = None;
    common.anchor.end_col = None;
    let obj = picture_with_ooxml(
        common,
        PictureOoxmlProps {
            extent_emu_cx: Some(123),
            extent_emu_cy: Some(456),
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);
    let (_, DrawingAnchor::OneCell(anchor, _)) =
        result.anchors.first().expect("picture anchor should emit")
    else {
        panic!("expected one-cell anchor");
    };
    assert_eq!(anchor.extent.cx, 123);
    assert_eq!(anchor.extent.cy, 456);
}

#[test]
fn partial_ooxml_extents_fall_back_to_anchor_extents() {
    let mut common = make_common("Picture");
    common.width = 10.0;
    common.height = 10.0;
    common.anchor.anchor_mode = AnchorMode::OneCell;
    common.anchor.end_row = None;
    common.anchor.end_col = None;
    common.anchor.extent_cx = Some(700);
    common.anchor.extent_cy = Some(800);
    let obj = picture_with_ooxml(
        common,
        PictureOoxmlProps {
            extent_emu_cx: Some(123),
            extent_emu_cy: None,
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[obj]);
    let (_, DrawingAnchor::OneCell(anchor, _)) =
        result.anchors.first().expect("picture anchor should emit")
    else {
        panic!("expected one-cell anchor");
    };
    assert_eq!(anchor.extent.cx, 700);
    assert_eq!(anchor.extent.cy, 800);
}

#[test]
fn alternate_content_restored_only_on_two_cell_anchor() {
    let two_cell = shape_with_ooxml(
        make_common("TwoCell"),
        ShapeOoxmlProps {
            mc_alternate_content_raw_xml: Some("<mc:AlternateContent/>".to_string()),
            ..Default::default()
        },
    );

    let mut one_cell_common = make_common("OneCell");
    one_cell_common.anchor.anchor_mode = AnchorMode::OneCell;
    one_cell_common.anchor.end_row = None;
    one_cell_common.anchor.end_col = None;
    let one_cell = shape_with_ooxml(
        one_cell_common,
        ShapeOoxmlProps {
            mc_alternate_content_raw_xml: Some("<mc:AlternateContent/>".to_string()),
            ..Default::default()
        },
    );

    let result = build_sheet_drawing_data(&[two_cell, one_cell]);
    let (_, DrawingAnchor::TwoCell(two_cell_anchor, _)) = &result.anchors[0] else {
        panic!("expected two-cell anchor");
    };
    let (_, DrawingAnchor::OneCell(one_cell_anchor, _)) = &result.anchors[1] else {
        panic!("expected one-cell anchor");
    };
    assert!(two_cell_anchor.mc_alternate_content.is_some());
    assert!(one_cell_anchor.mc_alternate_content.is_none());
}

#[test]
fn next_available_image_r_id_skips_occupied_ids() {
    let rels = vec![
        ("rId1".to_string(), "../media/image1.png".to_string()),
        ("rId3".to_string(), "../media/image3.png".to_string()),
        ("rId2".to_string(), "../media/image2.png".to_string()),
    ];

    assert_eq!(next_available_image_r_id(&rels), "rId4");
}

#[test]
fn imported_picture_data_url_does_not_duplicate_existing_blob_target() {
    let mut blobs = vec![("../media/image1.png".to_string(), vec![9])];

    push_image_blob_if_data_url(
        &mut blobs,
        "../media/image1.png",
        "data:image/png;base64,AQIDBA==",
    );

    assert_eq!(blobs, vec![("../media/image1.png".to_string(), vec![9])]);
}

#[test]
fn data_url_with_whitespace_in_base64_payload_decodes() {
    let parsed = parse_data_url("data:image/png;base64,AQID\n BA==")
        .expect("whitespace base64 should decode");

    assert_eq!(parsed, ("png".to_string(), vec![1, 2, 3, 4]));
}

#[test]
fn connector_anchor_index_is_carried_without_anchor_level_ooxml_restoration() {
    let conn = FloatingObject {
        common: make_common("Line"),
        data: FloatingObjectData::Connector(ConnectorData {
            shape_type: "line".to_string(),
            fill: None,
            outline: None,
            start_connection: None,
            end_connection: None,
            adjustments: None,
            ooxml: Some(ConnectorOoxmlProps {
                anchor_index: Some(4),
                edit_as: Some("absolute".to_string()),
                client_data_locks_with_sheet: Some(false),
                client_data_prints_with_sheet: Some(false),
                ..Default::default()
            }),
        }),
    };

    let result = build_sheet_drawing_data(&[conn]);
    let (anchor_index, DrawingAnchor::TwoCell(anchor, _)) = result
        .anchors
        .first()
        .expect("connector anchor should emit")
    else {
        panic!("expected two-cell connector anchor");
    };
    assert_eq!(*anchor_index, Some(4));
    assert!(anchor.edit_as.is_none());
    assert!(anchor.client_data.locks_with_sheet);
    assert!(anchor.client_data.prints_with_sheet);
}

#[test]
fn unknown_mime_type_defaults_to_png_extension() {
    let parsed = parse_data_url("data:application/octet-stream;base64,AQIDBA==")
        .expect("unknown mime should still decode");

    assert_eq!(parsed, ("png".to_string(), vec![1, 2, 3, 4]));
}
