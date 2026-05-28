use crate::domain::floating_object::{ShapeText, TextboxData};
use crate::domain::text_effects::{
    LineDash, TextEffectConfig, TextEffectFill, TextEffectOutline, TextWarpPreset,
};

#[test]
fn test_textbox_text_effects_config_roundtrip() {
    let tb = TextboxData {
        text: Some(ShapeText {
            content: "Art".to_string(),
            format: None,
            runs: None,
            vertical_align: None,
            horizontal_align: None,
            margins: None,
            auto_size: None,
            orientation: None,
            reading_order: None,
            horizontal_overflow: None,
            vertical_overflow: None,
            text_body: None,
        }),
        fill: None,
        border: None,
        text_effects: Some(TextEffectConfig {
            warp_preset: TextWarpPreset::TextArchUp,
            warp_adjustments: None,
            fill: TextEffectFill::Solid {
                color: "#ff0000".to_string(),
                opacity: Some(0.9),
            },
            outline: Some(TextEffectOutline {
                width: 2.0,
                color: "#000000".to_string(),
                opacity: None,
                dash: Some(LineDash::Solid),
                cap: None,
                join: None,
                miter_limit: None,
                compound: None,
            }),
            effects: None,
            follow_path: Some(true),
            anchor: None,
            text_direction: None,
            normalize_heights: None,
        }),
        ooxml: None,
    };
    let json = serde_json::to_string(&tb).unwrap();
    let restored: TextboxData = serde_json::from_str(&json).unwrap();
    assert_eq!(tb, restored);

    // Verify nested discriminated-union tag survives round-trip
    let val: serde_json::Value = serde_json::from_str(&json).unwrap();
    let text_effects = val.get("textEffects").unwrap();
    assert_eq!(text_effects["fill"]["type"], "solid");
    assert_eq!(text_effects["warpPreset"], "textArchUp");
}
