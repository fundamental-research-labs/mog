//! Grouping render types for outline/grouping UI.
//!
//! The shared domain types (`GroupAxis`, `GroupDefinition`, `SheetGroupingConfig`,
//! `OutlineLevel`, etc.) live in the `domain-types` crate and are
//! imported from there.

use serde::{Deserialize, Serialize};

use domain_types::{GroupAxis, GroupDefinition, OutlineLevel, SheetGroupingConfig};

/// Viewport definition for rendering queries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    /// Start row index.
    pub start_row: u32,
    /// End row index.
    pub end_row: u32,
    /// Start column index.
    pub start_col: u32,
    /// End column index.
    pub end_col: u32,
}

/// An outline symbol (+/- button) to render.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineSymbol {
    /// Symbol identifier.
    pub id: String,
    /// Axis of the group.
    pub axis: GroupAxis,
    /// Row or column index.
    pub index: u32,
    /// Outline level.
    pub level: u32,
    /// Whether the group is collapsed.
    pub collapsed: bool,
    /// Group ID this symbol belongs to.
    pub group_id: String,
}

/// A level button to render (1, 2, 3...).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineLevelButton {
    /// Outline level number.
    pub level: u32,
    /// Axis of the level button.
    pub axis: GroupAxis,
}

/// Complete outline render data for a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineRenderData {
    /// Current grouping configuration.
    pub config: SheetGroupingConfig,
    /// Row group definitions.
    pub row_groups: Vec<GroupDefinition>,
    /// Column group definitions.
    pub column_groups: Vec<GroupDefinition>,
    /// Maximum row outline level.
    pub max_row_level: u32,
    /// Maximum column outline level.
    pub max_col_level: u32,
    /// Row outline levels.
    pub row_outline_levels: Vec<OutlineLevel>,
    /// Column outline levels.
    pub column_outline_levels: Vec<OutlineLevel>,
    /// Outline symbols to render.
    pub outline_symbols: Vec<OutlineSymbol>,
    /// Level buttons to render.
    pub level_buttons: Vec<OutlineLevelButton>,
}

/// Represents a group boundary in the data.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupBoundary {
    /// Value that defines this group.
    pub group_value: String,
    /// First row of the group.
    pub start_row: u32,
    /// Last row of the group.
    pub end_row: u32,
}
