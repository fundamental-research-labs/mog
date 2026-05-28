//! Identity-position mappings for compute document sheets.

mod axes;
mod axis_mutations;
mod cell_lifecycle;
mod construction;
mod grid_index;
mod queries;
mod sorting;

pub use grid_index::GridIndex;

#[cfg(test)]
mod tests;
