//! Named range (defined name) domain types.
//!
//! Pure data contracts — no Yrs, no storage internals.

use cell_types::RangeId;
use serde::{Deserialize, Serialize};

/// A defined name (named range).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedName {
    /// Unique identifier for the defined name.
    pub id: String,
    /// The name (e.g., "SalesData", "TaxRate"). Case-insensitive for lookup.
    pub name: String,
    /// The reference formula string (e.g., "=Sheet1!$A$1:$B$10").
    /// Stored as plain string. IdentityFormula conversion deferred to integration layer.
    pub refers_to: String,
    /// Original opaque reference text for references the compute engine cannot
    /// model structurally, such as external-workbook names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_refers_to: Option<String>,
    /// Optional sheet scope. None = workbook scope.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Optional comment/description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Custom menu text (customMenu) for macro-oriented defined names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_menu: Option<String>,
    /// Description text (description) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Help topic text (help) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// Status bar text (statusBar) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// Whether the name is visible in Name Manager.
    #[serde(default = "default_true")]
    pub visible: bool,
    /// Whether this is an XLM macro name.
    #[serde(default)]
    pub xlm: bool,
    /// Whether this name is a function.
    #[serde(default)]
    pub function: bool,
    /// Whether this is a VBA procedure name.
    #[serde(default)]
    pub vb_procedure: bool,
    /// Whether to publish this name to the server.
    #[serde(default)]
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter.
    #[serde(default)]
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted.
    #[serde(default)]
    pub xml_space_preserve: bool,
    /// Display order in the Name Manager UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// Optional linkage to an existing `RangeKind::Data` Range covering the
    /// same region. Populated at import time; cleared when the linked Range
    /// is deleted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_range_id: Option<RangeId>,
}

/// Serde helper for `true` default values.
fn default_true() -> bool {
    true
}

/// Input for creating a defined name.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedNameInput {
    /// The name to define.
    pub name: String,
    /// The reference formula string.
    pub refers_to: String,
    /// Scope: None = workbook, Some(sheet_id) = sheet-local.
    pub scope: Option<String>,
    /// Optional comment.
    pub comment: Option<String>,
}

/// Partial update for an existing defined name.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRangeUpdate {
    /// New name (if renaming).
    pub name: Option<String>,
    /// New refers_to formula string.
    pub refers_to: Option<String>,
    /// New comment.
    pub comment: Option<Option<String>>,
    /// New visibility.
    pub visible: Option<bool>,
}

/// Result of name validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NameValidationResult {
    /// Whether the name is valid.
    pub valid: bool,
    /// Error type if invalid.
    pub error: Option<NameValidationError>,
    /// Human-readable error message.
    pub message: Option<String>,
}

/// Name validation error types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NameValidationError {
    /// Name is empty or whitespace-only.
    Empty,
    /// Name exceeds 255 characters.
    TooLong,
    /// Name starts with an invalid character (not letter, underscore, or backslash).
    InvalidFirstChar,
    /// Name contains invalid characters.
    InvalidChars,
    /// Name is reserved (TRUE, FALSE, NULL, single letters A-Z).
    Reserved,
    /// Name already exists in the same scope.
    Duplicate,
    /// Name looks like a cell reference (e.g., A1, XFD1048576).
    CellReference,
    /// Name looks like an R1C1 reference (e.g., R1C1, R100C200).
    R1C1Reference,
}

/// Options for creating names from selection.
#[derive(Debug, Clone)]
pub struct CreateFromSelectionOptions {
    /// Use first row as column names.
    pub top_row: bool,
    /// Use first column as row names.
    pub left_column: bool,
    /// Use last row as column names.
    pub bottom_row: bool,
    /// Use last column as row names.
    pub right_column: bool,
}

/// Result of creating names from selection.
#[derive(Debug, Clone)]
pub struct CreateFromSelectionResult {
    /// Number of names successfully created.
    pub success: u32,
    /// Number of names skipped.
    pub skipped: u32,
    /// Details about skipped names.
    pub skipped_reasons: Vec<SkippedReason>,
}

/// Reason a name was skipped during create-from-selection.
#[derive(Debug, Clone)]
pub struct SkippedReason {
    /// The label that was skipped.
    pub label: String,
    /// Reason for skipping.
    pub reason: String,
}
