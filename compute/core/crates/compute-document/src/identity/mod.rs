//! Identity-position mappings for compute document sheets.

mod axes;
mod axis_index;
pub use axis_index::AxisIndex;
mod axis_mutations;
mod construction;
mod grid_index;
mod sorting;

pub use grid_index::GridIndex;

#[cfg(test)]
mod tests;
