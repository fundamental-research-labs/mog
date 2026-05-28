use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};

use super::CFRule;

/// Cell range for conditional formatting (position-based).
/// Re-export of `cell_types::SheetRange` for ergonomic use in CF contexts.
pub type CFCellRange = cell_types::SheetRange;

/// Cell-identity-based range for collaborative editing.
/// Identifies a rectangular region by the stable IDs of its corner cells,
/// so the range survives row/column insertions and deletions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellIdRange {
    pub top_left_cell_id: String,
    pub bottom_right_cell_id: String,
}

/// A conditional format definition.
/// Associates one or more rules with cell ranges on a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalFormat {
    /// Format identifier (UUID string).
    pub id: String,
    /// Sheet ID (UUID string).
    pub sheet_id: String,
    /// Whether this CF applies to a pivot table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot: Option<bool>,
    /// Position-based ranges (structured, not A1 strings).
    pub ranges: Vec<CFCellRange>,
    /// Cell-identity-based ranges (optional, for collaborative editing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range_identities: Option<Vec<CellIdRange>>,
    /// Rules to evaluate (in priority order).
    pub rules: Vec<CFRule>,
}
