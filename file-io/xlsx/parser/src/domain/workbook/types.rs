//! Shared workbook domain types used by both read and write paths.

/// Re-export `BookView` from ooxml-types as the canonical workbook view type.
pub type WorkbookView = ooxml_types::workbook::BookView;

/// Re-export `CalcPr` from ooxml-types as the canonical calculation settings type.
pub type CalcSettings = ooxml_types::workbook::CalcPr;

/// Backward-compatible name for parsed `<calcPr>` settings.
pub type CalcPrSettings = CalcSettings;

/// Re-export `CalcMode` from ooxml-types as the canonical calc mode type.
pub use ooxml_types::workbook::CalcMode;

/// Sheet visibility state — re-exported from `ooxml_types` (single source of truth).
pub use ooxml_types::workbook::SheetState;

/// Sheet definition in workbook.
#[derive(Debug, Clone)]
pub struct SheetDef {
    /// Display name of the sheet.
    pub name: String,
    /// Unique sheet ID within the workbook.
    pub sheet_id: u32,
    /// Relationship ID linking to workbook.xml.rels (e.g., "rId1").
    pub r_id: String,
    /// Sheet visibility state.
    pub state: SheetState,
}

impl SheetDef {
    /// Create a new visible sheet definition.
    pub fn new(name: impl Into<String>, sheet_id: u32, r_id: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            sheet_id,
            r_id: r_id.into(),
            state: SheetState::Visible,
        }
    }

    /// Create a sheet definition with a specific state.
    pub fn with_state(
        name: impl Into<String>,
        sheet_id: u32,
        r_id: impl Into<String>,
        state: SheetState,
    ) -> Self {
        Self {
            name: name.into(),
            sheet_id,
            r_id: r_id.into(),
            state,
        }
    }
}

/// Backward-compatible read-path name for a workbook sheet reference.
pub type SheetInfo = SheetDef;
