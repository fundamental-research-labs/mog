use crate::domain::controls::read::{
    self, ActiveXControl, AnchorSource, CheckState, ControlAnchor, FormControl,
    FormControlProperties, FormControlType, ModernAnchorResult, OleObject, VmlShapeProps,
    WorksheetControl, WorksheetControlRef, WorksheetControls,
};

fn assert_read_facade_exports<T>() {}

#[test]
fn read_facade_preserves_legacy_import_surface() {
    assert_read_facade_exports::<ActiveXControl>();
    assert_read_facade_exports::<AnchorSource>();
    assert_read_facade_exports::<CheckState>();
    assert_read_facade_exports::<ControlAnchor>();
    assert_read_facade_exports::<FormControl>();
    assert_read_facade_exports::<FormControlProperties>();
    assert_read_facade_exports::<FormControlType>();
    assert_read_facade_exports::<ModernAnchorResult>();
    assert_read_facade_exports::<OleObject>();
    assert_read_facade_exports::<VmlShapeProps>();
    assert_read_facade_exports::<WorksheetControl>();
    assert_read_facade_exports::<WorksheetControlRef>();
    assert_read_facade_exports::<WorksheetControls>();

    let worksheet_controls = read::parse_worksheet_controls(
        br#"<controls><control shapeId="1025" r:id="rId1" name="Check Box 1"/></controls>"#,
    );
    assert_eq!(worksheet_controls.len(), 1);
    assert_eq!(worksheet_controls[0].shape_id, 1025);
    assert_eq!(worksheet_controls[0].r_id, "rId1");

    let vml_images = read::parse_vml_imagedata(
        br#"<v:shape id="_x0000_s1025"><v:imagedata o:relid="rId2"/></v:shape>"#,
    );
    assert_eq!(
        vml_images.get("_x0000_s1025").map(String::as_str),
        Some("rId2")
    );
    assert_eq!(read::extract_vml_shape_number("_x0000_s1025"), Some(1025));
}
