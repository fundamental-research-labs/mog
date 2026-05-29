use super::outcome::ConversionStatus;
use super::*;
use crate::domain::drawings::{
    Connection as ReadConnection, ConnectorNonVisual, DrawingColor, Fill, NonVisualProps,
    OpaqueDrawingContent, Outline, PresetGeometry, ShapeGeometry, ShapeProperties, ShapeStyle,
    SolidFill, SpreadsheetConnector, StyleRef as ReadStyleRef, Transform2D as ReadXf,
};
use ooxml_types::drawings as ooxml;
use ooxml_types::drawings::{
    DashStyle, DrawingLocking, FontCollectionIndex, FontReference, Hyperlink, LineCap, LineDash,
    LineEndProperties, LineEndSize, LineEndType, LineFill, LineJoin, ShapePreset,
};
use ooxml_types::drawings::{
    StAngle, StDrawingElementId, StPositiveFixedPercentageDecimal, StStyleMatrixColumnIndex,
};

/// Helper: build a fully-populated read-side `SpreadsheetConnector` for testing.
fn full_connector() -> SpreadsheetConnector {
    SpreadsheetConnector {
        nv_cxn_sp_pr: ConnectorNonVisual {
            c_nv_pr: NonVisualProps {
                id: StDrawingElementId::new(5),
                name: "My Connector".into(),
                descr: Some("A test connector".into()),
                hidden: true,
                title: Some("Title".into()),
                hlink_click: Some(Hyperlink {
                    r_id: Some("rId1".into()),
                    tooltip: Some("Click me".into()),
                    ..Default::default()
                }),
                hlink_hover: Some(Hyperlink {
                    r_id: Some("rId2".into()),
                    ..Default::default()
                }),
                ext_lst: None,
            },
            c_nv_cxn_sp_pr: DrawingLocking {
                no_grp: true,
                no_select: false,
                no_rot: true,
                no_change_aspect: false,
                no_move: true,
                no_resize: false,
                no_edit_points: true,
                no_adjust_handles: false,
                no_change_arrowheads: true,
                no_change_shape_type: false,
                ..Default::default()
            },
            st_cxn: Some(ReadConnection {
                shape_id: 10,
                idx: 0,
            }),
            end_cxn: Some(ReadConnection {
                shape_id: 20,
                idx: 3,
            }),
            c_nv_cxn_sp_pr_ext_lst: None,
        },
        sp_pr: ShapeProperties {
            xfrm: Some(ReadXf {
                offset: Some((100, 200)),
                extent: Some((300, 400)),
                rotation: Some(StAngle::new(5400000)),
                flip_h: Some(true),
                flip_v: Some(false),
            }),
            fill: Some(Fill::Solid(SolidFill {
                color: DrawingColor::SrgbClr {
                    val: "FF0000".into(),
                    transforms: vec![],
                },
            })),
            ln: Some(Outline {
                width: Some(12700),
                fill: Some(LineFill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: "00FF00".into(),
                        transforms: vec![],
                    },
                })),
                dash: Some(LineDash::Preset(DashStyle::Dash)),
                compound: None,
                cap: Some(LineCap::Round),
                head_end: Some(LineEndProperties {
                    end_type: Some(LineEndType::Triangle),
                    width: Some(LineEndSize::Medium),
                    length: Some(LineEndSize::Medium),
                }),
                tail_end: Some(LineEndProperties {
                    end_type: Some(LineEndType::Arrow),
                    width: Some(LineEndSize::Large),
                    length: Some(LineEndSize::Small),
                }),
                join: Some(LineJoin::Round),
                align: None,
            }),
            geometry: Some(ShapeGeometry::Preset(PresetGeometry {
                prst: ShapePreset::StraightConnector1,
                av_list: vec![],
            })),
            ..Default::default()
        },
        style: Some(ShapeStyle {
            line_ref: ReadStyleRef {
                idx: StStyleMatrixColumnIndex::new(1),
                color: Some(DrawingColor::SrgbClr {
                    val: "AABBCC".into(),
                    transforms: vec![],
                }),
            },
            fill_ref: ReadStyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            effect_ref: ReadStyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            font_ref: FontReference {
                idx: FontCollectionIndex::Minor,
                color: Some(DrawingColor::SchemeClr {
                    val: ooxml::SchemeColor::Lt1,
                    transforms: vec![],
                }),
            },
        }),
        macro_name: Some("MyMacro".into()),
        f_published: None,
    }
}

