//! Sparse OOXML cell metadata keyed by stable cell identity.
//!
//! Values and identity formulas remain owned by the native cell store. These
//! entries exist only when a cell has package metadata or authored CSE state.

use cell_types::CellId;
use rustc_hash::FxHashMap;

use super::WorkbookStorage;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct CellMetadata {
    pub array_ref: Option<String>,
    pub formula: Option<FormulaMetadata>,
    pub rich_string: Option<domain_types::RichSharedString>,
}

/// OOXML formula attributes. Formula text is rendered from the current native
/// formula when exporting; retaining it here would create a second source.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub(crate) struct FormulaMetadata {
    pub t: ooxml_types::worksheet::CellFormulaType,
    pub si: Option<u32>,
    pub r#ref: Option<String>,
    pub aca: bool,
    pub dt2d: bool,
    pub del1: bool,
    pub del2: bool,
    pub r1: Option<String>,
    pub r2: Option<String>,
    pub ca: bool,
    pub bx: bool,
    pub dtr: bool,
}

impl From<&ooxml_types::worksheet::CellFormula> for FormulaMetadata {
    fn from(formula: &ooxml_types::worksheet::CellFormula) -> Self {
        Self {
            t: formula.t.clone(),
            si: formula.si.clone(),
            r#ref: formula.r#ref.clone(),
            aca: formula.aca.clone(),
            dt2d: formula.dt2d.clone(),
            del1: formula.del1.clone(),
            del2: formula.del2.clone(),
            r1: formula.r1.clone(),
            r2: formula.r2.clone(),
            ca: formula.ca.clone(),
            bx: formula.bx.clone(),
            dtr: formula.dtr.clone(),
        }
    }
}

impl FormulaMetadata {
    fn is_empty(&self) -> bool {
        self.t == ooxml_types::worksheet::CellFormulaType::Normal
            && self.si.is_none()
            && self.r#ref.is_none()
            && !self.aca
            && !self.dt2d
            && !self.del1
            && !self.del2
            && self.r1.is_none()
            && self.r2.is_none()
            && !self.ca
            && !self.bx
            && !self.dtr
    }

    pub(crate) fn to_ooxml(&self, current_formula: &str) -> ooxml_types::worksheet::CellFormula {
        ooxml_types::worksheet::CellFormula {
            text: current_formula
                .strip_prefix('=')
                .unwrap_or(current_formula)
                .to_string(),
            t: self.t.clone(),
            si: self.si.clone(),
            r#ref: self.r#ref.clone(),
            aca: self.aca.clone(),
            dt2d: self.dt2d.clone(),
            del1: self.del1.clone(),
            del2: self.del2.clone(),
            r1: self.r1.clone(),
            r2: self.r2.clone(),
            ca: self.ca.clone(),
            bx: self.bx.clone(),
            dtr: self.dtr.clone(),
        }
    }
}

pub(crate) type CellMetadataMap = FxHashMap<CellId, CellMetadata>;

impl CellMetadata {
    pub(crate) fn from_import(cell: &domain_types::CellData) -> Self {
        Self {
            array_ref: cell.array_ref.clone(),
            formula: cell
                .cell_formula
                .as_ref()
                .map(FormulaMetadata::from)
                .filter(|metadata| !metadata.is_empty()),
            rich_string: cell.rich_string.clone(),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.array_ref.is_none() && self.formula.is_none() && self.rich_string.is_none()
    }
}

impl WorkbookStorage {
    pub(crate) fn cell_metadata(&self, cell_id: &CellId) -> Option<&CellMetadata> {
        self.cell_metadata.get(cell_id)
    }

    pub(crate) fn set_cell_metadata(&mut self, cell_id: CellId, metadata: CellMetadata) {
        crate::storage::engine::history::metadata::capture_cell_metadata(self, cell_id);
        if metadata.is_empty() {
            self.cell_metadata.remove(&cell_id);
        } else {
            self.cell_metadata.insert(cell_id, metadata);
        }
    }

    /// Ordinary authored replacement/clear invalidates imported formula/cache
    /// annotations and rich runs. Metadata is reattached explicitly for CSE entry.
    pub(crate) fn clear_cell_metadata(&mut self, cell_id: CellId) {
        if self.cell_metadata.contains_key(&cell_id) {
            crate::storage::engine::history::metadata::capture_cell_metadata(self, cell_id);
            self.cell_metadata.remove(&cell_id);
        }
    }
}
