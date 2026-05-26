//! Autofill bridge types.
//!
//! Wire-friendly structs with `camelCase` serde for the IPC boundary.
//! These are converted to `compute_fill::types::*` internally.

use serde::{Deserialize, Serialize};

/// Bridge-facing range specification for autofill.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFillRangeSpec {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// Bridge-facing autofill request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAutoFillRequest {
    pub source_range: BridgeFillRangeSpec,
    pub target_range: BridgeFillRangeSpec,
    /// "down" | "up" | "right" | "left"
    pub direction: String,
    /// "auto" | "copy" | "series" | "days" | "weekdays" | "months" | "years"
    /// | "formats" | "values" | "withoutFormats" | "linearTrend" | "growthTrend"
    pub mode: String,
    pub include_formulas: bool,
    pub include_values: bool,
    pub include_formats: bool,
    /// Step value for series fill (e.g., 2.0 for 1,3,5,7). Defaults to 1.0 if absent.
    #[serde(default = "default_step_value")]
    pub step_value: f64,
}

fn default_step_value() -> f64 {
    1.0
}

/// Bridge-facing flash fill request.
///
/// `source_range` is a single-column range of source values.
/// `target_range` is a single-column range where some cells contain
/// user-provided examples and the rest are empty (to be filled).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFlashFillRequest {
    pub source_range: BridgeFillRangeSpec,
    pub target_range: BridgeFillRangeSpec,
}

/// Bridge-facing flash fill result summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFlashFillResult {
    pub success: bool,
    pub pattern_description: Option<String>,
    pub filled_cell_count: u32,
}

impl BridgeAutoFillRequest {
    /// Parse direction string into `compute_fill::types::FillDirection`.
    pub fn fill_direction(&self) -> compute_fill::types::FillDirection {
        match self.direction.to_lowercase().as_str() {
            "up" => compute_fill::types::FillDirection::Up,
            "right" => compute_fill::types::FillDirection::Right,
            "left" => compute_fill::types::FillDirection::Left,
            _ => compute_fill::types::FillDirection::Down,
        }
    }

    /// Parse mode string into `compute_fill::types::FillMode`.
    pub fn fill_mode(&self) -> compute_fill::types::FillMode {
        match self.mode.to_lowercase().as_str() {
            "copy" => compute_fill::types::FillMode::Copy,
            "series" => compute_fill::types::FillMode::Series,
            "days" => compute_fill::types::FillMode::Days,
            "weekdays" => compute_fill::types::FillMode::Weekdays,
            "months" => compute_fill::types::FillMode::Months,
            "years" => compute_fill::types::FillMode::Years,
            "formats" => compute_fill::types::FillMode::Formats,
            "values" => compute_fill::types::FillMode::Values,
            "withoutformats" => compute_fill::types::FillMode::WithoutFormats,
            "lineartrend" => compute_fill::types::FillMode::LinearTrend,
            "growthtrend" => compute_fill::types::FillMode::GrowthTrend,
            _ => compute_fill::types::FillMode::Auto,
        }
    }

    /// Convert to `compute_fill::types::FillRequest`.
    pub fn to_fill_request(&self) -> compute_fill::types::FillRequest {
        compute_fill::types::FillRequest {
            source_range: compute_fill::types::FillRangeSpec {
                start_row: self.source_range.start_row,
                start_col: self.source_range.start_col,
                end_row: self.source_range.end_row,
                end_col: self.source_range.end_col,
            },
            target_range: compute_fill::types::FillRangeSpec {
                start_row: self.target_range.start_row,
                start_col: self.target_range.start_col,
                end_row: self.target_range.end_row,
                end_col: self.target_range.end_col,
            },
            direction: self.fill_direction(),
            mode: self.fill_mode(),
            include_formulas: self.include_formulas,
            include_values: self.include_values,
            include_formats: self.include_formats,
            step_value: self.step_value,
        }
    }
}
