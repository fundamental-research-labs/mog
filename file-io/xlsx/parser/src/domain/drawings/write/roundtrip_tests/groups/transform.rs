use crate::domain::drawings::write::types::{GroupLocking, GroupTransform2D};
use ooxml_types::drawings::StAngle;

use super::common::{minimal_group_props, roundtrip_group};

#[test]
fn roundtrip_group_basic() {
    let props = minimal_group_props();
    let (original, roundtripped) = roundtrip_group(props);

    assert_eq!(roundtripped.name, original.name);
    let xfrm = roundtripped.transform.as_ref().unwrap();
    assert_eq!(xfrm.offset, Some((0, 0)));
    assert_eq!(xfrm.extent, Some((5000000, 3000000)));
    assert_eq!(xfrm.child_offset, Some((0, 0)));
    assert_eq!(xfrm.child_extent, Some((5000000, 3000000)));
}

#[test]
fn roundtrip_group_locking() {
    let mut props = minimal_group_props();
    props.group_locking = Some(GroupLocking {
        no_grp: true,
        no_ungrp: true,
        no_select: false,
        no_rot: true,
        no_change_aspect: true,
        no_move: false,
        no_resize: true,
        ext_lst: None,
    });

    let (_, roundtripped) = roundtrip_group(props);
    let locks = roundtripped.group_locking.as_ref().unwrap();
    assert!(locks.no_grp);
    assert!(locks.no_ungrp);
    assert!(!locks.no_select);
    assert!(locks.no_rot);
    assert!(locks.no_change_aspect);
    assert!(!locks.no_move);
    assert!(locks.no_resize);
}

#[test]
fn roundtrip_group_transform_scaling() {
    let mut props = minimal_group_props();
    props.transform = Some(GroupTransform2D {
        offset: Some((100000, 200000)),
        extent: Some((10000000, 6000000)),
        child_offset: Some((50000, 50000)),
        child_extent: Some((5000000, 3000000)),
        rotation: Some(StAngle::new(5400000)),
        flip_h: Some(true),
        flip_v: Some(false),
    });

    let (_, roundtripped) = roundtrip_group(props);
    let xfrm = roundtripped.transform.as_ref().unwrap();
    assert_eq!(xfrm.offset, Some((100000, 200000)));
    assert_eq!(xfrm.extent, Some((10000000, 6000000)));
    assert_eq!(xfrm.child_offset, Some((50000, 50000)));
    assert_eq!(xfrm.child_extent, Some((5000000, 3000000)));
    assert_eq!(xfrm.rotation, Some(StAngle::new(5400000)));
    assert_eq!(xfrm.flip_h, Some(true));
    assert!(xfrm.flip_v.is_none() || xfrm.flip_v == Some(false));
}
