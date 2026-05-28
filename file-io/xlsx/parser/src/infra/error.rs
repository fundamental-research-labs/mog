//! Error recovery infrastructure for XLSX parsing.
//!
//! This module provides comprehensive error handling and recovery mechanisms
//! for parsing XLSX files, allowing for graceful degradation when encountering
//! malformed or corrupted data.
//!
//! # Parse Modes
//!
//! - **Strict**: Fail on first error - useful for validation
//! - **Lenient**: Skip items with errors, continue parsing, collect warnings
//! - **Permissive**: Maximum recovery, ignore most errors - useful for data recovery
//!
//! # Example
//!
//! ```rust
//! use xlsx_parser::{ErrorCode, ParseContext};
//!
//! let mut ctx = ParseContext::lenient();
//! ctx.set_current_part("xl/worksheets/sheet1.xml");
//!
//! // Report a warning (non-fatal)
//! ctx.report_warning(ErrorCode::InvalidCellReference, "Invalid cell ref 'ZZZ999999'");
//!
//! // Check if we should continue
//! if !ctx.should_stop() {
//!     // Continue parsing...
//! }
//! ```

mod collector;
mod context;
mod detail;
mod mode;
mod recovery;
mod types;

pub use collector::ErrorCollector;
pub use context::ParseContext;
pub use detail::{ErrorLocation, ParseErrorDetail};
pub use mode::mode_from_u32;
pub use recovery::{
    recover_cell_reference, recover_number, recover_shared_string, recover_style_index,
};
pub use types::{ErrorCode, ErrorSeverity, ParseMode};

// Re-export A1 reference utilities for backward compatibility.
pub use crate::infra::a1::col_to_letter;
pub use crate::infra::a1::format_cell_ref;
