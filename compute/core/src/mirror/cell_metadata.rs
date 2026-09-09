//! Read-only workbook metadata boundary for reference-aware formula functions.
use super::CellMirror;
use cell_types::{CellId, SheetId};
use domain_types::{CellFormat, RichSharedString};

#[derive(Debug, Clone)]
pub struct CellReferenceMetadata {
    pub format: CellFormat,
    /// Display character count, excluding OOXML cell padding, measured with
    /// the engine's supplied layout metrics. CELL rounds this to an integer.
    pub column_width: f64,
    pub column_width_is_default: bool,
}

/// Imported formula evaluation mode, persisted independently of cached values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FormulaResultMode {
    LegacyScalar,
    Cse,
    Dynamic,
}

/// Storage implements this interface; the mirror/evaluator never own a
/// mutable storage interface. Queries use the current mirror identities and
/// formatting ranges, including positions that have no allocated cell.
pub(crate) trait CellMetadataProvider: std::fmt::Debug + Send + Sync {
    /// Optional implementation identity for allocation-free native refresh checks.
    fn as_any(&self) -> Option<&dyn std::any::Any> {
        None
    }
    fn formula_result_mode(&self, _sheet: &SheetId, _cell: &CellId) -> Option<FormulaResultMode> {
        None
    }
    fn array_formula_ref(&self, _sheet: &SheetId, _cell: &CellId) -> Option<String> {
        None
    }
    fn revision(&self) -> u64 {
        0
    }
    /// Canonical live visibility, including imported manual and outline state.
    /// None leaves standalone mirrors responsible for their own visibility.
    fn row_hidden(&self, _mirror: &CellMirror, _sheet: &SheetId, _row: u32) -> Option<bool> {
        None
    }
    fn is_row_filtered(&self, _mirror: &CellMirror, _sheet: &SheetId, _row: u32) -> bool {
        false
    }
    /// Return the imported rich shared-string record owned by a cell.
    ///
    /// The provider returns an owned value from its immutable native metadata
    /// projection so evaluation can safely retain it across an async read.
    fn rich_shared_string(
        &self,
        _mirror: &CellMirror,
        _sheet: &SheetId,
        _row: u32,
        _col: u32,
    ) -> Option<RichSharedString> {
        None
    }
    fn query(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellReferenceMetadata>;
}

impl CellMirror {
    pub(crate) fn install_cell_metadata_provider(
        &mut self,
        provider: std::sync::Arc<dyn CellMetadataProvider>,
    ) {
        self.cell_metadata_provider = Some(provider);
        // Snapshot array_ref alone cannot distinguish dynamic arrays from CSE.
        // Resolve that distinction as soon as canonical imported metadata exists.
        let dynamic: Vec<_> = self
            .cse_anchors
            .iter()
            .copied()
            .filter(|cell| {
                matches!(
                    self.formula_result_mode(cell),
                    Some(FormulaResultMode::Dynamic | FormulaResultMode::LegacyScalar)
                )
            })
            .collect();
        for cell in dynamic {
            self.cse_anchors.remove(&cell);
            self.cse_single_cell.remove(&cell);
        }
    }

    pub(crate) fn formula_result_mode(&self, cell: &CellId) -> Option<FormulaResultMode> {
        let sheet = self.sheet_for_cell(cell)?;
        self.cell_metadata_provider
            .as_ref()?
            .formula_result_mode(&sheet, cell)
    }

    /// Read the cell-owned rich string through the installed storage provider.
    pub(crate) fn phonetic_shared_string(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<RichSharedString> {
        self.cell_metadata_provider
            .as_ref()?
            .rich_shared_string(self, sheet, row, col)
    }

    pub(crate) fn declared_array_extent(&self, cell: &CellId) -> Option<(u32, u32)> {
        let sheet = self.sheet_for_cell(cell)?;
        let range = self
            .cell_metadata_provider
            .as_ref()?
            .array_formula_ref(&sheet, cell)?;
        let range = compute_parser::parse_a1_range(&range)?;
        let (
            formula_types::CellRef::Positional {
                row: sr, col: sc, ..
            },
            formula_types::CellRef::Positional {
                row: er, col: ec, ..
            },
        ) = (range.start, range.end)
        else {
            return None;
        };
        Some((sr.abs_diff(er) + 1, sc.abs_diff(ec) + 1))
    }
}
