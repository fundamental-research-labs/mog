//! Sheet-level Sparkline storage API.
//!
//! This facade preserves the historical `storage::sheet::sparklines` API while
//! keeping Yrs storage keys, codec helpers, sparkline CRUD, group CRUD, and
//! range cleanup in focused submodules.
//!
//! ## Yrs Storage Layout (structured Y.Map)
//!
//! Sparklines and groups are stored as structured Y.Map entries.
//!
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- sparklines: Y.Map
//!           +-- {sparklineId}:    Y.Map (structured Sparkline fields)
//!           +-- group:{groupId}:  Y.Map (structured SparklineGroup fields)
//!           +-- idx:{row},{col}:  String (sparklineId; cell index for O(1) lookup)
//! ```

mod codec;
mod groups;
mod items;
mod keys;
mod range;
mod yrs_io;

pub use domain_types::domain::sparkline::*;

pub use crate::engine_types::sparklines::*;
pub use groups::{
    add_sparkline_group, delete_sparkline_group, get_sparkline_group, get_sparkline_groups_in_sheet,
};
pub use items::{
    add_sparkline, delete_sparkline, get_sparkline, get_sparkline_at_cell, get_sparklines_in_sheet,
    has_sparkline, update_sparkline,
};
pub use range::{clear_sparklines_for_sheet, clear_sparklines_in_range};

/// Position-only cell range (re-exported from compute-types for backward compat).
pub type CellRange = crate::PositionRange;

#[cfg(test)]
mod tests;
