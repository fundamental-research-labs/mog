use crate::domain::controls::types::{AnchorSource, ControlAnchor};

#[test]
fn vml_anchor_records_pixel_offsets_and_source() {
    let anchor = ControlAnchor::from_vml_anchor("1,15,0,10,3,22,1,4").unwrap();

    assert_eq!(anchor.from_col, 1);
    assert_eq!(anchor.from_col_offset, 15);
    assert_eq!(anchor.from_row, 0);
    assert_eq!(anchor.from_row_offset, 10);
    assert_eq!(anchor.to_col, 3);
    assert_eq!(anchor.to_col_offset, 22);
    assert_eq!(anchor.to_row, 1);
    assert_eq!(anchor.to_row_offset, 4);
    assert_eq!(anchor.anchor_source, AnchorSource::Vml);
}

#[test]
fn vml_anchor_rejects_too_few_fields() {
    assert!(ControlAnchor::from_vml_anchor("1,2,3").is_none());
}

#[test]
fn modern_anchor_records_emu_offsets_and_move_size_policy() {
    let xml = br#"<controlPr>
        <anchor moveWithCells="1" sizeWithCells="0">
            <from><col>1</col><colOff>152400</colOff><row>2</row><rowOff>76200</rowOff></from>
            <to><col>3</col><colOff>457200</colOff><row>4</row><rowOff>19050</rowOff></to>
        </anchor>
    </controlPr>"#;

    let result = ControlAnchor::from_modern_anchor(xml).unwrap();

    assert_eq!(result.anchor.from_col, 1);
    assert_eq!(result.anchor.from_col_offset, 152400);
    assert_eq!(result.anchor.from_row, 2);
    assert_eq!(result.anchor.from_row_offset, 76200);
    assert_eq!(result.anchor.to_col, 3);
    assert_eq!(result.anchor.to_col_offset, 457200);
    assert_eq!(result.anchor.to_row, 4);
    assert_eq!(result.anchor.to_row_offset, 19050);
    assert_eq!(result.anchor.anchor_source, AnchorSource::Modern);
    assert!(result.move_with_cells);
    assert!(!result.size_with_cells);
}

#[test]
fn modern_anchor_requires_from_and_to_points() {
    assert!(ControlAnchor::from_modern_anchor(b"<controlPr><noAnchorHere/></controlPr>").is_none());
    assert!(
        ControlAnchor::from_modern_anchor(br#"<anchor><to><col>1</col><row>1</row></to></anchor>"#)
            .is_none()
    );
    assert!(
        ControlAnchor::from_modern_anchor(
            br#"<anchor><from><col>0</col><row>0</row></from></anchor>"#
        )
        .is_none()
    );
}