/// Helper: build a minimal read-side `SpreadsheetConnector` (defaults only).
fn minimal_connector() -> SpreadsheetConnector {
    SpreadsheetConnector::default()
}

#[test]
fn test_full_conversion() {
    let c = full_connector();
    let props = connector_to_props(&c);

    assert_eq!(props.name, "My Connector");
    assert_eq!(props.description.as_deref(), Some("A test connector"));
    assert_eq!(props.title.as_deref(), Some("Title"));
    assert!(props.hidden);
    assert!(props.hlink_click.is_some());
    assert_eq!(
        props.hlink_click.as_ref().unwrap().r_id.as_deref(),
        Some("rId1")
    );
    assert_eq!(
        props.hlink_click.as_ref().unwrap().tooltip.as_deref(),
        Some("Click me")
    );
    assert!(props.hlink_hover.is_some());

    let start = props.start_connection.as_ref().unwrap();
    assert_eq!(start.shape_id, 10);
    assert_eq!(start.idx, 0);
    let end = props.end_connection.as_ref().unwrap();
    assert_eq!(end.shape_id, 20);
    assert_eq!(end.idx, 3);

    assert!(props.locks.no_grp);
    assert!(!props.locks.no_select);
    assert!(props.locks.no_rot);
    assert!(props.locks.no_move);
    assert!(props.locks.no_edit_points);
    assert!(props.locks.no_change_arrowheads);

    assert_eq!(props.transform.off_x(), 100);
    assert_eq!(props.transform.off_y(), 200);
    assert_eq!(props.transform.ext_cx(), 300);
    assert_eq!(props.transform.ext_cy(), 400);
    assert_eq!(props.transform.rot(), StAngle::new(5400000));
    assert!(props.transform.is_flip_h());
    assert!(!props.transform.is_flip_v());

    assert_eq!(
        props.preset_geometry.as_ref().map(|pg| pg.prst),
        Some(ShapePreset::StraightConnector1)
    );

    match props.fill.as_ref().unwrap() {
        write::DrawingFill::Solid(sf) => match &sf.color {
            write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid fill, got {:?}", other),
    }

    let outline = props.outline.as_ref().unwrap();
    assert_eq!(outline.width, Some(12700));
    match outline.fill.as_ref().unwrap() {
        LineFill::Solid(sf) => match &sf.color {
            write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val.as_str(), "00FF00"),
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid line fill, got {:?}", other),
    }
    assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::Dash)));
    assert_eq!(outline.cap, Some(LineCap::Round));
    assert!(outline.head_end.is_some());
    assert!(outline.tail_end.is_some());
    assert_eq!(outline.join, Some(LineJoin::Round));

    let style = props.style.as_ref().unwrap();
    assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(1));
    match style.line_ref.color.as_ref().unwrap() {
        write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "AABBCC"),
        other => panic!("expected SrgbClr, got {:?}", other),
    }
    assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(0));
    assert!(style.fill_ref.color.is_none());
    assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(0));
    assert!(style.effect_ref.color.is_none());
    assert!(style.font_ref.color.is_some());
    match style.font_ref.color.as_ref().unwrap() {
        write::DrawingColor::SchemeClr { val, .. } => assert_eq!(*val, ooxml::SchemeColor::Lt1),
        other => panic!("expected SchemeClr, got {:?}", other),
    }

    assert_eq!(props.macro_name.as_deref(), Some("MyMacro"));
}

