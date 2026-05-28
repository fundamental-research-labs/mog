use crate::domain::drawings::write::types::{BlackWhiteMode, DrawingColor, DrawingFill, SolidFill};

use super::common::{minimal_group_props, roundtrip_group};

#[test]
fn roundtrip_group_fill_and_bw_mode() {
    let mut props = minimal_group_props();
    props.fill = Some(DrawingFill::Solid(SolidFill {
        color: DrawingColor::SrgbClr {
            val: "FF0000".into(),
            transforms: vec![],
        },
    }));
    props.bw_mode = Some(BlackWhiteMode::Auto);

    let (_, roundtripped) = roundtrip_group(props);
    assert!(roundtripped.fill.is_some());
    match roundtripped.fill.as_ref().unwrap() {
        DrawingFill::Solid(sf) => match &sf.color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("expected SrgbClr, got {:?}", other),
        },
        other => panic!("expected Solid fill, got {:?}", other),
    }
    assert_eq!(roundtripped.bw_mode, Some(BlackWhiteMode::Auto));
}
