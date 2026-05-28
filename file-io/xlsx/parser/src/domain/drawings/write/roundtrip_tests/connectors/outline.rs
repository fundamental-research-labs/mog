use crate::domain::drawings::write::types::{Outline, SolidFill};
use ooxml_types::drawings::{
    CompoundLine, DashStyle, LineCap, LineDash, LineEndProperties, LineEndSize, LineEndType,
    LineFill, LineJoin, PenAlignment,
};

use super::super::common::rgb;
use super::common::{minimal_props, outline_color_rgb, roundtrip};

#[test]
fn roundtrip_arrowheads() {
    let mut props = minimal_props();
    props.outline = Some(Outline {
        width: Some(12700),
        head_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Triangle),
            width: Some(LineEndSize::Medium),
            length: Some(LineEndSize::Large),
        }),
        tail_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Stealth),
            width: Some(LineEndSize::Small),
            length: Some(LineEndSize::Small),
        }),
        ..Default::default()
    });

    let (_orig, rt) = roundtrip(props);
    let outline = rt
        .outline
        .as_ref()
        .expect("outline missing after roundtrip");

    let head = outline.head_end.as_ref().expect("head_end missing");
    assert_eq!(head.end_type, Some(LineEndType::Triangle));
    assert_eq!(head.width, Some(LineEndSize::Medium));
    assert_eq!(head.length, Some(LineEndSize::Large));

    let tail = outline.tail_end.as_ref().expect("tail_end missing");
    assert_eq!(tail.end_type, Some(LineEndType::Stealth));
    assert_eq!(tail.width, Some(LineEndSize::Small));
    assert_eq!(tail.length, Some(LineEndSize::Small));
}

#[test]
fn roundtrip_full_outline() {
    let mut props = minimal_props();
    props.outline = Some(Outline {
        width: Some(25400),
        fill: Some(LineFill::Solid(SolidFill {
            color: rgb("FF0000"),
        })),
        dash: Some(LineDash::Preset(DashStyle::LongDash)),
        compound: Some(CompoundLine::Double),
        cap: Some(LineCap::Round),
        head_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Diamond),
            width: Some(LineEndSize::Large),
            length: Some(LineEndSize::Large),
        }),
        tail_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Arrow),
            width: Some(LineEndSize::Medium),
            length: Some(LineEndSize::Medium),
        }),
        join: Some(LineJoin::Miter {
            limit: Some(800000),
        }),
        align: None,
    });

    let (_orig, rt) = roundtrip(props);
    let outline = rt
        .outline
        .as_ref()
        .expect("outline missing after roundtrip");

    assert_eq!(outline.width, Some(25400));
    assert_eq!(outline_color_rgb(outline), Some("FF0000"));
    assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::LongDash)));
    assert_eq!(outline.compound, Some(CompoundLine::Double));
    assert_eq!(outline.cap, Some(LineCap::Round));

    match &outline.join {
        Some(LineJoin::Miter { limit }) => assert_eq!(*limit, Some(800000)),
        other => panic!("expected Miter join, got {:?}", other),
    }

    let head = outline.head_end.as_ref().expect("head_end missing");
    assert_eq!(head.end_type, Some(LineEndType::Diamond));
    assert_eq!(head.width, Some(LineEndSize::Large));
    assert_eq!(head.length, Some(LineEndSize::Large));

    let tail = outline.tail_end.as_ref().expect("tail_end missing");
    assert_eq!(tail.end_type, Some(LineEndType::Arrow));
    assert_eq!(tail.width, Some(LineEndSize::Medium));
    assert_eq!(tail.length, Some(LineEndSize::Medium));
}

#[test]
fn roundtrip_outline_round_join() {
    let mut props = minimal_props();
    props.outline = Some(Outline {
        width: Some(12700),
        join: Some(LineJoin::Round),
        ..Default::default()
    });

    let (_orig, rt) = roundtrip(props);
    let outline = rt.outline.as_ref().expect("outline missing");
    match &outline.join {
        Some(LineJoin::Round) => {}
        other => panic!("expected Round join, got {:?}", other),
    }
}

#[test]
fn roundtrip_outline_bevel_join() {
    let mut props = minimal_props();
    props.outline = Some(Outline {
        width: Some(12700),
        join: Some(LineJoin::Bevel),
        ..Default::default()
    });

    let (_orig, rt) = roundtrip(props);
    let outline = rt.outline.as_ref().expect("outline missing");
    match &outline.join {
        Some(LineJoin::Bevel) => {}
        other => panic!("expected Bevel join, got {:?}", other),
    }
}

#[test]
fn roundtrip_outline_miter_no_limit() {
    let mut props = minimal_props();
    props.outline = Some(Outline {
        width: Some(12700),
        join: Some(LineJoin::Miter { limit: None }),
        ..Default::default()
    });

    let (_orig, rt) = roundtrip(props);
    let outline = rt.outline.as_ref().expect("outline missing");
    match &outline.join {
        Some(LineJoin::Miter { limit }) => assert!(limit.is_none()),
        other => panic!("expected Miter join with no limit, got {:?}", other),
    }
}

#[test]
fn roundtrip_pen_alignment() {
    let mut props = minimal_props();
    props.outline = Some(Outline {
        width: Some(12700),
        align: Some(PenAlignment::Center),
        ..Default::default()
    });

    let (_orig, rt) = roundtrip(props);
    let outline = rt.outline.as_ref().expect("outline missing");
    assert_eq!(outline.align, Some(PenAlignment::Center));
}