#[test]
fn test_minimal_conversion() {
    let c = minimal_connector();
    let props = connector_to_props(&c);

    assert_eq!(props.name, "");
    assert!(props.description.is_none());
    assert!(props.title.is_none());
    assert!(!props.hidden);
    assert!(props.hlink_click.is_none());
    assert!(props.hlink_hover.is_none());

    assert!(props.start_connection.is_none());
    assert!(props.end_connection.is_none());

    assert!(!props.locks.no_grp);

    assert_eq!(props.transform.off_x(), 0);
    assert_eq!(props.transform.ext_cx(), 0);
    assert_eq!(props.transform.rot(), StAngle::new(0));
    assert!(!props.transform.is_flip_h());

    assert!(props.fill.is_none());
    assert!(props.outline.is_none());
    assert!(props.preset_geometry.is_none());
    assert!(props.style.is_none());
    assert!(props.macro_name.is_none());
}

#[test]
fn test_gradient_fill_preserved() {
    let mut c = minimal_connector();
    c.sp_pr.fill = Some(Fill::Gradient(crate::domain::drawings::GradientFill {
        stops: vec![],
        lin_ang: Some(StAngle::new(5_400_000)),
        ..Default::default()
    }));
    let props = connector_to_props(&c);
    match props.fill.as_ref().unwrap() {
        write::DrawingFill::Gradient(gf) => {
            assert!(gf.stops.is_empty());
            assert_eq!(gf.lin_ang, Some(StAngle::new(5_400_000)));
        }
        other => panic!("expected Gradient fill, got {:?}", other),
    }
}

#[test]
fn test_no_fill_roundtrip() {
    let mut c = minimal_connector();
    c.sp_pr.fill = Some(Fill::NoFill);
    let props = connector_to_props(&c);
    match props.fill.as_ref().unwrap() {
        write::DrawingFill::NoFill => {}
        other => panic!("expected NoFill, got {:?}", other),
    }
}

use crate::domain::drawings::{
    BlipFill as ReadBlipFill, GradientFill as ReadGradientFill, GradientStop as ReadGradientStop,
    PictureNonVisual, SpreadsheetPicture,
};
use ooxml_types::drawings::{BlackWhiteMode, BlipEffect, CompressionState, FillMode, SourceRect};

