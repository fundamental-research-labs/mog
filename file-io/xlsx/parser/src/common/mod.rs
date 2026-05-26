//! Common types shared between read and write modules.

pub mod range;

// Re-export A1 reference utilities from infra (moved there in architecture refactor)
pub use crate::infra::a1::{
    col_to_letter, col_to_letters, format_cell_ref, parse_a1_cell, parse_a1_range, to_a1,
};

// Re-export range types
pub use range::{ColWidth, MergeRange, Pane, PaneState, RowHeight, SheetPane};
