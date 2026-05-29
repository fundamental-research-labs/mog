use std::collections::BTreeMap;

use crate::domain::floating_object::{
    DrawingData, InkPoint, InkStroke, InkTool, InkToolSettings, InkToolState, RecognitionBounds,
    RecognitionResult, TextAlternative,
};

#[test]
fn test_drawing_data_serde_round_trip() {
    let mut strokes = BTreeMap::new();
    strokes.insert(
        "s1".to_string(),
        InkStroke {
            id: "s1".to_string(),
            points: vec![
                InkPoint {
                    x: 0.0,
                    y: 0.0,
                    pressure: None,
                    tilt: None,
                    timestamp: None,
                },
                InkPoint {
                    x: 10.0,
                    y: 10.0,
                    pressure: Some(0.5),
                    tilt: Some(45.0),
                    timestamp: Some(100.0),
                },
            ],
            tool: InkTool::Highlighter,
            color: "#ff0000".to_string(),
            width: 5.0,
            opacity: 0.5,
            created_by: "user-a".to_string(),
            created_at: 999.0,
        },
    );

    let mut recognitions = BTreeMap::new();
    recognitions.insert(
        "r1".to_string(),
        RecognitionResult::Text {
            text: "Hello".to_string(),
            alternatives: vec![TextAlternative {
                text: "Hello".to_string(),
                confidence: 0.99,
            }],
            source_stroke_ids: vec!["s1".to_string()],
            bounds: RecognitionBounds {
                x: 0.0,
                y: 0.0,
                width: 50.0,
                height: 20.0,
            },
            recognized_at: 1000.0,
        },
    );

    let data = DrawingData {
        strokes,
        tool_state: InkToolState {
            active_tool: InkTool::Highlighter,
            tool_settings: {
                let mut m = BTreeMap::new();
                m.insert(
                    "highlighter".to_string(),
                    InkToolSettings {
                        width: 5.0,
                        opacity: 0.5,
                        color: "#ff0000".to_string(),
                        supports_pressure: false,
                    },
                );
                m
            },
        },
        recognitions,
        background_color: Some("#eee".to_string()),
        ooxml: None,
    };

    let json = serde_json::to_string_pretty(&data).unwrap();
    let restored: DrawingData = serde_json::from_str(&json).unwrap();
    assert_eq!(data, restored);
}

#[test]
fn test_drawing_data_default() {
    let data = DrawingData::default();
    assert!(data.strokes.is_empty());
    assert!(data.recognitions.is_empty());
    assert_eq!(data.tool_state.active_tool, InkTool::Pen);
    assert!(data.background_color.is_none());

    // Default should round-trip through JSON
    let json = serde_json::to_string(&data).unwrap();
    let restored: DrawingData = serde_json::from_str(&json).unwrap();
    assert_eq!(data, restored);
}