/// Helper: build a fully-populated read-side `SpreadsheetPicture` for testing.
fn full_picture() -> SpreadsheetPicture {
    SpreadsheetPicture {
        nv_pic_pr: PictureNonVisual {
            c_nv_pr: NonVisualProps {
                id: StDrawingElementId::new(10),
                name: "My Image".into(),
                descr: Some("NV description".into()),
                hidden: true,
                title: Some("Image Title".into()),
                hlink_click: Some(Hyperlink {
                    r_id: Some("rId10".into()),
                    tooltip: Some("Click image".into()),
                    ..Default::default()
                }),
                hlink_hover: Some(Hyperlink {
                    r_id: Some("rId11".into()),
                    ..Default::default()
                }),
                ext_lst: None,
            },
            locks: DrawingLocking {
                no_change_aspect: true,
                no_grp: true,
                no_select: false,
                no_rot: false,
                no_move: false,
                no_resize: false,
                no_crop: true,
                no_text_edit: false,
                no_edit_points: false,
                no_adjust_handles: false,
                no_change_arrowheads: false,
                no_change_shape_type: false,
                ext_lst: None,
            },
            prefer_relative_resize: Some(false),
            c_nv_pic_pr_ext_lst: None,
            has_pic_locks: true,
        },
        blip_fill: ReadBlipFill {
            embed_id: Some("rId5".into()),
            link_id: Some("rId6".into()),
            compression: Some(CompressionState::Print),
            source_rect: Some(SourceRect {
                top: StPositiveFixedPercentageDecimal::new_unchecked(10000),
                bottom: StPositiveFixedPercentageDecimal::new_unchecked(20000),
                left: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                right: StPositiveFixedPercentageDecimal::new_unchecked(5000),
            }),
            effects: vec![BlipEffect::Grayscale],
            fill_mode: Some(FillMode::Stretch { fill_rect: None }),
            dpi: Some(300),
            rot_with_shape: Some(true),
            ext_lst: None,
            src_rect_explicit: 0xF,
        },
        sp_pr: ShapeProperties {
            xfrm: Some(ReadXf {
                offset: Some((1000, 2000)),
                extent: Some((5000000, 3000000)),
                rotation: Some(StAngle::new(5400000)),
                flip_h: Some(false),
                flip_v: Some(true),
            }),
            fill: Some(Fill::Solid(SolidFill {
                color: DrawingColor::SrgbClr {
                    val: "0000FF".into(),
                    transforms: vec![],
                },
            })),
            ln: Some(Outline {
                width: Some(25400),
                fill: Some(LineFill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: "FF00FF".into(),
                        transforms: vec![
                            ooxml::ColorTransform::LumMod { val: 75000 },
                            ooxml::ColorTransform::LumOff { val: 25000 },
                            ooxml::ColorTransform::Tint { val: 50000 },
                        ],
                    },
                })),
                dash: Some(LineDash::Preset(DashStyle::DashDot)),
                compound: None,
                cap: Some(LineCap::Flat),
                head_end: None,
                tail_end: None,
                join: Some(LineJoin::Miter { limit: None }),
                align: None,
            }),
            geometry: Some(ShapeGeometry::Preset(PresetGeometry {
                prst: ShapePreset::Rect,
                av_list: vec![],
            })),
            effects: None,
            bw_mode: Some(BlackWhiteMode::Auto),
            scene3d: None,
            sp3d: None,
            ext_lst: None,
        },
        style: Some(ShapeStyle {
            line_ref: ReadStyleRef {
                idx: StStyleMatrixColumnIndex::new(2),
                color: Some(DrawingColor::SrgbClr {
                    val: "112233".into(),
                    transforms: vec![],
                }),
            },
            fill_ref: ReadStyleRef {
                idx: StStyleMatrixColumnIndex::new(1),
                color: None,
            },
            effect_ref: ReadStyleRef::default(),
            font_ref: FontReference::default(),
        }),
        macro_name: Some("PicMacro".into()),
        f_published: None,
    }
}

#[test]
fn test_full_picture_conversion() {
    let p = full_picture();
    let props = picture_to_image_props(&p);

    assert_eq!(props.name, "My Image");
    assert_eq!(props.description.as_deref(), Some("NV description"));
    assert_eq!(props.r_id, "rId5");

    assert_eq!(props.rotation, Some(5400000));
    assert_eq!(props.offset_x, 1000);
    assert_eq!(props.offset_y, 2000);
    assert_eq!(props.extent_cx, 5000000);
    assert_eq!(props.extent_cy, 3000000);
    assert!(!props.flip_h);
    assert!(props.flip_v);

    assert!(props.source_rect.is_some());
    let sr = props.source_rect.as_ref().unwrap();
    assert_eq!(
        sr.top,
        StPositiveFixedPercentageDecimal::new_unchecked(10000)
    );
    assert_eq!(
        sr.bottom,
        StPositiveFixedPercentageDecimal::new_unchecked(20000)
    );
    assert_eq!(props.blip_effects.len(), 1);
    assert!(matches!(props.blip_effects[0], BlipEffect::Grayscale));
    assert!(props.fill_mode.is_some());
    assert_eq!(props.compression, Some(CompressionState::Print));
    assert_eq!(props.link_id.as_deref(), Some("rId6"));
    assert_eq!(props.dpi, Some(300));
    assert_eq!(props.rot_with_shape, Some(true));

    assert!(props.locks.no_change_aspect);
    assert!(props.locks.no_grp);
    assert!(props.locks.no_crop);
    assert!(!props.locks.no_select);
    assert_eq!(props.prefer_relative_resize, Some(false));

    assert_eq!(props.title.as_deref(), Some("Image Title"));
    assert!(props.hidden);
    assert!(props.hlink_click.is_some());
    assert_eq!(
        props.hlink_click.as_ref().unwrap().tooltip.as_deref(),
        Some("Click image")
    );
    assert!(props.hlink_hover.is_some());

    assert_eq!(
        props.preset_geometry.as_ref().map(|pg| pg.prst),
        Some(ShapePreset::Rect)
    );
    assert!(props.fill.is_some());
    match props.fill.as_ref().unwrap() {
        write::DrawingFill::Solid(sf) => match &sf.color {
            write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "0000FF"),
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid ooxml fill, got {:?}", other),
    }
    let outline = props.outline.as_ref().unwrap();
    assert_eq!(outline.width, Some(25400));
    match outline.fill.as_ref().unwrap() {
        LineFill::Solid(sf) => match &sf.color {
            write::DrawingColor::SrgbClr { val, transforms } => {
                assert_eq!(val, "FF00FF");
                assert_eq!(transforms.len(), 3);
            }
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid line fill, got {:?}", other),
    }
    assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::DashDot)));
    assert_eq!(outline.join, Some(LineJoin::Miter { limit: None }));
    assert_eq!(props.bw_mode, Some(BlackWhiteMode::Auto));

    let style = props.style.as_ref().unwrap();
    assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(2));
    match style.line_ref.color.as_ref().unwrap() {
        write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "112233"),
        other => panic!("expected SrgbClr, got {:?}", other),
    }
    assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(1));
    assert!(style.fill_ref.color.is_none());
    assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(0));
    assert!(style.effect_ref.color.is_none());

    assert_eq!(props.macro_name.as_deref(), Some("PicMacro"));
}

