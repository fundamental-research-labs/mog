pub(super) use crate::domain::drawings::write::{
    AbsoluteAnchor, CellAnchor, ChartExRef, ChartRef, ClientData, CompoundLine, Connection,
    ConnectorProps, DashStyle, DrawingAnchor, DrawingColor, DrawingFill, DrawingLocking,
    DrawingObject, DrawingWriter, EditAs, Extent, GradientFill, GradientStop, Hyperlink,
    ImageProps, LineCap, LineEndProperties, LineEndSize, LineEndType, LineJoin, NS_C, NS_CX,
    Outline, PatternFill, PenAlignment, Position, PresetGeometry, ShapePreset, ShapeProps,
    ShapeStyle, SolidFill, StyleRef, TextBox, Transform2D, TwoCellAnchor, cm_to_emu, emu_to_cm,
    emu_to_inches, inches_to_emu, pixels_to_emu, points_to_emu,
};
pub(super) use ooxml_types::drawings::{
    LineDash, LineFill, StAngle, StPercentage, StPitchFamily, StPositiveFixedPercentageDecimal,
    StStyleMatrixColumnIndex, StTextFontSize, StTextIndentLevelType, StTextNonNegativePoint,
    StTextPoint,
};
// Text-related imports for roundtrip tests
pub(super) use crate::domain::drawings::write::{
    BulletColor, BulletProperties, BulletSize, BulletType, Paragraph, ParagraphProperties,
    RunProperties, TextAlign, TextAnchor, TextAutofit, TextBody, TextBodyProperties, TextCapsType,
    TextFont, TextFontAlignType, TextHorzOverflow, TextListStyle, TextRun, TextRunContent,
    TextSpacing, TextStrikeType, TextTabAlignType, TextTabStop, TextUnderlineType,
    TextVertOverflow, TextVerticalType, TextWrap,
};

// Helpers for constructing ooxml-types in tests
pub(super) fn rgb(hex: &str) -> DrawingColor {
    DrawingColor::SrgbClr {
        val: hex.into(),
        transforms: vec![],
    }
}
pub(super) fn solid_fill(hex: &str) -> DrawingFill {
    DrawingFill::Solid(SolidFill { color: rgb(hex) })
}
pub(super) fn line_solid(hex: &str) -> LineFill {
    LineFill::Solid(SolidFill { color: rgb(hex) })
}

/// Roundtrip helper: write a TextBody through DrawingWriter, parse back, return parsed TextBody.
pub(super) fn roundtrip_text_body(text_body: TextBody) -> TextBody {
    use crate::domain::drawings::{Anchor, DrawingContent, parse_drawing};

    let text_box = TextBox {
        original_id: None,
        name: "Test".to_string(),
        text_body: Some(text_body),
        fill: None,
        outline: None,
        style: None,
        ..Default::default()
    };

    let from = CellAnchor {
        col: 0,
        col_off: 0,
        row: 0,
        row_off: 0,
    };
    let to = CellAnchor {
        col: 5,
        col_off: 0,
        row: 5,
        row_off: 0,
    };

    let mut dw = DrawingWriter::new();
    dw.add_text_box(from, to, text_box);
    let xml = dw.to_xml();

    let drawing = parse_drawing(&xml);
    assert!(
        !drawing.anchors.is_empty(),
        "No anchors in roundtrip output"
    );

    match &drawing.anchors[0] {
        Anchor::TwoCell(tc) => match &tc.content {
            DrawingContent::Shape(shape) => {
                shape.tx_body.clone().expect("No text body after roundtrip")
            }
            other => panic!("Expected Shape, got {:?}", other),
        },
        other => panic!("Expected TwoCell, got {:?}", other),
    }
}
