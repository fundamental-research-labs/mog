use crate::domain::drawings::write::types::{PresetGeometry, Transform2D};
use ooxml_types::drawings::{ShapePreset, StAngle};

use super::common::{minimal_props, roundtrip};

#[test]
fn roundtrip_preset_geometry_variants() {
    for preset in [
        ShapePreset::StraightConnector1,
        ShapePreset::BentConnector3,
        ShapePreset::CurvedConnector3,
    ] {
        let mut props = minimal_props();
        props.preset_geometry = Some(PresetGeometry {
            prst: preset,
            av_list: vec![],
        });

        let (_orig, rt) = roundtrip(props);
        assert_eq!(
            rt.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(preset),
            "preset geometry {:?} did not roundtrip",
            preset,
        );
    }
}

#[test]
fn roundtrip_transform() {
    let mut props = minimal_props();
    props.transform = Transform2D {
        offset: Some((914400, 1828800)),
        extent: Some((2743200, 457200)),
        rotation: Some(StAngle::new(2700000)),
        flip_h: Some(false),
        flip_v: Some(true),
    };

    let (_orig, rt) = roundtrip(props);
    assert_eq!(rt.transform.off_x(), 914400);
    assert_eq!(rt.transform.off_y(), 1828800);
    assert_eq!(rt.transform.ext_cx(), 2743200);
    assert_eq!(rt.transform.ext_cy(), 457200);
    assert_eq!(rt.transform.rot(), StAngle::new(2700000));
    assert!(!rt.transform.is_flip_h());
    assert!(rt.transform.is_flip_v());
}
