use ooxml_types::drawings::DrawingLocking;

use super::common::{minimal_props, roundtrip};

#[test]
fn roundtrip_locks() {
    let mut props = minimal_props();
    props.locks = DrawingLocking {
        no_move: true,
        no_resize: true,
        no_change_arrowheads: true,
        no_grp: false,
        no_select: false,
        no_rot: false,
        no_change_aspect: false,
        no_edit_points: false,
        no_adjust_handles: false,
        no_change_shape_type: false,
        ..Default::default()
    };

    let (_orig, rt) = roundtrip(props);

    assert!(rt.locks.no_move, "no_move should be true");
    assert!(rt.locks.no_resize, "no_resize should be true");
    assert!(
        rt.locks.no_change_arrowheads,
        "no_change_arrowheads should be true"
    );
    assert!(!rt.locks.no_grp, "no_grp should be false");
    assert!(!rt.locks.no_select, "no_select should be false");
    assert!(!rt.locks.no_rot, "no_rot should be false");
    assert!(
        !rt.locks.no_change_aspect,
        "no_change_aspect should be false"
    );
    assert!(!rt.locks.no_edit_points, "no_edit_points should be false");
    assert!(
        !rt.locks.no_adjust_handles,
        "no_adjust_handles should be false"
    );
    assert!(
        !rt.locks.no_change_shape_type,
        "no_change_shape_type should be false"
    );
}

#[test]
fn roundtrip_all_locks_true() {
    let mut props = minimal_props();
    props.locks = DrawingLocking {
        no_grp: true,
        no_select: true,
        no_rot: true,
        no_change_aspect: true,
        no_move: true,
        no_resize: true,
        no_edit_points: true,
        no_adjust_handles: true,
        no_change_arrowheads: true,
        no_change_shape_type: true,
        ..Default::default()
    };

    let (_orig, rt) = roundtrip(props);

    assert!(rt.locks.no_grp);
    assert!(rt.locks.no_select);
    assert!(rt.locks.no_rot);
    assert!(rt.locks.no_change_aspect);
    assert!(rt.locks.no_move);
    assert!(rt.locks.no_resize);
    assert!(rt.locks.no_edit_points);
    assert!(rt.locks.no_adjust_handles);
    assert!(rt.locks.no_change_arrowheads);
    assert!(rt.locks.no_change_shape_type);
}

#[test]
fn roundtrip_minimal_connector() {
    let props = minimal_props();
    let (_orig, rt) = roundtrip(props);

    assert_eq!(rt.name, "TestConnector");
    assert!(rt.description.is_none());
    assert!(rt.title.is_none());
    assert!(!rt.hidden);
    assert!(rt.hlink_click.is_none());
    assert!(rt.hlink_hover.is_none());
    assert!(rt.start_connection.is_none());
    assert!(rt.end_connection.is_none());
    assert!(!rt.locks.no_move);
    assert!(!rt.locks.no_resize);
    assert!(rt.fill.is_none());
    assert!(rt.outline.is_none());
    assert!(rt.preset_geometry.is_none());
    assert!(rt.style.is_none());
    assert!(rt.macro_name.is_none());
}

#[test]
fn roundtrip_macro_name() {
    let mut props = minimal_props();
    props.macro_name = Some("Sheet1.ConnectorClick".into());

    let (_orig, rt) = roundtrip(props);
    assert_eq!(rt.macro_name.as_deref(), Some("Sheet1.ConnectorClick"));
}