#[test]
fn test_minimal_picture_conversion() {
    let p = SpreadsheetPicture::default();
    let props = picture_to_image_props(&p);

    assert_eq!(props.name, "");
    assert!(props.description.is_none());
    assert_eq!(props.r_id, "");

    assert!(props.rotation.is_none());
    assert_eq!(props.offset_x, 0);
    assert_eq!(props.offset_y, 0);
    assert_eq!(props.extent_cx, 0);
    assert_eq!(props.extent_cy, 0);
    assert!(!props.flip_h);
    assert!(!props.flip_v);

    assert!(props.source_rect.is_none());
    assert!(props.blip_effects.is_empty());
    assert!(props.fill_mode.is_none());
    assert!(props.compression.is_none());
    assert!(props.link_id.is_none());
    assert!(props.dpi.is_none());
    assert!(props.rot_with_shape.is_none());

    assert!(!props.locks.no_change_aspect);
    assert!(props.prefer_relative_resize.is_none());

    assert!(props.title.is_none());
    assert!(!props.hidden);
    assert!(props.hlink_click.is_none());
    assert!(props.hlink_hover.is_none());

    assert!(props.preset_geometry.is_none());
    assert!(props.fill.is_none());
    assert!(props.outline.is_none());
    assert!(props.effects.is_none());
    assert!(props.bw_mode.is_none());

    assert!(props.style.is_none());
    assert!(props.macro_name.is_none());
}

#[test]
fn test_picture_with_effects() {
    let mut p = SpreadsheetPicture::default();
    p.blip_fill.embed_id = Some("rId1".into());
    p.blip_fill.effects = vec![
        BlipEffect::Grayscale,
        BlipEffect::AlphaModFix { amt: 50000 },
        BlipEffect::Luminance {
            bright: 20000,
            contrast: -10000,
        },
    ];

    let props = picture_to_image_props(&p);

    assert_eq!(props.blip_effects.len(), 3);
    assert!(matches!(props.blip_effects[0], BlipEffect::Grayscale));
    assert!(matches!(
        props.blip_effects[1],
        BlipEffect::AlphaModFix { amt: 50000 }
    ));
    match &props.blip_effects[2] {
        BlipEffect::Luminance { bright, contrast } => {
            assert_eq!(*bright, 20000);
            assert_eq!(*contrast, -10000);
        }
        other => panic!("expected Luminance effect, got {:?}", other),
    }
}

