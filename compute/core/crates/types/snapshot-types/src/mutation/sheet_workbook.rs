use serde::{Deserialize, Serialize};

use super::primitives::ChangeKind;
use domain_types::domain::print::{PageBreaks, PrintSettings};
use domain_types::domain::sheet::{PrintRange, PrintTitles, SplitViewConfig};

/// Discriminant for what changed in a sheet metadata change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetChangeField {
    Name,
    TabColor,
    Sheet,
    Order,
    Hidden,
    Frozen,
    Visibility,
    EnableCalculation,
}

/// A sheet metadata change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the sheet metadata was set or removed.
    pub kind: ChangeKind,
    /// What changed.
    pub field: SheetChangeField,
    // --- Optional payload fields (populated per operation, None otherwise) ---
    /// Sheet name (new name for create/rename/copy, deleted name for delete).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Previous name (for rename).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_name: Option<String>,
    /// Sheet index (new position for create/copy/move).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<i32>,
    /// Previous index (for move).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_index: Option<i32>,
    /// Whether sheet is hidden (for visibility changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Source sheet ID (for copy operations).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet_id: Option<String>,
    /// Frozen rows count (for freeze changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frozen_rows: Option<u32>,
    /// Previous frozen rows count (for freeze changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_frozen_rows: Option<u32>,
    /// Frozen cols count (for freeze changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frozen_cols: Option<u32>,
    /// Previous frozen cols count (for freeze changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_frozen_cols: Option<u32>,
    /// Tab color (for color changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Previous tab color (for color changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_color: Option<String>,
}

/// A sheet settings change (protection, view options, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSettingsChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the setting was set or removed.
    pub kind: ChangeKind,
    /// Which setting changed (camelCase key, e.g. "isProtected", "showGridlines").
    pub changed_key: String,
    /// Full settings snapshot after the change (serialized SheetSettings).
    pub settings: serde_json::Value,
}
/// A page-break configuration change for a sheet (full snapshot).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBreakChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Full post-mutation page-break configuration for the sheet.
    pub breaks: PageBreaks,
}

/// A print-area change for a sheet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintAreaChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the print area was set or removed.
    pub kind: ChangeKind,
    /// New print area; None when kind == Removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<PrintRange>,
}

/// A print-titles change for a sheet (full snapshot).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintTitlesChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Full post-mutation print titles for the sheet.
    pub titles: PrintTitles,
}

/// A print-settings change for a sheet (full snapshot).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettingsChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Full post-mutation print settings for the sheet.
    pub settings: PrintSettings,
}

/// A split-view config change for a sheet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitConfigChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the split config was set or removed.
    pub kind: ChangeKind,
    /// New config; None when kind == Removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<SplitViewConfig>,
}

/// A scroll-position change for a sheet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollPositionChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Top row index (zero-based).
    pub top_row: u32,
    /// Left column index (zero-based).
    pub left_col: u32,
}

/// A workbook-level settings change (workbook-scoped, not per-sheet).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSettingsChange {
    /// Whether the setting was set or removed.
    pub kind: ChangeKind,
    /// camelCase setting keys whose values changed.
    pub changed_keys: Vec<String>,
    /// Full post-mutation workbook settings snapshot, serialized as JSON.
    pub settings: serde_json::Value,
}
