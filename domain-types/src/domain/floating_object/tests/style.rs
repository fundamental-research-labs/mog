use crate::CellFormat;
use crate::domain::floating_object::{
    ConnectorBinding, FillType, GradientFill, GradientType, LineEnd, LineEndType, ObjectFill,
    OuterShadowEffect, OutlineStyle, ShadowAlignment, ShapeOutline, ShapeText, VerticalAlign,
};

#[test]
fn test_sub_types_match_snapshot_types() {
    // ObjectFill round-trip
    let json = r##"{"type":"solid","color":"#4285f4"}"##;
    let fill: ObjectFill = serde_json::from_str(json).unwrap();
    assert_eq!(fill.fill_type, FillType::Solid);
    assert_eq!(fill.color.as_deref(), Some("#4285f4"));
    let back = serde_json::to_string(&fill).unwrap();
    assert_eq!(back, json);

    // GradientFill round-trip
    let json = r##"{"type":"linear","stops":[{"offset":0.0,"color":"#ff0000"},{"offset":1.0,"color":"#0000ff"}],"angle":90.0}"##;
    let gf: GradientFill = serde_json::from_str(json).unwrap();
    assert_eq!(gf.gradient_type, GradientType::Linear);
    assert_eq!(gf.stops.len(), 2);
    let back = serde_json::to_string(&gf).unwrap();
    assert_eq!(back, json);

    // ShapeOutline round-trip
    let json = r##"{"style":"solid","color":"#000000","width":1.5}"##;
    let outline: ShapeOutline = serde_json::from_str(json).unwrap();
    assert_eq!(outline.style, OutlineStyle::Solid);
    let back = serde_json::to_string(&outline).unwrap();
    assert_eq!(back, json);

    // LineEnd round-trip
    let json = r#"{"type":"triangle","width":"sm","length":"lg"}"#;
    let le: LineEnd = serde_json::from_str(json).unwrap();
    assert_eq!(le.end_type, LineEndType::Triangle);
    let back = serde_json::to_string(&le).unwrap();
    assert_eq!(back, json);

    // ShapeText round-trip
    let json = r#"{"content":"Hello","verticalAlign":"middle"}"#;
    let text: ShapeText = serde_json::from_str(json).unwrap();
    assert_eq!(text.content, "Hello");
    let back = serde_json::to_string(&text).unwrap();
    assert_eq!(back, json);

    // OuterShadowEffect round-trip
    let json = r##"{"blurRadius":40000.0,"distance":20000.0,"direction":315.0,"color":"#000000","opacity":0.4}"##;
    let shadow: OuterShadowEffect = serde_json::from_str(json).unwrap();
    assert!((shadow.blur_radius - 40000.0).abs() < f64::EPSILON);
    let back = serde_json::to_string(&shadow).unwrap();
    assert_eq!(back, json);

    // ConnectorBinding round-trip
    let json = r#"{"shapeId":"shape-1","siteIndex":2}"#;
    let cb: ConnectorBinding = serde_json::from_str(json).unwrap();
    assert_eq!(cb.shape_id, "shape-1");
    let back = serde_json::to_string(&cb).unwrap();
    assert_eq!(back, json);

    // ShadowAlignment round-trip
    let sa: ShadowAlignment = serde_json::from_str(r#""ctr""#).unwrap();
    assert_eq!(sa, ShadowAlignment::Center);
    assert_eq!(
        serde_json::to_string(&ShadowAlignment::BottomRight).unwrap(),
        r#""br""#
    );
}

#[test]
fn test_shape_text_cellformat_roundtrip() {
    let st = ShapeText {
        content: "Bold text".to_string(),
        format: Some(CellFormat {
            bold: Some(true),
            italic: Some(false),
            font_family: Some("Calibri".to_string()),
            ..Default::default()
        }),
        runs: None,
        vertical_align: Some(VerticalAlign::Middle),
        horizontal_align: None,
        margins: None,
        auto_size: None,
        orientation: None,
        reading_order: None,
        horizontal_overflow: None,
        vertical_overflow: None,
        text_body: None,
    };
    let json = serde_json::to_string(&st).unwrap();
    let restored: ShapeText = serde_json::from_str(&json).unwrap();
    assert_eq!(st, restored);
    assert_eq!(restored.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(
        restored.format.as_ref().unwrap().font_family.as_deref(),
        Some("Calibri"),
    );
}
