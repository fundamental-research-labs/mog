//! Workbook XML writer.
//!
//! Generates `xl/workbook.xml`, including sheet references, workbook views,
//! defined names, calculation settings, and workbook-level metadata.

mod attrs;
mod calc;
mod defined_names;
mod external;
mod metadata;
mod root;
mod sheets;
mod types;
mod views;
mod writer;

#[cfg(test)]
mod tests;

pub use calc::calc_settings_from_domain;
pub use super::types::{CalcMode, CalcSettings, SheetDef, SheetState, WorkbookView};
pub use types::DefinedNameDef;
pub use writer::WorkbookWriter;
