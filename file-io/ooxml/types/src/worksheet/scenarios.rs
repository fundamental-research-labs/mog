//! Scenario types (ECMA-376 CT_InputCells, CT_Scenario, CT_Scenarios §18.3.1.46–48).
//!
//! Scenarios allow users to define named sets of input values for what-if analysis.

use super::is_false;

// ---------------------------------------------------------------------------
// InputCells
// ---------------------------------------------------------------------------

/// A single input cell for a scenario (ECMA-376 CT_InputCells, §18.3.1.46).
///
/// References one cell and the value that the scenario assigns to it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct InputCells {
    /// Cell reference (e.g., "A1").
    pub r: String,
    /// Whether this input cell has been deleted. Default: `false`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub deleted: bool,
    /// Whether this input cell change has been undone. Default: `false`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub undone: bool,
    /// The input value for the cell.
    pub val: String,
    /// Number format ID for the cell value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_fmt_id: Option<u32>,
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

/// A single scenario for what-if analysis (ECMA-376 CT_Scenario, §18.3.1.47).
///
/// Contains a named set of input cell values that can be applied to the worksheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Scenario {
    /// Input cells that define this scenario's values.
    pub input_cells: Vec<InputCells>,
    /// Name of the scenario.
    pub name: String,
    /// Whether the scenario is locked from editing. Default: `false`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub locked: bool,
    /// Whether the scenario is hidden from the user. Default: `false`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    /// Number of input cells in this scenario.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    /// User who last edited this scenario.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// Comment describing the scenario.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// Collection of scenarios (ECMA-376 CT_Scenarios, §18.3.1.48).
///
/// Contains one or more scenarios for what-if analysis on the worksheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Scenarios {
    /// The scenarios in this collection.
    pub scenario: Vec<Scenario>,
    /// Index of the currently shown scenario.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<u32>,
    /// Index of the scenario to show when the workbook is opened.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show: Option<u32>,
    /// Cell range reference for the changing cells (ST_Sqref).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sqref: Option<String>,
}
