//! Pivot field identification and definition types.
//!
//! Consolidated from `pivot-types/src/field_id.rs` and `pivot-types/src/field.rs`.

use serde::{Deserialize, Serialize};
use std::fmt;

use super::ooxml::{PivotFieldFunction, PivotFieldItem};
use crate::domain::analytics::DetectedDataType;

/// Strongly-typed field identifier.
///
/// Prevents accidentally passing a `sheet_id`, `table_id`, or compound key where a
/// `field_id` is expected. The inner `String` is accessible via `Deref<Target = str>`
/// for ergonomic usage with string APIs.
///
/// # Serde
///
/// Serializes/deserializes as a plain JSON string (`#[serde(transparent)]`).
///
/// # Examples
///
/// ```
/// # use domain_types::domain::pivot::FieldId;
/// let id = FieldId::from("sales");
/// assert_eq!(&*id, "sales");
/// assert_eq!(id.to_string(), "sales");
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FieldId(String);

impl FieldId {
    /// Create a new `FieldId` from any type that can be converted into a `String`.
    #[must_use]
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    /// Return the inner string as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::ops::Deref for FieldId {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for FieldId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl From<String> for FieldId {
    fn from(s: String) -> Self {
        FieldId(s)
    }
}

impl From<&str> for FieldId {
    fn from(s: &str) -> Self {
        FieldId(s.to_owned())
    }
}

impl AsRef<str> for FieldId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// A field (column) from the source data that can be used in a pivot table.
///
/// Fields are detected from the source range header row. Each field has an ID
/// (typically the header text), a display name, and metadata about its data type
/// and position in the source range.
///
/// The trailing fields (`num_fmt_id`, `base_field`, `base_item`, `show_all`,
/// `subtotal_top`, `default_subtotal`, `subtotals`, `items`) are modeled OOXML
/// attributes. The compute engine ignores them; they exist so the XLSX writer
/// can reconstruct pivotTable{N}.xml from typed state.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotField {
    /// Unique identifier for this field (typically the column header text).
    pub id: FieldId,
    /// Display name shown in the pivot table UI.
    pub name: String,
    /// Zero-based column index in the source data range.
    ///
    /// Stored as `u32` because Excel's maximum column count is 16,384 (well within u32).
    /// Convert to `usize` with `as usize` at usage sites that need indexing.
    pub source_column: u32,
    /// Detected data type based on scanning source values.
    pub data_type: DetectedDataType,
    /// Number format ID for this field's data (OOXML).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_fmt_id: Option<u32>,
    /// Base field index for show-values-as calculations (OOXML).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_field: Option<i32>,
    /// Base item index for show-values-as calculations (OOXML).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_item: Option<u32>,
    /// Whether to show all items, including empty (OOXML).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_all: Option<bool>,
    /// Subtotal position (above or below group). `None` = OOXML default (true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtotal_top: Option<bool>,
    /// Default subtotal visibility. `None` = OOXML default (true for axis fields).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_subtotal: Option<bool>,
    /// Explicit subtotal functions (OOXML).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subtotals: Vec<PivotFieldFunction>,
    /// Field items — shared item indices, subtotal markers, hidden state
    /// (OOXML).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<PivotFieldItem>,
}