#[test]
fn test_picture_gradient_fill_preserved() {
    let mut p = SpreadsheetPicture::default();
    p.sp_pr.fill = Some(Fill::Gradient(ReadGradientFill {
        stops: vec![
            ReadGradientStop {
                position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                color: DrawingColor::SrgbClr {
                    val: "FF0000".into(),
                    transforms: vec![],
                },
            },
            ReadGradientStop {
                position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                color: DrawingColor::SrgbClr {
                    val: "0000FF".into(),
                    transforms: vec![],
                },
            },
        ],
        lin_ang: Some(StAngle::new(2_700_000)),
        ..Default::default()
    }));

    let props = picture_to_image_props(&p);
    match props.fill.as_ref().unwrap() {
        write::DrawingFill::Gradient(gf) => {
            assert_eq!(gf.stops.len(), 2);
            assert_eq!(
                gf.stops[0].position,
                StPositiveFixedPercentageDecimal::new_unchecked(0)
            );
            match &gf.stops[0].color {
                write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                other => panic!("expected SrgbClr, got {:?}", other),
            }
            assert_eq!(
                gf.stops[1].position,
                StPositiveFixedPercentageDecimal::new_unchecked(100000)
            );
            match &gf.stops[1].color {
                write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "0000FF"),
                other => panic!("expected SrgbClr, got {:?}", other),
            }
            assert_eq!(gf.lin_ang, Some(StAngle::new(2_700_000)));
        }
        other => panic!("expected Gradient ooxml fill, got {:?}", other),
    }
}

#[test]
fn test_picture_name_fallback() {
    let mut p = SpreadsheetPicture::default();
    p.nv_pic_pr.c_nv_pr.name = "My Name".into();
    let props = picture_to_image_props(&p);
    assert_eq!(props.name, "My Name");

    p.nv_pic_pr.c_nv_pr.name = String::new();
    let props2 = picture_to_image_props(&p);
    assert_eq!(props2.name, "");
}

#[test]
fn test_picture_description_fallback() {
    let mut p = SpreadsheetPicture::default();
    p.nv_pic_pr.c_nv_pr.descr = Some("NV desc".into());
    let props = picture_to_image_props(&p);
    assert_eq!(props.description.as_deref(), Some("NV desc"));

    p.nv_pic_pr.c_nv_pr.descr = None;
    let props2 = picture_to_image_props(&p);
    assert!(props2.description.is_none());
}

use crate::domain::drawings::{
    DrawingContent, GroupShape, GroupShapeNonVisual, GroupShapeProperties as ReadGrpProps,
    SpreadsheetGraphicFrame as ReadGF,
};
use ooxml_types::drawings::{GroupLocking, GroupTransform2D};

