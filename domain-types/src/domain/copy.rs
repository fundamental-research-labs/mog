//! Copy operation types for range copy/paste.

use serde::{Deserialize, Serialize};

/// Specifies what data to copy in a range copy operation.
///
/// Maps to OfficeJS `Excel.RangeCopyType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum CopyType {
    /// Copy everything: values, formulas, and formats.
    #[default]
    All,
    /// Copy formulas with reference adjustment; values for non-formula cells.
    Formulas,
    /// Copy computed values only (no formulas).
    Values,
    /// Copy formats only, preserving target values.
    Formats,
}
