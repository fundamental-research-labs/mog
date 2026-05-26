//! Worksheet structural types (MergeRange, SheetPane, ColWidth, RowHeight, SheetVisibility).
//!
//! Unified from xlsx-parser `common/range.rs` and `xlsx-types/src/sheet.rs`.

mod cell_types;
mod column;
pub(crate) mod filter;
mod hyperlink;
mod ignored_errors;
pub(crate) mod merge;
mod misc;
mod pane;
mod properties;
mod row;
mod scenarios;
mod validation;
mod view;
mod visibility;

#[cfg(test)]
mod tests;

// Re-export all public items to preserve the `worksheet::*` API.
pub use cell_types::*;
pub use column::ColWidth;
pub use filter::*;
pub use hyperlink::*;
pub use ignored_errors::*;
pub use merge::MergeRange;
pub use misc::*;
pub use pane::{Pane, PaneState, SheetPane};
pub use properties::*;
pub use row::RowHeight;
pub use scenarios::*;
pub use validation::*;
pub use view::{PivotAxis, PivotSelection, Selection, SheetView, SheetViewType};
pub use visibility::SheetVisibility;

// ---------------------------------------------------------------------------
// Serde helper
// ---------------------------------------------------------------------------

/// Helper for `skip_serializing_if` on `bool` fields that default to false.
fn is_false(v: &bool) -> bool {
    !v
}

/// Helper: returns `true` (for serde defaults that are true per spec).
pub(crate) fn default_true() -> bool {
    true
}

/// Helper: skip-serializing-if for fields that default to true.
pub(crate) fn is_true(v: &bool) -> bool {
    *v
}
