//! Headless Mog scripting: the engine exposes the Office.js Excel API.
//!
//! Scripts run inside an embedded QuickJS runtime. The public surface is
//! `Excel.run` / `RequestContext` / `load` / `context.sync`, not a custom
//! workbook wrapper.
//!
//! Each mutating `context.sync()` is one undo action. Explicit Rust history
//! groups can combine several syncs. If a sync fails partway through its
//! queued operations, successful earlier writes remain applied and undoable.

mod borders;
mod comments;
mod conditional;
mod dispatch;
mod error;
mod format;
mod freeze;
mod host;
mod names;
mod pivot;
mod range_content;
mod range_navigation;
mod range_ops;
mod runtime;
mod sort_filter;
mod table_collections;
mod tables;
mod validation;
mod worksheets;

pub use error::OfficeJsError;
pub use runtime::{ScriptOutput, run_office_js, run_office_js_with_workbook};
