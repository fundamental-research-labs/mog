use crate::domain::drawings::write::types::{DrawingColor, DrawingFill, StyleRef};
use ooxml_types::drawings::{
    FontCollectionIndex, FontReference, ShapeStyle, StStyleMatrixColumnIndex,
};

use super::super::common::{rgb, solid_fill};
use super::common::{minimal_props, roundtrip, style_ref_color_rgb};

#[test]
fn roundtrip_style() {
    let mut props = minimal_props();
    props.style = Some(ShapeStyle {
        line_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(2),
            color: Some(rgb("4472C4")),
        },
        fill_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        effect_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(1),
            color: Some(rgb("4472C4")),
        },
        font_ref: FontReference {
            idx: FontCollectionIndex::Minor,
            color: None,
        },
    });

    let (_orig, rt) = roundtrip(props);
    let style = rt.style.as_ref().expect("style missing after roundtrip");

    assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(2));
    assert_eq!(style_ref_color_rgb(&style.line_ref), Some("4472C4"));

    assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(0));
    assert!(style.fill_ref.color.is_none());

    assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(1));
    assert_eq!(style_ref_color_rgb(&style.effect_ref), Some("4472C4"));

    assert!(style.font_ref.color.is_none());
}

#[test]
fn roundtrip_no_fill() {
    let mut props = minimal_props();
    props.fill = Some(DrawingFill::NoFill);

    let (_orig, rt) = roundtrip(props);
    match rt.fill {
        Some(DrawingFill::NoFill) | None => {}
        other => panic!("expected NoFill or None, got {:?}", other),
    }
}

#[test]
fn roundtrip_solid_fill() {
    let mut props = minimal_props();
    props.fill = Some(solid_fill("ABCDEF"));

    let (_orig, rt) = roundtrip(props);
    match rt.fill.as_ref().expect("fill missing") {
        DrawingFill::Solid(sf) => match &sf.color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "ABCDEF"),
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid fill, got {:?}", other),
    }
}
