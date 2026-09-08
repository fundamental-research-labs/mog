//! Headless Mog scripting: the engine exposes the Office.js Excel API.
//!
//! Scripts run inside an embedded QuickJS runtime. The public surface is
//! `Excel.run` / `RequestContext` / `load` / `context.sync`, not a custom
//! workbook wrapper.

mod borders;
mod chart_core;
mod chart_series;
mod dispatch;
mod error;
mod format;
mod format_dimensions;
mod host;
mod hyperlinks;
mod names;
mod protection;
mod range_areas;
mod range_content;
mod range_copy;
mod range_fill;
mod range_metadata;
mod range_navigation;
mod range_search;
mod range_structure;
mod runtime;
mod sort_filter;
mod table_collections;
mod tables;
mod validation;
mod worksheets;

pub use error::OfficeJsError;
pub use runtime::{ScriptOutput, run_office_js, run_office_js_with_workbook};
