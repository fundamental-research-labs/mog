//! Headless Mog scripting: the engine exposes the Office.js Excel API.
//!
//! Scripts run inside an embedded QuickJS runtime. The public surface is
//! `Excel.run` / `RequestContext` / `load` / `context.sync`, not a custom
//! workbook wrapper.

mod error;
mod host;
mod runtime;

pub use error::OfficeJsError;
pub use runtime::{ScriptOutput, run_office_js, run_office_js_with_workbook};
