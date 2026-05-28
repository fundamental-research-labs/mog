use ooxml_types::cond_format::{CfOperator, CfTimePeriod};
use serde::{Deserialize, Serialize};

use super::{CFColorScale, CFDataBar, CFIconSet, CFStyle};

/// A single conditional formatting rule.
/// Tagged enum — each variant carries only its relevant fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CFRule {
    /// Compare cell value against threshold(s).
    #[serde(rename = "cellValue")]
    CellValue {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        /// Comparison operator. Only the `lessThan` / `lessThanOrEqual` /
        /// `equal` / `notEqual` / `greaterThan` / `greaterThanOrEqual` /
        /// `between` / `notBetween` subset of [`CfOperator`] is meaningful for
        /// cellIs rules; the text-operator variants belong on
        /// [`CFRule::ContainsText`]. Domain not narrowed at the type level
        /// because the OOXML vocabulary is a single `ST_ConditionalFormattingOperator`.
        operator: CfOperator,
        value1: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value2: Option<serde_json::Value>,
        style: CFStyle,
        /// Preserved `text` attribute from OOXML for round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    /// Custom formula returns TRUE/FALSE.
    #[serde(rename = "formula", alias = "expression")]
    Formula {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        formula: String,
        style: CFStyle,
        /// Preserved `text` attribute from OOXML for round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    /// 2-color or 3-color gradient.
    #[serde(rename = "colorScale")]
    ColorScale {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(alias = "colorScale")]
        color_scale: CFColorScale,
    },
    /// In-cell horizontal bar chart.
    #[serde(rename = "dataBar")]
    DataBar {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(alias = "dataBar")]
        data_bar: CFDataBar,
    },
    /// Conditional icons (arrows, flags, etc.).
    #[serde(rename = "iconSet")]
    IconSet {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(alias = "iconSet")]
        icon_set: CFIconSet,
    },
    /// Top/bottom N or N%.
    #[serde(rename = "top10")]
    Top10 {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        rank: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        percent: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bottom: Option<bool>,
        style: CFStyle,
    },
    /// Above/below average.
    #[serde(rename = "aboveAverage")]
    AboveAverage {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        above_average: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        equal_average: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        std_dev: Option<i32>,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Highlight duplicates or uniques.
    #[serde(rename = "duplicateValues")]
    DuplicateValues {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unique: Option<bool>,
        style: CFStyle,
    },
    /// Text contains, begins with, ends with, not contains.
    #[serde(rename = "containsText")]
    ContainsText {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        /// Text operator. Only the `containsText` / `notContains` /
        /// `beginsWith` / `endsWith` subset of [`CfOperator`] is meaningful
        /// for text rules; the cellIs comparison variants belong on
        /// [`CFRule::CellValue`]. Domain not narrowed at the type level
        /// because the OOXML vocabulary is a single `ST_ConditionalFormattingOperator`.
        operator: CfOperator,
        text: String,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Blank or non-blank cells.
    #[serde(rename = "containsBlanks")]
    ContainsBlanks {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        blanks: bool,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Error or non-error cells.
    #[serde(rename = "containsErrors")]
    ContainsErrors {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        errors: bool,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Date-based rules (yesterday, today, tomorrow, etc.).
    #[serde(rename = "timePeriod")]
    TimePeriod {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        time_period: CfTimePeriod,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
}

impl CFRule {
    /// Returns the rule's unique identifier.
    pub fn id(&self) -> &str {
        match self {
            Self::CellValue { id, .. }
            | Self::Formula { id, .. }
            | Self::ColorScale { id, .. }
            | Self::DataBar { id, .. }
            | Self::IconSet { id, .. }
            | Self::Top10 { id, .. }
            | Self::AboveAverage { id, .. }
            | Self::DuplicateValues { id, .. }
            | Self::ContainsText { id, .. }
            | Self::ContainsBlanks { id, .. }
            | Self::ContainsErrors { id, .. }
            | Self::TimePeriod { id, .. } => id,
        }
    }

    /// Returns the rule's priority.
    pub fn priority(&self) -> i32 {
        match self {
            Self::CellValue { priority, .. }
            | Self::Formula { priority, .. }
            | Self::ColorScale { priority, .. }
            | Self::DataBar { priority, .. }
            | Self::IconSet { priority, .. }
            | Self::Top10 { priority, .. }
            | Self::AboveAverage { priority, .. }
            | Self::DuplicateValues { priority, .. }
            | Self::ContainsText { priority, .. }
            | Self::ContainsBlanks { priority, .. }
            | Self::ContainsErrors { priority, .. }
            | Self::TimePeriod { priority, .. } => *priority,
        }
    }

    /// Sets the rule's priority in-place.
    pub fn set_priority(&mut self, p: i32) {
        match self {
            Self::CellValue { priority, .. }
            | Self::Formula { priority, .. }
            | Self::ColorScale { priority, .. }
            | Self::DataBar { priority, .. }
            | Self::IconSet { priority, .. }
            | Self::Top10 { priority, .. }
            | Self::AboveAverage { priority, .. }
            | Self::DuplicateValues { priority, .. }
            | Self::ContainsText { priority, .. }
            | Self::ContainsBlanks { priority, .. }
            | Self::ContainsErrors { priority, .. }
            | Self::TimePeriod { priority, .. } => *priority = p,
        }
    }
}
