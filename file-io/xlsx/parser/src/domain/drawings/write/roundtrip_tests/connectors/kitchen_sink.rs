use crate::domain::drawings::write::types::{
    Connection, ConnectorProps, DrawingColor, DrawingFill, Outline, PresetGeometry, SolidFill,
    StyleRef, Transform2D,
};
use ooxml_types::drawings::{
    CompoundLine, DashStyle, DrawingLocking, FontCollectionIndex, FontReference, Hyperlink,
    LineCap, LineDash, LineEndProperties, LineEndSize, LineEndType, LineFill, LineJoin,
    PenAlignment, ShapePreset, ShapeStyle, StAngle, StStyleMatrixColumnIndex,
};

use super::super::common::{rgb, solid_fill};
use super::common::{minimal_props, outline_color_rgb, roundtrip, style_ref_color_rgb};

#[test]
fn roundtrip_connectors_survive_save() {
    let mut props = minimal_props();
    props.name = "FlowArrow".into();
    props.start_connection = Some(Connection {
        shape_id: 3,
        idx: 1,
    });
    props.end_connection = Some(Connection {
        shape_id: 7,
        idx: 3,
    });
    props.outline = Some(Outline {
        width: Some(19050),
        fill: Some(LineFill::Solid(SolidFill {
            color: rgb("0070C0"),
        })),
        dash: Some(LineDash::Preset(DashStyle::Dash)),
        head_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Triangle),
            width: Some(LineEndSize::Medium),
            length: Some(LineEndSize::Medium),
        }),
        tail_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Arrow),
            width: Some(LineEndSize::Large),
            length: Some(LineEndSize::Large),
        }),
        join: Some(LineJoin::Round),
        ..Default::default()
    });
    props.preset_geometry = Some(PresetGeometry {
        prst: ShapePreset::BentConnector3,
        av_list: vec![],
    });

    let (orig, rt) = roundtrip(props);

    assert_eq!(rt.name, orig.name);

    let rt_st = rt.start_connection.as_ref().unwrap();
    assert_eq!(rt_st.shape_id, 3);
    assert_eq!(rt_st.idx, 1);
    let rt_en = rt.end_connection.as_ref().unwrap();
    assert_eq!(rt_en.shape_id, 7);
    assert_eq!(rt_en.idx, 3);

    let outline = rt.outline.as_ref().unwrap();
    assert_eq!(outline.width, Some(19050));
    assert_eq!(outline_color_rgb(outline), Some("0070C0"));
    assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::Dash)));

    let head = outline.head_end.as_ref().unwrap();
    assert_eq!(head.end_type, Some(LineEndType::Triangle));
    assert_eq!(head.width, Some(LineEndSize::Medium));
    assert_eq!(head.length, Some(LineEndSize::Medium));

    let tail = outline.tail_end.as_ref().unwrap();
    assert_eq!(tail.end_type, Some(LineEndType::Arrow));
    assert_eq!(tail.width, Some(LineEndSize::Large));
    assert_eq!(tail.length, Some(LineEndSize::Large));

    match &outline.join {
        Some(LineJoin::Round) => {}
        other => panic!("expected Round join, got {:?}", other),
    }

    assert_eq!(
        rt.preset_geometry.as_ref().map(|pg| pg.prst),
        Some(ShapePreset::BentConnector3)
    );
}

