//! Stateless pure APIs — no Workbook/Sheet instance needed.
//!
//! These wrap the pure bridge functions from compute-core that operate
//! on provided data without requiring an engine instance.

pub mod cf;
pub mod chart;
pub mod format;
pub mod pivot;
pub mod pivot_convert;
pub mod schema;
pub mod solver;
pub mod table;