#[test]
fn test_full_group_shape_conversion() {
    let g = GroupShape {
        nv_grp_sp_pr: GroupShapeNonVisual {
            c_nv_pr: NonVisualProps {
                id: StDrawingElementId::new(1),
                name: "Group 1".into(),
                descr: Some("Test group".into()),
                hidden: false,
                title: Some("Title".into()),
                hlink_click: None,
                hlink_hover: None,
                ext_lst: None,
            },
            c_nv_grp_sp_pr: Some(GroupLocking {
                no_grp: true,
                no_ungrp: true,
                no_select: false,
                no_rot: false,
                no_change_aspect: true,
                no_move: false,
                no_resize: false,
                ext_lst: None,
            }),
            ..Default::default()
        },
        grp_sp_pr: ReadGrpProps {
            xfrm: Some(GroupTransform2D {
                offset: Some((100, 200)),
                extent: Some((5000, 3000)),
                child_offset: Some((0, 0)),
                child_extent: Some((5000, 3000)),
                rotation: Some(StAngle::new(5400000)),
                flip_h: Some(true),
                flip_v: None,
            }),
            fill: Some(Fill::Solid(SolidFill {
                color: DrawingColor::SrgbClr {
                    val: "FF0000".into(),
                    transforms: vec![],
                },
            })),
            effects: None,
            bw_mode: Some(BlackWhiteMode::Auto),
            scene3d: None,
            ext_lst: None,
        },
        children: vec![],
    };
    let props = group_shape_to_props(&g);
    assert_eq!(props.name, "Group 1");
    assert_eq!(props.description.as_deref(), Some("Test group"));
    assert_eq!(props.title.as_deref(), Some("Title"));
    assert!(!props.hidden);
    let locks = props.group_locking.as_ref().unwrap();
    assert!(locks.no_grp);
    assert!(locks.no_ungrp);
    assert!(locks.no_change_aspect);
    assert!(!locks.no_select);
    let xfrm = props.transform.as_ref().unwrap();
    assert_eq!(xfrm.offset, Some((100, 200)));
    assert_eq!(xfrm.extent, Some((5000, 3000)));
    assert_eq!(xfrm.child_offset, Some((0, 0)));
    assert_eq!(xfrm.rotation, Some(StAngle::new(5400000)));
    assert_eq!(xfrm.flip_h, Some(true));
    assert_eq!(xfrm.flip_v, None);
    assert!(props.fill.is_some());
    assert_eq!(props.bw_mode, Some(BlackWhiteMode::Auto));
    assert!(props.children.is_empty());
}

#[test]
fn test_minimal_group_shape_conversion() {
    let g = GroupShape::default();
    let props = group_shape_to_props(&g);
    assert_eq!(props.name, "");
    assert!(props.description.is_none());
    assert!(!props.hidden);
    assert!(props.group_locking.is_none());
    assert!(props.transform.is_none());
    assert!(props.fill.is_none());
    assert!(props.children.is_empty());
}

