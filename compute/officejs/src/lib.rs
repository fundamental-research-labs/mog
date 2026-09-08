//! Headless Mog scripting: the engine exposes the Office.js Excel API.
//!
//! Scripts run inside an embedded QuickJS runtime. The public surface is
//! `Excel.run` / `RequestContext` / `load` / `context.sync`, not a custom
//! workbook wrapper.

mod borders;
mod dispatch;
mod error;
mod format;
mod host;
mod names;
mod range_content;
mod range_navigation;
mod runtime;
mod sort_filter;
mod table_collections;
mod tables;
mod validation;
mod worksheets;

pub use error::OfficeJsError;
pub use runtime::{ScriptOutput, run_office_js, run_office_js_with_workbook};
