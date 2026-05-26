//! Output/result types for IPC serialization back to TypeScript.

use serde::Serialize;

use value_types::Color;

use super::{CFDataBarDirection, CFIconSetName, CfRenderStyle};

/// Result of evaluating conditional formatting for a single cell.
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellCFResult {
    pub row: u32,
    pub col: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<CfRenderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_bar: Option<DataBarResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_scale: Option<ColorScaleResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<IconResult>,
}

impl CellCFResult {
    /// Returns true if any result field is Some (i.e., at least one rule matched).
    pub fn has_any(&self) -> bool {
        self.style.is_some()
            || self.data_bar.is_some()
            || self.color_scale.is_some()
            || self.icon.is_some()
    }
}

/// Result of evaluating a CF rule, without cell position.
///
/// This is the evaluator's output type. Position is a scheduler concern —
/// the scheduler stamps row/col via [`into_cell_result`] before sending
/// over IPC.
///
/// Separating this from [`CellCFResult`] prevents meaningless `row=0, col=0`
/// values from threading through merge logic.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CFMatchResult {
    pub style: Option<CfRenderStyle>,
    pub data_bar: Option<DataBarResult>,
    pub color_scale: Option<ColorScaleResult>,
    pub icon: Option<IconResult>,
}

impl CFMatchResult {
    /// Create a result containing only a style (for style-based rules).
    pub fn from_style(style: Option<CfRenderStyle>) -> Self {
        Self {
            style,
            ..Default::default()
        }
    }

    /// Returns true if any result field is Some (i.e., at least one rule matched).
    pub fn has_any(&self) -> bool {
        self.style.is_some()
            || self.data_bar.is_some()
            || self.color_scale.is_some()
            || self.icon.is_some()
    }

    /// Convert to a positioned IPC result by stamping row and column.
    pub fn into_cell_result(self, row: u32, col: u32) -> CellCFResult {
        CellCFResult {
            row,
            col,
            style: self.style,
            data_bar: self.data_bar,
            color_scale: self.color_scale,
            icon: self.icon,
        }
    }
}

/// Data bar rendering result.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataBarResult {
    /// Bar fill percentage (0.0 to 100.0).
    pub fill_percent: f64,
    /// Color.
    pub color: Color,
    /// Gradient fill vs solid.
    pub gradient: bool,
    /// Axis position as percentage (0.0 to 100.0).
    pub axis_position: f64,
    /// Whether the underlying value is negative.
    pub is_negative: bool,
    /// Optional separate color for negative bars.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_color: Option<Color>,
    /// Whether to show the cell value alongside the bar.
    pub show_value: bool,
    /// Whether to show the axis line.
    pub show_axis: bool,
    /// Optional border color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<Color>,
    /// Optional negative bar border color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_border_color: Option<Color>,
    /// Whether to show the bar border.
    pub show_border: bool,
    /// Bar rendering direction.
    pub direction: CFDataBarDirection,
    /// Optional axis line color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis_color: Option<Color>,
}

/// Color scale rendering result.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColorScaleResult {
    /// Color.
    pub color: Color,
}

/// Icon rendering result.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IconResult {
    /// Icon set name (e.g., "3Arrows", "4Rating").
    pub set_name: CFIconSetName,
    /// Icon index within the set (0-based).
    pub icon_index: u8,
    /// Whether to hide the cell value and show only the icon.
    pub show_value: bool,
}
