//! Fill engine types — pure data contracts for autofill operations.

use domain_types::CellFormat;
use formula_types::IdentityFormula;
use serde::{Deserialize, Serialize};
use value_types::CellValue;

/// Direction of a fill operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FillDirection {
    Down,
    Up,
    Right,
    Left,
}

/// How to generate fill values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FillMode {
    Auto,
    Copy,
    Series,
    Days,
    Weekdays,
    Months,
    Years,
    Formats,
    Values,
    WithoutFormats,
    LinearTrend,
    GrowthTrend,
}

/// The detected or declared pattern type for a fill sequence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FillPatternType {
    Copy,
    Linear,
    Growth,
    Date,
    Time,
    Weekday,
    WeekdayShort,
    Month,
    MonthShort,
    Quarter,
    Ordinal,
    TextWithNumber,
    CustomList,
}

/// Describes a detected fill pattern.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FillPattern {
    pub pattern_type: FillPatternType,
    pub step: Option<f64>,
    pub multiplier: Option<f64>,
    pub date_unit: Option<DateUnit>,
    pub time_unit: Option<TimeUnit>,
    pub start_index: Option<usize>,
    pub prefix: Option<String>,
    pub num_digits: Option<usize>,
    pub list_id: Option<String>,
}

/// Unit for date-based fill patterns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DateUnit {
    Day,
    Weekday,
    Month,
    Year,
}

/// Unit for time-based fill patterns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeUnit {
    Hour,
    Minute,
    Second,
}

/// A rectangular range specification (row/col coordinates).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FillRangeSpec {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// A request to fill a target range from a source range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillRequest {
    pub source_range: FillRangeSpec,
    pub target_range: FillRangeSpec,
    pub direction: FillDirection,
    pub mode: FillMode,
    pub include_formulas: bool,
    pub include_values: bool,
    pub include_formats: bool,
    /// Step value for explicit series fill. Default 1.0 (auto-detected from source when 0 or unset).
    #[serde(default = "default_step")]
    pub step_value: f64,
}

fn default_step() -> f64 {
    1.0
}

/// A single cell update produced by the fill engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum FillUpdate {
    Value {
        row: u32,
        col: u32,
        value: CellValue,
    },
    Formula {
        row: u32,
        col: u32,
        source_formula: IdentityFormula,
        adjusted_refs: Vec<AdjustedRef>,
    },
    Format {
        row: u32,
        col: u32,
        format: CellFormat,
    },
    Clear {
        row: u32,
        col: u32,
    },
}

/// Result of computing adjusted position for a single ref.
/// Pure data — no CellId resolution yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustedRef {
    pub ref_index: usize,
    pub target_row: u32,
    pub target_col: u32,
    /// For range refs, the end position.
    pub target_end_row: Option<u32>,
    pub target_end_col: Option<u32>,
    pub out_of_bounds: bool,
}

/// Full result of a fill operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillResult {
    pub updates: Vec<FillUpdate>,
    pub detected_pattern: FillPattern,
    pub filled_cell_count: u32,
    pub warnings: Vec<FillWarning>,
}

/// A warning about a specific cell during fill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillWarning {
    pub row: u32,
    pub col: u32,
    pub kind: FillWarningKind,
}

/// The kind of warning encountered during fill.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FillWarningKind {
    MergedCellsInTarget,
    FormulaRefOutOfBounds { ref_index: usize },
    SourceCellEmpty,
}

/// Locale-specific day and month names for pattern detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleNames {
    pub weekdays: [String; 7],
    pub weekdays_short: [String; 7],
    pub months: [String; 12],
    pub months_short: [String; 12],
}

impl Default for LocaleNames {
    fn default() -> Self {
        Self {
            weekdays: [
                "Sunday".into(),
                "Monday".into(),
                "Tuesday".into(),
                "Wednesday".into(),
                "Thursday".into(),
                "Friday".into(),
                "Saturday".into(),
            ],
            weekdays_short: [
                "Sun".into(),
                "Mon".into(),
                "Tue".into(),
                "Wed".into(),
                "Thu".into(),
                "Fri".into(),
                "Sat".into(),
            ],
            months: [
                "January".into(),
                "February".into(),
                "March".into(),
                "April".into(),
                "May".into(),
                "June".into(),
                "July".into(),
                "August".into(),
                "September".into(),
                "October".into(),
                "November".into(),
                "December".into(),
            ],
            months_short: [
                "Jan".into(),
                "Feb".into(),
                "Mar".into(),
                "Apr".into(),
                "May".into(),
                "Jun".into(),
                "Jul".into(),
                "Aug".into(),
                "Sep".into(),
                "Oct".into(),
                "Nov".into(),
                "Dec".into(),
            ],
        }
    }
}

/// Custom list for pattern detection (e.g. ["High", "Medium", "Low"]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomList {
    pub id: String,
    pub values: Vec<String>,
}

/// Input to the fill engine — all data pre-gathered by the bridge caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillInput {
    pub request: FillRequest,
    pub source_cells: Vec<SourceCell>,
    pub merges: Vec<MergeRegion>,
    pub hidden_rows: std::collections::BTreeSet<u32>,
    pub hidden_cols: std::collections::BTreeSet<u32>,
    pub custom_lists: Vec<CustomList>,
    pub locale: LocaleNames,
}

/// A source cell's data for the fill engine.
///
/// No `cell_id` field — CellId is a storage concern. Formula ref identity
/// info is carried through `ref_positions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceCell {
    pub row: u32,
    pub col: u32,
    pub value: CellValue,
    pub formula: Option<IdentityFormula>,
    pub format: Option<CellFormat>,
    /// Resolved positional coordinates of each formula ref, used by formula_adjust.
    pub ref_positions: Vec<crate::formula_adjust::RefPosition>,
}

/// A merged region in the sheet.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MergeRegion {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// A single cell change in the fill summary (lighter than FillUpdate).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillChangeSummary {
    pub row: u32,
    pub col: u32,
    /// "value" | "formula" | "format" | "clear"
    #[serde(rename = "type")]
    pub change_type: String,
}

/// Summary returned through the bridge (lighter than full FillResult).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillResultSummary {
    pub pattern_type: FillPatternType,
    pub filled_cell_count: u32,
    pub warnings: Vec<FillWarning>,
    pub changes: Vec<FillChangeSummary>,
}