#[test]
fn test_group_shape_with_nested_children() {
    let inner_connector = SpreadsheetConnector {
        nv_cxn_sp_pr: ConnectorNonVisual {
            c_nv_pr: NonVisualProps {
                id: StDrawingElementId::new(3),
                name: "Inner Conn".into(),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    };
    let inner_picture = SpreadsheetPicture {
        nv_pic_pr: PictureNonVisual {
            c_nv_pr: NonVisualProps {
                id: StDrawingElementId::new(4),
                name: "Inner Pic".into(),
                ..Default::default()
            },
            ..Default::default()
        },
        blip_fill: ReadBlipFill {
            embed_id: Some("rId1".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    let graphic_frame = ReadGF {
        graphic_xml: Some("<xdr:graphicFrame>test</xdr:graphicFrame>".into()),
        ..Default::default()
    };

    let g = GroupShape {
        nv_grp_sp_pr: GroupShapeNonVisual {
            c_nv_pr: NonVisualProps {
                id: StDrawingElementId::new(2),
                name: "Group with children".into(),
                ..Default::default()
            },
            ..Default::default()
        },
        children: vec![
            DrawingContent::Connector(inner_connector),
            DrawingContent::Picture(inner_picture),
            DrawingContent::GraphicFrame(graphic_frame),
            DrawingContent::Unknown,
            DrawingContent::OpaqueUnknown(OpaqueDrawingContent {
                raw_xml: r#"<vendor:widget r:id="rIdWidget"/>"#.into(),
                relationship_ids: vec!["rIdWidget".into()],
                kind_hint: Some("widget".into()),
            }),
        ],
        ..Default::default()
    };
    let props = group_shape_to_props(&g);
    assert_eq!(props.name, "Group with children");
    assert_eq!(props.children.len(), 4);
    assert!(matches!(
        props.children[0],
        write::DrawingObject::Connector(_)
    ));
    assert!(matches!(
        props.children[1],
        write::DrawingObject::Picture(_)
    ));
    assert!(matches!(
        props.children[2],
        write::DrawingObject::GraphicFrame(_)
    ));
    assert!(matches!(
        props.children[3],
        write::DrawingObject::OpaqueRaw(_)
    ));
}

#[test]
fn test_convert_drawing_content_unknown_returns_none() {
    assert!(convert_drawing_content(&DrawingContent::Unknown).is_none());
}

#[test]
fn conversion_outcome_reports_unknown_as_unsupported() {
    let outcome = convert_drawing_content_with_outcome(&DrawingContent::Unknown);

    assert!(outcome.object.is_none());
    assert_eq!(
        outcome.status,
        ConversionStatus::Unsupported("unknown drawing content")
    );
    assert!(outcome.relationship_ids.is_empty());
}

#[test]
fn conversion_outcome_reports_opaque_unknown_as_passthrough() {
    let opaque = OpaqueDrawingContent {
        raw_xml: r#"<vendor:widget r:id="rIdWidget" r:embed="rIdData"/>"#.into(),
        relationship_ids: vec!["rIdWidget".into()],
        kind_hint: Some("widget".into()),
    };

    let outcome = convert_drawing_content_with_outcome(&DrawingContent::OpaqueUnknown(opaque));

    assert_eq!(outcome.status, ConversionStatus::OpaquePassthrough);
    assert_eq!(outcome.relationship_ids, ["rIdWidget", "rIdData"]);
    assert!(matches!(
        outcome.object,
        Some(write::DrawingObject::OpaqueRaw(_))
    ));
}

#[test]
fn conversion_outcome_reports_opaque_graphic_frame_relationships() {
    let frame = ReadGF {
        graphic_xml: Some(
            r#"<xdr:graphicFrame><a:graphic><a:graphicData><ext r:id="rId9" r:embed="rIdMedia" r:link="rIdExternal"/></a:graphicData></a:graphic></xdr:graphicFrame>"#
                .into(),
        ),
        ..Default::default()
    };

    let outcome = convert_drawing_content_with_outcome(&DrawingContent::GraphicFrame(frame));

    assert_eq!(outcome.status, ConversionStatus::OpaquePassthrough);
    assert_eq!(
        outcome.relationship_ids,
        ["rId9", "rIdMedia", "rIdExternal"]
    );
    assert!(matches!(
        outcome.object,
        Some(write::DrawingObject::GraphicFrame(_))
    ));
}

#[test]
fn conversion_outcome_reports_chart_graphic_frame_relationship() {
    let frame = ReadGF {
        graphic_xml: Some(
            r#"<xdr:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId7"/></a:graphicData></a:graphic></xdr:graphicFrame>"#
                .into(),
        ),
        ..Default::default()
    };

    let outcome = convert_drawing_content_with_outcome(&DrawingContent::GraphicFrame(frame));

    assert_eq!(outcome.status, ConversionStatus::Emitted);
    assert_eq!(outcome.relationship_ids, ["rId7"]);
    assert!(matches!(
        outcome.object,
        Some(write::DrawingObject::Chart(_))
    ));
}

#[test]
fn conversion_outcome_reports_smartart_relationships() {
    let smartart = read::SmartArtGraphicFrame {
        dm_rel_id: "rId1".into(),
        lo_rel_id: "rId2".into(),
        qs_rel_id: "rId3".into(),
        cs_rel_id: "rId4".into(),
    };

    let outcome = convert_drawing_content_with_outcome(&DrawingContent::SmartArt(smartart));

    assert_eq!(outcome.status, ConversionStatus::Emitted);
    assert_eq!(outcome.relationship_ids, ["rId1", "rId2", "rId3", "rId4"]);
    assert!(matches!(
        outcome.object,
        Some(write::DrawingObject::SmartArt(_))
    ));
}

#[test]
fn test_convert_drawing_content_shape_returns_text_box() {
    use crate::domain::drawings::SpreadsheetShape;
    let s = SpreadsheetShape::default();
    let result = convert_drawing_content(&DrawingContent::Shape(s));
    assert!(result.is_some());
    match result.unwrap() {
        write::DrawingObject::TextBox(_) => {}
        other => panic!("Expected TextBox, got {:?}", other),
    }
}
