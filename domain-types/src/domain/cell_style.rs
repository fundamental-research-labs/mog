//! Custom cell style definition.
//!
//! Persisted in the Yrs CRDT document under `workbook.custom_cell_styles`.

use crate::CellFormat;
use serde::{Deserialize, Serialize};

/// A user-defined (or built-in) named cell style.
///
/// Each style has a unique `id`, a human-visible `name`, an optional
/// `category` for grouping in the UI, the `format` to apply, and a
/// `built_in` flag that distinguishes factory-shipped styles from
/// user-created ones.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellStyleDef {
    /// Unique identifier (hex UUID).
    pub id: String,
    /// Human-readable style name (e.g. "Heading 1", "Currency").
    pub name: String,
    /// Optional UI grouping category (e.g. "Titles and Headings", "Data and Model").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// The cell format to apply when this style is selected.
    pub format: CellFormat,
    /// Whether this is a factory-shipped built-in style.
    #[serde(default)]
    pub built_in: bool,
}
