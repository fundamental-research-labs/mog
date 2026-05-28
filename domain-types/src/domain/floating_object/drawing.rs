use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ── Ink / Drawing Types ─────────────────────────────────────────────

/// Tool type for ink drawing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum InkTool {
    #[default]
    Pen,
    Pencil,
    Highlighter,
    Marker,
    Brush,
    Eraser,
}

/// A single point in a stroke with optional pressure/tilt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkPoint {
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tilt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<f64>,
}

/// A complete ink stroke.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkStroke {
    pub id: String,
    pub points: Vec<InkPoint>,
    pub tool: InkTool,
    pub color: String,
    pub width: f64,
    pub opacity: f64,
    pub created_by: String,
    pub created_at: f64,
}

/// Per-tool settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkToolSettings {
    pub width: f64,
    pub opacity: f64,
    pub color: String,
    pub supports_pressure: bool,
}

/// Current tool state for a drawing session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkToolState {
    pub active_tool: InkTool,
    pub tool_settings: BTreeMap<String, InkToolSettings>,
}

impl Default for InkToolState {
    fn default() -> Self {
        let mut tool_settings = BTreeMap::new();
        tool_settings.insert(
            "pen".to_string(),
            InkToolSettings {
                width: 2.0,
                opacity: 1.0,
                color: "#000000".to_string(),
                supports_pressure: true,
            },
        );
        InkToolState {
            active_tool: InkTool::Pen,
            tool_settings,
        }
    }
}

/// Parameters for recognized geometric shapes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShapeRecognitionParams {
    #[serde(rename = "line")]
    Line {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        rotation: f64,
    },
    #[serde(rename = "rectangle")]
    Rectangle {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        rotation: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        corner_radius: Option<f64>,
    },
    #[serde(rename = "ellipse")]
    Ellipse {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rotation: f64,
    },
    #[serde(rename = "triangle")]
    Triangle {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x3: f64,
        y3: f64,
        rotation: f64,
    },
    #[serde(rename = "arrow")]
    Arrow {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        head_size: f64,
        rotation: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        has_start_head: Option<bool>,
    },
    #[serde(rename = "star")]
    Star {
        cx: f64,
        cy: f64,
        outer_radius: f64,
        inner_radius: f64,
        points: u32,
        rotation: f64,
    },
}

/// A text recognition alternative.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAlternative {
    pub text: String,
    pub confidence: f64,
}

/// Bounding box for a recognition result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Recognition result — either a shape or text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RecognitionResult {
    #[serde(rename = "shape")]
    Shape {
        shape_type: String,
        params: ShapeRecognitionParams,
        source_stroke_ids: Vec<String>,
        confidence: f64,
        recognized_at: f64,
    },
    #[serde(rename = "text")]
    Text {
        text: String,
        alternatives: Vec<TextAlternative>,
        source_stroke_ids: Vec<String>,
        bounds: RecognitionBounds,
        recognized_at: f64,
    },
}

/// Ink/freehand drawing data — typed replacement for the old `data: Value` blob.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct DrawingData {
    /// Strokes keyed by stroke ID. Uses BTreeMap for deterministic serialization.
    #[serde(default)]
    pub strokes: BTreeMap<String, InkStroke>,

    /// Current tool state.
    #[serde(default)]
    pub tool_state: InkToolState,

    /// Recognition results keyed by recognition ID.
    #[serde(default)]
    pub recognitions: BTreeMap<String, RecognitionResult>,

    /// Background color (CSS color string), None = transparent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,

    /// Imported OOXML drawing object payload for writer-owned round-trip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<super::ooxml::DrawingObjectOoxmlProps>,
}