#[test]
fn roundtrip_kitchen_sink() {
    let props = ConnectorProps {
        original_id: None,
        name: "KitchenSinkConnector".into(),
        description: Some("Full description".into()),
        title: Some("Connector Title".into()),
        hidden: true,
        hlink_click: Some(Hyperlink {
            r_id: Some("rId1".into()),
            tooltip: Some("Click here".into()),
            action: Some("ppaction://hlinksldjump".into()),
            ..Default::default()
        }),
        hlink_hover: Some(Hyperlink {
            r_id: Some("rId2".into()),
            tooltip: Some("Hover text".into()),
            action: None,
            ..Default::default()
        }),
        start_connection: Some(Connection {
            shape_id: 10,
            idx: 0,
        }),
        end_connection: Some(Connection {
            shape_id: 20,
            idx: 4,
        }),
        locks: DrawingLocking {
            no_grp: true,
            no_select: false,
            no_rot: true,
            no_change_aspect: false,
            no_move: true,
            no_resize: true,
            no_edit_points: false,
            no_adjust_handles: true,
            no_change_arrowheads: true,
            no_change_shape_type: false,
            ..Default::default()
        },
        transform: Transform2D {
            offset: Some((1000000, 2000000)),
            extent: Some((3000000, 500000)),
            rotation: Some(StAngle::new(5400000)),
            flip_h: Some(true),
            flip_v: Some(false),
        },
        preset_geometry: Some(PresetGeometry {
            prst: ShapePreset::CurvedConnector3,
            av_list: vec![],
        }),
        fill: Some(solid_fill("00FF00")),
        outline: Some(Outline {
            width: Some(38100),
            fill: Some(LineFill::Solid(SolidFill {
                color: rgb("0000FF"),
            })),
            dash: Some(LineDash::Preset(DashStyle::LongDashDot)),
            compound: Some(CompoundLine::ThickThin),
            cap: Some(LineCap::Flat),
            head_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Oval),
                width: Some(LineEndSize::Large),
                length: Some(LineEndSize::Small),
            }),
            tail_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Diamond),
                width: Some(LineEndSize::Small),
                length: Some(LineEndSize::Large),
            }),
            join: Some(LineJoin::Bevel),
            align: Some(PenAlignment::Center),
        }),
        style: Some(ShapeStyle {
            line_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(3),
                color: Some(rgb("FF5733")),
            },
            fill_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(1),
                color: Some(rgb("33FF57")),
            },
            effect_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(2),
                color: None,
            },
            font_ref: FontReference {
                idx: FontCollectionIndex::Minor,
                color: Some(rgb("5733FF")),
            },
        }),
        macro_name: Some("MyConnectorMacro".into()),
        nv_ext_lst: None,
    };

    let (orig, rt) = roundtrip(props);

    assert_eq!(rt.name, orig.name);
    assert_eq!(rt.description, orig.description);
    assert_eq!(rt.title, orig.title);
    assert_eq!(rt.hidden, orig.hidden);

    let hc = rt.hlink_click.as_ref().expect("hlink_click missing");
    assert_eq!(hc.r_id.as_deref(), Some("rId1"));
    assert_eq!(hc.tooltip.as_deref(), Some("Click here"));
    assert_eq!(hc.action.as_deref(), Some("ppaction://hlinksldjump"));

    let hh = rt.hlink_hover.as_ref().expect("hlink_hover missing");
    assert_eq!(hh.r_id.as_deref(), Some("rId2"));
    assert_eq!(hh.tooltip.as_deref(), Some("Hover text"));
    assert!(hh.action.is_none());

    let st = rt.start_connection.as_ref().unwrap();
    assert_eq!(st.shape_id, 10);
    assert_eq!(st.idx, 0);
    let en = rt.end_connection.as_ref().unwrap();
    assert_eq!(en.shape_id, 20);
    assert_eq!(en.idx, 4);

    assert!(rt.locks.no_grp);
    assert!(!rt.locks.no_select);
    assert!(rt.locks.no_rot);
    assert!(!rt.locks.no_change_aspect);
    assert!(rt.locks.no_move);
    assert!(rt.locks.no_resize);
    assert!(!rt.locks.no_edit_points);
    assert!(rt.locks.no_adjust_handles);
    assert!(rt.locks.no_change_arrowheads);
    assert!(!rt.locks.no_change_shape_type);

    assert_eq!(rt.transform.off_x(), 1000000);
    assert_eq!(rt.transform.off_y(), 2000000);
    assert_eq!(rt.transform.ext_cx(), 3000000);
    assert_eq!(rt.transform.ext_cy(), 500000);
    assert_eq!(rt.transform.rot(), StAngle::new(5400000));
    assert!(rt.transform.is_flip_h());
    assert!(!rt.transform.is_flip_v());

    assert_eq!(
        rt.preset_geometry.as_ref().map(|pg| pg.prst),
        Some(ShapePreset::CurvedConnector3)
    );

    match rt.fill.as_ref().expect("fill missing") {
        DrawingFill::Solid(sf) => match &sf.color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "00FF00"),
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid fill, got {:?}", other),
    }

    let outline = rt.outline.as_ref().expect("outline missing");
    assert_eq!(outline.width, Some(38100));
    assert_eq!(outline_color_rgb(outline), Some("0000FF"));
    assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::LongDashDot)));
    assert_eq!(outline.compound, Some(CompoundLine::ThickThin));
    assert_eq!(outline.cap, Some(LineCap::Flat));
    assert_eq!(outline.align, Some(PenAlignment::Center));

    match &outline.join {
        Some(LineJoin::Bevel) => {}
        other => panic!("expected Bevel join, got {:?}", other),
    }

    let head = outline.head_end.as_ref().expect("head_end missing");
    assert_eq!(head.end_type, Some(LineEndType::Oval));
    assert_eq!(head.width, Some(LineEndSize::Large));
    assert_eq!(head.length, Some(LineEndSize::Small));

    let tail = outline.tail_end.as_ref().expect("tail_end missing");
    assert_eq!(tail.end_type, Some(LineEndType::Diamond));
    assert_eq!(tail.width, Some(LineEndSize::Small));
    assert_eq!(tail.length, Some(LineEndSize::Large));

    let style = rt.style.as_ref().expect("style missing");
    assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(3));
    assert_eq!(style_ref_color_rgb(&style.line_ref), Some("FF5733"));

    assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(1));
    assert_eq!(style_ref_color_rgb(&style.fill_ref), Some("33FF57"));

    assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(2));
    assert!(style.effect_ref.color.is_none());

    match &style.font_ref.color {
        Some(DrawingColor::SrgbClr { val, .. }) => assert_eq!(val, "5733FF"),
        other => panic!("expected SrgbClr for font_ref color, got {:?}", other),
    }

    assert_eq!(rt.macro_name.as_deref(), Some("MyConnectorMacro"));
}
