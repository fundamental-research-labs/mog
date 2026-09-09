//! Mutable cell operations for the cell store.
//!
//! The write subtree keeps the existing `CellStore` inherent-method API split by
//! mutation domain. Column-store writes must preserve the distinction between data
//! extents and identity-only extents, and cache/version touches happen only after
//! any mutable `SheetStore` borrow has ended.

mod cells;
mod display_metadata;
mod identity;
mod pivot_materialization;
mod position;
mod projection_materialization;

#[cfg(test)]
mod tests;
